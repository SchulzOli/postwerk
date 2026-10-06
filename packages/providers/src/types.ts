import { LocalizedError } from './i18n';

export const PROVIDER_IDS = [
  'mastodon',
  'bluesky',
  'facebook',
  'instagram',
  'threads',
  'linkedin',
  'linkedin_page',
  'x',
  'tiktok',
  'youtube',
  'pinterest',
  'reddit',
  'google_business',
  'telegram',
  'discord',
  'sandbox',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video';

export interface MediaItem {
  /** Publicly reachable URL. Networks that pull media fetch it themselves; others we download and upload. */
  url: string;
  kind: MediaKind;
  mimeType?: string;
  altText?: string;
  /** File size in bytes, when known (uploads), so size limits can be checked before publishing. */
  size?: number;
}

export interface PostContent {
  text: string;
  media: MediaItem[];
  /** Per-network fields declared in `Capabilities.options` (e.g. subreddit, title, privacy). */
  options: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Capabilities: static description of what a network accepts.
// Pure data so the composer can validate in the browser.
// ---------------------------------------------------------------------------

/**
 * - graphemes: user-perceived characters (Bluesky, most networks)
 * - mastodon: graphemes, every URL counts as 23
 * - x: X's weighted count (URLs 23, CJK/emoji 2)
 * - utf16: JavaScript string length (APIs that count code units)
 */
export type TextCounter = 'graphemes' | 'mastodon' | 'x' | 'utf16';

export interface OptionField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  /** If set, the value must be one of these. */
  choices?: { value: string; label: string }[];
  defaultValue?: string;
  maxLength?: number;
}

export interface Capabilities {
  text: {
    maxLength: number;
    counter: TextCounter;
    /** Text must not be empty. When false, a media-only post is allowed. */
    required: boolean;
    /** Lower limit that applies when media is attached (e.g. Telegram captions). */
    maxLengthWithMedia?: number;
  };
  media: {
    maxImages: number;
    maxVideos: number;
    /** At least one media item is required (Instagram, TikTok, YouTube, Pinterest). */
    required: boolean;
    /** Images and videos may be combined in one post. */
    mixed: boolean;
    /** Alt text is sent to the network. */
    altText: boolean;
    /** Largest image file the network accepts, in bytes. */
    maxImageBytes?: number;
    /** Largest video file the network accepts, in bytes. */
    maxVideoBytes?: number;
  };
  options: OptionField[];
}

// ---------------------------------------------------------------------------
// Setup: what the operator and the user have to do.
// ---------------------------------------------------------------------------

export interface ProviderSetup {
  /**
   * - none: works for every user immediately
   * - operator-app: the operator registers one developer app (env vars) for all users
   */
  operator: 'none' | 'operator-app';
  /** Env var prefix for the operator app: `${prefix}_CLIENT_ID` / `${prefix}_CLIENT_SECRET`. */
  envPrefix?: string;
  /** What the operator's app needs when it only serves the operator's own accounts (often no review). */
  ownUse?: string;
  /** What the operator's app needs before other people can connect their accounts. */
  review?: string;
  /** The network's developer documentation. */
  docsUrl: string;
  /** Postwerk's step-by-step guide: a path on the docs site (see `guideUrl`). */
  guide: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Short line shown on the connect card. */
  description: string;
  connect: 'oauth2' | 'mastodon' | 'atproto' | 'form';
  capabilities: Capabilities;
  setup: ProviderSetup;
  /** The network's privacy policy, linked from the server's privacy page (Mastodon: each server has its own). */
  privacyUrl?: string;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface AccountProfile {
  externalId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface AccountLimits {
  maxLength?: number;
}

export interface ConnectedAccount<C> {
  profile: AccountProfile;
  credentials: C;
  limits?: AccountLimits;
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** Common shape for OAuth credentials; providers extend it with ids they need (page id, board id, …). */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
}

export interface OAuthConnect<C> {
  kind: 'oauth2';
  /** Use PKCE (S256). The verifier is generated and stored by the caller. */
  pkce: boolean;
  authorizeUrl(client: OAuthClient, params: { redirectUri: string; state: string; codeChallenge?: string }): string;
  /**
   * Exchanges the code and returns every account the user granted access to
   * (one person may manage several Facebook pages, LinkedIn pages, Pinterest boards…).
   */
  exchange(client: OAuthClient, params: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedAccount<C>[]>;
}

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  hint?: string;
}

export interface FormConnect<C> {
  kind: 'form';
  fields: FormField[];
  connect(values: Record<string, string>): Promise<ConnectedAccount<C>[]>;
}

export interface MastodonConnect {
  kind: 'mastodon';
}

/**
 * AT Protocol (Bluesky): users sign in on their own server with OAuth; the
 * form is the fallback (app password) for servers Postwerk cannot be an OAuth
 * client on, or that do not support it.
 */
export interface AtprotoConnect<C> extends Omit<FormConnect<C>, 'kind'> {
  kind: 'atproto';
}

/** The signing keys of Postwerk's AT Protocol client; sessions refresh with the key they started with. */
export interface AtprotoKeyset {
  keys: PrivateJwk[];
}

/** An ES256 (P-256) key as JWK; `d` is the private part. */
export interface PrivateJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
  kid?: string;
}

/** What a network's refresh needs from the server: an operator app, or Postwerk's own AT Protocol keys. */
export type ProviderClient = OAuthClient | AtprotoKeyset;

export interface PublishContext {
  /** Stable per-target key so a retried publish does not create a duplicate post. */
  idempotencyKey: string;
  /** Operator app credentials, for networks that need them at publish time. */
  client?: OAuthClient;
  /**
   * Reads an uploaded file straight from Postwerk's storage, so networks we
   * upload bytes to do not depend on the public URL. Undefined for other media.
   */
  loadMedia?(item: MediaItem): Promise<{ blob: Blob; mimeType: string } | undefined>;
}

export interface PublishResult {
  remoteId: string;
  url?: string;
}

export interface Provider<C = any> extends ProviderInfo {
  connector: OAuthConnect<C> | FormConnect<C> | MastodonConnect | AtprotoConnect<C>;
  /** Network-specific checks on top of the generic capability checks (see `validateContent`). */
  validate?(content: PostContent, limits?: AccountLimits): string[];
  publish(credentials: C, content: PostContent, context: PublishContext): Promise<PublishResult>;
  /** Present for networks with expiring tokens. Returns updated credentials. */
  refresh?(credentials: C, client: ProviderClient | undefined): Promise<C>;
  /** Whether `refresh` should run before publishing. */
  needsRefresh?(credentials: C, now: number): boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Errors thrown by providers. The worker uses the flags to decide
 * whether to retry, give up, or mark the account as needing a reconnect.
 */
export class ProviderError extends LocalizedError {
  readonly retryable: boolean;
  readonly needsReauth: boolean;
  /** HTTP status of the failed request, when there was one. */
  readonly status?: number;

  /**
   * `de`: the German text, for messages Postwerk writes itself that people
   * see while connecting. Errors relayed from a network's API stay English.
   */
  constructor(message: string, options: { retryable?: boolean; needsReauth?: boolean; status?: number; cause?: unknown; de?: string } = {}) {
    super((locale) => (locale === 'de' && options.de) || message, { cause: options.cause });
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
    this.needsReauth = options.needsReauth ?? false;
    this.status = options.status;
  }

  static fromHttpStatus(status: number, message: string): ProviderError {
    if (status === 401 || status === 403) return new ProviderError(message, { needsReauth: true, status });
    if (status === 408 || status === 429 || status >= 500) return new ProviderError(message, { retryable: true, status });
    return new ProviderError(message, { status });
  }
}
