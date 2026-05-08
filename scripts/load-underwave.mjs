// Cargar productos de Underwave en DynamoDB como nuevo tenant
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { readFileSync } from 'fs';

const TABLE = 'simple-ai-dev';
const TENANT_ID = 'underwave-001';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'sa-east-1' }),
  { marshallOptions: { removeUndefinedValues: true } }
);

async function main() {
  const data = JSON.parse(readFileSync('scrape-underwave.json', 'utf8'));
  const now = new Date().toISOString();

  // 1. Crear tenant
  console.log('Creando tenant...');
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `TENANT#${TENANT_ID}`,
      SK: 'PROFILE',
      tenantId: TENANT_ID,
      name: 'Underwave',
      plan: 'pro',
      createdAt: now,
      websiteUrl: 'https://underwavebrand.com',
    },
  }));

  // 2. Crear agente con config
  console.log('Creando agente...');
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `TENANT#${TENANT_ID}`,
      SK: 'AGENT#main',
      tenantId: TENANT_ID,
      agentId: 'main',
      active: true,
      agentConfig: {
        assistantName: 'Eze',
        tone: 'casual',
        websiteUrl: 'https://underwavebrand.com',
        welcomeMessage: '¡Qué onda! Soy Eze de Underwave 🏄 Contame qué andás buscando',
        businessHours: 'Lunes a Viernes 10 a 18hs, Sábados 10 a 14hs',
        extraInstructions: `Somos Underwave, marca argentina de ropa con onda surf. 12 años en el mercado. Fabricamos todo en Argentina.

ENVÍOS:
- Envío gratis en compras mayores a $120.000
- Envíos a todo el país con Southpost
- Demoran entre 2 y 7 días hábiles
- Código de seguimiento por email

RETIRO EN LOCAL:
- Av. del Libertador 14056, Martínez, Buenos Aires
- Esperar 24hs después de la compra
- Plazo de 3 meses para retirar

MEDIOS DE PAGO:
- Tarjeta de débito y crédito
- Transferencia bancaria (10% OFF por tiempo limitado)
- Hasta 3 cuotas sin interés
- Efectivo en el local (20% OFF)

CAMBIOS:
- Hasta 30 días después de la compra
- Prendas en perfectas condiciones, con etiqueta y bolsa, sin uso
- El cliente cubre el envío del cambio (salvo error nuestro)
- Contactar por WhatsApp con nombre, apellido y nro de orden

DEVOLUCIONES:
- Hasta 10 días después de la compra
- Mismas condiciones que cambios

TALLES: Si no está seguro del talle, decile que nos mande su altura y peso por WhatsApp y lo asesoramos.

WhatsApp: +54 11 6275-2224
Instagram: @underwavebrand`,
        promotions: '10% OFF por transferencia bancaria. Hasta 3 cuotas sin interés. 20% OFF en compras en el showroom con efectivo.',
      },
      createdAt: now,
    },
  }));

  // 3. Cargar productos
  console.log(`Cargando ${data.products.length} productos...`);
  let loaded = 0;

  for (const p of data.products) {
    const productId = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Normalizar categoría
    const catMap = {
      'Buzos/Hoodies': 'Buzos',
      'Buzos/Sweaters': 'Buzos',
      'Gorras': 'Headwear',
      'UWX': 'Deportiva',
    };
    const category = catMap[p.category] || p.category;

    // Precio efectivo (sale o normal)
    const effectivePrice = p.salePrice || p.price;

    // Construir searchableText
    const searchableText = [p.name, category, p.discount, p.tag]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `TENANT#${TENANT_ID}`,
        SK: `PRODUCT#${productId}`,
        tenantId: TENANT_ID,
        productId,
        name: p.name,
        description: p.discount ? `${p.discount} OFF — Antes $${p.price.toLocaleString('es-AR')}` : '',
        price: `$${effectivePrice.toLocaleString('es-AR')}`,
        priceNum: effectivePrice,
        priceOriginal: p.price,
        category,
        brand: 'Underwave',
        imageUrl: '',
        pageUrl: p.url,
        sourceUrl: 'https://underwavebrand.com',
        discount: p.discount || null,
        tag: p.tag || null,
        attributes: {},
        usosRecomendados: [],
        publico: [],
        searchableText,
        categoryNormalized: category.toLowerCase().replace(/\s+/g, '_'),
        categoryParent: category.toLowerCase().replace(/\s+/g, '_'),
        createdAt: now,
      },
    }));

    loaded++;
    if (loaded % 20 === 0) console.log(`  ${loaded}/${data.products.length}`);

    // Tiny delay para no throttlear
    if (loaded % 25 === 0) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n✅ Tenant "${TENANT_ID}" creado`);
  console.log(`✅ ${loaded} productos cargados`);
  console.log(`✅ Agente "Eze" configurado con políticas de Underwave`);
}

main().catch(console.error);
