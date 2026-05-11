/**
 * WhatsApp Cloud API adapter (Meta Business API).
 * Soporta: texto, imagen, audio, stickers, reactions, read receipts.
 */
import { ChannelAdapter, NormalizedMessage, SendTextResult } from './base';

const WA_API_VERSION = 'v25.0';

/** Meta manda 549XXXXXXXXXX pero WA API necesita 54XXXXXXXXXX (sin el 9) */
function normalizeArgPhone(phone: string): string {
  if (phone.startsWith('549') && phone.length === 13) {
    return '54' + phone.slice(3);
  }
  return phone;
}

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export class WhatsAppAdapter extends ChannelAdapter {
  channel = 'whatsapp' as const;
  private credentials: WhatsAppCredentials;

  constructor(credentials: WhatsAppCredentials) {
    super();
    this.credentials = credentials;
  }

  setCredentials(creds: WhatsAppCredentials) {
    this.credentials = creds;
  }

  // ─── Parse ─────────────────────────────────────────────

  parseWebhook(body: any): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue;

        const phoneNumberId = value.metadata?.phone_number_id;

        for (const msg of value.messages) {
          const contact = value.contacts?.[0];
          const mediaObj = msg.audio || msg.image || msg.video || msg.document;

          const normalized: NormalizedMessage = {
            tenantId: '', // se resuelve después con el channel lookup
            channel: 'whatsapp',
            externalUserId: msg.from,
            externalMessageId: msg.id,
            senderName: contact?.profile?.name || msg.from,
            content: {},
            channelMetadata: { phoneNumberId },
            receivedAt: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
          };

          // Contenido según tipo
          switch (msg.type) {
            case 'text':
              normalized.content.text = msg.text?.body || '';
              break;
            case 'image':
              normalized.content.image = {
                mediaId: mediaObj?.id,
                mimeType: mediaObj?.mime_type,
                caption: msg.caption,
              };
              normalized.content.text = msg.caption || '';
              break;
            case 'audio':
              normalized.content.audio = {
                mediaId: mediaObj?.id,
                mimeType: mediaObj?.mime_type,
              };
              break;
            case 'sticker':
              normalized.content.sticker = { emoji: msg.sticker?.emoji };
              break;
            case 'reaction':
              normalized.content.reaction = {
                emoji: msg.reaction?.emoji || '',
                toMessageId: msg.reaction?.message_id || '',
              };
              break;
            case 'location':
              normalized.content.location = {
                lat: msg.location?.latitude,
                lng: msg.location?.longitude,
              };
              break;
            default:
              normalized.content.text = msg.text?.body || msg.caption || '';
          }

          // Reply context
          if (msg.context?.id) {
            normalized.replyTo = { externalMessageId: msg.context.id };
          }

          messages.push(normalized);
        }
      }
    }

    return messages;
  }

  // ─── Status updates (separado del parse de mensajes) ───

  parseStatusUpdates(body: any): Array<{ waMessageId: string; status: string; recipientId: string; timestamp: string }> {
    const statuses: Array<{ waMessageId: string; status: string; recipientId: string; timestamp: string }> = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.statuses?.length) continue;
        for (const s of value.statuses) {
          statuses.push({
            waMessageId: s.id,
            status: s.status,
            recipientId: s.recipient_id,
            timestamp: s.timestamp,
          });
        }
      }
    }
    return statuses;
  }

  // ─── Send ──────────────────────────────────────────────

  async sendText(args: { tenantId: string; externalUserId: string; text: string; replyTo?: string }): Promise<SendTextResult> {
    const { phoneNumberId, accessToken } = this.credentials;
    const to = normalizeArgPhone(args.externalUserId);
    const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;

    const payload: any = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: args.text },
    };

    if (args.replyTo) {
      payload.context = { message_id: args.replyTo };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp send failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data.messages?.[0]?.id || '' };
  }

  async sendImage(args: { tenantId: string; externalUserId: string; imageUrl: string; caption?: string }): Promise<SendTextResult> {
    const { phoneNumberId, accessToken } = this.credentials;
    const to = normalizeArgPhone(args.externalUserId);
    const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: args.imageUrl, ...(args.caption && { caption: args.caption }) },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp sendImage failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data.messages?.[0]?.id || '' };
  }

  async markAsRead(args: { tenantId: string; externalMessageId: string }): Promise<void> {
    const { phoneNumberId, accessToken } = this.credentials;
    const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;

    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: args.externalMessageId,
      }),
    }).catch(err => console.error('markAsRead error:', err));
  }

  // ─── Quirks ────────────────────────────────────────────

  canSendOutside24hWindow() { return false; } // 24h window estricta
  getMaxTextLength() { return 4096; }
  supportsButtons() { return true; }  // interactive messages
  supportsMarkdown() { return true; }  // *bold*, _italic_, ~strike~
}
