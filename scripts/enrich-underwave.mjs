// Enrich Underwave products: scrape each product page for sizes, description, additional info
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'simple-ai-dev';
const TENANT_ID = 'underwave-001';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'sa-east-1' }));

async function scrapeProductDetails(pageUrl) {
  if (!pageUrl) return null;

  try {
    const res = await fetch(pageUrl);
    if (!res.ok) return null;
    const html = await res.text();

    // 1. Talles — buscar solo los DISPONIBLES (no agotados)
    const sizes = [];
    const outOfStockSizes = [];

    // Patrón principal: spans ivpa_term (WooCommerce IVPA plugin)
    // ivpa_active = disponible, ivpa_outofstock = agotado
    const ivpaTerms = html.match(/<span[^>]*class="ivpa_term[^"]*"[^>]*data-term="[^"]*"[^>]*>[^<]*<\/span>/gi) || [];
    if (ivpaTerms.length > 0) {
      for (const span of ivpaTerms) {
        const termMatch = span.match(/data-term="([^"]*)"/);
        if (!termMatch) continue;
        const val = termMatch[1].trim().toUpperCase();
        if (!/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|\d{2})$/i.test(val)) continue;

        const isOutOfStock = /ivpa_outofstock|ivpa_disabled/i.test(span);
        const isDisabled = /disabled|aria-disabled="true"/i.test(span);

        if (isOutOfStock || isDisabled) {
          if (!outOfStockSizes.includes(val)) outOfStockSizes.push(val);
        } else {
          if (!sizes.includes(val)) sizes.push(val);
        }
      }
    }

    // Fallback: options en select (si no hay ivpa)
    if (sizes.length === 0 && outOfStockSizes.length === 0) {
      const sizeOptions = html.match(/<option[^>]*value="([^"]*)"[^>]*>[^<]*<\/option>/gi) || [];
      for (const opt of sizeOptions) {
        const val = opt.match(/value="([^"]*)"/)?.[1];
        if (!val || !/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|\d{2})$/i.test(val.trim())) continue;
        const upper = val.trim().toUpperCase();
        const isDisabled = /disabled/i.test(opt);
        if (isDisabled) {
          if (!outOfStockSizes.includes(upper)) outOfStockSizes.push(upper);
        } else {
          if (!sizes.includes(upper)) sizes.push(upper);
        }
      }
    }

    // Fallback 2: data-value buttons
    if (sizes.length === 0 && outOfStockSizes.length === 0) {
      const sizeButtons = html.match(/<[^>]*data-value="(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|\d{2})"[^>]*>/gi) || [];
      for (const btn of sizeButtons) {
        const val = btn.match(/data-value="([^"]*)"/)?.[1];
        if (!val) continue;
        const upper = val.trim().toUpperCase();
        const isDisabled = /disabled|out-of-stock|unavailable/i.test(btn);
        if (isDisabled) {
          if (!outOfStockSizes.includes(upper)) outOfStockSizes.push(upper);
        } else {
          if (!sizes.includes(upper)) sizes.push(upper);
        }
      }
    }

    // 2. Descripción — buscar en el tab de descripción o en el meta
    let description = '';
    // og:description
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
    if (ogDesc) description = ogDesc[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;/g, '–').replace(/&#8220;|&#8221;/g, '"').trim();

    // Buscar texto más largo en la sección de descripción
    const descMatch = html.match(/class="woocommerce-product-details__short-description"[^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      const cleanDesc = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanDesc.length > description.length) description = cleanDesc;
    }

    // Tab de descripción completa
    const fullDescMatch = html.match(/id="tab-description"[^>]*>([\s\S]*?)<\/div>/i);
    if (fullDescMatch) {
      const cleanFull = fullDescMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanFull.length > 20 && cleanFull.length > description.length) description = cleanFull;
    }

    // 3. Info adicional — buscar en la tabla de atributos
    const attributes = {};
    const tableRows = html.match(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi) || [];
    for (const row of tableRows) {
      const thMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
      const tdMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (thMatch && tdMatch) {
        const key = thMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase().replace(/\s+/g, '_');
        const val = tdMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (key && val && !['peso', 'dimensiones', 'weight', 'dimensions'].includes(key)) {
          attributes[key] = val;
        }
      }
    }

    // 4. Color — del nombre o atributos
    const color = attributes.color || null;

    // 5. Material
    const material = attributes.material || attributes.tela || null;

    // 6. Corte/fit
    const corte = attributes.corte || null;

    // 7. Género
    const genero = attributes.género || attributes.genero || null;

    return {
      sizes: [...new Set(sizes)],
      outOfStockSizes: [...new Set(outOfStockSizes)],
      description: description.slice(0, 500),
      attributes,
      color,
      material,
      corte,
      genero,
    };
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return null;
  }
}

async function main() {
  // Get all products
  let items = [];
  let lastKey;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${TENANT_ID}`, ':sk': 'PRODUCT#' },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Total productos: ${items.length}\n`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    console.log(`[${i + 1}/${items.length}] ${p.name}`);

    const details = await scrapeProductDetails(p.pageUrl);
    if (!details) {
      console.log(`  ✗ No se pudo scrappear`);
      failed++;
      continue;
    }

    // Armar description mejorada
    let newDesc = p.description || '';
    if (details.description && details.description.length > (newDesc || '').length) {
      newDesc = details.description;
    }

    // Armar searchableText enriquecido
    const searchParts = [
      p.name, p.category, p.brand,
      newDesc,
      details.color, details.material, details.corte, details.genero,
      ...(details.sizes || []),
    ].filter(Boolean);
    const searchableText = searchParts.join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Merge attributes
    const mergedAttrs = { ...(p.attributes || {}), ...details.attributes };
    if (details.material) mergedAttrs.material = details.material;
    if (details.corte) mergedAttrs.corte = details.corte;
    if (details.color) mergedAttrs.color = details.color;
    if (details.genero) mergedAttrs.genero = details.genero;

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: p.PK, SK: p.SK },
      UpdateExpression: 'SET #desc = :desc, sizes = :sizes, outOfStockSizes = :oos, attributes = :attrs, searchableText = :st',
      ExpressionAttributeNames: { '#desc': 'description' },
      ExpressionAttributeValues: {
        ':desc': newDesc,
        ':sizes': details.sizes,
        ':oos': details.outOfStockSizes,
        ':attrs': mergedAttrs,
        ':st': searchableText,
      },
    }));

    const sizesStr = details.sizes.length > 0 ? details.sizes.join(', ') : 'sin talles';
    const oosStr = details.outOfStockSizes.length > 0 ? ` | Agotados: ${details.outOfStockSizes.join(', ')}` : '';
    console.log(`  ✓ Talles: [${sizesStr}]${oosStr} | ${Object.keys(details.attributes).length} attrs | desc: ${newDesc.slice(0, 60)}...`);
    enriched++;

    // Rate limit: ~3 req/sec
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ ${enriched} productos enriquecidos`);
  console.log(`✗ ${failed} fallaron`);
}

main().catch(console.error);
