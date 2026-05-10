import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
export const db = DynamoDBDocumentClient.from(client);
export const TABLE_NAME = process.env.TABLE_NAME!;

// Key builders
export const keys = {
  tenant: (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: 'META#config' }),
  user: (tenantId: string, userId: string) => ({ PK: `TENANT#${tenantId}`, SK: `USER#${userId}` }),
  channel: (tenantId: string, phoneNumberId: string) => ({ PK: `TENANT#${tenantId}`, SK: `CHANNEL#wa#${phoneNumberId}` }),
  wahaChannel: (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: 'CHANNEL#waha#main' }),
  evolutionChannel: (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: 'CHANNEL#evolution#main' }),
  conversation: (tenantId: string, convId: string) => ({ PK: `TENANT#${tenantId}`, SK: `CONV#${convId}` }),
  message: (convId: string, timestamp: string, messageId: string) => ({ PK: `CONV#${convId}`, SK: `MSG#${timestamp}#${messageId}` }),
  contact: (tenantId: string, phone: string) => ({ PK: `TENANT#${tenantId}`, SK: `CONTACT#${phone}` }),
  agent: (tenantId: string, agentType: string) => ({ PK: `TENANT#${tenantId}`, SK: `AGENT#${agentType}` }),
  subscription: (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: 'SUB#current' }),
  rule: (tenantId: string, ruleId: string) => ({ PK: `TENANT#${tenantId}`, SK: `RULE#${ruleId}` }),
};

// Generic helpers
export async function getItem(key: { PK: string; SK: string }) {
  const result = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  return result.Item;
}

export async function putItem(item: Record<string, unknown>) {
  await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function queryItems(pk: string, skPrefix?: string, options?: { indexName?: string; limit?: number; scanForward?: boolean }) {
  const params: any = {
    TableName: TABLE_NAME,
    KeyConditionExpression: skPrefix
      ? 'PK = :pk AND begins_with(SK, :sk)'
      : 'PK = :pk',
    ExpressionAttributeValues: skPrefix
      ? { ':pk': pk, ':sk': skPrefix }
      : { ':pk': pk },
    ScanIndexForward: options?.scanForward ?? false,
  };
  if (options?.indexName) params.IndexName = options.indexName;
  if (options?.limit) params.Limit = options.limit;

  const result = await db.send(new QueryCommand(params));
  return result.Items ?? [];
}

export async function queryByGSI(indexName: string, pkName: string, pkValue: string) {
  const result = await db.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: indexName,
    KeyConditionExpression: `${pkName} = :val`,
    ExpressionAttributeValues: { ':val': pkValue },
  }));
  return result.Items ?? [];
}
