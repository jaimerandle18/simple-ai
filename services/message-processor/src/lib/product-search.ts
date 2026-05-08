import Fuse from 'fuse.js';
import type { EnrichedProduct, ExtractedIntent, SearchResult } from './types';

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function searchProducts(
  intent: ExtractedIntent,
  catalog: EnrichedProduct[],
  state: { recentProducts: EnrichedProduct[]; activeCategory: string | null },
): SearchResult {
  const ent = intent.entities;

  if (intent.intent === 'list_compare') return compareInList(state.recentProducts, ent);
  if (intent.intent === 'list_select') return selectFromList(state.recentProducts, ent);
  if (intent.intent === 'list_extend') return extendInList(state.recentProducts, ent);
  if (intent.intent === 'price_question' && state.recentProducts.length > 0) {
    // Si hay productos recientes, responder sobre esos
    return { primary: state.recentProducts, alternatives: [], totalMatches: state.recentProducts.length };
  }
  if (intent.intent === 'product_use_search' && ent.uso) return searchByUse(ent.uso, catalog, state.activeCategory);

  return searchGeneral(ent, catalog, state.activeCategory);
}

function compareInList(products: EnrichedProduct[], ent: ExtractedIntent['entities']): SearchResult {
  const atributo = (ent.atributo_comparacion || '').toLowerCase();
  const dir = ent.direccion_comparacion || 'max';

  const getters: Record<string, (p: EnrichedProduct) => number | undefined> = {
    precio: p => p.priceNum,
    potencia: p => p.attributes?.potencia_w,
    capacidad: p => p.attributes?.capacidad_l,
    voltaje: p => p.attributes?.voltaje_v,
    presion: p => p.attributes?.presion_bar,
    diametro: p => p.attributes?.diametro_mm,
    calidad: p => p.priceNum, // heurística: más caro = mejor calidad
    funcionamiento: p => p.attributes?.potencia_w ?? p.priceNum,
  };

  const getter = getters[atributo];
  if (!getter) return { primary: products, alternatives: [], totalMatches: products.length };

  const withVal = products
    .map(p => ({ p, val: getter(p) }))
    .filter((x): x is { p: EnrichedProduct; val: number } => typeof x.val === 'number');

  if (withVal.length === 0) return { primary: products, alternatives: [], totalMatches: products.length };

  withVal.sort((a, b) => dir === 'min' ? a.val - b.val : b.val - a.val);
  return { primary: [withVal[0].p], alternatives: withVal.slice(1).map(x => x.p), totalMatches: withVal.length };
}

function selectFromList(products: EnrichedProduct[], ent: ExtractedIntent['entities']): SearchResult {
  if (ent.referencia_ordinal && ent.referencia_ordinal <= products.length) {
    return { primary: [products[ent.referencia_ordinal - 1]], alternatives: [], totalMatches: 1 };
  }

  if (ent.referencia_atributo) {
    const ref = normalize(ent.referencia_atributo);
    const match = products.find(p =>
      p.searchableText.includes(ref) ||
      Object.values(p.attributes || {}).some(v => String(v).includes(ref.replace(/\D/g, '')))
    );
    if (match) return { primary: [match], alternatives: [], totalMatches: 1 };
  }

  return { primary: [], alternatives: products, totalMatches: 0 };
}

function extendInList(products: EnrichedProduct[], ent: ExtractedIntent['entities']): SearchResult {
  let filtered = [...products];

  if (ent.color) filtered = filtered.filter(p => p.searchableText.includes(normalize(ent.color!)));
  if (ent.uso) {
    const usoNorm = normalize(ent.uso);
    filtered = filtered.filter(p =>
      p.usosRecomendados.some(u => normalize(u).includes(usoNorm) || usoNorm.includes(normalize(u))) ||
      p.searchableText.includes(usoNorm)
    );
  }
  if (ent.precio_max) filtered = filtered.filter(p => p.priceNum <= ent.precio_max!);

  if (filtered.length === 0) return { primary: products, alternatives: [], totalMatches: products.length };
  return { primary: filtered.slice(0, 3), alternatives: filtered.slice(3), totalMatches: filtered.length };
}

function searchByUse(uso: string, catalog: EnrichedProduct[], activeCategory: string | null): SearchResult {
  const usoNorm = normalize(uso);

  let matches = catalog.filter(p =>
    p.usosRecomendados.some(u => normalize(u).includes(usoNorm) || usoNorm.includes(normalize(u)))
  );

  if (matches.length === 0) {
    // Fallback: buscar en searchableText
    matches = catalog.filter(p => p.searchableText.includes(usoNorm));
  }

  if (activeCategory) {
    const inCat = matches.filter(p => p.categoryNormalized === activeCategory || p.categoryParent === activeCategory);
    if (inCat.length >= 2) matches = inCat;
  }

  matches.sort((a, b) => {
    const aM = a.usosRecomendados.filter(u => normalize(u).includes(usoNorm)).length;
    const bM = b.usosRecomendados.filter(u => normalize(u).includes(usoNorm)).length;
    return bM - aM;
  });

  return { primary: matches.slice(0, 3), alternatives: matches.slice(3, 8), totalMatches: matches.length };
}

function searchGeneral(ent: ExtractedIntent['entities'], catalog: EnrichedProduct[], activeCategory: string | null): SearchResult {
  let pool = [...catalog];

  if (ent.precio_max) pool = pool.filter(p => p.priceNum <= ent.precio_max!);
  if (ent.precio_min) pool = pool.filter(p => p.priceNum >= ent.precio_min!);
  if (ent.color) pool = pool.filter(p => p.searchableText.includes(normalize(ent.color!)));
  if (ent.marca) pool = pool.filter(p => p.brand && normalize(p.brand).includes(normalize(ent.marca!)));

  if (ent.producto) {
    const fuse = new Fuse(pool, {
      keys: [{ name: 'name', weight: 0.5 }, { name: 'searchableText', weight: 0.3 }, { name: 'brand', weight: 0.2 }],
      threshold: 0.4, includeScore: true,
    });
    pool = fuse.search(ent.producto).map(r => r.item);
  }

  if (activeCategory && !ent.categoria_mencionada) {
    const inCat = pool.filter(p => p.categoryNormalized === activeCategory || p.categoryParent === activeCategory);
    if (inCat.length >= 2) pool = inCat;
  }

  // Sort por atributo comparativo si el cliente pidió "la más barata / potente / etc"
  if (ent.atributo_comparacion && ent.direccion_comparacion) {
    pool = sortByAttribute(pool, ent.atributo_comparacion, ent.direccion_comparacion);
  }

  return { primary: pool.slice(0, 3), alternatives: pool.slice(3, 8), totalMatches: pool.length };
}

function sortByAttribute(products: EnrichedProduct[], attribute: string, direction: 'min' | 'max'): EnrichedProduct[] {
  const getters: Record<string, (p: EnrichedProduct) => number | undefined> = {
    precio: p => p.priceNum,
    potencia: p => p.attributes?.potencia_w,
    capacidad: p => p.attributes?.capacidad_l,
    voltaje: p => p.attributes?.voltaje_v,
    presion: p => p.attributes?.presion_bar,
    diametro: p => p.attributes?.diametro_mm,
    calidad: p => p.priceNum,
    funcionamiento: p => p.attributes?.potencia_w ?? p.priceNum,
  };
  const getter = getters[attribute.toLowerCase()];
  if (!getter) return products;
  const withVal = products.map(p => ({ p, val: getter(p) })).filter((x): x is { p: EnrichedProduct; val: number } => typeof x.val === 'number');
  const without = products.filter(p => typeof getter(p) !== 'number');
  withVal.sort((a, b) => direction === 'min' ? a.val - b.val : b.val - a.val);
  return [...withVal.map(x => x.p), ...without];
}
