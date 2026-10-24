/**
 * Pingen (https://pingen.com): prints, enfolds and posts letters from PDFs,
 * in Switzerland, Germany and Austria and worldwide. The server admin connects
 * their own Pingen account; letters are billed there.
 *
 * API v2 as used by Pingen's official SDKs (pingen2sdk, pingen2-sdk-js):
 * client-credentials token at /auth/access-tokens, a signed upload URL from
 * /file-upload, then JSON:API calls under /organisations/{id}.
 */
import { LocalizedError } from './i18n';

type Env = Record<string, string | undefined>;

export const PINGEN_API = 'https://api.pingen.com';
export const PINGEN_STAGING_API = 'https://api-staging.pingen.com';

export interface PingenConfig {
  clientId: string;
  clientSecret: string;
  /** Pingen organisation; the account's first one when empty. */
  organisationId?: string;
  /** Pingen's test environment: letters are checked but never printed or sent. */
  staging: boolean;
  /** Another API address (a stand-in for tests). */
  apiUrl?: string;
}

/** Pingen as the server admin set it up (PINGEN_CLIENT_ID and PINGEN_CLIENT_SECRET), or null. */
export function pingenConfig(env: Env = process.env): PingenConfig | null {
  const clientId = env.PINGEN_CLIENT_ID?.trim();
  const clientSecret = env.PINGEN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    organisationId: env.PINGEN_ORGANISATION_ID?.trim() || undefined,
    staging: env.PINGEN_STAGING === 'true',
    apiUrl: env.PINGEN_API_URL?.trim().replace(/\/$/, '') || undefined,
  };
}

/** A Pingen request failed; Pingen's own words stay English. */
export class PingenError extends LocalizedError {
  constructor(
    message: string,
    readonly options: { status?: number; retryable?: boolean } = {},
  ) {
    super(() => message);
    this.name = 'PingenError';
  }
  get retryable() {
    return this.options.retryable ?? false;
  }
}

export type DeliveryProduct = 'fast' | 'cheap';

export interface PingenLetter {
  id: string;
  status: string;
  priceValue: number | null;
  priceCurrency: string | null;
}

interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
}

type Fetch = typeof fetch;

/** Pingen's JSON:API error text, or the HTTP status. */
async function failure(response: Response, what: string): Promise<PingenError> {
  const body = await response.text();
  let reason = `status ${response.status}`;
  try {
    const parsed = JSON.parse(body) as { errors?: { title?: string; detail?: string }[]; error_description?: string; message?: string };
    reason = parsed.errors?.map((error) => error.detail || error.title).filter(Boolean).join(' ') || parsed.error_description || parsed.message || reason;
  } catch {
    // not JSON
  }
  if (response.status === 401 || response.status === 403) {
    return new PingenError(`Pingen refused the credentials (${reason}). The server admin needs to check PINGEN_CLIENT_ID and PINGEN_CLIENT_SECRET.`, { status: response.status });
  }
  return new PingenError(`Pingen: ${what} failed: ${reason}`, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
}

const letterOf = (resource: Resource): PingenLetter => ({
  id: resource.id,
  status: String(resource.attributes.status ?? ''),
  priceValue: typeof resource.attributes.price_value === 'number' ? resource.attributes.price_value : null,
  priceCurrency: typeof resource.attributes.price_currency === 'string' ? resource.attributes.price_currency : null,
});

export class PingenClient {
  private token: { value: string; expiresAt: number } | null = null;
  private organisation: string | undefined;
  private readonly base: string;

  constructor(
    private readonly config: PingenConfig,
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
  ) {
    this.base = config.apiUrl ?? (config.staging ? PINGEN_STAGING_API : PINGEN_API);
    this.organisation = config.organisationId;
  }

  /** Network trouble (no connection, timeouts) is worth another try later. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const reason = cause?.code ?? cause?.message ?? (error as Error).message;
      throw new PingenError(`Pingen could not be reached (${reason}).`, { retryable: true });
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const response = await this.request(`${this.base}/auth/access-tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.config.clientSecret, scope: 'letter organisation_read' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await failure(response, 'signing in');
    const body = (await response.json()) as { access_token: string; expires_in?: number };
    // Renew a minute early.
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000 };
    return this.token.value;
  }

  private async call(method: string, path: string, what: string, body?: unknown, headers: Record<string, string> = {}): Promise<Resource | Resource[]> {
    const response = await this.request(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/vnd.api+json', ...(body ? { 'content-type': 'application/vnd.api+json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 401) this.token = null;
    if (!response.ok) throw await failure(response, what);
    return ((await response.json()) as { data: Resource | Resource[] }).data;
  }

  /** The organisation letters are sent from. */
  async organisationId(): Promise<string> {
    if (this.organisation) return this.organisation;
    const list = (await this.call('GET', '/organisations', 'finding the organisation')) as Resource[];
    const first = list[0];
    if (!first) throw new PingenError('Pingen: this account has no organisation. Create one at pingen.com or set PINGEN_ORGANISATION_ID.');
    this.organisation = first.id;
    return first.id;
  }

  /**
   * Uploads a letter PDF and sends it. `key` makes retries safe: Pingen
   * creates the letter only once per key.
   */
  async sendLetter(pdf: Uint8Array, options: { fileName: string; deliveryProduct: DeliveryProduct; color: boolean; key: string }): Promise<PingenLetter> {
    const organisation = await this.organisationId();
    const upload = (await this.call('GET', '/file-upload', 'preparing the upload')) as Resource;
    const url = String(upload.attributes.url ?? '');
    const signature = String(upload.attributes.url_signature ?? '');
    if (!url || !signature) throw new PingenError('Pingen: the upload address was missing.', { retryable: true });
    const put = await this.request(url, { method: 'PUT', body: Buffer.from(pdf), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) throw new PingenError(`Pingen: uploading the letter failed (status ${put.status}).`, { status: put.status, retryable: true });
    const letter = (await this.call(
      'POST',
      `/organisations/${organisation}/deliveries/letters`,
      'creating the letter',
      {
        data: {
          type: 'letters',
          attributes: {
            file_original_name: options.fileName,
            file_url: url,
            file_url_signature: signature,
            address_position: 'left',
            auto_send: true,
            delivery_product: options.deliveryProduct,
            print_mode: 'simplex',
            print_spectrum: options.color ? 'color' : 'grayscale',
          },
        },
      },
      { 'idempotency-key': options.key },
    )) as Resource;
    return letterOf(letter);
  }

  async getLetter(id: string): Promise<PingenLetter> {
    const organisation = await this.organisationId();
    return letterOf((await this.call('GET', `/organisations/${organisation}/deliveries/letters/${encodeURIComponent(id)}`, 'checking a letter')) as Resource);
  }

  /** The price of one single-page letter to `country`. */
  async price(country: string, options: { deliveryProduct: DeliveryProduct; color: boolean }): Promise<{ value: number; currency: string }> {
    const organisation = await this.organisationId();
    const result = (await this.call('POST', `/organisations/${organisation}/deliveries/letters/price-calculator`, 'calculating the price', {
      data: {
        type: 'letter_price_calculator',
        attributes: { country, paper_types: ['normal'], print_mode: 'simplex', print_spectrum: options.color ? 'color' : 'grayscale', delivery_product: options.deliveryProduct },
      },
    })) as Resource;
    return { value: Number(result.attributes.price ?? 0), currency: String(result.attributes.currency ?? '') };
  }
}

/** Pingen status words: where a letter stands for us. */
export function letterOutcome(status: string): 'sent' | 'failed' | 'underway' {
  if (['sent', 'delivered'].includes(status)) return 'sent';
  if (['action_required', 'invalid', 'undeliverable', 'cancelled', 'canceled', 'expired', 'failed'].includes(status)) return 'failed';
  return 'underway';
}
