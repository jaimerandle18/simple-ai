const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;

/**
 * Crawl an entire website with Firecrawl. Returns all pages as markdown.
 * This is meant to run once when the user configures their agent.
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
    const startData = await startRes.json();

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
      const statusData = await statusRes.json();

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
