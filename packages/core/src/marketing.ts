/**
 * What campaigns are made of: channels, goals, and the formats of ads, print
 * pieces and spots. Pure data and checks (no database), so the browser uses
 * the same rules as the server.
 */

/** Where a campaign reaches people. Social posts are the platform's posts; the others are pieces. */
export const CHANNELS = ['social', 'search_ads', 'social_ads', 'video_ads', 'print', 'mail', 'radio', 'tv', 'cinema', 'outdoor'] as const;
export type Channel = (typeof CHANNELS)[number];

export const GOALS = ['awareness', 'traffic', 'leads', 'sales', 'event'] as const;
export type Goal = (typeof GOALS)[number];

export const CAMPAIGN_STATUSES = ['draft', 'planned', 'running', 'paused', 'done'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP'] as const;

export const PIECE_KINDS = ['ad', 'print', 'spot'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export const PIECE_STATUSES = ['draft', 'approved', 'live', 'done'] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

/** Character limits of an ad's texts (min and max count, max characters each). */
export interface TextRule {
  min: number;
  max: number;
  chars: number;
}

/** Ad formats and the platform that runs them. Limits follow the platforms' own rules. */
export const AD_FORMATS = {
  /** Google responsive search ad. */
  search: { channel: 'search_ads', platform: 'google_ads', headlines: { min: 3, max: 15, chars: 30 }, descriptions: { min: 2, max: 4, chars: 90 }, media: 'none' },
  /** Facebook and Instagram image ad. */
  social: { channel: 'social_ads', platform: 'meta_ads', headlines: { min: 1, max: 5, chars: 40 }, descriptions: { min: 1, max: 5, chars: 125 }, media: 'image' },
  /** YouTube video ad (the video comes from a spot or an upload, published on YouTube). */
  video: { channel: 'video_ads', platform: 'google_ads', headlines: { min: 1, max: 5, chars: 40 }, descriptions: { min: 1, max: 5, chars: 90 }, media: 'video' },
} as const satisfies Record<string, { channel: Channel; platform: string; headlines: TextRule; descriptions: TextRule; media: string }>;
export type AdFormat = keyof typeof AD_FORMATS;

/** Print formats in millimetres (trim size; bleed is added when rendering). */
export const PRINT_FORMATS = {
  flyer_a6: { channel: 'print', widthMm: 105, heightMm: 148 },
  flyer_a5: { channel: 'print', widthMm: 148, heightMm: 210 },
  poster_a3: { channel: 'outdoor', widthMm: 297, heightMm: 420 },
  poster_a2: { channel: 'outdoor', widthMm: 420, heightMm: 594 },
  newspaper: { channel: 'print', widthMm: 90, heightMm: 120 },
  postcard_a6: { channel: 'mail', widthMm: 148, heightMm: 105 },
  letter_a4: { channel: 'mail', widthMm: 210, heightMm: 297 },
} as const satisfies Record<string, { channel: Channel; widthMm: number; heightMm: number }>;
export type PrintFormat = keyof typeof PRINT_FORMATS;

/** Spot formats: medium, length in seconds, and where they run. */
export const SPOT_FORMATS = {
  video_6: { channel: 'video_ads', medium: 'video', seconds: 6 },
  video_15: { channel: 'video_ads', medium: 'video', seconds: 15 },
  video_30: { channel: 'video_ads', medium: 'video', seconds: 30 },
  tv_30: { channel: 'tv', medium: 'video', seconds: 30 },
  cinema_30: { channel: 'cinema', medium: 'video', seconds: 30 },
  radio_20: { channel: 'radio', medium: 'audio', seconds: 20 },
  radio_30: { channel: 'radio', medium: 'audio', seconds: 30 },
} as const satisfies Record<string, { channel: Channel; medium: 'video' | 'audio'; seconds: number }>;
export type SpotFormat = keyof typeof SPOT_FORMATS;

export const PIECE_FORMATS: Record<PieceKind, readonly string[]> = {
  ad: Object.keys(AD_FORMATS),
  print: Object.keys(PRINT_FORMATS),
  spot: Object.keys(SPOT_FORMATS),
};

export const isPieceFormat = (kind: PieceKind, format: string): boolean => PIECE_FORMATS[kind].includes(format);

/** The channel a piece runs in. */
export function pieceChannel(kind: PieceKind, format: string): Channel {
  if (kind === 'ad') return AD_FORMATS[format as AdFormat].channel;
  if (kind === 'print') return PRINT_FORMATS[format as PrintFormat].channel;
  return SPOT_FORMATS[format as SpotFormat].channel;
}

// ------------------------------------------------------------------ contents

export interface AdContent {
  headlines: string[];
  descriptions: string[];
  /** Where the ad leads. */
  finalUrl: string;
  callToAction: string;
  /** Social ads: the picture (an upload). */
  imageMediaId?: string;
  /** Video ads: the spot the video comes from, and its YouTube video once published there. */
  spotId?: string;
  youtubeVideoId?: string;
}

export interface PrintContent {
  headline: string;
  body: string;
  callToAction: string;
  /** A picture (an upload) besides the brand character. */
  imageMediaId?: string;
  showCharacter: boolean;
  showLogo: boolean;
  showContact: boolean;
  /** A QR code to this address. */
  qrUrl: string;
  /** Newspaper ads: the size the paper sold. */
  widthMm?: number;
  heightMm?: number;
}

export interface SpotScene {
  seconds: number;
  /** What we see (empty for radio). */
  visual: string;
  /** What is said. */
  voiceOver: string;
  onScreenText: string;
  /** Music and sound effects. */
  sound: string;
  /** The brand character appears or speaks. */
  character: boolean;
}

export interface SpotContent {
  scenes: SpotScene[];
  /** Notes for the producer: music, voice, pace. */
  directions: string;
  /** The produced file (an upload), once it exists. */
  fileMediaId?: string;
  /** The produced video on YouTube, for video ads. */
  youtubeVideoId?: string;
  /** The post that uploaded it to YouTube from here, while it goes out. */
  youtubePostId?: string;
}

export type PieceContent = AdContent | PrintContent | SpotContent;

/** A new piece's starting content. */
export function emptyContent(kind: PieceKind, format: string): PieceContent {
  if (kind === 'ad') return { headlines: [], descriptions: [], finalUrl: '', callToAction: '' } satisfies AdContent;
  if (kind === 'print') {
    const size = format === 'newspaper' ? { widthMm: PRINT_FORMATS.newspaper.widthMm, heightMm: PRINT_FORMATS.newspaper.heightMm } : {};
    return { headline: '', body: '', callToAction: '', showCharacter: true, showLogo: true, showContact: true, qrUrl: '', ...size } satisfies PrintContent;
  }
  const { seconds } = SPOT_FORMATS[format as SpotFormat];
  // A first and a last scene to start from: the hook and the end card.
  return {
    scenes: [
      { seconds: Math.max(2, seconds - 3), visual: '', voiceOver: '', onScreenText: '', sound: '', character: true },
      { seconds: Math.min(3, seconds), visual: '', voiceOver: '', onScreenText: '', sound: '', character: false },
    ],
    directions: '',
  } satisfies SpotContent;
}

// ------------------------------------------------------------------ spots

/** Words a speaker says per second at a calm, clear pace (voice-overs of ads). */
export const WORDS_PER_SECOND = 2.5;

export type SpotHint =
  | { code: 'duration'; total: number; target: number }
  | { code: 'tooFast'; scene: number; words: number; max: number }
  | { code: 'noCharacter'; name: string }
  | { code: 'noCatchphrase'; name: string; catchphrase: string }
  | { code: 'noFile' };

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Where each scene starts and ends, in seconds. */
export function spotTimecodes(scenes: Pick<SpotScene, 'seconds'>[]): { start: number; end: number }[] {
  let at = 0;
  return scenes.map((scene) => {
    const start = at;
    at += scene.seconds;
    return { start, end: at };
  });
}

/** "0:05" */
export const timecode = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * What a spot script still needs: the right length, voice-overs that can be
 * spoken in their scene, the brand character on screen (or on air) and its
 * catchphrase, and finally the produced file.
 */
export function checkSpot(format: string, content: SpotContent, character: { name: string; catchphrase: string } | null): SpotHint[] {
  const hints: SpotHint[] = [];
  const target = SPOT_FORMATS[format as SpotFormat]?.seconds;
  const total = content.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  if (target && total !== target) hints.push({ code: 'duration', total, target });
  content.scenes.forEach((scene, index) => {
    const max = Math.floor(scene.seconds * WORDS_PER_SECOND);
    const count = words(scene.voiceOver);
    if (count > max) hints.push({ code: 'tooFast', scene: index + 1, words: count, max });
  });
  if (character) {
    if (!content.scenes.some((scene) => scene.character)) hints.push({ code: 'noCharacter', name: character.name });
    const phrase = normalize(character.catchphrase);
    const spoken = content.scenes.map((scene) => normalize(`${scene.voiceOver} ${scene.onScreenText}`)).join(' ');
    if (phrase && !spoken.includes(phrase)) hints.push({ code: 'noCatchphrase', name: character.name, catchphrase: character.catchphrase });
  }
  if (!content.fileMediaId) hints.push({ code: 'noFile' });
  return hints;
}

/** A YouTube video id from a link (watch, youtu.be, shorts, embed) or the bare id; null otherwise. */
export function youtubeVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? (url.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(url.pathname)?.[1] ?? '')
        : '';
  return /^[\w-]{11}$/.test(id) ? id : null;
}

// ------------------------------------------------------------------ money

/** "1.234,50" / "1,234.50" / "1234.5" → cents; null when it is not an amount. */
export function parseMoney(input: string): number | null {
  const text = input.trim().replace(/\s|'/g, '');
  if (!text) return 0;
  if (!/^\d[\d.,]*$/.test(text)) return null;
  // The last separator followed by one or two digits is the decimal mark.
  const match = /^(.*?)[.,](\d{1,2})$/.exec(text);
  const whole = (match ? match[1]! : text).replace(/[.,]/g, '');
  const cents = match ? Number(match[2]!.padEnd(2, '0')) : 0;
  const value = Number(whole) * 100 + cents;
  return Number.isSafeInteger(value) ? value : null;
}

export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
