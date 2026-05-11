/**
 * Instagram Direct Messages adapter.
 * Usa la Messenger Platform API de Meta (misma base que FB Messenger).
 *
 * Quirks:
 * - Ventana de 24h estricta (HUMAN_AGENT tag NO disponible)
 * - Sin formato markdown
 * - Stories replies llegan como mensajes normales con story_mention
 * - Comments públicos pueden llegar si se habilita
 * - Imágenes max 8 MB
 * - Audio max 1 MB (limitado)
 */
import { ChannelAdapter, NormalizedMessage, SendTextResult } from './base';

const GRAPH_API_VERSION = 'v25.0';

export interface InstagramCredentials {
  pageId: string;        // Instagram-connected Page ID
  accessToken: string;   // Page access token con permisos instagram_manage_messages
}

export class InstagramAdapter extends ChannelAdapter {
  channel = 'instagram' as const;
  private credentials: InstagramCredentials;

  constructor(credentials: InstagramCredentials) {
    super();
    this.credentials = credentials;
  }

  setCredentials(creds: InstagramCredentials) {
    this.credentials = creds;
  }

  parseWebhook(body: any): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];

    // IG webhooks llegan bajo object: 'instagram'
    if (body.object !== 'instagram') return [];

    for (const entry of body.entry ?? []) {
      for (const messaging of entry.messaging ?? []) {
        const senderId = messaging.sender?.id;
        const recipientId = messaging.recipient?.id;
        if (!senderId || senderId === recipientId) continue; // ignorar propios

        const msg = messaging.message;
        if (!msg) continue;

        const normalized: NormalizedMessage = {
          tenantId: '',
          channel: 'instagram',
          externalUserId: senderId,
          externalMessageId: msg.mid || `ig_${Date.now()}`,
          content: {},
          channelMetadata: {
            pageId: recipientId,
            isStoryReply: !!msg.reply_to?.story,
            isStoryMention: !!msg.attachments?.find((a: any) => a.type === 'story_mention'),
          },
          receivedAt: new Date(messaging.timestamp).toISOString(),
        };

        // Texto
        if (msg.text) {
          normalized.content.text = msg.text;
        }

        // Attachments (imagen, audio, video, sticker)
        if (msg.attachments?.length) {
          for (const att of msg.attachments) {
            switch (att.type) {
              case 'image':
                normalized.content.image = { url: att.payload?.url };
                break;
              case 'audio':
                normalized.content.audio = { url: att.payload?.url };
                break;
              case 'sticker':
                normalized.content.sticker = {};
                break;
              case 'story_mention':
                // Story mention: la imagen está en att.payload.url
                normalized.content.image = { url: att.payload?.url, caption: 'story_mention' };
                normalized.content.text = normalized.content.text || '[Mencionó tu historia]';
                break;
            }
          }
        }

        // Story reply context
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
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Instagram send failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data.message_id || '' };
  }

  async sendImage(args: { tenantId: string; externalUserId: string; imageUrl: string; caption?: string }): Promise<SendTextResult> {
    const { pageId, accessToken } = this.credentials;
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/messages`;

    // IG no soporta caption en imágenes directamente — mandamos imagen + texto separado
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
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Instagram sendImage failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    const imageMessageId = data.message_id || '';

    // Mandar caption como mensaje separado si lo hay
    if (args.caption) {
      await this.sendText({ tenantId: args.tenantId, externalUserId: args.externalUserId, text: args.caption });
    }

    return { externalMessageId: imageMessageId };
  }

  async markAsRead(args: { tenantId: string; externalMessageId: string }): Promise<void> {
    // IG Messaging API no tiene mark-as-read explícito
  }

  // ─── Quirks ────────────────────────────────────────────

  canSendOutside24hWindow() { return false; }  // 24h estricta, sin tags
  getMaxTextLength() { return 1000; }           // IG limita a ~1000 chars
  supportsButtons() { return false; }           // IG DM no soporta botones
  supportsMarkdown() { return false; }          // Sin formato
}
