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

  // GET /metrics/ai — métricas de IA: costo, cache, latencia, modelos
  if (method === 'GET' && path === '/metrics/ai') {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Query turn metrics de los últimos 7 días
    const turns: any[] = await queryItems(`METRICS#${tenantId}`, 'TURN#', { limit: 1000 });

    if (turns.length === 0) {
      return json({
        totalTurns: 0, costEstimate: 0,
        latencyP50: 0, latencyP95: 0,
        cacheHitRatio: 0, modelBreakdown: {},
        channelBreakdown: {}, complexityBreakdown: {},
        turnsToday: 0, turnsThisWeek: 0,
        escalationRate: 0,
      });
    }

    // Latencia
    const latencies = turns.map(t => t.latencyMs || 0).filter(l => l > 0).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

    // Cache hit ratio (estimado desde logs)
    const totalCacheRead = turns.reduce((sum, t) => sum + (t.cacheReadTokens || 0), 0);
    const totalCacheCreate = turns.reduce((sum, t) => sum + (t.cacheCreateTokens || 0), 0);
    const cacheHitRatio = (totalCacheRead + totalCacheCreate) > 0
      ? totalCacheRead / (totalCacheRead + totalCacheCreate)
      : 0;

    // Model breakdown
    const modelBreakdown: Record<string, number> = {};
    const channelBreakdown: Record<string, number> = {};
    const complexityBreakdown: Record<string, number> = {};
    let escalatedCount = 0;
    let turnsToday = 0;

    for (const t of turns) {
      const model = t.modelUsed || 'unknown';
      modelBreakdown[model] = (modelBreakdown[model] || 0) + 1;

      const ch = t.channel || 'unknown';
      channelBreakdown[ch] = (channelBreakdown[ch] || 0) + 1;

      const cx = t.complexity || 'unknown';
      complexityBreakdown[cx] = (complexityBreakdown[cx] || 0) + 1;

      if (t.escalated) escalatedCount++;
      if (t.timestamp?.startsWith(today)) turnsToday++;
    }

    // Costo estimado (aproximación basada en modelo)
    // Haiku: ~$0.001/msg, Sonnet: ~$0.005/msg
    const haikuCount = modelBreakdown['claude-haiku-4-5-20251001'] || 0;
    const sonnetCount = modelBreakdown['claude-sonnet-4-6'] || 0;
    const costEstimate = (haikuCount * 0.001) + (sonnetCount * 0.005);

    // Latencia por día (últimos 7 días)
    const latencyByDay: Record<string, { count: number; totalMs: number }> = {};
    for (const t of turns) {
      const day = (t.timestamp || '').slice(0, 10);
      if (!day) continue;
      if (!latencyByDay[day]) latencyByDay[day] = { count: 0, totalMs: 0 };
      latencyByDay[day].count++;
      latencyByDay[day].totalMs += (t.latencyMs || 0);
    }
    const dailyStats = Object.entries(latencyByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, stats]) => ({
        day,
        turns: stats.count,
        avgLatencyMs: Math.round(stats.totalMs / stats.count),
      }));

    return json({
      totalTurns: turns.length,
      turnsToday,
      turnsThisWeek: turns.length,
      costEstimate: Math.round(costEstimate * 100) / 100,
      latencyP50: p50,
      latencyP95: p95,
      cacheHitRatio: Math.round(cacheHitRatio * 100),
      modelBreakdown,
      channelBreakdown,
      complexityBreakdown,
      escalationRate: turns.length > 0 ? Math.round((escalatedCount / turns.length) * 100) : 0,
      dailyStats,
    });
  }

  return error('Not found', 404);
}
