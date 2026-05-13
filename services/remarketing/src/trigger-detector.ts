/**
 * Trigger Detector Lambda
 * EventBridge cron cada 5 minutos.
 *
 * Busca conversaciones donde:
 * 1. Canal es WAHA
 * 2. Ultimo mensaje fue outbound (el bot respondio, el cliente no contesto)
 * 3. lastMessageAt entre 48h y 96h atras
 * 4. Conversacion abierta, asignada al bot
 *
 * Encola SendJob en SQS FIFO para el sender-worker.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { scanTenants, getItem, queryItems, queryAllItems, keys } from './lib/dynamo';
import { canSendMessage } from './lib/guards';
import type { Campaign, SendJob } from './lib/types';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.REMARKETING_QUEUE_URL!;

const FORTY_EIGHT_H = 48 * 60 * 60 * 1000;
const NINETY_SIX_H = 96 * 60 * 60 * 1000;

export const handler = async (): Promise<void> => {
  const now = new Date();
  console.log(`[TRIGGER] Starting scan at ${now.toISOString()}`);

  // 1. Listar tenants
  const tenants = await scanTenants();
  console.log(`[TRIGGER] Found ${tenants.length} tenants`);

  let totalEnqueued = 0;

  for (const tenant of tenants) {
    const tenantId = (tenant.PK as string).replace('TENANT#', '');

    try {
      await processTenant(tenantId, now);
    } catch (err) {
      console.error(`[TRIGGER] Error processing tenant ${tenantId}:`, err);
    }
  }

  console.log(`[TRIGGER] Done. Total enqueued: ${totalEnqueued}`);

  async function processTenant(tenantId: string, now: Date) {
    // Verificar canal WAHA activo
    const wahaChannel = await getItem(keys.wahaChannel(tenantId));
    if (!wahaChannel?.active) return;

    const sessionName = (wahaChannel.sessionName as string) || `tenant_${tenantId}`;

    // Listar campanas activas
    const campaigns = await queryItems(`TENANT#${tenantId}`, 'CAMPAIGN#');
    const activeCampaigns = campaigns.filter(
      (c: any) => c.status === 'active' && c.trigger === 'no_reply_post_quote_48h',
    ) as Campaign[];

    if (activeCampaigns.length === 0) return;

    console.log(`[TRIGGER] Tenant ${tenantId}: ${activeCampaigns.length} active campaigns`);

    // Traer todas las conversaciones del tenant
    const conversations = await queryAllItems(`TENANT#${tenantId}`, 'CONV#');

    // Filtrar candidatos
    const nowMs = now.getTime();
    const candidates = conversations.filter((conv: any) => {
      if (conv.channel !== 'whatsapp_waha') return false;
      if (conv.status !== 'open') return false;
      if (conv.assignedTo && conv.assignedTo !== 'bot') return false;

      const lastMsgTime = new Date(conv.lastMessageAt || '').getTime();
      if (isNaN(lastMsgTime)) return false;

      const elapsed = nowMs - lastMsgTime;
      return elapsed >= FORTY_EIGHT_H && elapsed <= NINETY_SIX_H;
    });

    console.log(`[TRIGGER] Tenant ${tenantId}: ${candidates.length} candidate conversations (48-96h window)`);

    for (const conv of candidates) {
      const conversationId = conv.conversationId as string;
      const contactPhone = conv.contactPhone as string;
      const contactName = (conv.contactName as string) || '';

      // Verificar que el ultimo mensaje fue outbound
      const lastMsgs = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 1 });
      if (lastMsgs.length === 0) continue;
      if ((lastMsgs[0] as any).direction !== 'outbound') continue;

      // Extraer producto del convState si existe
      const recentProducts = (conv.convState?.recentProducts || []) as any[];
      const relatedProductName = recentProducts[0]?.name || '';

      // Evaluar para cada campana activa
      for (const campaign of activeCampaigns) {
        const check = await canSendMessage({
          tenantId,
          contactPhone,
          campaignId: campaign.campaignId,
          now,
        });

        if (!check.allowed) {
          console.log(`[TRIGGER] Skip ${contactPhone} for ${campaign.campaignId}: ${check.reason}`);
          continue;
        }

        // Encolar SendJob
        const job: SendJob = {
          campaignId: campaign.campaignId,
          tenantId,
          contactPhone,
          contactName,
          conversationId,
          relatedProductName,
        };

        await sqs.send(new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageGroupId: `tenant_${tenantId}`,
          MessageDeduplicationId: `${campaign.campaignId}_${contactPhone}_${Math.floor(nowMs / FORTY_EIGHT_H)}`,
          MessageBody: JSON.stringify(job),
        }));

        totalEnqueued++;
        console.log(`[TRIGGER] Enqueued: ${contactPhone} → campaign ${campaign.campaignId}`);
      }
    }
  }
};
