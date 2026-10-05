import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../src/catalog';
import { buildRequest, messageUrl, normalizeChat, telegram } from '../src/telegram';
import { ProviderError, type FormConnect, type MediaItem } from '../src/types';
import { validateContent } from '../src/validate';
import { mockFetch } from './helpers';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
const API = `https://api.telegram.org/bot${TOKEN}`;
const credentials = { botToken: TOKEN, chatId: '-1001234567890' };
const connector = telegram.connector as FormConnect<typeof credentials>;
const image = (name: string): MediaItem => ({ url: `https://cdn.example/${name}.jpg`, kind: 'image' });
const video = (name: string): MediaItem => ({ url: `https://cdn.example/${name}.mp4`, kind: 'video' });
const content = (text: string, media: MediaItem[] = []) => ({ text, media, options: {} });

const ok = (result: unknown) => ({ ok: true, result });
const fail = (status: number, description: string, extra: Record<string, unknown> = {}) => () =>
  new Response(JSON.stringify({ ok: false, error_code: status, description, ...extra }), { status });

const bot = { id: 42, is_bot: true, username: 'postwerk_bot' };
const channel = { id: -1001234567890, type: 'channel', title: 'Praxis News', username: 'praxisnews' };
const admin = { status: 'administrator', can_post_messages: true };

// mockFetch matches by prefix, so getChatMember routes come before getChat.
afterEach(() => vi.unstubAllGlobals());

function expectNoSecret(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(TOKEN);
  expect(JSON.stringify(value)).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ');
}

describe('normalizeChat', () => {
  it('accepts usernames, links and numeric ids', () => {
    expect(normalizeChat(' @praxisnews ')).toBe('@praxisnews');
    expect(normalizeChat('praxisnews')).toBe('@praxisnews');
    expect(normalizeChat('https://t.me/praxisnews')).toBe('@praxisnews');
    expect(normalizeChat('t.me/praxisnews/12')).toBe('@praxisnews');
    expect(normalizeChat('-1001234567890')).toBe('-1001234567890');
  });

  it('rejects invite links and garbage', () => {
    expect(() => normalizeChat('')).toThrow(ProviderError);
    expect(() => normalizeChat('https://t.me/+AbCdEf')).toThrow(/numeric chat id/);
    expect(() => normalizeChat('https://t.me/joinchat/AbCdEf')).toThrow(/numeric chat id/);
    expect(() => normalizeChat('no spaces allowed')).toThrow(ProviderError);
  });
});

describe('telegram connect', () => {
  it('validates the token and the chat and returns the channel', async () => {
    const calls = mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChatMember`, () => ok(admin)],
      [`POST ${API}/getChat`, () => ok(channel)],
    ]);
    const [account] = await connector.connect({ botToken: ` ${TOKEN} `, chat: 'https://t.me/praxisnews' });
    expect(account!.profile).toEqual({ externalId: '-1001234567890', handle: '@praxisnews', displayName: 'Praxis News' });
    expect(account!.credentials).toEqual({ botToken: TOKEN, chatId: '-1001234567890' });
    expect(calls[1]!.body).toEqual({ chat_id: '@praxisnews' });
    expect(calls[2]!.body).toEqual({ chat_id: -1001234567890, user_id: 42 });
    expectNoSecret(account!.profile);
  });

  it('uses the title as handle for private groups', async () => {
    mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChatMember`, () => ok({ status: 'member' })],
      [`POST ${API}/getChat`, () => ok({ id: -1009, type: 'supergroup', title: 'Team' })],
    ]);
    const [account] = await connector.connect({ botToken: TOKEN, chat: '-1009' });
    expect(account!.profile).toEqual({ externalId: '-1009', handle: 'Team', displayName: 'Team' });
  });

  it('rejects malformed tokens without calling Telegram', async () => {
    const calls = mockFetch([]);
    await expect(connector.connect({ botToken: 'not-a-token', chat: '@praxisnews' })).rejects.toThrow(/@BotFather/);
    expect(calls).toHaveLength(0);
  });

  it('explains a rejected token without flagging reauth', async () => {
    mockFetch([[`POST ${API}/getMe`, fail(401, 'Unauthorized')]]);
    const error = await connector.connect({ botToken: TOKEN, chat: '@praxisnews' }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ needsReauth: false, retryable: false });
    expect(error.message).toContain('@BotFather');
    expectNoSecret(error.message);
  });

  it('explains an unknown chat', async () => {
    mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChat`, fail(400, 'Bad Request: chat not found')],
    ]);
    await expect(connector.connect({ botToken: TOKEN, chat: '@praxisnews' })).rejects.toMatchObject({
      message: expect.stringContaining('cannot find that chat'),
      needsReauth: false,
    });
  });

  it('explains when the bot is not a member', async () => {
    mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChat`, fail(403, 'Forbidden: bot is not a member of the channel chat')],
    ]);
    await expect(connector.connect({ botToken: TOKEN, chat: '@praxisnews' })).rejects.toMatchObject({
      message: expect.stringContaining('administrator'),
      needsReauth: false,
    });
  });

  it('requires post rights in channels', async () => {
    mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChatMember`, () => ok({ status: 'administrator', can_post_messages: false })],
      [`POST ${API}/getChat`, () => ok(channel)],
    ]);
    await expect(connector.connect({ botToken: TOKEN, chat: '@praxisnews' })).rejects.toThrow(/administrator of Praxis News/);

    mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChatMember`, () => ok({ status: 'left' })],
      [`POST ${API}/getChat`, () => ok(channel)],
    ]);
    await expect(connector.connect({ botToken: TOKEN, chat: '@praxisnews' })).rejects.toThrow(/not a member/);
  });

  it('rejects private chats with people', async () => {
    mockFetch([
      [`POST ${API}/getMe`, () => ok(bot)],
      [`POST ${API}/getChat`, () => ok({ id: 7, type: 'private' })],
    ]);
    await expect(connector.connect({ botToken: TOKEN, chat: '7' })).rejects.toThrow(/channel or group/);
  });

  it('keeps network failures retryable and scrubs the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`fetch failed for ${url}`); }));
    const error = await connector.connect({ botToken: TOKEN, chat: '@praxisnews' }).catch((e) => e);
    expect(error).toMatchObject({ retryable: true });
    expectNoSecret(error.message);
  });
});

describe('telegram publish', () => {
  const sent = (message_id: number, username?: string) => () => ok({ message_id, chat: { id: -1001234567890, type: 'channel', username } });

  it('sends text with sendMessage', async () => {
    const calls = mockFetch([[`POST ${API}/sendMessage`, sent(5, 'praxisnews')]]);
    const result = await telegram.publish(credentials, content('Hello *world*'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '5', url: 'https://t.me/praxisnews/5' });
    expect(calls[0]!.body).toEqual({ chat_id: '-1001234567890', text: 'Hello *world*' });
  });

  it('has no URL for chats without a public username', async () => {
    mockFetch([[`POST ${API}/sendMessage`, sent(6)]]);
    expect(await telegram.publish(credentials, content('hi'), { idempotencyKey: 'k' })).toEqual({ remoteId: '6', url: undefined });
    expect(messageUrl(undefined, 1)).toBeUndefined();
  });

  it('sends one image with sendPhoto', async () => {
    const calls = mockFetch([[`POST ${API}/sendPhoto`, sent(7, 'praxisnews')]]);
    await telegram.publish(credentials, content('Caption', [image('a')]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toEqual({ chat_id: '-1001234567890', photo: 'https://cdn.example/a.jpg', caption: 'Caption' });
  });

  it('sends one video with sendVideo and no caption when the text is empty', async () => {
    const calls = mockFetch([[`POST ${API}/sendVideo`, sent(8)]]);
    await telegram.publish(credentials, content('  ', [video('v')]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toEqual({ chat_id: '-1001234567890', video: 'https://cdn.example/v.mp4', supports_streaming: true });
  });

  it('sends several items as a media group with the caption on the first', async () => {
    const calls = mockFetch([
      [`POST ${API}/sendMediaGroup`, () => ok([{ message_id: 10, chat: { id: 1, type: 'channel', username: 'praxisnews' } }, { message_id: 11, chat: { id: 1, type: 'channel' } }])],
    ]);
    const result = await telegram.publish(credentials, content('Album', [image('a'), video('b'), image('c')]), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '10', url: 'https://t.me/praxisnews/10' });
    expect(calls[0]!.body).toEqual({
      chat_id: '-1001234567890',
      media: [
        { type: 'photo', media: 'https://cdn.example/a.jpg', caption: 'Album' },
        { type: 'video', media: 'https://cdn.example/b.mp4', supports_streaming: true },
        { type: 'photo', media: 'https://cdn.example/c.jpg' },
      ],
    });
  });

  it('refuses more than ten items', () => {
    const media = Array.from({ length: 11 }, (_, i) => image(String(i)));
    expect(() => buildRequest('1', content('', media))).toThrow(/at most 10/);
    expect(validateContent(catalog.telegram, content('', media))).toContain('Telegram allows at most 10 images.');
  });

  it('applies the caption limit when media is attached', () => {
    expect(validateContent(catalog.telegram, content('a'.repeat(1025), [image('a')]))).toHaveLength(1);
    expect(validateContent(catalog.telegram, content('a'.repeat(4096)))).toEqual([]);
  });

  it('flags a revoked token as needing reauth', async () => {
    mockFetch([[`POST ${API}/sendMessage`, fail(401, 'Unauthorized')]]);
    const error = await telegram.publish(credentials, content('x'), { idempotencyKey: 'k' }).catch((e) => e);
    expect(error).toMatchObject({ needsReauth: true, retryable: false });
    expectNoSecret(error.message);
  });

  it('flags lost chat access as needing reauth', async () => {
    mockFetch([[`POST ${API}/sendMessage`, fail(403, 'Forbidden: bot was kicked from the channel chat')]]);
    await expect(telegram.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
    mockFetch([[`POST ${API}/sendMessage`, fail(400, 'Bad Request: chat not found')]]);
    await expect(telegram.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
  });

  it('treats rate limits and server errors as retryable', async () => {
    mockFetch([[`POST ${API}/sendMessage`, fail(429, 'Too Many Requests: retry after 5', { parameters: { retry_after: 5 } })]]);
    const error = await telegram.publish(credentials, content('x'), { idempotencyKey: 'k' }).catch((e) => e);
    expect(error).toMatchObject({ retryable: true, needsReauth: false });
    expect(error.message).toContain('retry after 5');
    mockFetch([[`POST ${API}/sendMessage`, () => new Response('Bad Gateway', { status: 502 })]]);
    await expect(telegram.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
  });

  it('explains media Telegram could not download', async () => {
    mockFetch([[`POST ${API}/sendPhoto`, fail(400, 'Bad Request: wrong file identifier/HTTP URL specified')]]);
    const error = await telegram.publish(credentials, content('x', [image('a')]), { idempotencyKey: 'k' }).catch((e) => e);
    expect(error).toMatchObject({ retryable: false, needsReauth: false });
    expect(error.message).toContain('publicly reachable');
  });

  it('treats other rejections as permanent', async () => {
    mockFetch([[`POST ${API}/sendPhoto`, fail(400, 'Bad Request: message caption is too long')]]);
    await expect(telegram.publish(credentials, content('x', [image('a')]), { idempotencyKey: 'k' })).rejects.toMatchObject({
      message: 'Telegram rejected the post: Bad Request: message caption is too long',
      retryable: false,
      needsReauth: false,
    });
  });

  it('handles ok:false responses with a 200 status', async () => {
    mockFetch([[`POST ${API}/sendMessage`, () => ({ ok: false, error_code: 400, description: 'Bad Request: message text is empty' })]]);
    await expect(telegram.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toThrow('message text is empty');
  });
});
