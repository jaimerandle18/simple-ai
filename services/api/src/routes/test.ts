import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';
import { json, error } from '../lib/response';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.INCOMING_MESSAGES_QUEUE_URL;

export async function handleTest(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;

  // POST /test/message — simulate an incoming message
  if (method === 'POST' && path === '/test/message') {
    if (!QUEUE_URL) return error('Queue URL not configured', 500);

    const body = JSON.parse(event.body || '{}');
    const { tenantId, contactPhone, contactName, message, conversationId } = body;

    if (!tenantId || !message) return error('tenantId and message are required');

    const convId = conversationId || `conv_${randomUUID()}`;

    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        type: 'test_message',
        tenantId,
        conversationId: convId,
        contactPhone: contactPhone || '+5491100000000',
        contactName: contactName || 'Test User',
        message,
      }),
    }));

    return json({ conversationId: convId, status: 'queued' });
  }

  return error('Not found', 404);
}
