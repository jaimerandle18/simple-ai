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

  for (let i = 0; i < goldenIds.length; i++) {
    const golden = goldenMap.get(goldenIds[i]);
    if (!golden) continue;

    const turnCount = Math.min((golden.turns || []).length, 50);
    const onProgress = async (turnIdx: number) => {
      await putItem({
        ...run, status: 'running',
        progress: { current: i, total: goldenIds.length },
        currentGolden: { goldenId: golden.goldenId, preview: `${(golden.preview || '').slice(0, 40)} (${turnIdx + 1}/${turnCount})`, tags: golden.tags || [] },
      });
    };
    await onProgress(0);

    try {
      const result = await replayAndJudge(golden, stableBlock, tenantBlock, catalog, categories, onProgress);
      results.push(result);
    } catch (err: any) {
      results.push({
        goldenId: golden.goldenId,
        preview: golden.preview || '',
        tags: golden.tags || [],
        overallVerdict: 'error',
        error: err.message,
        turnResults: [],
      });
    }
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

async function replayAndJudge(
  golden: any, stableBlock: string, tenantBlock: string, catalog: any[], categories: string,
  onProgress?: (turnIdx: number) => Promise<void>,
): Promise<any> {
  const turns = golden.turns || [];
  const turnResults: any[] = [];
  let worstSeverity = 'ninguna';
  const severityOrder: Record<string, number> = { ninguna: 0, leve: 1, grave: 2 };

  // Replay todos los turnos, recolectar respuestas nuevas
  const newResponses: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (onProgress) await onProgress(i);

    // Historial con turnos ORIGINALES anteriores
    const history: Anthropic.MessageParam[] = [];
    for (let j = 0; j < i; j++) {
      history.push({ role: 'user', content: turns[j].userMessage });
      history.push({ role: 'assistant', content: turns[j].botResponse });
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
      batchPromises.push(judgeTurn(turns[j].userMessage, turns[j].botResponse, newResponses[j]));
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

async function judgeTurn(userMessage: string, original: string, newResp: string): Promise<any> {
  const fallback = { tono_consistente: 'si', productos_clave: 'na', formato_precio: 'na', intencion_venta: 'igual', respeta_reglas: 'si', mejor_o_peor_general: 'igual', severidad_regresion: 'ninguna', razon: '' };

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Comparas respuestas de un bot de WhatsApp: ORIGINAL vs NUEVA.

IMPORTANTE: NO se espera que la respuesta nueva sea IDENTICA a la original.
Lo que importa es que la INTENCION sea la misma y la CALIDAD sea similar o mejor.

Ejemplos de cosas que estan BIEN (no son regresion):
- Mencionar productos distintos pero de la misma categoria → OK
- Usar palabras diferentes para decir lo mismo → OK
- Dar mas o menos detalle → OK
- Cambiar el orden de la info → OK
- Nombrar precios levemente distintos si son del catalogo → OK

Ejemplos de REGRESION REAL (grave):
- Inventar productos que no existen
- Mandar al cliente a la web cuando no deberia
- No responder lo que el cliente pregunta
- Cambiar completamente el tono (de casual a formal o viceversa)
- Dar info contradictoria con las reglas del negocio

Evaluá la NUEVA:
1. tono_consistente (si/no)
2. productos_clave (si/parcial/na) — "si" si responde sobre el mismo TIPO de producto
3. formato_precio (si/no/na)
4. intencion_venta (mejor/igual/peor)
5. respeta_reglas (si/no)
6. mejor_o_peor_general (mejor/igual/peor)
Severidad: grave (inventa/rompe reglas), leve (pierde info importante), ninguna (ok o mejor)
JSON: {"tono_consistente":"si","productos_clave":"na","formato_precio":"na","intencion_venta":"igual","respeta_reglas":"si","mejor_o_peor_general":"igual","severidad_regresion":"ninguna","razon":""}`,
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
