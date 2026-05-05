import OpenAI from 'openai';

// ========== STEP 1: INTENT CLASSIFIER ==========
const INTENTS = [
  'greeting',           // Saludo inicial
  'product_search',     // Busca productos o categorías
  'product_detail',     // Quiere más info de un producto ya mencionado
  'price_concern',      // Pregunta por precios, descuentos, cuotas
  'sizing_help',        // Pregunta por talles, medidas
  'purchase_intent',    // Quiere comprar
  'shipping',           // Pregunta por envíos
  'returns',            // Cambios o devoluciones
  'complaint',          // Queja o problema
  'human_request',      // Quiere hablar con un humano
  'recommendation',     // Pide recomendaciones o no sabe qué elegir
  'general_question',   // Pregunta general sobre el negocio
  'farewell',           // Se despide
] as const;

type Intent = typeof INTENTS[number];

export async function classifyIntent(
  message: string,
  history: { role: string; content: string }[],
  openai: OpenAI,
): Promise<Intent> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 30,
    messages: [
      {
        role: 'system',
        content: `Clasificá el intent del último mensaje del cliente. Respondé SOLO con una de estas categorías:
${INTENTS.join(', ')}

Contexto de la conversación para entender mejor:`,
      },
      ...history.slice(-4).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ],
  });

  const intent = (res.choices[0]?.message?.content || 'general_question').trim().toLowerCase() as Intent;
  console.log(`Intent classified: ${intent}`);
  return INTENTS.includes(intent) ? intent : 'general_question';
}

// ========== STEP 2: KEYWORD EXTRACTOR (only for product-related intents) ==========
export async function extractKeywords(
  message: string,
  history: { role: string; content: string }[],
  openai: OpenAI,
): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `Extraé keywords de búsqueda para un catálogo de productos.
Incluí:
- El producto exacto que busca
- Sinónimos (gorra=cap=visera, buzo=hoodie=sudadera, pantalón=jean=pantalon)
- Variaciones de género/número (gorra/gorras, pantalón/pantalones)
- Categorías relacionadas (gorra → accesorios, sombrero)
- Si mencionan uso/actividad, incluí productos típicos (frío → campera, buzo, cuello; trekking → cargo, campera)
- Si piden más info de algo ya mencionado, extraé el NOMBRE EXACTO del producto de la conversación anterior

Devolvé SOLO un JSON array. Mínimo 5 keywords, máximo 15.`,
      },
      ...history.slice(-6).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ],
  });

  try {
    return JSON.parse(res.choices[0]?.message?.content || '[]');
  } catch {
    return message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  }
}

/**
 * Fallback: when keyword search finds nothing, ask OpenAI to pick from ALL product names.
 * More expensive but never misses.
 */
export async function smartProductMatch(
  message: string,
  allProducts: { name: string; price?: string; category?: string; description?: string }[],
  openai: OpenAI,
): Promise<number[]> {
  const productList = allProducts.map((p, i) => `${i}. ${p.name} (${p.category || 'sin categoría'}) ${p.price || ''}`).join('\n');

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 100,
    messages: [
      {
        role: 'system',
        content: `Dado un catálogo de productos y la consulta del cliente, devolvé los ÍNDICES de los productos relevantes.
Devolvé SOLO un JSON array de números. Ejemplo: [0, 3, 7]
Si ningún producto es relevante, devolvé [].
Máximo 8 productos.`,
      },
      {
        role: 'user',
        content: `Catálogo:\n${productList}\n\nCliente pregunta: "${message}"`,
      },
    ],
  });

  try {
    return JSON.parse(res.choices[0]?.message?.content || '[]');
  } catch {
    return [];
  }
}

// ========== STEP 3: MINI-PROMPTS POR INTENT ==========
// Defaults genéricos que funcionan para cualquier industria
export const DEFAULT_MINI_PROMPTS: Record<Intent, string> = {
  greeting: `Saludá al cliente con el mensaje de bienvenida configurado. Sé cálido y preguntá en qué podés ayudar.`,

  product_search: `El cliente busca productos. Mostrá los productos encontrados con este formato para cada uno:
**[Nombre]** — [Precio]
[Ver producto]([link])

Si hay varios, mostralos todos (máximo 5). Preguntá si quiere más detalle de alguno.
Si no se encontraron productos, decilo honestamente y sugerí categorías disponibles.`,

  product_detail: `El cliente quiere más info de un producto ya mencionado. Buscá en la conversación anterior qué producto mostró.
Dá toda la info disponible: descripción, precio, link. Sugerí visitar el link para ver todas las opciones.`,

  price_concern: `El cliente tiene dudas sobre el precio.
- Validá su preocupación
- Mencioná promociones activas si hay
- Ofrecé alternativas más económicas si existen
- Mencioná formas de pago si las conocés`,

  sizing_help: `El cliente necesita ayuda con talles.
- Sugerí que visite el link del producto para ver la guía de talles
- Mencioná la política de cambios
- Si no tenés info de talles, decilo y sugerí contactar por la web`,

  purchase_intent: `El cliente quiere comprar.
- Confirmá el producto elegido
- Compartí el link directo
- Mencioná métodos de pago y envío si los conocés
- Ofrecé asistencia si tiene problemas`,

  shipping: `Sobre envíos: sugerí que consulte los costos y tiempos al finalizar la compra en la web. Si hay envío gratis con monto mínimo (mencionado en promociones), mencionalo.`,

  returns: `Sobre cambios/devoluciones: indicá que consulte la política de cambios en la web. Si no tenés info específica, sugerí contactar por la web.`,

  complaint: `El cliente tiene un problema. Mostrá empatía. NO intentes resolverlo. Indicá que vas a derivar a un agente humano. Pedí nombre y número de pedido.`,

  human_request: `El cliente quiere hablar con una persona. Decile que vas a derivar su consulta y que van a contactarlo a la brevedad.`,

  recommendation: `El cliente no sabe qué elegir. Preguntá:
- Para qué ocasión o uso
- Presupuesto aproximado
- Preferencias (color, estilo)
Después sugerí productos que matcheen.`,

  general_question: `Respondé la pregunta con la información que tengas. Si no tenés la respuesta, sugerí que consulte en la web o que lo va a contactar un agente.`,

  farewell: `Despedite amablemente. Agradecé por la consulta e invitá a volver cuando necesite.`,
};

// ========== STEP 4: BUILD FINAL PROMPT ==========
export function buildFinalPrompt(
  agentConfig: any,
  intent: Intent,
  miniPrompt: string,
  products?: string,
): string {
  const name = agentConfig.assistantName || 'Asistente';
  const toneMap: Record<string, string> = {
    formal: 'Tono formal y respetuoso. Tratá al cliente de "usted".',
    friendly: 'Tono amigable y cálido. Tratá al cliente de "vos".',
    casual: 'Tono casual y relajado. Usá emojis con moderación. Tratá al cliente de "vos".',
    sales: 'Tono persuasivo y proactivo. Tratá al cliente de "vos".',
  };

  let prompt = `Sos ${name}, asistente virtual por WhatsApp.
${toneMap[agentConfig.tone] || toneMap.friendly}
Respondé en español argentino. Sé conciso.
NUNCA inventes info que no tengas.

## Tu tarea ahora
${miniPrompt}`;

  if (agentConfig.promotions && ['product_search', 'price_concern', 'purchase_intent'].includes(intent)) {
    prompt += `\n\n## Promociones activas\n${agentConfig.promotions}`;
  }

  if (agentConfig.businessHours && ['general_question', 'greeting'].includes(intent)) {
    prompt += `\n\n## Horario\n${agentConfig.businessHours}`;
  }

  if (agentConfig.extraInstructions) {
    prompt += `\n\n## Reglas del negocio\n${agentConfig.extraInstructions}`;
  }

  if (products) {
    prompt += `\n\n## Productos encontrados\n${products}`;
  }

  return prompt;
}
