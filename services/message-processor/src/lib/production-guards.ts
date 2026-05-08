/**
 * Guards de producción: escalamiento, circuit breaker, rate limiting, logging, injection
 */
import { getItem, putItem } from './dynamo-helpers';

// ========== 1. GATING DE ESCALAMIENTO HUMANO ==========

const CRITICAL_PATTERNS = [
  /abogado|denuncia|estafa|defensa\s*del\s*consumidor|judicial|legal/i,
  /hablar\s*con\s*(alguien|persona|humano|encargado|due[ñn]o)/i,
  /pasame\s*con|atiende\s*alguien|quiero\s*hablar/i,
  /voy\s*a\s*denunciar/i,
];

export function shouldEscalate(
  message: string,
  state: { needsHuman?: boolean; reboundCount?: number },
): { escalate: boolean; reason: string } {
  // Ya fue escalado antes
  if (state.needsHuman) {
    return { escalate: true, reason: 'previously_escalated' };
  }

  // Palabras críticas
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(message)) {
      return { escalate: true, reason: 'critical_keyword' };
    }
  }

  // 3+ rebotes seguidos
  if ((state.reboundCount || 0) >= 3) {
    return { escalate: true, reason: 'rebound_limit' };
  }

  return { escalate: false, reason: '' };
}

// ========== 2. CIRCUIT BREAKER ==========

let consecutiveFailures = 0;
let degradedUntil = 0;

const FALLBACK_MESSAGE = 'Estoy teniendo un problema técnico, en un ratito te respondo. Si es urgente avisame y te paso con alguien del equipo';

export function isCircuitOpen(): boolean {
  if (degradedUntil > 0 && Date.now() < degradedUntil) return true;
  if (degradedUntil > 0 && Date.now() >= degradedUntil) {
    degradedUntil = 0;
    consecutiveFailures = 0;
  }
  return false;
}

export function recordSuccess() {
  consecutiveFailures = 0;
}

export function recordFailure(): boolean {
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    degradedUntil = Date.now() + 5 * 60 * 1000; // degradado 5 min
    console.error(`Circuit breaker OPEN: ${consecutiveFailures} consecutive failures`);
    return true; // circuit opened
  }
  return false;
}

export function getFallbackMessage(): string {
  return FALLBACK_MESSAGE;
}

// ========== 3. RATE LIMITING ==========

export async function checkRateLimit(
  contactPhone: string,
): Promise<{ allowed: boolean; message?: string }> {
  const key = { PK: `RATE#${contactPhone}`, SK: 'MINUTE' };

  try {
    const item = await getItem(key);
    const now = Date.now();
    const windowStart = item?.windowStart as number || 0;
    const count = item?.count as number || 0;

    // Ventana de 1 minuto
    if (now - windowStart < 60000) {
      if (count >= 20) {
        console.log(`Rate limit hit: ${contactPhone} (${count} msgs in 1 min)`);
        return {
          allowed: false,
          message: 'Recibí varios mensajes seguidos, dame un momento que los proceso',
        };
      }
      // Incrementar
      await putItem({ ...key, windowStart, count: count + 1, ttl: Math.floor(now / 1000) + 120 });
    } else {
      // Nueva ventana
      await putItem({ ...key, windowStart: now, count: 1, ttl: Math.floor(now / 1000) + 120 });
    }
  } catch {
    // Si falla el rate limit, dejá pasar (fail open)
  }

  return { allowed: true };
}

// ========== 4. LOGGING ESTRUCTURADO ==========

export interface TurnLog {
  conversationId: string;
  messageId: string;
  timestamp: string;
  userMessage: string;
  faqCacheHit: boolean;
  routerIntent?: string;
  routerConfidence?: number;
  routerEntities?: Record<string, any>;
  routerLatencyMs?: number;
  selectedNode: string;
  llmModel?: string;
  llmLatencyMs?: number;
  guardrailPassed?: boolean;
  guardrailFailures?: string[];
  guardrailRetries?: number;
  finalResponseSent: string;
  imagesSent: number;
  escalatedToHuman: boolean;
  escalationReason?: string;
  totalLatencyMs: number;
  productSource?: string;
  productsCount?: number;
  stateBefore?: any;
  stateAfter?: any;
}

export function logTurn(log: TurnLog) {
  // Log estructurado a CloudWatch
  console.log(JSON.stringify({
    type: 'TURN_LOG',
    ...log,
    // Truncar campos largos para no explotar CloudWatch
    userMessage: log.userMessage.slice(0, 200),
    finalResponseSent: log.finalResponseSent.slice(0, 200),
  }));
}

// ========== 5. DETECCIÓN DE PROMPT INJECTION ==========

const INJECTION_PATTERNS = [
  /ignor[áa]\s+(tus|las|todas)\s+(instrucciones|reglas)/i,
  /system\s*prompt/i,
  /act[úu]a\s+como\s+si\s+fueras/i,
  /olvid[áa]\s+todo/i,
  /eres\s+ahora\s+/i,
  /jailbreak/i,
  /forget\s+(all|your|everything)/i,
  /ignore\s+(previous|all|your)/i,
  /you\s+are\s+now/i,
  /DAN\s*mode/i,
];

export function detectInjection(message: string): boolean {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      console.log(`Prompt injection detected: ${message.slice(0, 50)}`);
      return true;
    }
  }
  return false;
}

export const INJECTION_RESPONSE = 'No puedo ayudarte con eso. ¿Hay algo de nuestros productos que te interese?';
