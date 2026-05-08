import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json, error } from './lib/response';
import { handleAuth } from './routes/auth';
import { handleTenants } from './routes/tenants';
import { handleConversations } from './routes/conversations';
import { handleAgents } from './routes/agents';
import { handleContacts } from './routes/contacts';
import { handleTest } from './routes/test';
import { handleFiles } from './routes/files';
import { handleMetrics } from './routes/metrics';
import { handleChannels } from './routes/channels';

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;

  try {
    // Health check
    if (method === 'GET' && path === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Route to handlers
    if (path.startsWith('/auth')) return handleAuth(event);
    if (path.startsWith('/tenants')) return handleTenants(event);
    if (path.startsWith('/conversations')) return handleConversations(event);
    if (path.startsWith('/agents')) return handleAgents(event);
    if (path.startsWith('/channels')) return handleChannels(event);
    if (path.startsWith('/contacts')) return handleContacts(event);
    if (path.startsWith('/metrics')) return handleMetrics(event);
    if (path.startsWith('/files')) return handleFiles(event);
    if (path.startsWith('/test')) return handleTest(event);

    return error('Not found', 404);
  } catch (err: any) {
    console.error('Unhandled error:', err);
    return error(err.message || 'Internal server error', 500);
  }
};
// v2
