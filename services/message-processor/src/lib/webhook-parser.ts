/**
 * Parsea el payload del webhook de Meta WhatsApp Business API.
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
