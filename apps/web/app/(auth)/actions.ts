'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { hashPassword, verifyPassword } from '@postwerk/core';
import { getDb, users, workspaceMembers, workspaces } from '@postwerk/db';
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
  const passwordHash = await hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ name, email, passwordHash }).onConflictDoNothing().returning({ id: users.id });
    if (!user) return null;
    const [workspace] = await tx.insert(workspaces).values({ name: `${name}'s workspace` }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId: user.id, role: 'owner' });
    return user.id;
  });
  if (!userId) return { error: 'An account with this email already exists.', values };

  await createSession(userId);
  redirect('/canvas#n=region:networks');
}

export async function logIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const user = await getDb().query.users.findFirst({ where: eq(users.email, email) });
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !valid) return { error: 'Email or password is wrong.', values: { email } };

  await createSession(user.id);
  redirect('/canvas');
}

export async function logOut() {
  await destroySession();
  redirect('/login');
}
