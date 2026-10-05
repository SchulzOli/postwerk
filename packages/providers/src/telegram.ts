import { catalog } from './catalog';
import { json, requestJson } from './http';
import { ProviderError, type ConnectedAccount, type MediaItem, type PostContent, type Provider, type PublishResult } from './types';

const API = 'https://api.telegram.org';
const MAX_GROUP_ITEMS = 10;

/**
 * Telegram needs no developer app: the user creates a bot with @BotFather,
 * adds it as an administrator to their channel or group, and gives us the
 * bot token plus the chat. Telegram downloads media from the URLs itself.
 */
export interface TelegramCredentials {
  botToken: string;
  /** Numeric chat id from getChat; stays valid when the public @username changes. */
  chatId: string;
}

const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function isBotToken(value: string): boolean {
  return TOKEN_PATTERN.test(value.trim());
}

/**
 * Accepts "@channel", "channel", "https://t.me/channel" or a numeric id like "-1001234567890"
 * and returns what Telegram expects as chat_id.
 */
export function normalizeChat(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ProviderError('Please enter the channel or group: its @username or numeric id.');
  if (/^-?\d+$/.test(trimmed)) return trimmed;
  const path = trimmed.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, '').replace(/[/?#].*$/, '');
  if (path.startsWith('+') || path.toLowerCase() === 'joinchat') {
    throw new ProviderError('Invite links cannot be used. Enter the numeric chat id instead (it starts with -100…).');
  }
  const username = path.replace(/^@/, '');
  if (!USERNAME_PATTERN.test(username)) {
    throw new ProviderError(`"${trimmed}" is not a valid chat. Use the public @username or the numeric id (it starts with -100…).`);
  }
  return `@${username}`;
}

/** Public link to a message; private chats have none. */
export function messageUrl(username: string | undefined, messageId: number): string | undefined {
  return username ? `https://t.me/${username}/${messageId}` : undefined;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

interface TelegramChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  can_post_messages?: boolean;
  can_send_messages?: boolean;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

type Phase = 'connect' | 'publish';

async function call<T>(botToken: string, method: string, params: Record<string, unknown>, phase: Phase): Promise<T> {
  let response: TelegramResponse<T>;
  try {
    response = await requestJson<TelegramResponse<T>>(`${API}/bot${botToken}/${method}`, json(params));
  } catch (error) {
    throw toTelegramError(error, phase, botToken);
  }
  if (!response.ok || response.result === undefined) {
    throw telegramError(response.error_code ?? 400, response.description ?? 'unknown error', phase);
  }
  return response.result;
}

function toTelegramError(error: unknown, phase: Phase, botToken: string): ProviderError {
  const scrub = (message: string) => message.split(botToken).join('<bot token>');
  if (!(error instanceof ProviderError)) {
    return new ProviderError(`Telegram request failed: ${scrub((error as Error).message)}`, { retryable: true, cause: error });
  }
  if (error.status === undefined) {
    // Network failure or invalid JSON: keep the flags, make sure the token cannot leak.
    return new ProviderError(scrub(error.message), { retryable: error.retryable, needsReauth: error.needsReauth, cause: error });
  }
  // http.ts formats HTTP failures as "<host> responded <status>: <Telegram's description>".
  const description = /responded \d{3}: ([\s\S]*)$/.exec(error.message)?.[1] ?? error.message;
  return telegramError(error.status, scrub(description), phase);
}

/**
 * Maps Telegram's { error_code, description } to a user-facing error.
 * While connecting, every problem is something the user fixes in the form;
 * while publishing, a bad token or lost chat access means the account has to be reconnected.
 */
export function telegramError(status: number, description: string, phase: Phase): ProviderError {
  const reauth = phase === 'publish';
  const lower = description.toLowerCase();

  if (status === 401 || status === 404) {
    return reauth
      ? new ProviderError('Telegram no longer accepts the bot token (was it revoked in @BotFather?). Reconnect the account with the current token.', { needsReauth: true })
      : new ProviderError('Telegram did not accept the bot token. Copy it again from @BotFather; it looks like 123456789:AA…');
  }
  if (status === 429) return new ProviderError(`Telegram rate limit reached (${description}).`, { retryable: true });
  if (status >= 500) return new ProviderError(`Telegram is temporarily unavailable (${description}).`, { retryable: true });

  if (lower.includes('chat not found')) {
    return reauth
      ? new ProviderError('Telegram cannot find the chat anymore. Add the bot to the channel or group again and reconnect it.', { needsReauth: true })
      : new ProviderError('Telegram cannot find that chat. Check the @username or numeric id, and that the bot has been added to the channel or group.');
  }
  if (lower.includes('upgraded to a supergroup')) {
    return new ProviderError('This group was upgraded to a supergroup and has a new id. Reconnect it.', { needsReauth: reauth });
  }
  if (status === 403 || lower.includes('not enough rights') || lower.includes('have no rights')) {
    return new ProviderError(
      `The bot cannot post in this chat (Telegram says: ${description}). Add it to the channel or group as an administrator that may post messages${reauth ? ', then try again' : ''}.`,
      { needsReauth: reauth },
    );
  }
  if (lower.includes('http url') || lower.includes('wrong file identifier') || lower.includes('web page content')) {
    return new ProviderError(
      `Telegram could not download the media (${description}). Make sure the file is publicly reachable; by URL Telegram accepts photos up to 5 MB and videos up to 20 MB.`,
    );
  }
  return new ProviderError(phase === 'connect' ? `Telegram says: ${description}` : `Telegram rejected the post: ${description}`);
}

function checkMembership(member: TelegramChatMember, chat: TelegramChat): void {
  const name = chat.title ?? 'that chat';
  if (member.status === 'left' || member.status === 'kicked') {
    throw new ProviderError(`The bot is not a member of ${name}. Add it as an administrator, then try again.`);
  }
  if (chat.type === 'channel') {
    const isAdmin = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
    if (!isAdmin) throw new ProviderError(`The bot must be an administrator of ${name} with permission to post messages.`);
  } else if (member.status === 'restricted' && member.can_send_messages === false) {
    throw new ProviderError(`The bot is not allowed to send messages in ${name}. Change its permissions or make it an administrator.`);
  }
}

export async function connect(values: Record<string, string>): Promise<ConnectedAccount<TelegramCredentials>> {
  const botToken = (values.botToken ?? '').trim();
  if (!isBotToken(botToken)) throw new ProviderError('That does not look like a bot token. Copy it from @BotFather; it looks like 123456789:AA…');
  const chatInput = normalizeChat(values.chat ?? '');

  const bot = await call<TelegramUser>(botToken, 'getMe', {}, 'connect');
  const chat = await call<TelegramChat>(botToken, 'getChat', { chat_id: chatInput }, 'connect');
  if (chat.type === 'private') throw new ProviderError('That is a private chat with a person. Enter a channel or group instead.');
  const member = await call<TelegramChatMember>(botToken, 'getChatMember', { chat_id: chat.id, user_id: bot.id }, 'connect');
  checkMembership(member, chat);

  const chatId = String(chat.id);
  return {
    profile: { externalId: chatId, handle: chat.username ? `@${chat.username}` : (chat.title ?? chatId), displayName: chat.title },
    credentials: { botToken, chatId },
  };
}

function mediaType(item: MediaItem): 'photo' | 'video' {
  return item.kind === 'image' ? 'photo' : 'video';
}

/** Picks the Bot API method and parameters for a post. */
export function buildRequest(chatId: string, content: Pick<PostContent, 'text' | 'media'>): { method: string; params: Record<string, unknown> } {
  const caption = content.text.trim() ? content.text : undefined;
  const [first, ...rest] = content.media;
  if (!first) return { method: 'sendMessage', params: { chat_id: chatId, text: content.text } };
  if (rest.length === 0) {
    return first.kind === 'image'
      ? { method: 'sendPhoto', params: { chat_id: chatId, photo: first.url, caption } }
      : { method: 'sendVideo', params: { chat_id: chatId, video: first.url, caption, supports_streaming: true } };
  }
  if (content.media.length > MAX_GROUP_ITEMS) throw new ProviderError(`Telegram allows at most ${MAX_GROUP_ITEMS} media items per post.`);
  const media = content.media.map((item, index) => ({
    type: mediaType(item),
    media: item.url,
    ...(index === 0 && caption !== undefined && { caption }),
    ...(item.kind === 'video' && { supports_streaming: true }),
  }));
  return { method: 'sendMediaGroup', params: { chat_id: chatId, media } };
}

export const telegram: Provider<TelegramCredentials> = {
  ...catalog.telegram,
  connector: {
    kind: 'form',
    fields: [
      {
        name: 'botToken',
        label: 'Bot token',
        type: 'password',
        placeholder: '123456789:AA…',
        hint: 'In Telegram, message @BotFather, send /newbot and copy the token it gives you.',
      },
      {
        name: 'chat',
        label: 'Channel or group',
        placeholder: '@yourchannel or -1001234567890',
        hint: 'Add the bot to your channel or group as an administrator that may post messages, then enter its @username (or numeric id for private chats).',
      },
    ],
    async connect(values) {
      return [await connect(values)];
    },
  },
  async publish(credentials, content): Promise<PublishResult> {
    const { method, params } = buildRequest(credentials.chatId, content);
    const result = await call<TelegramMessage | TelegramMessage[]>(credentials.botToken, method, params, 'publish');
    const message = Array.isArray(result) ? result[0] : result;
    if (!message) throw new ProviderError('Telegram did not return the new message.');
    return { remoteId: String(message.message_id), url: messageUrl(message.chat?.username, message.message_id) };
  },
};
