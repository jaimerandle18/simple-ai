import { SQSEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import Anthropic from '@anthropic-ai/sdk';
import Fuse from 'fuse.js';
import { getItem, putItem, queryItems, queryByGSI, keys } from './lib/dynamo-helpers';
import { parseWhatsAppWebhook, ParsedInboundMessage, ParsedStatusUpdate } from './lib/webhook-parser';
import { sendWhatsAppMessage, sendWhatsAppImage, markAsRead } from './lib/whatsapp-client';
import { loadCatalog } from './lib/catalog-loader';
import { cleanMarkdownForWhatsApp } from './lib/markdown-cleaner';
import type { EnrichedProduct } from './lib/types';
import {
  shouldEscalate, isCircuitOpen, recordSuccess, recordFailure,
  getFallbackMessage, checkRateLimit, detectInjection,
  INJECTION_RESPONSE,
} from './lib/production-guards';
import { transcribeWhatsAppAudio, downloadWhatsAppMedia } from './lib/audio-transcriber';

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
// FORMATEAR PRODUCTOS PARA EL PROMPT (YAML estructurado)
// ============================================================
function formatProductsForPrompt(products: EnrichedProduct[]): string {
  if (products.length === 0) return '(ninguno cargado en este contexto, usá buscar_productos si necesitás)';

  let block = '';
  for (const [i, p] of products.entries()) {
    block += `- id: ${i + 1}
  nombre: "${p.name}"
  marca: "${p.brand || 'N/A'}"
  categoria: "${p.category || 'N/A'}"
  precio: ${p.priceNum || 'null'}
  precio_display: "$${p.priceNum?.toLocaleString('es-AR') || p.price}"
  specs:`;

    if (p.attributes && Object.keys(p.attributes).length > 0) {
      for (const [k, v] of Object.entries(p.attributes)) {
        if (v !== null && v !== undefined) {
          block += `\n    ${k}: ${typeof v === 'string' ? `"${v}"` : v}`;
        }
      }
    } else {
      block += ' {}';
    }

    // Talles disponibles y agotados
    const sizes = (p as any).sizes;
    const outOfStock = (p as any).outOfStockSizes;
    if (sizes && sizes.length > 0) {
      block += `\n  talles_disponibles: [${sizes.join(', ')}]`;
    }
    if (outOfStock && outOfStock.length > 0) {
      block += `\n  talles_agotados: [${outOfStock.join(', ')}]`;
    }

    if (p.description) {
      block += `\n  descripcion: "${p.description.slice(0, 120).replace(/"/g, "'")}"`;
    }
    block += '\n\n';
  }
  return block;
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
async function generateResponse(
  userMessage: string,
  history: Anthropic.MessageParam[],
  contextProducts: EnrichedProduct[],
  freshSearchProducts: EnrichedProduct[],
  catalog: EnrichedProduct[],
  agentConfig: any,
  imageData?: { base64: string; mimeType: string },
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
    ? `\n# PRODUCTOS_DISPONIBLES\n${formatProductsForPrompt(allContextProducts)}\nCada producto tiene specs estructuradas. Usalos para responder preguntas de comparación, recomendación o seguimiento.`
    : '\n# PRODUCTOS_DISPONIBLES\n(ninguno en contexto, usá buscar_productos para encontrar)';

  const systemPrompt = `Sos ${name}, vendedor virtual por WhatsApp de un comercio argentino.${web ? ` Web: ${web}` : ''}

# TONO
Argentino casual, vos, conciso. Máx 1 emoji. WhatsApp real, corto. Máximo 4-5 líneas.
NUNCA uses signos de apertura (¡ ¿). Solo usá los de cierre (! ?).

# REGLAS

1. SOLO mencionás productos de PRODUCTOS_DISPONIBLES. NUNCA inventes productos ni precios.

2. NUNCA mandes al cliente a la web. NUNCA digas "no tengo eso cargado" si PRODUCTOS_DISPONIBLES tiene productos.

3. NUNCA cierres con "¿algo más?". Hacé una pregunta específica o confirmación.

4. Precio formateado: $XX.XXX (ej: $67.186)

5. Las fotos se envían AUTOMÁTICAMENTE. NO listes productos uno por uno con sus datos.
   Hacé una intro corta + dato clave + pregunta. Las fotos refuerzan visualmente.

6. USO DE buscar_productos:
   - Solo si el cliente pide categoría o producto NUEVO no presente en PRODUCTOS_DISPONIBLES.
   - Solo si cambia de tema (ej: estaban viendo amoladoras y pide "aspiradoras").
   - NO la uses si los productos relevantes YA están en PRODUCTOS_DISPONIBLES.
   - Query con palabras clave (ej: "amoladoras"), NO frases ("la más potente").

7. PREGUNTAS COMPARATIVAS:
   Si te preguntan "la más X / cuál es más Y", compará los productos en PRODUCTOS_DISPONIBLES
   por sus specs. Devolvé un ganador con justificación numérica.
   Si falta el spec exacto en algunos, usá los nombres y descripciones para inferir.
   NUNCA digas "no tengo eso" si HAY productos en el contexto.

8. CAMBIO DE CATEGORÍA:
   Si el cliente menciona una categoría distinta a los productos actuales, usá buscar_productos.

9. ENVÍOS, PAGOS, HORARIOS, UBICACIÓN:
   Respondé con lo que sepas de las reglas del negocio. Si no tenés el dato exacto,
   decí que vas a pasar la consulta y derivá.

10. INTENCIÓN DE COMPRA:
    Si el cliente quiere comprar, pedile los datos necesarios.

11. ESCALAMIENTO:
    Si insulta o pide humano: "Te paso con alguien del equipo."

12. FOTOS: Si nombrás un producto, mencionalo COMPLETO con nombre + precio o specs.
    No hables genérico ("tenemos varias opciones") si vas a mostrar fotos.
    Las fotos se envían automáticamente de los productos que nombrás con datos concretos.

13. NUNCA preguntes "¿te mando foto?" o "¿querés ver foto?". O nombrás el producto
    con datos (y la foto va sola) o no lo nombrás todavía.

14. IMAGENES DEL CLIENTE:
    Si el cliente manda una foto, analizala. Puede ser una prenda que vio y quiere algo parecido,
    una captura de la web, o una consulta visual. Describí lo que ves y buscá productos similares
    en el catalogo usando buscar_productos.

15. PRODUCTOS YA MOSTRADOS:
    Si hablás de un producto que YA mostraste antes en la conversación,
    NO lo re-introduzcas. Referencialo natural: "la que te mostré", "esa misma",
    "la Swell que vimos". El cliente ya la tiene en pantalla.

# CATEGORÍAS DEL CATÁLOGO
${categories}
${agentConfig.promotions ? `\n# PROMOCIONES\n${agentConfig.promotions}` : ''}
${agentConfig.extraInstructions ? `\n# REGLAS DEL NEGOCIO\n${agentConfig.extraInstructions}` : ''}
${agentConfig.businessHours ? `\n# HORARIO\n${agentConfig.businessHours}` : ''}
${agentConfig.welcomeMessage ? `\n# MENSAJE DE BIENVENIDA (usar en primer saludo)\n${agentConfig.welcomeMessage}` : ''}
${productsBlock}`;

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

  // Loop de tool use (máx 3 rounds)
  for (let round = 0; round < 3; round++) {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

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
              ? `Productos encontrados:\n${formatProductsForPrompt(found)}`
              : `No encontré productos para "${input.query}". Categorías disponibles: ${categories}`,
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

  return { text: 'Disculpá, tuve un problema procesando tu consulta. ¿Podés repetirme?', productsShown: allProductsShown, freshProducts };
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
// HANDLER
// ============================================================
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);

    if (body.type === 'test_message') {
      await processTestMessage(body);
      continue;
    }

    if (body.object === 'whatsapp_business_account') {
      const parsed = parseWhatsAppWebhook(body);
      if (parsed.kind === 'messages') {
        for (const msg of parsed.messages) {
          await processInboundMessage(msg);
        }
      } else if (parsed.kind === 'statuses') {
        for (const status of parsed.statuses) {
          await processStatusUpdate(status);
        }
      }
    }
  }
};

// ============================================================
// FLUJO PRINCIPAL: mensaje entrante de WhatsApp
// ============================================================
async function processInboundMessage(msg: ParsedInboundMessage) {
  console.log(`Inbound from ${msg.senderPhone} (${msg.type}): ${msg.textBody || msg.mediaId || ''}`);

  // Solo procesamos texto, audio e imagen
  if (msg.type !== 'text' && msg.type !== 'audio' && msg.type !== 'image') {
    console.log(`Skipping ${msg.type} message`);
    return;
  }

  // 1. Buscar canal (necesitamos accessToken antes de transcribir)
  const channels = await queryByGSI('byChannelExternalId', 'channelExternalId', msg.phoneNumberId);
  const channel = channels[0];
  if (!channel) { console.error(`No channel for ${msg.phoneNumberId}`); return; }

  const tenantId = channel.tenantId as string;
  const accessToken = channel.accessToken as string;
  const phoneNumberId = msg.phoneNumberId;

  // 1b. Si es audio, transcribir con Groq
  if (msg.type === 'audio' && msg.mediaId) {
    try {
      const transcription = await transcribeWhatsAppAudio(msg.mediaId, accessToken, msg.mimeType);
      if (!transcription) {
        console.log('Audio transcription empty, skipping');
        return;
      }
      msg.textBody = transcription;
      msg.type = 'text'; // a partir de acá se trata como texto
      console.log(`[AUDIO] Transcribed to text: "${transcription.slice(0, 100)}"`);
    } catch (err: any) {
      console.error('[AUDIO] Transcription failed:', err.message);
      await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, 'No pude escuchar el audio, me lo mandas de nuevo o en texto?');
      return;
    }
  }

  // 1c. Si es imagen, descargar para mandarla a Claude
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;
  if (msg.type === 'image' && msg.mediaId) {
    try {
      const imageBuffer = await downloadWhatsAppMedia(msg.mediaId, accessToken);
      imageBase64 = imageBuffer.toString('base64');
      imageMimeType = (msg.mimeType || 'image/jpeg').split(';')[0].trim();
      // Si no mandó texto con la imagen, poner un placeholder
      if (!msg.textBody) msg.textBody = '[El cliente envio una imagen]';
      console.log(`[IMAGE] Downloaded ${imageBuffer.length} bytes (${imageMimeType})`);
    } catch (err: any) {
      console.error('[IMAGE] Download failed:', err.message);
      // Continuar sin imagen si falla
    }
  }

  if (!msg.textBody) return;

  // 2. Deduplicación
  const existingMsgs = await queryItems(`WAMSG#${msg.waMessageId}`);
  if (existingMsgs.length > 0) { console.log(`Dup ${msg.waMessageId}`); return; }

  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 3. Contacto
  const contactKey = keys.contact(tenantId, msg.senderPhone);
  const existingContact = await getItem(contactKey);
  await putItem({
    ...contactKey,
    phone: msg.senderPhone,
    contactPhone: msg.senderPhone,
    name: msg.senderName || existingContact?.name || msg.senderPhone,
    tags: existingContact?.tags || [],
    totalConversations: (existingContact?.totalConversations as number || 0) + (existingContact ? 0 : 1),
    lastConversationAt: now,
    createdAt: existingContact?.createdAt || now,
    tenantId,
  });

  // 4. Conversación
  let conversation: any = null;
  const contactConvs = await queryByGSI('byContactPhone', 'contactPhone', msg.senderPhone);
  conversation = contactConvs.find(
    (c: any) => c.PK === `TENANT#${tenantId}` && c.SK?.startsWith('CONV#') && c.status !== 'archived'
  );

  const conversationId = conversation?.conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 5. Guardar mensaje entrante
  await putItem({
    ...keys.message(conversationId, now, msgId),
    messageId: msgId, conversationId, tenantId,
    direction: 'inbound', sender: 'contact',
    type: imageBase64 ? 'image' : 'text',
    content: msg.textBody,
    ...(imageBase64 ? { imageBase64: imageBase64.slice(0, 200000), imageMimeType } : {}),
    waMessageId: msg.waMessageId, timestamp: now,
  });

  await putItem({
    PK: `WAMSG#${msg.waMessageId}`, SK: 'MAP',
    conversationId, messageId: msgId, timestamp: now,
  });

  // 6. Actualizar conversación
  const unreadCount = (conversation?.unreadCount as number || 0) + 1;
  await putItem({
    ...keys.conversation(tenantId, conversationId),
    conversationId, tenantId, channelPhoneNumberId: phoneNumberId,
    contactPhone: msg.senderPhone,
    contactName: msg.senderName || conversation?.contactName || msg.senderPhone,
    status: 'open', tags: conversation?.tags || [],
    assignedTo: conversation?.assignedTo || 'bot',
    unreadCount, lastMessageAt: now,
    lastMessagePreview: msg.textBody.slice(0, 100),
    createdAt: conversation?.createdAt || now,
  });

  // 7. Read receipt
  markAsRead(phoneNumberId, accessToken, msg.waMessageId);

  // 8. Guards
  const rateCheck = await checkRateLimit(msg.senderPhone);
  if (!rateCheck.allowed) {
    await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, rateCheck.message!);
    return;
  }
  if (detectInjection(msg.textBody)) {
    await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, INJECTION_RESPONSE);
    return;
  }
  if (isCircuitOpen()) {
    await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, getFallbackMessage());
    return;
  }

  // 9. Si asignado a humano, no responder
  const assignedTo = conversation?.assignedTo || 'bot';
  if (assignedTo !== 'bot') return;

  // 10. Debounce 3s
  const msgTimestamp = Date.now();
  await putItem({
    PK: `DEBOUNCE#${conversationId}`, SK: 'LATEST',
    timestamp: msgTimestamp, ttl: Math.floor(Date.now() / 1000) + 60,
  });
  await new Promise(r => setTimeout(r, 3000));
  const debounceItem = await getItem({ PK: `DEBOUNCE#${conversationId}`, SK: 'LATEST' });
  if (debounceItem && (debounceItem.timestamp as number) !== msgTimestamp) return;

  // 11. Juntar mensajes pendientes (post-debounce)
  const recentMsgs = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 20 });
  recentMsgs.reverse();
  let lastBotIdx = -1;
  for (let i = recentMsgs.length - 1; i >= 0; i--) {
    if ((recentMsgs[i] as any).sender === 'bot') { lastBotIdx = i; break; }
  }
  const pendingInbound = recentMsgs
    .slice(lastBotIdx + 1)
    .filter((m: any) => m.direction === 'inbound')
    .map((m: any) => m.content as string);
  const combinedMessage = pendingInbound.length > 0 ? pendingInbound.join('. ') : msg.textBody;

  const freshConv = await getItem(keys.conversation(tenantId, conversationId));
  if (freshConv?.assignedTo && freshConv.assignedTo !== 'bot') return;

  // 11b. Comando /reset — reiniciar conversación
  if (combinedMessage.trim().toLowerCase() === '/reset') {
    const resetMsg = 'Conversación reiniciada. ¡Hola! Contame qué buscás.';
    await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, resetMsg);
    const resetNow = new Date().toISOString();
    const resetId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await putItem({ ...keys.message(conversationId, resetNow, resetId), messageId: resetId, conversationId, tenantId, direction: 'outbound', sender: 'bot', type: 'text', content: resetMsg, status: 'sent', timestamp: resetNow });
    await putItem({
      ...keys.conversation(tenantId, conversationId),
      conversationId, tenantId, channelPhoneNumberId: phoneNumberId,
      contactPhone: msg.senderPhone, contactName: msg.senderName || conversation?.contactName || msg.senderPhone,
      status: 'open', tags: [], assignedTo: 'bot', unreadCount: 0,
      lastMessageAt: resetNow, lastMessagePreview: resetMsg,
      createdAt: conversation?.createdAt || now,
      convState: { recentProducts: [] },
    });
    console.log('Conversation reset via /reset');
    return;
  }

  // 12. Config del agente
  const agent = await getItem(keys.agent(tenantId, 'main'));
  if (!agent?.active) return;

  // 13. Escalamiento rápido
  const escalationCheck = shouldEscalate(combinedMessage, {
    needsHuman: false,
    reboundCount: 0,
  });
  if (escalationCheck.escalate) {
    const escMsg = 'Te paso con alguien del equipo. Te van a contactar a la brevedad por este mismo chat.';
    await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, escMsg);
    const escNow = new Date().toISOString();
    const escId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await putItem({ ...keys.message(conversationId, escNow, escId), messageId: escId, conversationId, tenantId, direction: 'outbound', sender: 'bot', type: 'text', content: escMsg, status: 'sent', timestamp: escNow });
    await putItem({ ...freshConv, assignedTo: 'user', lastMessageAt: escNow, lastMessagePreview: escMsg.slice(0, 100) });
    return;
  }

  // 14. Historial para Claude (últimos 20 mensajes)
  const historyItems = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 20 });
  historyItems.reverse();

  // Construir mensajes alternando roles
  const history: Anthropic.MessageParam[] = [];
  for (const item of historyItems) {
    const role = (item as any).direction === 'inbound' ? 'user' : 'assistant';
    const content = (item as any).content as string;
    if (history.length > 0 && history[history.length - 1].role === role) {
      // Mergear contenido si mismo rol consecutivo
      const last = history[history.length - 1];
      last.content = (last.content as string) + '\n' + content;
    } else {
      history.push({ role, content });
    }
  }

  // Asegurar que empiece con 'user'
  if (history.length > 0 && history[0].role === 'assistant') {
    history.shift();
  }

  // 15. PIPELINE SIMPLE: código busca → Claude responde
  try {
    const agentCfg = agent.agentConfig || agent;
    const catalog = await loadCatalog(tenantId);

    // Cargar productos recientes del estado de la conversación
    let recentProducts: EnrichedProduct[] = (freshConv?.convState?.recentProducts || []) as EnrichedProduct[];

    // Detectar tipo de mensaje
    const trivial = isTrivialMessage(combinedMessage);
    const hasRecent = recentProducts.length > 0;
    const recentNames = recentProducts.map((p: any) => p.name);
    const followUp = isFollowUpMessage(combinedMessage, hasRecent, recentNames);

    if (trivial) {
      const isSaludo = /^(hola|holaa+|hi|hey|buenas|buen[oa]s?\s*d[ií]as?|buenas\s*tardes|buenas\s*noches|que\s*tal)\s*[!.?]*$/i.test(combinedMessage.trim());
      if (isSaludo) recentProducts = [];
      console.log(`Trivial message, skipping search. Saludo=${isSaludo}`);
    }
    if (followUp) console.log(`Follow-up detected, skipping search. Recent: ${recentProducts.length}`);

    // Búsqueda inicial SOLO si no es trivial NI seguimiento
    const newProducts = (trivial || followUp) ? [] : searchCatalog(combinedMessage, catalog);
    if (!trivial && !followUp) console.log(`Initial search: ${newProducts.length} products for "${combinedMessage.slice(0, 80)}"`);
    console.log(`Recent products in context: ${recentProducts.length}`);

    // Separar: recientes como contexto, nuevos como frescos
    const contextOnly = dedupProducts(recentProducts).slice(0, 6);
    const freshOnly = dedupProducts(newProducts).slice(0, 4);

    // Claude genera respuesta (con tool use si necesita más productos)
    const { text: aiResponse, productsShown, freshProducts } = await generateResponse(
      combinedMessage, history, contextOnly, freshOnly, catalog, agentCfg,
      imageBase64 ? { base64: imageBase64, mimeType: imageMimeType || 'image/jpeg' } : undefined,
    );
    recordSuccess();

    const cleanResponse = cleanMarkdownForWhatsApp(aiResponse);

    // Enviar respuesta
    const waResult = await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, cleanResponse);
    console.log(`Sent: ${waResult.messageId}`);

    // Enviar imágenes SOLO de productos FRESCOS que Claude nombró, NO repetir ya mostrados
    const normName = (s: string) => s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    const recentNamesNorm = new Set(recentProducts.map(p => normName(p.name)));
    const allCandidatePool = [...recentProducts, ...freshProducts];
    console.log(`[PHOTO] recent=${recentProducts.length}, fresh=${freshProducts.length}`);
    const seenNames = new Set<string>();
    // Add recent names as already seen
    for (const p of recentProducts) seenNames.add(normName(p.name));

    const imagesToSend: typeof freshProducts = [];
    for (const p of freshProducts) {
      const nn = normName(p.name);
      if (seenNames.has(nn)) { console.log(`[PHOTO] Skip (seen): ${p.name}`); continue; }
      if (!p.imageUrl || !p.imageUrl.startsWith('http') || p.imageUrl.includes('empty-placeholder')) continue;
      const pass = shouldSendPhoto(p, cleanResponse, allCandidatePool);
      if (!pass) { console.log(`[PHOTO] Skip (filter): ${p.name}`); continue; }
      seenNames.add(nn); // prevent dups within this turn
      imagesToSend.push(p);
      if (imagesToSend.length >= 3) break;
    }
    console.log(`[PHOTO] Sending ${imagesToSend.length}: [${imagesToSend.map(p => p.name).join(' | ')}]`);
    for (const p of imagesToSend) {
      const caption = `*${p.name}*\n${p.brand ? `${p.brand} | ` : ''}$${(p.priceNum || 0).toLocaleString('es-AR')}`;
      await sendWhatsAppImage(phoneNumberId, accessToken, msg.senderPhone, p.imageUrl, caption);
      // Guardar imagen como mensaje en DynamoDB
      const imgNow = new Date().toISOString();
      const imgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await putItem({
        ...keys.message(conversationId, imgNow, imgId),
        messageId: imgId, conversationId, tenantId,
        direction: 'outbound', sender: 'bot', type: 'image',
        content: caption, imageUrl: p.imageUrl,
        status: 'sent', timestamp: imgNow,
      });
    }

    // Guardar productos mostrados para el próximo turno (máx 8)
    const productsToSave = dedupProducts(productsShown).slice(0, 8);

    // Guardar mensaje saliente
    const replyNow = new Date().toISOString();
    const replyId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await putItem({
      ...keys.message(conversationId, replyNow, replyId),
      messageId: replyId, conversationId, tenantId,
      direction: 'outbound', sender: 'bot', type: 'text',
      content: cleanResponse, waMessageId: waResult.messageId,
      status: 'sent', timestamp: replyNow,
    });
    if (waResult.messageId) {
      await putItem({ PK: `WAMSG#${waResult.messageId}`, SK: 'MAP', conversationId, messageId: replyId, timestamp: replyNow });
    }

    // Actualizar conversación CON productos recientes en convState
    await putItem({
      ...keys.conversation(tenantId, conversationId),
      conversationId, tenantId, channelPhoneNumberId: phoneNumberId,
      contactPhone: msg.senderPhone,
      contactName: msg.senderName || conversation?.contactName || msg.senderPhone,
      status: 'open', tags: conversation?.tags || [],
      assignedTo: 'bot', unreadCount: 0,
      lastMessageAt: replyNow, lastMessagePreview: cleanResponse.slice(0, 100),
      createdAt: conversation?.createdAt || now,
      convState: { recentProducts: productsToSave },
    });

    console.log(`Done (${Date.now() - msgTimestamp}ms, ${productsToSave.length} products saved to state)`);

  } catch (err) {
    console.error('Pipeline error:', err);
    recordFailure();
    await sendWhatsAppMessage(phoneNumberId, accessToken, msg.senderPhone, getFallbackMessage());
  }
}

// ============================================================
// STATUS UPDATES
// ============================================================
async function processStatusUpdate(status: ParsedStatusUpdate) {
  const mapping = await getItem({ PK: `WAMSG#${status.waMessageId}`, SK: 'MAP' });
  if (!mapping) return;

  const statusOrder = { sent: 1, delivered: 2, read: 3, failed: 0 };
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

  // Historial
  const historyItems = await queryItems(`CONV#${conversationId}`, 'MSG#', { limit: 20 });
  historyItems.reverse();
  const history: Anthropic.MessageParam[] = [];
  for (const item of historyItems) {
    const role = (item as any).direction === 'inbound' ? 'user' : 'assistant';
    const content = (item as any).content as string;
    if (history.length > 0 && history[history.length - 1].role === role) {
      const last = history[history.length - 1];
      last.content = (last.content as string) + '\n' + content;
    } else {
      history.push({ role, content });
    }
  }
  if (history.length > 0 && history[0].role === 'assistant') history.shift();

  try {
    const agentCfg = agent.agentConfig || agent;
    const catalog = await loadCatalog(tenantId);

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

    const { text: aiResponse, productsShown } = await generateResponse(
      message, history, contextOnly, freshOnly, catalog, agentCfg,
    );

    const cleanResponse = cleanMarkdownForWhatsApp(aiResponse);
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
