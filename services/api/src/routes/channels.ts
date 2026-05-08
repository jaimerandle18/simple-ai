import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

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
      channelExternalId: phoneNumberId, // para el GSI byChannelExternalId
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

  return error('Not found', 404);
}
