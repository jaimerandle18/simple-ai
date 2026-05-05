export async function api(path: string, options?: {
  method?: string;
  body?: unknown;
  tenantId?: string;
}) {
  const res = await fetch(`/api/proxy${path}`, {
    method: options?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.tenantId ? { 'x-tenant-id': options.tenantId } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `API error: ${res.status}`);
  }

  return res.json();
}
