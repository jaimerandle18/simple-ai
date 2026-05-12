import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';
import { crawlWebsite, scrapePage } from '../lib/search';
import Anthropic from '@anthropic-ai/sdk';
import Fuse from 'fuse.js';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';

const scheduler = new SchedulerClient({});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// BÚSQUEDA (mismo Fuse.js que el message-processor)
// ============================================================
function searchCatalog(query: string, catalog: any[], categoria?: string): any[] {
  let pool = catalog;
  if (categoria) {
    const catNorm = categoria.toLowerCase();
    const filtered = pool.filter((p: any) =>
      (p.category || '').toLowerCase().includes(catNorm) ||
      (p.categoryNormalized || '').toLowerCase().includes(catNorm)
    );
    if (filtered.length > 0) pool = filtered;
  }

  const fuse = new Fuse(pool, {
    keys: [
      { name: 'name', weight: 0.4 },
      { name: 'category', weight: 0.2 },
      { name: 'brand', weight: 0.1 },
      { name: 'description', weight: 0.15 },
      { name: 'searchableText', weight: 0.15 },
    ],
    threshold: 0.45,
    ignoreLocation: true,
    includeScore: true,
  });

  const results = fuse.search(query);
  if (results.length > 0) return results.slice(0, 6).map(r => r.item);

  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = normalize(query).split(/\s+/).filter(t => t.length >= 3);
  if (terms.length === 0) return [];

  return pool
    .map((p: any) => {
      const text = normalize(`${p.name} ${p.category || ''} ${p.brand || ''} ${p.description || ''}`);
      let score = 0;
      for (const t of terms) { if (text.includes(t)) score += 10; }
      return { ...p, _score: score };
    })
    .filter((x: any) => x._score > 0)
    .sort((a: any, b: any) => b._score - a._score)
    .slice(0, 6);
}

function formatProductsYAML(products: any[]): string {
  if (products.length === 0) return '(ninguno en contexto, usá buscar_productos)';
  let block = '';
  for (const [i, p] of products.entries()) {
    block += `- id: ${i + 1}\n  nombre: "${p.name}"\n  marca: "${p.brand || 'N/A'}"\n  categoria: "${p.category || 'N/A'}"\n  precio: ${p.priceNum || 'null'}\n  precio_display: "${p.price || 'Consultar'}"`;
    if (p.sizes && p.sizes.length > 0) block += `\n  talles_disponibles: [${p.sizes.join(', ')}]`;
    if (p.description) block += `\n  descripcion: "${p.description.slice(0, 120).replace(/"/g, "'")}"`;
    block += '\n\n';
  }
  return block;
}

const TOOLS: Anthropic.Tool[] = [{
  name: 'buscar_productos',
  description: 'Busca productos en el catálogo del negocio por nombre, categoría o uso.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Texto para buscar' },
      categoria: { type: 'string', description: 'Filtrar por categoría' },
    },
    required: ['query'],
  },
}];

function isTrivialMessage(msg: string): boolean {
  return [
    /^(hola|holaa+|hi|hey|buenas|que\s*tal)\s*[!.?]*$/i,
    /^(gracias|grax)\s*[!.?]*$/i,
    /^(ok|dale|perfecto|genial)\s*[!.?]*$/i,
    /^(chau|bye)\s*[!.?]*$/i,
    /^.{1,3}$/,
  ].some(p => p.test(msg.trim()));
}

function isFollowUp(msg: string, hasRecent: boolean): boolean {
  if (!hasRecent) return false;
  return [
    /^y\s+(en|de|el|la|las|los)\s+/i,
    /^cu[áa]l/i,
    /^(la|el|las|los)\s+(m[áa]s|menos)\s+/i,
    /^(que|qu[eé])\s+(talle|color|medida)/i,
    /^en\s+(talle|color)/i,
    /en\s+talle\s+(XS|S|M|L|XL|XXL|\d{2})/i,
    /la\s+tenes\s*\??$/i, /lo\s+tenes\s*\??$/i,
    /^(cuanto|cu[áa]nto)\s+(sale|cuesta)/i,
    /^me\s+(llevo|quedo)/i, /^(lo|la)\s+quiero/i,
  ].some(p => p.test(msg.trim()));
}

// ============================================================
// SCRAPER HELPERS
// ============================================================

export async function runScraper(tenantId: string): Promise<{ productsCount: number; newCount: number; updatedCount: number }> {
  const cfg = await getItem(keys.scraperConfig(tenantId));
  if (!cfg || !cfg.extractorCode) throw new Error('No hay configuración de scraper guardada.');

  const pages = (cfg.pages || []) as { url: string; category: string }[];
  const baseUrl = cfg.baseUrl as string;

  const existing = await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 1500 });
  const existingMap = new Map<string, any>();
  for (const p of existing) existingMap.set((p as any).name.toLowerCase().trim(), p);

  const now = new Date().toISOString();
  const allProducts = new Map<string, any>();

  for (let i = 0; i < pages.length; i += 3) {
    const batch = pages.slice(i, i + 3);
    const results = await Promise.allSettled(batch.map(async (page) => {
      const scraped = await scrapePage(page.url);
      if (!scraped || scraped.content.length < 50) return [];
      try {
        const fn = new Function('markdown', 'category', cfg.extractorCode as string);
        return (fn(scraped.content, page.category) as any[]) || [];
      } catch (err) {
        console.error(`[SCRAPER-RUN] extractFn error for ${page.url}:`, err);
        return [];
      }
    }));
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const product of r.value) {
        if (!product.name || product.name.length < 3) continue;
        const key = product.name.toLowerCase().trim();
        if (!allProducts.has(key)) allProducts.set(key, product);
      }
    }
  }

  // Safety check: if the re-run returns suspiciously few products compared to the
  // existing catalog, skip the update to avoid wiping valid data due to a scrape failure.
  const existingCount = existingMap.size;
  if (allProducts.size === 0) {
    console.warn(`[SCRAPER-RUN] tenant=${tenantId} returned 0 products — skipping update to preserve existing catalog (${existingCount} products).`);
    await putItem({ ...(cfg as any), lastRunSkipped: now, lastRunSkipReason: 'empty_result' });
    return { productsCount: 0, newCount: 0, updatedCount: 0, skipped: true } as any;
  }
  if (existingCount > 10 && allProducts.size < existingCount * 0.3) {
    console.warn(`[SCRAPER-RUN] tenant=${tenantId} returned only ${allProducts.size}/${existingCount} products (<30%) — skipping update.`);
    await putItem({ ...(cfg as any), lastRunSkipped: now, lastRunSkipReason: `low_yield_${allProducts.size}_of_${existingCount}` });
    return { productsCount: allProducts.size, newCount: 0, updatedCount: 0, skipped: true } as any;
  }

  let newCount = 0, updatedCount = 0;
  for (const [key, product] of allProducts) {
    const priceNum = typeof product.price === 'string' ? parseInt(product.price.replace(/[^0-9]/g, '')) || 0 : (product.price || 0);
    const st = [product.name, product.category, product.brand, product.description].filter(Boolean).join(' ').toLowerCase();

    if (existingMap.has(key)) {
      const old = existingMap.get(key) as any;
      await putItem({ ...old, price: product.price || 'Consultar', priceNum, description: product.description || '', imageUrl: product.imageUrl || old.imageUrl || '', updatedAt: now });
      updatedCount++;
    } else {
      const productId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await putItem({
        PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}`,
        tenantId, productId, name: product.name, description: product.description || '',
        price: product.price || 'Consultar', priceNum, category: product.category || '',
        brand: product.brand || '', imageUrl: product.imageUrl || '',
        sourceUrl: baseUrl, searchableText: st,
        categoryNormalized: (product.category || '').toLowerCase().replace(/\s+/g, '_'),
        sizes: product.sizes || [], outOfStockSizes: product.outOfStockSizes || [],
        attributes: product.attributes || {}, createdAt: now,
      });
      newCount++;
    }
  }

  await putItem({ ...(cfg as any), lastRun: now });
  return { productsCount: allProducts.size, newCount, updatedCount };
}

async function generateExtractorCode(sampleMarkdown: string, sampleProducts: any[]): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Analizá este markdown de una tienda online y los productos ya extraídos de él.
Escribí el CUERPO de una función JavaScript (sin la firma "function extractProducts(...)") que:
- Recibe dos argumentos disponibles: \`markdown\` (string) y \`category\` (string)
- Parsea el markdown para encontrar todos los productos
- Usa regex o string parsing específico para ESTA estructura de sitio
- Hace return de un array de objetos: [{name, price, description, category, imageUrl, brand, sizes}]
- Solo JavaScript vanilla, sin imports ni require()
- Si no puede extraer productos, hace return []

MARKDOWN DE MUESTRA (primeros 6000 caracteres):
${sampleMarkdown.slice(0, 6000)}

PRODUCTOS YA EXTRAÍDOS (referencia de lo que debe encontrar):
${JSON.stringify(sampleProducts.slice(0, 10), null, 2)}

IMPORTANTE: Devolvé SOLO el código JavaScript del cuerpo de la función. Sin markdown, sin explicaciones, sin backticks, sin la firma.`,
    }],
  });
  const code = res.content[0].type === 'text' ? res.content[0].text.trim() : '';
  // Strip accidental markdown fences
  return code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();
}

async function upsertSchedules(tenantId: string, hours: number[]) {
  const lambdaArn = process.env.API_LAMBDA_ARN;
  const roleArn = process.env.SCHEDULER_ROLE_ARN;
  if (!lambdaArn || !roleArn) {
    console.warn('[SCRAPER-SCHEDULE] API_LAMBDA_ARN or SCHEDULER_ROLE_ARN not set, skipping EventBridge creation');
    return;
  }

  // Delete existing rules for this tenant
  for (let h = 0; h < 24; h++) {
    try {
      await scheduler.send(new DeleteScheduleCommand({ Name: `scraper-${tenantId}-h${h}`, GroupName: 'default' }));
    } catch {}
  }

  // Create new rules
  for (const hour of hours) {
    await scheduler.send(new CreateScheduleCommand({
      Name: `scraper-${tenantId}-h${hour}`,
      GroupName: 'default',
      ScheduleExpression: `cron(0 ${hour} * * ? *)`,
      ScheduleExpressionTimezone: 'America/Argentina/Buenos_Aires',
      Target: {
        Arn: lambdaArn,
        RoleArn: roleArn,
        Input: JSON.stringify({ action: 'scrape-run', tenantId }),
      },
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: 'ENABLED',
    }));
  }
}

// ============================================================
// HANDLER
// ============================================================
export async function handleAgents(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];
  if (!tenantId) return error('x-tenant-id header required', 401);

  const agentMatch = path.match(/^\/agents\/([^/]+)$/);

  // GET /agents/:type
  if (method === 'GET' && agentMatch) {
    const agent = await getItem(keys.agent(tenantId, agentMatch[1]));
    return json(agent || { agentConfig: {} });
  }

  // PUT /agents/:type — merge, no pisar businessConfig/onboardingHistory
  if (method === 'PUT' && agentMatch) {
    const body = JSON.parse(event.body || '{}');
    const existing = await getItem(keys.agent(tenantId, agentMatch[1])) || {};
    const agent = {
      ...existing,
      ...keys.agent(tenantId, agentMatch[1]),
      tenantId, agentType: agentMatch[1],
      agentConfig: body.agentConfig || existing.agentConfig || {},
      active: body.active ?? existing.active ?? true,
      updatedAt: new Date().toISOString(),
    };
    await putItem(agent);
    return json(agent);
  }

  // ============================================================
  // POST /agents/test-chat — MISMO PIPELINE QUE WHATSAPP
  // ============================================================
  if (method === 'POST' && path === '/agents/test-chat') {
    const body = JSON.parse(event.body || '{}');
    const { message, history, recentProductNames } = body;
    if (!message) return error('message is required');

    const agent = await getItem(keys.agent(tenantId, 'main'));
    const agentCfg = agent?.agentConfig || {};
    const catalog = (await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 500 }))
      .filter((p: any) => p.name && p.name.length > 2);

    const historyMsgs = (history || []) as { role: string; content: string }[];

    // Rebuild recent products from names
    const recentProducts: any[] = [];
    if (recentProductNames?.length > 0) {
      for (const name of recentProductNames) {
        const found = catalog.find((p: any) => p.name === name);
        if (found) recentProducts.push(found);
      }
    }

    const trivial = isTrivialMessage(message);
    const followUpMsg = isFollowUp(message, recentProducts.length > 0);
    const newProducts = (trivial || followUpMsg) ? [] : searchCatalog(message, catalog);

    const dedup = (arr: any[]) => {
      const seen = new Set<string>();
      return arr.filter((p: any) => { const k = (p.productId || p.name).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    };

    const contextOnly = dedup(recentProducts).slice(0, 6);
    const freshOnly = dedup(newProducts).slice(0, 4);
    const allContext = dedup([...contextOnly, ...freshOnly]);

    const catCounts: Record<string, number> = {};
    for (const p of catalog) { if ((p as any).category) catCounts[(p as any).category] = (catCounts[(p as any).category] || 0) + 1; }
    const categories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ');

    const name = agentCfg.assistantName || 'el vendedor';
    const web = agentCfg.websiteUrl || '';

    const HARDCODED_RULES_TC = `1. SOLO mencionás productos de PRODUCTOS_DISPONIBLES. NUNCA inventes.
2. NUNCA digas "no tengo eso cargado" si hay productos en contexto.
3. NUNCA cierres con "¿algo más?". Pregunta específica.
4. Precio formateado: $XX.XXX
5. Las fotos se envían AUTOMÁTICAMENTE de los productos que nombrás con datos concretos.
6. USO DE buscar_productos: solo si el cliente pide categoría/producto NUEVO.
7. PREGUNTAS COMPARATIVAS: compará por specs de PRODUCTOS_DISPONIBLES.
8. Si el cliente quiere comprar, pedile los datos.
9. Si insulta o pide humano: "Te paso con alguien del equipo."`;

    const activeRules = agentCfg.extraInstructions || HARDCODED_RULES_TC;

    // === PROMPT CACHING ===
    const stableBlock = `Sos un vendedor virtual por WhatsApp de un comercio argentino.

# TONO
Argentino casual, vos, conciso. Máx 1 emoji. WhatsApp real, corto. Máximo 4-5 líneas.
NUNCA uses signos de apertura (¡ ¿). Solo usá los de cierre (! ?).

# REGLAS BASE
${HARDCODED_RULES_TC}`;

    const tenantBlock = `# IDENTIDAD
Nombre: ${name}${web ? `. Web: ${web}` : ''}

${activeRules !== HARDCODED_RULES_TC ? `# REGLAS DEL NEGOCIO\n${activeRules}` : ''}

# CATEGORÍAS
${categories}
${agentCfg.promotions ? `\n# PROMOCIONES\n${agentCfg.promotions}` : ''}
${agentCfg.businessHours ? `\n# HORARIO\n${agentCfg.businessHours}` : ''}
${agentCfg.welcomeMessage ? `\n# MENSAJE DE BIENVENIDA\n${agentCfg.welcomeMessage}` : ''}`;

    const productsBlockTC = `# PRODUCTOS_DISPONIBLES
${allContext.length > 0 ? formatProductsYAML(allContext) : '(ninguno en contexto)'}`;

    const systemPromptBlocks: Anthropic.TextBlockParam[] = [
      { type: 'text', text: stableBlock, cache_control: { type: 'ephemeral' } } as any,
      { type: 'text', text: tenantBlock, cache_control: { type: 'ephemeral' } } as any,
      { type: 'text', text: productsBlockTC },
    ];

    // Build messages
    const msgs: Anthropic.MessageParam[] = [];
    for (const m of historyMsgs) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (msgs.length > 0 && msgs[msgs.length - 1].role === role) {
        msgs[msgs.length - 1].content += '\n' + m.content;
      } else {
        msgs.push({ role, content: m.content });
      }
    }
    if (msgs.length > 0 && msgs[0].role === 'assistant') msgs.shift();
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'user') {
      msgs.push({ role: 'user', content: message });
    }

    try {
      let allShown = [...allContext];
      let fresh = [...freshOnly];

      for (let round = 0; round < 3; round++) {
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 500,
          system: systemPromptBlocks, tools: TOOLS, messages: msgs,
        });

        if (res.stop_reason === 'end_turn') {
          const textBlock = res.content.find(b => b.type === 'text');
          const reply = textBlock ? textBlock.text : 'Disculpá, tuve un problema.';

          // Images: only fresh products mentioned by name
          const images: { url: string; caption: string; name: string }[] = [];
          const replyLower = reply.toLowerCase();
          const recentNorm = new Set(recentProducts.map((p: any) => p.name.toLowerCase().trim()));
          const stopW = new Set(['para','con','sin','remera','musculosa','campera','pantalon','oversize','underwave','hoodie','buzo','short','camisa']);

          for (const p of fresh) {
            if (!p.imageUrl || !p.imageUrl.startsWith('http')) continue;
            if (recentNorm.has(p.name.toLowerCase().trim())) continue;
            const nameWords = p.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3 && !stopW.has(w));
            if (nameWords.some((w: string) => replyLower.includes(w))) {
              images.push({ url: p.imageUrl, caption: `*${p.name}*\n${p.brand ? `${p.brand} | ` : ''}${p.price || ''}`, name: p.name });
            }
          }

          return json({ reply, images: images.slice(0, 3), productNames: allShown.map((p: any) => p.name) });
        }

        if (res.stop_reason === 'tool_use') {
          msgs.push({ role: 'assistant', content: res.content });
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of res.content.filter(b => b.type === 'tool_use')) {
            if (tu.type !== 'tool_use') continue;
            const input = tu.input as { query: string; categoria?: string };
            const found = searchCatalog(input.query, catalog, input.categoria);
            allShown = [...allShown, ...found];
            fresh = [...fresh, ...found];
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: found.length > 0 ? formatProductsYAML(found) : `No encontré para "${input.query}". Categorías: ${categories}` });
          }
          msgs.push({ role: 'user', content: toolResults });
          continue;
        }

        return json({ reply: 'Error', images: [], productNames: [] });
      }
      return json({ reply: 'Error procesando', images: [], productNames: [] });
    } catch (err: any) {
      console.error('test-chat error:', err);
      return error('Error: ' + err.message, 500);
    }
  }

  // ============================================================
  // POST /agents/feedback — GUARDAR CORRECCIÓN Y ACTUALIZAR PROMPT
  // ============================================================
  if (method === 'POST' && path === '/agents/feedback') {
    const body = JSON.parse(event.body || '{}');
    const { messageId, originalResponse, correction, conversationId } = body;
    if (!originalResponse || !correction) return error('originalResponse and correction are required');

    const now = new Date().toISOString();
    const feedbackId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Guardar feedback crudo
    await putItem({
      PK: `TENANT#${tenantId}`,
      SK: `FEEDBACK#${now}#${feedbackId}`,
      tenantId, feedbackId,
      messageId: messageId || null,
      conversationId: conversationId || null,
      originalResponse,
      correction,
      createdAt: now,
    });

    // Leer agente y reglas existentes
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const cfg = agent?.agentConfig || {};

    // Reglas hardcodeadas del sistema (base)
    const HARDCODED_RULES = `1. SOLO mencionás productos de PRODUCTOS_DISPONIBLES. NUNCA inventes productos ni precios.
2. NUNCA mandes al cliente a la web. NUNCA digas "no tengo eso cargado" si PRODUCTOS_DISPONIBLES tiene productos.
3. NUNCA cierres con "¿algo más?". Hacé una pregunta específica o confirmación.
4. Precio formateado: $XX.XXX (ej: $67.186)
5. Las fotos se envían AUTOMÁTICAMENTE. NO listes productos uno por uno con sus datos.
6. USO DE buscar_productos: solo si el cliente pide categoría o producto NUEVO no presente en contexto.
7. PREGUNTAS COMPARATIVAS: compará por specs de PRODUCTOS_DISPONIBLES. Devolvé un ganador con justificación.
8. Si el cliente quiere comprar, pedile los datos necesarios.
9. Si insulta o pide humano: "Te paso con alguien del equipo."
10. FOTOS: Si nombrás un producto, mencionalo COMPLETO con nombre + precio o specs.
11. NUNCA preguntes "¿te mando foto?". O nombrás el producto con datos o no lo nombrás.
12. Si el cliente manda una foto, analizala y buscá productos similares con buscar_productos.
13. Si hablás de un producto ya mostrado, referencialo natural: "la que te mostré", "esa misma".`;

    // Reglas actualizadas por feedback previo (pueden haber modificado las hardcodeadas)
    const currentRules: string = cfg.extraInstructions || HARDCODED_RULES;

    // Haiku: recibe el set completo de reglas y lo actualiza según la corrección
    let proposedRules: string = currentRules;
    try {
      const ruleRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `El agente de ventas cometió un error. Debés actualizar el conjunto de reglas.

REGLAS ACTUALES:
${currentRules}

ERROR COMETIDO:
Respuesta incorrecta del agente: "${originalResponse.slice(0, 300)}"
Corrección indicada: "${correction.slice(0, 300)}"

TAREA:
- Buscá qué regla existente cubre el mismo tema que este error.
- Si existe: modificala para que sea correcta (puede ser una regla hardcodeada o una ya corregida).
- Si no existe: agregá una regla nueva al final.
- Devolvé el bloque COMPLETO de reglas actualizado, incluyendo las que no cambiaron.
- Mantené el formato numerado. No agregues explicaciones.`,
        }],
      });
      const txt = ruleRes.content[0].type === 'text' ? ruleRes.content[0].text.trim() : null;
      if (txt) proposedRules = txt.slice(0, 3000);
    } catch (err) {
      console.error('feedback rule generation error:', err);
    }

    // Generar preview: ¿cómo respondería el agente con las reglas propuestas?
    let previewResponse: string = '';
    try {
      const previewRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Sos un agente de ventas por WhatsApp argentino. Estas son tus reglas de negocio:

${proposedRules}

Situación: el agente respondió incorrectamente esto:
"${originalResponse.slice(0, 300)}"

La corrección indicada fue: "${correction.slice(0, 300)}"

Escribí cómo hubiese respondido el agente CORRECTAMENTE aplicando las reglas actualizadas. Sé breve y natural, como en WhatsApp.`,
        }],
      });
      previewResponse = previewRes.content[0].type === 'text' ? previewRes.content[0].text.trim() : '';
    } catch (err) {
      console.error('feedback preview error:', err);
    }

    return json({ proposedRules, previewResponse });
  }

  // ============================================================
  // POST /agents/feedback/confirm — GUARDAR REGLAS APROBADAS
  // ============================================================
  if (method === 'POST' && path === '/agents/feedback/confirm') {
    const body = JSON.parse(event.body || '{}');
    const { proposedRules } = body;
    if (!proposedRules) return error('proposedRules is required');

    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found', 404);

    const cfg = agent.agentConfig || {};
    cfg.extraInstructions = proposedRules.slice(0, 3000);

    // Sync: si hay businessConfig, actualizar los campos que cambiaron
    const businessConfig = agent.businessConfig || {};
    const updatedBusinessConfig = await syncRulesToBusinessConfig(businessConfig, proposedRules);

    const now = new Date().toISOString();
    await putItem({
      ...agent,
      agentConfig: cfg,
      businessConfig: updatedBusinessConfig,
      lastConfigChange: now,
      updatedAt: now,
    });

    return json({ ok: true, lastConfigChange: now, needsVerification: true });
  }

  // ============================================================
  // POST /agents/scrape — CRAWL COMPLETO + ENRIQUECIMIENTO
  // ============================================================
  if (method === 'POST' && path === '/agents/scrape') {
    const body = JSON.parse(event.body || '{}');
    const { url } = body;
    if (!url) return error('url is required');

    try {
      // PASO 1: Scrapear la página principal para entender la estructura
      const mainPage = await scrapePage(url);
      if (!mainPage) return error('No se pudo acceder a la web.', 400);

      // PASO 2: Opus analiza la web y encuentra las URLs de categorías/productos
      const discoveryRes = await anthropic.messages.create({
        model: 'claude-opus-4-7', max_tokens: 2000,
        system: `Analizas paginas web de tiendas online. Tu trabajo es encontrar TODAS las URLs de categorias o listados de productos.

Busca en el contenido:
- Links a categorias (ej: /categoria/remeras, /products/hoodies)
- Links a secciones de la tienda (ej: /tienda, /shop, /productos)
- Links de navegacion del menu que lleven a productos
- Links de paginacion (ej: ?page=2)

Devolvé JSON: {"categories": [{"url": "URL_COMPLETA", "name": "nombre de la categoria"}], "isProductPage": bool, "hasPagination": bool}

Si la pagina YA ES un listado de productos (no hace falta navegar mas), pon isProductPage=true.
Si es un home o landing, busca los links a las secciones de productos.
Construi URLs completas (no relativas).`,
        messages: [{ role: 'user', content: `URL base: ${url}\n\nContenido:\n${mainPage.content.slice(0, 12000)}` }],
      });
      const discoveryText = discoveryRes.content[0].type === 'text' ? discoveryRes.content[0].text : '{}';
      let discovery: any;
      try {
        discovery = JSON.parse(discoveryText.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      } catch {
        discovery = { categories: [], isProductPage: true };
      }

      // PASO 3: Armar lista de páginas a scrapear
      const pagesToScrape: { url: string; category: string }[] = [];

      if (discovery.isProductPage) {
        pagesToScrape.push({ url, category: '' });
      }

      for (const cat of (discovery.categories || []).slice(0, 20)) {
        if (cat.url && cat.url.startsWith('http')) {
          pagesToScrape.push({ url: cat.url, category: cat.name || '' });
        }
      }

      // Si no encontró nada, usar Google Search como fallback
      if (pagesToScrape.length === 0) {
        const googlePages = await crawlWebsite(url);
        for (const p of googlePages) pagesToScrape.push({ url: p.url, category: '' });
      }

      if (pagesToScrape.length === 0) {
        pagesToScrape.push({ url, category: '' });
      }

      console.log(`[SCRAPE] ${pagesToScrape.length} pages to scrape`);

      // PASO 4: Scrapear cada página + extraer productos
      const allProducts = new Map<string, any>();
      let businessInfo = '';
      const now = new Date().toISOString();

      // Delete old products
      const old = await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 1500 });
      for (const o of old) await putItem({ ...(o as any), PK: 'DELETED', SK: (o as any).SK });

      for (let i = 0; i < pagesToScrape.length; i += 3) {
        const batch = pagesToScrape.slice(i, i + 3);
        const results = await Promise.allSettled(batch.map(async (page) => {
          // Scrapear la página (skip si es la main que ya tenemos)
          let content = page.url === url ? mainPage.content : '';
          if (!content) {
            const scraped = await scrapePage(page.url);
            content = scraped?.content || '';
          }
          if (content.length < 50) return { products: [], businessInfo: '', pageUrl: page.url };

          // Scrapear paginación (página 2)
          let page2Content = '';
          try {
            const p2url = page.url.includes('?') ? page.url + '&page=2' : page.url + '?page=2';
            const p2 = await scrapePage(p2url);
            if (p2 && p2.content.length > 500) page2Content = p2.content;
          } catch {}

          const fullContent = content + (page2Content ? '\n\n--- PAGINA 2 ---\n\n' + page2Content : '');

          const res = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001', max_tokens: 4000,
            system: `Extraé TODOS los productos de esta pagina web de un comercio argentino.

Para CADA producto devolvé:
- "name": nombre completo (marca + modelo si aplica)
- "description": descripcion con specs (materiales, talles disponibles, colores, watts, capacidad, medidas, etc)
- "price": precio EXACTO como aparece. Si no hay → "Consultar"
- "category": "${page.category || 'detectar automaticamente'}"
- "imageUrl": URL de la imagen (.jpg/.jpeg/.png/.webp). URL completa, no relativa
- "brand": marca si la hay
- "sizes": array de talles disponibles si es ropa/calzado (ej: ["S","M","L","XL"])
- "outOfStockSizes": talles agotados si se indica
- "attributes": objeto con specs tecnicas clave (ej: {"potencia_w": 800, "voltaje_v": 220})

REGLAS:
- Solo productos REALES que se venden en la pagina
- Precio exacto, NO inventar
- Si hay variantes de un producto (colores, talles), listar como UN producto con sizes/colores en description
- Incluir TODOS los productos, no solo los primeros
- URLs de imagenes COMPLETAS (empiezan con http)

Tambien extraé info del negocio si la hay: envios, cambios, devoluciones, pagos, horarios, direccion, contacto.

JSON: {"products":[...],"businessInfo":"..."}`,
            messages: [{ role: 'user', content: fullContent.slice(0, 15000) }],
          });
          const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
          try {
            const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
            return { products: parsed.products || [], businessInfo: parsed.businessInfo || '', pageUrl: page.url };
          } catch {
            const m = text.match(/\[[\s\S]*\]/);
            return { products: m ? JSON.parse(m[0]) : [], businessInfo: '', pageUrl: page.url };
          }
        }));

        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          if (r.value.businessInfo) businessInfo += r.value.businessInfo + '\n';
          for (const product of r.value.products) {
            if (!product.name || product.name.length < 3) continue;
            const key = product.name.toLowerCase().trim();
            if (allProducts.has(key)) continue; // dedup

            const productId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const priceNum = typeof product.price === 'string' ? parseInt(product.price.replace(/[^0-9]/g, '')) || 0 : product.price || 0;
            const st = [product.name, product.category, product.brand, product.description].filter(Boolean).join(' ').toLowerCase();

            const item = {
              PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}`,
              tenantId, productId, name: product.name, description: product.description || '',
              price: product.price || 'Consultar', priceNum, category: product.category || '',
              brand: product.brand || '', imageUrl: product.imageUrl || '', pageUrl: r.value.pageUrl,
              sourceUrl: url, searchableText: st,
              categoryNormalized: (product.category || '').toLowerCase().replace(/\s+/g, '_'),
              categoryParent: (product.category || '').toLowerCase().replace(/\s+/g, '_'),
              sizes: product.sizes || [],
              outOfStockSizes: product.outOfStockSizes || [],
              attributes: product.attributes || {},
              createdAt: now,
            };
            await putItem(item);
            allProducts.set(key, { name: product.name, price: product.price, category: product.category, imageUrl: product.imageUrl });
          }
        }
      }

      if (businessInfo.trim()) {
        const existing = await getItem(keys.agent(tenantId, 'main'));
        if (existing) {
          const cfg = existing.agentConfig || {};
          if (!cfg.extraInstructions || cfg.extraInstructions.length < businessInfo.length) {
            cfg.extraInstructions = businessInfo.slice(0, 2000);
          }
          await putItem({ ...existing, agentConfig: cfg, updatedAt: now });
        }
      }

      // Detect business type from scraped products
      try {
        const productSample = Array.from(allProducts.values()).slice(0, 25).map(p => `${p.name}${p.category ? ` (${p.category})` : ''}`).join(', ');
        const rubroRes = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: 300,
          messages: [{ role: 'user', content: `Productos de una tienda online: ${productSample}\n\nDevolvé JSON con: {"rubro": "rubro corto (ej: ropa deportiva, electrónica del hogar, suplementos deportivos)", "calificadores_sugeridos": ["dato1 que siempre hay que preguntar al cliente", "dato2"], "pregunta_apertura": "la pregunta más importante que el vendedor debería hacer al arrancar la conversación"}` }],
        });
        const rubroText = rubroRes.content[0].type === 'text' ? rubroRes.content[0].text : '{}';
        const rubroData = JSON.parse(rubroText.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
        if (rubroData.rubro) {
          const agentItem = await getItem(keys.agent(tenantId, 'main'));
          if (agentItem) {
            const bc = agentItem.businessConfig || {};
            bc.business = {
              ...(bc.business || {}),
              rubro: rubroData.rubro,
              calificadores_sugeridos: rubroData.calificadores_sugeridos || [],
              pregunta_apertura_sugerida: rubroData.pregunta_apertura || '',
            };
            await putItem({ ...agentItem, businessConfig: bc, updatedAt: now });
          }
        }
      } catch (err) {
        console.error('[SCRAPE] rubro detection error:', err);
      }

      // Generate extractor script and save scraper config
      try {
        const samplePage = pagesToScrape[0];
        const sampleMarkdown = (samplePage?.url === url ? mainPage.content : (await scrapePage(samplePage?.url || url))?.content) || mainPage.content;
        const sampleProducts = Array.from(allProducts.values()).slice(0, 15);
        const extractorCode = await generateExtractorCode(sampleMarkdown, sampleProducts);
        const existingCfg = await getItem(keys.scraperConfig(tenantId));
        await putItem({
          ...(existingCfg || {}),
          ...keys.scraperConfig(tenantId),
          tenantId, baseUrl: url,
          pages: pagesToScrape,
          extractorCode,
          schedule: (existingCfg as any)?.schedule || { enabled: false, timesPerDay: 1, hours: [9] },
          lastRun: now,
          createdAt: (existingCfg as any)?.createdAt || now,
          updatedAt: now,
        });
      } catch (err) {
        console.error('[SCRAPER] Failed to generate extractor code:', err);
      }

      return json({ productsCount: allProducts.size, pagesScanned: pagesToScrape.length, products: Array.from(allProducts.values()).slice(0, 30), businessInfo: businessInfo.slice(0, 500) });
    } catch (err: any) {
      return error('Error: ' + err.message, 500);
    }
  }

  // ============================================================
  // POST /agents/scrape/run — RE-RUN WITHOUT AI
  // ============================================================
  if (method === 'POST' && path === '/agents/scrape/run') {
    try {
      const result = await runScraper(tenantId);
      return json(result);
    } catch (err: any) {
      return error('Error: ' + err.message, 500);
    }
  }

  // ============================================================
  // GET /agents/products — LIST ALL PRODUCTS
  // ============================================================
  if (method === 'GET' && path === '/agents/products') {
    const items = await queryItems(`TENANT#${tenantId}`, 'PRODUCT#', { limit: 1500 });
    const products = items
      .filter((p: any) => p.PK !== 'DELETED' && p.name && p.name.length > 1)
      .map((p: any) => ({
        productId: p.productId,
        name: p.name,
        price: p.price,
        priceNum: p.priceNum,
        category: p.category,
        brand: p.brand,
        description: p.description,
        imageUrl: p.imageUrl,
        sizes: p.sizes,
      }));
    return json({ products, total: products.length });
  }

  // ============================================================
  // GET /agents/scrape/schedule — GET SCHEDULE CONFIG
  // ============================================================
  if (method === 'GET' && path === '/agents/scrape/schedule') {
    const cfg = await getItem(keys.scraperConfig(tenantId));
    if (!cfg) return json({ configured: false });
    return json({
      configured: true,
      baseUrl: cfg.baseUrl,
      lastRun: cfg.lastRun,
      schedule: cfg.schedule || { enabled: false, timesPerDay: 1, hours: [9] },
    });
  }

  // ============================================================
  // PUT /agents/scrape/schedule — SAVE SCHEDULE + EVENTBRIDGE
  // ============================================================
  if (method === 'PUT' && path === '/agents/scrape/schedule') {
    const body = JSON.parse(event.body || '{}');
    const { enabled, timesPerDay, hours } = body;
    if (!Array.isArray(hours)) return error('hours array is required');

    const cfg = await getItem(keys.scraperConfig(tenantId));
    if (!cfg) return error('Primero debés hacer un escaneo inicial.', 400);

    const schedule = { enabled: !!enabled, timesPerDay: timesPerDay || hours.length, hours };
    await putItem({ ...(cfg as any), schedule, updatedAt: new Date().toISOString() });

    if (enabled && hours.length > 0) {
      try { await upsertSchedules(tenantId, hours); } catch (err) {
        console.error('[SCRAPER-SCHEDULE] EventBridge error:', err);
      }
    } else {
      // Disable: delete existing rules
      try { await upsertSchedules(tenantId, []); } catch {}
    }

    return json({ ok: true, schedule });
  }

  return error('Not found', 404);
}

// ============================================================
// SYNC: reglas de feedback → businessConfig
// Cuando se confirman correcciones, Haiku detecta si algún campo
// del businessConfig necesita actualizarse y devuelve los updates.
// ============================================================
async function syncRulesToBusinessConfig(
  businessConfig: any,
  newRules: string,
): Promise<any> {
  if (!businessConfig || Object.keys(businessConfig).length === 0) return businessConfig;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `Sos un sincronizador de datos. Te doy la configuracion actual de un negocio (businessConfig) y las reglas nuevas del prompt.

Tu trabajo: detectar si las reglas nuevas CONTRADICEN o ACTUALIZAN algun campo del businessConfig. Si es asi, devolver los campos actualizados.

Devolvé JSON con SOLO los campos que cambiaron, usando la misma estructura del businessConfig.
Si nada cambió, devolvé: {}

Ejemplos:
- Regla dice "garantia 30 dias" pero businessConfig.politicas.garantia dice "no aplica" → {"politicas": {"garantia": "30 dias"}}
- Regla dice "ahora aceptamos MercadoPago" pero businessConfig.pago.metodos no lo incluye → {"pago": {"metodos": "..., MercadoPago"}}
- Regla dice "no hacer descuentos" → no contradice nada estructural → {}

SOLO devolvé el JSON, nada mas.`,
      messages: [{
        role: 'user',
        content: `BUSINESS CONFIG ACTUAL:\n${JSON.stringify(businessConfig, null, 2)}\n\nREGLAS NUEVAS:\n${newRules}`,
      }],
    });

    const text = res.content.find(b => b.type === 'text')?.text || '{}';
    const updates = JSON.parse(text.replace(/```json|```/g, '').trim());

    if (!updates || Object.keys(updates).length === 0) return businessConfig;

    // Merge profundo
    const merged = { ...businessConfig };
    for (const [section, fields] of Object.entries(updates)) {
      if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) {
        merged[section] = { ...(merged[section] || {}), ...(fields as Record<string, any>) };
      } else {
        merged[section] = fields;
      }
    }

    console.log(`[SYNC] businessConfig updated: ${Object.keys(updates).join(', ')}`);
    return merged;
  } catch (err) {
    console.error('[SYNC] Failed to sync rules to businessConfig:', err);
    return businessConfig;
  }
}
