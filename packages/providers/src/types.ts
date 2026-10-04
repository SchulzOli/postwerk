export type ProviderId = 'mastodon' | 'bluesky' | 'sandbox';

export interface PostContent {
  text: string;
}

export interface PublishContext {
  /** Stable per-target key so a retried publish does not create a duplicate post. */
  idempotencyKey: string;
}

export interface PublishResult {
  remoteId: string;
  url?: string;
}

export interface AccountProfile {
  externalId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface Provider<Credentials = unknown> {
  id: ProviderId;
  name: string;
  /** Returns human-readable problems; an empty array means the post can be published. */
  validate(content: PostContent, limits?: AccountLimits): string[];
  publish(credentials: Credentials, content: PostContent, context: PublishContext): Promise<PublishResult>;
}

export interface AccountLimits {
  maxLength?: number;
}

/**
 * Errors thrown by providers. The worker uses the flags to decide
 * whether to retry, give up, or mark the account as needing a reconnect.
 */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly needsReauth: boolean;

  constructor(message: string, options: { retryable?: boolean; needsReauth?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
    this.needsReauth = options.needsReauth ?? false;
  }

  static fromHttpStatus(status: number, message: string): ProviderError {
    if (status === 401 || status === 403) return new ProviderError(message, { needsReauth: true });
    if (status === 408 || status === 429 || status >= 500) return new ProviderError(message, { retryable: true });
    return new ProviderError(message);
  }
}
