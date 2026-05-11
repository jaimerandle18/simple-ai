import { queryItems } from './dynamo-helpers';
import type { EnrichedProduct } from './types';

// ============================================================
// CACHE EN MEMORIA (TTL 5 min) — evita reload en cada mensaje
// ============================================================
const catalogCache = new Map<string, { data: EnrichedProduct[]; ts: number }>();
const CATALOG_TTL_MS = 5 * 60 * 1000;

export async function getCachedCatalog(tenantId: string): Promise<EnrichedProduct[]> {
  const cached = catalogCache.get(tenantId);
  if (cached && Date.now() - cached.ts < CATALOG_TTL_MS) {
    console.log(`[CATALOG] Cache hit for ${tenantId} (${cached.data.length} products)`);
    return cached.data;
  }
  const data = await loadCatalog(tenantId);
  catalogCache.set(tenantId, { data, ts: Date.now() });
  console.log(`[CATALOG] Loaded & cached ${data.length} products for ${tenantId}`);
  return data;
}

export async function loadCatalog(tenantId: string): Promise<EnrichedProduct[]> {
  const items = await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 1500 });
  return items
    .filter((p: any) => p.name && p.name.length > 2)
    .filter((p: any) => p.priceNum && p.priceNum > 0)
    .map((p: any) => ({
      ...p,
      priceNum: typeof p.priceNum === 'number' ? p.priceNum : parseInt(p.priceNum) || 0,
      attributes: p.attributes || {},
      usosRecomendados: p.usosRecomendados || [],
      publico: p.publico || [],
      searchableText: p.searchableText || buildSearchableText(p),
    })) as EnrichedProduct[];
}

function buildSearchableText(p: any): string {
  return [p.name, p.brand, p.category, p.description, ...(p.usosRecomendados || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function detectDominantCategory(products: EnrichedProduct[]): string | null {
  const counts: Record<string, number> = {};
  for (const p of products) {
    if (p.categoryNormalized) counts[p.categoryNormalized] = (counts[p.categoryNormalized] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  if (sorted[0][1] >= products.length * 0.5) return sorted[0][0];
  return null;
}
