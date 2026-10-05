import { catalog } from './catalog';
import { json, requestJson, withQuery } from './http';
import { ProviderError, type ConnectedAccount, type PostContent, type Provider, type PublishResult } from './types';

const MAX_CONTENT_LENGTH = catalog.discord.capabilities.text.maxLength;
const MAX_EMBEDS = 10;

/**
 * Discord needs no developer app: the user creates a webhook for a channel
 * (Server Settings → Integrations → Webhooks) and pastes its URL.
 * The URL contains the webhook token, so it is the secret here.
 */
export interface DiscordCredentials {
  /** https://discord.com/api/webhooks/{id}/{token} */
  webhookUrl: string;
  channelId: string;
  guildId?: string;
}

const WEBHOOK_HOST = /^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$/i;
const WEBHOOK_PATH = /^\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)\/?$/;

/** Validates a pasted webhook URL and normalizes it to https://discord.com/api/webhooks/{id}/{token}. */
export function normalizeWebhookUrl(input: string): string {
  const invalid = () =>
    new ProviderError('That is not a Discord webhook URL. Copy it from Server Settings → Integrations → Webhooks → Copy Webhook URL.');
  const trimmed = input.trim();
  if (!trimmed) throw invalid();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalid();
  }
  const match = WEBHOOK_PATH.exec(url.pathname);
  if (url.protocol !== 'https:' || !WEBHOOK_HOST.test(url.hostname) || !match) throw invalid();
  return `https://discord.com/api/webhooks/${match[1]}/${match[2]}`;
}

export function messageUrl(guildId: string | undefined, channelId: string, messageId: string): string | undefined {
  return guildId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : undefined;
}

export function avatarUrl(webhookId: string, avatar: string | null | undefined): string | undefined {
  return avatar ? `https://cdn.discordapp.com/avatars/${webhookId}/${avatar}.png` : undefined;
}

/** Message text with every video URL on its own line; Discord embeds the players itself. */
export function buildContent(content: Pick<PostContent, 'text' | 'media'>): string {
  const videos = content.media.filter((item) => item.kind === 'video').map((item) => item.url);
  const text = content.text.trim() ? content.text : '';
  return [text, ...videos].filter(Boolean).join('\n');
}

interface DiscordWebhook {
  id: string;
  name: string | null;
  channel_id: string;
  guild_id?: string | null;
  avatar?: string | null;
}

interface DiscordMessage {
  id: string;
  channel_id?: string;
}

function scrubbed(error: unknown, webhookUrl: string): ProviderError {
  const token = webhookUrl.split('/').pop() ?? '';
  const scrub = (message: string) => (token ? message.split(token).join('<webhook token>') : message);
  if (error instanceof ProviderError) {
    return new ProviderError(scrub(error.message), { retryable: error.retryable, needsReauth: error.needsReauth, cause: error });
  }
  return new ProviderError(`Discord request failed: ${scrub((error as Error).message)}`, { retryable: true, cause: error });
}

function statusOf(error: unknown): { status: number; description: string } | undefined {
  if (!(error instanceof ProviderError) || error.status === undefined) return undefined;
  // http.ts formats HTTP failures as "<host> responded <status>: <Discord's message>".
  const description = /responded \d{3}: ([\s\S]*)$/.exec(error.message)?.[1] ?? error.message;
  return { status: error.status, description };
}

export async function connect(values: Record<string, string>): Promise<ConnectedAccount<DiscordCredentials>> {
  const webhookUrl = normalizeWebhookUrl(values.webhookUrl ?? '');
  let webhook: DiscordWebhook;
  try {
    webhook = await requestJson<DiscordWebhook>(webhookUrl);
  } catch (error) {
    const status = statusOf(error)?.status;
    if (status === 401 || status === 403 || status === 404) {
      throw new ProviderError(
        'Discord does not know this webhook. It may have been deleted or copied incompletely; copy the URL again from Server Settings → Integrations → Webhooks.',
      );
    }
    throw scrubbed(error, webhookUrl);
  }
  if (!webhook.id || !webhook.channel_id) throw new ProviderError('Discord returned an unexpected response for this webhook.');
  const name = webhook.name || 'Discord webhook';
  return {
    profile: { externalId: webhook.id, handle: name, displayName: name, avatarUrl: avatarUrl(webhook.id, webhook.avatar) },
    credentials: { webhookUrl, channelId: webhook.channel_id, ...(webhook.guild_id && { guildId: webhook.guild_id }) },
  };
}

export async function publish(credentials: DiscordCredentials, content: PostContent): Promise<PublishResult> {
  const text = buildContent(content);
  if (text.length > MAX_CONTENT_LENGTH) {
    throw new ProviderError(`Text plus video links is ${text.length} characters; Discord allows ${MAX_CONTENT_LENGTH}. Shorten the text.`);
  }
  const embeds = content.media.filter((item) => item.kind === 'image').map((item) => ({ image: { url: item.url } }));
  if (embeds.length > MAX_EMBEDS) throw new ProviderError(`Discord allows at most ${MAX_EMBEDS} images per post.`);

  let message: DiscordMessage;
  try {
    message = await requestJson<DiscordMessage>(
      withQuery(credentials.webhookUrl, { wait: true }),
      json({ ...(text && { content: text }), ...(embeds.length > 0 && { embeds }) }),
    );
  } catch (error) {
    const parsed = statusOf(error);
    if (parsed?.status === 404) {
      throw new ProviderError('The Discord webhook was deleted. Create a new one and reconnect the channel.', { needsReauth: true });
    }
    if (parsed?.status === 401 || parsed?.status === 403) {
      throw new ProviderError('Discord no longer accepts this webhook (was it reset?). Reconnect the channel with a new webhook URL.', { needsReauth: true });
    }
    if (parsed && parsed.status >= 400 && parsed.status < 500 && parsed.status !== 408 && parsed.status !== 429) {
      throw new ProviderError(`Discord rejected the post: ${parsed.description}`);
    }
    throw scrubbed(error, credentials.webhookUrl);
  }
  if (!message.id) throw new ProviderError('Discord did not return the new message.');
  return { remoteId: message.id, url: messageUrl(credentials.guildId, message.channel_id ?? credentials.channelId, message.id) };
}

export const discord: Provider<DiscordCredentials> = {
  ...catalog.discord,
  connector: {
    kind: 'form',
    fields: [
      {
        name: 'webhookUrl',
        label: 'Webhook URL',
        type: 'password',
        placeholder: 'https://discord.com/api/webhooks/…',
        hint: 'In Discord: Server Settings → Integrations → Webhooks → New Webhook, pick the channel, then Copy Webhook URL.',
      },
    ],
    async connect(values) {
      return [await connect(values)];
    },
  },
  // Video links count toward Discord's 2000-character limit; the generic check only sees the text.
  validate(content) {
    if (!content.media.some((item) => item.kind === 'video')) return [];
    const length = buildContent(content).length;
    return length > MAX_CONTENT_LENGTH ? [`Text plus video links is ${length} characters; Discord allows ${MAX_CONTENT_LENGTH}.`] : [];
  },
  publish: (credentials, content) => publish(credentials, content),
};
