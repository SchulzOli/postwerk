import { providerInfos, type ProviderInfo } from '@postwerk/providers';
import { bridgeSetup, networkRoute } from './bridge';
import { isMailConfigured } from './mail';

type Env = Record<string, string | undefined>;

/**
 * Who runs this server (OPERATOR_*), for its legal pages. Every Postwerk
 * server is run by someone; the networks' app reviews and EU law ask for
 * their name and a way to reach them.
 */
export interface Operator {
  name: string;
  email: string;
  /** Postal address lines (OPERATOR_ADDRESS, lines separated by ";" or "\n"). */
  address: string[];
  phone?: string;
  /** Hosting provider of the server, e.g. "Hetzner Online GmbH, Germany". */
  hosting?: string;
}

const clean = (value: string | undefined) => value?.trim() || undefined;

/** The operator's details, or null until OPERATOR_NAME and OPERATOR_EMAIL are set. */
export function operatorDetails(env: Env = process.env): Operator | null {
  const name = clean(env.OPERATOR_NAME);
  const email = clean(env.OPERATOR_EMAIL);
  if (!name || !email) return null;
  const address = (env.OPERATOR_ADDRESS ?? '')
    .split(/\\n|\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { name, email, address, phone: clean(env.OPERATOR_PHONE), hosting: clean(env.OPERATOR_HOSTING) };
}

export const LEGAL_PAGES = ['privacy', 'terms', 'imprint', 'data-deletion'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

const OVERRIDES: Record<LegalPage, string> = {
  privacy: 'LEGAL_PRIVACY_URL',
  terms: 'LEGAL_TERMS_URL',
  imprint: 'LEGAL_IMPRINT_URL',
  'data-deletion': 'LEGAL_DATA_DELETION_URL',
};

export const isLegalPage = (value: string): value is LegalPage => (LEGAL_PAGES as readonly string[]).includes(value);

/**
 * Where each legal page is: the operator's own page (LEGAL_*_URL), Postwerk's
 * built-in page (/legal/…), or nowhere yet (null). Built-in pages need the
 * operator's name and email; the imprint also needs an address.
 */
export function legalPages(env: Env = process.env): Record<LegalPage, { href: string; builtIn: boolean } | null> {
  const operator = operatorDetails(env);
  const page = (name: LegalPage) => {
    const own = clean(env[OVERRIDES[name]]);
    if (own) return { href: own, builtIn: false };
    if (!operator || (name === 'imprint' && operator.address.length === 0)) return null;
    return { href: `/legal/${name}`, builtIn: true };
  };
  return { privacy: page('privacy'), terms: page('terms'), imprint: page('imprint'), 'data-deletion': page('data-deletion') };
}

/** A service provider that handles personal data for this server (named on the privacy page). */
export interface Processor {
  kind: 'hosting' | 'storage' | 'mail' | 'bridge';
  name: string;
  privacyUrl?: string;
}

const host = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
};

/** The service providers this server's settings use: hosting, S3 storage, SMTP, the bridge. */
export function dataProcessors(env: Env = process.env): Processor[] {
  const processors: Processor[] = [];
  const hosting = clean(env.OPERATOR_HOSTING);
  if (hosting) processors.push({ kind: 'hosting', name: hosting });
  const storage = env.MEDIA_STORAGE === 's3' ? host(env.S3_ENDPOINT) : undefined;
  if (storage) processors.push({ kind: 'storage', name: storage });
  const mail = isMailConfigured(env) ? host(env.SMTP_URL?.trim()) : undefined;
  if (mail) processors.push({ kind: 'mail', name: mail });
  const bridge = bridgeSetup(env)?.bridge;
  if (bridge) processors.push({ kind: 'bridge', name: `${bridge.name} (${bridge.company})`, privacyUrl: bridge.privacyUrl });
  return processors;
}

/** Networks people can connect on this server, and whether each goes through the bridge. */
export function offeredNetworks(env: Env = process.env): { info: ProviderInfo; viaBridge: boolean }[] {
  return providerInfos
    .filter((info) => info.id !== 'sandbox')
    .map((info) => ({ info, route: networkRoute(info.id, env) }))
    .filter(({ route }) => route !== 'unavailable')
    .map(({ info, route }) => ({ info, viaBridge: route === 'bridge' }));
}
