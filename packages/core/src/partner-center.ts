/**
 * Microsoft Partner Center, where publishers manage their AppSource offers.
 * MarketingAsAService uses three of its interfaces, all with one Microsoft
 * Entra app (tenant ID, client ID, secret) that the publisher adds to
 * Partner Center with the Manager role:
 *
 * - the Product Ingestion API (Microsoft Graph) to write an approved
 *   listing's texts into the offer's draft; publishing stays in Partner Center
 * - the commercial marketplace analytics API for the daily "Marketplace
 *   Insights" report: page visits and clicks on "Get it now", "Contact me"
 *   and "Free trial"
 * - leads, which Partner Center posts to an HTTPS endpoint (see marketplace.ts)
 *
 * Endpoints as documented on learn.microsoft.com (checked 2026-11-15):
 * partner-center/marketplace-offers/product-ingestion-api,
 * .../product-ingestion-api-dynamics-365-business-central (public preview),
 * partner-center/insights/analytics-make-your-first-api-call and
 * .../analytics-system-queries.
 */
import { LocalizedError } from './i18n';
import { partnerCenterMessages } from './messages';

export interface PartnerCenterCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export type PartnerCenterProblem = 'credentials' | 'forbidden' | 'notFound' | 'noListing' | 'rejected' | 'unreachable' | 'pending';

export class PartnerCenterError extends LocalizedError {
  constructor(
    readonly reason: PartnerCenterProblem,
    readonly detail = '',
  ) {
    super((locale) => {
      const m = partnerCenterMessages[locale];
      return reason === 'rejected' ? m.rejected(detail) : m[reason];
    });
  }
}

const LOGIN = 'https://login.microsoftonline.com';
const INGESTION = 'https://graph.microsoft.com/rp/product-ingestion';
const INGESTION_VERSION = '2022-07-01';
const INSIGHTS = 'https://api.partnercenter.microsoft.com/insights/v1.1/cmp';
/** Microsoft's system query "Marketplace Insights report for the last 6M". */
export const MARKETPLACE_INSIGHTS_QUERY = '6fd7624b-aa9f-42df-a61d-67d42fd00e92';

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The product's GUID from "product/<guid>", a Partner Center address, or the GUID itself. */
export function partnerCenterProductId(input: string): string | null {
  return GUID.exec(input)?.[0]?.toLowerCase() ?? null;
}

/** Checks the credentials' shape; the tenant is a GUID or a domain like contoso.onmicrosoft.com. */
export function cleanCredentials(input: PartnerCenterCredentials): PartnerCenterCredentials | null {
  const tenantId = input.tenantId.trim();
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!(GUID.test(tenantId) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(tenantId)) || !GUID.test(clientId) || !clientSecret || clientSecret.length > 500) return null;
  return { tenantId, clientId, clientSecret };
}

export interface ListingTexts {
  title: string;
  summary: string;
  description: string;
  keywords: string[];
  helpLink?: string;
  privacyPolicyLink?: string;
}

export interface JobStatus {
  jobStatus: string;
  jobResult: string;
  errors: { code?: string; message?: string }[];
}

export interface InsightsRow {
  /** YYYY-MM-DD */
  day: string;
  offerName: string;
  pageVisits: number;
  getItNow: number;
  contactMe: number;
  freeTrial: number;
}

type Fetcher = typeof fetch;
type Audience = 'graph' | 'insights';

export class PartnerCenterClient {
  private readonly tokens = new Map<Audience, { value: string; expires: number }>();

  constructor(
    private readonly credentials: PartnerCenterCredentials,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  /** A Microsoft Entra token for the client credentials; the analytics API takes the v1 "resource" form. */
  private async token(audience: Audience): Promise<string> {
    const cached = this.tokens.get(audience);
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
    const { tenantId, clientId, clientSecret } = this.credentials;
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
    let url: string;
    if (audience === 'graph') {
      url = `${LOGIN}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
      form.set('scope', 'https://graph.microsoft.com/.default');
    } else {
      url = `${LOGIN}/${encodeURIComponent(tenantId)}/oauth2/token`;
      form.set('resource', 'https://api.partnercenter.microsoft.com');
    }
    let response: Response;
    try {
      response = await this.fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    } catch {
      throw new PartnerCenterError('unreachable');
    }
    if (response.status >= 500) throw new PartnerCenterError('unreachable');
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: string | number };
    if (!response.ok || !body.access_token) throw new PartnerCenterError('credentials');
    this.tokens.set(audience, { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3599) * 1000 });
    return body.access_token;
  }

  private async call<T>(audience: Audience, url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token(audience);
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
    } catch {
      throw new PartnerCenterError('unreachable');
    }
    if (response.status === 401) throw new PartnerCenterError('credentials');
    if (response.status === 403) throw new PartnerCenterError('forbidden');
    if (response.status === 404) throw new PartnerCenterError('notFound');
    if (response.status === 429 || response.status >= 500) throw new PartnerCenterError('unreachable');
    const body = (await response.json().catch(() => null)) as T | null;
    if (!response.ok || body === null) throw new PartnerCenterError('rejected', errorText(body) || `HTTP ${response.status}`);
    return body;
  }

  /** Gets both tokens, so wrong credentials show when they are saved. */
  async check(): Promise<void> {
    await this.token('graph');
    await this.token('insights');
  }

  /** The draft listing resource of a Business Central offer. */
  async draftListing(productId: string): Promise<Record<string, unknown>> {
    const id = partnerCenterProductId(productId);
    if (!id) throw new PartnerCenterError('notFound');
    const tree = await this.call<{ resources?: Record<string, unknown>[] }>('graph', `${INGESTION}/resource-tree/product/${id}?targetType=draft&$version=${INGESTION_VERSION}`);
    const listing = (tree.resources ?? []).find((resource) => String(resource.$schema ?? '').includes('/schema/listing/'));
    if (!listing) throw new PartnerCenterError('noListing');
    return listing;
  }

  /**
   * Writes the listing's texts into the offer's draft and returns the job id.
   * The draft resource is read first and only the listing's own fields
   * change, as the API's guide describes.
   */
  async sendListing(productId: string, texts: ListingTexts): Promise<string> {
    const current = await this.draftListing(productId);
    const next: Record<string, unknown> = { ...current, title: texts.title, searchResultSummary: texts.summary, description: texts.description };
    if (texts.helpLink) next.helpLink = texts.helpLink;
    if (texts.privacyPolicyLink) next.privacyPolicyLink = texts.privacyPolicyLink;
    // The keywords' field is not in Microsoft's example; fill it only where the draft has one.
    for (const field of ['searchKeywords', 'keywords']) if (Array.isArray(current[field])) next[field] = texts.keywords;
    const job = await this.call<{ jobId?: string }>('graph', `${INGESTION}/configure?$version=${INGESTION_VERSION}`, {
      method: 'POST',
      body: JSON.stringify({ $schema: `https://schema.mp.microsoft.com/schema/configure/${INGESTION_VERSION}`, resources: [next] }),
    });
    if (!job.jobId) throw new PartnerCenterError('rejected', 'no job id');
    return job.jobId;
  }

  async jobStatus(jobId: string): Promise<JobStatus> {
    const status = await this.call<Partial<JobStatus>>('graph', `${INGESTION}/configure/${encodeURIComponent(jobId)}/status?$version=${INGESTION_VERSION}`);
    return { jobStatus: String(status.jobStatus ?? ''), jobResult: String(status.jobResult ?? ''), errors: Array.isArray(status.errors) ? status.errors : [] };
  }

  /** Waits for a configure job; a job still running after the attempts throws "pending" with its id as detail. */
  async waitForJob(jobId: string, { attempts = 10, delayMs = 3000 } = {}): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const status = await this.jobStatus(jobId);
      if (status.jobStatus.toLowerCase() === 'completed') {
        if (status.jobResult.toLowerCase() === 'succeeded') return;
        throw new PartnerCenterError('rejected', status.errors.map((error) => error.message ?? error.code).filter(Boolean).join(' ') || status.jobResult);
      }
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new PartnerCenterError('pending', jobId);
  }

  /** Schedules Microsoft's Marketplace Insights report as a daily CSV; returns the report id. */
  async scheduleInsightsReport(start = new Date(Date.now() + 5 * 60_000)): Promise<string> {
    const created = await this.call<{ value?: { reportId?: string }[] }>('insights', `${INSIGHTS}/ScheduledReport`, {
      method: 'POST',
      body: JSON.stringify({
        ReportName: 'MarketingAsAService marketplace insights',
        Description: 'Daily page visits and calls to action, read by MarketingAsAService',
        QueryId: MARKETPLACE_INSIGHTS_QUERY,
        StartTime: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        RecurrenceInterval: 24,
        RecurrenceCount: 365,
        Format: 'csv',
      }),
    });
    const id = created.value?.[0]?.reportId;
    if (!id) throw new PartnerCenterError('rejected', 'no report id');
    return id;
  }

  /** The newest finished run of the report as CSV text; null while none has finished yet. */
  async latestInsights(reportId: string): Promise<string | null> {
    const runs = await this.call<{ value?: { executionStatus?: string; reportAccessSecureLink?: string | null; reportGeneratedTime?: string | null }[] }>(
      'insights',
      `${INSIGHTS}/ScheduledReport/execution/${encodeURIComponent(reportId)}`,
    );
    const done = (runs.value ?? [])
      .filter((run) => run.executionStatus?.toLowerCase() === 'completed' && run.reportAccessSecureLink)
      .sort((a, b) => String(b.reportGeneratedTime ?? '').localeCompare(String(a.reportGeneratedTime ?? '')));
    const link = done[0]?.reportAccessSecureLink;
    if (!link) return null;
    let response: Response;
    try {
      // A time-limited link to the file; it carries its own access.
      response = await this.fetcher(link);
    } catch {
      throw new PartnerCenterError('unreachable');
    }
    if (!response.ok) throw new PartnerCenterError('unreachable');
    return response.text();
  }
}

function errorText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { message?: unknown; error?: { message?: unknown }; errors?: { message?: unknown }[] };
  return String(record.error?.message ?? record.errors?.map((error) => error.message).join(' ') ?? record.message ?? '').slice(0, 500);
}

/** Splits CSV text into rows (quotes, doubled quotes, CRLF, a leading BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

const count = (value: string | undefined) => {
  const n = Number((value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

function isoDay(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/** The Marketplace Insights CSV summed per day and offer (the report splits by country and referring site). */
export function insightsRows(csv: string): InsightsRow[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const column = (name: string) => header.findIndex((cell) => cell.trim().toLowerCase() === name.toLowerCase());
  const at = { day: column('Date'), offer: column('OfferName'), visits: column('PageVisits'), get: column('GetItNow'), contact: column('ContactMe'), trial: column('FreeTrial') };
  if (at.day < 0 || at.offer < 0) return [];
  const sums = new Map<string, InsightsRow>();
  for (const row of rows) {
    const day = isoDay(row[at.day] ?? '');
    const offerName = (row[at.offer] ?? '').trim();
    if (!day || !offerName) continue;
    const key = `${day}\u0000${offerName}`;
    const sum = sums.get(key) ?? { day, offerName, pageVisits: 0, getItNow: 0, contactMe: 0, freeTrial: 0 };
    sum.pageVisits += count(row[at.visits]);
    sum.getItNow += count(row[at.get]);
    sum.contactMe += count(row[at.contact]);
    sum.freeTrial += count(row[at.trial]);
    sums.set(key, sum);
  }
  return [...sums.values()].sort((a, b) => a.day.localeCompare(b.day) || a.offerName.localeCompare(b.offerName));
}
