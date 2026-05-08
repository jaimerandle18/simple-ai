// Scrape product images from underwavebrand.com and update DynamoDB
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'simple-ai-dev';
const TENANT_ID = 'underwave-001';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'sa-east-1' }));

async function scrapeProductImage(pageUrl) {
  if (!pageUrl || !pageUrl.startsWith('http')) return null;

  try {
    const res = await fetch(pageUrl);
    if (!res.ok) return null;
    const html = await res.text();

    // Buscar og:image (la más confiable para producto principal)
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogMatch) return ogMatch[1];

    // Buscar primera imagen de producto en wp-content/uploads
    const imgRegex = /https:\/\/underwavebrand\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/gi;
    const matches = html.match(imgRegex) || [];

    // Filtrar thumbnails (los que tienen dimensiones como -100x100)
    const fullSize = [...new Set(matches)]
      .filter(url => !/-\d+x\d+\./.test(url))
      .filter(url => !url.includes('TABLA-DE-TALLE'))
      .filter(url => !url.includes('logo'))
      .filter(url => !url.includes('banner'));

    return fullSize[0] || matches[0] || null;
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

  console.log(`Total productos: ${items.length}`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const pageUrl = p.pageUrl;

    // Skip si ya tiene imagen
    if (p.imageUrl && p.imageUrl.startsWith('http') && p.imageUrl.includes('wp-content')) {
      console.log(`  [${i+1}/${items.length}] ✓ ${p.name} — ya tiene imagen`);
      continue;
    }

    if (!pageUrl) {
      console.log(`  [${i+1}/${items.length}] ✗ ${p.name} — sin pageUrl`);
      failed++;
      continue;
    }

    console.log(`  [${i+1}/${items.length}] Scraping: ${p.name}`);
    const imageUrl = await scrapeProductImage(pageUrl);

    if (imageUrl) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: p.PK, SK: p.SK },
        UpdateExpression: 'SET imageUrl = :img',
        ExpressionAttributeValues: { ':img': imageUrl },
      }));
      console.log(`    ✓ ${imageUrl.slice(-50)}`);
      updated++;
    } else {
      console.log(`    ✗ No image found`);
      failed++;
    }

    // Rate limit: 3 requests/sec
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ ${updated} imágenes actualizadas`);
  console.log(`✗ ${failed} sin imagen`);
}

main().catch(console.error);
