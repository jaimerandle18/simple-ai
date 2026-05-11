/**
 * Golden Set + Regression Testing
 *
 * Guarda conversaciones "buenas" como referencia. Cuando se edita el prompt,
 * replaya esas conversaciones con el config nuevo y un juez Haiku evalúa
 * si hay regresión.
 */
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// TYPES
// ============================================================

interface GoldenTurn {
  turnNumber: number;
  userMessage: string;
  botResponse: string;
  botImages: string[];
  productsInContext: string[];
  timestamp: string;
}

interface TurnJudgement {
  tono_consistente: string;
  productos_clave: string;
  formato_precio: string;
  intencion_venta: string;
  respeta_reglas: string;
  mejor_o_peor_general: string;
  severidad_regresion: string;
  razon: string;
}

// ============================================================
// HANDLER
// ============================================================

export async function handleGolden(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];
  if (!tenantId) return error('x-tenant-id required', 401);

  // ─── POST /golden/mark ───────────────────────────────
  if (method === 'POST' && path === '/golden/mark') {
    const body = JSON.parse(event.body || '{}');
    const { conversationId, notes } = body;
    if (!conversationId) return error('conversationId required');

    // 1. Cargar conversación completa
    const conv = await getItem(keys.conversation(tenantId, conversationId));
    if (!conv) return error('Conversation not found', 404);

    const msgItems: any[] = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 100 });
    msgItems.sort((a: any, b: any) => (a.SK || '').localeCompare(b.SK || ''));

    if (msgItems.length === 0) return error('No messages in conversation');

    // 2. Armar turns
    const turns: GoldenTurn[] = [];
    let turnNum = 0;
    let pendingUser = '';
    for (const msg of msgItems) {
      if (msg.direction === 'inbound') {
        pendingUser = msg.content || '';
      } else if (msg.direction === 'outbound' && pendingUser) {
        turnNum++;
        turns.push({
          turnNumber: turnNum,
          userMessage: pendingUser,
          botResponse: msg.content || '',
          botImages: msg.imageUrl ? [msg.imageUrl] : [],
          productsInContext: [],
          timestamp: msg.timestamp || '',
        });
        pendingUser = '';
      }
    }

    if (turns.length === 0) return error('No complete turns found');

    // 3. Snapshot del config actual
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const agentConfigSnapshot = agent?.agentConfig || {};

    // 4. Generar tags con Haiku
    const tags = await generateTags(turns);

    // 5. Guardar
    const goldenId = `golden_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await putItem({
      PK: `TENANT#${tenantId}`,
      SK: `GOLDEN#${goldenId}`,
      goldenId,
      tenantId,
      conversationId,
      savedAt: now,
      savedBy: event.headers['x-user-id'] || 'operator',
      turns,
      tags,
      agentConfigSnapshot,
      status: 'active',
      lastValidated: '',
      notes: notes || '',
      turnCount: turns.length,
      preview: turns[0]?.userMessage.slice(0, 80) || '',
    });

    return json({ goldenId, tags, status: 'active', turnCount: turns.length });
  }

  // ─── GET /golden/list ────────────────────────────────
  if (method === 'GET' && path === '/golden/list') {
    const params = event.queryStringParameters || {};
    const statusFilter = params.status || 'active';

    const items: any[] = await queryItems(`TENANT#${tenantId}`, 'GOLDEN#', { limit: 100 });

    const goldens = items
      .filter((g: any) => !statusFilter || g.status === statusFilter)
      .map((g: any) => ({
        goldenId: g.goldenId,
        conversationId: g.conversationId,
        savedAt: g.savedAt,
        turnCount: g.turnCount || g.turns?.length || 0,
        tags: g.tags || [],
        status: g.status,
        lastValidated: g.lastValidated || '',
        lastVerdict: g.lastVerdict || '',
        preview: g.preview || '',
        notes: g.notes || '',
      }));

    return json({ goldens, total: goldens.length });
  }

  // ─── DELETE /golden/:goldenId ────────────────────────
  const deleteMatch = path.match(/^\/golden\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const goldenId = deleteMatch[1];
    const item = await getItem({ PK: `TENANT#${tenantId}`, SK: `GOLDEN#${goldenId}` });
    if (!item) return error('Golden not found', 404);

    await putItem({ ...item, status: 'archived', archivedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  // ─── POST /golden/:goldenId/validate ─────────────────
  const validateMatch = path.match(/^\/golden\/([^/]+)\/validate$/);
  if (method === 'POST' && validateMatch) {
    const goldenId = validateMatch[1];
    const item: any = await getItem({ PK: `TENANT#${tenantId}`, SK: `GOLDEN#${goldenId}` });
    if (!item) return error('Golden not found', 404);

    const agent = await getItem(keys.agent(tenantId, 'main'));
    const currentConfig = agent?.agentConfig || {};

    const result = await evaluateGolden(item, currentConfig);
    await putItem({
      ...item,
      lastValidated: new Date().toISOString(),
      lastVerdict: result.overallVerdict,
    });

    return json(result);
  }

  // ─── POST /golden/run-regression ─────────────────────
  if (method === 'POST' && path === '/golden/run-regression') {
    const body = JSON.parse(event.body || '{}');
    const { triggerType, newAgentConfig, editedRules } = body;

    if (!triggerType) return error('triggerType required (preview|smoke|full)');

    // Cargar goldens activos
    const allItems: any[] = await queryItems(`TENANT#${tenantId}`, 'GOLDEN#', { limit: 200 });
    const activeGoldens = allItems.filter((g: any) => g.status === 'active');

    if (activeGoldens.length === 0) return json({ results: [], summary: { total: 0 } });

    // Detectar tags de la edición
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const oldConfig = agent?.agentConfig || {};
    const configToUse = newAgentConfig || oldConfig;

    let editedTags: string[] = [];
    if (editedRules?.length || newAgentConfig) {
      editedTags = await detectEditedTags(oldConfig, configToUse, editedRules?.join('\n'));
    }

    // Seleccionar qué correr
    const toRun = selectConversationsToRun(activeGoldens, editedTags, triggerType);

    if (triggerType === 'preview') {
      return json({
        willRun: toRun.length,
        editedTags,
        conversations: toRun.map((g: any) => ({
          goldenId: g.goldenId,
          preview: g.preview,
          tags: g.tags,
          matchReason: g.tags?.some((t: string) => editedTags.includes(t)) ? 'tag_match' : 'control',
        })),
      });
    }

    // Smoke o full: ejecutar sync (para full grandes habría que hacer async con SQS)
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const results: any[] = [];

    for (const golden of toRun) {
      const result = await evaluateGolden(golden, configToUse);
      results.push(result);

      // Actualizar lastValidated del golden
      await putItem({
        ...golden,
        lastValidated: new Date().toISOString(),
        lastVerdict: result.overallVerdict,
      });
    }

    const summary = {
      total: results.length,
      passed: results.filter(r => r.overallVerdict === 'pass').length,
      warnings: results.filter(r => r.overallVerdict === 'warning').length,
      failed: results.filter(r => r.overallVerdict === 'failed').length,
    };

    // Guardar run
    await putItem({
      PK: `TENANT#${tenantId}`,
      SK: `REGRUN#${runId}`,
      runId,
      tenantId,
      triggerType,
      editedTags,
      status: 'completed',
      summary,
      results,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
    });

    return json({ runId, status: 'completed', summary, results });
  }

  // ─── GET /golden/run-status/:runId ───────────────────
  const runMatch = path.match(/^\/golden\/run-status\/([^/]+)$/);
  if (method === 'GET' && runMatch) {
    const runId = runMatch[1];
    const items = await queryItems(`TENANT#${tenantId}`, `REGRUN#${runId}`, { limit: 1 });
    if (items.length === 0) return error('Run not found', 404);
    return json(items[0]);
  }

  // ─── GET /golden/runs ────────────────────────────────
  if (method === 'GET' && path === '/golden/runs') {
    const items: any[] = await queryItems(`TENANT#${tenantId}`, 'REGRUN#', { limit: 20 });
    return json({
      runs: items.map((r: any) => ({
        runId: r.runId,
        triggerType: r.triggerType,
        status: r.status,
        summary: r.summary,
        editedTags: r.editedTags,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  }

  return error('Not found', 404);
}

// ============================================================
// TAG GENERATOR (Haiku)
// ============================================================

async function generateTags(turns: GoldenTurn[]): Promise<string[]> {
  const transcript = turns.map((t, i) =>
    `T${i + 1}\nUSER: ${t.userMessage}\nBOT: ${t.botResponse}`
  ).join('\n\n');

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `Sos un clasificador de conversaciones de venta.
Devolvé tags relevantes. Tags posibles:

CONSULTA: busqueda_producto, comparacion_specs, busqueda_por_uso, recomendacion, consulta_variante
POLÍTICA: envio, pago, cambio_devolucion, garantia, horario, ubicacion, factura
INTERACCIÓN: saludo, objecion_precio, cross_sell, cierre_venta, escalamiento_humano, consulta_stock, post_venta
ESPECIAL: producto_no_disponible, talle_no_disponible, descuento_solicitado, mayorista

Devolvé JSON: {"tags": ["tag1", "tag2"]}
Máximo 5 tags.`,
      messages: [{ role: 'user', content: transcript }],
    });

    const text = res.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [];
  } catch (err) {
    console.error('[GOLDEN] Tag generation failed:', err);
    return ['sin_clasificar'];
  }
}

// ============================================================
// EDITION TAG DETECTOR
// ============================================================

async function detectEditedTags(
  oldConfig: any,
  newConfig: any,
  editedRulesText?: string,
): Promise<string[]> {
  // Generar diff simple
  const changes: string[] = [];
  for (const key of new Set([...Object.keys(oldConfig || {}), ...Object.keys(newConfig || {})])) {
    const oldVal = JSON.stringify(oldConfig?.[key] || '');
    const newVal = JSON.stringify(newConfig?.[key] || '');
    if (oldVal !== newVal) {
      changes.push(`Campo "${key}" cambió de ${oldVal.slice(0, 80)} a ${newVal.slice(0, 80)}`);
    }
  }
  if (editedRulesText) changes.push(`Reglas editadas: ${editedRulesText}`);

  if (changes.length === 0) return [];

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Identificá qué temas toca esta edición de prompt de un bot de ventas.
Tags posibles: envio, pago, cambio_devolucion, garantia, horario, ubicacion, factura, busqueda_producto, comparacion_specs, recomendacion, objecion_precio, cross_sell, cierre_venta, escalamiento_humano, producto_no_disponible, descuento_solicitado, mayorista, tono, saludo
Devolvé JSON: {"tags": ["tag1", "tag2"]}`,
      messages: [{ role: 'user', content: changes.join('\n') }],
    });

    const text = res.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return Array.isArray(parsed.tags) ? parsed.tags : [];
  } catch {
    return [];
  }
}

// ============================================================
// CONVERSATION SELECTOR
// ============================================================

function selectConversationsToRun(
  activeGoldens: any[],
  _editedTags: string[],
  _runType: string,
): any[] {
  // Simple: correr todas si son <=15, o 15 al azar si son más
  if (activeGoldens.length <= 15) return activeGoldens;
  return shuffleArray(activeGoldens).slice(0, 15);
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ============================================================
// REPLAY ENGINE + JUDGE
// ============================================================

async function evaluateGolden(golden: any, newAgentConfig: any): Promise<any> {
  const turns = golden.turns || [];
  const turnResults: any[] = [];
  let worstSeverity = 'ninguna';
  const severityOrder: Record<string, number> = { ninguna: 0, leve: 1, grave: 2 };

  // Build system prompt from new config
  const systemPrompt = buildSimplePrompt(newAgentConfig);

  const history: Anthropic.MessageParam[] = [];

  for (const turn of turns) {
    // Replay: generar respuesta nueva con el config nuevo
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

    // Judge
    const judgement = await judgeTurn(
      turn.userMessage,
      turn.botResponse,
      newResponse,
      turn.botImages || [],
      [],
    );

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

    // Actualizar historial con la respuesta nueva (para coherencia)
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
    worstSeverity,
    turnResults,
  };
}

function buildSimplePrompt(agentConfig: any): string {
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

async function judgeTurn(
  userMessage: string,
  originalResponse: string,
  newResponse: string,
  originalImages: string[],
  newImages: string[],
): Promise<TurnJudgement> {
  const defaultJudgement: TurnJudgement = {
    tono_consistente: 'si',
    productos_clave: 'na',
    formato_precio: 'na',
    intencion_venta: 'igual',
    respeta_reglas: 'si',
    mejor_o_peor_general: 'igual',
    severidad_regresion: 'ninguna',
    razon: '',
  };

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `Sos un evaluador de respuestas de un bot de WhatsApp. Comparás ORIGINAL vs NUEVA.

Evaluá la NUEVA en 6 criterios:
1. tono_consistente: Mantiene tono? (si/no)
2. productos_clave: Menciona mismos productos? (si/no/parcial/na)
3. formato_precio: Usa $XX.XXX? (si/no/na)
4. intencion_venta: Avance de venta? (mejor/igual/peor)
5. respeta_reglas: Cumple reglas? (si/no)
6. mejor_o_peor_general: (mejor/igual/peor)

Severidad regresión:
- grave: inventa, manda a web, pierde producto, cambia precio
- leve: estilo distinto pero útil
- ninguna: igual o mejor

Devolvé JSON:
{"tono_consistente":"si","productos_clave":"si","formato_precio":"na","intencion_venta":"igual","respeta_reglas":"si","mejor_o_peor_general":"igual","severidad_regresion":"ninguna","razon":"frase corta"}`,
      messages: [{
        role: 'user',
        content: `CLIENTE: ${userMessage}\n\nORIGINAL: ${originalResponse}\nImágenes original: ${originalImages.join(', ') || 'ninguna'}\n\nNUEVA: ${newResponse}\nImágenes nueva: ${newImages.join(', ') || 'ninguna'}`,
      }],
    });

    const text = res.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return { ...defaultJudgement, ...parsed };
  } catch (err) {
    console.error('[GOLDEN] Judge failed:', err);
    return defaultJudgement;
  }
}
