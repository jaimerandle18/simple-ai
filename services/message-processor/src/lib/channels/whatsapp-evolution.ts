/**
 * Evolution API adapter.
 * Self-hosted WhatsApp connector (alternativa a WAHA).
 */
import { ChannelAdapter, NormalizedMessage, SendTextResult } from './base';

export interface EvolutionCredentials {
  evolutionUrl: string;
  apiKey: string;
  instanceName: string;
}

export class EvolutionAdapter extends ChannelAdapter {
  channel = 'whatsapp_evolution' as const;
  private credentials: EvolutionCredentials;

  constructor(credentials: EvolutionCredentials) {
    super();
    this.credentials = credentials;
  }

  setCredentials(creds: EvolutionCredentials) {
    this.credentials = creds;
  }

  parseWebhook(body: any): NormalizedMessage[] {
    if (body.event !== 'messages.upsert') return [];

    const data = body.data;
    if (!data) return [];

    const key = data.key || {};
    if (key.fromMe) return [];

    const msg = data.message || {};
    const textBody = msg.conversation || msg.extendedTextMessage?.text || '';
    if (!textBody) return [];

    const instanceName = body.instance || '';
    const tenantId = instanceName.startsWith('tenant_') ? instanceName.slice('tenant_'.length) : instanceName;
    const remoteJid = key.remoteJid || '';
    const senderPhone = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');

    return [{
      tenantId,
      channel: 'whatsapp_evolution',
      externalUserId: senderPhone,
      externalMessageId: key.id || `evo_${Date.now()}`,
      senderName: data.pushName || senderPhone,
      content: { text: textBody },
      channelMetadata: { instanceName },
      receivedAt: new Date((data.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    }];
  }

  async sendText(args: { tenantId: string; externalUserId: string; text: string }): Promise<SendTextResult> {
    const { evolutionUrl, apiKey, instanceName } = this.credentials;
    const url = `${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: args.externalUserId, text: args.text }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Evolution sendText error (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return { externalMessageId: data?.key?.id || `evo_${Date.now()}` };
  }

  async sendImage(args: { tenantId: string; externalUserId: string; imageUrl: string; caption?: string }): Promise<SendTextResult> {
    const { evolutionUrl, apiKey, instanceName } = this.credentials;
    const url = `${evolutionUrl.replace(/\/$/, '')}/message/sendMedia/${instanceName}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        number: args.externalUserId,
        mediatype: 'image',
        media: args.imageUrl,
        caption: args.caption || '',
      }),
    });

    const data: any = res.ok ? await res.json() : {};
    return { externalMessageId: data?.key?.id || `evo_${Date.now()}` };
  }

  async markAsRead(args: { tenantId: string; externalMessageId: string }): Promise<void> {
    // Evolution: no tiene un endpoint estándar de read
  }

  canSendOutside24hWindow() { return true; }
  getMaxTextLength() { return 4096; }
  supportsButtons() { return false; }
  supportsMarkdown() { return true; }
}
