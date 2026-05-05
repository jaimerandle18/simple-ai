import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem } from '../lib/dynamo';
import { json, error } from '../lib/response';

export async function handleTenants(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;

  // GET /tenants/:id
  const tenantMatch = path.match(/^\/tenants\/([^/]+)$/);
  if (method === 'GET' && tenantMatch) {
    const tenantId = tenantMatch[1];
    const tenant = await getItem(keys.tenant(tenantId));
    if (!tenant) return error('Tenant not found', 404);
    return json(tenant);
  }

  // PATCH /tenants/:id
  if (method === 'PATCH' && tenantMatch) {
    const tenantId = tenantMatch[1];
    const existing = await getItem(keys.tenant(tenantId));
    if (!existing) return error('Tenant not found', 404);

    const body = JSON.parse(event.body || '{}');
    const updated = {
      ...existing,
      ...body,
      tenantId, // prevent overwrite
      updatedAt: new Date().toISOString(),
    };
    await putItem(updated);
    return json(updated);
  }

  return error('Not found', 404);
}
