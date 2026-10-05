import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarUrl, buildContent, discord, normalizeWebhookUrl } from '../src/discord';
import { ProviderError, type FormConnect, type MediaItem } from '../src/types';
import { mockFetch } from './helpers';

const TOKEN = 'aBcD_eFgH-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';
const WEBHOOK = `https://discord.com/api/webhooks/1111/${TOKEN}`;
const credentials = { webhookUrl: WEBHOOK, channelId: '2222', guildId: '3333' };
const connector = discord.connector as FormConnect<typeof credentials>;
const image = (name: string): MediaItem => ({ url: `https://cdn.example/${name}.png`, kind: 'image' });
const video = (name: string): MediaItem => ({ url: `https://cdn.example/${name}.mp4`, kind: 'video' });
const content = (text: string, media: MediaItem[] = []) => ({ text, media, options: {} });
const status = (code: number, body: unknown) => () => new Response(JSON.stringify(body), { status: code });

afterEach(() => vi.unstubAllGlobals());

function expectNoSecret(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(TOKEN);
}

describe('normalizeWebhookUrl', () => {
  it('accepts the official hosts and normalizes to discord.com', () => {
    expect(normalizeWebhookUrl(` ${WEBHOOK} `)).toBe(WEBHOOK);
    expect(normalizeWebhookUrl(`https://discordapp.com/api/webhooks/1111/${TOKEN}`)).toBe(WEBHOOK);
    expect(normalizeWebhookUrl(`https://canary.discord.com/api/webhooks/1111/${TOKEN}/`)).toBe(WEBHOOK);
    expect(normalizeWebhookUrl(`https://ptb.discord.com/api/v10/webhooks/1111/${TOKEN}?wait=true`)).toBe(WEBHOOK);
  });

  it('rejects other URLs', () => {
    expect(() => normalizeWebhookUrl('')).toThrow(ProviderError);
    expect(() => normalizeWebhookUrl('not a url')).toThrow(/Copy Webhook URL/);
    expect(() => normalizeWebhookUrl(`http://discord.com/api/webhooks/1111/${TOKEN}`)).toThrow(ProviderError);
    expect(() => normalizeWebhookUrl(`https://evil.example/api/webhooks/1111/${TOKEN}`)).toThrow(ProviderError);
    expect(() => normalizeWebhookUrl(`https://discord.com.evil.example/api/webhooks/1111/${TOKEN}`)).toThrow(ProviderError);
    expect(() => normalizeWebhookUrl('https://discord.com/channels/1/2')).toThrow(ProviderError);
    expect(() => normalizeWebhookUrl('https://discord.com/api/webhooks/1111')).toThrow(ProviderError);
  });
});

describe('discord connect', () => {
  it('reads the webhook and stores channel and guild ids', async () => {
    const calls = mockFetch([
      [`GET ${WEBHOOK}`, () => ({ type: 1, id: '1111', name: 'Postwerk', channel_id: '2222', guild_id: '3333', avatar: 'abc', token: TOKEN })],
    ]);
    const [account] = await connector.connect({ webhookUrl: `https://discordapp.com/api/webhooks/1111/${TOKEN}` });
    expect(calls[0]!.url).toBe(WEBHOOK);
    expect(account!.profile).toEqual({
      externalId: '1111',
      handle: 'Postwerk',
      displayName: 'Postwerk',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1111/abc.png',
    });
    expect(account!.credentials).toEqual(credentials);
    expectNoSecret(account!.profile);
  });

  it('works without avatar and guild', async () => {
    mockFetch([[`GET ${WEBHOOK}`, () => ({ id: '1111', name: null, channel_id: '2222', guild_id: null, avatar: null })]]);
    const [account] = await connector.connect({ webhookUrl: WEBHOOK });
    expect(account!.profile).toEqual({ externalId: '1111', handle: 'Discord webhook', displayName: 'Discord webhook', avatarUrl: undefined });
    expect(account!.credentials).toEqual({ webhookUrl: WEBHOOK, channelId: '2222' });
    expect(avatarUrl('1', undefined)).toBeUndefined();
  });

  it('rejects invalid URLs without calling Discord', async () => {
    const calls = mockFetch([]);
    await expect(connector.connect({ webhookUrl: 'https://example.com' })).rejects.toThrow(ProviderError);
    expect(calls).toHaveLength(0);
  });

  it('explains unknown or invalid webhooks as a plain error', async () => {
    for (const [code, body] of [
      [404, { message: 'Unknown Webhook', code: 10015 }],
      [401, { message: 'Invalid Webhook Token', code: 50027 }],
    ] as const) {
      mockFetch([[`GET ${WEBHOOK}`, status(code, body)]]);
      const error = await connector.connect({ webhookUrl: WEBHOOK }).catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ needsReauth: false, retryable: false });
      expect(error.message).toContain('Integrations → Webhooks');
      expectNoSecret(error.message);
    }
  });

  it('keeps network failures retryable and scrubs the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`fetch failed for ${url}`); }));
    const error = await connector.connect({ webhookUrl: WEBHOOK }).catch((e) => e);
    expect(error).toMatchObject({ retryable: true });
    expectNoSecret(error.message);
  });
});

describe('discord publish', () => {
  const posted = () => ({ id: '9999', channel_id: '2222' });

  it('posts text and waits for the message', async () => {
    const calls = mockFetch([[`POST ${WEBHOOK}`, posted]]);
    const result = await discord.publish(credentials, content('Hello'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '9999', url: 'https://discord.com/channels/3333/2222/9999' });
    expect(new URL(calls[0]!.url).searchParams.get('wait')).toBe('true');
    expect(calls[0]!.body).toEqual({ content: 'Hello' });
  });

  it('has no URL without a guild id', async () => {
    mockFetch([[`POST ${WEBHOOK}`, posted]]);
    const result = await discord.publish({ webhookUrl: WEBHOOK, channelId: '2222' }, content('Hi'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '9999', url: undefined });
  });

  it('sends images as embeds and video links in the content', async () => {
    const calls = mockFetch([[`POST ${WEBHOOK}`, posted]]);
    await discord.publish(credentials, content('Look', [image('a'), video('v'), image('b')]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toEqual({
      content: 'Look\nhttps://cdn.example/v.mp4',
      embeds: [{ image: { url: 'https://cdn.example/a.png' } }, { image: { url: 'https://cdn.example/b.png' } }],
    });
  });

  it('omits empty content for image-only posts', async () => {
    const calls = mockFetch([[`POST ${WEBHOOK}`, posted]]);
    await discord.publish(credentials, content(' ', [image('a')]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toEqual({ embeds: [{ image: { url: 'https://cdn.example/a.png' } }] });
    expect(buildContent(content('', [video('a'), video('b')]))).toBe('https://cdn.example/a.mp4\nhttps://cdn.example/b.mp4');
  });

  it('keeps text plus video links within 2000 characters', async () => {
    const long = content('a'.repeat(1990), [video('v')]);
    expect(discord.validate!(long)).toEqual(['Text plus video links is 2016 characters; Discord allows 2000.']);
    expect(discord.validate!(content('a'.repeat(1990)))).toEqual([]);
    const calls = mockFetch([]);
    await expect(discord.publish(credentials, long, { idempotencyKey: 'k' })).rejects.toThrow(/Discord allows 2000/);
    expect(calls).toHaveLength(0);
  });

  it('flags a deleted webhook as needing reauth', async () => {
    mockFetch([[`POST ${WEBHOOK}`, status(404, { message: 'Unknown Webhook', code: 10015 })]]);
    const error = await discord.publish(credentials, content('x'), { idempotencyKey: 'k' }).catch((e) => e);
    expect(error).toMatchObject({ needsReauth: true, retryable: false });
    expect(error.message).toContain('deleted');
    expectNoSecret(error.message);
  });

  it('flags a reset token as needing reauth', async () => {
    mockFetch([[`POST ${WEBHOOK}`, status(401, { message: 'Invalid Webhook Token', code: 50027 })]]);
    await expect(discord.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
  });

  it('treats rate limits and server errors as retryable', async () => {
    mockFetch([[`POST ${WEBHOOK}`, status(429, { message: 'You are being rate limited.', retry_after: 1.5, global: false })]]);
    await expect(discord.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true, needsReauth: false });
    mockFetch([[`POST ${WEBHOOK}`, () => new Response('oops', { status: 500 })]]);
    const error = await discord.publish(credentials, content('x'), { idempotencyKey: 'k' }).catch((e) => e);
    expect(error).toMatchObject({ retryable: true });
    expectNoSecret(error.message);
  });

  it('treats invalid posts as permanent', async () => {
    mockFetch([[`POST ${WEBHOOK}`, status(400, { message: 'Invalid Form Body', code: 50035 })]]);
    await expect(discord.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({
      message: 'Discord rejected the post: Invalid Form Body',
      retryable: false,
      needsReauth: false,
    });
  });
});
