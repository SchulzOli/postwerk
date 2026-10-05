import type { PostMedia } from '@postwerk/db';

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i;

/**
 * The server downloads some media itself, so obviously internal targets are
 * refused. This does not resolve DNS; uploads (Phase 1) replace URL input.
 */
function isInternalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'));
}

/**
 * Parses the composer's media field: one public URL per line, optionally
 * followed by " | alt text". Uploads replace this in Phase 1.
 */
export function parseMediaLines(input: string): { media: PostMedia[]; errors: string[] } {
  const media: PostMedia[] = [];
  const errors: string[] = [];
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawUrl = '', ...alt] = trimmed.split('|');
    const url = rawUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      errors.push(`"${url}" is not a valid URL.`);
      continue;
    }
    if (parsed.protocol !== 'https:') {
      errors.push(`Media must use https: ${url}`);
      continue;
    }
    if (isInternalHost(parsed.hostname)) {
      errors.push(`Media must be on a public server: ${url}`);
      continue;
    }
    const altText = alt.join('|').trim();
    media.push({ url, kind: VIDEO_EXTENSION.test(parsed.pathname) ? 'video' : 'image', ...(altText && { altText }) });
  }
  return { media, errors };
}
