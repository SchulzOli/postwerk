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
