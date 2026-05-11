import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const FIRECRAWL_KEY = process.env.FIRECRAWL_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TABLE = 'simple-ai-dev';
const TENANT_ID = '2d34bcf6-a336-426d-893c-005189da0b65';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'sa-east-1' }), {
  marshallOptions: { removeUndefinedValues: true },
});

const CATEGORIES = [
  { url: 'https://ferreteriaeltrebol.com.ar/20-amoladoras-angulares', category: 'Amoladoras Angulares' },
  { url: 'https://ferreteriaeltrebol.com.ar/21-amoladoras-de-banco', category: 'Amoladoras de Banco' },
  { url: 'https://ferreteriaeltrebol.com.ar/22-aspiradoras', category: 'Aspiradoras' },
  { url: 'https://ferreteriaeltrebol.com.ar/23-atornilladores', category: 'Atornilladoras' },
  { url: 'https://ferreteriaeltrebol.com.ar/24-compresores', category: 'Compresores' },
  { url: 'https://ferreteriaeltrebol.com.ar/25-cepillos-electricos', category: 'Cepillos Eléctricos' },
  { url: 'https://ferreteriaeltrebol.com.ar/28-hidrolavadoras', category: 'Hidrolavadoras' },
  { url: 'https://ferreteriaeltrebol.com.ar/40-sierras-caladoras', category: 'Sierras Caladoras' },
  { url: 'https://ferreteriaeltrebol.com.ar/41-sierras-circulares', category: 'Sierras Circulares' },
  { url: 'https://ferreteriaeltrebol.com.ar/42-sierras-sable', category: 'Sierras Sable' },
  { url: 'https://ferreteriaeltrebol.com.ar/43-sierras-sin-fin', category: 'Sierras Sin Fin' },
];

async function scrapePage(url) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FIRECRAWL_KEY}` },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  const data = await res.json();
  if (!data.success) { console.error(`Scrape failed: ${url}`, data); return null; }
  return data.data?.markdown || '';
}

async function extractProducts(content, category, pageUrl) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 4000,
      messages: [{
        role: 'system',
        content: `Extraé TODOS los productos de esta página de una ferretería online argentina.

Para CADA producto devolvé:
- "name": nombre completo del producto (marca + modelo)
- "description": descripción con características técnicas (watts, voltaje, capacidad, RPM, etc)
- "price": precio EXACTO como aparece (ej: "$45.833,00"). Si no hay precio → "Consultar"
- "category": "${category}"
- "imageUrl": URL de la imagen del producto (buscar URLs que contengan .jpg, .jpeg, .png, .webp)
- "brand": marca (ej: "Dewalt", "Makita", "Bosch", "Stanley", etc)

REGLAS:
- Solo productos REALES que se venden
- Precio exacto de la página, NO inventar
- Si hay paginación y se mencionan más páginas, solo extraé los de esta página
- Devolvé SOLO el JSON array, nada más
- Si no hay productos, devolvé []`
      }, {
        role: 'user',
        content: content.slice(0, 12000)
      }],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '[]';
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  }
}

async function scrapeCategory(catUrl, category) {
  console.log(`\n=== ${category} ===`);
  console.log(`URL: ${catUrl}`);

  // Scrapear página principal de la categoría
  const content = await scrapePage(catUrl);
  if (!content) { console.log('  No content'); return []; }

  const products = await extractProducts(content, category, catUrl);
  console.log(`  Extracted: ${products.length} products`);

  // Scrapear página 2 si existe
  const page2Content = await scrapePage(catUrl + '?page=2');
  if (page2Content && page2Content.length > 500) {
    const page2Products = await extractProducts(page2Content, category, catUrl);
    console.log(`  Page 2: ${page2Products.length} products`);
    products.push(...page2Products);
  }

  return products;
}

async function main() {
  const allProducts = new Map();
  const now = new Date().toISOString();

  for (const cat of CATEGORIES) {
    const products = await scrapeCategory(cat.url, cat.category);

    for (const p of products) {
      if (!p.name || p.name.length < 3) continue;
      const key = p.name.toLowerCase().trim();
      if (allProducts.has(key)) continue; // dedup

      allProducts.set(key, {
        ...p,
        pageUrl: cat.url,
        category: cat.category,
      });
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== Total productos únicos: ${allProducts.size} ===\n`);

  // Guardar en DynamoDB
  let saved = 0;
  const csvRows = ['name,price,category,brand,description,imageUrl,pageUrl'];

  for (const [, product] of allProducts) {
    const productId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `TENANT#${TENANT_ID}`,
        SK: `PRODUCT#${productId}`,
        tenantId: TENANT_ID,
        productId,
        name: product.name,
        description: product.description || '',
        price: product.price || 'Consultar',
        category: product.category || '',
        brand: product.brand || '',
        imageUrl: product.imageUrl || '',
        pageUrl: product.pageUrl || '',
        sourceUrl: 'https://ferreteriaeltrebol.com.ar/',
        createdAt: now,
      },
    }));

    const esc = (s) => `"${(s||'').replace(/"/g, '""')}"`;
    csvRows.push([esc(product.name), esc(product.price), esc(product.category), esc(product.brand), esc(product.description), esc(product.imageUrl), esc(product.pageUrl)].join(','));

    saved++;
    console.log(`  Saved: ${product.name} | ${product.price} | ${product.category} | ${product.brand}`);
  }

  // CSV a S3
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'sa-east-1' });
  await s3.send(new PutObjectCommand({
    Bucket: 'simple-ai-attachments-dev',
    Key: `products/${TENANT_ID}/productos-ferreteria.csv`,
    Body: csvRows.join('\n'),
    ContentType: 'text/csv',
  }));

  console.log(`\n✅ ${saved} productos guardados en DynamoDB`);
  console.log(`✅ CSV en s3://simple-ai-attachments-dev/products/${TENANT_ID}/productos-ferreteria.csv`);
}

main().catch(console.error);
