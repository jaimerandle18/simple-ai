import Anthropic from '@anthropic-ai/sdk';
import type { EnrichedProduct, ExtractedIntent } from './types';

export async function writeResponse(
  primary: EnrichedProduct[],
  alternatives: EnrichedProduct[],
  intent: ExtractedIntent,
  config: any,
  context: { lastUserMessage: string; recentHistory: { role: string; content: string }[] },
  anthropic: Anthropic,
): Promise<string> {
  const productsBlock = formatProducts(primary, alternatives);
  const name = config.assistantName || 'el vendedor';
  const web = config.websiteUrl || '';

  const systemPrompt = `Sos ${name}, vendedor virtual por WhatsApp de un comercio argentino.${web ? ` Web: ${web}` : ''}

# TONO
Argentino casual, vos, conciso. Máx 1 emoji. WhatsApp real, no mail.

# REGLAS (NO NEGOCIABLES)
1. SOLO mencionás productos del bloque "PRODUCTOS". NUNCA inventes.
2. NUNCA mandes al cliente a la web. Si no tenés un dato, decilo.
3. NUNCA cierres con "¿algo más?". Pregunta específica o confirmación.
4. Si "el más X" → dato concreto del bloque (ej: "la más potente con 2200W").
5. Precio formateado: $XX.XXX
6. Máximo 4-5 líneas.
7. Las fotos con detalle se envían AUTOMÁTICAMENTE. NO listes productos. Solo intro + criterio + pregunta.

# CONTEXTO
Pregunta: "${context.lastUserMessage}"
Intención: ${intent.intent}
${intent.entities.uso ? `Uso: ${intent.entities.uso}` : ''}
${intent.entities.atributo_comparacion ? `Comparando: ${intent.entities.atributo_comparacion} (${intent.entities.direccion_comparacion})` : ''}
${config.promotions ? `Promociones: ${config.promotions}` : ''}
${config.extraInstructions ? `Reglas del negocio: ${config.extraInstructions}` : ''}

# PRODUCTOS
${productsBlock}

Redactá UNA respuesta corta. Empujá al siguiente paso.`;

  // Convertir historial al formato de Anthropic (alternar user/assistant)
  const messages: Anthropic.MessageParam[] = [];
  for (const m of context.recentHistory.slice(-4)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    // Anthropic requiere que los roles alternen, mergear consecutivos
    if (messages.length > 0 && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + m.content;
    } else {
      messages.push({ role, content: m.content });
    }
  }

  // Asegurar que empiece con user
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: context.lastUserMessage });
  }

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: systemPrompt,
    messages,
  });

  return res.content[0].type === 'text'
    ? res.content[0].text
    : 'Disculpá, tuve un problema. ¿Podés repetirme?';
}

function formatProducts(primary: EnrichedProduct[], alternatives: EnrichedProduct[]): string {
  const fmt = (p: EnrichedProduct, i: number) => {
    const attrs = Object.entries(p.attributes || {})
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `[${i}] ${p.name}
   Marca: ${p.brand || 'N/A'} | Precio: $${p.priceNum?.toLocaleString('es-AR') || p.price}
   ${attrs ? `Atributos: ${attrs}` : ''}
   Usos: ${(p.usosRecomendados || []).slice(0, 3).join(', ')}
   ${p.description ? p.description.slice(0, 120) : ''}`;
  };

  let block = 'PRINCIPALES:\n' + primary.map((p, i) => fmt(p, i + 1)).join('\n\n');
  if (alternatives.length > 0) {
    block += '\n\nALTERNATIVAS:\n' + alternatives.map((p, i) => fmt(p, primary.length + i + 1)).join('\n\n');
  }
  return block;
}
