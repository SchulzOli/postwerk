import { and, eq, gt, ne } from 'drizzle-orm';
import { emailTokens, sessions, users, type Database, type Transaction } from '@postwerk/db';
import { isLocale, LocalizedError, type Locale } from './i18n';
import { isMailConfigured, sendMail } from './mail';
import { resetPasswordMail, verifyEmailMail } from './mail-templates';
import { userMessages } from './messages';
import { generateToken, hashPassword, hashToken, verifyPassword } from './password';

export const VERIFY_TTL_MS = 3 * 24 * 60 * 60_000;
export const RESET_TTL_MS = 60 * 60_000;
export const MIN_PASSWORD_LENGTH = 10;

type TokenKind = 'verify_email' | 'reset_password';

/** Problem with what the user typed; the message is meant for them. */
export class UserInputError extends LocalizedError {
  constructor(pick: (m: (typeof userMessages)['en']) => string) {
    super((locale) => pick(userMessages[locale]));
  }
}

export function checkNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new UserInputError((m) => m.passwordTooShort(MIN_PASSWORD_LENGTH));
  if (password.length > 500) throw new UserInputError((m) => m.passwordTooLong);
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
export async function sendVerificationEmail(db: Database, user: { id: string; name: string; email: string }, appUrl: string, locale: Locale = 'en'): Promise<void> {
  const token = await createEmailToken(db, user.id, 'verify_email', user.email, VERIFY_TTL_MS);
  await sendMail(verifyEmailMail(user.email, user.name, `${appUrl}/verify-email/${token}`, locale));
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
export async function requestPasswordReset(db: Database, email: string, appUrl: string, locale: Locale = 'en'): Promise<string | undefined> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user) return undefined;
  const token = await createEmailToken(db, user.id, 'reset_password', user.email, RESET_TTL_MS);
  // In the language the person chose, else the one they are using right now.
  await sendMail(resetPasswordMail(user.email, user.name, `${appUrl}/reset-password/${token}`, isLocale(user.locale) ? user.locale : locale));
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
    if (!row) throw new UserInputError((m) => m.resetExpired);
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
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new UserInputError((m) => m.wrongPassword);
  checkNewPassword(next);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

/** `locale: null` follows the browser's language. */
export async function updateProfile(db: Database, userId: string, input: { name?: string; notifyFailures?: boolean; locale?: Locale | null }): Promise<void> {
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new UserInputError((m) => m.enterName);
    set.name = name;
  }
  if (input.notifyFailures !== undefined) set.notifyFailures = input.notifyFailures;
  if (input.locale !== undefined) set.locale = input.locale;
  if (Object.keys(set).length > 0) await db.update(users).set(set).where(eq(users.id, userId));
}
