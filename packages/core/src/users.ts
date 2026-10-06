import { and, eq, gt, ne } from 'drizzle-orm';
import { emailTokens, sessions, users, type Database, type Transaction } from '@postwerk/db';
import { isMailConfigured, sendMail } from './mail';
import { resetPasswordMail, verifyEmailMail } from './mail-templates';
import { generateToken, hashPassword, hashToken, verifyPassword } from './password';

export const VERIFY_TTL_MS = 3 * 24 * 60 * 60_000;
export const RESET_TTL_MS = 60 * 60_000;
export const MIN_PASSWORD_LENGTH = 10;

type TokenKind = 'verify_email' | 'reset_password';

/** Problem with what the user typed; the message is meant for them. */
export class UserInputError extends Error {}

export function checkNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new UserInputError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  if (password.length > 500) throw new UserInputError('That password is too long.');
}

async function createEmailToken(db: Database, userId: string, kind: TokenKind, email: string, ttlMs: number, now = new Date()): Promise<string> {
  const token = generateToken();
  await db.insert(emailTokens).values({ tokenHash: hashToken(token), userId, kind, email, expiresAt: new Date(now.getTime() + ttlMs) });
  return token;
}

/** Single use: the token is deleted whether or not it is still valid. */
async function consumeEmailToken(db: Database | Transaction, token: string, kind: TokenKind, now = new Date()) {
  const [row] = await db.delete(emailTokens).where(eq(emailTokens.tokenHash, hashToken(token))).returning();
  if (!row || row.kind !== kind || row.expiresAt <= now) return undefined;
  return row;
}

/** Whether a reset/verification link is still usable, without using it up (for showing the form). */
export async function isEmailTokenValid(db: Database, token: string, kind: TokenKind, now = new Date()): Promise<boolean> {
  const row = await db.query.emailTokens.findFirst({ where: and(eq(emailTokens.tokenHash, hashToken(token)), eq(emailTokens.kind, kind), gt(emailTokens.expiresAt, now)) });
  return Boolean(row);
}

/** Emails a confirmation link for the user's current address. */
export async function sendVerificationEmail(db: Database, user: { id: string; name: string; email: string }, appUrl: string): Promise<void> {
  const token = await createEmailToken(db, user.id, 'verify_email', user.email, VERIFY_TTL_MS);
  await sendMail(verifyEmailMail(user.email, user.name, `${appUrl}/verify-email/${token}`));
}

/** Confirms the address the link was sent to; returns the user id, or undefined for a bad link. */
export async function verifyEmail(db: Database, token: string): Promise<string | undefined> {
  const row = await consumeEmailToken(db, token, 'verify_email');
  if (!row) return undefined;
  // Only confirm if the account still uses the address the link went to.
  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, row.userId), eq(users.email, row.email)))
    .returning({ id: users.id });
  return updated[0]?.id;
}

/** Whether to remind the user to confirm their address (only when email is set up at all). */
export function needsEmailVerification(user: { emailVerifiedAt: Date | null }): boolean {
  return isMailConfigured() && !user.emailVerifiedAt;
}

/**
 * Emails a reset link if an account exists for `email`. Returns the user id
 * (for the audit log) but callers must answer the same either way, so the
 * form does not reveal who has an account.
 */
export async function requestPasswordReset(db: Database, email: string, appUrl: string): Promise<string | undefined> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user) return undefined;
  const token = await createEmailToken(db, user.id, 'reset_password', user.email, RESET_TTL_MS);
  await sendMail(resetPasswordMail(user.email, user.name, `${appUrl}/reset-password/${token}`));
  return user.id;
}

/**
 * Sets a new password from a reset link. Signs the user out everywhere and
 * invalidates other reset links. Receiving the link also proves the address.
 */
export async function resetPassword(db: Database, token: string, password: string): Promise<string> {
  checkNewPassword(password);
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const row = await consumeEmailToken(tx, token, 'reset_password');
    if (!row) throw new UserInputError('This reset link has expired or was already used. Ask for a new one.');
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, row.userId), eq(users.email, row.email)));
    await tx.delete(emailTokens).where(and(eq(emailTokens.userId, row.userId), eq(emailTokens.kind, 'reset_password')));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    return row.userId;
  });
}

/** Changes the password after checking the current one; other sessions are signed out. */
export async function changePassword(db: Database, userId: string, current: string, next: string, keepSessionId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new UserInputError('Your current password is not right.');
  checkNewPassword(next);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

export async function updateProfile(db: Database, userId: string, input: { name?: string; notifyFailures?: boolean }): Promise<void> {
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new UserInputError('Please enter your name.');
    set.name = name;
  }
  if (input.notifyFailures !== undefined) set.notifyFailures = input.notifyFailures;
  if (Object.keys(set).length > 0) await db.update(users).set(set).where(eq(users.id, userId));
}
