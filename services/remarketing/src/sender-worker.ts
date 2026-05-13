/**
 * Sender Worker Lambda
 * Consume de SQS FIFO (batch size 1).
 *
 * 1. Re-valida todos los guards
 * 2. Selecciona variante
 * 3. Throttle 8-15s
 * 4. Envia via WAHA
 * 5. Registra el envio
 */
import type { SQSEvent } from 'aws-lambda';
import { getItem, putItem, keys, incrementCounter } from './lib/dynamo';
import { canSendMessage, getRandomThrottle } from './lib/guards';
import { pickVariant, fillPlaceholders } from './lib/variants';
import { sendRemarketingMessage } from './lib/waha-sender';
import type { Campaign, CampaignSend, SendJob, RemarketingMessage } from './lib/types';

const WAHA_URL = (process.env.WAHA_URL || '').replace(/\/$/, '');
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

const TTL_90_DAYS = 90 * 24 * 60 * 60;
const TTL_60_DAYS = 60 * 24 * 60 * 60;

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const job: SendJob = JSON.parse(record.body);

    try {
      await processJob(job);
    } catch (err: any) {
      console.error(`[SENDER] Failed for ${job.contactPhone}:`, err.message);

      // Si es bloqueo, agregar a suppression
      if (err.message?.includes('blocked') || err.message?.includes('403')) {
        await putItem({
          ...keys.suppression(job.tenantId, job.contactPhone),
          tenantId: job.tenantId,
          contactPhone: job.contactPhone,
          reason: 'block',
          reasonDetail: err.message.slice(0, 200),
          suppressedAt: new Date().toISOString(),
        });
        console.warn(`[SENDER] Added ${job.contactPhone} to suppression: block`);
      }
    }
  }
};

async function processJob(job: SendJob): Promise<void> {
  const { campaignId, tenantId, contactPhone, contactName, conversationId, relatedProductName } = job;
  const now = new Date();

  // 1. Re-validar TODOS los guards
  const check = await canSendMessage({ tenantId, contactPhone, campaignId, now });
  if (!check.allowed) {
    console.log(`[SENDER] Guard failed for ${contactPhone}: ${check.reason}`);
    return;
  }

  // 2. Cargar campana
  const campaign = await getItem(keys.campaign(tenantId, campaignId)) as Campaign | undefined;
  if (!campaign || campaign.status !== 'active') {
    console.log(`[SENDER] Campaign ${campaignId} not active, skipping`);
    return;
  }

  if (!campaign.variants || campaign.variants.length === 0) {
    console.error(`[SENDER] Campaign ${campaignId} has no variants`);
    return;
  }

  // 3. Seleccionar variante
  const variant = pickVariant(campaign.variants, contactPhone);

  // 4. Reemplazar placeholders
  const messageText = fillPlaceholders(variant.text, {
    nombre: contactName || undefined,
    producto: relatedProductName || undefined,
  });

  // 5. Throttle (CRITICO para anti-spam)
  const delayMs = getRandomThrottle();
  console.log(`[SENDER] Throttle ${Math.round(delayMs)}ms before sending to ${contactPhone}`);
  await new Promise(resolve => setTimeout(resolve, delayMs));

  // 6. Obtener session name del canal WAHA
  const wahaChannel = await getItem(keys.wahaChannel(tenantId));
  const sessionName = (wahaChannel?.sessionName as string) || `tenant_${tenantId}`;

  // 7. Enviar via WAHA
  const sendResult = await sendRemarketingMessage({
    wahaUrl: WAHA_URL,
    apiKey: WAHA_API_KEY,
    sessionName,
    contactPhone,
    text: messageText,
  });

  console.log(`[SENDER] Sent to ${contactPhone}: ${sendResult.externalMessageId}`);

  const sentAt = new Date().toISOString();
  const nowEpoch = Math.floor(Date.now() / 1000);

  // 8. Guardar CampaignSend
  const sendItem: CampaignSend = {
    ...keys.campaignSend(campaignId, sentAt, contactPhone),
    campaignId,
    tenantId,
    contactPhone,
    contactName,
    variantId: variant.id,
    messageText,
    sentAt,
    waMessageId: sendResult.externalMessageId,
    status: 'sent',
    statusUpdates: [{ status: 'sent', at: sentAt }],
    conversationId,
    ttl: nowEpoch + TTL_90_DAYS,
  };
  await putItem(sendItem as unknown as Record<string, unknown>);

  // 9. Guardar en MessageHistory (para caps de frecuencia)
  const msgHistoryItem: RemarketingMessage = {
    ...keys.remarketingMsg(tenantId, contactPhone, sentAt),
    campaignId,
    variantId: variant.id,
    sentAt,
    ttl: nowEpoch + TTL_60_DAYS,
  };
  await putItem(msgHistoryItem as unknown as Record<string, unknown>);

  // 10. Guardar mensaje en la conversacion (para que aparezca en el dashboard)
  const msgId = `msg_rmk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await putItem({
    ...keys.message(conversationId, sentAt, msgId),
    messageId: msgId,
    conversationId,
    tenantId,
    direction: 'outbound',
    sender: 'remarketing',
    type: 'text',
    content: messageText,
    waMessageId: sendResult.externalMessageId,
    status: 'sent',
    timestamp: sentAt,
    remarketingCampaignId: campaignId,
    remarketingVariantId: variant.id,
  });

  // 11. Actualizar conversacion (lastMessageAt, preview)
  const conv = await getItem(keys.conversation(tenantId, conversationId));
  if (conv) {
    await putItem({
      ...conv,
      lastMessageAt: sentAt,
      lastMessagePreview: messageText.slice(0, 100),
    });
  }

  // 12. Incrementar counters
  await incrementCounter(keys.numberHealth(tenantId), 'sentToday');
  await incrementCounter(keys.campaign(tenantId, campaignId), 'stats.totalSent');

  // 13. Incrementar sentCount de la variante (update in-place)
  const freshCampaign = await getItem(keys.campaign(tenantId, campaignId)) as Campaign | undefined;
  if (freshCampaign) {
    const updatedVariants = freshCampaign.variants.map(v =>
      v.id === variant.id ? { ...v, sentCount: v.sentCount + 1 } : v,
    );
    await putItem({
      ...freshCampaign,
      variants: updatedVariants,
      stats: {
        ...freshCampaign.stats,
        totalSent: (freshCampaign.stats.totalSent || 0) + 1,
      },
      updatedAt: sentAt,
    } as unknown as Record<string, unknown>);
  }

  console.log(`[SENDER] Done: ${contactPhone} ← variant ${variant.id} (campaign ${campaignId})`);
}
