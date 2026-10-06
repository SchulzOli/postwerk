import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createWorkspace, generateToken, hashToken, listUserWorkspaces } from '@postwerk/core';
import { getDb, sessions, users } from '@postwerk/db';
import { secureCookies } from './env';

const COOKIE = 'postwerk_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export async function createSession(userId: string, workspaceId?: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().insert(sessions).values({ id: hashToken(token), userId, workspaceId, expiresAt });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/', expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

/**
 * The signed-in user, the workspace this session works in and their role
 * there, or null. Cached per request.
 */
export const getSession = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const sessionId = hashToken(token);
  const [row] = await db
    .select({ user: users, workspaceId: sessions.workspaceId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())));
  if (!row) return null;

  let memberships = await listUserWorkspaces(db, row.user.id);
  if (memberships.length === 0) {
    // Removed from every workspace: start over with a fresh personal one.
    await createWorkspace(db, row.user.id, `${row.user.name}'s workspace`);
    memberships = await listUserWorkspaces(db, row.user.id);
  }
  const membership = memberships.find((candidate) => candidate.id === row.workspaceId) ?? memberships[0]!;
  return {
    sessionId,
    user: row.user,
    workspace: { id: membership.id, name: membership.name },
    role: membership.role,
    theme: membership.theme,
    workspaces: memberships.map(({ id, name, role }) => ({ id, name, role })),
  };
});

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.role === 'editor') throw new Error('Only workspace owners and admins can do this.');
  return session;
}
