/**
 * Descarga audio de WhatsApp y lo transcribe con Groq Whisper.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;

/**
 * Descarga un archivo multimedia de WhatsApp.
 * 1. Obtiene la URL del media con el mediaId
 * 2. Descarga el archivo binario
 */
export async function downloadWhatsAppMedia(mediaId: string, accessToken: string): Promise<Buffer> {
  // Step 1: obtener URL del media
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const metaData = await metaRes.json() as any;
  const mediaUrl = metaData.url;

  if (!mediaUrl) throw new Error(`No media URL for ${mediaId}: ${JSON.stringify(metaData)}`);

  // Step 2: descargar el archivo
  const fileRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!fileRes.ok) throw new Error(`Failed to download media: ${fileRes.status}`);

  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Transcribe audio usando Groq Whisper API.
 */
async function transcribeWithGroq(audioBuffer: Buffer, mimeType?: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

  // Determinar extensión del archivo
  const extMap: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
  };
  const ext = extMap[(mimeType || '').split(';')[0].trim()] || 'ogg';

  // Crear FormData con el archivo
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType || 'audio/ogg' });
  formData.append('file', blob, `audio.${ext}`);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'es');
  formData.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq transcription failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as any;
  return (data.text || '').trim();
}

/**
 * Pipeline completo: descarga audio de WA → transcribe con Groq.
 */
export async function transcribeWhatsAppAudio(
  mediaId: string,
  accessToken: string,
  mimeType?: string,
): Promise<string> {
  console.log(`[AUDIO] Downloading media ${mediaId}...`);
  const audioBuffer = await downloadWhatsAppMedia(mediaId, accessToken);
  console.log(`[AUDIO] Downloaded ${audioBuffer.length} bytes, transcribing with Groq...`);

  const text = await transcribeWithGroq(audioBuffer, mimeType);
  console.log(`[AUDIO] Transcribed: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);

  return text;
}
