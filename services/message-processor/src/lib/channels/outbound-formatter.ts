/**
 * OutboundFormatter: adapta el texto de respuesta al formato de cada canal.
 *
 * El pipeline genera texto con formato "interno" (markdown-like).
 * Este módulo lo convierte al formato soportado por cada plataforma.
 */
import type { ChannelType } from './base';

export function formatOutbound(text: string, channel: ChannelType): string {
  switch (channel) {
    case 'whatsapp':
    case 'whatsapp_waha':
    case 'whatsapp_evolution':
      return formatForWhatsApp(text);

    case 'instagram':
      return formatForInstagram(text);

    case 'facebook':
      return formatForFacebook(text);

    default:
      return text;
  }
}

/**
 * WhatsApp: *bold*, _italic_, ~strike~, ```code```
 * - **bold** → *bold*
 * - Links quedan como texto plano
 * - Sin signos de apertura (¡¿)
 */
function formatForWhatsApp(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')  // [text](url) → text: url
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')             // **bold** → *bold*
    .replace(/^#{1,6}\s+/gm, '')                     // headers → plain
    .replace(/^>\s+/gm, '')                          // quotes → plain
    .replace(/¡/g, '')                               // sin signos apertura
    .replace(/¿/g, '')
    .trim();
}

/**
 * Instagram: NO soporta ningún formato.
 * - Sacar todo: bold, italic, headers, links
 * - Máx ~1000 chars
 */
function formatForInstagram(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')       // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')                // **bold** → plain
    .replace(/\*([^*]+)\*/g, '$1')                    // *italic* → plain
    .replace(/_([^_]+)_/g, '$1')                      // _italic_ → plain
    .replace(/~([^~]+)~/g, '$1')                      // ~strike~ → plain
    .replace(/```[\s\S]*?```/g, '')                    // code blocks → remove
    .replace(/`([^`]+)`/g, '$1')                      // inline code → plain
    .replace(/^#{1,6}\s+/gm, '')                      // headers
    .replace(/^>\s+/gm, '')                           // quotes
    .replace(/¡/g, '')
    .replace(/¿/g, '')
    .slice(0, 1000)
    .trim();
}

/**
 * Facebook Messenger: formato limitado.
 * - Soporta bold (no estándar, pero FB renderiza *texto*)
 * - Links se auto-detectan
 * - Máx 2000 chars
 */
function formatForFacebook(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')   // links
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')              // bold
    .replace(/^#{1,6}\s+/gm, '')                      // headers
    .replace(/^>\s+/gm, '')                           // quotes
    .replace(/¡/g, '')
    .replace(/¿/g, '')
    .slice(0, 2000)
    .trim();
}
