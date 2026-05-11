// Re-scrape trown.com.ar con extracción limpia
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const FIRECRAWL_KEY = process.env.FIRECRAWL_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TABLE = 'simple-ai-dev';
const TENANT_ID = '2d34bcf6-a336-426d-893c-005189da0b65';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'sa-east-1' }));

// 1. Borrar productos viejos
async function deleteOldProducts() {
  console.log('Borrando productos viejos...');
  let count = 0;
  let lastKey;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${TENANT_ID}`, ':sk': 'PRODUCT#' },
      ExclusiveStartKey: lastKey,
    }));
    for (const item of res.Items || []) {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: item.PK, SK: item.SK } }));
      count++;
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  console.log(`Borrados: ${count}`);
}

// 2. Crawl con Firecrawl
async function crawlSite(url) {
  console.log('Iniciando crawl...');
  const startRes = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FIRECRAWL_KEY}` },
    body: JSON.stringify({ url, limit: 80, scrapeOptions: { formats: ['markdown'] } }),
  });
  const startData = await startRes.json();
  if (!startData.success) { console.error('Crawl failed:', startData); return []; }

  const crawlId = startData.id;
  console.log('Crawl ID:', crawlId);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}` },
    });
    const data = await res.json();
    console.log(`Status: ${data.status}, pages: ${data.data?.length || 0}`);
    if (data.status === 'completed') return data.data || [];
    if (data.status === 'failed') return [];
  }
  return [];
}

// 3. Extraer productos con OpenAI (prompt mejorado)
async function extractProducts(pageContent, pageUrl) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 4000,
      messages: [{
        role: 'system',
        content: `Extraé TODOS los productos de esta página de una tienda online.

Para CADA producto devolvé EXACTAMENTE estos campos:
- "name": nombre del producto (limpio, sin códigos)
- "description": descripción completa (materiales, colores disponibles, talles, características)
- "price": precio EXACTO como aparece en la página (ej: "$98.999,00"). Si no hay precio, poné "Consultar"
- "category": categoría (ej: "buzos", "gorras", "pantalones", "accesorios", "calzado", etc)
- "imageUrl": URL de la imagen del producto (buscar URLs que terminen en .jpg, .jpeg, .png, .webp)

REGLAS:
- Solo incluir PRODUCTOS reales que se venden (no banners, no categorías, no textos decorativos)
- El precio debe ser el número exacto de la página, NO inventar precios
- Si un producto tiene variantes de color, es UN solo producto con los colores en la descripción
- Si no hay productos en la página, devolvé []
- Devolvé SOLO el JSON array, nada más`
      }, {
        role: 'user',
        content: pageContent.slice(0, 10000)
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

// 4. Main
async function main() {
  await deleteOldProducts();

  const pages = await crawlSite('https://www.trown.com.ar/');
  console.log(`\nCrawled ${pages.length} pages`);

  const validPages = pages.filter(p => p.markdown && p.markdown.length > 100);
  console.log(`Valid pages: ${validPages.length}`);

  // Extraer productos de cada página
  const allProducts = new Map(); // name → product (dedup por nombre)

  for (let i = 0; i < validPages.length; i++) {
    const page = validPages[i];
    const pageUrl = page.metadata?.url || page.metadata?.sourceURL || '';
    console.log(`\n[${i+1}/${validPages.length}] ${pageUrl}`);

    try {
      const products = await extractProducts(page.markdown, pageUrl);
      console.log(`  Extracted: ${products.length} products`);

      for (const p of products) {
        if (!p.name || p.name.length < 3) continue;

        // Dedup: si ya existe, mantener el que tenga más info
        const key = p.name.toLowerCase().trim();
        const existing = allProducts.get(key);
        if (existing) {
          // Mantener el que tenga precio real
          if (existing.price === 'Consultar' && p.price !== 'Consultar') {
            allProducts.set(key, { ...p, pageUrl });
          }
          continue;
        }
        allProducts.set(key, { ...p, pageUrl });
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }

    // Rate limit OpenAI
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== Total productos únicos: ${allProducts.size} ===\n`);

  // Guardar en DynamoDB
  const now = new Date().toISOString();
  let saved = 0;
  const csvRows = ['name,price,category,description,imageUrl,pageUrl'];

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
        imageUrl: product.imageUrl || '',
        pageUrl: product.pageUrl || '',
        sourceUrl: 'https://www.trown.com.ar/',
        createdAt: now,
      },
    }));

    // CSV row (escapear comillas)
    const esc = (s) => `"${(s||'').replace(/"/g, '""')}"`;
    csvRows.push([esc(product.name), esc(product.price), esc(product.category), esc(product.description), esc(product.imageUrl), esc(product.pageUrl)].join(','));

    saved++;
    console.log(`  Saved: ${product.name} | ${product.price} | ${product.category}`);
  }

  // Guardar CSV en S3
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'sa-east-1' });
  const csvContent = csvRows.join('\n');

  await s3.send(new PutObjectCommand({
    Bucket: 'simple-ai-attachments-dev',
    Key: `products/${TENANT_ID}/productos-trown.csv`,
    Body: csvContent,
    ContentType: 'text/csv',
  }));

  console.log(`\n✅ ${saved} productos guardados en DynamoDB`);
  console.log(`✅ CSV guardado en s3://simple-ai-attachments-dev/products/${TENANT_ID}/productos-trown.csv`);
}

main().catch(console.error);
