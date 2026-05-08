export function cleanMarkdownForWhatsApp(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')  // [text](url) → text: url
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')             // **bold** → *bold*
    .replace(/^#{1,6}\s+/gm, '')                     // headers
    .replace(/^>\s+/gm, '')                          // quotes
    .trim();
}
