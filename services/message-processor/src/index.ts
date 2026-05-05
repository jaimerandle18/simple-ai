import { SQSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import OpenAI from 'openai';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);

    // Handle test messages (from /test/message endpoint)
    if (body.type === 'test_message') {
      await processTestMessage(body);
      continue;
    }

    // Handle WhatsApp webhook messages
    if (body.object === 'whatsapp_business_account') {
      await processWhatsAppMessage(body);
    }
  }
};

async function processTestMessage(body: {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
  contactName?: string;
  message: string;
}) {
  const { tenantId, conversationId, contactPhone, contactName, message } = body;
  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Create or update contact
  const contactKey = { PK: `TENANT#${tenantId}`, SK: `CONTACT#${contactPhone}` };
  const existingContact = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: contactKey }));
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...contactKey,
      phone: contactPhone,
      name: contactName || existingContact.Item?.name || contactPhone,
      tags: existingContact.Item?.tags || [],
      totalConversations: (existingContact.Item?.totalConversations || 0) + (existingContact.Item ? 0 : 1),
      lastConversationAt: now,
      createdAt: existingContact.Item?.createdAt || now,
      tenantId,
    },
  }));

  // Save inbound message
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CONV#${conversationId}`,
      SK: `MSG#${now}#${msgId}`,
      messageId: msgId,
      conversationId,
      tenantId,
      direction: 'inbound',
      sender: 'contact',
      type: 'text',
      content: message,
      timestamp: now,
    },
  }));

  // Update conversation
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `TENANT#${tenantId}`,
      SK: `CONV#${conversationId}`,
      conversationId,
      tenantId,
      contactPhone,
      contactName: contactName || contactPhone,
      status: 'open',
      tags: [],
      assignedTo: 'bot',
      unreadCount: 1,
      lastMessageAt: now,
      lastMessagePreview: message,
      createdAt: now,
    },
  }));

  // Get agent config
  const agentRes = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `TENANT#${tenantId}`, SK: 'AGENT#main' },
  }));
  const agent = agentRes.Item;

  if (!agent?.active) {
    console.log('Agent not active, skipping AI response');
    return;
  }

  // Get conversation history
  const historyRes = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `CONV#${conversationId}`, ':sk': 'MSG#' },
    ScanIndexForward: true,
    Limit: 20,
  }));

  const history = (historyRes.Items ?? []).map((item) => ({
    role: item.direction === 'inbound' ? 'user' as const : 'assistant' as const,
    content: item.content as string,
  }));

  // Call OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: agent.model || 'gpt-4o-mini',
      temperature: agent.temperature ?? 0.7,
      max_tokens: agent.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: agent.systemPrompt || 'Sos un asistente virtual amable y profesional.' },
        ...history,
      ],
    });

    const aiResponse = completion.choices[0]?.message?.content;
    if (!aiResponse) return;

    const replyNow = new Date().toISOString();
    const replyId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Save AI response
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CONV#${conversationId}`,
        SK: `MSG#${replyNow}#${replyId}`,
        messageId: replyId,
        conversationId,
        tenantId,
        direction: 'outbound',
        sender: 'bot',
        type: 'text',
        content: aiResponse,
        timestamp: replyNow,
        status: 'sent',
      },
    }));

    // Update conversation with bot reply
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `CONV#${conversationId}`,
        conversationId,
        tenantId,
        contactPhone,
        contactName: contactName || contactPhone,
        status: 'open',
        tags: [],
        assignedTo: 'bot',
        unreadCount: 0,
        lastMessageAt: replyNow,
        lastMessagePreview: aiResponse.slice(0, 100),
        createdAt: now,
      },
    }));

    console.log('AI response saved:', replyId);
  } catch (err) {
    console.error('OpenAI error:', err);
  }
}

async function processWhatsAppMessage(body: any) {
  // TODO: Sprint 2 - Full WhatsApp webhook parsing
  console.log('WhatsApp webhook received:', JSON.stringify(body, null, 2));
}
