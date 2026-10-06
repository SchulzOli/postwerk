import type { PostMedia } from '@postwerk/db/types';

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i;

/** File types the upload accepts (same as the server's list). */
export const ACCEPTED_MEDIA = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The server downloads some media itself, so obviously internal targets are
 * refused. This does not resolve DNS.
 */
function isInternalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'));
}

/** Checks media added by link instead of upload: it must be a public https URL. */
export function checkMediaUrl(input: string): { media: Pick<PostMedia, 'url' | 'kind'> } | { error: string } {
  const url = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `"${url}" is not a valid link.` };
  }
  if (parsed.protocol !== 'https:') return { error: 'Links to media must start with https://.' };
  if (isInternalHost(parsed.hostname)) return { error: 'Media links must point to a public server.' };
  return { media: { url, kind: VIDEO_EXTENSION.test(parsed.pathname) ? 'video' : 'image' } };
}

/** What the composer sends for each attached file, in order. */
export type ComposerMediaInput = { id: string; altText?: string } | { url: string; altText?: string };
