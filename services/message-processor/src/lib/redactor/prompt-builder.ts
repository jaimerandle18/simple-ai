/**
 * Prompt builder para el redactor.
 * Recibe contexto estructurado (del handler) y construye el system prompt.
 * El redactor NUNCA decide qué productos mostrar. Solo redacta.
 */
import type { HandlerContext } from '../handlers/intent-handlers';

export function buildRedactorPrompt(args: {
  handlerCtx: HandlerContext;
  agentConfig: any;
  contactMemory?: string;
  historySummary?: string;
  productsContext?: string;
  cartContext?: string;
}): string {
  const { handlerCtx, agentConfig } = args;
  const parts: string[] = [];

  // BLOQUE 1: Identidad + tono
  const agentName = agentConfig.assistantName || 'el vendedor';
  const businessName = agentConfig.business?.name || agentConfig.businessName || 'el negocio';
  const tone = agentConfig.tone || 'casual_amigable';
  const maxLines = agentConfig.maxLines || 4;
  const useEmojis = agentConfig.useEmojis !== false;

  const toneMap: Record<string, string> = {
    casual_amigable: 'Argentino casual y amigable, vos, conciso. Como un amigo que recomienda.',
    formal: 'Profesional pero cercano, vos. Sin ser frio.',
    vendedor_directo: 'Directo y persuasivo, vos. Sin vueltas.',
    cercano: 'Cercano y empatico, vos. Hacer sentir al cliente entendido.',
  };

  parts.push(`# IDENTIDAD
Sos ${agentName}, vendedor virtual por WhatsApp de ${businessName}.

# TONO
${toneMap[tone] || toneMap.casual_amigable}
Maximo ${maxLines} lineas por respuesta.
Sin signos de apertura. Solo cierre (! ?).
${useEmojis ? 'Emoji opcional, maximo 1.' : 'Sin emojis.'}`);

  // BLOQUE 2: Reglas inviolables
  parts.push(`# REGLAS INVIOLABLES

1. NUNCA INVENTES. Solo podes mencionar productos cuyo nombre EXACTO esta en PRODUCTOS_A_MENCIONAR.
   - Si dice "Hoodie Equal Negro", usas "Hoodie Equal Negro". NO "Equal Negro", NO "Equal Black".
   - Cualquier nombre que no este en la lista es INVENCION y esta PROHIBIDO.

2. NUNCA repitas datos del CAPTION. Las fotos tienen caption con nombre, precio, talles, descripcion. NO incluyas eso en tu texto.

3. NUNCA pidas datos personales (nombre, direccion, telefono). El checkout de la web se encarga.

4. NUNCA inventes URLs. Si necesitas un link de compra, la tool generar_link_compra lo genera.

5. NUNCA improvises info del negocio que no este en este prompt.`);

  // BLOQUE 3: Instruccion del handler (lo que tiene que hacer AHORA)
  parts.push(`# TU TAREA EN ESTA RESPUESTA
${handlerCtx.redactorInstruction}`);

  // BLOQUE 4: Productos a mencionar (si hay)
  if (handlerCtx.productsToShow.length > 0) {
    const names = handlerCtx.productsToShow.map((p: any, i: number) =>
      `${i + 1}. "${p.name}" ($${(p.priceNum || 0).toLocaleString('es-AR')})`
    );
    parts.push(`# PRODUCTOS_A_MENCIONAR (nombres EXACTOS que podes usar)
${names.join('\n')}

IMPORTANTE: Solo podes usar estos nombres. Cualquier otro nombre es INVENCION.`);
  }

  // BLOQUE 5: Contexto de productos disponibles (para tools)
  if (args.productsContext) {
    parts.push(args.productsContext);
  }

  // BLOQUE 6: Carrito
  if (args.cartContext) {
    parts.push(args.cartContext);
  }

  // BLOQUE 7: Info del negocio (si la tiene)
  const bi = agentConfig.businessHours || agentConfig.business?.hours;
  const addr = agentConfig.business?.address || agentConfig.business?.ubicacion;
  const promo = agentConfig.promotions;
  const extraInstr = agentConfig.extraInstructions;

  if (bi || addr || promo || extraInstr) {
    const info: string[] = ['# INFO DEL NEGOCIO'];
    if (bi) info.push(`Horarios: ${bi}`);
    if (addr) info.push(`Direccion: ${addr}`);
    if (promo) info.push(`Promos: ${promo}`);
    if (extraInstr) info.push(`\n${extraInstr}`);
    parts.push(info.join('\n'));
  }

  // BLOQUE 8: Memoria + historial
  if (args.contactMemory) {
    parts.push(`# MEMORIA DEL CLIENTE\n${args.contactMemory}`);
  }
  if (args.historySummary) {
    parts.push(`# RESUMEN CONVERSACION PREVIA\n${args.historySummary}`);
  }

  return parts.join('\n\n');
}
