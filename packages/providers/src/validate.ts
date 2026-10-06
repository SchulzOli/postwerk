import { countText } from './text';
import type { AccountLimits, PostContent, ProviderInfo } from './types';

/** Effective text limit for a post (media can lower it, accounts can raise it). */
export function textLimit(info: ProviderInfo, content: Pick<PostContent, 'media'>, limits?: AccountLimits): number {
  const { text } = info.capabilities;
  if (content.media.length > 0 && text.maxLengthWithMedia !== undefined) return text.maxLengthWithMedia;
  return limits?.maxLength ?? text.maxLength;
}

/** Option values with defaults applied. */
export function resolveOptions(info: ProviderInfo, options: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const field of info.capabilities.options) {
    const value = options[field.key]?.trim() || field.defaultValue;
    if (value) resolved[field.key] = value;
  }
  return resolved;
}

/**
 * Checks a post against a network's declared capabilities. Pure, so the
 * composer can run it in the browser; providers may add extra checks.
 */
export function validateContent(info: ProviderInfo, content: PostContent, limits?: AccountLimits): string[] {
  const { text, media, options } = info.capabilities;
  const issues: string[] = [];
  const hasText = content.text.trim().length > 0;
  const images = content.media.filter((m) => m.kind === 'image').length;
  const videos = content.media.filter((m) => m.kind === 'video').length;

  if (text.required && !hasText) issues.push('Text is empty.');
  else if (!hasText && content.media.length === 0) issues.push('Add some text or media.');

  const max = textLimit(info, content, limits);
  const length = countText(content.text, text.counter);
  if (length > max) {
    const withMedia = content.media.length > 0 && text.maxLengthWithMedia !== undefined ? ' with media' : '';
    issues.push(`Text is ${length} characters; ${info.name} allows ${max}${withMedia}.`);
  }

  if (media.required && content.media.length === 0) {
    issues.push(`${info.name} needs ${media.maxImages === 0 ? 'a video' : media.maxVideos === 0 ? 'an image' : 'an image or video'}.`);
  }
  if (images > media.maxImages) {
    issues.push(media.maxImages === 0 ? `${info.name} does not support images.` : `${info.name} allows at most ${media.maxImages} image${media.maxImages === 1 ? '' : 's'}.`);
  }
  if (videos > media.maxVideos) {
    issues.push(media.maxVideos === 0 ? `${info.name} does not support videos.` : `${info.name} allows at most ${media.maxVideos} video${media.maxVideos === 1 ? '' : 's'}.`);
  }
  if (!media.mixed && images > 0 && videos > 0) issues.push(`${info.name} cannot combine images and videos in one post.`);
  for (const [kind, limit] of [['image', media.maxImageBytes], ['video', media.maxVideoBytes]] as const) {
    const tooBig = limit === undefined ? 0 : content.media.filter((item) => item.kind === kind && item.size !== undefined && item.size > limit).length;
    if (tooBig > 0) issues.push(`${info.name} accepts ${kind}s up to ${formatBytes(limit!)}; ${tooBig === 1 ? `one ${kind} is` : `${tooBig} ${kind}s are`} larger.`);
  }

  const resolved = resolveOptions(info, content.options);
  for (const field of options) {
    const value = resolved[field.key];
    if (!value) {
      if (field.required) issues.push(`${field.label} is required.`);
      continue;
    }
    if (field.choices && !field.choices.some((choice) => choice.value === value)) issues.push(`${field.label} has an invalid value.`);
    if (field.maxLength !== undefined && value.length > field.maxLength) issues.push(`${field.label} is longer than ${field.maxLength} characters.`);
  }
  return issues;
}

/** "1 MB", "8 MB", "1.5 GB" */
export function formatBytes(bytes: number): string {
  const [value, unit] = bytes >= 1024 ** 3 ? [bytes / 1024 ** 3, 'GB'] : bytes >= 1_000_000 ? [bytes / (1024 * 1024), 'MB'] : [bytes / 1024, 'KB'];
  return `${Number(value.toFixed(value < 10 ? 1 : 0))} ${unit}`;
}
