/**
 * Parsea el payload del webhook de Meta WhatsApp Business API y de WAHA.
 */

export interface ParsedInboundMessage {
  phoneNumberId: string;
  senderPhone: string;
  senderName: string;
  waMessageId: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document';
  textBody?: string;
  mediaId?: string;
  mimeType?: string;
}

export interface ParsedStatusUpdate {
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string;
  timestamp: string;
}

export type ParseResult =
  | { kind: 'messages'; messages: ParsedInboundMessage[] }
  | { kind: 'statuses'; statuses: ParsedStatusUpdate[] }
  | { kind: 'unknown' };

export function parseWhatsAppWebhook(body: any): ParseResult {
  const messages: ParsedInboundMessage[] = [];
  const statuses: ParsedStatusUpdate[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;

      // Mensajes entrantes
      if (value.messages?.length) {
        for (const msg of value.messages) {
          const contact = value.contacts?.[0];
          const mediaObj = msg.audio || msg.image || msg.video || msg.document;
          messages.push({
            phoneNumberId,
            senderPhone: msg.from,
            senderName: contact?.profile?.name || msg.from,
            waMessageId: msg.id,
            timestamp: msg.timestamp,
            type: msg.type || 'text',
            textBody: msg.text?.body || msg.caption || '',
            mediaId: mediaObj?.id,
            mimeType: mediaObj?.mime_type,
          });
        }
      }

      // Status updates (delivered, read, failed)
      if (value.statuses?.length) {
        for (const s of value.statuses) {
          statuses.push({
            waMessageId: s.id,
            status: s.status as ParsedStatusUpdate['status'],
            recipientId: s.recipient_id,
            timestamp: s.timestamp,
          });
        }
      }
    }
  }

  if (messages.length > 0) return { kind: 'messages', messages };
  if (statuses.length > 0) return { kind: 'statuses', statuses };
  return { kind: 'unknown' };
}

// ─── WAHA ─────────────────────────────────────────────────────

export interface ParsedWahaMessage {
  sessionName: string;
  senderPhone: string;
  senderName: string;
  waMessageId: string;
  timestamp: string;
  textBody: string;
}

export function parseWahaWebhook(body: any): ParsedWahaMessage | null {
  if (body.event !== 'message' || !body.payload) return null;

  const p = body.payload;
  if (p.fromMe) return null;
  if (p.type && p.type !== 'chat') return null;
  if (!p.body) return null;

  const senderPhone = (p.from || '').replace(/@c\.us$/, '').replace(/@g\.us$/, '');
  const sessionName = body.session || 'default';

  return {
    sessionName,
    senderPhone,
    senderName: p._data?.notifyName || senderPhone,
    waMessageId: p.id || `waha_${Date.now()}`,
    timestamp: String(p.timestamp || Math.floor(Date.now() / 1000)),
    textBody: p.body,
  };
}

// ─── Evolution API ─────────────────────────────────────────────

export interface ParsedEvolutionMessage {
  instanceName: string;
  tenantId: string;   // derived from instanceName: "tenant_{uuid}" → "{uuid}"
  senderPhone: string;
  senderName: string;
  waMessageId: string;
  timestamp: string;
  textBody: string;
}

export function parseEvolutionWebhook(body: any): ParsedEvolutionMessage | null {
  if (body.event !== 'messages.upsert') return null;

  const data = body.data;
  if (!data) return null;

  const key = data.key || {};
  if (key.fromMe) return null;

  // Only process text messages
  const msg = data.message || {};
  const textBody = msg.conversation || msg.extendedTextMessage?.text || '';
  if (!textBody) return null;

  const instanceName = body.instance || '';
  const tenantId = instanceName.startsWith('tenant_') ? instanceName.slice('tenant_'.length) : instanceName;
  const remoteJid = key.remoteJid || '';
  const senderPhone = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');

  return {
    instanceName,
    tenantId,
    senderPhone,
    senderName: data.pushName || senderPhone,
    waMessageId: key.id || `evo_${Date.now()}`,
    timestamp: String(data.messageTimestamp || Math.floor(Date.now() / 1000)),
    textBody,
  };
}
