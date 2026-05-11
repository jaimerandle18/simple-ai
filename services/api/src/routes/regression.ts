/**
 * Regression Testing — modal bloqueante con progreso en vivo.
 *
 * Flujo:
 * 1. POST /regression/start → crea run, dispara ejecución async, devuelve runId
 * 2. GET /regression/status/:runId → polling cada 2s desde el frontend
 * 3. POST /regression/decision/:runId → aplicar o revertir
 * 4. GET /regression/pending → busca runs pendientes de decisión
 * 5. POST /regression/execute/:runId → worker interno (self-invoked)
 */
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';
import Anthropic from '@anthropic-ai/sdk';
import Fuse from 'fuse.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const API_LAMBDA_URL = process.env.API_BASE_URL || process.env.API_LAMBDA_URL || '';

// ============================================================
// MISMO PIPELINE QUE EL BOT REAL (catalog + tools + prompt)
// ============================================================

function searchCatalog(query: string, catalog: any[], categoria?: string): any[] {
  let pool = catalog;
  if (categoria) {
    const catNorm = categoria.toLowerCase();
    const filtered = pool.filter((p: any) => (p.category || '').toLowerCase().includes(catNorm));
    if (filtered.length > 0) pool = filtered;
  }
  const fuse = new Fuse(pool, {
    keys: [{ name: 'name', weight: 0.4 }, { name: 'category', weight: 0.2 }, { name: 'brand', weight: 0.1 }, { name: 'description', weight: 0.15 }],
    threshold: 0.45, ignoreLocation: true,
  });
  const results = fuse.search(query);
  if (results.length > 0) return results.slice(0, 6).map(r => r.item);
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = normalize(query).split(/\s+/).filter(t => t.length >= 3);
  if (terms.length === 0) return [];
  return pool.map((p: any) => {
    const text = normalize([p.name, p.category, p.brand, p.description].filter(Boolean).join(' '));
    let score = 0; for (const t of terms) { if (text.includes(t)) score += 10; }
    return { ...p, _score: score };
  }).filter((x: any) => x._score > 0).sort((a: any, b: any) => b._score - a._score).slice(0, 6);
}

function formatProducts(products: any[]): string {
  if (products.length === 0) return '(ninguno en contexto, usa buscar_productos)';
  return products.map((p, i) => `- id: ${i+1}\n  nombre: "${p.name}"\n  precio: "${p.price || 'Consultar'}"\n  categoria: "${p.category || 'N/A'}"${p.sizes?.length ? `\n  talles: [${p.sizes.join(', ')}]` : ''}`).join('\n\n');
}

const SEARCH_TOOL: Anthropic.Tool[] = [{
  name: 'buscar_productos',
  description: 'Busca productos en el catálogo del negocio por nombre, categoría o uso.',
  input_schema: { type: 'object' as const, properties: { query: { type: 'string', description: 'Texto para buscar' }, categoria: { type: 'string', description: 'Filtrar por categoría' } }, required: ['query'] },
}];

// ============================================================
// HANDLER
// ============================================================

export async function handleRegression(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];
  if (!tenantId) return error('x-tenant-id required', 401);

  // ─── POST /regression/start ──────────────────────────
  if (method === 'POST' && path === '/regression/start') {
    const body = JSON.parse(event.body || '{}');
    const { oldPrompt, newPrompt, editedRules } = body;

    if (!newPrompt) return error('newPrompt required');

    // Cap anti-spam: max 3 runs por hora
    const recentRuns: any[] = await queryItems(`TENANT#${tenantId}`, 'REGRUN#', { limit: 10 });
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentCount = recentRuns.filter((r: any) => r.startedAt > oneHourAgo).length;
    if (recentCount >= 10) {
      return json({ runId: null, skipped: true, reason: 'rate_limit' });
    }

    // Cargar goldens activos
    const allGoldens: any[] = await queryItems(`TENANT#${tenantId}`, 'GOLDEN#', { limit: 200 });
    const activeGoldens = allGoldens.filter((g: any) => g.status === 'active');

    if (activeGoldens.length === 0) {
      return json({ runId: null, skipped: true, reason: 'no_goldens' });
    }

    // Seleccionar: todas si <=15, o 15 al azar
    const toRun = activeGoldens.length <= 15
      ? activeGoldens
      : shuffleArray(activeGoldens).slice(0, 15);

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Guardar run en estado "queued"
    await putItem({
      PK: `TENANT#${tenantId}`,
      SK: `REGRUN#${runId}`,
      runId, tenantId,
      status: 'queued',
      progress: { current: 0, total: toRun.length },
      currentGolden: null,
      oldPrompt: oldPrompt || '',
      newPrompt,
      editedRules: editedRules || '',
      goldenIds: toRun.map((g: any) => g.goldenId),
      results: null,
      summary: null,
      decision: null,
      startedAt: now,
      ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });

    // Fire and forget: llamar a /regression/execute/:runId asincrónicamente
    const executeUrl = `${API_LAMBDA_URL}/regression/execute/${runId}`;
    fetch(executeUrl, {
      method: 'POST',
      headers: { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, tenantId }),
    }).catch(err => console.error('[REGRESSION] Fire-and-forget failed:', err));

    return json({
      runId,
      skipped: false,
      totalGoldens: toRun.length,
      estimatedSeconds: toRun.length * 8,
    });
  }

  // ─── POST /regression/execute/:runId (worker interno) ─
  const executeMatch = path.match(/^\/regression\/execute\/([^/]+)$/);
  if (method === 'POST' && executeMatch) {
    const runId = executeMatch[1];
    await executeRegression(tenantId, runId);
    return json({ ok: true });
  }

  // ─── GET /regression/status/:runId ───────────────────
  const statusMatch = path.match(/^\/regression\/status\/([^/]+)$/);
  if (method === 'GET' && statusMatch) {
    const runId = statusMatch[1];
    const items = await queryItems(`TENANT#${tenantId}`, `REGRUN#${runId}`, { limit: 1 });
    if (items.length === 0) return error('Run not found', 404);

    const run: any = items[0];
    return json({
      runId: run.runId,
      status: run.status,
      progress: run.progress,
      currentGolden: run.currentGolden,
      results: run.status === 'completed' ? run.results : null,
      summary: run.status === 'completed' ? run.summary : null,
      error: run.error || null,
    });
  }

  // ─── POST /regression/decision/:runId ────────────────
  const decisionMatch = path.match(/^\/regression\/decision\/([^/]+)$/);
  if (method === 'POST' && decisionMatch) {
    const runId = decisionMatch[1];
    const body = JSON.parse(event.body || '{}');
    const { decision } = body;

    if (!decision || !['apply', 'revert'].includes(decision)) {
      return error('decision must be "apply" or "revert"');
    }

    const items = await queryItems(`TENANT#${tenantId}`, `REGRUN#${runId}`, { limit: 1 });
    if (items.length === 0) return error('Run not found', 404);
    const run: any = items[0];

    if (run.status !== 'completed') {
      return error('Run not completed yet', 400);
    }

    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found', 404);

    if (decision === 'apply') {
      // Guardar el nuevo prompt
      const cfg = agent.agentConfig || {};
      cfg.extraInstructions = run.newPrompt.slice(0, 3000);

      // Sync a businessConfig
      const businessConfig = agent.businessConfig || {};
      const updatedBc = await syncRulesToBusinessConfig(businessConfig, run.newPrompt);

      const now = new Date().toISOString();
      await putItem({
        ...agent,
        agentConfig: cfg,
        businessConfig: updatedBc,
        lastConfigChange: now,
        updatedAt: now,
      });
    }
    // Si revert → no hacer nada, el prompt viejo sigue

    await putItem({
      ...run,
      decision,
      decisionAt: new Date().toISOString(),
    });

    return json({ ok: true, applied: decision === 'apply' });
  }

  // ─── GET /regression/pending ─────────────────────────
  if (method === 'GET' && path === '/regression/pending') {
    const runs: any[] = await queryItems(`TENANT#${tenantId}`, 'REGRUN#', { limit: 10 });
    const pending = runs.find((r: any) =>
      (r.status === 'completed' || r.status === 'running' || r.status === 'queued') && !r.decision
    );

    if (!pending) return json({ run: null });

    return json({
      run: {
        runId: pending.runId,
        status: pending.status,
        progress: pending.progress,
        currentGolden: pending.currentGolden,
        summary: pending.summary,
        results: pending.results,
      },
    });
  }

  return error('Not found', 404);
}

// ============================================================
// REGRESSION EXECUTOR
// ============================================================

async function executeRegression(tenantId: string, runId: string) {
  const items = await queryItems(`TENANT#${tenantId}`, `REGRUN#${runId}`, { limit: 1 });
  if (items.length === 0) return;
  const run: any = items[0];

  await putItem({ ...run, status: 'running' });

  // Cargar goldens
  const allGoldens: any[] = await queryItems(`TENANT#${tenantId}`, 'GOLDEN#', { limit: 200 });
  const goldenMap = new Map(allGoldens.map((g: any) => [g.goldenId, g]));
  const goldenIds: string[] = run.goldenIds || [];

  // Cargar agentConfig + catálogo REAL (mismo que usa el bot)
  const agent = await getItem(keys.agent(tenantId, 'main'));
  const agentConfig = { ...(agent?.agentConfig || {}), extraInstructions: run.newPrompt };
  const catalog = (await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 500 }))
    .filter((p: any) => p.name && p.name.length > 2);

  // Categorías del catálogo
  const catCounts: Record<string, number> = {};
  for (const p of catalog) { if ((p as any).category) catCounts[(p as any).category] = (catCounts[(p as any).category] || 0) + 1; }
  const categories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ');

  // Prompt completo (mismo que test-chat y el bot real)
  const HARDCODED_RULES = `1. SOLO mencionás productos de PRODUCTOS_DISPONIBLES. NUNCA inventes.
2. NUNCA digas "no tengo eso cargado" si hay productos en contexto.
3. Precio formateado: $XX.XXX
4. Las fotos se envían AUTOMÁTICAMENTE.
5. USO DE buscar_productos: solo si el cliente pide categoría/producto NUEVO.
6. Si el cliente quiere comprar, pedile los datos.
7. Si insulta o pide humano: "Te paso con alguien del equipo."`;

  const name = agentConfig.assistantName || 'el vendedor';
  const web = agentConfig.websiteUrl || '';
  const activeRules = agentConfig.extraInstructions || HARDCODED_RULES;

  const stableBlock = `Sos un vendedor virtual por WhatsApp de un comercio argentino.\n\n# TONO\nArgentino casual, vos, conciso. Máx 1 emoji. Máximo 4-5 líneas.\nNUNCA uses signos de apertura.\n\n# REGLAS BASE\n${HARDCODED_RULES}`;
  const tenantBlock = `# IDENTIDAD\nNombre: ${name}${web ? `. Web: ${web}` : ''}\n\n${activeRules !== HARDCODED_RULES ? `# REGLAS DEL NEGOCIO\n${activeRules}` : ''}\n\n# CATEGORÍAS\n${categories}${agentConfig.promotions ? `\n\n# PROMOCIONES\n${agentConfig.promotions}` : ''}${agentConfig.businessHours ? `\n\n# HORARIO\n${agentConfig.businessHours}` : ''}${agentConfig.welcomeMessage ? `\n\n# BIENVENIDA\n${agentConfig.welcomeMessage}` : ''}`;

  const results: any[] = [];
  const validGoldens = goldenIds.map(id => goldenMap.get(id)).filter(Boolean);

  // Correr goldens en paralelo (batches de 3)
  for (let batch = 0; batch < validGoldens.length; batch += 3) {
    const batchGoldens = validGoldens.slice(batch, batch + 3);

    await putItem({
      ...run, status: 'running',
      progress: { current: batch, total: validGoldens.length },
      currentGolden: { goldenId: '', preview: `Verificando ${batch + 1}-${Math.min(batch + 3, validGoldens.length)} de ${validGoldens.length}`, tags: [] },
    });

    const batchResults = await Promise.all(batchGoldens.map(async (golden: any) => {
      try {
        return await replayAndJudge(golden, stableBlock, tenantBlock, catalog, categories, undefined, run.newPrompt);
      } catch (err: any) {
        return {
          goldenId: golden.goldenId,
          preview: golden.preview || '',
          tags: golden.tags || [],
          overallVerdict: 'error',
          error: err.message,
          turnResults: [],
        };
      }
    }));

    results.push(...batchResults);
  }

  const summary = {
    total: results.length,
    passed: results.filter(r => r.overallVerdict === 'pass').length,
    warnings: results.filter(r => r.overallVerdict === 'warning').length,
    failed: results.filter(r => r.overallVerdict === 'failed').length,
    errors: results.filter(r => r.overallVerdict === 'error').length,
  };

  await putItem({
    ...run,
    status: 'completed',
    progress: { current: goldenIds.length, total: goldenIds.length },
    currentGolden: null,
    results,
    summary,
    completedAt: new Date().toISOString(),
  });

  console.log(`[REGRESSION] Run ${runId} completed: ${summary.passed} pass, ${summary.warnings} warn, ${summary.failed} fail`);
}

// ============================================================
// REPLAY + JUDGE (por golden)
// ============================================================

/** Selecciona los 3 turnos más representativos de una conversación */
function pickKeyTurns(turns: any[]): any[] {
  if (turns.length <= 3) return turns;

  // Filtrar turnos triviales (muy cortos o genéricos)
  const trivialPatterns = /^(hola|ok|dale|perfecto|gracias|si|no|bueno|genial|listo|chau|bye)[\s!?.]*$/i;
  const substantive = turns.filter((t: any) =>
    t.userMessage.length > 15 && !trivialPatterns.test(t.userMessage.trim())
  );

  const picked: any[] = [];

  // 1. Primer turno sustancial (arranca la conversación)
  if (substantive.length > 0) picked.push(substantive[0]);

  // 2. Turno del medio (desarrollo)
  if (substantive.length > 2) {
    const midIdx = Math.floor(substantive.length / 2);
    if (!picked.includes(substantive[midIdx])) picked.push(substantive[midIdx]);
  }

  // 3. Último turno sustancial (cierre/conclusión)
  if (substantive.length > 1) {
    const last = substantive[substantive.length - 1];
    if (!picked.includes(last)) picked.push(last);
  }

  // Si no llegamos a 3, completar con los primeros turnos
  for (const t of turns) {
    if (picked.length >= 3) break;
    if (!picked.includes(t)) picked.push(t);
  }

  return picked.slice(0, 3);
}

async function replayAndJudge(
  golden: any, stableBlock: string, tenantBlock: string, catalog: any[], categories: string,
  onProgress?: (turnIdx: number) => Promise<void>,
  changeContext?: string,
): Promise<any> {
  const allTurns = golden.turns || [];
  const turns = pickKeyTurns(allTurns);
  const turnResults: any[] = [];
  let worstSeverity = 'ninguna';
  const severityOrder: Record<string, number> = { ninguna: 0, leve: 1, grave: 2 };

  const newResponses: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (onProgress) await onProgress(i);

    // Historial: TODOS los turnos originales que vinieron ANTES de este turno
    const history: Anthropic.MessageParam[] = [];
    for (const prev of allTurns) {
      if (prev.turnNumber >= turn.turnNumber) break;
      history.push({ role: 'user', content: prev.userMessage });
      history.push({ role: 'assistant', content: prev.botResponse });
    }

    // Buscar productos relevantes para este turno (mismo que hace el bot real)
    const searchResults = searchCatalog(turn.userMessage, catalog);
    const productsBlock = `# PRODUCTOS_DISPONIBLES\n${formatProducts(searchResults)}`;

    const systemPromptBlocks: Anthropic.TextBlockParam[] = [
      { type: 'text', text: stableBlock, cache_control: { type: 'ephemeral' } } as any,
      { type: 'text', text: tenantBlock, cache_control: { type: 'ephemeral' } } as any,
      { type: 'text', text: productsBlock },
    ];

    const msgs: Anthropic.MessageParam[] = [...history, { role: 'user', content: turn.userMessage }];

    let newResponse = '';
    try {
      // Loop de tool use (mismo que el bot real)
      for (let round = 0; round < 3; round++) {
        const res = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPromptBlocks,
          tools: SEARCH_TOOL,
          messages: msgs,
        });

        if (res.stop_reason === 'end_turn') {
          newResponse = res.content.find(b => b.type === 'text')?.text || '(sin respuesta)';
          break;
        }

        if (res.stop_reason === 'tool_use') {
          msgs.push({ role: 'assistant', content: res.content });
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of res.content.filter(b => b.type === 'tool_use')) {
            if (tu.type !== 'tool_use') continue;
            const input = tu.input as { query: string; categoria?: string };
            const found = searchCatalog(input.query, catalog, input.categoria);
            toolResults.push({
              type: 'tool_result', tool_use_id: tu.id,
              content: found.length > 0 ? formatProducts(found) : `No encontre para "${input.query}". Categorias: ${categories}`,
            });
          }
          msgs.push({ role: 'user', content: toolResults });
          continue;
        }

        newResponse = res.content.find(b => b.type === 'text')?.text || '(sin respuesta)';
        break;
      }
      if (!newResponse) newResponse = '(sin respuesta despues de 3 rondas)';
    } catch (err: any) {
      newResponse = '(error: ' + err.message + ')';
    }

    newResponses.push(newResponse);
  }

  // Juzgar todos los turnos en paralelo (batches de 5)
  for (let batch = 0; batch < newResponses.length; batch += 5) {
    const batchPromises = [];
    for (let j = batch; j < Math.min(batch + 5, newResponses.length); j++) {
      batchPromises.push(judgeTurn(turns[j].userMessage, turns[j].botResponse, newResponses[j], changeContext));
    }
    const batchResults = await Promise.all(batchPromises);
    for (let j = 0; j < batchResults.length; j++) {
      const idx = batch + j;
      const judgement = batchResults[j];
      const severity = judgement.severidad_regresion || 'ninguna';
      if ((severityOrder[severity] || 0) > (severityOrder[worstSeverity] || 0)) {
        worstSeverity = severity;
      }
      turnResults.push({
        turnNumber: turns[idx].turnNumber,
        userMessage: turns[idx].userMessage,
        originalResponse: turns[idx].botResponse,
        newResponse: newResponses[idx],
        judgement,
      });
    }
  }

  const overallVerdict = worstSeverity === 'grave' ? 'failed'
    : worstSeverity === 'leve' ? 'warning' : 'pass';

  return {
    goldenId: golden.goldenId,
    preview: golden.preview || '',
    tags: golden.tags || [],
    overallVerdict,
    turnResults,
  };
}

async function judgeTurn(userMessage: string, original: string, newResp: string, changeContext?: string): Promise<any> {
  const fallback = { mejor_o_peor_general: 'igual', severidad_regresion: 'ninguna', razon: '' };

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Comparas respuestas de un bot de ventas por WhatsApp: ORIGINAL vs NUEVA.

El bot tiene acceso a un CATALOGO DE PRODUCTOS REAL con nombres y precios.
Cualquier producto o precio que mencione EXISTE en su catalogo, NO es inventado.

Las respuestas van a ser NATURALMENTE distintas porque son generadas por IA.
Tu trabajo es detectar si hay una REGRESION REAL, no diferencias cosméticas.

${changeContext ? `CONTEXTO DEL CAMBIO: "${changeContext}"\nSolo evaluá si la diferencia está RELACIONADA con este cambio. Si el turno no tiene nada que ver con lo que se cambió, severidad "ninguna".` : ''}

NO es regresion (severidad "ninguna"):
- Mencionar productos distintos → tiene catalogo, son reales
- Precios distintos → los saca del catalogo, son reales
- Responder con mas o menos detalle
- Usar otras palabras para decir lo mismo
- Diferencias de estilo

SI es regresion:
- No responder lo que el cliente pregunto (grave)
- Contradecir las reglas del negocio (grave)
- Cambiar completamente el tono (leve)

En caso de duda → "ninguna".

JSON: {"mejor_o_peor_general":"igual","severidad_regresion":"ninguna","razon":""}`,
      messages: [{ role: 'user', content: `CLIENTE: ${userMessage}\n\nORIGINAL: ${original}\n\nNUEVA: ${newResp}` }],
    });
    const text = res.content.find(b => b.type === 'text')?.text || '{}';
    return { ...fallback, ...JSON.parse(text.replace(/```json|```/g, '').trim()) };
  } catch {
    return fallback;
  }
}

// ============================================================
// HELPERS
// ============================================================

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function syncRulesToBusinessConfig(businessConfig: any, newRules: string): Promise<any> {
  if (!businessConfig || Object.keys(businessConfig).length === 0) return businessConfig;
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `Detecta si las reglas nuevas CONTRADICEN o ACTUALIZAN campos del businessConfig. Devolvé JSON con SOLO los campos que cambiaron. Si nada cambió: {}`,
      messages: [{ role: 'user', content: `CONFIG:\n${JSON.stringify(businessConfig, null, 2)}\n\nREGLAS NUEVAS:\n${newRules}` }],
    });
    const text = res.content.find(b => b.type === 'text')?.text || '{}';
    const updates = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!updates || Object.keys(updates).length === 0) return businessConfig;
    const merged = { ...businessConfig };
    for (const [section, fields] of Object.entries(updates)) {
      if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) {
        merged[section] = { ...(merged[section] || {}), ...(fields as Record<string, any>) };
      } else {
        merged[section] = fields;
      }
    }
    return merged;
  } catch {
    return businessConfig;
  }
}
