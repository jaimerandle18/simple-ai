/**
 * Abstracciones multi-canal: NormalizedMessage + ChannelAdapter base.
 *
 * Todos los canales (WhatsApp, Instagram, Facebook) se normalizan a este
 * schema. El pipeline de IA procesa NormalizedMessage y produce
 * NormalizedResponse, que cada adapter formatea para su plataforma.
 */

// ============================================================
// TIPOS
// ============================================================

export type ChannelType = 'whatsapp' | 'whatsapp_waha' | 'whatsapp_evolution' | 'instagram' | 'facebook';

export interface NormalizedMessage {
  tenantId: string;
  channel: ChannelType;
  externalUserId: string;          // phone, IG user_id, FB user_id
  externalMessageId: string;       // wamid, IG mid, FB mid
  externalConversationId?: string; // FB threadId, IG conversation
  senderName?: string;
  content: {
    text?: string;
    audio?: { url?: string; mediaId?: string; mimeType?: string };
    image?: { url?: string; mediaId?: string; mimeType?: string; caption?: string };
    sticker?: { emoji?: string };
    reaction?: { emoji: string; toMessageId: string };
    location?: { lat: number; lng: number };
  };
  replyTo?: { externalMessageId: string };
  channelMetadata: Record<string, any>; // datos específicos por canal
  receivedAt: string;
}

export interface SendTextResult {
  externalMessageId: string;
}

// ============================================================
// CHANNEL ADAPTER (abstract)
// ============================================================

export abstract class ChannelAdapter {
  abstract channel: ChannelType;

  /** Parsea el payload del webhook a mensajes normalizados */
  abstract parseWebhook(payload: any): NormalizedMessage[];

  /** Envía un mensaje de texto */
  abstract sendText(args: {
    tenantId: string;
    externalUserId: string;
    text: string;
    replyTo?: string;
  }): Promise<SendTextResult>;

  /** Envía una imagen con caption opcional */
  abstract sendImage(args: {
    tenantId: string;
    externalUserId: string;
    imageUrl: string;
    caption?: string;
  }): Promise<SendTextResult>;

  /** Marca mensaje como leído */
  abstract markAsRead(args: {
    tenantId: string;
    externalMessageId: string;
  }): Promise<void>;

  // ─── Quirks por canal ─────────────────────────────────

  /** ¿Puede enviar mensajes fuera de la ventana de 24h? */
  abstract canSendOutside24hWindow(): boolean;

  /** Largo máximo de texto en un mensaje */
  abstract getMaxTextLength(): number;

  /** ¿Soporta botones interactivos? */
  abstract supportsButtons(): boolean;

  /** ¿Soporta formato markdown? */
  abstract supportsMarkdown(): boolean;
}

// ============================================================
// REGISTRY: resolver adapter por canal
// ============================================================

const adapterRegistry = new Map<ChannelType, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter) {
  adapterRegistry.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): ChannelAdapter {
  const adapter = adapterRegistry.get(channel);
  if (!adapter) throw new Error(`No adapter registered for channel: ${channel}`);
  return adapter;
}

export function getAllAdapters(): ChannelAdapter[] {
  return Array.from(adapterRegistry.values());
}
