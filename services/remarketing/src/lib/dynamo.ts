import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
export const db = DynamoDBDocumentClient.from(client);
export const TABLE_NAME = process.env.TABLE_NAME!;

// ============================================================
// Key builders
// ============================================================
export const keys = {
  // Remarketing-specific
  campaign: (tenantId: string, campaignId: string) => ({
    PK: `TENANT#${tenantId}`, SK: `CAMPAIGN#${campaignId}`,
  }),
  campaignSend: (campaignId: string, ts: string, phone: string) => ({
    PK: `CAMPAIGN_SEND#${campaignId}`, SK: `${ts}#${phone}`,
  }),
  numberHealth: (tenantId: string) => ({
    PK: `TENANT#${tenantId}`, SK: 'WAHA_NUMBER_HEALTH',
  }),
  suppression: (tenantId: string, phone: string) => ({
    PK: `TENANT#${tenantId}`, SK: `SUPPRESSION#${phone}`,
  }),
  remarketingMsg: (tenantId: string, phone: string, ts: string) => ({
    PK: `TENANT#${tenantId}#CONTACT#${phone}`, SK: `REMARKETING_MSG#${ts}`,
  }),

  // Existing keys used by remarketing
  conversation: (tenantId: string, convId: string) => ({
    PK: `TENANT#${tenantId}`, SK: `CONV#${convId}`,
  }),
  message: (convId: string, ts: string, msgId: string) => ({
    PK: `CONV#${convId}`, SK: `MSG#${ts}#${msgId}`,
  }),
  contact: (tenantId: string, phone: string) => ({
    PK: `TENANT#${tenantId}`, SK: `CONTACT#${phone}`,
  }),
  wahaChannel: (tenantId: string) => ({
    PK: `TENANT#${tenantId}`, SK: 'CHANNEL#waha#main',
  }),
  tenant: (tenantId: string) => ({
    PK: `TENANT#${tenantId}`, SK: 'META#config',
  }),
};

// ============================================================
// Generic helpers (same pattern as services/api/src/lib/dynamo.ts)
// ============================================================
export async function getItem(key: { PK: string; SK: string }) {
  const result = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  return result.Item;
}

export async function putItem(item: Record<string, unknown>) {
  await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function deleteItem(key: { PK: string; SK: string }) {
  await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));
}

export async function queryItems(
  pk: string,
  skPrefix?: string,
  options?: { limit?: number; scanForward?: boolean },
) {
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
  if (options?.limit) params.Limit = options.limit;

  const result = await db.send(new QueryCommand(params));
  return result.Items ?? [];
}

/**
 * Query con paginacion completa (ignora Limit de DynamoDB, filtra en app).
 * Necesario para trigger detector que debe revisar todas las conversaciones.
 */
export async function queryAllItems(
  pk: string,
  skPrefix?: string,
): Promise<any[]> {
  const items: any[] = [];
  let lastKey: any = undefined;

  do {
    const params: any = {
      TableName: TABLE_NAME,
      KeyConditionExpression: skPrefix
        ? 'PK = :pk AND begins_with(SK, :sk)'
        : 'PK = :pk',
      ExpressionAttributeValues: skPrefix
        ? { ':pk': pk, ':sk': skPrefix }
        : { ':pk': pk },
      ScanIndexForward: false,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    };

    const result = await db.send(new QueryCommand(params));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Scan all tenants. Uses FilterExpression on SK = META#config.
 * OK para <50 tenants en Fase 1.
 */
export async function scanTenants(): Promise<any[]> {
  const items: any[] = [];
  let lastKey: any = undefined;

  do {
    const result = await db.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'META#config' },
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Atomic increment de un counter numerico.
 */
export async function incrementCounter(
  key: { PK: string; SK: string },
  field: string,
  amount: number = 1,
) {
  await db.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: key,
    UpdateExpression: `SET #f = if_not_exists(#f, :zero) + :inc`,
    ExpressionAttributeNames: { '#f': field },
    ExpressionAttributeValues: { ':inc': amount, ':zero': 0 },
  }));
}
