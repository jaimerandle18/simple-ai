/**
 * WAHA (WhatsApp HTTP API) adapter.
 * Self-hosted WhatsApp connector via Docker.
 */
import { ChannelAdapter, NormalizedMessage, SendTextResult } from './base';

export interface WahaCredentials {
  wahaUrl: string;
  apiKey: string;
  sessionName: string;
}

export class WahaAdapter extends ChannelAdapter {
  channel = 'whatsapp_waha' as const;
  private credentials: WahaCredentials;

  constructor(credentials: WahaCredentials) {
    super();
    this.credentials = credentials;
  }

  setCredentials(creds: WahaCredentials) {
    this.credentials = creds;
  }

  parseWebhook(body: any): NormalizedMessage[] {
    if (body.event !== 'message' || !body.payload) return [];

    const p = body.payload;
    if (p.fromMe) return [];
    if (p.type && p.type !== 'chat') return [];
    if (!p.body) return [];

    const senderPhone = (p.from || '').replace(/@c\.us$/, '').replace(/@g\.us$/, '');
    const sessionName = body.session || 'default';

    return [{
      tenantId: '', // se resuelve via WAHA_SESSION lookup
      channel: 'whatsapp_waha',
      externalUserId: senderPhone,
      externalMessageId: p.id || `waha_${Date.now()}`,
      senderName: p._data?.notifyName || senderPhone,
      content: { text: p.body },
      channelMetadata: { sessionName },
      receivedAt: new Date((p.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    }];
  }

  async sendText(args: { tenantId: string; externalUserId: string; text: string }): Promise<SendTextResult> {
    const { wahaUrl, apiKey, sessionName } = this.credentials;
    const chatId = args.externalUserId.includes('@') ? args.externalUserId : `${args.externalUserId}@c.us`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const res = await fetch(`${wahaUrl}/api/sendText`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chatId, text: args.text, session: sessionName }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WAHA send failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data.id || `waha_${Date.now()}` };
  }

  async sendImage(args: { tenantId: string; externalUserId: string; imageUrl: string; caption?: string }): Promise<SendTextResult> {
    const { wahaUrl, apiKey, sessionName } = this.credentials;
    const chatId = args.externalUserId.includes('@') ? args.externalUserId : `${args.externalUserId}@c.us`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const res = await fetch(`${wahaUrl}/api/sendImage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chatId,
        file: { url: args.imageUrl },
        caption: args.caption || '',
        session: sessionName,
      }),
    });

    const data: any = res.ok ? await res.json() : {};
    return { externalMessageId: data.id || `waha_${Date.now()}` };
  }

  async markAsRead(args: { tenantId: string; externalMessageId: string }): Promise<void> {
    // WAHA no tiene endpoint estándar de read receipt
  }

  canSendOutside24hWindow() { return true; } // WAHA no tiene restricción de ventana
  getMaxTextLength() { return 4096; }
  supportsButtons() { return false; }
  supportsMarkdown() { return true; }
}
