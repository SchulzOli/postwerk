import type { Locale } from './i18n';
import { validationMessages } from './messages';
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
export function validateContent(info: ProviderInfo, content: PostContent, limits?: AccountLimits, locale: Locale = 'en'): string[] {
  const m = validationMessages[locale];
  const { text, media, options } = info.capabilities;
  const network = info.name;
  const issues: string[] = [];
  const hasText = content.text.trim().length > 0;
  const images = content.media.filter((item) => item.kind === 'image').length;
  const videos = content.media.filter((item) => item.kind === 'video').length;

  if (text.required && !hasText) issues.push(m.textEmpty);
  else if (!hasText && content.media.length === 0) issues.push(m.addTextOrMedia);

  const max = textLimit(info, content, limits);
  const length = countText(content.text, text.counter);
  if (length > max) issues.push(m.textTooLong({ length, network, max, withMedia: content.media.length > 0 && text.maxLengthWithMedia !== undefined }));

  if (media.required && content.media.length === 0) {
    issues.push(m.needsMedia({ network, kind: media.maxImages === 0 ? 'video' : media.maxVideos === 0 ? 'image' : 'either' }));
  }
  if (images > media.maxImages) issues.push(media.maxImages === 0 ? m.noImages(network) : m.tooManyImages({ network, max: media.maxImages }));
  if (videos > media.maxVideos) issues.push(media.maxVideos === 0 ? m.noVideos(network) : m.tooManyVideos({ network, max: media.maxVideos }));
  if (!media.mixed && images > 0 && videos > 0) issues.push(m.noMixing(network));
  for (const [kind, limit] of [['image', media.maxImageBytes], ['video', media.maxVideoBytes]] as const) {
    const count = limit === undefined ? 0 : content.media.filter((item) => item.kind === kind && item.size !== undefined && item.size > limit).length;
    if (count > 0) issues.push(m.fileTooBig({ network, kind, limit: formatBytes(limit!), count }));
  }

  const resolved = resolveOptions(info, content.options);
  for (const field of options) {
    const value = resolved[field.key];
    if (!value) {
      if (field.required) issues.push(m.required(field.label));
      continue;
    }
    if (field.choices && !field.choices.some((choice) => choice.value === value)) issues.push(m.invalidChoice(field.label));
    if (field.maxLength !== undefined && value.length > field.maxLength) issues.push(m.optionTooLong({ label: field.label, max: field.maxLength }));
  }
  return issues;
}

/** "1 MB", "8 MB", "1.5 GB" */
export function formatBytes(bytes: number): string {
  const [value, unit] = bytes >= 1024 ** 3 ? [bytes / 1024 ** 3, 'GB'] : bytes >= 1_000_000 ? [bytes / (1024 * 1024), 'MB'] : [bytes / 1024, 'KB'];
  return `${Number(value.toFixed(value < 10 ? 1 : 0))} ${unit}`;
}
