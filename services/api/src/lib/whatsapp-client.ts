const WA_API_VERSION = 'v25.0';

function normalizePhone(phone: string): string {
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
