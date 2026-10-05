import type { TextCounter } from './types';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemeLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;

/** Mastodon counts every URL as 23 characters, regardless of its real length. */
export function mastodonLength(text: string): number {
  return graphemeLength(text.replace(URL_PATTERN, 'x'.repeat(23)));
}

// twitter-text v3: these code point ranges weigh 1, everything else 2; emoji 2; URLs 23.
const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const EMOJI = /\p{Extended_Pictographic}/u;

/** X (Twitter) weighted length; the limit is 280. */
export function xLength(text: string): number {
  let weight = 0;
  const withoutUrls = text.replace(URL_PATTERN, () => {
    weight += 23;
    return '';
  });
  for (const { segment } of segmenter.segment(withoutUrls)) {
    if (EMOJI.test(segment)) {
      weight += 2;
      continue;
    }
    for (const char of segment) {
      const code = char.codePointAt(0)!;
      weight += LIGHT_RANGES.some(([from, to]) => code >= from && code <= to) ? 1 : 2;
    }
  }
  return weight;
}

export function countText(text: string, counter: TextCounter): number {
  switch (counter) {
    case 'mastodon':
      return mastodonLength(text);
    case 'x':
      return xLength(text);
    case 'utf16':
      return text.length;
    default:
      return graphemeLength(text);
  }
}
