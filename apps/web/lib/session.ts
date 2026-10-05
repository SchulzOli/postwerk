import 'server-only';
import { and, asc, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { generateToken, hashToken } from '@postwerk/core';
import { getDb, sessions, users, workspaceMembers } from '@postwerk/db';
import { secureCookies } from './env';

const COOKIE = 'postwerk_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export async function createSession(userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/', expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

/** The signed-in user and their workspace, or null. Cached per request. */
export const getSession = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  // Every user gets a workspace at sign-up; switching between several comes later.
  const membership = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.userId, row.user.id),
    orderBy: [asc(workspaceMembers.createdAt)],
    with: { workspace: true },
  });
  if (!membership) return null;
  return { user: row.user, workspace: membership.workspace, role: membership.role, theme: membership.theme };
});

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.role === 'editor') throw new Error('Only workspace owners and admins can manage accounts.');
  return session;
}
