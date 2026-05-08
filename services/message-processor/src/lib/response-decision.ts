import type { ExtractedIntent, SearchResult, ResponseStrategy } from './types';

export function decideResponse(intent: ExtractedIntent, search: SearchResult): ResponseStrategy {
  // Non-product intents → canned
  const cannedMap: Record<string, string> = {
    greeting: 'GREETING', farewell: 'FAREWELL', thanks: 'THANKS',
    shipping: 'SHIPPING', payment: 'PAYMENT', hours: 'HOURS', location: 'LOCATION',
    returns: 'RETURNS', warranty: 'WARRANTY', off_topic: 'OFF_TOPIC',
    complaint: 'ESCALATE', human_request: 'ESCALATE',
  };

  if (cannedMap[intent.intent]) {
    return { mode: 'canned', template: cannedMap[intent.intent], context: intent.entities };
  }

  if (intent.intent === 'ambiguous') {
    if (intent.entities.motivo === 'broad_query') {
      return { mode: 'canned', template: 'BROAD_QUERY', context: intent.entities };
    }
    return { mode: 'clarify', reason: 'no_understood' };
  }

  // Product intents → según resultados
  const total = search.primary.length + search.alternatives.length;

  if (total === 0) return { mode: 'canned', template: 'NO_RESULTS', context: intent.entities };

  if (search.primary.length === 0 && search.alternatives.length > 0) {
    return { mode: 'llm', primary: search.alternatives.slice(0, 1), alternatives: search.alternatives.slice(1, 3) };
  }

  if (search.primary.length >= 1 && search.primary.length <= 3) {
    return { mode: 'llm', primary: search.primary, alternatives: search.alternatives.slice(0, 2) };
  }

  // 4+ → pedir más criterio
  return { mode: 'canned', template: 'TOO_MANY_RESULTS', context: { count: total, sample: search.primary.slice(0, 3) } };
}
