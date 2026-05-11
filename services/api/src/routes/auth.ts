import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomUUID, createHash } from 'crypto';
import { keys, getItem, putItem, queryByGSI } from '../lib/dynamo';
import { json, error } from '../lib/response';

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function handleAuth(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;

  // POST /auth/login — called after NextAuth login to sync user/tenant
  if (method === 'POST' && path === '/auth/login') {
    const body = JSON.parse(event.body || '{}');
    const { email, name, image, provider } = body;

    if (!email) return error('Email is required');

    // Check if user exists by email (GSI lookup)
    const existing = await queryByGSI('byEmail', 'email', email);

    if (existing.length > 0) {
      // User exists — update last login
      const user = existing[0];
      const tenantData = await getItem(keys.tenant(user.tenantId as string));

      return json({
        user: { ...user, lastLoginAt: new Date().toISOString() },
        tenant: tenantData,
        isNew: false,
      });
    }

    // New user — create tenant + user + default agent + trial subscription
    const tenantId = randomUUID();
    const userId = randomUUID();
    const now = new Date().toISOString();

    const tenant = {
      ...keys.tenant(tenantId),
      tenantId,
      name: name || email.split('@')[0],
      email,
      plan: 'free',
      status: 'active',
      onboardingCompleted: false,
      createdAt: now,
      updatedAt: now,
    };

    const user = {
      ...keys.user(tenantId, userId),
      userId,
      tenantId,
      email,
      name: name || '',
      avatarUrl: image || '',
      role: 'owner',
      authProvider: provider || 'google',
      lastLoginAt: now,
      createdAt: now,
    };

    const agent = {
      ...keys.agent(tenantId, 'main'),
      tenantId,
      agentType: 'main',
      systemPrompt: 'Sos un asistente virtual amable y profesional. Respondé las consultas de los clientes de forma clara y concisa.',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      attachedFiles: [],
      active: true,
      updatedAt: now,
    };

    const subscription = {
      ...keys.subscription(tenantId),
      tenantId,
      plan: 'free',
      status: 'trial',
      messagesUsed: 0,
      messagesLimit: 100,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
    };

    await Promise.all([
      putItem(tenant),
      putItem(user),
      putItem(agent),
      putItem(subscription),
    ]);

    return json({ user, tenant, isNew: true }, 201);
  }

  // POST /auth/credentials — login con email + password
  if (method === 'POST' && path === '/auth/credentials') {
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    if (!email || !password) return error('Email y contraseña requeridos', 400);

    const existing = await queryByGSI('byEmail', 'email', email);
    const user = existing.find((r: any) => (r.SK as string).startsWith('USER#'));
    if (!user || !user.passwordHash) return error('Credenciales inválidas', 401);
    if (user.passwordHash !== hashPassword(password)) return error('Credenciales inválidas', 401);

    const tenantData = await getItem(keys.tenant(user.tenantId as string));
    return json({ user, tenant: tenantData, isNew: false });
  }

  return error('Not found', 404);
}
