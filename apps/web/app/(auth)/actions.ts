'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  checkRateLimit,
  clearRateLimit,
  hashPassword,
  hitRateLimit,
  installBuiltinPlugins,
  limits,
  rateLimitKey,
  retryIn,
  verifyPassword,
} from '@postwerk/core';
import { getDb, users, workspaceMembers, workspaces } from '@postwerk/db';
import { record } from '@/lib/audit';
import { clientIp } from '@/lib/request';
import { createSession, destroySession } from '@/lib/session';

export type FormState = { error?: string; values?: { name?: string; email?: string } };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A real hash to compare against when the email is unknown, so timing does not reveal accounts.
const dummyHash = hashPassword('postwerk-dummy-password');

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
  const created = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ name, email, passwordHash }).onConflictDoNothing().returning({ id: users.id });
    if (!user) return null;
    const [workspace] = await tx.insert(workspaces).values({ name: `${name}'s workspace` }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId: user.id, role: 'owner' });
    await installBuiltinPlugins(tx, workspace!.id);
    return { user: user.id, workspace: workspace!.id };
  });
  if (!created) return { error: 'An account with this email already exists.', values };
  await record({ action: 'user.signed_up', userId: created.user });
  await record({ action: 'workspace.created', userId: created.user, workspaceId: created.workspace, target: `${name}'s workspace` });

  await createSession(created.user);
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
  await createSession(user.id);
  redirect('/canvas');
}

export async function logOut() {
  await destroySession();
  redirect('/login');
}
