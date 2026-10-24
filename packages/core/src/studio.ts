/**
 * The AI studio: Claude drafts ads, print pieces, spots and ideas for social
 * posts into a campaign, in the brand's voice and with its character. It is
 * optional (on when ANTHROPIC_API_KEY is set) and separate from the manual
 * tools: drafts land as pieces marked "AI draft" that people edit and approve
 * like any other; nothing runs on its own.
 */
import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { campaigns, pieces, studioRuns, type Campaign, type Database, type Piece, type StudioFailure, type StudioRun, type StudioUsage } from '@maas/db';
import { brandBrief, getBrandKit } from './brand';
import { cleanAdContent, cleanPrintContent, cleanSpotContent, createPiece } from './campaigns';
import { LocalizedError } from './i18n';
import {
  AD_CALLS_TO_ACTION,
  AD_FORMATS,
  AD_LANGUAGES,
  KEYWORDS,
  LONG_HEADLINES,
  MAX_STUDIO_FORMATS,
  MAX_STUDIO_NOTES,
  MAX_STUDIO_VARIANTS,
  PATH_CHARS,
  POST_IDEAS_PER_VARIANT,
  PRINT_FORMATS,
  SPOT_FORMATS,
  STUDIO_FORMATS,
  WORDS_PER_SECOND,
  type AdContent,
  type AdFormat,
  type PieceContent,
  type PieceKind,
  type PrintContent,
  type PrintFormat,
  type SpotContent,
  type SpotFormat,
  type TextRule,
} from './marketing';
import { studioMessages } from './messages';

export const DEFAULT_STUDIO_MODEL = 'claude-opus-5-5';
const POST_CHARS = 280;

/** Something about a studio request the user has to fix or wait for; the message is meant for the user. */
export class StudioError extends LocalizedError {
  constructor(pick: (m: (typeof studioMessages)['en']) => string) {
    super((locale) => pick(studioMessages[locale]));
  }
}

export interface StudioSetup {
  model: string;
}

/** The studio is on when the server has an Anthropic API key; AI_MODEL picks another Claude model. */
export function studioSetup(env: Record<string, string | undefined> = process.env): StudioSetup | null {
  if (!env.ANTHROPIC_API_KEY?.trim()) return null;
  return { model: env.AI_MODEL?.trim() || DEFAULT_STUDIO_MODEL };
}

export interface StudioRequest {
  campaignId: string;
  formats: string[];
  /** Drafts per format (1–3). */
  variants: number;
  /** Language of the texts (AD_LANGUAGES). */
  language: string;
  /** Anything else Claude should know: an offer, a date, what to avoid. */
  notes: string;
}

/** Checks a studio request; throws StudioError with what to fix. */
export function cleanStudioRequest(input: StudioRequest): StudioRequest {
  const formats = [...new Set(input.formats)].filter((format) => STUDIO_FORMATS.includes(format));
  if (formats.length === 0) throw new StudioError((m) => m.chooseFormats);
  if (formats.length > MAX_STUDIO_FORMATS) throw new StudioError((m) => m.tooManyFormats(MAX_STUDIO_FORMATS));
  const variants = Number(input.variants);
  if (!Number.isInteger(variants) || variants < 1 || variants > MAX_STUDIO_VARIANTS) throw new StudioError((m) => m.variants(MAX_STUDIO_VARIANTS));
  if (!(AD_LANGUAGES as readonly string[]).includes(input.language)) throw new StudioError((m) => m.language);
  const notes = String(input.notes ?? '').trim();
  if (notes.length > MAX_STUDIO_NOTES) throw new StudioError((m) => m.notesTooLong(MAX_STUDIO_NOTES));
  // Spots before ads, so a video ad can show a video spot drafted in the same run.
  const order = (format: string) => (format.startsWith('spot:') ? 0 : format.startsWith('ad:') ? 1 : 2);
  formats.sort((a, b) => order(a) - order(b) || STUDIO_FORMATS.indexOf(a) - STUDIO_FORMATS.indexOf(b));
  return { campaignId: input.campaignId, formats, variants, language: input.language, notes };
}

// ------------------------------------------------------------------ prompts

const LANGUAGE_NAMES: Record<string, string> = { de: 'German', en: 'English', fr: 'French', it: 'Italian', es: 'Spanish', nl: 'Dutch' };

const GOAL_TEXT: Record<string, string> = {
  awareness: 'make more people know and remember the brand',
  traffic: 'bring people to the website',
  leads: 'get enquiries, sign-ups or appointments',
  sales: 'sell',
  event: 'get people to come to an event',
};

/** The same for every request, so it is cached with the brand and campaign that follow. */
export const STUDIO_RULES = `You draft marketing for one business: ads, print pieces, video and radio spots, and social media posts. A person reviews, edits and approves every draft before anything runs, so write drafts that are ready to use, not outlines.

Brand
- Write as the brand described in <brand>: its tone of voice, its do's and don'ts.
- If the brand has a character, it is the same figure everywhere: same name, look, personality and voice. Let it appear or speak where the format allows, and use its catchphrase word for word where it fits naturally. Never change the character or have it do what its rules forbid.

Facts
- Use only facts given in <brand>, <campaign> and <notes>. Do not invent prices, discounts, deadlines, awards, ratings, testimonials, statistics, guarantees or contact details. Where a piece needs one that is not given, write a placeholder in square brackets, such as [price] or [date].

Writing
- One clear message and one clear next step per piece, matching the campaign's goal.
- Concrete, plain language the audience uses. No empty phrases like "high quality" or "your partner for".
- Keep every length limit given for the format. Count characters including spaces; shorter is fine.
- Ads must pass the platforms' review: no misleading or exaggerated claims, no words in all capitals, no repeated punctuation like "!!", no emoji in ad headlines.
- When several drafts are asked for, give each a different angle (for example a benefit, a problem it solves, an offer, a feeling, the brand character), not the same idea reworded.
- Each draft gets a title for the team's overview: at most 60 characters, naming its angle, in the same language as the texts.`;

/** The brand and the campaign: shared by every request of a run. */
export function studioContext(brief: string, campaign: Pick<Campaign, 'name' | 'goal' | 'audience' | 'message' | 'startsOn' | 'endsOn'>, language: string, notes: string): string {
  const lines = [`Name: ${campaign.name}`, `Goal: ${GOAL_TEXT[campaign.goal] ?? campaign.goal}`];
  if (campaign.audience) lines.push(`Audience: ${campaign.audience}`);
  if (campaign.message) lines.push(`Key message: ${campaign.message}`);
  if (campaign.startsOn || campaign.endsOn) lines.push(`Runs: ${campaign.startsOn ?? '…'} to ${campaign.endsOn ?? '…'}`);
  return [
    `Write every text in ${LANGUAGE_NAMES[language] ?? language}. Address people the way the tone of voice says; if it says nothing, use the form most usual for this audience in that language.`,
    `<brand>\n${brief}\n</brand>`,
    `<campaign>\n${lines.join('\n')}\n</campaign>`,
    ...(notes ? [`<notes>\n${notes}\n</notes>`] : []),
  ].join('\n\n');
}

const PRINT_TASKS: Record<PrintFormat, { what: string; headline: string; body: string; cta: number }> = {
  flyer_a6: { what: 'a flyer in A6 (105 × 148 mm)', headline: 'at most 45 characters, the eye-catcher', body: 'at most 35 words', cta: 35 },
  flyer_a5: { what: 'a flyer in A5 (148 × 210 mm)', headline: 'at most 50 characters, the eye-catcher', body: 'at most 70 words, in 2 or 3 short paragraphs separated by a blank line', cta: 40 },
  poster_a3: { what: 'a poster in A3, read from a few metres away', headline: 'at most 40 characters', body: 'at most 20 words', cta: 35 },
  poster_a2: { what: 'a poster in A2, read from a few metres away', headline: 'at most 40 characters', body: 'at most 20 words', cta: 35 },
  newspaper: { what: 'a newspaper ad (about 90 × 120 mm)', headline: 'at most 40 characters', body: 'at most 35 words', cta: 35 },
  postcard_a6: {
    what: 'a postcard sent by post (A6 landscape; the headline is on the front, the body on the back beside the address)',
    headline: 'at most 45 characters',
    body: 'at most 60 words. Start with a greeting that contains the placeholder {name} for the recipient, like "Hello {name}," (without a name it is left out)',
    cta: 35,
  },
  letter_a4: {
    what: 'a personal letter sent by post (A4)',
    headline: 'the subject line, at most 80 characters',
    body: '120 to 220 words: a greeting that contains the placeholder {name} for the recipient, like "Dear {name}," (without a name it is left out), 3 or 4 short paragraphs separated by a blank line, and a sign-off with the company name. If the brand has a character, a short P.S. from it may follow',
    cta: 50,
  },
};

const SPOT_TASKS: Record<SpotFormat, { what: string; scenes: [number, number] }> = {
  video_6: { what: 'a 6-second YouTube bumper ad (it cannot be skipped)', scenes: [1, 2] },
  video_15: { what: 'a 15-second YouTube video ad', scenes: [2, 4] },
  video_30: { what: 'a 30-second YouTube video ad (people can skip it after 5 seconds)', scenes: [3, 6] },
  tv_30: { what: 'a 30-second TV commercial', scenes: [3, 6] },
  cinema_30: { what: 'a 30-second cinema commercial (big screen, full sound)', scenes: [3, 6] },
  radio_20: { what: 'a 20-second radio spot (sound only)', scenes: [2, 4] },
  radio_30: { what: 'a 30-second radio spot (sound only)', scenes: [2, 5] },
};

const rule = (r: TextRule, from: number, word: string) => `${Math.max(r.min, from)} to ${r.max} ${word}, each at most ${r.chars} characters`;

/** What to write for one format (the user turn). */
export function studioTask(format: string, variants: number): string {
  const [kind, name] = format.split(':') as [string, string];
  const count = variants === 1 ? 'one' : String(variants);
  if (format === 'posts') {
    return `Write ${variants * POST_IDEAS_PER_VARIANT} social media posts for this campaign. Each at most ${POST_CHARS} characters including hashtags, so it fits every network, with at most 3 hashtags at the end. Each post takes a different angle.`;
  }
  if (kind === 'ad' && name === 'search') {
    const r = AD_FORMATS.search;
    return [
      `Write ${count} Google Ads responsive search ${variants === 1 ? 'ad' : 'ads'}. Each ad has:`,
      `- headlines: ${rule(r.headlines, 10, 'headlines')}. Google shows any 2 or 3 of them together in any order, so each must make sense alone and none may repeat another. Put the brand name in one, the key benefit in several, and a call to action in at least two.`,
      `- descriptions: ${rule(r.descriptions, 2, 'descriptions')}, each a full sentence with a reason to click.`,
      `- path1 and path2: words for the display address (example.com/path1/path2), each at most ${PATH_CHARS} characters without spaces; join words with "-".`,
      `- keywords: 10 to 20 search phrases people type when they need this, 1 to 4 words each, lowercase, without symbols.`,
    ].join('\n');
  }
  if (kind === 'ad' && name === 'social') {
    const r = AD_FORMATS.social;
    return [
      `Write ${count} Facebook and Instagram image ${variants === 1 ? 'ad' : 'ads'}. Each ad has:`,
      `- headline: at most ${r.headlines.chars} characters, shown under the picture.`,
      `- primaryText: at most ${r.descriptions.chars} characters, shown above the picture. Only the first 125 characters show before "See more", so they must carry the message alone. Short paragraphs; at most two emoji, and only if they fit the tone.`,
      `- callToAction: the button, one of ${AD_CALLS_TO_ACTION.join(', ')}; pick what fits the goal.`,
    ].join('\n');
  }
  if (kind === 'ad' && name === 'video') {
    const r = AD_FORMATS.video;
    return [
      `Write the texts of ${count} YouTube video ${variants === 1 ? 'ad' : 'ads'} (Google Demand Gen); the video itself is the campaign's video spot. Each ad has:`,
      `- headlines: ${rule(r.headlines, 3, 'headlines')}.`,
      `- longHeadlines: ${rule(LONG_HEADLINES, 2, 'long headlines')}.`,
      `- descriptions: ${rule(r.descriptions, 2, 'descriptions')}.`,
    ].join('\n');
  }
  if (kind === 'print') {
    const task = PRINT_TASKS[name as PrintFormat];
    return [
      `Write ${count === 'one' ? 'the texts' : `${count} drafts of the texts`} for ${task.what}. Each draft has:`,
      `- headline: ${task.headline}.`,
      `- body: ${task.body}.`,
      `- callToAction: at most ${task.cta} characters, what to do next.`,
    ].join('\n');
  }
  const spot = SPOT_FORMATS[name as SpotFormat];
  const task = SPOT_TASKS[name as SpotFormat];
  const audio = spot.medium === 'audio';
  return [
    `Write ${count} ${variants === 1 ? 'script' : 'different scripts'} for ${task.what}, exactly ${spot.seconds} seconds long. Each script has:`,
    `- scenes: ${task.scenes[0]} to ${task.scenes[1]} scenes whose seconds add up to exactly ${spot.seconds}. Each scene has:`,
    `  - seconds: whole seconds.`,
    audio ? `  - visual: leave empty (radio).` : `  - visual: what we see: setting, action, camera.`,
    `  - voiceOver: what is said, by the speaker or the brand character. At most ${WORDS_PER_SECOND} words per second of the scene, so it can be spoken calmly.`,
    audio ? `  - onScreenText: leave empty (radio).` : `  - onScreenText: text shown on screen, at most 40 characters, or empty.`,
    `  - sound: music and sound effects.`,
    `  - character: true if the brand character appears or speaks in the scene.`,
    `- The first seconds must catch attention. The brand, and its character if it has one, comes early; the last scene says what to do next, with the brand name.`,
    `- directions: notes for the producer (music style, voice, pace, mood), at most 600 characters.`,
  ].join('\n');
}

// ------------------------------------------------------------------ output schemas

const str = { type: 'string' } as const;
const strings = { type: 'array', items: str } as const;
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const drafts = (properties: Record<string, unknown>) => object({ drafts: { type: 'array', items: object({ title: str, ...properties }) } });

/** The JSON schema Claude's answer follows for a format (structured outputs). */
export function studioSchema(format: string): Record<string, unknown> {
  const [kind, name] = format.split(':');
  if (format === 'posts') return object({ posts: strings });
  if (kind === 'ad' && name === 'search') return drafts({ headlines: strings, descriptions: strings, path1: str, path2: str, keywords: strings });
  if (kind === 'ad' && name === 'social') return drafts({ headline: str, primaryText: str, callToAction: { type: 'string', enum: [...AD_CALLS_TO_ACTION] } });
  if (kind === 'ad') return drafts({ headlines: strings, longHeadlines: strings, descriptions: strings });
  if (kind === 'print') return drafts({ headline: str, body: str, callToAction: str });
  const scene = object({ seconds: { type: 'integer' }, visual: str, voiceOver: str, onScreenText: str, sound: str, character: { type: 'boolean' } });
  return drafts({ scenes: { type: 'array', items: scene }, directions: str });
}

// ------------------------------------------------------------------ fitting drafts to the rules

/** Shortens a text to `max` characters at a word boundary (the limits are hard; Claude counts roughly). */
export function fitText(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/[ \t]+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
}

function fitList(values: unknown, rule: TextRule): string[] {
  const seen = new Set<string>();
  const list = Array.isArray(values) ? values : [];
  return list
    .map((value) => fitText(value, rule.chars))
    .filter((text) => text && !seen.has(text.toLowerCase()) && seen.add(text.toLowerCase()))
    .slice(0, rule.max);
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export interface StudioBrand {
  website: string;
  hasCharacter: boolean;
}

/** A draft piece: its title and content, checked by its kind's rules. */
export interface StudioDraft {
  kind: PieceKind;
  format: string;
  title: string;
  content: PieceContent;
}

/** Turns Claude's answer for a format into pieces that pass the editors' checks (or post ideas). */
export function draftsFrom(format: string, output: unknown, variants: number, brand: StudioBrand): { pieces: StudioDraft[]; postIdeas: string[] } {
  const data = record(output);
  if (format === 'posts') {
    const posts = Array.isArray(data.posts) ? data.posts : [];
    return { pieces: [], postIdeas: posts.map((post) => fitText(post, 500)).filter(Boolean).slice(0, variants * POST_IDEAS_PER_VARIANT) };
  }
  const [kind, name] = format.split(':') as [PieceKind, string];
  const link = /^https?:\/\/\S+\.\S+$/i.test(brand.website) ? brand.website : '';
  const drafted: StudioDraft[] = [];
  for (const [index, entry] of (Array.isArray(data.drafts) ? data.drafts : []).slice(0, variants).entries()) {
    const draft = record(entry);
    const title = fitText(draft.title, 60) || `${name} ${index + 1}`;
    let content: PieceContent;
    if (kind === 'ad') {
      const rules = AD_FORMATS[name as AdFormat];
      const ad: AdContent = { headlines: [], descriptions: [], finalUrl: link, callToAction: '' };
      if (name === 'social') {
        ad.headlines = fitList([draft.headline], rules.headlines);
        ad.descriptions = fitList([draft.primaryText], rules.descriptions);
        ad.callToAction = String(draft.callToAction ?? '');
      } else {
        ad.headlines = fitList(draft.headlines, rules.headlines);
        ad.descriptions = fitList(draft.descriptions, rules.descriptions);
      }
      if (name === 'search') {
        // Whole words joined by "-", as many as fit.
        const path = (value: unknown) => {
          const words = String(value ?? '').split(/[\s/-]+/).filter(Boolean);
          let joined = '';
          for (const word of words) {
            const next = joined ? `${joined}-${word}` : word;
            if (next.length > PATH_CHARS) break;
            joined = next;
          }
          return joined || (words[0] ?? '').slice(0, PATH_CHARS);
        };
        ad.path1 = path(draft.path1);
        ad.path2 = path(draft.path2);
        ad.keywords = fitList(
          (Array.isArray(draft.keywords) ? draft.keywords : []).map((keyword) => String(keyword).replace(/["[\]+]/g, '').toLowerCase()),
          KEYWORDS,
        );
      }
      if (name === 'video') ad.longHeadlines = fitList(draft.longHeadlines, LONG_HEADLINES);
      content = cleanAdContent(name, ad);
    } else if (kind === 'print') {
      const print: PrintContent = {
        headline: fitText(draft.headline, 160),
        body: String(draft.body ?? '').trim().slice(0, 4000),
        callToAction: fitText(draft.callToAction, 80),
        showCharacter: brand.hasCharacter,
        showLogo: true,
        showContact: true,
        qrUrl: link,
        ...(name === 'newspaper' && { widthMm: PRINT_FORMATS.newspaper.widthMm, heightMm: PRINT_FORMATS.newspaper.heightMm }),
      };
      content = cleanPrintContent(name, print);
    } else {
      const target = SPOT_FORMATS[name as SpotFormat].seconds;
      const scenes = (Array.isArray(draft.scenes) ? draft.scenes : []).slice(0, 20).map((value) => {
        const scene = record(value);
        return {
          seconds: Math.min(120, Math.max(1, Math.round(Number(scene.seconds)) || 1)),
          visual: fitText(scene.visual, 600),
          voiceOver: fitText(scene.voiceOver, 600),
          onScreenText: fitText(scene.onScreenText, 120),
          sound: fitText(scene.sound, 200),
          character: scene.character === true,
        };
      });
      if (scenes.length === 0) continue;
      // Make the scenes add up to the spot's length; the last one takes the difference when it can.
      const last = scenes.at(-1)!;
      const rest = scenes.reduce((sum, scene) => sum + scene.seconds, 0) - last.seconds;
      if (target - rest >= 1) last.seconds = target - rest;
      content = cleanSpotContent(name, { scenes, directions: fitText(draft.directions, 2000) } satisfies SpotContent);
    }
    drafted.push({ kind, format: name, title, content });
  }
  return { pieces: drafted, postIdeas: [] };
}

// ------------------------------------------------------------------ running

type Answer = { output: unknown; usage: StudioUsage; model: string } | { failure: string; usage: StudioUsage };

const NO_USAGE: StudioUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function addUsage(a: StudioUsage, b: StudioUsage): StudioUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens };
}

/** Asks Claude for one format. Problems with one format are answered as a failure; a wrong key stops the run. */
async function ask(client: Anthropic, model: string, context: string, format: string, variants: number): Promise<Answer> {
  try {
    const message = await client.beta.messages
      .stream({
        model,
        max_tokens: 16000,
        // Claude's own fallback model takes over if a request is declined by a safety classifier.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // The rules, brand and campaign are the same for every format of a run: cache them.
        system: [
          { type: 'text', text: STUDIO_RULES },
          { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: studioTask(format, variants) }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: studioSchema(format) } },
      })
      .finalMessage();
    const usage: StudioUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    if (message.stop_reason === 'refusal') return { failure: 'refused', usage };
    if (message.stop_reason === 'max_tokens') return { failure: 'cut', usage };
    const text = message.content.filter((block) => block.type === 'text').at(-1);
    if (!text || text.type !== 'text') return { failure: 'failed', usage };
    try {
      return { output: JSON.parse(text.text), usage, model: message.model };
    } catch {
      return { failure: 'failed', usage };
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new StudioError((m) => m.badKey);
    if (error instanceof Anthropic.RateLimitError || (error instanceof Anthropic.APIError && (error.status === 529 || error.status === 503))) return { failure: 'busy', usage: NO_USAGE };
    if (error instanceof Anthropic.APIConnectionError) return { failure: 'unreachable', usage: NO_USAGE };
    // The status and message only; the request (and the key) stay out of the log.
    console.error(`AI studio: ${format} failed:`, error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
    return { failure: 'failed', usage: NO_USAGE };
  }
}

export interface StudioOptions {
  /** A ready client (tests); otherwise one is made from ANTHROPIC_API_KEY. */
  client?: Anthropic;
  setup?: StudioSetup | null;
}

/**
 * Drafts the chosen formats into a campaign: one request per format (the
 * first alone, so the others read the cached brand), the answers fitted to
 * the formats' rules and saved as pieces marked "AI draft". Records the run.
 */
export async function runStudio(db: Database, workspace: { id: string; name: string }, userId: string, input: StudioRequest, options: StudioOptions = {}): Promise<StudioRun> {
  const setup = options.setup === undefined ? studioSetup() : options.setup;
  if (!setup) throw new StudioError((m) => m.notSetUp);
  const request = cleanStudioRequest(input);
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, request.campaignId), eq(campaigns.workspaceId, workspace.id)) });
  if (!campaign) throw new StudioError((m) => m.campaignGone);
  const kit = await getBrandKit(db, workspace);
  const context = studioContext(brandBrief(kit), campaign, request.language, request.notes);
  const client = options.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const [first, ...others] = request.formats;
  const answers = [await ask(client, setup.model, context, first!, request.variants)];
  answers.push(...(await Promise.all(others.map((format) => ask(client, setup.model, context, format, request.variants)))));

  const brand: StudioBrand = { website: kit.website, hasCharacter: Boolean(kit.character) };
  const created: Piece[] = [];
  const postIdeas: string[] = [];
  const failures: StudioFailure[] = [];
  const models = new Set<string>();
  let usage = NO_USAGE;
  for (const [index, format] of request.formats.entries()) {
    const answer = answers[index]!;
    usage = addUsage(usage, answer.usage);
    if ('failure' in answer) {
      failures.push({ format, reason: answer.failure });
      continue;
    }
    models.add(answer.model);
    let drafts: ReturnType<typeof draftsFrom>;
    try {
      drafts = draftsFrom(format, answer.output, request.variants, brand);
    } catch (error) {
      // An answer the rules still reject (rare: the schema and fitting cover the limits).
      if (!(error instanceof LocalizedError)) throw error;
      failures.push({ format, reason: 'failed' });
      continue;
    }
    if (drafts.pieces.length === 0 && drafts.postIdeas.length === 0) failures.push({ format, reason: 'failed' });
    postIdeas.push(...drafts.postIdeas);
    for (const draft of drafts.pieces) {
      // A video ad shows the first video spot drafted in this run.
      if (draft.kind === 'ad' && draft.format === 'video') {
        const spot = created.find((piece) => piece.kind === 'spot' && SPOT_FORMATS[piece.format as SpotFormat].medium === 'video');
        if (spot) (draft.content as AdContent).spotId = spot.id;
      }
      created.push(await createPiece(db, workspace.id, campaign.id, draft, 'ai'));
    }
  }

  if (created.length === 0 && postIdeas.length === 0) {
    const reasons = new Set(failures.map((failure) => failure.reason));
    if (reasons.size === 1 && reasons.has('busy')) throw new StudioError((m) => m.busy);
    if (reasons.size === 1 && reasons.has('unreachable')) throw new StudioError((m) => m.unreachable);
  }
  const [run] = await db
    .insert(studioRuns)
    .values({
      workspaceId: workspace.id,
      campaignId: campaign.id,
      formats: request.formats,
      variants: request.variants,
      language: request.language,
      notes: request.notes,
      model: models.size > 0 ? [...models].join(', ') : setup.model,
      pieceIds: created.map((piece) => piece.id),
      postIdeas,
      failures,
      usage,
      createdBy: userId,
    })
    .returning();
  return run!;
}

/** The workspace's latest studio runs, newest first, with their campaign's name and the drafts that still exist. */
export async function listStudioRuns(db: Database, workspaceId: string, limit = 10) {
  const rows = await db
    .select({ run: studioRuns, campaignName: campaigns.name })
    .from(studioRuns)
    .innerJoin(campaigns, eq(campaigns.id, studioRuns.campaignId))
    .where(eq(studioRuns.workspaceId, workspaceId))
    .orderBy(desc(studioRuns.createdAt))
    .limit(limit);
  const ids = rows.flatMap((row) => row.run.pieceIds);
  const found = ids.length
    ? await db.select({ id: pieces.id, title: pieces.title, kind: pieces.kind, format: pieces.format }).from(pieces).where(and(eq(pieces.workspaceId, workspaceId), inArray(pieces.id, ids)))
    : [];
  const byId = new Map(found.map((piece) => [piece.id, piece]));
  return rows.map((row) => ({ ...row, pieces: row.run.pieceIds.flatMap((id) => byId.get(id) ?? []) }));
}
