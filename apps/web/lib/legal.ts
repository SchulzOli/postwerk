import { legalPages, operatorDetails, type LegalPage } from '@postwerk/core';
import { appUrl } from './env';

/** This server's name on its public pages: the host of APP_URL. */
export const siteName = new URL(appUrl).host;

/** The public pages this server has (about, then the legal pages that are set up), for footers and menus. */
export function legalLinks(): { page: LegalPage | 'about'; href: string }[] {
  const pages = legalPages();
  const links: { page: LegalPage | 'about'; href: string }[] = operatorDetails() ? [{ page: 'about', href: '/about' }] : [];
  for (const page of ['privacy', 'terms', 'imprint', 'data-deletion'] as const) {
    const entry = pages[page];
    if (entry) links.push({ page, href: entry.href });
  }
  return links;
}
