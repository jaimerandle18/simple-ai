import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

async function wahaFetch(wahaUrl: string, apiKey: string, path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as any || {}) };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return fetch(`${wahaUrl}${path}`, { ...options, headers });
}

export async function handleChannels(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // GET /channels — listar canales del tenant
  if (method === 'GET' && path === '/channels') {
    const channels = await queryItems(`TENANT#${tenantId}`, 'CHANNEL#', { limit: 10 });
    return json(channels);
  }

  // PUT /channels/whatsapp — guardar/actualizar canal de WhatsApp
  if (method === 'PUT' && path === '/channels/whatsapp') {
    const body = JSON.parse(event.body || '{}');
    const { phoneNumberId, phoneNumber, displayName, accessToken, wabaId } = body;

    if (!phoneNumberId || !accessToken) {
      return error('phoneNumberId and accessToken are required');
    }

    const now = new Date().toISOString();
    const existing = await getItem(keys.channel(tenantId, phoneNumberId));

    const channel = {
      ...keys.channel(tenantId, phoneNumberId),
      tenantId,
      platform: 'whatsapp',
      phoneNumberId,
      phoneNumber: phoneNumber || existing?.phoneNumber || '',
      displayName: displayName || existing?.displayName || '',
      accessToken,
      wabaId: wabaId || existing?.wabaId || '',
      channelExternalId: phoneNumberId,
      active: true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await putItem(channel);
    return json(channel);
  }

  // DELETE /channels/whatsapp/:phoneNumberId — desactivar canal
  const deleteMatch = path.match(/^\/channels\/whatsapp\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const phoneNumberId = deleteMatch[1];
    const existing = await getItem(keys.channel(tenantId, phoneNumberId));
    if (!existing) return error('Channel not found', 404);
    await putItem({ ...existing, active: false });
    return json({ ok: true });
  }

  // ─── WAHA routes ───────────────────────────────────────────

  // GET /channels/waha — leer configuración guardada
  if (method === 'GET' && path === '/channels/waha') {
    const config = await getItem(keys.wahaChannel(tenantId));
    return json(config || null);
  }

  // PUT /channels/waha — guardar config e iniciar sesión
  if (method === 'PUT' && path === '/channels/waha') {
    const body = JSON.parse(event.body || '{}');
    const { wahaUrl, apiKey } = body;
    if (!wahaUrl) return error('wahaUrl is required');

    const base = wahaUrl.replace(/\/$/, '');
    const sessionName = `tenant_${tenantId}`;
    const apiBase = (process.env.API_BASE_URL || '').replace(/\/$/, '');
    const webhookUrl = apiBase ? `${apiBase}/webhook` : '';

    // Intentar crear/iniciar sesión en WAHA con engine NOWEB
    const sessionBody: any = { name: sessionName, engine: 'NOWEB' };
    if (webhookUrl) {
      sessionBody.config = { webhooks: [{ url: webhookUrl, events: ['message'] }] };
    }

    const res = await wahaFetch(base, apiKey || '', '/api/sessions', {
      method: 'POST',
      body: JSON.stringify(sessionBody),
    });

    // WAHA devuelve 201 si creó o 422 si ya existe — ambos son ok
    if (!res.ok && res.status !== 422 && res.status !== 409) {
      const err = await res.text();
      return error(`WAHA error (${res.status}): ${err}`, 502);
    }

    const now = new Date().toISOString();
    const channel = {
      ...keys.wahaChannel(tenantId),
      tenantId,
      platform: 'waha',
      wahaUrl: base,
      apiKey: apiKey || '',
      sessionName,
      active: true,
      createdAt: (await getItem(keys.wahaChannel(tenantId)))?.createdAt || now,
      updatedAt: now,
    };
    await putItem(channel);
    return json(channel);
  }

  // GET /channels/waha/status — estado de la sesión en WAHA
  if (method === 'GET' && path === '/channels/waha/status') {
    const config = await getItem(keys.wahaChannel(tenantId));
    if (!config?.wahaUrl) return json({ status: 'NOT_CONFIGURED' });

    try {
      const res = await wahaFetch(config.wahaUrl as string, config.apiKey as string, `/api/sessions/${config.sessionName}`);
      if (!res.ok) return json({ status: 'STOPPED' });
      const data: any = await res.json();
      return json({ status: data.status || 'STOPPED', sessionName: config.sessionName });
    } catch {
      return json({ status: 'STOPPED' });
    }
  }

  // GET /channels/waha/qr — QR code como data URL base64
  if (method === 'GET' && path === '/channels/waha/qr') {
    const config = await getItem(keys.wahaChannel(tenantId));
    if (!config?.wahaUrl) return error('WAHA not configured', 404);

    try {
      const res = await wahaFetch(config.wahaUrl as string, config.apiKey as string,
        `/api/${config.sessionName}/auth/qr`, { headers: { Accept: 'image/png' } as any });
      if (!res.ok) return error('QR not available', 404);
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      return json({ qr: `data:image/png;base64,${base64}` });
    } catch {
      return error('QR not available', 404);
    }
  }

  // DELETE /channels/waha — detener sesión y desactivar
  if (method === 'DELETE' && path === '/channels/waha') {
    const config = await getItem(keys.wahaChannel(tenantId));
    if (!config?.wahaUrl) return error('WAHA not configured', 404);

    await wahaFetch(config.wahaUrl as string, config.apiKey as string,
      `/api/sessions/${config.sessionName}`, { method: 'DELETE' }).catch(() => {});

    await putItem({ ...config, active: false });
    return json({ ok: true });
  }

  return error('Not found', 404);
}
