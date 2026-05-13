/**
 * Envio de mensajes de remarketing via WAHA.
 * Replica minima del pattern de WahaAdapter.sendText().
 */

export async function sendRemarketingMessage(args: {
  wahaUrl: string;
  apiKey: string;
  sessionName: string;
  contactPhone: string;
  text: string;
}): Promise<{ externalMessageId: string }> {
  const { wahaUrl, apiKey, sessionName, contactPhone, text } = args;
  const chatId = contactPhone.includes('@') ? contactPhone : `${contactPhone}@c.us`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const res = await fetch(`${wahaUrl}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ chatId, text, session: sessionName }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WAHA remarketing send failed (${res.status}): ${err}`);
  }

  const data: any = await res.json();
  return { externalMessageId: data.id || `waha_rmk_${Date.now()}` };
}
