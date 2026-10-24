import Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { brandKits, createDb, pieces, studioRuns, users, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { DEFAULT_BRAND_COLORS } from '../src/brand';
import { createCampaign } from '../src/campaigns';
import { errorText } from '../src/i18n';
import type { AdContent, PrintContent, SpotContent } from '../src/marketing';
import { cleanStudioRequest, draftsFrom, fitText, listStudioRuns, runStudio, studioSchema, studioSetup, studioTask, type StudioRequest } from '../src/studio';

const fail = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return errorText(error, 'en');
  }
  return 'no error';
};

const request = (overrides: Partial<StudioRequest> = {}): StudioRequest => ({ campaignId: 'c', formats: ['ad:search'], variants: 1, language: 'de', notes: '', ...overrides });
const brand = { website: 'https://praxis.example', hasCharacter: true };

describe('studio requests', () => {
  it('is on only with an API key', () => {
    expect(studioSetup({})).toBeNull();
    expect(studioSetup({ ANTHROPIC_API_KEY: 'sk' })).toEqual({ model: 'claude-opus-5-5' });
    expect(studioSetup({ ANTHROPIC_API_KEY: 'sk', AI_MODEL: 'claude-sonnet-5-5' })).toEqual({ model: 'claude-sonnet-5-5' });
  });

  it('checks what is asked for, spots first', () => {
    expect(fail(() => cleanStudioRequest(request({ formats: ['ad:banner'] })))).toMatch(/at least one format/);
    expect(fail(() => cleanStudioRequest(request({ formats: ['ad:search', 'ad:social', 'ad:video', 'print:flyer_a6', 'print:flyer_a5', 'spot:radio_20', 'posts'] })))).toMatch(/at most 6/);
    expect(fail(() => cleanStudioRequest(request({ variants: 4 })))).toMatch(/between 1 and 3/);
    expect(fail(() => cleanStudioRequest(request({ language: 'xx' })))).toMatch(/language/);
    expect(fail(() => cleanStudioRequest(request({ notes: 'x'.repeat(1001) })))).toMatch(/longer than 1000/);
    expect(cleanStudioRequest(request({ formats: ['posts', 'ad:video', 'ad:video', 'spot:video_15'] })).formats).toEqual(['spot:video_15', 'ad:video', 'posts']);
  });

  it('tells Claude each format’s rules', () => {
    expect(studioTask('ad:search', 2)).toMatch(/Write 2 Google Ads responsive search ads[\s\S]*at most 30 characters/);
    expect(studioTask('print:letter_a4', 1)).toMatch(/Write the texts for a personal letter[\s\S]*\{name\}/);
    expect(studioTask('spot:radio_30', 1)).toMatch(/exactly 30 seconds[\s\S]*visual: leave empty/);
    expect(studioTask('posts', 2)).toMatch(/Write 6 social media posts/);
    // Structured outputs: every object closed and every field required.
    const schema = studioSchema('spot:video_15') as { properties: { drafts: { items: { required: string[]; additionalProperties: boolean } } } };
    expect(schema.properties.drafts.items.required).toEqual(['title', 'scenes', 'directions']);
    expect(schema.properties.drafts.items.additionalProperties).toBe(false);
  });
});

describe('fitting drafts', () => {
  it('shortens at a word', () => {
    expect(fitText('Physiotherapie direkt am Arbeitsplatz', 30)).toBe('Physiotherapie direkt am');
    expect(fitText('  kurz  ', 30)).toBe('kurz');
    expect(fitText('Donaudampfschifffahrtsgesellschaft', 10)).toBe('Donaudampf');
  });

  it('makes ads that pass the editors’ checks', () => {
    const { pieces: [ad] } = draftsFrom(
      'ad:search',
      {
        drafts: [
          {
            title: 'Rücken entlasten',
            headlines: ['Rückenschmerzen im Büro? Wir helfen', 'Physio in Berlin', 'Physio in Berlin', 'Termin online buchen'],
            descriptions: ['Kurze Übungen fürs Büro.', 'Kostenlose Haltungsanalyse.'],
            path1: 'rücken schmerzen weg',
            path2: '/termin/',
            keywords: ['"physiotherapie berlin"', '[Rückenschmerzen]', '+physio'],
          },
          { title: 'too many', headlines: [], descriptions: [], path1: '', path2: '', keywords: [] },
        ],
      },
      1,
      brand,
    );
    const content = ad!.content as AdContent;
    expect(content.headlines).toEqual(['Rückenschmerzen im Büro? Wir', 'Physio in Berlin', 'Termin online buchen']);
    expect(content.path1).toBe('rücken');
    expect(content.path2).toBe('termin');
    expect(content.keywords).toEqual(['physiotherapie berlin', 'rückenschmerzen', 'physio']);
    expect(content.finalUrl).toBe('https://praxis.example');

    const social = draftsFrom('ad:social', { drafts: [{ title: 'Rudi', headline: 'Rudi hilft', primaryText: 'Text', callToAction: 'BOOK_NOW' }] }, 1, { website: '', hasCharacter: false }).pieces[0]!.content as AdContent;
    expect(social).toMatchObject({ headlines: ['Rudi hilft'], descriptions: ['Text'], callToAction: 'BOOK_NOW', finalUrl: '' });
  });

  it('makes spots the right length and radio without pictures', () => {
    const spot = draftsFrom(
      'spot:radio_20',
      { drafts: [{ title: 'Rudi ruft an', directions: 'Ruhig', scenes: [{ seconds: 12, visual: 'Praxis', voiceOver: 'Hallo', onScreenText: 'Text', sound: 'Telefon', character: true }, { seconds: 5, visual: '', voiceOver: 'Jetzt buchen', onScreenText: '', sound: '', character: false }] }] },
      1,
      brand,
    ).pieces[0]!.content as SpotContent;
    expect(spot.scenes.map((scene) => scene.seconds)).toEqual([12, 8]);
    expect(spot.scenes[0]).toMatchObject({ visual: '', onScreenText: '', voiceOver: 'Hallo', character: true });
  });

  it('keeps the name placeholder of letters and adds the brand’s link', () => {
    const letter = draftsFrom('print:letter_a4', { drafts: [{ title: 'Brief', headline: 'Ihr Rücken', body: 'Hallo {name},\n\nText.', callToAction: 'Termin buchen' }] }, 1, brand).pieces[0]!.content as PrintContent;
    expect(letter).toMatchObject({ body: 'Hallo {name},\n\nText.', qrUrl: 'https://praxis.example', showCharacter: true });
    expect(draftsFrom('posts', { posts: ['a', '', 'b', 'c', 'd'] }, 1, brand).postIdeas).toEqual(['a', 'b', 'c']);
  });
});

const url = process.env.TEST_DATABASE_URL;

/** Claude's streamed answer (server-sent events) with the given JSON as text. */
function sse(output: unknown, stopReason = 'end_turn', model = 'claude-opus-5-5') {
  const text = output === null ? '' : JSON.stringify(output);
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 } } }],
    ...(text
      ? [
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ]
      : []),
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 50 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

describe.skipIf(!url)('studio runs (Postgres)', () => {
  let db: Database;
  let workspace: { id: string; name: string };
  let userId: string;
  let campaignId: string;
  const calls: { headers: Headers; body: Record<string, unknown> }[] = [];
  let answer: (body: Record<string, unknown>) => Response;

  const client = () =>
    new Anthropic({
      apiKey: 'sk-test',
      maxRetries: 0,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ headers: new Headers(init?.headers), body });
        return answer(body);
      },
    });
  const setup = { model: 'claude-opus-5-5' };

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces, users CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [row] = await db.insert(workspaces).values({ name: 'Praxis' }).returning();
    userId = user!.id;
    workspace = { id: row!.id, name: row!.name };
    await db.insert(brandKits).values({ workspaceId: workspace.id, colors: DEFAULT_BRAND_COLORS, companyName: 'Praxis Rückenwind', tone: 'warm, per du', website: 'https://praxis.example', character: { name: 'Rudi', role: 'Maskottchen', look: 'Igel', personality: 'hilfsbereit', voice: 'tief', catchphrase: 'Rücken? Rudi!', rules: 'keine Witze über Schmerzen', imageMediaIds: [] } });
    const campaign = await createCampaign(db, workspace.id, userId, { name: 'Rückenwochen', goal: 'leads', status: 'planned', audience: 'Büroleute', message: 'Termin in 24 Stunden', startsOn: '2099-11-01', endsOn: '2099-11-30', currency: 'EUR', budgetCents: 0, channels: [], notes: '' });
    campaignId = campaign.id;
    calls.length = 0;
  });

  it('drafts pieces into the campaign, marked as AI drafts', async () => {
    answer = (body) => {
      const task = String((body.messages as { content: string }[])[0]!.content);
      if (task.includes('15-second')) return sse({ drafts: [{ title: 'Rudi im Büro', directions: 'Ruhig', scenes: [{ seconds: 10, visual: 'Büro', voiceOver: 'Rücken? Rudi!', onScreenText: '', sound: '', character: true }, { seconds: 5, visual: 'Logo', voiceOver: 'Jetzt buchen', onScreenText: 'praxis.example', sound: '', character: false }] }] });
      if (task.includes('video ad')) return sse({ drafts: [{ title: 'Video', headlines: ['Rudi hilft'], longHeadlines: ['Rudi hilft deinem Rücken'], descriptions: ['Termin in 24 Stunden'] }] });
      if (task.includes('social media posts')) return sse(null, 'refusal');
      return sse({ drafts: [{ title: 'Flyer', headline: 'Rücken? Rudi!', body: 'Text', callToAction: 'Termin buchen' }] });
    };
    const run = await runStudio(db, workspace, userId, { campaignId, formats: ['print:flyer_a6', 'ad:video', 'spot:video_15', 'posts'], variants: 1, language: 'de', notes: 'Neu: Abendtermine' }, { client: client(), setup });

    // One request per format, the spot first; Claude's fallback on, effort set, the brand cached.
    expect(calls).toHaveLength(4);
    const first = calls[0]!;
    expect(String(first.body.messages && (first.body.messages as { content: string }[])[0]!.content)).toMatch(/15-second/);
    expect(first.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(first.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', stream: true, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(first.body).not.toHaveProperty('temperature');
    expect(first.body).not.toHaveProperty('thinking');
    const system = first.body.system as { text: string; cache_control?: unknown }[];
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.text).toMatch(/Write every text in German[\s\S]*Rücken\? Rudi![\s\S]*Termin in 24 Stunden[\s\S]*Abendtermine/);
    expect(calls.map((call) => JSON.stringify(call.body.system))).toEqual(Array(4).fill(JSON.stringify(first.body.system)));

    const drafted = await db.select().from(pieces).where(eq(pieces.campaignId, campaignId));
    expect(drafted.map((piece) => [piece.kind, piece.format, piece.source, piece.status])).toEqual(
      expect.arrayContaining([
        ['spot', 'video_15', 'ai', 'draft'],
        ['ad', 'video', 'ai', 'draft'],
        ['print', 'flyer_a6', 'ai', 'draft'],
      ]),
    );
    const spot = drafted.find((piece) => piece.kind === 'spot')!;
    expect((drafted.find((piece) => piece.kind === 'ad')!.content as unknown as AdContent).spotId).toBe(spot.id);
    expect((drafted.find((piece) => piece.kind === 'print')!.content as unknown as PrintContent)).toMatchObject({ qrUrl: 'https://praxis.example', showCharacter: true });

    expect(run.failures).toEqual([{ format: 'posts', reason: 'refused' }]);
    expect(run.pieceIds).toHaveLength(3);
    expect(run.usage).toEqual({ inputTokens: 400, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 3200 });
    expect((await listStudioRuns(db, workspace.id))[0]).toMatchObject({ campaignName: 'Rückenwochen', run: { id: run.id } });
  });

  it('says when the key is wrong, Claude is busy, or the studio is off', async () => {
    const run = (formats = ['posts']) => runStudio(db, workspace, userId, { campaignId, formats, variants: 1, language: 'de', notes: '' }, { client: client(), setup });
    answer = () => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 });
    await expect(run()).rejects.toThrow(/did not accept the API key/);
    answer = () => Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 });
    await expect(run(['posts', 'ad:search'])).rejects.toThrow(/busy/);
    await expect(runStudio(db, workspace, userId, request({ campaignId }), { client: client(), setup: null })).rejects.toThrow(/not set up/);
    await expect(runStudio(db, workspace, userId, request({ campaignId: '00000000-0000-4000-8000-000000000000' }), { client: client(), setup })).rejects.toThrow(/no longer exists/);
    expect(await db.select().from(studioRuns)).toEqual([]);
  });
});
