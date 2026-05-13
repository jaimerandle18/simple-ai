import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json, error } from './lib/response';
import { handleAuth } from './routes/auth';
import { handleTenants } from './routes/tenants';
import { handleConversations } from './routes/conversations';
import { handleAgents, runScraper, runFullScrape } from './routes/agents';
import { handleContacts } from './routes/contacts';
import { handleTest } from './routes/test';
import { handleFiles } from './routes/files';
import { handleMetrics } from './routes/metrics';
import { handleChannels } from './routes/channels';
import { handleOnboarding } from './routes/onboarding';
import { handleGolden } from './routes/golden';
import { handleRegression } from './routes/regression';
import { handleRemarketing } from './routes/remarketing';
import { handleOnboardingV2 } from './routes/onboarding-v2';

export const handler = async (
  event: any
): Promise<any> => {
  // Async full scrape (Lambda self-invocation)
  if ((event as any).action === 'scrape-full' && (event as any).tenantId) {
    try {
      await runFullScrape((event as any).tenantId, (event as any).url);
      return { ok: true };
    } catch (err: any) {
      console.error('[SCRAPE-FULL] error:', err);
      return { ok: false, error: err.message };
    }
  }

  // EventBridge Scheduler event
  if ((event as any).action === 'scrape-run' && (event as any).tenantId) {
    try {
      const result = await runScraper((event as any).tenantId);
      console.log(`[SCRAPER-SCHEDULED] tenant=${(event as any).tenantId}`, result);
      return { ok: true, ...result };
    } catch (err: any) {
      console.error('[SCRAPER-SCHEDULED] error:', err);
      return { ok: false, error: err.message };
    }
  }

  const httpEvent = event as APIGatewayProxyEventV2;
  const path = httpEvent.requestContext.http.path;
  const method = httpEvent.requestContext.http.method;

  try {
    // Health check
    if (method === 'GET' && path === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Route to handlers
    if (path.startsWith('/auth')) return handleAuth(httpEvent);
    if (path.startsWith('/tenants')) return handleTenants(httpEvent);
    if (path.startsWith('/conversations')) return handleConversations(httpEvent);
    if (path.startsWith('/agents')) return handleAgents(httpEvent);
    if (path.startsWith('/channels')) return handleChannels(httpEvent);
    if (path.startsWith('/contacts')) return handleContacts(httpEvent);
    if (path.startsWith('/metrics')) return handleMetrics(httpEvent);
    if (path.startsWith('/onboarding/v2')) return handleOnboardingV2(httpEvent);
    if (path.startsWith('/onboarding')) return handleOnboarding(httpEvent);
    if (path.startsWith('/golden')) return handleGolden(httpEvent);
    if (path.startsWith('/regression')) return handleRegression(httpEvent);
    if (path.startsWith('/remarketing')) return handleRemarketing(httpEvent);
    if (path.startsWith('/files')) return handleFiles(httpEvent);
    if (path.startsWith('/test')) return handleTest(httpEvent);

    return error('Not found', 404);
  } catch (err: any) {
    console.error('Unhandled error:', err);
    return error(err.message || 'Internal server error', 500);
  }
};
// v2
