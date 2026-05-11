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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const API_LAMBDA_URL = process.env.API_BASE_URL || process.env.API_LAMBDA_URL || '';

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
    if (recentCount >= 3) {
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

  // Cargar agentConfig para buildear el prompt
  const agent = await getItem(keys.agent(tenantId, 'main'));
  const agentConfig = { ...(agent?.agentConfig || {}), extraInstructions: run.newPrompt };
  const systemPrompt = buildPrompt(agentConfig);

  const results: any[] = [];

  for (let i = 0; i < goldenIds.length; i++) {
    const golden = goldenMap.get(goldenIds[i]);
    if (!golden) continue;

    // Actualizar progreso
    await putItem({
      ...run,
      status: 'running',
      progress: { current: i, total: goldenIds.length },
      currentGolden: { goldenId: golden.goldenId, preview: golden.preview || '', tags: golden.tags || [] },
    });

    try {
      const result = await replayAndJudge(golden, systemPrompt);
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

async function replayAndJudge(golden: any, systemPrompt: string): Promise<any> {
  const turns = golden.turns || [];
  const turnResults: any[] = [];
  let worstSeverity = 'ninguna';
  const severityOrder: Record<string, number> = { ninguna: 0, leve: 1, grave: 2 };

  const history: Anthropic.MessageParam[] = [];

  for (const turn of turns) {
    let newResponse = '';
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [...history, { role: 'user', content: turn.userMessage }],
      });
      newResponse = res.content.find(b => b.type === 'text')?.text || '(sin respuesta)';
    } catch {
      newResponse = '(error al generar)';
    }

    const judgement = await judgeTurn(turn.userMessage, turn.botResponse, newResponse);
    const severity = judgement.severidad_regresion || 'ninguna';
    if ((severityOrder[severity] || 0) > (severityOrder[worstSeverity] || 0)) {
      worstSeverity = severity;
    }

    turnResults.push({
      turnNumber: turn.turnNumber,
      userMessage: turn.userMessage,
      originalResponse: turn.botResponse,
      newResponse,
      judgement,
    });

    history.push({ role: 'user', content: turn.userMessage });
    history.push({ role: 'assistant', content: newResponse });
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
Evaluá la NUEVA:
1. tono_consistente (si/no)
2. productos_clave (si/no/parcial/na)
3. formato_precio (si/no/na)
4. intencion_venta (mejor/igual/peor)
5. respeta_reglas (si/no)
6. mejor_o_peor_general (mejor/igual/peor)
Severidad: grave (inventa/rompe), leve (estilo distinto), ninguna (ok)
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

function buildPrompt(agentConfig: any): string {
  const name = agentConfig.assistantName || 'el vendedor';
  const tone = agentConfig.tone || 'casual';
  const welcome = agentConfig.welcomeMessage || '';
  const hours = agentConfig.businessHours || '';
  const promos = agentConfig.promotions || '';
  const extra = agentConfig.extraInstructions || '';

  return `Sos ${name}, vendedor virtual por WhatsApp.
Tono: ${tone}. Argentino, conciso, max 4-5 lineas. Max 1 emoji.
${welcome ? `Saludo: "${welcome}"` : ''}
${hours ? `Horarios: ${hours}` : ''}
${promos ? `Promos: ${promos}` : ''}
${extra ? `\n${extra}` : ''}

REGLAS:
1. SOLO mencionar productos de PRODUCTOS_DISPONIBLES. NUNCA inventar.
2. Precio formateado: $XX.XXX
3. NUNCA mandar al cliente a la web.
4. Si quiere comprar, pedir datos.
5. Si insulta o pide humano: "Te paso con alguien del equipo."`;
}

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
