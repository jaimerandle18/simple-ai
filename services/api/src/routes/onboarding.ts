/**
 * Onboarding Agent: chat conversacional que construye el BusinessConfig.
 */
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem } from '../lib/dynamo';
import { json, error } from '../lib/response';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SECTION_ORDER = ['business', 'bot_persona', 'horarios', 'pago', 'envio', 'politicas', 'promos', 'escalamiento'] as const;

const SECTION_LABELS: Record<string, string> = {
  business: 'Negocio', bot_persona: 'Persona del bot', horarios: 'Horarios',
  pago: 'Medios de pago', envio: 'Envios', politicas: 'Politicas',
  promos: 'Promociones', escalamiento: 'Escalamiento',
};

// ============================================================
// AUTO-DETECT COMPLETED SECTIONS
// ============================================================
function getCompletedSections(config: any): string[] {
  const completed: string[] = [];
  const b = config.business;
  // business: nombre + al menos 2 campos más (Haiku puede usar rubro, tipo_productos, descripcion_corta, etc.)
  if (b?.nombre) {
    const filledFields = Object.keys(b).filter(k => b[k] && k !== 'nombre').length;
    if (filledFields >= 2) completed.push('business');
  }
  // bot_persona: nombre + tono
  const bp = config.bot_persona;
  if (bp?.nombre && bp?.tono) completed.push('bot_persona');
  // horarios: al menos un campo
  const h = config.horarios;
  if (h && Object.keys(h).some(k => h[k])) completed.push('horarios');
  // pago: al menos metodos
  const p = config.pago;
  if (p && (p.metodos || Object.keys(p).some(k => p[k]))) completed.push('pago');
  // envio: cualquier dato
  const e = config.envio;
  if (e && (Array.isArray(e) ? e.length > 0 : Object.keys(e).some(k => e[k]))) completed.push('envio');
  // politicas: cualquier campo
  const pol = config.politicas;
  if (pol && Object.keys(pol).some(k => pol[k])) completed.push('politicas');
  // promos: definido (puede ser array vacío = "no tiene promos")
  if (config.promos_vigentes !== undefined) completed.push('promos');
  // escalamiento: cualquier campo
  const esc = config.escalamiento;
  if (esc && Object.keys(esc).some(k => esc[k])) completed.push('escalamiento');
  return completed;
}

function getCurrentSection(completed: string[]): string | null {
  for (const s of SECTION_ORDER) {
    if (!completed.includes(s)) return s;
  }
  return null;
}

// ============================================================
// SYSTEM PROMPT (base, sin estado)
// ============================================================
const BASE_SYSTEM = `Sos un asistente de configuracion para Simple AI, una plataforma que crea agentes IA de ventas para WhatsApp.
Tu trabajo es hacerle preguntas al dueño del negocio hasta tener TODA la info para armar un agente que funcione solo.

# COMO FUNCIONAR
- Hace preguntas de a una o dos. Espera la respuesta antes de avanzar.
- Se amigable y eficiente. Argentino casual. Sin signos de apertura.
- Cuando el usuario responda, usa save_section para guardar TODOS los datos de una seccion de una vez (un solo tool call por seccion). Solo usa update_config para correcciones puntuales de un campo.
- SIEMPRE termina tu turno con texto para el usuario. Nunca te quedes solo con tool calls.
- Si el usuario dice "no se", "no tengo", "no aplica" → guarda "no aplica" y avanza.
- Si dice "nada mas", "listo", "eso es todo" → hace un resumen de lo configurado y despedite.
- VARIA tus respuestas. No repitas la misma frase dos veces.

# SECCIONES (en este orden)

## 1. NEGOCIO (business)
- Nombre del negocio
- Que vende (tipo de productos/servicios)
- Ubicacion (ciudad, provincia, direccion si tiene local fisico)
- Sitio web
- Redes sociales (Instagram, etc.)
- Publico objetivo (edad, genero, estilo)

## 2. AGENTE IA(bot_persona)
- Nombre del agente (sugerir uno si no se le ocurre)
- Tono: casual, formal, amigable, vendedor
- Usa emojis? (sugerir max 1 por mensaje)
- Mensaje de bienvenida (ayudalo a armarlo)
- Max lineas por respuesta (sugerir 4-5)

## 3. HORARIOS (horarios)
- Lunes a viernes
- Sabados
- Domingos y feriados
- Que hace el bot fuera de horario

## 4. MEDIOS DE PAGO (pago)
- Metodos: efectivo, transferencia, tarjeta, MercadoPago
- Descuentos por metodo
- Cuotas sin interes
- Link de pago

## 5. ENVIOS (envio)
- Hace envios? A donde?
- Servicio (Correo, Andreani, moto, etc.)
- Tiempo de entrega
- Costo / envio gratis desde X
- Retiro en local

## 6. POLITICAS (politicas)
- Cambios: plazo, condiciones
- Devoluciones: plazo
- Garantia
- Quien paga envio del cambio

## 7. PROMOCIONES (promos_vigentes)
- Promos activas, vigencia, condiciones
- Si no tiene, guardar array vacio y avanzar

## 8. ESCALAMIENTO (escalamiento)
- Cuando pasar a humano (quejas, tecnico, etc.)
- Quien atiende, en que horario
- Contacto del humano`;

// ============================================================
// TOOLS
// ============================================================
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'save_section',
    description: 'Guarda todos los datos de una seccion de una vez. PREFERIR esta tool sobre update_config cuando tengas varios datos de la misma seccion. Automaticamente marca la seccion como completa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        section: { type: 'string', description: 'Nombre de la seccion: business, bot_persona, horarios, pago, envio, politicas, promos_vigentes, escalamiento' },
        data: { type: 'object', description: 'Objeto con todos los campos de la seccion. Ej para envio: { zonas: "todo el pais", servicio: "Southpost", tiempo_estimado: "2-7 dias", gratis_desde: 150000, retiro_local: "si, en Martinez" }' },
      },
      required: ['section', 'data'],
    },
  },
  {
    name: 'update_config',
    description: 'Guarda UN campo individual. Usar solo para campos sueltos o correcciones puntuales.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Ruta: "business.nombre", "bot_persona.tono"' },
        value: { description: 'Valor a guardar.' },
      },
      required: ['path', 'value'],
    },
  },
  {
    name: 'add_rule',
    description: 'Agrega una regla de negocio. Usalo cuando el usuario menciona algo especifico que el bot debe saber (ej: "siempre incluir costo de envio", "nunca prometer stock", "si preguntan por reparacion, decir que pasen por el local").',
    input_schema: {
      type: 'object' as const,
      properties: {
        texto: { type: 'string', description: 'El texto de la regla de negocio' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags: pago, envio, garantia, tono, producto, atencion' },
      },
      required: ['texto'],
    },
  },
  {
    name: 'suggest_field',
    description: 'Sugeri un valor al usuario cuando podes inferirlo del contexto. NO guardas, solo propones. El usuario confirma o corrige.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Campo a sugerir: "bot_persona.saludo_inicial"' },
        suggested_value: { description: 'Valor sugerido' },
        reason: { type: 'string', description: 'Breve explicacion de por que sugeris esto' },
      },
      required: ['path', 'suggested_value'],
    },
  },
];

// ============================================================
// HELPERS
// ============================================================
function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

// Genérico: vuelca TODOS los fields de una sección sin depender de keys exactos
function dumpSection(obj: any): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const label = k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
      const val = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${label}: ${val}`;
    });
}

function configToDocument(config: any): string {
  const sections: string[] = [];

  const addSection = (key: string, title: string) => {
    const data = config[key];
    if (!data) return;
    // Arrays (envio, promos)
    if (Array.isArray(data)) {
      if (data.length === 0) return;
      const lines = data.map((item: any) => {
        if (typeof item === 'string') return `- ${item}`;
        if (item.texto) return `- ${item.texto}${item.vigencia ? ` (hasta ${item.vigencia})` : ''}`;
        return dumpSection(item).map(l => `- ${l}`).join('\n');
      });
      sections.push(`${title}\n${lines.join('\n')}`);
      return;
    }
    const parts = dumpSection(data);
    if (parts.length) sections.push(`${title}\n${parts.join('\n')}`);
  };

  addSection('business', 'NEGOCIO');
  addSection('bot_persona', 'AGENTE IA');
  addSection('horarios', 'HORARIOS');
  addSection('pago', 'PAGOS');
  addSection('envio', 'ENVIOS');
  addSection('politicas', 'POLITICAS');
  addSection('promos_vigentes', 'PROMOS');
  addSection('escalamiento', 'ESCALAMIENTO');

  if (config.reglas_negocio?.length > 0) {
    sections.push('REGLAS DE NEGOCIO\n' + config.reglas_negocio
      .filter((r: any) => r.activa !== false)
      .map((r: any, i: number) => `${i + 1}. ${r.texto}`)
      .join('\n'));
  }

  if (config.faq_libre) sections.push('INFO ADICIONAL\n' + config.faq_libre);
  return sections.join('\n\n');
}

function buildStateContext(config: any, completedSections: string[]): string {
  const completed = getCompletedSections(config);
  // Merge auto-detected + manually marked
  for (const s of completedSections) { if (!completed.includes(s)) completed.push(s); }
  const current = getCurrentSection(completed);
  const pending = SECTION_ORDER.filter(s => !completed.includes(s) && s !== current);

  if (!current) {
    return `\n\n# ESTADO
TODAS las secciones estan completas. Ofrece revisar el documento o cerrar el onboarding.
CONFIG: ${JSON.stringify(config, null, 2)}`;
  }

  return `\n\n# ESTADO
Secciones completas: ${completed.map(s => SECTION_LABELS[s]).join(', ') || 'ninguna'}
SECCION ACTUAL: ${SECTION_LABELS[current]} (${current})
Pendientes despues: ${pending.map(s => SECTION_LABELS[s]).join(', ') || 'ninguna'}

Trabaja SOLO en la seccion "${SECTION_LABELS[current]}". Cuando tengas los datos minimos, usa mark_section_complete("${current}") y pasa a la siguiente.
NO vuelvas a preguntar sobre secciones ya completas.

CONFIG ACTUAL:
${JSON.stringify(config, null, 2)}`;
}

// ============================================================
// HANDLER
// ============================================================
export async function handleOnboarding(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];
  if (!tenantId) return error('x-tenant-id required', 401);

  // GET /onboarding/config
  if (method === 'GET' && path === '/onboarding/config') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const businessConfig = agent?.businessConfig || {};
    const completed = getCompletedSections(businessConfig);
    const chatHistory = agent?.onboardingHistory || [];
    const document = configToDocument(businessConfig);
    return json({ businessConfig, completedSections: completed, document, chatHistory });
  }

  // POST /onboarding/chat
  if (method === 'POST' && path === '/onboarding/chat') {
    const body = JSON.parse(event.body || '{}');
    const { message, history } = body;
    if (!message) return error('message is required');

    let agent = await getItem(keys.agent(tenantId, 'main'));
    let updatedConfig = { ...(agent?.businessConfig || {}) };
    let updatedSections: string[] = getCompletedSections(updatedConfig);

    const historyMsgs = (history || []) as { role: string; content: string }[];

    // Build Anthropic messages — only last 10 messages to avoid token bloat
    const recentHistory = historyMsgs.slice(-10);
    const msgs: Anthropic.MessageParam[] = [];
    for (const m of recentHistory) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (msgs.length > 0 && msgs[msgs.length - 1].role === role) {
        msgs[msgs.length - 1].content += '\n' + m.content;
      } else {
        msgs.push({ role, content: m.content });
      }
    }
    if (msgs.length > 0 && msgs[0].role === 'assistant') msgs.shift();
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') {
      msgs.push({ role: 'user', content: message });
    }

    try {
      const toolCallCounts = new Map<string, number>();

      // Tool use loop with early termination
      for (let round = 0; round < 15; round++) {
        updatedSections = getCompletedSections(updatedConfig);
        const stateContext = buildStateContext(updatedConfig, updatedSections);
        const currentSec = getCurrentSection(updatedSections);
        console.log(`[ONBOARDING r${round}] completed=[${updatedSections}] current=${currentSec} msg="${message.slice(0, 50)}"`);

        const res = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: BASE_SYSTEM + stateContext,
          tools: TOOLS,
          messages: msgs,
        });

        // Extract text from ANY response (even tool_use can have text blocks)
        const textBlock = res.content.find(b => b.type === 'text');

        if (res.stop_reason === 'end_turn') {
          const reply = textBlock?.text || await generateDynamicResponse(updatedConfig, updatedSections, msgs);
          console.log(`[ONBOARDING] end_turn reply: "${reply.slice(0, 100)}"`);
          return await saveAndReturn(agent, updatedConfig, updatedSections, historyMsgs, message, reply, tenantId);
        }

        if (res.stop_reason === 'tool_use') {
          msgs.push({ role: 'assistant', content: res.content });
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          let shouldBreak = false;

          for (const tu of res.content.filter(b => b.type === 'tool_use')) {
            if (tu.type !== 'tool_use') continue;

            // Early termination: same tool called too many times
            const count = (toolCallCounts.get(tu.name) || 0) + 1;
            toolCallCounts.set(tu.name, count);
            if (count > 4) {
              console.warn(`[ONBOARDING] Tool ${tu.name} called ${count} times, breaking loop`);
              shouldBreak = true;
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'OK. Ahora responde al usuario con texto, no llames mas tools.' });
              continue;
            }

            if (tu.name === 'save_section') {
              const input = tu.input as { section: string; data: any };
              updatedConfig[input.section] = { ...(updatedConfig[input.section] || {}), ...input.data };
              if (!updatedSections.includes(input.section)) updatedSections.push(input.section);
              const next = getCurrentSection(getCompletedSections(updatedConfig));
              console.log(`[ONBOARDING] save_section: ${input.section} (${Object.keys(input.data).length} fields) → next: ${next}`);
              // Persist immediately after each save to not lose data
              if (agent) {
                agent = { ...agent, businessConfig: updatedConfig, completedSections: getCompletedSections(updatedConfig), updatedAt: new Date().toISOString() };
                await putItem(agent);
              }
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `OK: seccion "${SECTION_LABELS[input.section] || input.section}" guardada completa. Siguiente: ${next ? SECTION_LABELS[next] : 'todo listo!'}` });
            } else if (tu.name === 'update_config') {
              const input = tu.input as { path: string; value: any };
              setNestedValue(updatedConfig, input.path, input.value);
              console.log(`[ONBOARDING] update_config: ${input.path} = ${JSON.stringify(input.value).slice(0, 60)}`);
              if (agent) {
                agent = { ...agent, businessConfig: updatedConfig, completedSections: getCompletedSections(updatedConfig), updatedAt: new Date().toISOString() };
                await putItem(agent);
              }
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `OK: ${input.path} guardado` });
            } else if (tu.name === 'add_rule') {
              const input = tu.input as { texto: string; tags?: string[] };
              if (!updatedConfig.reglas_negocio) updatedConfig.reglas_negocio = [];
              const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              updatedConfig.reglas_negocio.push({ id: ruleId, texto: input.texto, tags: input.tags || [], activa: true });
              console.log(`[ONBOARDING] add_rule: "${input.texto.slice(0, 60)}"`);
              if (agent) {
                agent = { ...agent, businessConfig: updatedConfig, updatedAt: new Date().toISOString() };
                await putItem(agent);
              }
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `OK: regla agregada (${updatedConfig.reglas_negocio.length} reglas total)` });
            } else if (tu.name === 'suggest_field') {
              const input = tu.input as { path: string; suggested_value: any; reason?: string };
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Sugerencia registrada. Presentale al usuario: "${input.path}" = ${JSON.stringify(input.suggested_value)}${input.reason ? ` (${input.reason})` : ''}. Si confirma, usa update_config para guardar.` });
            }
          }

          msgs.push({ role: 'user', content: toolResults });

          if (shouldBreak) {
            // One more round without tools to force text output
            const forceTextRes = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 300,
              system: BASE_SYSTEM + buildStateContext(updatedConfig, getCompletedSections(updatedConfig)),
              messages: msgs,
            });
            const forceText = forceTextRes.content.find(b => b.type === 'text');
            const reply = forceText?.text || await generateDynamicResponse(updatedConfig, updatedSections, msgs);
            return await saveAndReturn(agent, updatedConfig, updatedSections, historyMsgs, message, reply, tenantId);
          }

          continue;
        }

        break;
      }

      // Loop exhausted — generate dynamic response (NO hardcoded text)
      console.log(`[ONBOARDING] Loop exhausted, generating dynamic response`);
      const reply = await generateDynamicResponse(updatedConfig, updatedSections, msgs);
      return await saveAndReturn(agent, updatedConfig, updatedSections, historyMsgs, message, reply, tenantId);

    } catch (err: any) {
      console.error('Onboarding error:', err);
      return error('Error: ' + err.message, 500);
    }
  }

  // POST /onboarding/preview-prompt — genera el system prompt real que usaría el bot
  if (method === 'POST' && path === '/onboarding/preview-prompt') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config = agent?.businessConfig || {};
    const agentConfig = agent?.agentConfig || {};
    const prompt = buildSystemPromptPreview(config, agentConfig);
    return json({ prompt });
  }

  // POST /onboarding/test-bot — simula mensajes típicos con el config actual
  if (method === 'POST' && path === '/onboarding/test-bot') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config = agent?.businessConfig || {};
    const agentConfig = agent?.agentConfig || {};
    const rubro = config.business?.rubro || config.business?.tipo_productos || 'comercio';

    // Mensajes de prueba por rubro
    const testMessages = getTestMessages(rubro);
    const systemPrompt = buildSystemPromptPreview(config, agentConfig);

    const results: Array<{ input: string; output: string }> = [];
    for (const testMsg of testMessages.slice(0, 4)) {
      try {
        const res = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: 'user', content: testMsg }],
        });
        const text = res.content.find(b => b.type === 'text')?.text || '(sin respuesta)';
        results.push({ input: testMsg, output: text });
      } catch {
        results.push({ input: testMsg, output: '(error al generar respuesta)' });
      }
    }
    return json({ results, systemPrompt });
  }

  // POST /onboarding/commit — marca config como production-ready
  if (method === 'POST' && path === '/onboarding/commit') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found', 404);

    const config = agent.businessConfig || {};
    const completed = getCompletedSections(config);

    // Sync final a agentConfig
    await syncToAgentConfig(tenantId, config, agent);

    // Marcar como committed
    await putItem({
      ...agent,
      businessConfig: { ...config, meta: { ...((config as any).meta || {}), committed: true, committedAt: new Date().toISOString(), version: (((config as any).meta?.version) || 0) + 1 } },
      updatedAt: new Date().toISOString(),
    });

    return json({ ok: true, completedSections: completed, version: (((config as any).meta?.version) || 0) + 1 });
  }

  return error('Not found', 404);
}

/**
 * Genera una respuesta dinámica cuando Haiku no devolvió texto.
 * Pregunta algo concreto sobre la sección actual. CERO texto hardcoded.
 */
async function generateDynamicResponse(
  config: any, sections: string[], msgs: Anthropic.MessageParam[],
): Promise<string> {
  const completed = getCompletedSections(config);
  const current = getCurrentSection(completed);

  // Intentar una última llamada a Haiku SIN tools
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: BASE_SYSTEM + buildStateContext(config, completed)
        + '\n\nINSTRUCCION: Responde SOLO con texto, sin usar tools. Hace una pregunta concreta sobre la seccion actual.',
      messages: msgs,
    });
    const text = res.content.find(b => b.type === 'text');
    if (text?.text && text.text.trim().length > 5) return text.text;
  } catch { /* ignore, use dynamic below */ }

  // Último recurso: pregunta específica por sección (generada por código, no hardcoded genérico)
  if (!current) return 'Ya tenemos todo configurado! Tu agente esta listo para funcionar.';

  const b = config.business || {};
  const bp = config.bot_persona || {};

  // Haiku puede usar nombres de campo variados, checkear múltiples variantes
  const hasWeb = b.sitio_web || b.web || b.website;
  const hasRedes = b.redes || b.redes_sociales || b.instagram;
  const hasPublico = b.publico_objetivo || b.publico || b.target;
  const hasSaludo = bp.saludo_inicial || bp.mensaje_bienvenida || bp.bienvenida || bp.saludo;

  const questions: Record<string, string> = {
    business: !b.nombre ? 'Como se llama tu negocio?'
      : !b.ubicacion ? 'Donde estan ubicados?'
      : !hasWeb && !hasRedes ? 'Tienen sitio web o redes sociales?'
      : !hasPublico ? 'A que publico le venden?'
      : 'Contame algo mas sobre el negocio o pasamos a configurar el bot?',
    bot_persona: !bp.nombre ? 'Que nombre le ponemos al agente de ventas?'
      : !bp.tono ? 'Que tono queres que tenga? Casual, formal, amigable...'
      : !hasSaludo ? 'Como queres que salude cuando alguien escribe por primera vez?'
      : 'Algo mas sobre como habla el bot o seguimos con los horarios?',
    horarios: 'Cuales son los horarios de atencion? Lunes a viernes, sabados, domingos...',
    pago: 'Que medios de pago aceptan? Transferencia, tarjeta, efectivo, MercadoPago...',
    envio: 'Hacen envios? A que zonas? Tienen envio gratis?',
    politicas: 'Aceptan cambios o devoluciones? Con que plazo y condiciones?',
    promos: 'Tienen alguna promo o descuento activo?',
    escalamiento: 'En que situaciones queres que el bot pase la conversacion a un humano?',
  };

  return questions[current] || 'Seguimos configurando?';
}

async function saveAndReturn(
  agent: any, config: any, sections: string[],
  historyMsgs: { role: string; content: string }[],
  message: string, reply: string, tenantId: string,
) {
  const completedSections = getCompletedSections(config);
  const updatedHistory = [...historyMsgs, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-40);

  if (agent) {
    const now = new Date().toISOString();
    await putItem({
      ...agent,
      businessConfig: config,
      completedSections,
      onboardingHistory: updatedHistory,
      lastConfigChange: now,
      updatedAt: now,
    });
  }
  await syncToAgentConfig(tenantId, config, agent);

  const document = configToDocument(config);
  return json({ reply, businessConfig: config, completedSections, document });
}

// ============================================================
// PREVIEW: system prompt real que usaría el bot de ventas
// ============================================================
function buildSystemPromptPreview(config: any, agentConfig: any): string {
  const bp = config.bot_persona || {};
  const b = config.business || {};
  const name = bp.nombre || agentConfig.assistantName || 'el vendedor';
  const saludo = bp.saludo_inicial || bp.mensaje_bienvenida || bp.saludo || '';
  const web = b.sitio_web || b.web || '';

  let prompt = `Sos ${name}, vendedor virtual por WhatsApp de ${b.nombre || 'el negocio'}`;
  if (b.rubro || b.tipo_productos) prompt += `, un negocio de ${b.rubro || b.tipo_productos}`;
  prompt += '.\n\n';

  // Tono
  prompt += '# TONO\n';
  const tono = bp.tono || 'casual';
  if (tono === 'casual' || tono === 'argentino_casual') {
    prompt += 'Argentino casual, vos, conciso. Max 1 emoji. WhatsApp real, corto. Maximo 4-5 lineas.\n';
  } else if (tono === 'formal' || tono === 'argentino_formal') {
    prompt += 'Argentino formal, usted, profesional. Sin emojis. Maximo 4-5 lineas.\n';
  } else {
    prompt += `Tono: ${tono}. Maximo ${bp.max_lineas || 5} lineas.\n`;
  }
  prompt += 'NUNCA uses signos de apertura. Solo usa los de cierre (! ?).\n\n';

  // Reglas de negocio
  if (config.reglas_negocio?.length > 0) {
    prompt += '# REGLAS DEL NEGOCIO\n';
    config.reglas_negocio.filter((r: any) => r.activa !== false).forEach((r: any, i: number) => {
      prompt += `${i + 1}. ${r.texto}\n`;
    });
    prompt += '\n';
  }

  // Info general
  prompt += '# INFORMACION GENERAL\n';
  if (b.ubicacion) prompt += `Ubicacion: ${b.ubicacion}\n`;
  if (web) prompt += `Web: ${web}\n`;
  if (saludo) prompt += `Mensaje de bienvenida: "${saludo}"\n`;

  // Secciones genéricas: volcar TODOS los campos que Haiku haya guardado
  // (Haiku usa keys variados: lunes_viernes, lunes_a_viernes, lun_vie, etc.)
  const sectionDump = (obj: any, title: string) => {
    if (!obj || typeof obj !== 'object') return;
    const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return;
    prompt += `\n${title}:\n`;
    for (const [k, v] of entries) {
      const label = k.replace(/_/g, ' ');
      const val = Array.isArray(v) ? v.join(', ') : String(v);
      prompt += `- ${label}: ${val}\n`;
    }
  };

  sectionDump(config.horarios, 'Horarios');
  sectionDump(typeof config.pago === 'object' ? config.pago : undefined, 'Pagos');

  if (config.envio) {
    const e = Array.isArray(config.envio) ? config.envio[0] : config.envio;
    sectionDump(e, 'Envios');
  }

  sectionDump(config.politicas, 'Politicas');

  if (config.promos_vigentes?.length > 0) {
    prompt += '\nPromos vigentes:\n';
    config.promos_vigentes.forEach((p: any) => {
      prompt += `- ${typeof p === 'string' ? p : p.texto || JSON.stringify(p)}${p.vigencia ? ` (hasta ${p.vigencia})` : ''}\n`;
    });
  }

  sectionDump(config.escalamiento, 'Escalamiento');

  prompt += `\n# REGLAS UNIVERSALES
1. SOLO mencionar productos de PRODUCTOS_DISPONIBLES. NUNCA inventar.
2. NUNCA mandar al cliente a la web.
3. Precio formateado: $XX.XXX
4. Las fotos se envian automaticamente.
5. Si el cliente quiere comprar, pedir datos.
6. Si insulta o pide humano: "Te paso con alguien del equipo."`;

  return prompt;
}

function getTestMessages(rubro: string): string[] {
  const rubroLower = rubro.toLowerCase();

  if (rubroLower.includes('ferret') || rubroLower.includes('herramienta')) {
    return ['tenes amoladoras?', 'hacen envios a Cordoba?', 'puedo pagar en cuotas?', 'tienen taller para reparaciones?'];
  }
  if (rubroLower.includes('ropa') || rubroLower.includes('indumentaria') || rubroLower.includes('textil')) {
    return ['tenes una remera negra?', 'en talle M la tenes?', 'hacen cambios?', 'puedo pagar por transferencia?'];
  }
  if (rubroLower.includes('comida') || rubroLower.includes('gastro') || rubroLower.includes('restaurant')) {
    return ['que tienen para comer?', 'hacen delivery?', 'aceptan mercadopago?', 'hasta que hora estan?'];
  }
  // Default
  return ['hola, que venden?', 'hacen envios?', 'que medios de pago aceptan?', 'en que horario atienden?'];
}

async function syncToAgentConfig(tenantId: string, config: any, _agent: any) {
  // Re-read agent from DynamoDB to avoid overwriting businessConfig/onboardingHistory
  const agent = await getItem(keys.agent(tenantId, 'main'));
  if (!agent) return;
  const cfg = agent.agentConfig || {};

  const bp = config.bot_persona || {};
  if (bp.nombre) cfg.assistantName = bp.nombre;
  if (bp.tono) cfg.tone = bp.tono;
  // Haiku puede guardar el saludo como saludo_inicial, mensaje_bienvenida, bienvenida, saludo, etc.
  const saludo = bp.saludo_inicial || bp.mensaje_bienvenida || bp.bienvenida || bp.saludo;
  if (saludo) cfg.welcomeMessage = saludo;

  const b = config.business || {};
  // Haiku puede guardar la web como sitio_web, web, website, url
  const web = b.sitio_web || b.web || b.website || b.url;
  if (web) cfg.websiteUrl = web;
  if (config.horarios && typeof config.horarios === 'object') {
    // Volcar todos los campos de horarios (Haiku usa keys variados)
    const h = config.horarios;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(h)) {
      if (!v) continue;
      const label = k.replace(/_/g, ' ');
      parts.push(`${label}: ${v}`);
    }
    if (parts.length > 0) cfg.businessHours = parts.join('. ');
  }
  if (config.promos_vigentes?.length) cfg.promotions = config.promos_vigentes.map((p: any) => p.texto).join('. ');
  const parts: string[] = [];
  if (config.business?.descripcion_corta) parts.push(`Somos ${config.business.nombre || 'el negocio'}: ${config.business.descripcion_corta}`);
  if (config.business?.ubicacion) parts.push(`Ubicacion: ${config.business.ubicacion}`);
  // Volcar todas las secciones genéricamente (no depender de keys exactos de Haiku)
  if (config.pago && typeof config.pago === 'object') {
    const pagoLines = dumpSection(config.pago);
    if (pagoLines.length) parts.push('Pagos: ' + pagoLines.join('. '));
  }
  if (config.envio) {
    const e = Array.isArray(config.envio) ? config.envio[0] : config.envio;
    if (e) {
      const envioLines = dumpSection(e);
      if (envioLines.length) parts.push('Envio: ' + envioLines.join('. '));
    }
  }
  if (config.politicas && typeof config.politicas === 'object') {
    const polLines = dumpSection(config.politicas);
    if (polLines.length) parts.push('Politicas: ' + polLines.join('. '));
  }
  if (config.escalamiento && typeof config.escalamiento === 'object') {
    const escLines = dumpSection(config.escalamiento);
    if (escLines.length) parts.push('Escalamiento: ' + escLines.join('. '));
  }
  if (config.reglas_negocio?.length > 0) {
    parts.push('Reglas: ' + config.reglas_negocio.filter((r: any) => r.activa !== false).map((r: any) => r.texto).join('. '));
  }
  if (config.faq_libre) parts.push(config.faq_libre);
  if (parts.length > 0) cfg.extraInstructions = parts.join('\n\n');
  await putItem({ ...agent, agentConfig: cfg, updatedAt: new Date().toISOString() });
}
