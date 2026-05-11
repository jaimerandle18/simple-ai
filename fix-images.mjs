// Fix product images: scrape each product page for real image URLs
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const FIRECRAWL_KEY = process.env.FIRECRAWL_KEY;
const TABLE = 'simple-ai-dev';
const TENANT_ID = '2d34bcf6-a336-426d-893c-005189da0b65';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'sa-east-1' }));

async function scrapeImage(pageUrl) {
  if (!pageUrl || !pageUrl.startsWith('http')) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      },
      body: JSON.stringify({
        url: pageUrl,
        formats: ['markdown'],
        actions: [{ type: 'wait', milliseconds: 2000 }],
      }),
    });
    const data = await res.json();
    if (!data.success) return null;

    const md = data.data?.markdown || '';
    // Buscar URLs de imágenes reales de productos (no placeholders)
    const imgRegex = /https:\/\/acdn[^\s)"\]]+(?:\.jpg|\.jpeg|\.png|\.webp)/gi;
    const matches = md.match(imgRegex) || [];

    // Filtrar placeholders y duplicados, preferir imágenes de productos
    const realImages = [...new Set(matches)]
      .filter(url => url.includes('/products/') || url.includes('/product'))
      .filter(url => !url.includes('empty-placeholder'))
      .filter(url => !url.includes('logo'));

    return realImages[0] || null;
  } catch (err) {
    console.error(`  Error scraping ${pageUrl}: ${err.message}`);
    return null;
  }
}

async function main() {
  // Get all products
  const res = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `TENANT#${TENANT_ID}`, ':sk': 'PRODUCT#' },
  }));

  const products = res.Items || [];
  console.log(`Total products: ${products.length}`);

  let updated = 0;
  for (const p of products) {
    const pageUrl = p.pageUrl;
    const currentImg = p.imageUrl || '';

    // Skip if already has a real image
    if (currentImg.includes('/products/') && !currentImg.includes('empty-placeholder')) {
      console.log(`  ✓ ${p.name} — already has image`);
      continue;
    }

    if (!pageUrl || !pageUrl.startsWith('http')) {
      console.log(`  ✗ ${p.name} — no pageUrl`);
      continue;
    }

    console.log(`  Scraping: ${p.name} — ${pageUrl}`);
    const imageUrl = await scrapeImage(pageUrl);

    if (imageUrl) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: p.PK, SK: p.SK },
        UpdateExpression: 'SET imageUrl = :img',
        ExpressionAttributeValues: { ':img': imageUrl },
      }));
      console.log(`  ✓ Updated: ${imageUrl.slice(0, 80)}`);
      updated++;
    } else {
      console.log(`  ✗ No image found`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ Updated ${updated} product images`);
}

main().catch(console.error);
