/**
 * Generacion de variantes de mensaje con Haiku.
 * Se llama una sola vez al crear la campana.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Variant } from './types';

export async function generateVariants(args: {
  businessName: string;
  campaignType: string;
  examplePlaceholders: { nombre: string; producto: string };
}): Promise<Variant[]> {
  const anthropic = new Anthropic();

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Genera 5 variantes de mensaje de remarketing para WhatsApp.

Contexto:
- Negocio: ${args.businessName}
- Tipo de campana: ${args.campaignType}
- Ejemplo de variables: nombre="${args.examplePlaceholders.nombre}", producto="${args.examplePlaceholders.producto}"

Reglas:
- Cada variante con tono argentino casual.
- Usar {nombre} y {producto} como placeholders.
- Cada variante con al menos 60% de palabras DISTINTAS a las otras.
- Variar el largo: algunas cortas (10-15 palabras), otras mas largas (25-30).
- Emoji opcional, max 1 por variante. NO todos con emoji.
- Sin signos de apertura (¡ ¿). Solo cierre (! ?).
- Que suene humano, no robotico.
- NO usar "bot", decir "agente" si hace falta.

Devuelve SOLO JSON valido: { "variants": [{ "id": "v1", "text": "..." }, { "id": "v2", "text": "..." }, { "id": "v3", "text": "..." }, { "id": "v4", "text": "..." }, { "id": "v5", "text": "..." }] }`,
    }],
  });

  const raw = res.content[0].type === 'text' ? res.content[0].text : '';
  const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  let parsed: { variants: Array<{ id: string; text: string }> };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Haiku response: ${raw.slice(0, 200)}`);
  }

  if (!parsed.variants || parsed.variants.length < 5) {
    throw new Error(`Expected 5 variants, got ${parsed.variants?.length ?? 0}`);
  }

  // Validar que cada variante tiene ambos placeholders
  const variants: Variant[] = parsed.variants.slice(0, 5).map((v, i) => {
    const text = v.text || '';
    if (!text.includes('{nombre}') || !text.includes('{producto}')) {
      console.warn(`[VARIANTS] Variant ${v.id} missing placeholders, adding them`);
    }
    return {
      id: v.id || `v${i + 1}`,
      text,
      sentCount: 0,
      replyCount: 0,
    };
  });

  return variants;
}

/**
 * Selecciona una variante de forma deterministica por contacto.
 * Evita que el mismo contacto reciba siempre la misma variante
 * pero es reproducible (para debugging).
 */
export function pickVariant(variants: Variant[], contactPhone: string): Variant {
  let hash = 0;
  for (let i = 0; i < contactPhone.length; i++) {
    hash = ((hash << 5) - hash + contactPhone.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % variants.length;
  return variants[index];
}

/**
 * Reemplaza placeholders en el texto de la variante.
 */
export function fillPlaceholders(
  text: string,
  data: { nombre?: string; producto?: string },
): string {
  return text
    .replace(/\{nombre\}/g, data.nombre || '')
    .replace(/\{producto\}/g, data.producto || 'tu consulta');
}
