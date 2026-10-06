'use server';

import { revalidatePath } from 'next/cache';
import { changePassword, hitRateLimit, limits, rateLimitKey, retryIn, sendVerificationEmail, updateProfile, UserInputError } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { record } from '@/lib/audit';
import { appUrl } from '@/lib/env';
import { getLocale, getMessages, localizedError } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { accountMessages } from '@/messages/account';

export type AccountState = { error?: string; success?: string };

async function attempt(run: () => Promise<void>, success: string): Promise<AccountState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof UserInputError) return { error: await localizedError(error) };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { success };
}

export async function updateNameAction(_: AccountState, form: FormData): Promise<AccountState> {
  const { user } = await requireSession();
  const t = await getMessages(accountMessages);
  return attempt(() => updateProfile(getDb(), user.id, { name: String(form.get('name') ?? '') }), t.saved);
}

export async function changePasswordAction(_: AccountState, form: FormData): Promise<AccountState> {
  const { user, sessionId } = await requireSession();
  const t = await getMessages(accountMessages);
  const result = await attempt(
    () => changePassword(getDb(), user.id, String(form.get('current') ?? ''), String(form.get('password') ?? ''), sessionId),
    t.passwordChanged,
  );
  if (result.success) await record({ action: 'password.changed', userId: user.id });
  return result;
}

export async function setNotifyFailuresAction(enabled: boolean): Promise<AccountState> {
  const { user } = await requireSession();
  const t = await getMessages(accountMessages);
  return attempt(() => updateProfile(getDb(), user.id, { notifyFailures: enabled }), enabled ? t.notifyOn : t.notifyOff);
}

export async function resendVerificationAction(): Promise<AccountState> {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = accountMessages[locale];
  if (user.emailVerifiedAt) return { success: t.alreadyConfirmed };
  const db = getDb();
  const limit = await hitRateLimit(db, rateLimitKey('verify:user', user.id), limits.emailAddress);
  if (!limit.allowed) return { error: t.tooManyEmails(retryIn(limit.retryAfterMs, locale)) };
  try {
    await sendVerificationEmail(db, user, appUrl, locale);
  } catch (error) {
    console.error('verification email failed', error);
    return { error: t.emailFailed };
  }
  return { success: t.confirmationSent(user.email) };
}
