import { APIGatewayProxyEventV2 } from 'aws-lambda';
import Anthropic from '@anthropic-ai/sdk';
import { keys, getItem, putItem, deleteItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

// ============================================================
// Remarketing API endpoints
// ============================================================
export async function handleRemarketing(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // ---- Campaigns ----

  // POST /remarketing/campaigns — crear campana
  if (method === 'POST' && path === '/remarketing/campaigns') {
    const body = JSON.parse(event.body || '{}');
    const { name, triggerConfig, timing } = body;

    if (!name) return error('name is required', 400);

    const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Generar 5 variantes con Haiku
    let variants: any[] = [];
    try {
      const tenant = await getItem(keys.tenant(tenantId));
      const businessName = (tenant?.name as string) || (tenant?.businessName as string) || 'el negocio';

      variants = await generateVariantsWithHaiku({
        businessName,
        campaignType: 'no_reply_post_quote_48h',
        examplePlaceholders: { nombre: 'Juan', producto: 'Sierra Sable 950w' },
      });
    } catch (err: any) {
      console.error('[REMARKETING] Variant generation failed:', err.message);
      return error(`Failed to generate variants: ${err.message}`, 500);
    }

    const campaign = {
      ...keys.campaign(tenantId, campaignId),
      campaignId,
      tenantId,
      name,
      status: 'draft',
      trigger: 'no_reply_post_quote_48h',
      triggerConfig: {
        hoursAfter: triggerConfig?.hoursAfter || 48,
        minQuoteAmount: triggerConfig?.minQuoteAmount,
        productCategories: triggerConfig?.productCategories,
      },
      variants,
      filters: {
        excludeIfBoughtLastDays: 7,
        excludeIfMessagedLastDays: 14,
      },
      timing: {
        daysOfWeek: timing?.daysOfWeek || ['mon', 'tue', 'wed', 'thu', 'fri'],
        hourFrom: timing?.hourFrom || 10,
        hourTo: timing?.hourTo || 19,
        timezone: timing?.timezone || 'America/Argentina/Buenos_Aires',
      },
      stats: {
        totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0,
        totalSales: 0, totalRevenue: 0, blockCount: 0, optOutCount: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    await putItem(campaign);
    return json(campaign, 201);
  }

  // GET /remarketing/campaigns — listar campanas
  if (method === 'GET' && path === '/remarketing/campaigns') {
    const campaigns = await queryItems(`TENANT#${tenantId}`, 'CAMPAIGN#');
    return json(campaigns.filter((c: any) => c.status !== 'archived'));
  }

  // Campaign-specific routes
  const campaignMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)$/);
  const campaignId = campaignMatch?.[1];

  // GET /remarketing/campaigns/:id
  if (method === 'GET' && campaignMatch && !path.includes('/stats') && !path.includes('/variants') && !path.includes('/sends')) {
    const campaign = await getItem(keys.campaign(tenantId, campaignId!));
    if (!campaign) return error('Campaign not found', 404);
    return json(campaign);
  }

  // POST /remarketing/campaigns/:id/activate
  const activateMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)\/activate$/);
  if (method === 'POST' && activateMatch) {
    const id = activateMatch[1];
    const campaign = await getItem(keys.campaign(tenantId, id));
    if (!campaign) return error('Campaign not found', 404);

    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      return error(`Cannot activate campaign in status: ${campaign.status}`, 400);
    }

    const variants = (campaign.variants as any[]) || [];
    if (variants.length < 5) {
      return error(`Campaign needs at least 5 variants (has ${variants.length})`, 400);
    }

    // Verificar que el tenant tiene canal WAHA activo
    const wahaChannel = await getItem(keys.wahaChannel(tenantId));
    if (!wahaChannel?.active) {
      return error('No active WAHA channel. Configure WAHA first.', 400);
    }

    await putItem({
      ...campaign,
      status: 'active',
      updatedAt: new Date().toISOString(),
    });

    return json({ status: 'active', campaignId: id });
  }

  // POST /remarketing/campaigns/:id/pause
  const pauseMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)\/pause$/);
  if (method === 'POST' && pauseMatch) {
    const id = pauseMatch[1];
    const campaign = await getItem(keys.campaign(tenantId, id));
    if (!campaign) return error('Campaign not found', 404);

    if (campaign.status !== 'active') {
      return error(`Cannot pause campaign in status: ${campaign.status}`, 400);
    }

    await putItem({ ...campaign, status: 'paused', updatedAt: new Date().toISOString() });
    return json({ status: 'paused', campaignId: id });
  }

  // DELETE /remarketing/campaigns/:id — archive
  if (method === 'DELETE' && campaignMatch) {
    const campaign = await getItem(keys.campaign(tenantId, campaignId!));
    if (!campaign) return error('Campaign not found', 404);

    await putItem({ ...campaign, status: 'archived', updatedAt: new Date().toISOString() });
    return json({ status: 'archived', campaignId });
  }

  // GET /remarketing/campaigns/:id/stats
  const statsMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)\/stats$/);
  if (method === 'GET' && statsMatch) {
    const id = statsMatch[1];
    const campaign = await getItem(keys.campaign(tenantId, id));
    if (!campaign) return error('Campaign not found', 404);

    const sends = await queryItems(`CAMPAIGN_SEND#${id}`);
    return json({
      campaignId: id,
      stats: campaign.stats,
      totalSends: sends.length,
      sends: sends.slice(0, 50).map((s: any) => ({
        contactPhone: s.contactPhone,
        contactName: s.contactName,
        variantId: s.variantId,
        status: s.status,
        sentAt: s.sentAt,
      })),
    });
  }

  // POST /remarketing/campaigns/:id/variants — agregar variante
  const variantsMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)\/variants$/);
  if (method === 'POST' && variantsMatch) {
    const id = variantsMatch[1];
    const campaign = await getItem(keys.campaign(tenantId, id));
    if (!campaign) return error('Campaign not found', 404);
    if (campaign.status === 'active') return error('Cannot add variants to active campaign', 400);

    const body = JSON.parse(event.body || '{}');
    if (!body.text) return error('text is required', 400);

    const variants = (campaign.variants as any[]) || [];
    const newVariant = {
      id: `v${variants.length + 1}`,
      text: body.text,
      sentCount: 0,
      replyCount: 0,
    };
    variants.push(newVariant);

    await putItem({ ...campaign, variants, updatedAt: new Date().toISOString() });
    return json(newVariant, 201);
  }

  // PUT /remarketing/campaigns/:id/variants/:vid — editar variante
  const variantEditMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)\/variants\/([^/]+)$/);
  if (method === 'PUT' && variantEditMatch) {
    const id = variantEditMatch[1];
    const vid = variantEditMatch[2];
    const campaign = await getItem(keys.campaign(tenantId, id));
    if (!campaign) return error('Campaign not found', 404);
    if (campaign.status === 'active') return error('Cannot edit variants of active campaign', 400);

    const body = JSON.parse(event.body || '{}');
    if (!body.text) return error('text is required', 400);

    const variants = (campaign.variants as any[]) || [];
    const idx = variants.findIndex((v: any) => v.id === vid);
    if (idx === -1) return error('Variant not found', 404);

    variants[idx] = { ...variants[idx], text: body.text };
    await putItem({ ...campaign, variants, updatedAt: new Date().toISOString() });
    return json(variants[idx]);
  }

  // GET /remarketing/campaigns/:id/sends — listar envios
  const sendsMatch = path.match(/^\/remarketing\/campaigns\/([^/]+)\/sends$/);
  if (method === 'GET' && sendsMatch) {
    const id = sendsMatch[1];
    const sends = await queryItems(`CAMPAIGN_SEND#${id}`, undefined, { limit: 100 });
    return json(sends);
  }

  // ---- Health ----

  // GET /remarketing/health
  if (method === 'GET' && path === '/remarketing/health') {
    const health = await getItem(keys.numberHealth(tenantId));
    if (!health) return json({ status: 'no_data', message: 'No remarketing activity yet' });
    return json(health);
  }

  // ---- Suppression ----

  // GET /remarketing/suppression
  if (method === 'GET' && path === '/remarketing/suppression') {
    const items = await queryItems(`TENANT#${tenantId}`, 'SUPPRESSION#');
    return json(items);
  }

  // POST /remarketing/suppression
  if (method === 'POST' && path === '/remarketing/suppression') {
    const body = JSON.parse(event.body || '{}');
    if (!body.contactPhone) return error('contactPhone is required', 400);

    await putItem({
      ...keys.suppression(tenantId, body.contactPhone),
      tenantId,
      contactPhone: body.contactPhone,
      reason: 'manual',
      reasonDetail: body.reason || '',
      suppressedAt: new Date().toISOString(),
    });
    return json({ added: body.contactPhone }, 201);
  }

  // DELETE /remarketing/suppression/:phone
  const suppressionMatch = path.match(/^\/remarketing\/suppression\/([^/]+)$/);
  if (method === 'DELETE' && suppressionMatch) {
    const phone = decodeURIComponent(suppressionMatch[1]);

    // Solo permitir quitar si fue manual
    const existing = await getItem(keys.suppression(tenantId, phone));
    if (!existing) return error('Not found in suppression list', 404);
    if (existing.reason !== 'manual') {
      return error(`Cannot remove suppression with reason: ${existing.reason}. Only manual suppressions can be removed.`, 403);
    }

    await deleteItem(keys.suppression(tenantId, phone));
    return json({ removed: phone });
  }

  return error('Not found', 404);
}

// ============================================================
// Variant generation with Haiku (inline, no separate service dep)
// ============================================================
async function generateVariantsWithHaiku(args: {
  businessName: string;
  campaignType: string;
  examplePlaceholders: { nombre: string; producto: string };
}): Promise<any[]> {
  const anthropic = new Anthropic();

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Genera 5 variantes de mensaje de remarketing para WhatsApp.

Contexto:
- Negocio: ${args.businessName}
- Tipo de campana: ${args.campaignType}
- Ejemplo de variables: nombre="${args.examplePlaceholders.nombre}", producto="${args.examplePlaceholders.producto}"

Reglas:
- Cada variante con tono argentino casual.
- Usar {nombre} y {producto} como placeholders.
- Cada variante con al menos 60% de palabras DISTINTAS a las otras.
- Variar el largo: algunas cortas (10-15 palabras), otras mas largas (25-30).
- Emoji opcional, max 1 por variante. NO todos con emoji.
- Sin signos de apertura (¡ ¿). Solo cierre (! ?).
- Que suene humano, no robotico.
- NO usar la palabra "bot".

Devuelve SOLO JSON valido: { "variants": [{ "id": "v1", "text": "..." }, { "id": "v2", "text": "..." }, { "id": "v3", "text": "..." }, { "id": "v4", "text": "..." }, { "id": "v5", "text": "..." }] }`,
    }],
  });

  const raw = res.content[0].type === 'text' ? res.content[0].text : '';
  const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  const parsed = JSON.parse(cleaned);
  if (!parsed.variants || parsed.variants.length < 5) {
    throw new Error(`Expected 5 variants, got ${parsed.variants?.length ?? 0}`);
  }

  return parsed.variants.slice(0, 5).map((v: any, i: number) => ({
    id: v.id || `v${i + 1}`,
    text: v.text || '',
    sentCount: 0,
    replyCount: 0,
  }));
}
