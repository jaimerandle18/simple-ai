import Anthropic from '@anthropic-ai/sdk';
import Fuse from 'fuse.js';
import { queryItems } from './dynamo-helpers';
import type { ConversationState } from './conversation-state';

// ========== TIPOS ==========

export interface RouterResult {
  intent: string;
  confidence: number;
  entities: Record<string, any>;
  productIntent: 'EXPLORE' | 'REFERENCE' | 'EXTEND' | 'NONE';
  needs_human: boolean;
  razonamiento_breve: string;
}

export type ProductSource = 'recent' | 'fresh_search' | 'none';

export interface NodeDefinition {
  requires_catalog: boolean;
  can_show_visuals: boolean;
  accepts_referential: boolean;
  is_terminal: boolean;
  temperature: number;
  max_tokens: number;
  prompt: string;
  auto_tag?: string;
}

// ========== REGISTRO CENTRAL DE NODOS ==========

export const NODES: Record<string, NodeDefinition> = {
  saludo_inicial: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.5, max_tokens: 200,
    prompt: `Si hay mensaje de bienvenida configurado, usalo TEXTUAL. Si no, saludá corto y preguntá en qué podés ayudar. NO inventes productos. 1-2 líneas.`,
  },
  consulta_producto_general: {
    requires_catalog: true, can_show_visuals: true, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 600,
    prompt: `El cliente explora sin apuntar a algo específico.
Las fotos con detalle se envían automáticamente. Tu texto es SOLO intro de 1-2 líneas + pregunta.
NO listes productos con nombre y precio. NUNCA mandes a la web. NUNCA "¿algo más?".`,
  },
  consulta_producto_especifico: {
    requires_catalog: true, can_show_visuals: true, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 600,
    prompt: `El cliente apuntó a un producto concreto. SOLO mencioná productos de "Productos encontrados".
Si no está → "Ese no lo tengo, pero tengo [alternativa]".
Las fotos se envían aparte. Tu texto es intro + pregunta para avanzar.
NO listes productos en el texto. Terminá con "¿Querés saber más?" o "¿Para qué uso sería?"`,
  },
  consulta_variante: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `El cliente pregunta variante (talle, color) de un producto que ya mira.
Usá la Memoria o "Productos mostrados recientemente" para saber cuál es.
SOLO confirmá variantes de la descripción. Si no existe → decilo y ofrecé las que sí hay. 1-3 líneas.`,
  },
  consulta_disponibilidad_combinada: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.1, max_tokens: 400,
    prompt: `El cliente preguntó combinación específica (producto + color + talle).
Validá con "Productos encontrados" o "Productos mostrados recientemente". Si existe → confirmá con precio. Si no → decí qué SÍ hay.`,
  },
  busqueda_por_atributo: {
    requires_catalog: true, can_show_visuals: true, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 600,
    prompt: `El cliente filtra por atributo (color, precio, estilo, USO, FUNCIÓN).
REGLAS:
1. Si hay productos → mostrá 2-4 con nombre + precio + por qué le sirve. Fotos van aparte.
2. Si NO hay → NUNCA mandes a la web. Preguntá más contexto u ofrecé categorías cercanas.
3. NUNCA "¿algo más?". Pregunta específica que avance.
4. Si describe USO ("cortar cerámica") → conectalo con los productos, explicá por qué sirven.`,
  },
  consulta_precio: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.1, max_tokens: 300,
    prompt: `SOLO precios reales. NUNCA inventes. Si pregunta cantidad, multiplicá. Si hay oferta, mostrá ambos.
Si no hay producto_actual → "¿De cuál me decís?". Después del precio → "¿Te lo reservo?"`,
    auto_tag: 'interesado',
  },
  consulta_stock: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.1, max_tokens: 300,
    prompt: `Respondé directo: hay / no hay / queda poco. Si no tenés info: "No manejo stock en tiempo real, consultá en la web."`,
  },
  consulta_descuento_promocion: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 400,
    prompt: `SOLO promos de "Promociones". NUNCA inventes. Si no hay → "Ahora no tengo promo activa".`,
  },
  consulta_medidas_calce: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `Si dio altura/peso/talle → recomendá UN talle. Si no → preguntá. Medidas exactas de la descripción si las hay.`,
  },
  consulta_material_caracteristicas: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `SOLO datos de la descripción. Si no tenés el dato, decilo. Datos objetivos, no adjetivos.`,
  },
  comparacion_productos: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.2, max_tokens: 600,
    prompt: `Compará por 3-4 ejes relevantes. Recomendá UNO. NO digas "los dos son buenos". Sé honesto.`,
  },
  recomendacion: {
    requires_catalog: true, can_show_visuals: true, accepts_referential: true, is_terminal: false,
    temperature: 0.3, max_tokens: 600,
    prompt: `Si describió USO → "Para [uso] te recomiendo..." y elegí 1-2 productos. Justificá en 1 línea POR QUÉ sirve.
Si hay accesorios necesarios → mencionalo como cross-sell.
Si no tiene contexto → hacé 1 pregunta.
NUNCA listes 4. Elegí con criterio. NUNCA mandes a la web. Fotos van aparte.`,
  },
  consulta_referencial_lista: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.1, max_tokens: 400,
    prompt: `El cliente pregunta sobre productos YA mostrados (la más potente, la más barata, la primera).
Los productos están en "Productos mostrados recientemente". Usá ESA data.
NUNCA mandes a la web. La info YA está en el contexto. Cerrá con pregunta de avance.`,
  },
  consulta_envio: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 400,
    prompt: `Info de "Reglas del negocio". Si hay envío gratis desde X, mencionalo. Preguntá zona.`,
  },
  consulta_envio_zona_especifica: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `Costo y tiempo para esa zona de "Reglas del negocio". Si no hay → "Los costos los ves en la web."`,
  },
  consulta_tiempo_entrega: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 300,
    prompt: `Sé ESPECÍFICO si hay data. Si no → "Consultá tiempos en la web al finalizar la compra."`,
  },
  consulta_pago: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 400,
    prompt: `Métodos de "Reglas del negocio". NUNCA pidas datos de tarjeta. Si no hay info → "Los medios de pago los ves en la web."`,
  },
  consulta_retiro_local: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 300,
    prompt: `Datos de "Reglas del negocio": dirección, horarios. Si no hay → decilo.`,
  },
  intencion_compra: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `El cliente QUIERE COMPRAR. Confirmá producto de la Memoria. Pasale link de la web.
Si falta dato (variante) → pedí UNO solo. Sé directo.`,
    auto_tag: 'interesado',
  },
  reserva_apartado: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 400,
    prompt: `Condiciones de reserva de "Reglas del negocio". Si no hay → "No manejamos reservas, compralo ahora para asegurártelo."`,
  },
  confirmacion_datos: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.1, max_tokens: 500,
    prompt: `Validá datos. Cuando completo → RESUMEN. NUNCA cierres sin confirmación explícita.`,
  },
  objecion_precio: {
    requires_catalog: true, can_show_visuals: false, accepts_referential: true, is_terminal: false,
    temperature: 0.3, max_tokens: 500,
    prompt: `a) Validá sentimiento. b) Diferencial concreto de la descripción. c) Alternativa más económica. d) Descuento si hay. e) Puerta abierta sin presionar. NUNCA compares con competencia.`,
  },
  seguimiento_pedido: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 300,
    prompt: `Si hay tracking en "Reglas del negocio" → usalo. Si no → "Te paso con el equipo. ¿Nº de pedido?"`,
  },
  queja_reclamo: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `PRIMERO empatizá. NO te defiendas. Pedí info (nº pedido, foto). Escalá: "Te paso con el equipo."`,
    auto_tag: 'soporte',
  },
  cambio_devolucion: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 400,
    prompt: `Política de "Reglas del negocio". Diferenciá CAMBIO de DEVOLUCIÓN. Si quiere iniciar → pedí datos.`,
  },
  consulta_garantia: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.2, max_tokens: 300,
    prompt: `Política de "Reglas del negocio": plazo, qué cubre, qué NO. Si ya tiene falla → derivá a queja.`,
  },
  fuera_de_tema: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.5, max_tokens: 200,
    prompt: `Reconocé con humor amable. Redirigí al tema. 2 líneas máximo.`,
  },
  mensaje_ambiguo: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: false,
    temperature: 0.3, max_tokens: 300,
    prompt: `NO digas "no entendí". Ofrecé 2-3 opciones concretas de la Memoria. Si reconocés typo, reformulá.`,
  },
  despedida: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: true,
    temperature: 0.5, max_tokens: 150,
    prompt: `Cordial, 1-2 líneas. Si cerró venta → "Gracias! Te aviso del envío." Si no → "De nada, volvé cuando quieras." NUNCA "¿algo más?"`,
  },
  escalamiento_humano: {
    requires_catalog: false, can_show_visuals: false, accepts_referential: false, is_terminal: true,
    temperature: 0.2, max_tokens: 200,
    prompt: `Avisá CLARO que pasa a humano. "Te derivo ahora" o "Te contactan a la brevedad." NO insistas.`,
  },
};

// ========== ROUTER ==========

const VALID_INTENTS = Object.keys(NODES);

const ROUTER_PROMPT = `Sos un clasificador de intención para un vendedor virtual de WhatsApp.
Devolvé un JSON. NO respondés al cliente.

# INTENCIONES VÁLIDAS
${VALID_INTENTS.join(', ')}

# FORMATO (JSON estricto)
{"intent":"...","confidence":0.0-1.0,"entities":{"producto":"...","talle":"...","color":"...","cantidad":0,"ciudad":"...","atributo_busqueda":"...","precio_max":0,"urgencia":"alta|media|baja","sentimiento":"positivo|neutro|negativo|enojado"},"productIntent":"EXPLORE|REFERENCE|EXTEND|NONE","needs_human":false,"razonamiento_breve":"..."}

# productIntent (IMPORTANTE)
- EXPLORE: busca productos nuevos. "qué tienen?", "tenés aspiradoras?", "busco algo para cortar cerámica"
- REFERENCE: pregunta sobre productos YA mostrados. "cuál es la más barata?", "la primera", "el de 800W"
- EXTEND: sigue hablando del producto que ya vio. "y en talle L?", "cuánto sale?", "para limpiar mucho cuál me conviene" (cuando ya hay productos mostrados)
- NONE: no es sobre productos. "hacen envíos?", "dónde están?", "gracias"

# REGLAS DURAS
1. confidence < 0.6 → intent = "mensaje_ambiguo"
2. sentimiento enojado o amenaza legal → needs_human = true
3. producto + talle + color juntos → "consulta_disponibilidad_combinada"
4. Filtro ("en negro", "menos de 20 lucas") → "busqueda_por_atributo"
5. etapa_funnel = "comprando" y da datos → "confirmacion_datos"
6. "Está caro", "más barato" → "objecion_precio" (NO consulta_precio)
7. Pide humano → "escalamiento_humano", needs_human = true
8. Typos no bajan confidence
9. Si hay productos_mostrados_recientemente y pregunta sobre ellos → productIntent = REFERENCE
10. Si ya hay productos mostrados y pide recomendación/comparación → productIntent = EXTEND
11. "busco algo para X" (uso/función) → "recomendacion" con productIntent EXPLORE

# EJEMPLOS

## saludo_inicial
Msg:"hola" Estado:{primera_interaccion:true} → {"intent":"saludo_inicial","confidence":0.98,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"saludo"}
Msg:"buenas, una consulta" Estado:{primera_interaccion:true} → {"intent":"saludo_inicial","confidence":0.95,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"saludo"}

## consulta_producto_general
Msg:"que tienen?" Estado:{} → {"intent":"consulta_producto_general","confidence":0.93,"entities":{},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"explora catalogo"}
Msg:"me mandas el catalogo?" Estado:{} → {"intent":"consulta_producto_general","confidence":0.92,"entities":{},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"pide ver todo"}

## consulta_producto_especifico
Msg:"tenes la remera oversize?" Estado:{} → {"intent":"consulta_producto_especifico","confidence":0.95,"entities":{"producto":"remera oversize"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"producto concreto"}
Msg:"vi una campera negra en el insta" Estado:{} → {"intent":"consulta_producto_especifico","confidence":0.9,"entities":{"producto":"campera","color":"negro"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"producto de redes"}

## consulta_variante
Msg:"y en L?" Estado:{producto_actual:"Remera Oversize"} → {"intent":"consulta_variante","confidence":0.95,"entities":{"talle":"L"},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"variante talle"}
Msg:"viene en otro color?" Estado:{producto_actual:"Buzo"} → {"intent":"consulta_variante","confidence":0.94,"entities":{},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"pregunta colores"}

## consulta_disponibilidad_combinada
Msg:"tenes la negra en M?" Estado:{producto_actual:"Remera Oversize"} → {"intent":"consulta_disponibilidad_combinada","confidence":0.95,"entities":{"producto":"remera oversize","color":"negro","talle":"M"},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"combo color+talle"}
Msg:"campera bomber en S blanca?" Estado:{} → {"intent":"consulta_disponibilidad_combinada","confidence":0.96,"entities":{"producto":"campera bomber","color":"blanco","talle":"S"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"3 atributos"}

## busqueda_por_atributo
Msg:"que tienen abajo de 15 lucas?" Estado:{} → {"intent":"busqueda_por_atributo","confidence":0.93,"entities":{"precio_max":15000},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"filtro precio"}
Msg:"que hay en negro?" Estado:{} → {"intent":"busqueda_por_atributo","confidence":0.92,"entities":{"color":"negro"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"filtro color"}

## consulta_precio
Msg:"kuanto sale?" Estado:{producto_actual:"Remera"} → {"intent":"consulta_precio","confidence":0.94,"entities":{},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"precio"}
Msg:"valor del buzo?" Estado:{} → {"intent":"consulta_precio","confidence":0.93,"entities":{"producto":"buzo"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"precio explicito"}

## consulta_referencial_lista
Msg:"cual es la mas potente?" Estado:{productos_mostrados_recientemente:["Hidro 140bar","Hidro 180bar"]} → {"intent":"consulta_referencial_lista","confidence":0.95,"entities":{"atributo_comparacion":"potencia"},"productIntent":"REFERENCE","needs_human":false,"razonamiento_breve":"compara mostrados"}
Msg:"la mas barata?" Estado:{productos_mostrados_recientemente:["p1","p2"]} → {"intent":"consulta_referencial_lista","confidence":0.96,"entities":{"atributo_comparacion":"precio"},"productIntent":"REFERENCE","needs_human":false,"razonamiento_breve":"precio min de mostrados"}
Msg:"y la del medio?" Estado:{productos_mostrados_recientemente:["p1","p2","p3"]} → {"intent":"consulta_referencial_lista","confidence":0.9,"entities":{"referencia_ordinal":"medio"},"productIntent":"REFERENCE","needs_human":false,"razonamiento_breve":"ordinal"}

## recomendacion
Msg:"busco algo para cortar ceramica" Estado:{} → {"intent":"recomendacion","confidence":0.92,"entities":{"uso":"cortar ceramica"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"busqueda por uso"}
Msg:"que tenes para cortar pasto?" Estado:{} → {"intent":"recomendacion","confidence":0.93,"entities":{"uso":"cortar pasto"},"productIntent":"EXPLORE","needs_human":false,"razonamiento_breve":"uso jardin"}
Msg:"para limpiar mucho espacio cual me conviene" Estado:{productos_mostrados_recientemente:["Aspiradora1","Aspiradora2"]} → {"intent":"recomendacion","confidence":0.92,"entities":{"uso":"limpiar mucho espacio"},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"recomendacion entre mostrados"}
Msg:"cual me recomendas de esas?" Estado:{productos_mostrados_recientemente:["p1","p2"]} → {"intent":"recomendacion","confidence":0.93,"entities":{},"productIntent":"REFERENCE","needs_human":false,"razonamiento_breve":"recomendacion de mostrados"}

## objecion_precio
Msg:"esta re caro" Estado:{producto_actual:"Campera"} → {"intent":"objecion_precio","confidence":0.94,"entities":{"sentimiento":"negativo"},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"objecion"}
Msg:"no me alcanza la guita" Estado:{producto_actual:"Buzo"} → {"intent":"objecion_precio","confidence":0.92,"entities":{"sentimiento":"negativo"},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"presupuesto"}

## intencion_compra
Msg:"lo quiero" Estado:{producto_actual:"Remera",variante_elegida:{color:"negro",talle:"M"}} → {"intent":"intencion_compra","confidence":0.97,"entities":{},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"compra"}
Msg:"como hago para comprarlo?" Estado:{producto_actual:"Pantalon"} → {"intent":"intencion_compra","confidence":0.94,"entities":{},"productIntent":"EXTEND","needs_human":false,"razonamiento_breve":"instrucciones compra"}

## consulta_envio
Msg:"hacen envios?" Estado:{} → {"intent":"consulta_envio","confidence":0.97,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"envio general"}
Msg:"mandas a cordoba?" Estado:{} → {"intent":"consulta_envio_zona_especifica","confidence":0.96,"entities":{"ciudad":"Cordoba"},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"zona especifica"}

## consulta_pago
Msg:"como se paga?" Estado:{} → {"intent":"consulta_pago","confidence":0.96,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"metodos pago"}
Msg:"aceptan transferencia?" Estado:{} → {"intent":"consulta_pago","confidence":0.96,"entities":{"metodo":"transferencia"},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"metodo especifico"}

## queja_reclamo
Msg:"hace 5 dias que espero y NADA" Estado:{} → {"intent":"queja_reclamo","confidence":0.97,"entities":{"sentimiento":"enojado","urgencia":"alta"},"productIntent":"NONE","needs_human":true,"razonamiento_breve":"queja seria"}
Msg:"me llego fallado" Estado:{} → {"intent":"queja_reclamo","confidence":0.96,"entities":{"sentimiento":"negativo"},"productIntent":"NONE","needs_human":true,"razonamiento_breve":"producto fallado"}

## cambio_devolucion
Msg:"puedo cambiar el talle?" Estado:{} → {"intent":"cambio_devolucion","confidence":0.96,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"cambio"}

## fuera_de_tema
Msg:"que pensas del partido?" Estado:{} → {"intent":"fuera_de_tema","confidence":0.93,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"ajeno"}

## mensaje_ambiguo
Msg:"asdkjasd" Estado:{} → {"intent":"mensaje_ambiguo","confidence":0.2,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"incomprensible"}
Msg:"?" Estado:{} → {"intent":"mensaje_ambiguo","confidence":0.15,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"signo solo"}

## despedida
Msg:"gracias!" Estado:{} → {"intent":"despedida","confidence":0.94,"entities":{},"productIntent":"NONE","needs_human":false,"razonamiento_breve":"cierre"}

## escalamiento_humano
Msg:"pasame con alguien" Estado:{} → {"intent":"escalamiento_humano","confidence":0.97,"entities":{},"productIntent":"NONE","needs_human":true,"razonamiento_breve":"pide humano"}`;

export async function routeMessage(
  message: string,
  state: Record<string, any>,
  anthropic: Anthropic,
): Promise<RouterResult> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: ROUTER_PROMPT,
    messages: [
      { role: 'user', content: `Mensaje: "${message}"\nEstado: ${JSON.stringify(state)}` },
    ],
  });

  const raw = res.content[0].type === 'text' ? res.content[0].text : '';
  try {
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleaned) as RouterResult;
    if (!VALID_INTENTS.includes(result.intent)) result.intent = 'mensaje_ambiguo';
    if (result.confidence < 0.6) result.intent = 'mensaje_ambiguo';
    if (!['EXPLORE', 'REFERENCE', 'EXTEND', 'NONE'].includes(result.productIntent)) {
      result.productIntent = 'NONE';
    }
    console.log(`Router: ${result.intent} (${result.confidence}) pIntent=${result.productIntent} | ${result.razonamiento_breve}`);
    return result;
  } catch {
    console.error('Router parse error:', raw.slice(0, 200));
    return { intent: 'mensaje_ambiguo', confidence: 0.3, entities: {}, productIntent: 'NONE', needs_human: false, razonamiento_breve: 'parse error' };
  }
}

// ========== DECISIÓN DE FUENTE DE PRODUCTOS ==========

export function decideProductSource(
  nodeId: string,
  routerResult: RouterResult,
  state: ConversationState,
): ProductSource {
  const node = NODES[nodeId];
  if (!node || !node.requires_catalog) return 'none';

  const hasRecent = state.getRecentProductsData().length > 0;
  const productIntent = routerResult.productIntent || 'EXPLORE';

  if (productIntent === 'REFERENCE' && hasRecent && node.accepts_referential) return 'recent';
  if (productIntent === 'EXTEND' && hasRecent && node.accepts_referential) return 'recent';
  if (productIntent === 'EXPLORE') return 'fresh_search';
  if (productIntent === 'NONE') return 'none';

  // Ambiguo: preferir recientes si hay y el nodo los acepta
  if (hasRecent && node.accepts_referential) return 'recent';
  return 'fresh_search';
}

// ========== OBTENER PRODUCTOS PARA EL TURNO ==========

export async function getProductsForTurn(
  source: ProductSource,
  ctx: {
    state: ConversationState;
    message: string;
    tenantId: string;
    routerResult: RouterResult;
    history: { role: string; content: string }[];
    anthropic: Anthropic;
  },
): Promise<any[]> {
  if (source === 'none') return [];
  if (source === 'recent') return ctx.state.getRecentProductsData();

  // fresh_search
  const allProducts = (await queryItems(`TENANT#${ctx.tenantId}`, 'PRODUCT#', { limit: 500 }))
    .filter((p: any) => p.name && p.name.length > 2)
    .filter((p: any) => !p.price || p.price !== '0.75');

  if (allProducts.length === 0) return [];

  // Filtrar por categoría activa si existe
  const activeCategory = ctx.state.getActiveCategory();
  let pool = allProducts;
  if (activeCategory && !categoryChangeDetected(ctx.routerResult, activeCategory)) {
    const filtered = allProducts.filter((p: any) =>
      (p.category || '').toLowerCase().includes(activeCategory.toLowerCase())
    );
    if (filtered.length >= 3) pool = filtered;
  }

  const keywords = await extractKeywords(ctx.message, ctx.history, undefined, ctx.anthropic, ctx.routerResult.entities);
  console.log(`Keywords: ${JSON.stringify(keywords)}`);
  let relevant = findRelevantProducts(pool, keywords);

  if (relevant.length === 0) {
    console.log('Keyword search empty, trying smart match...');
    const indices = await smartProductMatch(ctx.message, pool, ctx.anthropic);
    relevant = indices.map(i => pool[i]).filter(Boolean);
  }

  return relevant.slice(0, 4);
}

// ========== HELPERS ==========

export function detectDominantCategory(products: any[]): string | null {
  const counts: Record<string, number> = {};
  for (const p of products) {
    if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  if (sorted[0][1] >= products.length * 0.5) return sorted[0][0];
  return null;
}

function categoryChangeDetected(routerResult: RouterResult, currentCategory: string): boolean {
  const mentioned = (routerResult.entities?.producto || '').toLowerCase();
  if (!mentioned) return false;
  const catWords = currentCategory.toLowerCase().split(/\s+/);
  return !catWords.some(w => mentioned.includes(w));
}

// ========== KEYWORD EXTRACTOR ==========

export async function extractKeywords(
  message: string,
  history: { role: string; content: string }[],
  conversationState?: { memory?: string } | null,
  anthropic?: Anthropic,
  entities?: Record<string, any>,
): Promise<string[]> {
  if (!anthropic) return message.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const entityKw: string[] = [];
  if (entities) {
    if (entities.producto) entityKw.push(entities.producto);
    if (entities.color) entityKw.push(entities.color);
    if (entities.talle) entityKw.push(entities.talle);
    if (entities.atributo_busqueda) entityKw.push(entities.atributo_busqueda);
    if (entities.uso) entityKw.push(entities.uso);
  }

  const ctx = conversationState?.memory ? `\nMemoria: ${conversationState.memory}` : '';

  const systemContent = `Extraé keywords para buscar en catálogo. JSON array, 3-10.
Producto + sinónimos, con y sin acento, categoría. Si dice "ese" → nombre de la memoria.
${entityKw.length ? `Entidades: ${entityKw.join(', ')}` : ''}${ctx}
SOLO JSON array.`;

  // Construir mensajes alternando roles para Anthropic
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of history.slice(-4)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (msgs.length > 0 && msgs[msgs.length - 1].role === role) {
      msgs[msgs.length - 1].content += '\n' + m.content;
    } else {
      msgs.push({ role, content: m.content });
    }
  }
  // Agregar mensaje actual
  if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
    msgs[msgs.length - 1].content += '\n' + message;
  } else {
    msgs.push({ role: 'user', content: message });
  }
  // Asegurar que empiece con user
  if (msgs.length === 0 || msgs[0].role !== 'user') {
    msgs.unshift({ role: 'user', content: message });
  }

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemContent,
    messages: msgs,
  });

  try {
    const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
    const raw: string[] = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    const cleaned = raw.map(k => k.replace(/[?!.,;:()¿¡]/g, '').trim().toLowerCase()).filter(k => k.length >= 3);
    for (const ek of entityKw) { const n = ek.toLowerCase(); if (!cleaned.includes(n)) cleaned.push(n); }
    return cleaned;
  } catch {
    const words = message.toLowerCase().replace(/[?!.,;:()¿¡]/g, '').split(/\s+/).filter(w => w.length > 2);
    return [...new Set([...words, ...entityKw.map(e => e.toLowerCase())])];
  }
}

// ========== PRODUCT SEARCH (Fuse.js fuzzy + fallback) ==========

export function findRelevantProducts(products: any[], keywords: string[]): any[] {
  if (!products.length || !keywords.length) return [];

  const fuse = new Fuse(products, {
    keys: [
      { name: 'name', weight: 0.5 },
      { name: 'category', weight: 0.25 },
      { name: 'brand', weight: 0.15 },
      { name: 'description', weight: 0.1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });

  const results = fuse.search(keywords.join(' '));
  if (results.length > 0) return results.slice(0, 8).map(r => ({ ...r.item, _score: 1 - (r.score || 0) }));

  // Fallback keyword match
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
  const terms = [...new Set(keywords.flatMap(kw => { const k = normalize(kw); return k.endsWith('s') ? [k, k.slice(0, -1)] : [k]; }).filter(t => t.length >= 3))];

  return products
    .map(p => {
      const text = normalize(`${p.name} ${p.category || ''} ${p.brand || ''} ${p.description || ''}`);
      let score = 0;
      for (const t of terms) { if (text.includes(t)) score += 10; }
      return { ...p, _score: score };
    })
    .filter(p => p._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 8);
}

export async function smartProductMatch(
  message: string, allProducts: any[], anthropic: Anthropic,
): Promise<number[]> {
  const subset = allProducts.slice(0, 50);
  const list = subset.map((p, i) => `${i}. ${p.name} | ${p.category || ''} | ${p.price || ''}`).join('\n');

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 60,
    system: `Catálogo + consulta → JSON array de índices relevantes. Máx 6. Si nada: [].
Si el cliente describe USO ("cortar cerámica") → mapeá al producto correcto.`,
    messages: [
      { role: 'user', content: `Catálogo:\n${list}\n\nCliente: "${message}"` },
    ],
  });

  try {
    const text = (res.content[0].type === 'text' ? res.content[0].text : '[]').replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(text).filter((i: number) => typeof i === 'number' && i >= 0 && i < subset.length);
  } catch { return []; }
}

// ========== BUILD FINAL PROMPT ==========

function buildGlobalPrompt(agentConfig: any): string {
  const name = agentConfig.assistantName || 'Asistente';
  const websiteUrl = agentConfig.websiteUrl || '';
  const toneMap: Record<string, string> = {
    formal: 'Formal. Tratá de "usted".', friendly: 'Amigable. Tratá de "vos".',
    casual: 'Casual, máx 1 emoji. Tratá de "vos".', sales: 'Vendedor con onda. Tratá de "vos".',
  };

  return `Sos ${name}, vendedor virtual por WhatsApp.${websiteUrl ? ` Web: ${websiteUrl}` : ''}
Tono: ${toneMap[agentConfig.tone] || toneMap.friendly}
Argentino: "vos", "dale", "mirá", "genial". WhatsApp real, corto.

# REGLAS UNIVERSALES
1. NUNCA inventes productos, precios, stock, políticas.
2. NUNCA pidas datos de tarjeta por chat.
3. NUNCA prometas lo que requiera autorización humana.
4. Terminá con acción concreta (salvo despedida).
5. Piden humano → escalá.
6. Insultos → respeto + escalá.
7. SOLO texto para el cliente.
8. CUANDO HAY PRODUCTOS: las fotos se envían AUTOMÁTICAMENTE. Tu texto es SOLO intro + criterio + pregunta. NO listes productos.
9. NUNCA mandes a la web como respuesta principal. Mandar fuera de WA = perder venta.
10. PROHIBIDO "¿algo más en lo que pueda ayudarte?"`;
}

export function buildFinalPrompt(
  agentConfig: any,
  intent: string,
  productsContext?: string,
  filesContext?: string,
  conversationState?: { currentProducts?: string[]; lastIntent?: string; memory?: string; recentProductsData?: any[] },
  routerResult?: RouterResult,
): string {
  const globalPrompt = buildGlobalPrompt(agentConfig);
  const node = NODES[intent] || NODES.mensaje_ambiguo;

  let prompt = `${globalPrompt}\n\n## NODO: ${intent}\n${node.prompt}`;

  if (agentConfig.welcomeMessage && intent === 'saludo_inicial') {
    prompt += `\n\n## Mensaje de bienvenida (TEXTUAL)\n${agentConfig.welcomeMessage}`;
  }
  if (conversationState?.memory) prompt += `\n\n## Memoria\n${conversationState.memory}`;
  if (routerResult?.entities && Object.values(routerResult.entities).some(v => v)) {
    prompt += `\n\n## Entidades detectadas\n${JSON.stringify(routerResult.entities)}`;
  }
  if (agentConfig.promotions) prompt += `\n\n## Promociones\n${agentConfig.promotions}`;
  if (agentConfig.businessHours) prompt += `\n\n## Horario\n${agentConfig.businessHours}`;
  if (agentConfig.extraInstructions) prompt += `\n\n## Reglas del negocio\n${agentConfig.extraInstructions}`;
  if (filesContext) prompt += `\n\n## Información de referencia\n${filesContext}`;
  if (productsContext) prompt += `\n\n## Productos encontrados\n${productsContext}`;

  if (conversationState?.recentProductsData?.length) {
    const recentStr = conversationState.recentProductsData.map((p: any, i: number) =>
      `${i + 1}. *${p.name}*${p.brand ? ` (${p.brand})` : ''} — ${p.price || 'Consultar'}\n   ${p.description || ''}`
    ).join('\n');
    prompt += `\n\n## Productos mostrados recientemente\n${recentStr}`;
  }

  return prompt;
}
