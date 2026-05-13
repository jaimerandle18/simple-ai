import { SQSEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import Anthropic from '@anthropic-ai/sdk';
import Fuse from 'fuse.js';
import { getItem, putItem, queryItems, queryAllItems, queryByGSI, deleteItem, batchDeleteItems, keys } from './lib/dynamo-helpers';
import { getCachedCatalog } from './lib/catalog-loader';
import sharp from 'sharp';
import type { EnrichedProduct } from './lib/types';
import {
  shouldEscalate, isCircuitOpen, recordSuccess, recordFailure,
  getFallbackMessage, checkRateLimit, detectInjectionWithLLM,
  INJECTION_RESPONSE,
} from './lib/production-guards';
import { transcribeWhatsAppAudio, downloadWhatsAppMedia } from './lib/audio-transcriber';
import { loadContactMemory, updateContactMemory } from './lib/contact-memory';
import { logTurnMetrics } from './lib/ab-testing';
import { CALCULADORA_TOOL, calcularMateriales } from './lib/calculadora-blockplas';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;
const MAX_FILES_CONTEXT = 4000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// TOOL DEFINITIONS para Claude
// ============================================================
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_productos',
    description: 'Busca productos en el catálogo del negocio. Usala cuando necesites encontrar productos por nombre, categoría, uso, o cuando el cliente pida comparar o ver más opciones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Texto libre para buscar: nombre de producto, categoría, uso, etc. Ej: "amoladora", "sierras", "para cortar madera"',
        },
        categoria: {
          type: 'string',
          description: 'Filtrar por categoría específica. Ej: "Amoladoras Angulares", "Hidrolavadoras"',
        },
      },
      required: ['query'],
    },
  },
];

// ============================================================
// BÚSQUEDA DE PRODUCTOS (Fuse.js, cero LLM)
// ============================================================
function searchCatalog(query: string, catalog: EnrichedProduct[], categoria?: string): EnrichedProduct[] {
  let pool = catalog;

  // Filtrar por categoría si se pidió
  if (categoria) {
    const catNorm = categoria.toLowerCase();
    const filtered = pool.filter(p =>
      (p.category || '').toLowerCase().includes(catNorm) ||
      (p.categoryNormalized || '').toLowerCase().includes(catNorm) ||
      (p.categoryParent || '').toLowerCase().includes(catNorm)
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
  if (results.length > 0) {
    return results.slice(0, 6).map(r => r.item);
  }

  // Fallback: búsqueda por keywords en texto
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = normalize(query).split(/\s+/).filter(t => t.length >= 3);
  if (terms.length === 0) return [];

  return pool
    .map(p => {
      const text = normalize(`${p.name} ${p.category || ''} ${p.brand || ''} ${p.description || ''}`);
      let score = 0;
      for (const t of terms) { if (text.includes(t)) score += 10; }
      return { product: p, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(x => x.product);
}

// ============================================================
// FORMATEAR PRODUCTOS PARA EL PROMPT (JSON compacto)
// ============================================================
// Diccionario: i=id, n=nombre, m=marca, c=categoría, pr=precio, pd=precio display, s=specs, t=talles, ta=talles agotados, d=descripción
function formatProductsForPrompt(products: EnrichedProduct[]): string {
  if (products.length === 0) return '(ninguno cargado en este contexto, usá buscar_productos si necesitás)';

  const compact = products.map((p, i) => {
    const item: Record<string, any> = {
      i: i + 1,
      n: p.name,
      m: p.brand || undefined,
      c: p.category || undefined,
      pr: p.priceNum || undefined,
      pd: `$${(p.priceNum || 0).toLocaleString('es-AR')}`,
    };

    // Specs compactas (filtrar nulls)
    if (p.attributes && Object.keys(p.attributes).length > 0) {
      const specs: Record<string, any> = {};
      for (const [k, v] of Object.entries(p.attributes)) {
        if (v !== null && v !== undefined) specs[k] = v;
      }
      if (Object.keys(specs).length > 0) item.s = specs;
    }

    // Talles
    const sizes = (p as any).sizes;
    const outOfStock = (p as any).outOfStockSizes;
    if (sizes && sizes.length > 0) item.t = sizes;
    if (outOfStock && outOfStock.length > 0) item.ta = outOfStock;

    if (p.description) item.d = p.description.slice(0, 120);

    // Limpiar undefined
    return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
  });

  return JSON.stringify({ p: compact });
}

// ============================================================
// DEDUP PRODUCTOS (por nombre normalizado)
// ============================================================
function dedupProducts(products: EnrichedProduct[]): EnrichedProduct[] {
  const seen = new Set<string>();
  return products.filter(p => {
    const key = (p.productId || p.name).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// DETECTAR MENSAJES TRIVIALES (saludos, ok, gracias, etc.)
// ============================================================
const TRIVIAL_PATTERNS = [
  /^(hola|holaa+|hi|hey|buenas|buen[oa]s?\s*d[ií]as?|buenas\s*tardes|buenas\s*noches|que\s*tal)\s*[!.?]*$/i,
  /^(gracias|graciaas+|grax|thank|thx)\s*[!.?]*$/i,
  /^(ok|okey|listo|dale|perfecto|genial|joya|buenisimo|excelente)\s*[!.?]*$/i,
  /^(s[ií]|no|tal\s*vez|quiz[aá]s?)\s*[!.?]*$/i,
  /^(chau|nos\s*vemos|hasta\s*luego|adi[oó]s|bye)\s*[!.?]*$/i,
  /^.{1,3}$/,
];

function isTrivialMessage(message: string): boolean {
  return TRIVIAL_PATTERNS.some(p => p.test(message.trim()));
}

// ============================================================
// DETECTAR SEGUIMIENTOS (preguntas sobre productos ya mostrados)
// ============================================================
function isFollowUpMessage(message: string, hasRecentProducts: boolean, recentNames?: string[]): boolean {
  if (!hasRecentProducts) return false;

  const followUpPatterns = [
    /^y\s+(en|de|el|la|las|los)\s+/i,
    /^cu[áa]l(\s+es)?\s+/i,
    /^(la|el|las|los)\s+(m[áa]s|menos)\s+/i,
    /^(la|el)\s+(primera|segund|[úu]ltim)/i,
    /^y\s+(esta|este|esa|ese|aquel)/i,
    /^(que|qu[eé])\s+(talle|color|medida|tama[ñn]o)/i,
    /^en\s+(talle|color|que)\s+/i,
    /en\s+talle\s+(XS|S|M|L|XL|XXL|\d{2})/i,
    /^tenes\s+(en\s+)?(otro|otra|mas)/i,
    /diferencia\s+entre/i,
    /cu[aá]l\s+me\s+conviene/i,
    /^y\s*\?$/i,
    /^(cuanto|cu[áa]nto)\s+(sale|cuesta|est[áa])/i,
    /^me\s+(llevo|quedo\s+con)/i,
    /^(lo|la)\s+quiero/i,
    /la\s+tenes\s*\??$/i,
    /lo\s+tenes\s*\??$/i,
    /tenes\s+stock/i,
    /hay\s+stock/i,
    /queda(n)?\s+(en|de)\s+/i,
    /^ah\s+(barbaro|genial|dale|ok|bueno)/i,  // "ah barbaro y..."
  ];

  if (followUpPatterns.some(p => p.test(message.trim()))) return true;

  // Si el mensaje menciona un producto ya mostrado, es follow-up
  if (recentNames && recentNames.length > 0) {
    const msgLower = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const name of recentNames) {
      const words = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/).filter(w => w.length > 4);
      const matches = words.filter(w => msgLower.includes(w)).length;
      if (matches >= 2) return true; // menciona un producto ya mostrado → follow-up
    }
  }

  return false;
}

// ============================================================
// FILTRO ESTRICTO: ¿mandar foto de este producto?
// ============================================================
const ASKING_PHOTO_PATTERNS = [
  /te (la|lo|las|los) mando (con )?foto/i,
  /quer[eé]s (que te mande|ver) (la|las|el|los) foto/i,
  /te paso (la|las|el|los) foto/i,
  /te mando.{0,10}foto/i,
];

// Calcular palabras REALMENTE únicas de un producto vs el resto del contexto
function getDistinctiveWords(product: EnrichedProduct, allProducts: EnrichedProduct[]): string[] {
  const stopWords = new Set([
    // Genéricos
    'para', 'con', 'sin', 'mas', 'menos', 'desde', 'hasta', 'manga', 'larga',
    // Marcas
    'pagio', 'dowen', 'underwave',
    // Tipos de prenda (categorías genéricas)
    'remera', 'remeras', 'musculosa', 'musculosas',
    'campera', 'camperas', 'buzo', 'buzos', 'hoodie', 'hoodies',
    'pantalon', 'pantalones', 'bermuda', 'bermudas',
    'short', 'shorts', 'jean', 'jeans', 'denim',
    'camisa', 'camisas', 'chaleco', 'chalecos',
    'boardshort', 'boardshorts', 'calza', 'piluso', 'gorra', 'sombrero',
    // Estilos genéricos
    'oversize', 'oversized', 'classic', 'basic', 'standard', 'regular', 'deportiva', 'deportivo',
    // Ferretería
    'amoladora', 'sierra', 'taladro', 'aspiradora', 'hidrolavadora',
    'solo', 'cuerpo', 'alta', 'presion', 'angular', 'electrica', 'inalambrica',
  ]);

  const myWords = product.name.toLowerCase().split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  const otherProducts = allProducts.filter(p => p.name !== product.name);
  if (otherProducts.length === 0) return myWords;

  return myWords.filter(w => {
    const othersWithWord = otherProducts.filter(p =>
      p.name.toLowerCase().split(/\s+/).includes(w)
    );
    // Si la palabra aparece en >40% de otros productos, NO es distintiva
    return othersWithWord.length / Math.max(1, otherProducts.length) < 0.4;
  });
}

function shouldSendPhoto(product: EnrichedProduct, aiResponse: string, allProducts: EnrichedProduct[]): boolean {
  const responseLower = aiResponse.toLowerCase();

  if (ASKING_PHOTO_PATTERNS.some(p => p.test(aiResponse))) return false;

  const distinctiveWords = getDistinctiveWords(product, allProducts);
  const matchedWords = distinctiveWords.filter(w => responseLower.includes(w));
  const distinctiveMatchCount = matchedWords.length;

  console.log(`[FILTER] "${product.name}" → distinctive=[${distinctiveWords.join(',')}] matched=[${matchedWords.join(',')}]`);

  if (distinctiveMatchCount === 0) return false;

  // Match PRINCIPAL: precio exacto + palabra distintiva
  if (product.priceNum && distinctiveMatchCount >= 1) {
    const priceStr = product.priceNum.toLocaleString('es-AR');
    const idx = responseLower.indexOf(priceStr);
    if (idx >= 0) {
      const before = responseLower.slice(Math.max(0, idx - 25), idx);
      const isRange = /(desde|a partir de|arrancan en|empiezan en|van desde|empezando en|partiendo de)\s*\$?\s*$/i.test(before);
      if (!isRange) { console.log(`[FILTER] "${product.name}" → PASS (price+name)`); return true; }
    }
  }

  // Match SECUNDARIO: 2+ palabras distintivas
  if (distinctiveMatchCount >= 2) {
    if (product.attributes) {
      const potencia = product.attributes.potencia_w;
      const voltaje = product.attributes.voltaje_v;
      if (potencia && responseLower.includes(`${potencia}w`)) { console.log(`[FILTER] "${product.name}" → PASS (2words+spec)`); return true; }
      if (voltaje && responseLower.includes(`${voltaje}v`)) { console.log(`[FILTER] "${product.name}" → PASS (2words+spec)`); return true; }
    }
    console.log(`[FILTER] "${product.name}" → PASS (2+ distinctive)`);
    return true;
  }

  console.log(`[FILTER] "${product.name}" → FAIL (only ${distinctiveMatchCount} distinctive)`);
  return false;
}

// ============================================================
// GENERAR RESPUESTA CON CLAUDE (con tool use)
// ============================================================
type MessageComplexity = 'trivial' | 'followup' | 'new_query' | 'image';

function chooseModel(complexity: MessageComplexity): string {
  // Trivial y follow-up → Haiku (barato, rápido)
  // New query e image → Sonnet (mejor razonamiento)
  if (complexity === 'trivial' || complexity === 'followup') return 'claude-haiku-4-5-20251001';
  return 'claude-sonnet-4-6';
}

function chooseMaxRounds(complexity: MessageComplexity): number {
  if (complexity === 'trivial') return 0;     // sin tools
  if (complexity === 'followup') return 1;    // máx 1 tool call
  if (complexity === 'image') return 3;       // puede necesitar buscar
  return 2;                                   // new_query
}

async function generateResponse(
  userMessage: string,
  history: Anthropic.MessageParam[],
  contextProducts: EnrichedProduct[],
  freshSearchProducts: EnrichedProduct[],
  catalog: EnrichedProduct[],
  agentConfig: any,
  imageData?: { base64: string; mimeType: string },
  complexity: MessageComplexity = 'new_query',
  historySummary?: string,
  extraTools?: Anthropic.Tool[],
): Promise<{ text: string; productsShown: EnrichedProduct[]; freshProducts: EnrichedProduct[] }> {
  const name = agentConfig.assistantName || 'el vendedor';
  const web = agentConfig.websiteUrl || '';

  const allContextProducts = dedupProducts([...contextProducts, ...freshSearchProducts]);
  let allProductsShown = [...allContextProducts];
  let freshProducts = [...freshSearchProducts];

  // Categorías disponibles para contexto
  const catCounts: Record<string, number> = {};
  for (const p of catalog) { if (p.category) catCounts[p.category] = (catCounts[p.category] || 0) + 1; }
  const categories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ');

  const productsBlock = allContextProducts.length > 0
    ? `\n# PRODUCTOS_DISPONIBLES (formato compacto)\ni=id, n=nombre, m=marca, c=categoría, pr=precio numérico, pd=precio display, s=specs, t=talles disponibles, ta=talles agotados, d=descripción\n${formatProductsForPrompt(allContextProducts)}`
    : '\n# PRODUCTOS_DISPONIBLES\n(ninguno en contexto, usá buscar_productos para encontrar)';

  const HARDCODED_RULES = `1. SOLO mencionás productos de PRODUCTOS_DISPONIBLES. NUNCA inventes productos ni precios.
2. NUNCA mandes al cliente a la web. NUNCA digas "no tengo eso cargado" si PRODUCTOS_DISPONIBLES tiene productos.
3. NUNCA cierres con "¿algo más?". Hacé una pregunta específica o confirmación.
4. Precio formateado: $XX.XXX (ej: $67.186)
5. Las fotos se envían AUTOMÁTICAMENTE. NO listes productos uno por uno con sus datos. Hacé una intro corta + dato clave + pregunta.
6. USO DE buscar_productos: solo si el cliente pide categoría o producto NUEVO no presente en PRODUCTOS_DISPONIBLES. Query con palabras clave, NO frases.
7. PREGUNTAS COMPARATIVAS: compará por specs de PRODUCTOS_DISPONIBLES. Devolvé un ganador con justificación numérica.
8. CAMBIO DE CATEGORÍA: si el cliente menciona una categoría distinta, usá buscar_productos.
9. ENVÍOS, PAGOS, HORARIOS, UBICACIÓN: respondé con lo que sepas. Si no tenés el dato exacto, derivá.
10. INTENCIÓN DE COMPRA: si el cliente quiere comprar, pedile los datos necesarios.
11. ESCALAMIENTO: si insulta o pide humano: "Te paso con alguien del equipo."
12. FOTOS: si nombrás un producto, mencionalo COMPLETO con nombre + precio o specs.
13. NUNCA preguntes "¿te mando foto?". O nombrás el producto con datos o no lo nombrás.
14. IMAGENES DEL CLIENTE: si manda una foto, analizala y buscá productos similares con buscar_productos.
15. PRODUCTOS YA MOSTRADOS: referenciá natural: "la que te mostré", "esa misma". No re-introduzcas productos ya vistos.
16. INFO DEL NEGOCIO: si hay secciones de INFORMACION_NEGOCIO o PAGINAS_DEL_SITIO, usá esos datos para responder preguntas sobre envíos, pagos, cambios, horarios, ubicación. NO digas "no tengo esa info" si está disponible.`;

  const activeRules = agentConfig.extraInstructions || HARDCODED_RULES;

  // === PROMPT CACHING: separar en bloques estables vs volátiles ===
  // Bloque 1: ESTABLE (idéntico para todos los tenants, cambia solo con deploys)
  // → cache_control: ephemeral (se cachea ~5 min entre mensajes del mismo tenant)
  const stableBlock = `Sos un vendedor virtual por WhatsApp de un comercio argentino.

# TONO
Argentino casual, vos, conciso. Máx 1 emoji. WhatsApp real, corto. Máximo 4-5 líneas.
NUNCA uses signos de apertura (¡ ¿). Solo usá los de cierre (! ?).

# REGLAS
${HARDCODED_RULES}`;

  // Bloque 2: SEMI-ESTABLE (cambia por tenant, pero raramente dentro de una conversación)
  // → cache_control: ephemeral
  const tenantBlock = `# IDENTIDAD
Nombre: ${name}${web ? `. Web: ${web}` : ''}

# REGLAS DEL NEGOCIO
${activeRules !== HARDCODED_RULES ? activeRules : '(usar reglas base)'}

# CATEGORÍAS DEL CATÁLOGO
${categories}
${agentConfig.promotions ? `\n# PROMOCIONES\n${agentConfig.promotions}` : ''}
${agentConfig.businessHours ? `\n# HORARIO\n${agentConfig.businessHours}` : ''}
${agentConfig.welcomeMessage ? `\n# MENSAJE DE BIENVENIDA (usar en primer saludo)\n${agentConfig.welcomeMessage}` : ''}`;

  // Bloque 3: VOLÁTIL (cambia cada turno — NO cacheable)
  const memoryBlock = agentConfig._contactMemory
    ? `\n# MEMORIA DEL CLIENTE (de conversaciones anteriores)\n${agentConfig._contactMemory}\nUsá esta info para personalizar: saludá por nombre si lo sabés, recordá lo que consultó antes.`
    : '';
  const sitePagesBlock = agentConfig._sitePages
    ? `\n# PAGINAS_DEL_SITIO (info real del negocio, usala para responder)\n${agentConfig._sitePages}`
    : '';
  const summaryBlock = historySummary
    ? `\n# RESUMEN DE CONVERSACIÓN PREVIA\n${historySummary}`
    : '';
  const volatileBlock = memoryBlock + summaryBlock + sitePagesBlock + productsBlock;

  // System prompt como array con cache_control para Anthropic
  const systemPromptBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: stableBlock,
      cache_control: { type: 'ephemeral' },
    } as any,
    {
      type: 'text',
      text: tenantBlock,
      cache_control: { type: 'ephemeral' },
    } as any,
    {
      type: 'text',
      text: volatileBlock,
    },
  ];

  // Construir mensajes
  const messages: Anthropic.MessageParam[] = [...history];

  // Asegurar que empiece con user y termine con user
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    if (imageData) {
      // Mensaje con imagen + texto
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageData.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageData.base64,
            },
          },
          { type: 'text', text: userMessage },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }
  }

  // Routing: modelo y max rounds según complejidad
  const model = chooseModel(complexity);
  const maxRounds = chooseMaxRounds(complexity);
  console.log(`[MODEL] complexity=${complexity} → model=${model}, maxRounds=${maxRounds}`);

  const seenToolCalls = new Map<string, number>();
  const MAX_SAME_TOOL = 3;

  for (let round = 0; round <= maxRounds; round++) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: complexity === 'trivial' ? 200 : 500,
      system: systemPromptBlocks,
      ...(maxRounds > 0 ? { tools: [...TOOLS, ...(extraTools || [])] } : {}),
      messages,
    });

    // Log cache token metrics
    const usage = res.usage as any;
    if (usage) {
      console.log(`[CACHE] round=${round} input=${usage.input_tokens} output=${usage.output_tokens} cache_read=${usage.cache_read_input_tokens || 0} cache_create=${usage.cache_creation_input_tokens || 0}`);
    }

    // Si no hay tool use, devolver el texto
    if (res.stop_reason === 'end_turn') {
      const textBlock = res.content.find(b => b.type === 'text');
      return {
        text: textBlock ? textBlock.text : 'Disculpá, tuve un problema. ¿Podés repetirme?',
        productsShown: allProductsShown, freshProducts,
      };
    }

    // Procesar tool use
    if (res.stop_reason === 'tool_use') {
      const toolUseBlocks = res.content.filter(b => b.type === 'tool_use');

      // Loop detection: si la misma tool se llamó 3+ veces, forzar respuesta de texto
      let loopDetected = false;
      for (const tu of toolUseBlocks) {
        if (tu.type !== 'tool_use') continue;
        const count = (seenToolCalls.get(tu.name) || 0) + 1;
        seenToolCalls.set(tu.name, count);
        if (count > MAX_SAME_TOOL) {
          console.warn(`[LOOP DETECTION] Tool ${tu.name} called ${count}x, breaking`);
          loopDetected = true;
        }
      }

      if (loopDetected) {
        messages.push({ role: 'assistant', content: res.content });
        messages.push({ role: 'user', content: 'Ya tenés la info necesaria. Respondé al usuario con texto sin llamar más tools.' });
        const finalRes = await anthropic.messages.create({
          model, max_tokens: 500, system: systemPromptBlocks, messages,
        });
        const textBlock = finalRes.content.find(b => b.type === 'text');
        return {
          text: textBlock ? textBlock.text : 'Disculpá, tuve un problema. ¿Podés repetirme?',
          productsShown: allProductsShown, freshProducts,
        };
      }

      // Agregar el turno del assistant con todos los content blocks
      messages.push({ role: 'assistant', content: res.content });

      // Procesar cada tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.type !== 'tool_use') continue;

        if (toolUse.name === 'buscar_productos') {
          const input = toolUse.input as { query: string; categoria?: string };
          console.log(`Tool call: buscar_productos("${input.query}"${input.categoria ? `, cat="${input.categoria}"` : ''})`);
          const found = searchCatalog(input.query, catalog, input.categoria);
          allProductsShown = [...allProductsShown, ...found];
          freshProducts = [...freshProducts, ...found];
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: found.length > 0
              ? `Productos encontrados (i=id,n=nombre,m=marca,pr=precio,pd=display,s=specs,t=talles,d=desc):\n${formatProductsForPrompt(found)}`
              : `No encontré productos para "${input.query}". Categorías disponibles: ${categories}`,
          });
        } else if (toolUse.name === 'calcular_materiales') {
          const input = toolUse.input as any;
          console.log(`Tool call: calcular_materiales`, JSON.stringify(input).slice(0, 200));
          const resultado = calcularMateriales(input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: resultado.resumen,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Fallback: extraer texto de lo que haya
    const textBlock = res.content.find(b => b.type === 'text');
    return {
      text: textBlock ? textBlock.text : 'Disculpá, tuve un problema. ¿Podés repetirme?',
      productsShown: allProductsShown, freshProducts,
    };
  }

  // Si agotó rondas sin texto, retry forzando respuesta sin tools
  console.warn(`[MAX_ROUNDS] Exhausted ${maxRounds} rounds, forcing text response`);
  messages.push({ role: 'user', content: 'Respondé al usuario directamente con la info que ya tenés.' });
  try {
    const finalRes = await anthropic.messages.create({
      model, max_tokens: 500, system: systemPromptBlocks, messages,
    });
    const textBlock = finalRes.content.find(b => b.type === 'text');
    if (textBlock) return { text: textBlock.text, productsShown: allProductsShown, freshProducts };
  } catch { /* fall through */ }

  return { text: 'Disculpá, tuve un problema procesando tu consulta. ¿Podés repetirme?', productsShown: allProductsShown, freshProducts };
}

// ============================================================
// HISTORY SLIDING WINDOW: últimos 5 crudos, 6-20 resumidos
// ============================================================
async function buildOptimizedHistory(
  conversationId: string,
  historyItems: any[],
): Promise<{ history: Anthropic.MessageParam[]; summary: string }> {
  // Construir todos los mensajes alternando roles
  const allMessages: { role: 'user' | 'assistant'; content: string; id?: string }[] = [];
  for (const item of historyItems) {
    const role = (item as any).direction === 'inbound' ? 'user' as const : 'assistant' as const;
    const content = (item as any).content as string;
    const id = (item as any).messageId as string;
    if (allMessages.length > 0 && allMessages[allMessages.length - 1].role === role) {
      allMessages[allMessages.length - 1].content += '\n' + content;
    } else {
      allMessages.push({ role, content, id });
    }
  }

  // Asegurar que empiece con 'user'
  if (allMessages.length > 0 && allMessages[0].role === 'assistant') {
    allMessages.shift();
  }

  // Si <= 5 mensajes, no necesitamos resumen
  if (allMessages.length <= 5) {
    return {
      history: allMessages.map(m => ({ role: m.role, content: m.content })),
      summary: '',
    };
  }

  // Split: últimos 5 crudos, resto para resumen
  const recentMessages = allMessages.slice(-5);
  const olderMessages = allMessages.slice(0, -5);

  // Cache key basado en el último mensaje del batch viejo
  const lastOlderId = olderMessages[olderMessages.length - 1]?.id || 'unknown';
  const cacheKey = { PK: `CONVSUMMARY#${conversationId}`, SK: lastOlderId };

  let summary = '';
  try {
    const cached = await getItem(cacheKey);
    if (cached?.summary) {
      summary = cached.summary as string;
      console.log(`[HISTORY] Cache hit for summary (${olderMessages.length} older msgs)`);
    }
  } catch { /* miss */ }

  if (!summary && olderMessages.length > 0) {
    try {
      const formatted = olderMessages.map(m =>
        `${m.role === 'user' ? 'Cliente' : 'Agente'}: ${m.content.slice(0, 150)}`
      ).join('\n');

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Resumí esta conversación de WhatsApp en máx 100 palabras. Incluí: qué consultó, qué productos le mostraron, qué preferencias expresó. SOLO el resumen.\n\n${formatted}`,
        }],
      });

      summary = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
      if (summary) {
        await putItem({
          ...cacheKey, summary,
          ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hora
        });
        console.log(`[HISTORY] Generated summary (${olderMessages.length} msgs → ${summary.length} chars)`);
      }
    } catch (err: any) {
      console.error('[HISTORY] Summary generation failed:', err.message);
    }
  }

  return {
    history: recentMessages.map(m => ({ role: m.role, content: m.content })),
    summary,
  };
}

// ============================================================
// HELPERS
// ============================================================
async function loadFilesContext(attachedFiles: any[]): Promise<string> {
  if (!attachedFiles || attachedFiles.length === 0) return '';
  const texts: string[] = [];
  let totalLength = 0;
  for (const file of attachedFiles) {
    if (totalLength >= MAX_FILES_CONTEXT) break;
    const extractedKey = file.extractedKey;
    if (!extractedKey) continue;
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: extractedKey }));
      const text = await res.Body?.transformToString('utf-8');
      if (text) {
        const remaining = MAX_FILES_CONTEXT - totalLength;
        const chunk = text.slice(0, remaining);
        texts.push(`--- ${file.fileName} ---\n${chunk}`);
        totalLength += chunk.length;
      }
    } catch (err) {
      console.error(`Error reading file ${extractedKey}:`, err);
    }
  }
  return texts.join('\n\n');
}

// ============================================================
// CHANNEL IMPORTS
// ============================================================
import {
  NormalizedMessage, ChannelAdapter, ChannelType,
  WhatsAppAdapter, WahaAdapter, EvolutionAdapter,
  InstagramAdapter, FacebookAdapter,
  formatOutbound,
} from './lib/channels';

// ============================================================
// HANDLER
// ============================================================
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);

    if (body.type === 'test_message') {
      await processTestMessage(body);
      continue;
    }

    // WhatsApp Cloud API (Meta)
    if (body.object === 'whatsapp_business_account') {
      const waAdapter = new WhatsAppAdapter({ phoneNumberId: '', accessToken: '' });
      const messages = waAdapter.parseWebhook(body);
      const statuses = waAdapter.parseStatusUpdates(body);

      for (const msg of messages) {
        // Resolver tenantId y credenciales desde el phoneNumberId
        const phoneNumberId = msg.channelMetadata.phoneNumberId;
        const channels = await queryByGSI('byChannelExternalId', 'channelExternalId', phoneNumberId);
        const channel = channels[0];
        if (!channel) { console.error(`No channel for ${phoneNumberId}`); continue; }

        msg.tenantId = channel.tenantId as string;
        waAdapter.setCredentials({ phoneNumberId, accessToken: channel.accessToken as string });
        await processNormalizedMessage(msg, waAdapter);
      }

      for (const status of statuses) {
        await processStatusUpdate(status);
      }
      continue;
    }

    // WAHA
    if (body.event === 'message' && body.session) {
      const sessionName = body.session || 'default';
      const wahaUrl = (process.env.WAHA_URL || '').replace(/\/$/, '');
      const apiKey = process.env.WAHA_API_KEY || '';
      if (!wahaUrl) { console.error('[WAHA] WAHA_URL not configured'); continue; }

      const wahaAdapter = new WahaAdapter({ wahaUrl, apiKey, sessionName });
      const messages = wahaAdapter.parseWebhook(body);

      for (const msg of messages) {
        // Resolver tenantId desde session
        const ownerRecord = await getItem({ PK: `WAHA_SESSION#${sessionName}`, SK: 'OWNER' });
        if (!ownerRecord?.tenantId) { console.error(`[WAHA] No owner for session ${sessionName}`); continue; }
        msg.tenantId = ownerRecord.tenantId as string;

        const wahaChannel = await getItem(keys.wahaChannel(msg.tenantId));
        if (!wahaChannel?.active) { console.error(`[WAHA] No active channel for ${msg.tenantId}`); continue; }

        await processNormalizedMessage(msg, wahaAdapter);
      }
      continue;
    }

    // Evolution API
    if (body.event === 'messages.upsert' && body.instance) {
      const instanceName = body.instance || '';
      const evolutionUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
      const apiKey = process.env.EVOLUTION_API_KEY || '';
      if (!evolutionUrl) { console.error('[EVOLUTION] EVOLUTION_API_URL not configured'); continue; }

      const evoAdapter = new EvolutionAdapter({ evolutionUrl, apiKey, instanceName });
      const messages = evoAdapter.parseWebhook(body);

      for (const msg of messages) {
        const evoChannel = await getItem(keys.evolutionChannel(msg.tenantId));
        if (!evoChannel?.active) { console.error(`[EVOLUTION] No active channel for ${msg.tenantId}`); continue; }
        await processNormalizedMessage(msg, evoAdapter);
      }
      continue;
    }

    // Instagram
    if (body.object === 'instagram') {
      const igAdapter = new InstagramAdapter({ pageId: '', accessToken: '' });
      const messages = igAdapter.parseWebhook(body);

      for (const msg of messages) {
        const pageId = msg.channelMetadata.pageId;
        // Lookup canal IG por pageId
        const channels = await queryByGSI('byChannelExternalId', 'channelExternalId', `ig_${pageId}`);
        const channel = channels[0];
        if (!channel) { console.error(`No IG channel for page ${pageId}`); continue; }

        msg.tenantId = channel.tenantId as string;
        igAdapter.setCredentials({ pageId, accessToken: channel.accessToken as string });
        await processNormalizedMessage(msg, igAdapter);
      }
      continue;
    }

    // Facebook Messenger
    if (body.object === 'page') {
      const fbAdapter = new FacebookAdapter({ pageId: '', accessToken: '' });
      const messages = fbAdapter.parseWebhook(body);

      for (const msg of messages) {
        const pageId = msg.channelMetadata.pageId;
        const channels = await queryByGSI('byChannelExternalId', 'channelExternalId', `fb_${pageId}`);
        const channel = channels[0];
        if (!channel) { console.error(`No FB channel for page ${pageId}`); continue; }

        msg.tenantId = channel.tenantId as string;
        fbAdapter.setCredentials({ pageId, accessToken: channel.accessToken as string });
        await processNormalizedMessage(msg, fbAdapter);
      }
      continue;
    }
  }
};

// ============================================================
// PIPELINE UNIFICADO: procesa NormalizedMessage con cualquier adapter
// ============================================================
async function processNormalizedMessage(msg: NormalizedMessage, adapter: ChannelAdapter) {
  const { tenantId, channel, externalUserId, externalMessageId, senderName } = msg;
  const textBody = msg.content.text || '';
  const channelId = msg.channelMetadata.phoneNumberId || msg.channelMetadata.sessionName || msg.channelMetadata.instanceName || msg.channelMetadata.pageId || '';

  console.log(`[${channel}] Inbound from ${externalUserId}: ${textBody.slice(0, 80)}`);

  // Helpers
  const sendReply = (text: string) => adapter.sendText({ tenantId, externalUserId, text });
  const sendImage = (imageUrl: string, caption?: string) => adapter.sendImage({ tenantId, externalUserId, imageUrl, caption });

  // 1. Audio transcription (solo WhatsApp Meta por ahora)
  let processedText = textBody;
  if (msg.content.audio?.mediaId && channel === 'whatsapp') {
    try {
      const accessToken = (msg.channelMetadata as any).accessToken || (adapter as any).credentials?.accessToken;
      const transcription = await transcribeWhatsAppAudio(msg.content.audio.mediaId, accessToken, msg.content.audio.mimeType);
      if (!transcription) { console.log('Audio transcription empty, skipping'); return; }
      processedText = transcription;
      console.log(`[AUDIO] Transcribed: "${transcription.slice(0, 100)}"`);
    } catch (err: any) {
      console.error('[AUDIO] Transcription failed:', err.message);
      await sendReply('No pude escuchar el audio, me lo mandas de nuevo o en texto?');
      return;
    }
  }

  // 2. Image download + downscale (WhatsApp Meta)
  let imageBase64: string | undefined;
  if (msg.content.image?.mediaId && channel === 'whatsapp') {
    try {
      const accessToken = (adapter as any).credentials?.accessToken;
      const rawBuffer = await downloadWhatsAppMedia(msg.content.image.mediaId, accessToken);
      const imageBuffer = await sharp(rawBuffer)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      imageBase64 = imageBuffer.toString('base64');
      if (!processedText) processedText = '[El cliente envio una imagen]';
      console.log(`[IMAGE] Downscaled ${rawBuffer.length} → ${imageBuffer.length} bytes`);
    } catch (err: any) {
      console.error('[IMAGE] Download/downscale failed:', err.message);
    }
  }

  if (!processedText) return;

  // 2b. Remarketing opt-out detection
  const OPT_OUT_KEYWORDS = ['BAJA', 'STOP', 'NO', 'BASTA', 'CANCELAR', 'DESUSCRIBIR'];
  const normalizedForOptOut = processedText.toUpperCase().trim();
  if (OPT_OUT_KEYWORDS.includes(normalizedForOptOut)) {
    try {
      await putItem({
        PK: `TENANT#${tenantId}`, SK: `SUPPRESSION#${externalUserId}`,
        tenantId, contactPhone: externalUserId,
        reason: 'opt_out',
        reasonDetail: processedText.slice(0, 200),
        suppressedAt: new Date().toISOString(),
      });
      console.log(`[REMARKETING] Opt-out detected for ${externalUserId}: "${processedText.slice(0, 50)}"`);
    } catch (err) {
      console.error('[REMARKETING] Opt-out save error (non-blocking):', err);
    }
    // No retornar: el pipeline normal sigue y el bot responde naturalmente
  }

  // 3. Deduplicación
  const existingMsgs = await queryItems(`WAMSG#${externalMessageId}`);
  if (existingMsgs.length > 0) { console.log(`[${channel}] Dup ${externalMessageId}`); return; }

  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 4. Contacto
  const contactKey = keys.contact(tenantId, externalUserId);
  const existingContact = await getItem(contactKey);
  await putItem({
    ...contactKey,
    phone: externalUserId, contactPhone: externalUserId,
    name: senderName || existingContact?.name || externalUserId,
    tags: existingContact?.tags || [],
    totalConversations: (existingContact?.totalConversations as number || 0) + (existingContact ? 0 : 1),
    lastConversationAt: now, createdAt: existingContact?.createdAt || now, tenantId,
  });

  // 5. Conversación
  const contactConvs = await queryByGSI('byContactPhone', 'contactPhone', externalUserId);
  const conversation = contactConvs.find(
    (c: any) => c.PK === `TENANT#${tenantId}` && c.SK?.startsWith('CONV#') && c.status !== 'archived'
  );
  const conversationId = conversation?.conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 6. Guardar mensaje entrante
  await putItem({
    ...keys.message(conversationId, now, msgId),
    messageId: msgId, conversationId, tenantId,
    direction: 'inbound', sender: 'contact',
    type: imageBase64 ? 'image' : 'text',
    content: processedText,
    ...(imageBase64 ? { imageBase64: imageBase64.slice(0, 200000), imageMimeType: 'image/jpeg' } : {}),
    waMessageId: externalMessageId, channel, timestamp: now,
  });
  await putItem({ PK: `WAMSG#${externalMessageId}`, SK: 'MAP', conversationId, messageId: msgId, timestamp: now });

  // 6b. Remarketing reply attribution
  try {
    const recentRemarketingMsgs = await queryItems(
      `TENANT#${tenantId}#CONTACT#${externalUserId}`,
      'REMARKETING_MSG#',
      { limit: 1 },
    );
    if (recentRemarketingMsgs.length > 0) {
      const lastRemarketing = recentRemarketingMsgs[0] as any;
      const sentAt = new Date(lastRemarketing.sentAt || '').getTime();
      const SEVENTY_TWO_H = 72 * 60 * 60 * 1000;
      if (!isNaN(sentAt) && Date.now() - sentAt < SEVENTY_TWO_H && lastRemarketing.campaignId) {
        const campaignId = lastRemarketing.campaignId as string;
        const sends = await queryItems(`CAMPAIGN_SEND#${campaignId}`, undefined, { limit: 200 });
        const sendItem = sends.find(
          (s: any) => (s.SK as string).endsWith(externalUserId) && s.status === 'sent',
        );
        if (sendItem) {
          await putItem({ ...sendItem, status: 'replied', repliedAt: now });
          // Actualizar replyCount en la campana
          const campaign = await getItem({ PK: `TENANT#${tenantId}`, SK: `CAMPAIGN#${campaignId}` });
          if (campaign) {
            const variants = (campaign.variants as any[]) || [];
            const variantId = (sendItem as any).variantId;
            const updated = variants.map((v: any) =>
              v.id === variantId ? { ...v, replyCount: (v.replyCount || 0) + 1 } : v,
            );
            await putItem({
              ...campaign,
              variants: updated,
              stats: { ...(campaign.stats as any || {}), totalReplied: ((campaign.stats as any)?.totalReplied || 0) + 1 },
            });
          }
          console.log(`[REMARKETING] Reply attributed to campaign ${campaignId} from ${externalUserId}`);
        }
      }
    }
  } catch (err) {
    console.error('[REMARKETING] Attribution error (non-blocking):', err);
  }

  // 7. Actualizar conversación
  const unreadCount = (conversation?.unreadCount as number || 0) + 1;
  await putItem({
    ...keys.conversation(tenantId, conversationId),
    conversationId, tenantId, channelPhoneNumberId: channelId,
    contactPhone: externalUserId,
    contactName: senderName || conversation?.contactName || externalUserId,
    status: 'open', tags: conversation?.tags || [],
    assignedTo: conversation?.assignedTo || 'bot',
    unreadCount, lastMessageAt: now,
    lastMessagePreview: processedText.slice(0, 100),
    createdAt: conversation?.createdAt || now,
    channel,
  });

  // 8. Read receipt
  adapter.markAsRead({ tenantId, externalMessageId }).catch(() => {});

  // 9. Guards
  const rateCheck = await checkRateLimit(externalUserId);
  if (!rateCheck.allowed) { await sendReply(rateCheck.message!); return; }
  const injectionCheck = await detectInjectionWithLLM(processedText, anthropic);
  if (injectionCheck.isInjection) { await sendReply(INJECTION_RESPONSE); return; }
  if (isCircuitOpen()) { await sendReply(getFallbackMessage()); return; }

  // 10. Si asignado a humano, no responder
  if ((conversation?.assignedTo || 'bot') !== 'bot') return;

  // 11. Debounce 3s
  const msgTimestamp = Date.now();
  await putItem({ PK: `DEBOUNCE#${conversationId}`, SK: 'LATEST', timestamp: msgTimestamp, ttl: Math.floor(Date.now() / 1000) + 60 });
  await new Promise(r => setTimeout(r, 3000));
  const debounceItem = await getItem({ PK: `DEBOUNCE#${conversationId}`, SK: 'LATEST' });
  if (debounceItem && (debounceItem.timestamp as number) !== msgTimestamp) return;

  // 12. Juntar mensajes pendientes
  const recentMsgs = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 20 });
  recentMsgs.reverse();
  let lastBotIdx = -1;
  for (let i = recentMsgs.length - 1; i >= 0; i--) {
    if ((recentMsgs[i] as any).sender === 'bot') { lastBotIdx = i; break; }
  }
  const pendingInbound = recentMsgs.slice(lastBotIdx + 1).filter((m: any) => m.direction === 'inbound').map((m: any) => m.content as string);
  const combinedMessage = pendingInbound.length > 0 ? pendingInbound.join('. ') : processedText;

  const freshConv = await getItem(keys.conversation(tenantId, conversationId));
  if (freshConv?.assignedTo && freshConv.assignedTo !== 'bot') return;

  // 13. Comando /reset
  if (combinedMessage.trim().toLowerCase() === '/reset') {
    const allMsgs = await queryAllItems(`CONV#${conversationId}`, 'MSG#');
    if (allMsgs.length > 0) {
      await batchDeleteItems(allMsgs.map(m => ({ PK: m.PK, SK: m.SK })));
    }
    await deleteItem(keys.contactMemory(tenantId, externalUserId));
    const resetMsg = 'Conversación reiniciada';
    await sendReply(resetMsg);
    const resetNow = new Date().toISOString();
    const resetId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await putItem({ ...keys.message(conversationId, resetNow, resetId), messageId: resetId, conversationId, tenantId, direction: 'outbound', sender: 'bot', type: 'text', content: resetMsg, status: 'sent', timestamp: resetNow });
    await putItem({ ...keys.conversation(tenantId, conversationId), conversationId, tenantId, channelPhoneNumberId: channelId, contactPhone: externalUserId, contactName: senderName || conversation?.contactName || externalUserId, status: 'open', tags: [], assignedTo: 'bot', unreadCount: 0, lastMessageAt: resetNow, lastMessagePreview: resetMsg, createdAt: conversation?.createdAt || now, convState: { recentProducts: [] }, channel });
    return;
  }

  // 14. Config del agente
  const agent = await getItem(keys.agent(tenantId, 'main'));
  if (!agent?.active) return;

  // 15. Escalamiento rápido
  const escalationCheck = shouldEscalate(combinedMessage, { needsHuman: false, reboundCount: 0 });
  if (escalationCheck.escalate) {
    const escMsg = 'Te paso con alguien del equipo. Te van a contactar a la brevedad por este mismo chat.';
    await sendReply(escMsg);
    const escNow = new Date().toISOString();
    const escId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await putItem({ ...keys.message(conversationId, escNow, escId), messageId: escId, conversationId, tenantId, direction: 'outbound', sender: 'bot', type: 'text', content: escMsg, status: 'sent', timestamp: escNow });
    await putItem({ ...freshConv, assignedTo: 'user', lastMessageAt: escNow, lastMessagePreview: escMsg.slice(0, 100) });
    return;
  }

  // 16. Historial optimizado + pipeline IA
  const historyItems = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 20 });
  historyItems.reverse();
  const { history, summary: historySummary } = await buildOptimizedHistory(conversationId, historyItems);

  try {
    const agentCfg = agent.agentConfig || agent;
    const catalog = await getCachedCatalog(tenantId);

    const contactMemory = await loadContactMemory(tenantId, externalUserId);
    if (contactMemory) agentCfg._contactMemory = contactMemory;

    let recentProducts: EnrichedProduct[] = (freshConv?.convState?.recentProducts || []) as EnrichedProduct[];
    const trivial = isTrivialMessage(combinedMessage);
    const hasRecent = recentProducts.length > 0;
    const recentNames = recentProducts.map((p: any) => p.name);
    const followUp = isFollowUpMessage(combinedMessage, hasRecent, recentNames);

    if (trivial) {
      const isSaludo = /^(hola|holaa+|hi|hey|buenas|buen[oa]s?\s*d[ií]as?|buenas\s*tardes|buenas\s*noches|que\s*tal)\s*[!.?]*$/i.test(combinedMessage.trim());
      if (isSaludo) recentProducts = [];
    }

    const newProducts = (trivial || followUp) ? [] : searchCatalog(combinedMessage, catalog);
    const contextOnly = dedupProducts(recentProducts).slice(0, 6);
    const freshOnly = dedupProducts(newProducts).slice(0, 4);
    const complexity: MessageComplexity = imageBase64 ? 'image' : trivial ? 'trivial' : followUp ? 'followup' : 'new_query';

    // Tools extra por tenant (calculadora, etc)
    const extraTools: Anthropic.Tool[] = [];
    const hasCalc = agentCfg.enableCalculadora || catalog.some((p: any) =>
      /ladrillo|bloque|block/i.test(p.name || '') || /ladrillo|bloque|block/i.test(p.category || '')
    );
    if (hasCalc) extraTools.push(CALCULADORA_TOOL);

    const { text: aiResponse, productsShown, freshProducts } = await generateResponse(
      combinedMessage, history, contextOnly, freshOnly, catalog, agentCfg,
      imageBase64 ? { base64: imageBase64, mimeType: 'image/jpeg' } : undefined,
      complexity, historySummary, extraTools,
    );
    recordSuccess();

    // Formatear respuesta según canal
    const cleanResponse = formatOutbound(aiResponse, channel);

    // Enviar respuesta
    const sendResult = await sendReply(cleanResponse);
    console.log(`[${channel}] Sent: ${sendResult.externalMessageId}`);

    // Enviar imágenes de productos frescos
    const normName = (s: string) => s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    const seenNames = new Set<string>();
    for (const p of recentProducts) seenNames.add(normName(p.name));
    const allCandidatePool = [...recentProducts, ...freshProducts];

    const imagesToSend: typeof freshProducts = [];
    for (const p of freshProducts) {
      const nn = normName(p.name);
      if (seenNames.has(nn)) continue;
      if (!p.imageUrl || !p.imageUrl.startsWith('http') || p.imageUrl.includes('empty-placeholder')) continue;
      if (!shouldSendPhoto(p, cleanResponse, allCandidatePool)) continue;
      seenNames.add(nn);
      imagesToSend.push(p);
      if (imagesToSend.length >= 3) break;
    }

    for (const p of imagesToSend) {
      const captionBold = adapter.supportsMarkdown() ? `*${p.name}*` : p.name;
      const caption = `${captionBold}\n${p.brand ? `${p.brand} | ` : ''}$${(p.priceNum || 0).toLocaleString('es-AR')}`;
      await sendImage(p.imageUrl, caption);
      const imgNow = new Date().toISOString();
      const imgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await putItem({
        ...keys.message(conversationId, imgNow, imgId),
        messageId: imgId, conversationId, tenantId,
        direction: 'outbound', sender: 'bot', type: 'image',
        content: caption, imageUrl: p.imageUrl, status: 'sent', timestamp: imgNow,
      });
    }

    // Guardar mensaje y estado
    const productsToSave = dedupProducts(productsShown).slice(0, 8);
    const replyNow = new Date().toISOString();
    const replyId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await putItem({
      ...keys.message(conversationId, replyNow, replyId),
      messageId: replyId, conversationId, tenantId,
      direction: 'outbound', sender: 'bot', type: 'text',
      content: cleanResponse, waMessageId: sendResult.externalMessageId,
      status: 'sent', timestamp: replyNow,
    });
    if (sendResult.externalMessageId) {
      await putItem({ PK: `WAMSG#${sendResult.externalMessageId}`, SK: 'MAP', conversationId, messageId: replyId, timestamp: replyNow });
    }

    await putItem({
      ...keys.conversation(tenantId, conversationId),
      conversationId, tenantId, channelPhoneNumberId: channelId,
      contactPhone: externalUserId,
      contactName: senderName || conversation?.contactName || externalUserId,
      status: 'open', tags: conversation?.tags || [],
      assignedTo: 'bot', unreadCount: 0,
      lastMessageAt: replyNow, lastMessagePreview: cleanResponse.slice(0, 100),
      createdAt: conversation?.createdAt || now,
      convState: { recentProducts: productsToSave },
      channel,
    });

    const totalLatency = Date.now() - msgTimestamp;
    console.log(`[${channel}] Done (${totalLatency}ms, ${productsToSave.length} products)`);

    // Log métricas del turno (async, non-blocking)
    logTurnMetrics({
      tenantId, conversationId, messageId: replyId, channel,
      modelUsed: chooseModel(complexity),
      complexity,
      latencyMs: totalLatency,
      inputTokens: 0, outputTokens: 0, // se loguearon por separado en [CACHE]
      cacheReadTokens: 0, cacheCreateTokens: 0,
      toolCallCount: 0,
      productsShown: productsToSave.length,
      imagessSent: imagesToSend.length,
      escalated: false,
    }).catch(() => {});

    // Actualizar memoria (async)
    const historyForMemory = historyItems.map((item: any) => ({
      role: item.direction === 'inbound' ? 'user' : 'assistant',
      content: item.content as string,
    }));
    updateContactMemory(tenantId, externalUserId, historyForMemory, anthropic).catch(() => {});

  } catch (err) {
    console.error(`[${channel}] Pipeline error:`, err);
    recordFailure();
    await sendReply(getFallbackMessage());
  }
}

// ============================================================
// STATUS UPDATES
// ============================================================
async function processStatusUpdate(status: { waMessageId: string; status: string; recipientId: string; timestamp: string }) {
  const mapping = await getItem({ PK: `WAMSG#${status.waMessageId}`, SK: 'MAP' });
  if (!mapping) return;

  const statusOrder: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 0 };
  const msgItems = await queryItems(
    `CONV#${mapping.conversationId}`,
    `MSG#${mapping.timestamp}#${mapping.messageId}`,
    { limit: 1 }
  );
  if (msgItems.length === 0) return;

  const msgItem = msgItems[0] as any;
  const currentOrder = statusOrder[msgItem.status as keyof typeof statusOrder] ?? 0;
  const newOrder = statusOrder[status.status] ?? 0;

  if (newOrder > currentOrder || status.status === 'failed') {
    await putItem({ ...msgItem, status: status.status });
  }
}

// ============================================================
// TEST MESSAGES (mismo pipeline simplificado)
// ============================================================
async function processTestMessage(body: {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
  contactName?: string;
  message: string;
}) {
  const { tenantId, conversationId, contactPhone, contactName, message } = body;
  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Contacto
  const contactKey = keys.contact(tenantId, contactPhone);
  const existingContact = await getItem(contactKey);
  await putItem({
    ...contactKey,
    phone: contactPhone, contactPhone,
    name: contactName || existingContact?.name || contactPhone,
    tags: existingContact?.tags || [],
    totalConversations: (existingContact?.totalConversations as number || 0) + (existingContact ? 0 : 1),
    lastConversationAt: now, createdAt: existingContact?.createdAt || now, tenantId,
  });

  // Guardar mensaje
  await putItem({
    ...keys.message(conversationId, now, msgId),
    messageId: msgId, conversationId, tenantId,
    direction: 'inbound', sender: 'contact', type: 'text',
    content: message, timestamp: now,
  });

  const existingConv = await getItem(keys.conversation(tenantId, conversationId));
  await putItem({
    ...keys.conversation(tenantId, conversationId),
    conversationId, tenantId, contactPhone,
    contactName: contactName || contactPhone,
    status: 'open', tags: existingConv?.tags || [],
    assignedTo: 'bot', unreadCount: 1,
    lastMessageAt: now, lastMessagePreview: message,
    createdAt: existingConv?.createdAt || now,
  });

  const agent = await getItem(keys.agent(tenantId, 'main'));
  if (!agent?.active) return;

  // Historial optimizado
  const historyItems = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 20 });
  historyItems.reverse();
  const { history, summary: historySummary } = await buildOptimizedHistory(conversationId, historyItems);

  try {
    const agentCfg = agent.agentConfig || agent;
    const catalog = await getCachedCatalog(tenantId);

    // Cargar productos recientes del estado
    let recentProducts: EnrichedProduct[] = (existingConv?.convState?.recentProducts || []) as EnrichedProduct[];
    const trivial = isTrivialMessage(message);
    const followUp = isFollowUpMessage(message, recentProducts.length > 0, recentProducts.map((p: any) => p.name));
    if (trivial) {
      const isSaludo = /^(hola|holaa+|hi|hey|buenas)/i.test(message.trim());
      if (isSaludo) recentProducts = [];
    }
    const newProducts = (trivial || followUp) ? [] : searchCatalog(message, catalog);
    const contextOnly = dedupProducts(recentProducts).slice(0, 6);
    const freshOnly = dedupProducts(newProducts).slice(0, 4);

    const complexity: MessageComplexity = trivial ? 'trivial' : followUp ? 'followup' : 'new_query';
    const { text: aiResponse, productsShown } = await generateResponse(
      message, history, contextOnly, freshOnly, catalog, agentCfg, undefined, complexity, historySummary,
    );

    const cleanResponse = formatOutbound(aiResponse, 'whatsapp');
    const productsToSave = dedupProducts(productsShown).slice(0, 8);
    const replyNow = new Date().toISOString();
    const replyId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await putItem({
      ...keys.message(conversationId, replyNow, replyId),
      messageId: replyId, conversationId, tenantId,
      direction: 'outbound', sender: 'bot', type: 'text',
      content: cleanResponse, timestamp: replyNow, status: 'sent',
    });

    await putItem({
      ...keys.conversation(tenantId, conversationId),
      conversationId, tenantId, contactPhone,
      contactName: contactName || contactPhone,
      status: 'open', tags: existingConv?.tags || [],
      assignedTo: 'bot', unreadCount: 0,
      lastMessageAt: replyNow, lastMessagePreview: cleanResponse.slice(0, 100),
      createdAt: existingConv?.createdAt || now,
      convState: { recentProducts: productsToSave },
    });
  } catch (err) {
    console.error('Pipeline error:', err);
  }
}
