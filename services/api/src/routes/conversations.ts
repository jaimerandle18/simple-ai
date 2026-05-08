import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem, queryItems } from '../lib/dynamo';
import { json, error } from '../lib/response';
import { sendWhatsAppMessage } from '../lib/whatsapp-client';

export async function handleConversations(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // GET /conversations/tags — listar tags en uso
  if (method === 'GET' && path === '/conversations/tags') {
    const conversations: any[] = await queryItems(`TENANT#${tenantId}`, 'CONV#', { limit: 500 });
    const tagSet = new Set<string>();
    for (const conv of conversations) {
      for (const tag of conv.tags || []) tagSet.add(tag);
    }
    return json([...tagSet].sort());
  }

  // GET /conversations — list conversations for tenant
  if (method === 'GET' && path === '/conversations') {
    const conversations = await queryItems(`TENANT#${tenantId}`, 'CONV#', { limit: 50 });
    return json(conversations);
  }

  // GET /conversations/:id — get conversation detail
  const convMatch = path.match(/^\/conversations\/([^/]+)$/);
  if (method === 'GET' && convMatch) {
    const convId = convMatch[1];
    const conversation = await getItem(keys.conversation(tenantId, convId));
    if (!conversation) return error('Conversation not found', 404);
    return json(conversation);
  }

  // GET /conversations/:id/messages — get messages
  const msgMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
  if (method === 'GET' && msgMatch) {
    const convId = msgMatch[1];
    const limit = parseInt(event.queryStringParameters?.limit || '50');
    const messages = await queryItems(`CONV#${convId}`, 'MSG#', { limit, scanForward: true });
    return json(messages);
  }

  // POST /conversations/:id/messages — send manual reply
  const replyMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
  if (method === 'POST' && replyMatch) {
    const convId = replyMatch[1];
    const body = JSON.parse(event.body || '{}');
    const { content } = body;

    if (!content) return error('content is required');

    const conv = await getItem(keys.conversation(tenantId, convId));
    if (!conv) return error('Conversation not found', 404);

    const now = new Date().toISOString();
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let waMessageId: string | undefined;

    // Si la conversación tiene canal de WhatsApp, enviar por WA
    if (conv.channelPhoneNumberId) {
      try {
        const channel = await getItem(keys.channel(tenantId, conv.channelPhoneNumberId as string));
        if (channel?.accessToken && channel?.active) {
          const waResult = await sendWhatsAppMessage(
            conv.channelPhoneNumberId as string,
            channel.accessToken as string,
            conv.contactPhone as string,
            content,
          );
          waMessageId = waResult.messageId;
        }
      } catch (err: any) {
        console.error('WhatsApp send error:', err.message);
        // Seguimos guardando el mensaje aunque falle el envío por WA
      }
    }

    const message = {
      PK: `CONV#${convId}`,
      SK: `MSG#${now}#${msgId}`,
      messageId: msgId,
      conversationId: convId,
      tenantId,
      direction: 'outbound',
      sender: 'user',
      type: 'text',
      content,
      waMessageId,
      timestamp: now,
      status: waMessageId ? 'sent' : 'pending',
    };

    await putItem(message);

    // Update conversation (no cambia assignedTo — lo controla el toggle)
    await putItem({
      ...conv,
      lastMessageAt: now,
      lastMessagePreview: content.slice(0, 100),
      unreadCount: 0,
    });

    return json(message, 201);
  }

  // PATCH /conversations/:id — update conversation (status, tags)
  if (method === 'PATCH' && convMatch) {
    const convId = convMatch[1];
    const conv = await getItem(keys.conversation(tenantId, convId));
    if (!conv) return error('Conversation not found', 404);

    const body = JSON.parse(event.body || '{}');
    const updated = {
      ...conv,
      ...(body.status !== undefined && { status: body.status }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
    };

    await putItem(updated);
    return json(updated);
  }

  return error('Not found', 404);
}
