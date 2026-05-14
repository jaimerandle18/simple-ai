import Anthropic from '@anthropic-ai/sdk';

export type Intent =
  | 'greeting'
  | 'product_search'
  | 'product_specific'
  | 'product_followup'
  | 'size_check'
  | 'price_check'
  | 'business_info'
  | 'shipping_info'
  | 'payment_info'
  | 'returns_info'
  | 'purchase_intent'
  | 'purchase_confirm'
  | 'human_escalation'
  | 'small_talk'
  | 'off_topic'
  | 'unclear';

export interface ClassifierResult {
  primary_intent: Intent;
  secondary_intent?: Intent;
  extracted_filters: {
    color?: string;
    size?: string;
    category?: string;
    priceRange?: 'cheap' | 'mid' | 'expensive';
    productNameHints?: string[];
  };
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function classifyIntent(args: {
  userMessage: string;
  recentMessages?: Array<{ role: string; content: string }>;
  vertical: string;
}): Promise<ClassifierResult> {
  const recentContext = (args.recentMessages || [])
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content.slice(0, 200)}`)
    .join('\n');

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `Sos un clasificador de mensajes de WhatsApp para un bot de venta argentino.
Analiza el mensaje del cliente y devolve SOLO un JSON.

Intents posibles:
- greeting: solo saluda sin pedir nada
- product_search: pide categoria amplia ("remeras", "buzos", "algo en negro")
- product_specific: pide un producto especifico por nombre ("el Hoodie Equal")
- product_followup: pregunta sobre productos ya mostrados ("y en otro color?", "el mas barato de esos")
- size_check: pregunta por disponibilidad de talle ("tenes talle L?", "viene en 36?")
- price_check: pregunta sobre precios ("cuanto sale?", "el mas barato?")
- business_info: horarios, direccion, contacto
- shipping_info: envios, costo, tiempo de entrega
- payment_info: metodos de pago, cuotas
- returns_info: cambios, devoluciones, garantia
- purchase_intent: quiere comprar ("lo quiero", "me lo llevo", "agregame al carrito")
- purchase_confirm: confirma una compra ya iniciada ("dale", "si", "listo", "cerramos", "pasame el link")
- human_escalation: insulto, queja grave, pide hablar con humano
- small_talk: gracias, ok, joya (sin info nueva, sin contexto de compra)
- off_topic: pregunta no relacionada al negocio
- unclear: no se puede clasificar

IMPORTANTE sobre purchase_confirm vs small_talk:
- Si el bot acaba de preguntar "te lo agrego?" o "cerramos la compra?" y el cliente dice "dale/si/listo" → purchase_confirm
- Si el bot acaba de decir "hola que buscas?" y el cliente dice "ok" → small_talk
- El CONTEXTO determina la diferencia.

Vertical del negocio: ${args.vertical}

Devolve SOLO JSON:
{
  "primary_intent": "intent",
  "secondary_intent": "opcional o null",
  "extracted_filters": {
    "color": "string o null",
    "size": "string o null",
    "category": "string o null",
    "priceRange": "cheap|mid|expensive o null",
    "productNameHints": ["array"]
  },
  "confidence": "high|medium|low",
  "reasoning": "explicacion corta"
}`,
      messages: [{
        role: 'user',
        content: `${recentContext ? `Contexto reciente:\n${recentContext}\n\n` : ''}Mensaje actual: "${args.userMessage}"`,
      }],
    });

    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[CLASSIFIER] Error:', err);
    return {
      primary_intent: 'unclear',
      extracted_filters: {},
      confidence: 'low',
      reasoning: 'classifier_error',
    };
  }
}
