'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  acceptInvite,
  checkRateLimit,
  clearRateLimit,
  createWorkspace,
  hashPassword,
  hitRateLimit,
  isMailConfigured,
  limits,
  PermissionError,
  rateLimitKey,
  requestPasswordReset,
  resetPassword,
  retryIn,
  sendVerificationEmail,
  UserInputError,
  verifyPassword,
} from '@postwerk/core';
import { getDb, users, type Database } from '@postwerk/db';
import { record } from '@/lib/audit';
import { appUrl } from '@/lib/env';
import { clientIp } from '@/lib/request';
import { createSession, destroySession } from '@/lib/session';

export type FormState = { error?: string; values?: { name?: string; email?: string } };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A real hash to compare against when the email is unknown, so timing does not reveal accounts.
const dummyHash = hashPassword('postwerk-dummy-password');

/** Joins the workspace of an invite link, if one came with the form; returns its id. */
async function joinInvite(db: Database, form: FormData, userId: string): Promise<string | undefined> {
  const token = String(form.get('invite') ?? '');
  if (!token) return undefined;
  try {
    const { workspaceId, role, joined } = await acceptInvite(db, token, userId);
    if (joined) await record({ action: 'member.joined', userId, workspaceId, details: { role } });
    return workspaceId;
  } catch (error) {
    if (error instanceof PermissionError) return undefined; // Expired meanwhile: carry on without it.
    throw error;
  }
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const values = { name, email };
  if (!name) return { error: 'Please enter your name.', values };
  if (!EMAIL_PATTERN.test(email)) return { error: 'Please enter a valid email address.', values };
  if (password.length < 10) return { error: 'Use at least 10 characters for your password.', values };

  const db = getDb();
  const limit = await hitRateLimit(db, rateLimitKey('signup:ip', await clientIp()), limits.signupIp);
  if (!limit.allowed) return { error: `Too many sign-ups from your network. Please try again ${retryIn(limit.retryAfterMs)}.`, values };
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ name, email, passwordHash }).onConflictDoNothing().returning({ id: users.id });
  if (!user) return { error: 'An account with this email already exists. Log in instead.', values };
  await record({ action: 'user.signed_up', userId: user.id });
  if (isMailConfigured()) {
    await sendVerificationEmail(db, { id: user.id, name, email }, appUrl).catch((error: unknown) => console.error('verification email failed', error));
  }

  // Invited people land in that workspace; everyone else gets their own.
  let workspaceId = await joinInvite(db, form, user.id);
  if (!workspaceId) {
    const workspace = await createWorkspace(db, user.id, `${name}'s workspace`);
    await record({ action: 'workspace.created', userId: user.id, workspaceId: workspace.id, target: workspace.name });
    workspaceId = workspace.id;
  }
  await createSession(user.id, workspaceId);
  redirect('/canvas#n=region:networks');
}

export async function logIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const db = getDb();
  // Only failures count, per address and per network, so guessing passwords stalls quickly.
  const emailKey = rateLimitKey('login:email', email);
  const ipKey = rateLimitKey('login:ip', await clientIp());
  const checks = await Promise.all([checkRateLimit(db, emailKey, limits.loginEmail), checkRateLimit(db, ipKey, limits.loginIp)]);
  if (checks.some((check) => !check.allowed)) {
    const wait = Math.max(...checks.map((check) => check.retryAfterMs));
    return { error: `Too many failed attempts. Please try again ${retryIn(wait)}.`, values: { email } };
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !valid) {
    const [byEmail, byIp] = await Promise.all([hitRateLimit(db, emailKey, limits.loginEmail), hitRateLimit(db, ipKey, limits.loginIp)]);
    await record({ action: 'login.failed', userId: user?.id, target: email });
    // Recorded once per lockout, not for every blocked attempt.
    if (byEmail.count === limits.loginEmail.limit || byIp.count === limits.loginIp.limit) {
      await record({ action: 'login.blocked', userId: user?.id, target: email });
    }
    return { error: 'Email or password is wrong.', values: { email } };
  }

  await clearRateLimit(db, emailKey);
  await record({ action: 'login.succeeded', userId: user.id });
  await createSession(user.id, await joinInvite(db, form, user.id));
  redirect('/canvas');
}

export async function logOut() {
  await destroySession();
  redirect('/login');
}

export type ResetState = { error?: string; sent?: string };

/** Emails a reset link. The answer is the same whether or not the address has an account. */
export async function requestResetAction(_: ResetState, form: FormData): Promise<ResetState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return { error: 'Please enter a valid email address.' };
  const db = getDb();
  const ip = await clientIp();
  const checks = await Promise.all([hitRateLimit(db, rateLimitKey('reset:email', email), limits.emailAddress), hitRateLimit(db, rateLimitKey('reset:ip', ip), limits.emailIp)]);
  if (checks.some((check) => !check.allowed)) {
    return { error: `Too many requests. Please try again ${retryIn(Math.max(...checks.map((check) => check.retryAfterMs)))}.` };
  }
  try {
    const userId = await requestPasswordReset(db, email, appUrl);
    if (userId) await record({ action: 'password.reset_requested', userId });
  } catch (error) {
    console.error('password reset email failed', error);
    return { error: 'The email could not be sent. Please try again later or ask the server admin.' };
  }
  return { sent: email };
}

export async function resetPasswordAction(token: string, _: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '');
  let userId: string;
  try {
    userId = await resetPassword(getDb(), token, password);
  } catch (error) {
    if (error instanceof UserInputError) return { error: error.message };
    throw error;
  }
  await record({ action: 'password.reset', userId });
  await createSession(userId);
  redirect('/canvas');
}
