/**
 * Script de enriquecimiento del catálogo.
 * Lee productos de DynamoDB, los enriquece con gpt-4o-mini, y los actualiza.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const OPENAI_KEY = process.env.OPENAI_KEY;
const TABLE = 'simple-ai-dev';
const TENANT_ID = '2d34bcf6-a336-426d-893c-005189da0b65';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'sa-east-1' }), {
  marshallOptions: { removeUndefinedValues: true },
});

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  // "$ 67.186,00" → 67186, "$67186" → 67186, "67.186" → 67186
  const cleaned = priceStr.replace(/[^0-9.,]/g, '');
  // Formato argentino: puntos son miles, coma es decimal
  const parts = cleaned.split(',');
  const intPart = parts[0].replace(/\./g, '');
  return parseInt(intPart) || 0;
}

async function enrichBatch(products) {
  const productList = products.map((p, i) =>
    `${i}. nombre: "${p.name}"\n   descripción: "${(p.description || '').slice(0, 200)}"\n   categoría: "${p.category || ''}"\n   marca actual: "${p.brand || ''}"`
  ).join('\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: `Enriquecé estos productos de un comercio argentino. Para CADA producto (por índice), devolvé:

{
  "products": [
    {
      "index": 0,
      "brand": "marca si se infiere" | null,
      "categoryNormalized": "snake_case ej amoladoras_angulares",
      "categoryParent": "categoría padre amplia ej herramientas_electricas",
      "attributes": {
        "potencia_w": number | null,
        "voltaje_v": number | null,
        "capacidad_l": number | null,
        "presion_bar": number | null,
        "diametro_mm": number | null,
        "peso_kg": number | null,
        "alimentacion": "cable" | "bateria" | "neumatico" | null
      },
      "usosRecomendados": ["3-6 usos concretos en lenguaje natural"],
      "publico": ["DIY" | "obra_ocasional" | "profesional"]
    }
  ]
}

REGLAS:
- Si no tenés el dato → null o array vacío. NUNCA inventes.
- attributes solo numéricos o enums. NO texto libre.
- usosRecomendados: tareas REALES que ese producto resuelve (ej: "cortar cerámica", "limpiar autos", "pulir metal").
- Pensá como un cliente buscando: ¿qué escribiría para encontrar esto?

Devolvé SOLO el JSON.`
      }, {
        role: 'user',
        content: productList,
      }],
    }),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(text).products || [];
  } catch {
    console.error('Parse error:', text.slice(0, 200));
    return [];
  }
}

async function main() {
  console.log('Loading products...');
  const scanRes = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `TENANT#${TENANT_ID}`, ':sk': 'PRODUCT#' },
  }));

  const products = scanRes.Items || [];
  console.log(`Found ${products.length} products\n`);

  let enriched = 0;
  // Process in batches of 5
  for (let i = 0; i < products.length; i += 5) {
    const batch = products.slice(i, i + 5);
    console.log(`\nBatch ${Math.floor(i/5) + 1}/${Math.ceil(products.length/5)} (${batch.map(p => p.name).join(', ')})`);

    const enrichments = await enrichBatch(batch);

    for (const enrichment of enrichments) {
      const idx = enrichment.index;
      if (idx === undefined || idx >= batch.length) continue;

      const product = batch[idx];
      const priceNum = parsePrice(product.price);

      // Build searchableText
      const searchParts = [
        product.name,
        enrichment.brand,
        product.category,
        enrichment.categoryNormalized?.replace(/_/g, ' '),
        enrichment.categoryParent?.replace(/_/g, ' '),
        product.description,
        ...(enrichment.usosRecomendados || []),
      ].filter(Boolean);
      const searchableText = searchParts.join(' ').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Update in DynamoDB
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: product.PK, SK: product.SK },
        UpdateExpression: 'SET priceNum = :pn, categoryNormalized = :cn, categoryParent = :cp, #attrs = :at, usosRecomendados = :ur, publico = :pu, searchableText = :st, brand = :br',
        ExpressionAttributeNames: { '#attrs': 'attributes' },
        ExpressionAttributeValues: {
          ':pn': priceNum,
          ':cn': enrichment.categoryNormalized || product.category?.toLowerCase().replace(/\s+/g, '_') || '',
          ':cp': enrichment.categoryParent || '',
          ':at': enrichment.attributes || {},
          ':ur': enrichment.usosRecomendados || [],
          ':pu': enrichment.publico || [],
          ':st': searchableText,
          ':br': enrichment.brand || product.brand || '',
        },
      }));

      console.log(`  ✓ ${product.name} | priceNum=${priceNum} | cat=${enrichment.categoryNormalized} | usos=${(enrichment.usosRecomendados || []).length} | attrs=${Object.keys(enrichment.attributes || {}).filter(k => enrichment.attributes[k] !== null).length}`);
      enriched++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ Enriched ${enriched}/${products.length} products`);
}

main().catch(console.error);
