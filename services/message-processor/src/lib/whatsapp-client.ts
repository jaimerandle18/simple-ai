/**
 * Cliente para la WhatsApp Cloud API de Meta.
 */

const WA_API_VERSION = 'v25.0';

/**
 * Normaliza números argentinos: Meta manda 549XXXXXXXXXX pero
 * WhatsApp API necesita 54XXXXXXXXXX (sin el 9 de celular).
 */
function normalizePhone(phone: string): string {
  // Argentina: 549XXXXXXXXXX → 54XXXXXXXXXX
  if (phone.startsWith('549') && phone.length === 13) {
    return '54' + phone.slice(3);
  }
  return phone;
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  recipientPhone: string,
  text: string,
): Promise<{ messageId: string }> {
  const to = normalizePhone(recipientPhone);
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${err}`);
  }

  const data: any = await res.json();
  return { messageId: data.messages?.[0]?.id || '' };
}

export async function sendWhatsAppImage(
  phoneNumberId: string,
  accessToken: string,
  recipientPhone: string,
  imageUrl: string,
  caption?: string,
): Promise<void> {
  const to = normalizePhone(recipientPhone);
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: {
        link: imageUrl,
        ...(caption && { caption }),
      },
    }),
  }).catch(err => console.error('sendWhatsAppImage error:', err));
}

export async function sendWahaMessage(
  wahaUrl: string,
  apiKey: string,
  sessionName: string,
  recipientPhone: string,
  text: string,
): Promise<void> {
  const chatId = recipientPhone.includes('@') ? recipientPhone : `${recipientPhone}@c.us`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const res = await fetch(`${wahaUrl}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ chatId, text, session: sessionName }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WAHA send failed (${res.status}): ${err}`);
  }
}

export async function sendEvolutionMessage(
  evolutionUrl: string,
  apiKey: string,
  instanceName: string,
  recipientPhone: string,
  text: string,
): Promise<{ messageId: string }> {
  const url = `${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number: recipientPhone, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution API sendText error (${res.status}): ${err}`);
  }
  const data: any = await res.json();
  return { messageId: data?.key?.id || `evo_${Date.now()}` };
}

export async function markAsRead(
  phoneNumberId: string,
  accessToken: string,
  waMessageId: string,
): Promise<void> {
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    }),
  }).catch(err => console.error('markAsRead error:', err));
}
