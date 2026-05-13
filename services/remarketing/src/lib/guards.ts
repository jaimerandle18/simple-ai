/**
 * Reglas hardcoded de remarketing.
 * NINGÚN endpoint permite cambiar estas reglas.
 * Cambiarlas requiere modificar este archivo y deployar.
 */
import { getItem, queryItems, keys } from './dynamo';
import type { GuardResult, NumberHealth } from './types';

// ============================================================
// REGLAS HARDCODED — NO MODIFICABLES POR ENDPOINT
// ============================================================
export const HARDCODED_RULES = {
  warmupSchedule: [
    { minDay: 1,  maxDay: 3,  maxPerDay: 5 },
    { minDay: 4,  maxDay: 7,  maxPerDay: 10 },
    { minDay: 8,  maxDay: 14, maxPerDay: 25 },
    { minDay: 15, maxDay: 21, maxPerDay: 50 },
    { minDay: 22, maxDay: 30, maxPerDay: 75 },
    { minDay: 31, maxDay: Infinity, maxPerDay: 80 },
  ],

  maxOutboundPerDay: 80,
  maxPerContactPerMonth: 4,
  maxPerContactPerDay: 1,
  minVariantsRequired: 5,

  throttleMs: { min: 8000, max: 15000 },

  // Quiet hours: NO enviar entre las 22 y las 9
  quietHours: { from: 22, to: 9 },

  // Solo dias de semana
  validDays: ['mon', 'tue', 'wed', 'thu', 'fri'] as string[],

  // Keywords que activan opt-out automatico
  optOutKeywords: ['BAJA', 'STOP', 'NO', 'BASTA', 'CANCELAR', 'DESUSCRIBIR'],

  // Thresholds para auto-pausa
  autoPauseThresholds: {
    blockRate24h: 0.01,       // > 1%
    reportRate24h: 0.005,     // > 0.5%
    bounceRate24h: 0.05,      // > 5%
    sessionDisconnects1h: 3,
    optOutRateCampaign: 0.03, // > 3%
    undeliveredRate1h: 0.10,  // > 10%
  },

  excludeIfBoughtLastDays: 7,
  excludeIfMessagedLastDays: 14,
} as const;

// ============================================================
// HELPERS DE TIMEZONE
// ============================================================
function getHourInTimezone(date: Date, tz: string): number {
  const str = date.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
  return parseInt(str, 10);
}

function getDayInTimezone(date: Date, tz: string): string {
  const dayIndex = new Date(date.toLocaleString('en-US', { timeZone: tz })).getDay();
  const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return dayMap[dayIndex];
}

// ============================================================
// CALCULO DE MAX POR DIA SEGUN WARM-UP
// ============================================================
export function getWarmupLimit(ageInDays: number): number {
  for (const tier of HARDCODED_RULES.warmupSchedule) {
    if (ageInDays >= tier.minDay && ageInDays <= tier.maxDay) {
      return tier.maxPerDay;
    }
  }
  return HARDCODED_RULES.maxOutboundPerDay;
}

// ============================================================
// canSendMessage — 10 CHECKS DE SEGURIDAD
// ============================================================
export async function canSendMessage(args: {
  tenantId: string;
  contactPhone: string;
  campaignId: string;
  now: Date;
}): Promise<GuardResult> {
  const { tenantId, contactPhone, campaignId, now } = args;

  // 1. Verificar suppression list
  const suppressed = await getItem(keys.suppression(tenantId, contactPhone));
  if (suppressed) {
    return { allowed: false, reason: `suppressed:${suppressed.reason}` };
  }

  // 2. Verificar que el contacto escribio primero (existe contacto en DB)
  const contact = await getItem(keys.contact(tenantId, contactPhone));
  if (!contact) {
    return { allowed: false, reason: 'never_contacted_first' };
  }

  // 3. Verificar cap mensual por contacto (4 msg/mes)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthlyMsgs = await queryItems(
    `TENANT#${tenantId}#CONTACT#${contactPhone}`,
    'REMARKETING_MSG#',
  );
  const monthlyCount = monthlyMsgs.filter(
    (m: any) => m.sentAt && m.sentAt >= thirtyDaysAgo,
  ).length;
  if (monthlyCount >= HARDCODED_RULES.maxPerContactPerMonth) {
    return { allowed: false, reason: 'monthly_cap_reached' };
  }

  // 4. Verificar cap diario por contacto (1 msg/dia)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const dailyCount = monthlyMsgs.filter(
    (m: any) => m.sentAt && m.sentAt >= oneDayAgo,
  ).length;
  if (dailyCount >= HARDCODED_RULES.maxPerContactPerDay) {
    return { allowed: false, reason: 'daily_cap_reached' };
  }

  // 5. Verificar que NO recibio remarketing en ultimos 14 dias
  const fourteenDaysAgo = new Date(now.getTime() - HARDCODED_RULES.excludeIfMessagedLastDays * 24 * 60 * 60 * 1000).toISOString();
  const recentRemarketing = monthlyMsgs.filter(
    (m: any) => m.sentAt && m.sentAt >= fourteenDaysAgo,
  ).length;
  if (recentRemarketing > 0) {
    return { allowed: false, reason: 'recent_remarketing' };
  }

  // 6. Verificar horario valido (quiet hours: 22-9)
  const timezone = 'America/Argentina/Buenos_Aires';
  const hour = getHourInTimezone(now, timezone);
  if (hour >= HARDCODED_RULES.quietHours.from || hour < HARDCODED_RULES.quietHours.to) {
    return { allowed: false, reason: 'quiet_hours' };
  }

  // 7. Verificar dia valido (lun-vie)
  const day = getDayInTimezone(now, timezone);
  if (!HARDCODED_RULES.validDays.includes(day)) {
    return { allowed: false, reason: 'invalid_day' };
  }

  // 8. Verificar tope diario del numero (warm-up schedule)
  const numberHealth = await getItem(keys.numberHealth(tenantId)) as NumberHealth | undefined;
  if (numberHealth) {
    const maxPerDay = getWarmupLimit(numberHealth.ageInDays || 1);
    if (numberHealth.sentToday >= maxPerDay) {
      return { allowed: false, reason: 'daily_number_limit' };
    }

    // 9. Verificar salud del numero
    if (numberHealth.status === 'auto_paused') {
      return { allowed: false, reason: 'number_auto_paused' };
    }
  }

  // 10. Verificar que no se haya enviado ya para esta campana+contacto
  const existingSends = await queryItems(`CAMPAIGN_SEND#${campaignId}`);
  const alreadySent = existingSends.some(
    (s: any) => (s.SK as string).endsWith(contactPhone) && s.status !== 'failed',
  );
  if (alreadySent) {
    return { allowed: false, reason: 'already_sent_this_campaign' };
  }

  return { allowed: true };
}

// ============================================================
// checkNumberHealth — para el health monitor
// ============================================================
export function shouldAutoPause(health: {
  blockRate: number;
  reportRate: number;
  bounceRate: number;
}): { pause: boolean; reason?: string } {
  const t = HARDCODED_RULES.autoPauseThresholds;

  if (health.blockRate > t.blockRate24h) {
    return { pause: true, reason: `block_rate_${(health.blockRate * 100).toFixed(1)}%` };
  }
  if (health.reportRate > t.reportRate24h) {
    return { pause: true, reason: `report_rate_${(health.reportRate * 100).toFixed(1)}%` };
  }
  if (health.bounceRate > t.bounceRate24h) {
    return { pause: true, reason: `bounce_rate_${(health.bounceRate * 100).toFixed(1)}%` };
  }

  return { pause: false };
}

// ============================================================
// isOptOutMessage — detectar keywords de opt-out
// ============================================================
export function isOptOutMessage(text: string): boolean {
  const normalized = text.toUpperCase().trim();
  return HARDCODED_RULES.optOutKeywords.includes(normalized);
}

// ============================================================
// getRandomThrottle — delay entre envios
// ============================================================
export function getRandomThrottle(): number {
  const { min, max } = HARDCODED_RULES.throttleMs;
  return min + Math.random() * (max - min);
}
