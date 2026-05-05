import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.INCOMING_MESSAGES_QUEUE_URL!;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!;

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;

  // Webhook verification (GET)
  if (method === 'GET') {
    const params = event.queryStringParameters ?? {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return { statusCode: 200, body: challenge ?? '' };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Incoming message (POST)
  if (method === 'POST') {
    const body = event.body ? JSON.parse(event.body) : {};

    // Enqueue for async processing
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(body),
      })
    );

    return { statusCode: 200, body: 'OK' };
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
