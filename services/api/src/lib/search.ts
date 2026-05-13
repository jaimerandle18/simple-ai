const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;

/**
 * Google Custom Search: find product pages on a given site.
 * Returns up to `maxResults` URLs.
 */
export async function googleSearchSite(siteUrl: string, maxResults = 30): Promise<string[]> {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.warn('Google Search API keys not configured, falling back to crawl');
    return [];
  }

  const domain = new URL(siteUrl).hostname;
  const urls: string[] = [];

  // Google Custom Search returns max 10 per request, paginate up to maxResults
  for (let start = 1; urls.length < maxResults; start += 10) {
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CX,
      q: `site:${domain} productos OR products OR tienda OR shop OR precio OR price`,
      start: String(start),
      num: '10',
    });

    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
    const data: any = await res.json();

    if (!data.items || data.items.length === 0) break;

    for (const item of data.items) {
      if (item.link) urls.push(item.link);
    }

    // No more pages
    if (!data.queries?.nextPage) break;
  }

  console.log(`Google Search found ${urls.length} URLs for ${domain}`);
  return urls.slice(0, maxResults);
}

/**
 * Scrape a single URL with Firecrawl. Returns the page as markdown.
 */
export async function scrapePage(url: string, options?: { waitFor?: number }): Promise<{ url: string; content: string } | null> {
  if (!FIRECRAWL_API_KEY) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        ...(options?.waitFor ? { waitFor: options.waitFor } : {}),
      }),
    });
    const data: any = await res.json();

    if (!data.success) {
      console.error(`Scrape failed for ${url}:`, data);
      return null;
    }

    return { url, content: data.data?.markdown || '' };
  } catch (err) {
    console.error(`Scrape error for ${url}:`, err);
    return null;
  }
}

/**
 * Main scraping pipeline: Google Search finds pages, Firecrawl scrapes them.
 * Falls back to full crawl if Google Search is not configured.
 */
export async function scrapeProducts(siteUrl: string): Promise<{ url: string; content: string }[]> {
  // Step 1: Try Google Search to find product pages
  const googleUrls = await googleSearchSite(siteUrl);

  if (googleUrls.length > 0) {
    // Step 2: Scrape each URL with Firecrawl (batches of 5)
    const pages: { url: string; content: string }[] = [];

    for (let i = 0; i < googleUrls.length; i += 5) {
      const batch = googleUrls.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(url => scrapePage(url)));

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && result.value.content.length > 50) {
          pages.push(result.value);
        }
      }
    }

    console.log(`Scraped ${pages.length} pages via Google Search + Firecrawl`);
    return pages;
  }

  // Fallback: crawl the entire site
  console.log('Falling back to full site crawl');
  return crawlWebsite(siteUrl);
}

/**
 * Map a website with Firecrawl: returns all discovered URLs (no content).
 * Fast and cheap — ideal for discovery before scraping.
 */
export async function mapSite(url: string, limit = 500): Promise<string[]> {
  if (!FIRECRAWL_API_KEY) return [];

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url, limit }),
    });
    const data: any = await res.json();

    if (!data.success) {
      console.error('Map failed:', data);
      return [];
    }

    return (data.links || []) as string[];
  } catch (err) {
    console.error('Map error:', err);
    return [];
  }
}

/**
 * Crawl an entire website with Firecrawl. Returns all pages as markdown.
 * Used as fallback when Google Search is not configured.
 */
export async function crawlWebsite(url: string): Promise<{ url: string; content: string }[]> {
  if (!FIRECRAWL_API_KEY) return [];

  try {
    // Start crawl
    console.log('Starting crawl of:', url);
    const startRes = await fetch('https://api.firecrawl.dev/v1/crawl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        limit: 50,
        scrapeOptions: { formats: ['markdown'] },
      }),
    });
    const startData: any = await startRes.json();

    if (!startData.success || !startData.id) {
      console.error('Crawl start failed:', startData);
      return [];
    }

    const crawlId = startData.id;
    console.log('Crawl started, id:', crawlId);

    // Poll for completion (max 2 minutes)
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlId}`, {
        headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` },
      });
      const statusData: any = await statusRes.json();

      console.log(`Crawl status: ${statusData.status}, pages: ${statusData.data?.length || 0}`);

      if (statusData.status === 'completed') {
        return (statusData.data || []).map((page: any) => ({
          url: page.metadata?.url || page.metadata?.sourceURL || '',
          content: page.markdown || '',
        }));
      }

      if (statusData.status === 'failed') {
        console.error('Crawl failed:', statusData);
        return [];
      }
    }

    console.log('Crawl timed out');
    return [];
  } catch (err) {
    console.error('Crawl error:', err);
    return [];
  }
}

const PRODUCT_PATH_PREFIXES = ['/productos/', '/products/', '/product/', '/p/', '/catalogo/', '/tienda/', '/shop/', '/item/'];

async function _parseSitemapXml(xml: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const urls: string[] = [];
  const isSitemapIndex = xml.includes('<sitemapindex');
  const locRegex = /<loc[^>]*>\s*([^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  const locs: string[] = [];
  while ((m = locRegex.exec(xml)) !== null) locs.push(m[1].trim());

  if (isSitemapIndex) {
    const results = await Promise.allSettled(locs.map(async loc => {
      try {
        const r = await fetch(loc, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) return [];
        return _parseSitemapXml(await r.text(), depth + 1);
      } catch { return []; }
    }));
    for (const r of results) if (r.status === 'fulfilled') urls.push(...r.value);
  } else {
    for (const loc of locs) {
      try {
        const path = new URL(loc).pathname.replace(/\/$/, '');
        if (PRODUCT_PATH_PREFIXES.some(p => path.startsWith(p.replace(/\/$/, '')))) urls.push(loc);
      } catch {}
    }
  }
  return urls;
}

export async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '');
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`];
  for (const sitemapUrl of candidates) {
    try {
      const r = await fetch(sitemapUrl, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const urls = await _parseSitemapXml(await r.text());
      if (urls.length > 0) {
        console.log(`[SITEMAP] ${urls.length} product URLs from ${sitemapUrl}`);
        return urls;
      }
    } catch {}
  }
  return [];
}

export interface DirectProduct {
  name: string;
  price: string;
  priceNum: number;
  images: string[];
  description: string;
  brand?: string;
  sku?: string;
  inStock?: boolean | null;
  url: string;
  category: string;
}

function _findProductLd(data: any): any | null {
  if (Array.isArray(data)) { for (const d of data) { const f = _findProductLd(d); if (f) return f; } return null; }
  if (!data || typeof data !== 'object') return null;
  if (data['@type'] === 'Product') return data;
  for (const v of Object.values(data)) { if (v && typeof v === 'object') { const f = _findProductLd(v); if (f) return f; } }
  return null;
}

export async function fetchProductDirect(url: string): Promise<DirectProduct | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductBot/1.0)', 'Accept-Language': 'es-AR,es;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(html)) !== null) {
      try {
        const ld = _findProductLd(JSON.parse(m[1]));
        if (!ld) continue;
        const offers = Array.isArray(ld.offers) ? ld.offers[0] : (ld.offers || {});
        const rawPrice = offers?.price;
        const priceNum = rawPrice ? Math.round(parseFloat(String(rawPrice).replace(/[^\d.]/g, ''))) || 0 : 0;
        const images: string[] = [];
        const imgField = ld.image;
        if (typeof imgField === 'string' && imgField.startsWith('http')) images.push(imgField);
        else if (Array.isArray(imgField)) for (const img of imgField) {
          const src = typeof img === 'string' ? img : (img?.url || img?.contentUrl || '');
          if (src.startsWith('http')) images.push(src);
        }
        const availability = offers?.availability || '';
        const inStock = availability ? availability.includes('InStock') : null;
        const brand = ld.brand?.name || ld.brand || undefined;
        const slug = url.replace(/\/$/, '').split('/').pop() || '';
        const pathParts = new URL(url).pathname.replace(/^\//, '').split('/');
        const category = pathParts.length >= 2 ? pathParts[pathParts.length - 2].replace(/-/g, ' ') : '';
        return {
          name: String(ld.name || '').trim(),
          price: priceNum > 0 ? String(priceNum) : 'Consultar',
          priceNum,
          images,
          description: String(ld.description || '').trim().slice(0, 500),
          brand: brand ? String(brand) : undefined,
          sku: ld.sku || slug,
          inStock,
          url,
          category,
        };
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * Search stored products by keyword matching.
 * Simple but effective — matches query words against product name/description.
 */
/**
 * Use OpenAI to extract search keywords from a natural language query.
 * "tienen algo para el frío?" → ["campera", "buzo", "cuello", "abrigo", "termico"]
 */
export async function extractSearchKeywords(query: string, openai: any): Promise<string[]> {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: `Sos un extractor de keywords de búsqueda para un catálogo de productos.
Dada la pregunta del cliente, devolvé un JSON array con las palabras clave para buscar productos relevantes.
Incluí sinónimos, variaciones y productos relacionados.
Ejemplos:
- "tienen gorras?" → ["gorra", "cap", "visera", "sombrero"]
- "busco algo para el frío" → ["campera", "buzo", "abrigo", "cuello", "termico", "polar"]
- "quiero un pantalón para trekking" → ["pantalon", "cargo", "trekking", "montaña", "outdoor"]
- "tienen buzos con cierre?" → ["buzo", "hoodie", "zip", "cierre", "campera"]
SOLO devolvé el JSON array, nada más.`,
        },
        { role: 'user', content: query },
      ],
    });

    const text = res.choices[0]?.message?.content || '[]';
    const keywords = JSON.parse(text);
    console.log(`Keywords extracted: ${JSON.stringify(keywords)}`);
    return keywords;
  } catch (err) {
    console.error('Keyword extraction error:', err);
    // Fallback to basic word splitting
    return query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
  }
}

export function findRelevantProducts(products: any[], keywords: string[]): any[] {
  // Generate flexible search terms from AI keywords
  const allTerms: string[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    allTerms.push(k);
    // Also add stems: chinos→chino→chin, pantalones→pantalon→pantal
    if (k.endsWith('s')) allTerms.push(k.slice(0, -1));
    if (k.endsWith('es')) allTerms.push(k.slice(0, -2));
    if (k.length > 4) allTerms.push(k.slice(0, -1));
    if (k.length > 5) allTerms.push(k.slice(0, -2));
  }
  const uniqueTerms = [...new Set(allTerms)].filter(t => t.length >= 3);

  const scored = products.map(p => {
    const text = `${p.name} ${p.description} ${p.category || ''}`.toLowerCase();
    let score = 0;
    for (const term of uniqueTerms) {
      if (text.includes(term)) score += term.length;
    }
    return { ...p, score };
  });

  return scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

