'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { updateProfile } from '@postwerk/core';
import { isLocale, type Locale } from '@postwerk/core/i18n';
import { getDb } from '@postwerk/db';
import { secureCookies } from '@/lib/env';
import { LOCALE_COOKIE } from '@/lib/locale';
import { getSession } from '@/lib/session';

/**
 * Switches the UI language; `null` follows the browser again. Works signed
 * out (cookie only); signed in, the choice is kept in the account, so emails
 * use it too.
 */
export async function setLocaleAction(locale: Locale | null): Promise<void> {
  if (locale !== null && !isLocale(locale)) return;
  const jar = await cookies();
  if (locale) jar.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 365 * 24 * 60 * 60, sameSite: 'lax', secure: secureCookies });
  else jar.delete(LOCALE_COOKIE);
  const session = await getSession();
  if (session) await updateProfile(getDb(), session.user.id, { locale });
  revalidatePath('/', 'layout');
}
