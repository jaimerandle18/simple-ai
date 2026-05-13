// ============================================================
// Remarketing — Tipos internos
// ============================================================

export interface Campaign {
  PK: string;  // TENANT#${tenantId}
  SK: string;  // CAMPAIGN#${campaignId}
  campaignId: string;
  tenantId: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'auto_paused' | 'archived';
  trigger: 'no_reply_post_quote_48h';
  triggerConfig: {
    hoursAfter: number;
    minQuoteAmount?: number;
    productCategories?: string[];
  };
  variants: Variant[];
  filters: {
    excludeIfBoughtLastDays: number;
    excludeIfMessagedLastDays: number;
  };
  timing: {
    daysOfWeek: string[];
    hourFrom: number;
    hourTo: number;
    timezone: string;
  };
  stats: CampaignStats;
  createdAt: string;
  updatedAt: string;
  autoPauseReason?: string;
  autoPausedAt?: string;
}

export interface Variant {
  id: string;
  text: string;  // con placeholders {nombre}, {producto}
  sentCount: number;
  replyCount: number;
}

export interface CampaignStats {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalReplied: number;
  totalSales: number;
  totalRevenue: number;
  blockCount: number;
  optOutCount: number;
}

export interface CampaignSend {
  PK: string;  // CAMPAIGN_SEND#${campaignId}
  SK: string;  // ${timestamp}#${contactPhone}
  campaignId: string;
  tenantId: string;
  contactPhone: string;
  contactName: string;
  variantId: string;
  messageText: string;
  sentAt: string;
  waMessageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'blocked';
  statusUpdates: Array<{ status: string; at: string }>;
  attributedSale?: { saleId: string; amount: number; attributedAt: string };
  conversationId: string;
  ttl: number;  // 90 dias
}

export interface NumberHealth {
  PK: string;  // TENANT#${tenantId}
  SK: string;  // WAHA_NUMBER_HEALTH
  tenantId: string;
  phoneNumber: string;
  ageInDays: number;
  sentToday: number;
  maxPerDay: number;
  last24h: {
    sent: number;
    delivered: number;
    replied: number;
    blocked: number;
    reported: number;
    failed: number;
    blockRate: number;
    reportRate: number;
    deliveryRate: number;
  };
  status: 'healthy' | 'warning' | 'auto_paused';
  statusReason?: string;
  lastChecked: string;
  lastResetDate: string;  // YYYY-MM-DD para saber cuándo resetear sentToday
  warmupStartedAt: string;
  warmupCompletedAt?: string;
}

export interface SuppressionEntry {
  PK: string;  // TENANT#${tenantId}
  SK: string;  // SUPPRESSION#${contactPhone}
  tenantId: string;
  contactPhone: string;
  reason: 'opt_out' | 'block' | 'invalid_number' | 'manual';
  reasonDetail?: string;
  suppressedAt: string;
}

export interface RemarketingMessage {
  PK: string;  // TENANT#${tenantId}#CONTACT#${contactPhone}
  SK: string;  // REMARKETING_MSG#${timestamp}
  campaignId: string;
  variantId: string;
  sentAt: string;
  ttl: number;  // 60 dias
}

export interface SendJob {
  campaignId: string;
  tenantId: string;
  contactPhone: string;
  contactName: string;
  conversationId: string;
  relatedProductName: string;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export const EMPTY_STATS: CampaignStats = {
  totalSent: 0,
  totalDelivered: 0,
  totalRead: 0,
  totalReplied: 0,
  totalSales: 0,
  totalRevenue: 0,
  blockCount: 0,
  optOutCount: 0,
};
