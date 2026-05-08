import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedIntent, IntentType } from './types';

const VALID_INTENTS: IntentType[] = [
  'product_query', 'product_use_search', 'list_compare', 'list_extend', 'list_select',
  'price_question', 'shipping', 'payment', 'hours', 'location', 'returns', 'warranty',
  'greeting', 'farewell', 'thanks', 'complaint', 'human_request', 'off_topic', 'ambiguous',
];

export async function extractIntent(
  message: string,
  state: { hasShownProducts: boolean; activeCategory: string | null; lastIntent: string | null },
  anthropic: Anthropic,
): Promise<ExtractedIntent> {
  const systemPrompt = `Sos un extractor de intención para un vendedor virtual de WhatsApp argentino.
Devolvé SOLO un JSON.

# ESTADO
hasShownProducts: ${state.hasShownProducts}
activeCategory: ${state.activeCategory || 'ninguna'}
lastIntent: ${state.lastIntent || 'ninguno'}

# INTENCIONES: ${VALID_INTENTS.join(', ')}

# REGLAS
1. COMPARATIVOS CON LISTA: hasShownProducts=true Y "el más X / la más X / cuál de" → list_compare
2. COMPARATIVOS SIN LISTA: hasShownProducts=false Y "la X más barata / la más potente" → product_query CON entities.atributo_comparacion y entities.direccion_comparacion
3. hasShownProducts=true Y "el primero / segundo" o "el de [atributo]" → list_select
4. hasShownProducts=true Y variante o sigue sobre mismos productos → list_extend
5. Uso/función ("para cortar X") sin productos previos → product_use_search
6. Uso/función CON productos previos del mismo tipo → list_extend
7. Producto/categoría NUEVA → product_query
8. "está caro / más barato" con hasShownProducts=true → list_compare con atributo_comparacion=precio
9. "qué otros productos tenes" / "qué más vendes" / "algo más" sin especificar → ambiguous con motivo "broad_query"
10. "cuál es la mejor" / "cuál me recomendás" / "la que mejor funciona" con hasShownProducts=true → list_compare (NUNCA ambiguous)
11. "cuál es la mejor" sin hasShownProducts → product_query con atributo_comparacion="calidad"
8. Typos no bajan confidence
9. confidence < 0.5 → ambiguous

# EJEMPLOS
Msg:"hola" → {"intent":"greeting","confidence":0.99,"entities":{},"needs_human":false}
Msg:"tenes aspiradoras?" → {"intent":"product_query","confidence":0.96,"entities":{"producto":"aspiradora"},"needs_human":false}
Msg:"cual es la mas barata" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.97,"entities":{"atributo_comparacion":"precio","direccion_comparacion":"min"},"needs_human":false}
Msg:"cual es la mas potente" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.96,"entities":{"atributo_comparacion":"potencia","direccion_comparacion":"max"},"needs_human":false}
Msg:"el primero" Estado:{hasShownProducts:true} → {"intent":"list_select","confidence":0.95,"entities":{"referencia_ordinal":1},"needs_human":false}
Msg:"el de 800W" Estado:{hasShownProducts:true} → {"intent":"list_select","confidence":0.93,"entities":{"referencia_atributo":"800W"},"needs_human":false}
Msg:"para limpiar mucho espacio" Estado:{hasShownProducts:true,activeCategory:"aspiradoras"} → {"intent":"list_extend","confidence":0.91,"entities":{"uso":"limpiar mucho espacio"},"needs_human":false}
Msg:"busco algo para cortar ceramica" → {"intent":"product_use_search","confidence":0.95,"entities":{"uso":"cortar cerámica"},"needs_human":false}
Msg:"que tienen abajo de 15 lucas" → {"intent":"product_query","confidence":0.91,"entities":{"precio_max":15000},"needs_human":false}
Msg:"hacen envios?" → {"intent":"shipping","confidence":0.97,"entities":{},"needs_human":false}
Msg:"como se paga?" → {"intent":"payment","confidence":0.97,"entities":{},"needs_human":false}
Msg:"hace 5 dias que espero quiero mi plata" → {"intent":"complaint","confidence":0.97,"entities":{},"needs_human":true}
Msg:"atiende alguien?" → {"intent":"human_request","confidence":0.95,"entities":{},"needs_human":true}
Msg:"esta re caro" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.9,"entities":{"atributo_comparacion":"precio","direccion_comparacion":"min"},"needs_human":false}
Msg:"y en L?" Estado:{hasShownProducts:true} → {"intent":"list_extend","confidence":0.94,"entities":{"talle":"L"},"needs_human":false}
Msg:"kuanto sale?" Estado:{hasShownProducts:true} → {"intent":"price_question","confidence":0.94,"entities":{},"needs_human":false}
Msg:"asdjkasd" → {"intent":"ambiguous","confidence":0.2,"entities":{},"needs_human":false}
Msg:"gracias!" → {"intent":"thanks","confidence":0.97,"entities":{},"needs_human":false}
Msg:"puedo cambiar el talle?" → {"intent":"returns","confidence":0.96,"entities":{},"needs_human":false}
Msg:"tiene garantia?" → {"intent":"warranty","confidence":0.95,"entities":{},"needs_human":false}
Msg:"la amoladora mas barata que tengas" Estado:{hasShownProducts:false} → {"intent":"product_query","confidence":0.94,"entities":{"producto":"amoladora","atributo_comparacion":"precio","direccion_comparacion":"min"},"needs_human":false}
Msg:"el taladro mas potente" Estado:{hasShownProducts:false} → {"intent":"product_query","confidence":0.93,"entities":{"producto":"taladro","atributo_comparacion":"potencia","direccion_comparacion":"max"},"needs_human":false}
Msg:"la hidrolavadora mas cara" Estado:{hasShownProducts:false} → {"intent":"product_query","confidence":0.93,"entities":{"producto":"hidrolavadora","atributo_comparacion":"precio","direccion_comparacion":"max"},"needs_human":false}
Msg:"y que otros productos tenes?" Estado:{hasShownProducts:true} → {"intent":"ambiguous","confidence":0.85,"entities":{"motivo":"broad_query"},"needs_human":false}
Msg:"que mas vendes?" Estado:{hasShownProducts:true} → {"intent":"ambiguous","confidence":0.83,"entities":{"motivo":"broad_query"},"needs_human":false}
Msg:"que tienen?" Estado:{hasShownProducts:false} → {"intent":"product_query","confidence":0.85,"entities":{},"needs_human":false}
Msg:"cual es la mejor?" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.93,"entities":{"atributo_comparacion":"calidad","direccion_comparacion":"max"},"needs_human":false}
Msg:"cual es la que mejor funciona?" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.92,"entities":{"atributo_comparacion":"potencia","direccion_comparacion":"max"},"needs_human":false}
Msg:"cual me recomendas?" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.91,"entities":{"atributo_comparacion":"calidad","direccion_comparacion":"max"},"needs_human":false}
Msg:"cual es la peor?" Estado:{hasShownProducts:true} → {"intent":"list_compare","confidence":0.9,"entities":{"atributo_comparacion":"calidad","direccion_comparacion":"min"},"needs_human":false}

Devolvé SOLO el JSON.`;

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemPrompt,
    messages: [
      { role: 'user', content: message },
    ],
  });

  const raw = res.content[0].type === 'text' ? res.content[0].text : '{}';
  try {
    // Limpiar posible markdown wrapping
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!VALID_INTENTS.includes(parsed.intent)) parsed.intent = 'ambiguous';
    if ((parsed.confidence || 0) < 0.5) parsed.intent = 'ambiguous';
    console.log(`Intent: ${parsed.intent} (${parsed.confidence}) | ${JSON.stringify(parsed.entities || {})}`);
    return { ...parsed, entities: parsed.entities || {}, raw };
  } catch {
    console.error('Intent parse error:', raw.slice(0, 200));
    return { intent: 'ambiguous', confidence: 0.2, entities: {}, needs_human: false, raw };
  }
}
