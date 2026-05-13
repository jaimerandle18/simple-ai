import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import Anthropic from '@anthropic-ai/sdk';

const client = new DynamoDBClient({ region: 'sa-east-1' });
const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TABLE = 'simple-ai-dev';
const TENANT = '2d34bcf6-a336-426d-893c-005189da0b65';
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

const urls = [
  'https://blockplas.com.ar/categoria-producto/blockplas-10/',
  'https://blockplas.com.ar/categoria-producto/deck-plastico/',
  'https://blockplas.com.ar/categoria-producto/perfiles-steel-frame/',
  'https://blockplas.com.ar/categoria-producto/revestimientos/',
  'https://blockplas.com.ar/producto/ladrillos-plasticos-reciclados-blockplas-x-mts2/',
  'https://blockplas.com.ar/producto/ladrillos-simples-plasticos-reciclados-blockplas-x-mts2/',
  'https://blockplas.com.ar/producto/ladrillos-de-plasticos-reciclados-blockplas-b10-por-pallet/',
  'https://blockplas.com.ar/producto/perfil-pgc70/',
  'https://blockplas.com.ar/producto/perfil-pgu-100/',
  'https://blockplas.com.ar/producto/perfil-pgc-120-para-techos-correas-o-estructuras-de-acero/',
  'https://blockplas.com.ar/producto/escuadra-de-union-en-l/',
  'https://blockplas.com.ar/producto/deck-de-madera-plastica-sin-mantenimiento-espesor-30-mm/',
  'https://blockplas.com.ar/producto/siding-pvc-blanco/',
  'https://blockplas.com.ar/producto/revestimiento-siding-pvc-nordico/',
  'https://blockplas.com.ar/producto/wall-panel-con-filtro-uv-apto-exterior-e-interior/',
  'https://blockplas.com.ar/producto/poste-plastico-para-alambrado-deck/',
  'https://blockplas.com.ar/producto/muestrario-de-ladrillos-plasticos-reciclados/',
  'https://blockplas.com.ar/producto/juegos-de-encastre-ladrillos-bloques-gigantes-820-piezas-casa-xl/',
  'https://blockplas.com.ar/producto/juegos-de-encastre-ladrillos-bloques-gigantes-396-piezas-casita-peques/',
  'https://blockplas.com.ar/producto/juego-de-encastre-bloques-gigantes-278-piezas-combo-castillo/',
  'https://blockplas.com.ar/producto/juegos-de-encastre-ladrillos-bloques-gigantes-tapa/',
  'https://blockplas.com.ar/producto/juegos-de-encastre-ladrillos-bloques-gigantes-caja-combo-1/',
  'https://blockplas.com.ar/producto/juegos-de-encastre-ladrillos-bloques-gigantes-caja-combo-2/',
];

async function scrapePage(url) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + FIRECRAWL_KEY },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  const data = await res.json();
  return data.success ? (data.data?.markdown || '') : '';
}

const SYSTEM_PROMPT = `Extrae TODOS los productos de esta pagina de BlockPlas (ladrillos plasticos reciclados).

IMPORTANTE: si un producto tiene VARIANTES por color (blanco, negro, marron), lista CADA variante como producto SEPARADO con su precio propio.

Para cada producto:
- "name": nombre completo incluyendo color/variante. Ej: "Ladrillo Doble BlockPlas Blanco x m2"
- "description": medidas, material, usos, specs tecnicas
- "price": precio EXACTO como aparece. Si hay precio por m2 y por pack, poner el de m2
- "category": Ladrillos | Perfiles | Revestimientos | Juegos | Deck | Accesorios | Modulos
- "imageUrl": URL completa de imagen
- "brand": "BlockPlas"
- "attributes": objeto con medidas, material, rendimiento, unidades_por_pack, peso, color, etc

REGLAS:
- Cada color/variante = producto separado
- Precio exacto, NO inventar
- Si dice "desde $X" poner ese precio
- Incluir TODOS los productos de la pagina

Devolver JSON: {"products": [...]}`;

async function run() {
  // Borrar productos viejos
  const old = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `TENANT#${TENANT}`, ':sk': 'PRODUCT#' },
    Limit: 1500,
  }));
  for (const o of (old.Items || [])) {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: { PK: o.PK, SK: o.SK } }));
  }
  console.log(`Deleted ${(old.Items || []).length} old products`);

  const allProducts = new Map();
  const now = new Date().toISOString();

  for (let i = 0; i < urls.length; i += 3) {
    const batch = urls.slice(i, i + 3);
    console.log(`\nBatch ${Math.floor(i/3)+1}/${Math.ceil(urls.length/3)}: ${batch.map(u => u.split('/').filter(Boolean).pop()).join(', ')}`);

    const results = await Promise.all(batch.map(async url => {
      const content = await scrapePage(url);
      if (content.length < 50) { console.log(`  Skip (empty): ${url}`); return []; }

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: content.slice(0, 15000) }],
      });

      const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
      try {
        const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
        return parsed.products || [];
      } catch {
        const m = text.match(/\[[\s\S]*\]/);
        return m ? JSON.parse(m[0]) : [];
      }
    }));

    for (const products of results) {
      for (const p of products) {
        if (!p.name || p.name.length < 3) continue;
        const key = p.name.toLowerCase().trim();
        if (allProducts.has(key)) continue;

        const productId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const priceNum = typeof p.price === 'string' ? parseInt(p.price.replace(/[^0-9]/g, '')) || 0 : p.price || 0;
        const st = [p.name, p.category, p.brand, p.description].filter(Boolean).join(' ').toLowerCase();

        await db.send(new PutCommand({ TableName: TABLE, Item: {
          PK: `TENANT#${TENANT}`, SK: `PRODUCT#${productId}`,
          tenantId: TENANT, productId, name: p.name, description: p.description || '',
          price: p.price || 'Consultar', priceNum, category: p.category || '',
          brand: p.brand || 'BlockPlas', imageUrl: p.imageUrl || '',
          sourceUrl: 'https://blockplas.com.ar', searchableText: st,
          categoryNormalized: (p.category || '').toLowerCase().replace(/\s+/g, '_'),
          attributes: p.attributes || {},
          createdAt: now,
        }}));

        allProducts.set(key, p);
        console.log(`  ${p.name} | ${p.price || 'Consultar'}`);
      }
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nTotal: ${allProducts.size} products saved`);
}

run().catch(console.error);
