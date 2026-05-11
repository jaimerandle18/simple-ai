/**
 * A/B Testing framework.
 * Asigna variantes deterministicas por tenant+conversation,
 * loguea resultados para análisis posterior.
 */
import { putItem } from './dynamo-helpers';

// ============================================================
// EXPERIMENTOS ACTIVOS
// ============================================================

export interface Experiment {
  id: string;
  description: string;
  variants: string[];       // ['A', 'B'] o ['control', 'haiku', 'sonnet']
  /** Porcentaje por variante (debe sumar 100). Si no se define, split equitativo */
  weights?: number[];
  /** Solo aplica a estos tenants. undefined = todos */
  tenantIds?: string[];
  active: boolean;
}

// Configurar experimentos acá. En el futuro se pueden cargar de DynamoDB.
const EXPERIMENTS: Experiment[] = [
  // Ejemplo desactivado:
  // {
  //   id: 'trivial_model',
  //   description: 'Haiku vs Sonnet para mensajes triviales',
  //   variants: ['haiku', 'sonnet'],
  //   active: false,
  // },
];

// ============================================================
// VARIANT ASSIGNMENT (determinístico por hash)
// ============================================================

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export function chooseVariant(
  experimentId: string,
  tenantId: string,
  conversationId: string,
): string | null {
  const exp = EXPERIMENTS.find(e => e.id === experimentId && e.active);
  if (!exp) return null;

  // Filtro por tenant
  if (exp.tenantIds && !exp.tenantIds.includes(tenantId)) return null;

  const hash = simpleHash(`${experimentId}:${tenantId}:${conversationId}`);
  const variants = exp.variants;

  if (exp.weights) {
    // Weighted assignment
    const total = exp.weights.reduce((a, b) => a + b, 0);
    const bucket = hash % total;
    let cumulative = 0;
    for (let i = 0; i < variants.length; i++) {
      cumulative += exp.weights[i];
      if (bucket < cumulative) return variants[i];
    }
    return variants[variants.length - 1];
  }

  // Equal split
  return variants[hash % variants.length];
}

// ============================================================
// LOGGING
// ============================================================

export interface ABLogEntry {
  experimentId: string;
  variant: string;
  tenantId: string;
  conversationId: string;
  messageId: string;
  // Métricas
  modelUsed: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  escalated: boolean;
  conversationLength: number;
  userFrustration: boolean;
}

export async function logABResult(entry: ABLogEntry): Promise<void> {
  const now = new Date().toISOString();
  try {
    await putItem({
      PK: `ABTEST#${entry.experimentId}`,
      SK: `${now}#${entry.messageId}`,
      ...entry,
      timestamp: now,
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 días
    });
  } catch (err) {
    // Non-blocking: si falla el log, no rompemos el pipeline
    console.error('[AB_TEST] Log failed:', err);
  }
}

// ============================================================
// CONSOLE LOG (para CloudWatch, siempre activo)
// ============================================================

export function logABConsole(
  experimentId: string,
  variant: string,
  extras: Record<string, any> = {},
): void {
  console.log(JSON.stringify({
    type: 'AB_TEST',
    experimentId,
    variant,
    ...extras,
  }));
}

// ============================================================
// TURN METRICS (se loguea en cada turno, independiente de A/B)
// ============================================================

export interface TurnMetrics {
  tenantId: string;
  conversationId: string;
  messageId: string;
  channel: string;
  modelUsed: string;
  complexity: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  toolCallCount: number;
  productsShown: number;
  imagessSent: number;
  escalated: boolean;
}

export async function logTurnMetrics(metrics: TurnMetrics): Promise<void> {
  const now = new Date().toISOString();
  const dayKey = now.slice(0, 10); // YYYY-MM-DD

  try {
    await putItem({
      PK: `METRICS#${metrics.tenantId}`,
      SK: `TURN#${now}#${metrics.messageId}`,
      ...metrics,
      timestamp: now,
      dayKey,
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 días
    });
  } catch {
    // Non-blocking
  }

  // Structured log para CloudWatch
  console.log(JSON.stringify({ type: 'TURN_METRICS', ...metrics }));
}
