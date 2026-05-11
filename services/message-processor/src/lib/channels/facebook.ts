/**
 * Facebook Messenger adapter.
 * Usa la Messenger Platform API de Meta.
 *
 * Quirks:
 * - Ventana de 24h, PERO con message tags (HUMAN_AGENT, etc.)
 * - Markdown limitado (bold, italic)
 * - Soporta botones (quick replies, templates)
 * - Imágenes max 25 MB
 * - Audio max 25 MB
 */
import { ChannelAdapter, NormalizedMessage, SendTextResult } from './base';

const GRAPH_API_VERSION = 'v25.0';

export interface FacebookCredentials {
  pageId: string;
  accessToken: string; // Page access token con permisos pages_messaging
}

export class FacebookAdapter extends ChannelAdapter {
  channel = 'facebook' as const;
  private credentials: FacebookCredentials;

  constructor(credentials: FacebookCredentials) {
    super();
    this.credentials = credentials;
  }

  setCredentials(creds: FacebookCredentials) {
    this.credentials = creds;
  }

  parseWebhook(body: any): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];

    if (body.object !== 'page') return [];

    for (const entry of body.entry ?? []) {
      for (const messaging of entry.messaging ?? []) {
        const senderId = messaging.sender?.id;
        const recipientId = messaging.recipient?.id;
        if (!senderId || senderId === recipientId) continue;

        const msg = messaging.message;
        if (!msg) continue;

        // Ignorar echos (mensajes enviados por nosotros)
        if (msg.is_echo) continue;

        const normalized: NormalizedMessage = {
          tenantId: '',
          channel: 'facebook',
          externalUserId: senderId,
          externalMessageId: msg.mid || `fb_${Date.now()}`,
          content: {},
          channelMetadata: {
            pageId: recipientId,
            threadId: messaging.thread?.id,
          },
          receivedAt: new Date(messaging.timestamp).toISOString(),
        };

        if (messaging.thread?.id) {
          normalized.externalConversationId = messaging.thread.id;
        }

        // Texto
        if (msg.text) {
          normalized.content.text = msg.text;
        }

        // Quick reply
        if (msg.quick_reply?.payload) {
          normalized.content.text = msg.quick_reply.payload;
          normalized.channelMetadata.quickReplyPayload = msg.quick_reply.payload;
        }

        // Attachments
        if (msg.attachments?.length) {
          for (const att of msg.attachments) {
            switch (att.type) {
              case 'image':
                normalized.content.image = { url: att.payload?.url };
                break;
              case 'audio':
                normalized.content.audio = { url: att.payload?.url };
                break;
              case 'location':
                normalized.content.location = {
                  lat: att.payload?.coordinates?.lat,
                  lng: att.payload?.coordinates?.long,
                };
                break;
              case 'sticker':
                normalized.content.sticker = {};
                break;
            }
          }
        }

        // Reply context
        if (msg.reply_to?.mid) {
          normalized.replyTo = { externalMessageId: msg.reply_to.mid };
        }

        messages.push(normalized);
      }
    }

    return messages;
  }

  async sendText(args: { tenantId: string; externalUserId: string; text: string; replyTo?: string }): Promise<SendTextResult> {
    const { pageId, accessToken } = this.credentials;
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/messages`;

    const payload: any = {
      recipient: { id: args.externalUserId },
      message: { text: args.text },
      messaging_type: 'RESPONSE',
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Facebook send failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data.message_id || '' };
  }

  /** Enviar fuera de ventana 24h usando HUMAN_AGENT tag */
  async sendTextWithTag(args: { tenantId: string; externalUserId: string; text: string; tag: string }): Promise<SendTextResult> {
    const { pageId, accessToken } = this.credentials;
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: args.externalUserId },
        message: { text: args.text },
        messaging_type: 'MESSAGE_TAG',
        tag: args.tag, // 'HUMAN_AGENT', 'CONFIRMED_EVENT_UPDATE', etc.
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Facebook sendWithTag failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data.message_id || '' };
  }

  async sendImage(args: { tenantId: string; externalUserId: string; imageUrl: string; caption?: string }): Promise<SendTextResult> {
    const { pageId, accessToken } = this.credentials;
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: args.externalUserId },
        message: {
          attachment: {
            type: 'image',
            payload: { url: args.imageUrl, is_reusable: true },
          },
        },
        messaging_type: 'RESPONSE',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Facebook sendImage failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    const imageMessageId = data.message_id || '';

    // Caption como mensaje separado (FB no soporta caption en attachment)
    if (args.caption) {
      await this.sendText({ tenantId: args.tenantId, externalUserId: args.externalUserId, text: args.caption });
    }

    return { externalMessageId: imageMessageId };
  }

  async markAsRead(_args: { tenantId: string; externalMessageId: string }): Promise<void> {
    // FB Messenger mark_seen requiere recipient.id que no tenemos aquí
    // Se puede implementar guardando el sender en el channelMetadata
  }

  // ─── Quirks ────────────────────────────────────────────

  canSendOutside24hWindow() { return true; }  // con HUMAN_AGENT tag
  getMaxTextLength() { return 2000; }
  supportsButtons() { return true; }           // quick replies + templates
  supportsMarkdown() { return true; }          // limitado
}
