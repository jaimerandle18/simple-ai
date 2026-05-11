/**
 * Memoria a largo plazo por contacto.
 * - Después de cada conversación, Haiku resume preferencias del cliente.
 * - Cuando el contacto vuelve, el resumen se inyecta al system prompt.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getItem, putItem, keys } from './dynamo-helpers';

/**
 * Cargar memoria existente de un contacto.
 */
export async function loadContactMemory(tenantId: string, phone: string): Promise<string> {
  const item = await getItem(keys.contactMemory(tenantId, phone));
  return (item?.summary as string) || '';
}

/**
 * Generar resumen de la conversación y actualizar la memoria del contacto.
 * Se llama al final de cada turno con el historial reciente.
 */
export async function updateContactMemory(
  tenantId: string,
  phone: string,
  conversationHistory: { role: string; content: string }[],
  anthropic: Anthropic,
): Promise<void> {
  // Solo actualizar si hay suficiente contexto (mínimo 4 turnos)
  if (conversationHistory.length < 4) return;

  const existing = await loadContactMemory(tenantId, phone);

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Resumí las preferencias y datos del cliente en esta conversación de WhatsApp.
${existing ? `\nMEMORIA PREVIA:\n${existing}\n` : ''}
CONVERSACIÓN RECIENTE:
${conversationHistory.slice(-10).map(m => `${m.role === 'user' ? 'Cliente' : 'Agente'}: ${m.content}`).join('\n')}

Devolvé un resumen CORTO (máx 200 palabras) con:
- Nombre si se mencionó
- Productos que consultó o compró
- Talles/colores preferidos
- Intención no concretada (ej: "quiso comprar X pero no cerró")
- Cualquier preferencia útil para futuras conversaciones

SOLO el resumen, sin explicaciones.`,
      }],
    });

    const summary = res.content[0].type === 'text' ? res.content[0].text.trim() : '';
    if (!summary) return;

    await putItem({
      ...keys.contactMemory(tenantId, phone),
      tenantId,
      phone,
      summary,
      updatedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 días
    });

    console.log(`[MEMORY] Updated for ${phone}: ${summary.slice(0, 80)}...`);
  } catch (err: any) {
    console.error(`[MEMORY] Error updating for ${phone}:`, err.message);
  }
}
