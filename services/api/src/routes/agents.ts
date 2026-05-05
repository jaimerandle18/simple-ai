import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';
import { crawlWebsite, findRelevantProducts } from '../lib/search';
import { classifyIntent, extractKeywords, smartProductMatch, buildFinalPrompt, DEFAULT_MINI_PROMPTS } from '../lib/agent-pipeline';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PRODUCT_INTENTS = ['product_search', 'product_detail', 'price_concern', 'recommendation', 'sizing_help', 'purchase_intent'];

export async function handleAgents(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // GET /agents/:type
  const agentMatch = path.match(/^\/agents\/([^/]+)$/);
  if (method === 'GET' && agentMatch) {
    const agentType = agentMatch[1];
    const agent = await getItem(keys.agent(tenantId, agentType));
    if (!agent) return json({ agentConfig: {} });
    return json(agent);
  }

  // PUT /agents/:type
  if (method === 'PUT' && agentMatch) {
    const agentType = agentMatch[1];
    const body = JSON.parse(event.body || '{}');
    const existing = await getItem(keys.agent(tenantId, agentType)) || {};

    const agent = {
      ...keys.agent(tenantId, agentType),
      tenantId,
      agentType,
      agentConfig: body.agentConfig || existing.agentConfig || {},
      model: body.model || existing.model || 'gpt-4o-mini',
      active: body.active ?? existing.active ?? true,
      updatedAt: new Date().toISOString(),
    };

    await putItem(agent);
    return json(agent);
  }

  // POST /agents/test-chat — pipeline: classify → search → respond
  if (method === 'POST' && path === '/agents/test-chat') {
    const body = JSON.parse(event.body || '{}');
    const { message, history } = body;

    if (!message) return error('message is required');

    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config = agent?.agentConfig || {};
    const model = agent?.model || 'gpt-4o-mini';

    const historyMsgs = (history || []) as { role: string; content: string }[];

    try {
      // ===== STEP 1: Classify intent =====
      const intent = await classifyIntent(message, historyMsgs, openai);

      // ===== STEP 2: Search products (only if needed) =====
      let productsContext: string | undefined;

      if (PRODUCT_INTENTS.includes(intent)) {
        const allProducts = await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 500 });

        if (allProducts.length > 0) {
          // Step A: Extract keywords and search
          const keywords = await extractKeywords(message, historyMsgs, openai);
          console.log(`Keywords: ${JSON.stringify(keywords)}`);

          let relevant = findRelevantProducts(allProducts, keywords);
          console.log(`Keyword search found ${relevant.length} products`);

          // Step B: If keyword search found nothing, use AI fallback
          if (relevant.length === 0) {
            console.log('Keyword search empty, using smart match fallback...');
            const indices = await smartProductMatch(message, allProducts as any[], openai);
            console.log(`Smart match indices: ${JSON.stringify(indices)}`);
            relevant = indices
              .filter(i => i >= 0 && i < allProducts.length)
              .map(i => allProducts[i]);
          }

          console.log(`Final products: ${relevant.map((p: any) => p.name).join(', ')}`);

          if (relevant.length > 0) {
            productsContext = relevant.map((p: any) =>
              `- **${p.name}**${p.price ? ` — ${p.price}` : ''}${p.description ? `\n  ${p.description}` : ''}${p.pageUrl ? `\n  Link: ${p.pageUrl}` : ''}`
            ).join('\n');
          } else {
            const categories = [...new Set(allProducts.map((p: any) => p.category).filter(Boolean))];
            productsContext = `No se encontraron productos para esta búsqueda.\nCategorías disponibles: ${categories.join(', ') || 'General'}\nTotal de productos en catálogo: ${allProducts.length}`;
          }
        }
      }

      // ===== STEP 3: Get mini-prompt for this intent =====
      // TODO: In future, load custom mini-prompts from DynamoDB per tenant
      const miniPrompt = DEFAULT_MINI_PROMPTS[intent] || DEFAULT_MINI_PROMPTS.general_question;

      // ===== STEP 4: Generate response =====
      const systemPrompt = buildFinalPrompt(config, intent, miniPrompt, productsContext);

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...historyMsgs.map(m => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      // Only add the current message if it's not already the last in history
      const lastHistoryMsg = historyMsgs[historyMsgs.length - 1];
      if (!lastHistoryMsg || lastHistoryMsg.content !== message) {
        messages.push({ role: 'user', content: message });
      }

      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 600,
        messages,
      });

      const reply = completion.choices[0]?.message?.content || 'No pude generar una respuesta.';
      return json({ reply, intent });
    } catch (err: any) {
      console.error('Pipeline error:', err);
      return error('Error: ' + err.message, 500);
    }
  }

  // POST /agents/scrape
  if (method === 'POST' && path === '/agents/scrape') {
    const body = JSON.parse(event.body || '{}');
    const { url } = body;

    if (!url) return error('url is required');

    try {
      const pages = await crawlWebsite(url);
      console.log(`Crawled ${pages.length} pages from ${url}`);

      if (pages.length === 0) {
        return error('No se pudieron obtener páginas del sitio.', 400);
      }

      // Delete old products
      const oldProducts = await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 1000 });
      for (const old of oldProducts) {
        await putItem({ ...(old as any), PK: 'DELETED', SK: (old as any).SK });
      }

      const allProducts: any[] = [];
      const now = new Date().toISOString();
      const validPages = pages.filter(p => p.content && p.content.length > 50);

      for (let i = 0; i < validPages.length; i += 5) {
        const batch = validPages.slice(i, i + 5);
        const results = await Promise.allSettled(
          batch.map(async (page) => {
            const extraction = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              temperature: 0,
              max_tokens: 4000,
              messages: [
                {
                  role: 'system',
                  content: `Extraé TODOS los productos/servicios de este contenido. JSON array con: {"name","description" (detallada: materiales, talles, colores),"price","category","imageUrl" (URL de imagen si hay)}.
Si no hay productos, devolvé []. SOLO JSON.`,
                },
                { role: 'user', content: page.content.slice(0, 8000) },
              ],
            });

            const text = extraction.choices[0]?.message?.content || '[]';
            let products: any[] = [];
            try { products = JSON.parse(text); } catch {
              const match = text.match(/\[[\s\S]*\]/);
              if (match) products = JSON.parse(match[0]);
            }
            return { products, pageUrl: page.url };
          })
        );

        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          for (const product of result.value.products) {
            if (!product.name) continue;
            const productId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await putItem({
              PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}`,
              tenantId, productId,
              name: product.name, description: product.description || '',
              price: product.price || '', category: product.category || '',
              imageUrl: product.imageUrl || '', pageUrl: result.value.pageUrl,
              sourceUrl: url, createdAt: now,
            });
            allProducts.push({ name: product.name, price: product.price, category: product.category, imageUrl: product.imageUrl });
          }
        }
      }

      return json({ productsCount: allProducts.length, pagesScanned: pages.length, products: allProducts.slice(0, 20) });
    } catch (err: any) {
      return error('Error: ' + err.message, 500);
    }
  }

  return error('Not found', 404);
}
