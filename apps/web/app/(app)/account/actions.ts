'use server';

import { revalidatePath } from 'next/cache';
import { changePassword, hitRateLimit, limits, rateLimitKey, retryIn, sendVerificationEmail, updateProfile, UserInputError } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { record } from '@/lib/audit';
import { appUrl } from '@/lib/env';
import { requireSession } from '@/lib/session';

export type AccountState = { error?: string; success?: string };

async function attempt(run: () => Promise<void>, success: string): Promise<AccountState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof UserInputError) return { error: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { success };
}

export async function updateNameAction(_: AccountState, form: FormData): Promise<AccountState> {
  const { user } = await requireSession();
  return attempt(() => updateProfile(getDb(), user.id, { name: String(form.get('name') ?? '') }), 'Saved.');
}

export async function changePasswordAction(_: AccountState, form: FormData): Promise<AccountState> {
  const { user, sessionId } = await requireSession();
  const result = await attempt(
    () => changePassword(getDb(), user.id, String(form.get('current') ?? ''), String(form.get('password') ?? ''), sessionId),
    'Password changed. Other devices were signed out.',
  );
  if (result.success) await record({ action: 'password.changed', userId: user.id });
  return result;
}

export async function setNotifyFailuresAction(enabled: boolean): Promise<AccountState> {
  const { user } = await requireSession();
  return attempt(() => updateProfile(getDb(), user.id, { notifyFailures: enabled }), enabled ? 'You will get an email when a post fails.' : 'No more failure emails.');
}

export async function resendVerificationAction(): Promise<AccountState> {
  const { user } = await requireSession();
  if (user.emailVerifiedAt) return { success: 'Your email address is already confirmed.' };
  const db = getDb();
  const limit = await hitRateLimit(db, rateLimitKey('verify:user', user.id), limits.emailAddress);
  if (!limit.allowed) return { error: `We already sent a few emails. Please try again ${retryIn(limit.retryAfterMs)}.` };
  try {
    await sendVerificationEmail(db, user, appUrl);
  } catch (error) {
    console.error('verification email failed', error);
    return { error: 'The email could not be sent. Please try again later.' };
  }
  return { success: `Sent. Check ${user.email} for the link.` };
}
