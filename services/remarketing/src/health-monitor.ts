/**
 * Health Monitor Lambda
 * EventBridge cron cada 15 minutos.
 *
 * 1. Revisa metricas de envio de las ultimas 24h por tenant
 * 2. Si block rate o report rate superan thresholds, auto-pausa
 * 3. Resetea counters diarios si cambio de dia
 */
import { scanTenants, getItem, putItem, queryItems, queryAllItems, keys } from './lib/dynamo';
import { shouldAutoPause, HARDCODED_RULES, getWarmupLimit } from './lib/guards';
import type { NumberHealth, Campaign } from './lib/types';

export const handler = async (): Promise<void> => {
  const now = new Date();
  console.log(`[HEALTH] Starting check at ${now.toISOString()}`);

  const tenants = await scanTenants();

  for (const tenant of tenants) {
    const tenantId = (tenant.PK as string).replace('TENANT#', '');

    try {
      await checkTenantHealth(tenantId, now);
    } catch (err) {
      console.error(`[HEALTH] Error checking tenant ${tenantId}:`, err);
    }
  }

  console.log(`[HEALTH] Done`);
};

async function checkTenantHealth(tenantId: string, now: Date): Promise<void> {
  // Verificar que tiene canal WAHA activo
  const wahaChannel = await getItem(keys.wahaChannel(tenantId));
  if (!wahaChannel?.active) return;

  // Verificar que tiene campanas (activas o pausadas)
  const campaigns = await queryItems(`TENANT#${tenantId}`, 'CAMPAIGN#');
  const relevantCampaigns = campaigns.filter(
    (c: any) => c.status === 'active' || c.status === 'paused',
  );
  if (relevantCampaigns.length === 0) return;

  // Cargar o crear NumberHealth
  let health = await getItem(keys.numberHealth(tenantId)) as NumberHealth | undefined;

  if (!health) {
    health = createDefaultHealth(tenantId, now);
    await putItem(health as unknown as Record<string, unknown>);
    console.log(`[HEALTH] Created default health for tenant ${tenantId}`);
    return;
  }

  // Reset diario si cambio de dia
  const todayStr = getTodayString(now);
  if (health.lastResetDate !== todayStr) {
    health.sentToday = 0;
    health.lastResetDate = todayStr;
    console.log(`[HEALTH] Daily reset for tenant ${tenantId}`);
  }

  // Calcular metricas de las ultimas 24h desde CampaignSend
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const allSends: any[] = [];

  for (const campaign of relevantCampaigns) {
    const sends = await queryAllItems(`CAMPAIGN_SEND#${(campaign as any).campaignId}`);
    const recentSends = sends.filter((s: any) => s.sentAt && s.sentAt >= twentyFourHoursAgo);
    allSends.push(...recentSends);
  }

  const sent = allSends.length;
  const blocked = allSends.filter((s: any) => s.status === 'blocked').length;
  const failed = allSends.filter((s: any) => s.status === 'failed').length;
  const delivered = allSends.filter((s: any) => ['delivered', 'read', 'replied'].includes(s.status)).length;
  const replied = allSends.filter((s: any) => s.status === 'replied').length;
  const reported = 0; // WAHA no reporta esto directamente, lo trackeamos si llega

  const blockRate = sent > 0 ? blocked / sent : 0;
  const reportRate = sent > 0 ? reported / sent : 0;
  const bounceRate = sent > 0 ? failed / sent : 0;
  const deliveryRate = sent > 0 ? delivered / sent : 0;

  // Actualizar last24h
  health.last24h = { sent, delivered, replied, blocked, reported, failed, blockRate, reportRate, deliveryRate };

  // Calcular edad y warmup limit
  const warmupStart = new Date(health.warmupStartedAt || now.toISOString()).getTime();
  health.ageInDays = Math.max(1, Math.ceil((now.getTime() - warmupStart) / (24 * 60 * 60 * 1000)));
  health.maxPerDay = getWarmupLimit(health.ageInDays);

  // Verificar auto-pausa
  const pauseCheck = shouldAutoPause({ blockRate, reportRate, bounceRate });

  if (pauseCheck.pause && health.status !== 'auto_paused') {
    console.warn(`[HEALTH] AUTO-PAUSE tenant ${tenantId}: ${pauseCheck.reason}`);

    health.status = 'auto_paused';
    health.statusReason = pauseCheck.reason;

    // Pausar todas las campanas activas
    const activeCampaigns = campaigns.filter((c: any) => c.status === 'active');
    for (const campaign of activeCampaigns) {
      await putItem({
        ...campaign,
        status: 'auto_paused',
        autoPauseReason: pauseCheck.reason,
        autoPausedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      } as Record<string, unknown>);
      console.warn(`[HEALTH] Paused campaign ${(campaign as any).campaignId}: ${pauseCheck.reason}`);
    }
  } else if (!pauseCheck.pause && health.status === 'auto_paused') {
    // No reactivar automaticamente — requiere intervencion manual del operador
    console.log(`[HEALTH] Tenant ${tenantId} still auto_paused, metrics improved but manual reactivation required`);
  } else if (!pauseCheck.pause) {
    health.status = sent > 0 && blockRate > 0.005 ? 'warning' : 'healthy';
    health.statusReason = undefined;
  }

  health.lastChecked = now.toISOString();

  await putItem(health as unknown as Record<string, unknown>);

  console.log(`[HEALTH] Tenant ${tenantId}: status=${health.status}, sent24h=${sent}, blockRate=${(blockRate * 100).toFixed(1)}%, age=${health.ageInDays}d, maxPerDay=${health.maxPerDay}`);
}

function createDefaultHealth(tenantId: string, now: Date): NumberHealth {
  return {
    ...keys.numberHealth(tenantId),
    tenantId,
    phoneNumber: '',
    ageInDays: 1,
    sentToday: 0,
    maxPerDay: HARDCODED_RULES.warmupSchedule[0].maxPerDay,
    last24h: {
      sent: 0, delivered: 0, replied: 0, blocked: 0, reported: 0, failed: 0,
      blockRate: 0, reportRate: 0, deliveryRate: 0,
    },
    status: 'healthy',
    lastChecked: now.toISOString(),
    lastResetDate: getTodayString(now),
    warmupStartedAt: now.toISOString(),
  };
}

function getTodayString(date: Date): string {
  // Usar timezone de Argentina para determinar el dia
  const parts = date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return parts; // YYYY-MM-DD format
}
