import 'server-only';
import { findMedia, postMediaFromUpload } from '@postwerk/core';
import { getDb, type PostMedia } from '@postwerk/db';
import { checkMediaUrl } from './media';

const MAX_ITEMS = 35;
const MAX_ALT_TEXT = 1_500;

/** Turns the composer's media field (JSON) into a post's media, in order; uploads must belong to the workspace. */
export async function readComposerMedia(raw: string, workspaceId: string): Promise<{ media: PostMedia[]; errors: string[] }> {
  let items: unknown;
  try {
    items = raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return { media: [], errors: ['The attached media could not be read. Please attach it again.'] };
  }
  if (!Array.isArray(items)) return { media: [], errors: ['The attached media could not be read. Please attach it again.'] };
  if (items.length > MAX_ITEMS) return { media: [], errors: [`Attach at most ${MAX_ITEMS} files.`] };

  const entries = items.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}));
  const ids = entries.flatMap((item) => (typeof item.id === 'string' ? [item.id] : []));
  const uploads = await findMedia(getDb(), workspaceId, ids);
  const media: PostMedia[] = [];
  const errors: string[] = [];
  for (const item of entries) {
    const altText = typeof item.altText === 'string' ? item.altText.trim().slice(0, MAX_ALT_TEXT) : '';
    if (typeof item.id === 'string') {
      const row = uploads.get(item.id);
      if (row) media.push(postMediaFromUpload(row, altText));
      else errors.push('An uploaded file is missing. Remove it and upload it again.');
    } else if (typeof item.url === 'string') {
      const checked = checkMediaUrl(item.url);
      if ('error' in checked) errors.push(checked.error);
      else media.push({ ...checked.media, ...(altText && { altText }) });
    }
  }
  return { media, errors };
}
