import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

async function wahaFetch(baseUrl: string, apiKey: string, path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
    ...(options.headers as any || {}),
  };
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

const SESSION = 'default';

export async function handleChannels(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // GET /channels
  if (method === 'GET' && path === '/channels') {
    const channels = await queryItems(`TENANT#${tenantId}`, 'CHANNEL#', { limit: 10 });
    return json(channels);
  }

  // PUT /channels/whatsapp
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

  // DELETE /channels/whatsapp/:phoneNumberId
  const deleteMatch = path.match(/^\/channels\/whatsapp\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const phoneNumberId = deleteMatch[1];
    const existing = await getItem(keys.channel(tenantId, phoneNumberId));
    if (!existing) return error('Channel not found', 404);
    await putItem({ ...existing, active: false });
    return json({ ok: true });
  }

  // ─── WAHA routes ────────────────────────────────────────────

  // GET /channels/waha
  if (method === 'GET' && path === '/channels/waha') {
    const config = await getItem(keys.wahaChannel(tenantId));
    return json(config || null);
  }

  // PUT /channels/waha — crear/iniciar sesión en WAHA
  if (method === 'PUT' && path === '/channels/waha') {
    const base = (process.env.WAHA_URL || '').replace(/\/$/, '');
    const apiKey = process.env.WAHA_API_KEY || '';
    if (!base) return error('WAHA_URL no configurado', 503);

    const apiBase = (process.env.API_BASE_URL || '').replace(/\/$/, '');
    const webhookUrl = apiBase ? `${apiBase}/webhook` : '';

    const createRes = await wahaFetch(base, apiKey, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: SESSION,
        config: {
          webhooks: webhookUrl ? [{ url: webhookUrl, events: ['message'] }] : [],
        },
      }),
    });

    if (createRes.status === 422 || createRes.status === 409) {
      // Sesión ya existe — asegurarse de que esté iniciada
      await wahaFetch(base, apiKey, `/api/sessions/${SESSION}/start`, { method: 'POST' });
    } else if (!createRes.ok) {
      const err = await createRes.text();
      return error(`WAHA error (${createRes.status}): ${err}`, 502);
    }

    const now = new Date().toISOString();
    const existing = await getItem(keys.wahaChannel(tenantId));
    const channel = {
      ...keys.wahaChannel(tenantId),
      tenantId,
      platform: 'waha',
      sessionName: SESSION,
      active: true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await putItem(channel);

    // Reverse lookup: session → tenantId (para routing de webhooks)
    await putItem({
      PK: `WAHA_SESSION#${SESSION}`,
      SK: 'OWNER',
      tenantId,
      updatedAt: now,
    });

    return json(channel);
  }

  // GET /channels/waha/status
  if (method === 'GET' && path === '/channels/waha/status') {
    const base = (process.env.WAHA_URL || '').replace(/\/$/, '');
    if (!base) return json({ status: 'NOT_CONFIGURED' });

    const record = await getItem(keys.wahaChannel(tenantId));
    if (!record?.sessionName) return json({ status: 'NOT_CONFIGURED' });

    try {
      const res = await wahaFetch(base, process.env.WAHA_API_KEY || '', `/api/sessions/${SESSION}`);
      if (!res.ok) return json({ status: 'STOPPED' });
      const data: any = await res.json();
      return json({ status: data.status || 'STOPPED' });
    } catch {
      return json({ status: 'STOPPED' });
    }
  }

  // GET /channels/waha/qr
  if (method === 'GET' && path === '/channels/waha/qr') {
    const base = (process.env.WAHA_URL || '').replace(/\/$/, '');
    if (!base) return error('WAHA no configurado', 503);

    const record = await getItem(keys.wahaChannel(tenantId));
    if (!record?.sessionName) return error('Sesión no iniciada', 404);

    try {
      const res = await wahaFetch(base, process.env.WAHA_API_KEY || '', `/api/${SESSION}/auth/qr`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) return error('QR no disponible', 404);
      const data: any = await res.json();
      const b64 = data?.data;
      if (!b64) return error('QR no disponible', 404);
      const qr = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
      return json({ qr });
    } catch {
      return error('QR no disponible', 404);
    }
  }

  // DELETE /channels/waha
  if (method === 'DELETE' && path === '/channels/waha') {
    const base = (process.env.WAHA_URL || '').replace(/\/$/, '');
    const record = await getItem(keys.wahaChannel(tenantId));
    if (!record?.sessionName) return error('Sesión no encontrada', 404);

    const apiKey = process.env.WAHA_API_KEY || '';

    if (base) {
      await wahaFetch(base, apiKey, `/api/sessions/${SESSION}`, { method: 'DELETE' }).catch(() => {});
    }
    await putItem({ ...record, active: false });
    return json({ ok: true });
  }

  return error('Not found', 404);
}
