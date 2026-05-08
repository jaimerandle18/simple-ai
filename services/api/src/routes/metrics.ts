import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';

export async function handleMetrics(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  if (method === 'GET' && path === '/metrics') {
    const conversations: any[] = await queryItems(`TENANT#${tenantId}`, 'CONV#', { limit: 500 });
    const contacts: any[] = await queryItems(`TENANT#${tenantId}`, 'CONTACT#', { limit: 500 });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const convToday = conversations.filter(c => c.lastMessageAt >= todayStart);
    const convThisWeek = conversations.filter(c => c.lastMessageAt >= weekStart);
    const openConvs = conversations.filter(c => c.status === 'open');

    // Conteo de mensajes eficiente: solo de las conversaciones de hoy (máx 10)
    let msgCountToday = 0;
    let msgCountWeek = 0;
    let botMessages = 0;
    let humanMessages = 0;
    let inboundMessages = 0;
    let responseTimes: number[] = [];

    for (const conv of convToday.slice(0, 15)) {
      const msgs: any[] = await queryItems(`CONV#${conv.conversationId}`, 'MSG#', { limit: 100 });
      msgCountToday += msgs.length;

      // Analizar mensajes
      let lastInbound: string | null = null;
      for (const msg of msgs) {
        if (msg.direction === 'inbound') {
          inboundMessages++;
          lastInbound = msg.timestamp;
        } else {
          if (msg.sender === 'bot') botMessages++;
          else humanMessages++;
          // Calcular tiempo de respuesta
          if (lastInbound) {
            const diff = new Date(msg.timestamp).getTime() - new Date(lastInbound).getTime();
            if (diff > 0 && diff < 300000) responseTimes.push(diff); // max 5 min
            lastInbound = null;
          }
        }
      }
    }

    // Mensajes de la semana (solo contar, sin analizar)
    for (const conv of convThisWeek.filter(c => c.lastMessageAt < todayStart).slice(0, 20)) {
      const msgs = await queryItems(`CONV#${conv.conversationId}`, 'MSG#', { limit: 100 });
      msgCountWeek += msgs.length;
    }
    msgCountWeek += msgCountToday;

    // Tags distribution
    const tagCounts: Record<string, number> = {};
    for (const conv of conversations) {
      for (const tag of conv.tags || []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Bot vs manual
    const botAssigned = conversations.filter(c => c.assignedTo === 'bot').length;
    const humanAssigned = conversations.filter(c => c.assignedTo !== 'bot').length;

    // Contactos nuevos esta semana
    const newContactsWeek = contacts.filter(c => c.createdAt >= weekStart).length;

    // Tiempo promedio de respuesta
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 1000)
      : 0;

    return json({
      conversationsToday: convToday.length,
      conversationsThisWeek: convThisWeek.length,
      conversationsTotal: conversations.length,
      openConversations: openConvs.length,
      messagesToday: msgCountToday,
      messagesThisWeek: msgCountWeek,
      contactsTotal: contacts.length,
      newContactsWeek,
      botMessages,
      humanMessages,
      inboundMessages,
      botAssigned,
      humanAssigned,
      avgResponseTime, // en segundos
      tagCounts,
    });
  }

  return error('Not found', 404);
}
