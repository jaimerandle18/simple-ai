/**
 * Multi-provider scraping con cascada de fallbacks.
 *
 * Nivel 1: Firecrawl (rápido, gratis para sitios fáciles)
 * Nivel 2: Stealth fetch (headers reales, sin Playwright)
 * Nivel 3: Playwright Stealth + Chromium en Lambda
 * Nivel 4: FlareSolverr (VPS externa, Cloudflare specialist)
 *
 * Memoria por dominio: recuerda qué provider funciona para cada sitio.
 */
import { getItem, putItem } from '../dynamo';
import TurndownService from 'turndown';

// ============================================================
// TYPES
// ============================================================

export type ScrapeProvider = 'firecrawl' | 'stealth_fetch' | 'stealth_browser' | 'flaresolverr';

export interface ScrapeResult {
  success: boolean;
  html?: string;
  markdown?: string;
  provider: ScrapeProvider | 'failed';
  error?: string;
  costUsd: number;
  durationMs?: number;
}

interface ProviderStats {
  attempts: number;
  successes: number;
  lastSuccessAt?: string;
}

// ============================================================
// HTML → MARKDOWN
// ============================================================

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'nav', 'footer', 'noscript', 'iframe']);

function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html);
  } catch {
    // Fallback: strip tags
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

// ============================================================
// CONTENT VALIDATOR
// ============================================================

function isValidContent(content: string | undefined): boolean {
  if (!content || content.length < 500) return false;

  const lower = content.toLowerCase();

  const blockedSignals = [
    'cf-browser-verification', 'just a moment', 'checking your browser',
    'ddos protection by cloudflare', 'enable javascript and cookies to continue',
    'access denied', 'request blocked', 'datadome', 'perimeterx',
    'px-captcha', 'distil_r_captcha', 'are you a robot', 'verify you are human',
    'cf-error-details', '<title>access denied</title>', '<title>just a moment',
    '<title>attention required', '403 forbidden', 'error 1015',
  ];

  for (const signal of blockedSignals) {
    if (lower.includes(signal)) {
      console.log(`[SCRAPE-VALID] Blocked: "${signal}"`);
      return false;
    }
  }

  // Contenido sustancial
  const visibleText = lower.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (visibleText.length < 200) {
    console.log(`[SCRAPE-VALID] Too short: ${visibleText.length} chars`);
    return false;
  }

  return true;
}

// ============================================================
// PROVIDER 1: FIRECRAWL
// ============================================================

async function scrapeWithFirecrawl(url: string): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { success: false, provider: 'firecrawl', error: 'No API key', costUsd: 0 };

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ['markdown'], waitFor: 2000 }),
      signal: AbortSignal.timeout(30000),
    });

    const data: any = await res.json();
    if (!data.success) {
      return { success: false, provider: 'firecrawl', error: data.error || 'Firecrawl failed', costUsd: 0 };
    }

    const markdown = data.data?.markdown || '';
    return {
      success: markdown.length > 100,
      markdown,
      provider: 'firecrawl',
      costUsd: 0,
    };
  } catch (err: any) {
    return { success: false, provider: 'firecrawl', error: err.message, costUsd: 0 };
  }
}

// ============================================================
// PROVIDER 2: STEALTH FETCH (headers reales, sin browser)
// ============================================================

const STEALTH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

async function scrapeWithStealthFetch(url: string): Promise<ScrapeResult> {
  try {
    const res = await fetch(url, {
      headers: STEALTH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { success: false, provider: 'stealth_fetch', error: `HTTP ${res.status}`, costUsd: 0 };
    }

    const html = await res.text();

    if (!isValidContent(html)) {
      return { success: false, provider: 'stealth_fetch', error: 'Anti-bot detected', costUsd: 0 };
    }

    return {
      success: true,
      html,
      markdown: htmlToMarkdown(html),
      provider: 'stealth_fetch',
      costUsd: 0,
    };
  } catch (err: any) {
    return { success: false, provider: 'stealth_fetch', error: err.message, costUsd: 0 };
  }
}

// ============================================================
// PROVIDER 3: PLAYWRIGHT STEALTH (Lambda con Chromium)
// ============================================================

async function scrapeWithStealthBrowser(url: string): Promise<ScrapeResult> {
  try {
    // Dynamic import — solo carga si se necesita
    const chromium = await import('@sparticuz/chromium').then(m => m.default);
    const puppeteer = await import('puppeteer-core');

    const browser = await puppeteer.default.launch({
      args: [
        ...chromium.args,
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
      ],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-AR,es;q=0.9' });

      // Anti-detección
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });
      });

      // Bloquear recursos pesados
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Si Cloudflare challenge, esperar
      const title = await page.title();
      if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('checking')) {
        await new Promise(r => setTimeout(r, 8000));
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }

      const html = await page.content();

      if (!isValidContent(html)) {
        return { success: false, provider: 'stealth_browser', error: 'Anti-bot not bypassed', costUsd: 0 };
      }

      return {
        success: true,
        html,
        markdown: htmlToMarkdown(html),
        provider: 'stealth_browser',
        costUsd: 0,
      };
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    // Si Chromium no está disponible (no hay Layer), skip gracefully
    if (err.message?.includes('Could not find Chromium') || err.message?.includes('Cannot find module')) {
      console.log('[SCRAPE] Chromium not available, skipping stealth_browser');
      return { success: false, provider: 'stealth_browser', error: 'Chromium not available', costUsd: 0 };
    }
    return { success: false, provider: 'stealth_browser', error: err.message, costUsd: 0 };
  }
}

// ============================================================
// PROVIDER 4: FLARESOLVERR
// ============================================================

async function scrapeWithFlareSolverr(url: string): Promise<ScrapeResult> {
  const flareUrl = process.env.FLARESOLVERR_URL;
  if (!flareUrl) return { success: false, provider: 'flaresolverr', error: 'Not configured', costUsd: 0 };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.FLARESOLVERR_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.FLARESOLVERR_TOKEN}`;
    }

    const res = await fetch(`${flareUrl}/v1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
      signal: AbortSignal.timeout(70000),
    });

    if (!res.ok) return { success: false, provider: 'flaresolverr', error: `HTTP ${res.status}`, costUsd: 0 };

    const data: any = await res.json();
    if (data.status !== 'ok') {
      return { success: false, provider: 'flaresolverr', error: data.message || 'Failed', costUsd: 0 };
    }

    const html = data.solution?.response || '';
    if (!isValidContent(html)) {
      return { success: false, provider: 'flaresolverr', error: 'Invalid content', costUsd: 0 };
    }

    return {
      success: true,
      html,
      markdown: htmlToMarkdown(html),
      provider: 'flaresolverr',
      costUsd: 0,
    };
  } catch (err: any) {
    return { success: false, provider: 'flaresolverr', error: err.message, costUsd: 0 };
  }
}

// ============================================================
// DOMAIN MEMORY
// ============================================================

async function getDomainProvider(domain: string): Promise<ScrapeProvider | null> {
  try {
    const item = await getItem({ PK: `DOMAIN_SCRAPE#${domain}`, SK: 'META' });
    return (item?.preferredProvider as ScrapeProvider) || null;
  } catch {
    return null;
  }
}

async function recordScrapeResult(domain: string, provider: ScrapeProvider, success: boolean) {
  try {
    const key = { PK: `DOMAIN_SCRAPE#${domain}`, SK: 'META' };
    const existing: any = await getItem(key) || {};

    const stats = existing.stats || {};
    if (!stats[provider]) stats[provider] = { attempts: 0, successes: 0 };
    stats[provider].attempts += 1;
    if (success) {
      stats[provider].successes += 1;
      stats[provider].lastSuccessAt = new Date().toISOString();
    }

    // Preferred: el más barato con tasa > 70% (mín 2 intentos)
    const priority: ScrapeProvider[] = ['firecrawl', 'stealth_fetch', 'stealth_browser', 'flaresolverr'];
    let preferred: ScrapeProvider = 'firecrawl';
    for (const p of priority) {
      const s = stats[p];
      if (s && s.attempts >= 2 && s.successes / s.attempts >= 0.7) {
        preferred = p;
        break;
      }
    }

    await putItem({
      ...key, domain, preferredProvider: preferred, stats,
      lastUpdated: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 días
    });
  } catch (err) {
    console.error('[SCRAPE-MEMORY] Error:', err);
  }
}

// ============================================================
// MAIN: CASCADA
// ============================================================

export async function scrapePage(
  url: string,
  opts: { forceProvider?: ScrapeProvider; waitFor?: number } = {},
): Promise<{ url: string; content: string } | null> {
  const domain = new URL(url).hostname;
  const start = Date.now();

  // Si fuerzan provider
  if (opts.forceProvider) {
    const result = await runProvider(url, opts.forceProvider);
    if (result.success && (result.markdown || result.html)) {
      return { url, content: result.markdown || htmlToMarkdown(result.html!) };
    }
    return null;
  }

  // Cascada con memoria
  const preferred = await getDomainProvider(domain);
  const fullChain: ScrapeProvider[] = ['firecrawl', 'stealth_fetch', 'stealth_browser', 'flaresolverr'];
  const chain = preferred
    ? [preferred, ...fullChain.filter(p => p !== preferred)]
    : fullChain;

  for (const provider of chain) {
    const result = await runProvider(url, provider);
    const elapsed = Date.now() - start;
    console.log(`[SCRAPE] ${domain} via ${provider}: ${result.success ? 'OK' : 'FAIL'} (${elapsed}ms) ${result.error || ''}`);

    if (result.success && (result.markdown || result.html)) {
      const content = result.markdown || htmlToMarkdown(result.html!);
      if (isValidContent(content) || content.length > 500) {
        await recordScrapeResult(domain, provider, true);
        return { url, content };
      }
    }

    await recordScrapeResult(domain, provider, false);
  }

  console.error(`[SCRAPE] All providers failed for ${url}`);
  return null;
}

async function runProvider(url: string, provider: ScrapeProvider): Promise<ScrapeResult> {
  switch (provider) {
    case 'firecrawl': return scrapeWithFirecrawl(url);
    case 'stealth_fetch': return scrapeWithStealthFetch(url);
    case 'stealth_browser': return scrapeWithStealthBrowser(url);
    case 'flaresolverr': return scrapeWithFlareSolverr(url);
  }
}

/**
 * Map site URLs (wrapper para mantener compatibilidad)
 */
export async function mapSite(url: string, limit = 500): Promise<string[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, limit }),
      signal: AbortSignal.timeout(30000),
    });
    const data: any = await res.json();
    return data.success ? (data.links || []) : [];
  } catch {
    return [];
  }
}
