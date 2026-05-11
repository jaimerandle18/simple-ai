/**
 * Abstracción de canal: normaliza mensajes de WhatsApp, Instagram y Facebook
 * en un formato unificado para que el pipeline sea agnóstico al canal.
 */

export type ChannelType = 'whatsapp' | 'instagram' | 'facebook' | 'waha' | 'evolution' | 'web';

export interface NormalizedMessage {
  tenantId: string;
  channel: ChannelType;
  channelId: string;           // phoneNumberId, igPageId, fbPageId, etc.
  externalUserId: string;      // phone, igUserId, fbUserId
  userName: string;
  messageId: string;
  timestamp: string;
  content: {
    text?: string;
    audio?: { mediaId: string; mimeType?: string };
    image?: { mediaId: string; mimeType?: string };
    sticker?: { mediaId: string };
  };
  replyTo?: string;            // ID del mensaje al que responde
  channelMetadata?: Record<string, any>;  // datos específicos del canal
}

export interface ChannelConfig {
  channel: ChannelType;
  accessToken: string;
  channelId: string;
  tenantId: string;
  // Límites por canal
  maxMessageLength: number;
  supportsImages: boolean;
  supportsAudio: boolean;
  supportsButtons: boolean;
  messageWindow?: number;      // ventana en horas (IG=24h)
}

const CHANNEL_LIMITS: Record<ChannelType, Partial<ChannelConfig>> = {
  whatsapp: { maxMessageLength: 4096, supportsImages: true, supportsAudio: true, supportsButtons: false },
  instagram: { maxMessageLength: 1000, supportsImages: true, supportsAudio: false, supportsButtons: true, messageWindow: 24 },
  facebook: { maxMessageLength: 2000, supportsImages: true, supportsAudio: false, supportsButtons: true },
  waha: { maxMessageLength: 4096, supportsImages: true, supportsAudio: true, supportsButtons: false },
  evolution: { maxMessageLength: 4096, supportsImages: true, supportsAudio: true, supportsButtons: false },
  web: { maxMessageLength: 10000, supportsImages: true, supportsAudio: false, supportsButtons: false },
};

/**
 * Obtener límites del canal.
 */
export function getChannelLimits(channel: ChannelType): Partial<ChannelConfig> {
  return CHANNEL_LIMITS[channel] || CHANNEL_LIMITS.whatsapp;
}

/**
 * Formatear respuesta para el canal de salida.
 * Aplica límites de longitud y formato específico.
 */
export function formatForChannel(text: string, channel: ChannelType): string {
  const limits = getChannelLimits(channel);
  let formatted = text;

  // Truncar al límite del canal
  if (limits.maxMessageLength && formatted.length > limits.maxMessageLength) {
    formatted = formatted.slice(0, limits.maxMessageLength - 3) + '...';
  }

  // Formateo específico por canal
  switch (channel) {
    case 'whatsapp':
    case 'waha':
    case 'evolution':
      // WhatsApp usa *bold*, _italic_ — ya lo manejamos
      break;
    case 'instagram':
      // IG no soporta markdown, limpiar
      formatted = formatted.replace(/\*/g, '').replace(/_/g, '');
      break;
    case 'facebook':
      // FB soporta algo de markdown
      break;
  }

  return formatted;
}

/**
 * Normalizar un mensaje entrante de cualquier canal al formato unificado.
 * Esto se usa como capa intermedia antes de entrar al pipeline principal.
 */
export function normalizeInbound(
  channel: ChannelType,
  channelId: string,
  tenantId: string,
  raw: {
    userId: string;
    userName: string;
    messageId: string;
    timestamp: string;
    text?: string;
    mediaId?: string;
    mediaType?: 'audio' | 'image' | 'sticker';
    mimeType?: string;
    replyTo?: string;
    metadata?: Record<string, any>;
  },
): NormalizedMessage {
  const content: NormalizedMessage['content'] = {};
  if (raw.text) content.text = raw.text;
  if (raw.mediaType === 'audio' && raw.mediaId) content.audio = { mediaId: raw.mediaId, mimeType: raw.mimeType };
  if (raw.mediaType === 'image' && raw.mediaId) content.image = { mediaId: raw.mediaId, mimeType: raw.mimeType };
  if (raw.mediaType === 'sticker' && raw.mediaId) content.sticker = { mediaId: raw.mediaId };

  return {
    tenantId,
    channel,
    channelId,
    externalUserId: raw.userId,
    userName: raw.userName,
    messageId: raw.messageId,
    timestamp: raw.timestamp,
    content,
    replyTo: raw.replyTo,
    channelMetadata: raw.metadata,
  };
}
