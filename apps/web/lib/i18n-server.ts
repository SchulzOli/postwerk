import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { defaultLocale, errorText, isLocale, matchLocale, type Catalog, type Locale, type Messages } from '@postwerk/core/i18n';
import { LOCALE_COOKIE } from './locale';
import { getSession } from './session';

/** The UI language: the user's choice, else this browser's (cookie, Accept-Language), else English. Cached per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const session = await getSession();
  if (isLocale(session?.user.locale)) return session.user.locale;
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  return matchLocale((await headers()).get('accept-language')) ?? defaultLocale;
});

/** A catalog's messages in the UI language: `const t = await getMessages(postsMessages)`. */
export async function getMessages<T extends Messages>(catalog: Catalog<T>): Promise<T> {
  return catalog[await getLocale()];
}

/** An error's text for the user, in their language when core can localize it. */
export async function localizedError(error: unknown): Promise<string> {
  return errorText(error, await getLocale());
}
