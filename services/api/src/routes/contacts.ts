import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

export async function handleContacts(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // GET /contacts — list contacts for tenant
  if (method === 'GET' && path === '/contacts') {
    const contacts = await queryItems(`TENANT#${tenantId}`, 'CONTACT#', { limit: 100 });
    return json(contacts);
  }

  // GET /contacts/:phone
  const contactMatch = path.match(/^\/contacts\/([^/]+)$/);
  if (method === 'GET' && contactMatch) {
    const phone = decodeURIComponent(contactMatch[1]);
    const contact = await getItem(keys.contact(tenantId, phone));
    if (!contact) return error('Contact not found', 404);
    return json(contact);
  }

  // PATCH /contacts/:phone — update contact (tags, notes, etc.)
  if (method === 'PATCH' && contactMatch) {
    const phone = decodeURIComponent(contactMatch[1]);
    const existing = await getItem(keys.contact(tenantId, phone));
    if (!existing) return error('Contact not found', 404);

    const body = JSON.parse(event.body || '{}');
    const updated = { ...existing, ...body, phone }; // prevent phone overwrite
    await putItem(updated);
    return json(updated);
  }

  return error('Not found', 404);
}
