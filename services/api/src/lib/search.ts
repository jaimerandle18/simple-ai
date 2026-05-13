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

// ============================================================
// INSTITUTIONAL PAGES SCRAPER
// ============================================================

const INSTITUTIONAL_PATTERNS: Record<string, RegExp> = {
  envios: /env[ií]os?|shipping|delivery|despacho/i,
  pagos: /pagos?|payment|medios.*pago|formas.*pago/i,
  cambios: /cambios?|devoluciones?|returns?|reembolso/i,
  garantia: /garant[ií]a|warranty/i,
  faq: /faq|preguntas.*frecuentes|ayuda|help/i,
  contacto: /contacto|contact|ubicaci[oó]n|sucursal/i,
  nosotros: /sobre.*nosotros|qui[eé]nes.*somos|about|nuestra.*historia/i,
  terminos: /t[eé]rminos|condiciones|terms|legal|privacidad|privacy/i,
};

function extractMainText(html: string): string {
  // Sacar scripts, styles, nav, footer, header
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, 5000); // Max 5KB
}

export interface SitePage {
  type: string;
  url: string;
  content: string;
  keywords: string[];
}

export async function scrapeInstitutionalPages(sitemapUrls: string[], baseUrl: string): Promise<SitePage[]> {
  const base = baseUrl.replace(/\/$/, '');
  const pages: SitePage[] = [];

  // Buscar en sitemap
  const candidates: { url: string; type: string }[] = [];
  for (const url of sitemapUrls) {
    const path = url.replace(base, '').toLowerCase();
    for (const [type, pattern] of Object.entries(INSTITUTIONAL_PATTERNS)) {
      if (pattern.test(path)) {
        candidates.push({ url, type });
        break;
      }
    }
  }

  // Si no hay en sitemap, probar URLs comunes
  if (candidates.length < 3) {
    const commonPaths = [
      { path: '/envios', type: 'envios' }, { path: '/shipping', type: 'envios' },
      { path: '/pagos', type: 'pagos' }, { path: '/medios-de-pago', type: 'pagos' },
      { path: '/cambios-y-devoluciones', type: 'cambios' }, { path: '/devoluciones', type: 'cambios' },
      { path: '/preguntas-frecuentes', type: 'faq' }, { path: '/faq', type: 'faq' },
      { path: '/contacto', type: 'contacto' }, { path: '/contact', type: 'contacto' },
      { path: '/sobre-nosotros', type: 'nosotros' }, { path: '/quienes-somos', type: 'nosotros' },
    ];
    for (const { path, type } of commonPaths) {
      if (!candidates.some(c => c.type === type)) {
        candidates.push({ url: base + path, type });
      }
    }
  }

  // Scrapear en batches de 5
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(async ({ url, type }) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductBot/1.0)', 'Accept-Language': 'es-AR,es;q=0.9' },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        });
        if (!res.ok) return null;
        const html = await res.text();
        const text = extractMainText(html);
        if (text.length < 50) return null;

        // Keywords para matching con preguntas del cliente
        const keywords: string[] = [];
        if (type === 'envios') keywords.push('envio', 'envios', 'despacho', 'delivery', 'correo', 'transporte', 'zona', 'costo envio', 'envio gratis', 'demora');
        if (type === 'pagos') keywords.push('pago', 'pagos', 'tarjeta', 'transferencia', 'efectivo', 'mercadopago', 'cuotas', 'metodo');
        if (type === 'cambios') keywords.push('cambio', 'devolucion', 'devolver', 'reembolso', 'garantia', 'cambiar');
        if (type === 'faq') keywords.push('pregunta', 'ayuda', 'como', 'donde', 'cuando', 'cuanto');
        if (type === 'contacto') keywords.push('contacto', 'telefono', 'email', 'direccion', 'ubicacion', 'horario', 'donde', 'local');
        if (type === 'nosotros') keywords.push('nosotros', 'historia', 'empresa', 'equipo', 'quienes');

        return { type, url, content: text, keywords } as SitePage;
      } catch {
        return null;
      }
    }));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) pages.push(r.value);
    }
  }

  console.log(`[INSTITUTIONAL] Found ${pages.length} pages: ${pages.map(p => p.type).join(', ')}`);
  return pages;
}

// ============================================================
// BUSINESS DATA FROM JSON-LD + FOOTER
// ============================================================

export interface BusinessData {
  nombre?: string;
  direccion?: string;
  telefono?: string;
  email?: string;
  horarios?: string;
  redes?: Record<string, string>;
  descripcion?: string;
  rubro?: string;
}

export async function scrapeBusinessData(baseUrl: string): Promise<BusinessData> {
  const data: BusinessData = {};

  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductBot/1.0)', 'Accept-Language': 'es-AR,es;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return data;
    const html = await res.text();

    // 1. JSON-LD: Organization, LocalBusiness, Store
    const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(html)) !== null) {
      try {
        const ld = JSON.parse(m[1]);
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          const type = item['@type'] || '';
          if (['Organization', 'LocalBusiness', 'Store', 'OnlineStore'].includes(type)) {
            if (item.name) data.nombre = item.name;
            if (item.description) data.descripcion = item.description;
            if (item.telephone) data.telefono = item.telephone;
            if (item.email) data.email = item.email;
            if (item.address) {
              const addr = typeof item.address === 'string' ? item.address : [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion].filter(Boolean).join(', ');
              if (addr) data.direccion = addr;
            }
            if (item.openingHours) data.horarios = Array.isArray(item.openingHours) ? item.openingHours.join(', ') : item.openingHours;
            if (item.sameAs) {
              data.redes = {};
              const links = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
              for (const link of links) {
                if (link.includes('instagram')) data.redes.instagram = link;
                if (link.includes('facebook')) data.redes.facebook = link;
                if (link.includes('twitter') || link.includes('x.com')) data.redes.twitter = link;
                if (link.includes('tiktok')) data.redes.tiktok = link;
              }
            }
          }
        }
      } catch {}
    }

    // 2. Fallback: footer
    const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
    if (footerMatch) {
      const footerText = extractMainText(footerMatch[0]);
      // Extraer email
      if (!data.email) {
        const emailMatch = footerText.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) data.email = emailMatch[0];
      }
      // Extraer teléfono
      if (!data.telefono) {
        const phoneMatch = footerText.match(/(?:\+54|0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}|\d{2,4}[\s-]\d{4}[\s-]\d{4})/);
        if (phoneMatch) data.telefono = phoneMatch[0];
      }
      // Extraer redes del footer
      if (!data.redes || Object.keys(data.redes).length === 0) {
        data.redes = {};
        const igMatch = footerText.match(/@[\w.]+/) || html.match(/instagram\.com\/([\w.]+)/i);
        if (igMatch) data.redes.instagram = igMatch[0];
      }
    }

    // 3. Meta tags
    if (!data.nombre) {
      const ogName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
      if (ogName) data.nombre = ogName[1];
    }
    if (!data.descripcion) {
      const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (metaDesc) data.descripcion = metaDesc[1];
    }

  } catch (err) {
    console.error('[BUSINESS-DATA] Error:', err);
  }

  console.log(`[BUSINESS-DATA] Extracted: ${Object.keys(data).filter(k => (data as any)[k]).join(', ')}`);
  return data;
}

// ============================================================
// PRODUCT VARIANTS (stock real)
// ============================================================

export interface ProductVariant {
  size: string;
  color?: string;
  available: boolean;
  price?: number;
}

export async function getProductVariants(productUrl: string): Promise<ProductVariant[]> {
  try {
    const res = await fetch(productUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Método 1: Tiendanube JSON en HTML
    const tnMatch = html.match(/var\s+product_variants\s*=\s*(\[[\s\S]*?\]);/);
    if (tnMatch) {
      try {
        const variants = JSON.parse(tnMatch[1]);
        return variants.map((v: any) => ({
          size: v.option0 || v.values?.[0] || '',
          color: v.option1 || v.values?.[1] || undefined,
          available: v.available !== false && v.stock !== 0,
          price: v.price ? Math.round(v.price / 100) : undefined,
        })).filter((v: any) => v.size);
      } catch {}
    }

    // Método 2: Shopify product JSON
    const shopifyMatch = html.match(/var\s+meta\s*=\s*(\{[\s\S]*?"product"[\s\S]*?\});/);
    if (shopifyMatch) {
      try {
        const meta = JSON.parse(shopifyMatch[1]);
        const variants = meta.product?.variants || [];
        return variants.map((v: any) => ({
          size: v.option1 || v.title || '',
          color: v.option2 || undefined,
          available: v.available !== false,
          price: v.price ? Math.round(v.price / 100) : undefined,
        })).filter((v: any) => v.size);
      } catch {}
    }

    // Método 3: JSON-LD offers
    const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(html)) !== null) {
      try {
        const ld = _findProductLd(JSON.parse(m[1]));
        if (!ld?.offers) continue;
        const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
        if (offers.length <= 1) continue;
        return offers.map((o: any) => ({
          size: o.name || o.sku || '',
          available: o.availability ? o.availability.includes('InStock') : true,
          price: o.price ? Math.round(parseFloat(String(o.price).replace(/[^\d.]/g, ''))) : undefined,
        })).filter((v: any) => v.size);
      } catch {}
    }

    // Método 4: select/option elements con talles
    const selectMatch = html.match(/<select[^>]*(?:name|id)=["'][^"']*(?:size|talle|variant)[^"']*["'][^>]*>([\s\S]*?)<\/select>/i);
    if (selectMatch) {
      const options = [...selectMatch[1].matchAll(/<option[^>]*value=["']([^"']+)["'][^>]*>([^<]+)<\/option>/gi)];
      if (options.length > 0) {
        return options
          .filter(o => o[1] && o[1] !== '' && !o[2].toLowerCase().includes('seleccion'))
          .map(o => ({
            size: o[2].trim(),
            available: !o[0].includes('disabled') && !o[2].toLowerCase().includes('agotado'),
          }));
      }
    }

  } catch {}
  return [];
}
