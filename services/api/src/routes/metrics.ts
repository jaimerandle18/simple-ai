import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

export async function handleMetrics(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // GET /metrics — get dashboard metrics
  if (method === 'GET' && path === '/metrics') {
    const conversations = await queryItems(`TENANT#${tenantId}`, 'CONV#', { limit: 500 });
    const contacts = await queryItems(`TENANT#${tenantId}`, 'CONTACT#', { limit: 500 });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const convToday = conversations.filter((c: any) => c.lastMessageAt >= todayStart);
    const convThisWeek = conversations.filter((c: any) => c.lastMessageAt >= weekStart);
    const openConversations = conversations.filter((c: any) => c.status === 'open');

    // Count messages for recent conversations
    let totalMessagesToday = 0;
    let totalMessagesWeek = 0;
    for (const conv of convToday.slice(0, 20)) {
      const msgs = await queryItems(`CONV#${(conv as any).conversationId}`, 'MSG#');
      totalMessagesToday += msgs.length;
    }
    for (const conv of convThisWeek.slice(0, 50)) {
      const msgs = await queryItems(`CONV#${(conv as any).conversationId}`, 'MSG#');
      totalMessagesWeek += msgs.length;
    }

    return json({
      conversationsToday: convToday.length,
      conversationsThisWeek: convThisWeek.length,
      conversationsTotal: conversations.length,
      openConversations: openConversations.length,
      messagesToday: totalMessagesToday,
      messagesThisWeek: totalMessagesWeek,
      contactsTotal: contacts.length,
    });
  }

  return error('Not found', 404);
}
