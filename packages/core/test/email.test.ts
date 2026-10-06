import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, emailTokens, sessions, users, workspaceMembers, workspaces, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import { saveAccount } from '../src/accounts';
import { setMailTransport, type Mail } from '../src/mail';
import { escapeHtml, inviteMail } from '../src/mail-templates';
import { notifyPostProblem } from '../src/notifications';
import { hashPassword, verifyPassword } from '../src/password';
import { createPost } from '../src/posts';
import { runPublishCycle, type FinishedPost } from '../src/publisher';
import { changePassword, isEmailTokenValid, requestPasswordReset, resetPassword, sendVerificationEmail, updateProfile, verifyEmail } from '../src/users';

const url = process.env.TEST_DATABASE_URL;
const APP = 'https://postwerk.test';

describe('mail templates', () => {
  it('escape user content in the HTML version', () => {
    expect(escapeHtml(`<b>"Tom & Jerry's"</b>`)).toBe('&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;');
    const mail = inviteMail('a@example.com', { inviter: '<script>', workspace: 'A & B', role: 'editor', url: 'https://x.test/invite/t' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('A &amp; B');
    expect(mail.text).toContain('Join A & B: https://x.test/invite/t');
  });
});

describe.skipIf(!url)('email flows (Postgres)', () => {
  let db: Database;
  let sent: Mail[];
  let user: { id: string; name: string; email: string };

  const linkIn = (mail: Mail | undefined) => mail?.text.match(/https:\/\/postwerk\.test\/\S+/)?.[0] ?? '';
  const tokenIn = (mail: Mail | undefined) => linkIn(mail).split('/').pop()!;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });

  afterAll(async () => db?.close());

  beforeEach(async () => {
    sent = [];
    setMailTransport(async (mail) => {
      sent.push(mail);
    });
    await db.execute(sql`TRUNCATE users, workspaces CASCADE`);
    const [row] = await db.insert(users).values({ email: 'ada@example.com', name: 'Ada', passwordHash: await hashPassword('old password 123') }).returning();
    user = { id: row!.id, name: row!.name, email: row!.email };
  });

  afterEach(() => setMailTransport(undefined));

  const getUser = async () => (await db.query.users.findFirst({ where: eq(users.id, user.id) }))!;

  it('confirms an email address once', async () => {
    await sendVerificationEmail(db, user, APP);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ada@example.com', subject: 'Confirm your email address' });
    expect(linkIn(sent[0])).toMatch(/^https:\/\/postwerk\.test\/verify-email\//);

    const token = tokenIn(sent[0]);
    expect(await verifyEmail(db, token)).toBe(user.id);
    expect((await getUser()).emailVerifiedAt).toBeInstanceOf(Date);
    expect(await verifyEmail(db, token)).toBeUndefined();
  });

  it('does not confirm an address the account no longer uses', async () => {
    await sendVerificationEmail(db, user, APP);
    await db.update(users).set({ email: 'new@example.com' }).where(eq(users.id, user.id));
    expect(await verifyEmail(db, tokenIn(sent[0]))).toBeUndefined();
    expect((await getUser()).emailVerifiedAt).toBeNull();
  });

  it('only emails a reset link to existing accounts', async () => {
    expect(await requestPasswordReset(db, 'nobody@example.com', APP)).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(await requestPasswordReset(db, ' ADA@example.com ', APP)).toBe(user.id);
    expect(sent[0]).toMatchObject({ to: 'ada@example.com', subject: 'Reset your Postwerk password' });
  });

  it('resets the password once, signs out everywhere and confirms the address', async () => {
    await db.insert(sessions).values({ id: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    await requestPasswordReset(db, user.email, APP);
    await requestPasswordReset(db, user.email, APP);
    const [first, second] = sent.map(tokenIn);

    // A too-short password does not use up the link.
    await expect(resetPassword(db, second!, 'short')).rejects.toThrow(/at least 10/);
    expect(await isEmailTokenValid(db, second!, 'reset_password')).toBe(true);

    expect(await resetPassword(db, second!, 'brand new password')).toBe(user.id);
    const updated = await getUser();
    expect(await verifyPassword('brand new password', updated.passwordHash)).toBe(true);
    expect(updated.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sessions)).toHaveLength(0);
    // Every other reset link is gone too.
    expect(await db.select().from(emailTokens)).toHaveLength(0);
    await expect(resetPassword(db, first!, 'another new password')).rejects.toThrow(/expired or was already used/);
    await expect(resetPassword(db, second!, 'another new password')).rejects.toThrow(/expired or was already used/);
  });

  it('changes the password with the current one and keeps only this session', async () => {
    const later = new Date(Date.now() + 60_000);
    await db.insert(sessions).values([
      { id: 'this', userId: user.id, expiresAt: later },
      { id: 'other', userId: user.id, expiresAt: later },
    ]);
    await expect(changePassword(db, user.id, 'wrong', 'brand new password', 'this')).rejects.toThrow(/current password/);
    await changePassword(db, user.id, 'old password 123', 'brand new password', 'this');
    expect((await db.select().from(sessions)).map((row) => row.id)).toEqual(['this']);
    expect(await verifyPassword('brand new password', (await getUser()).passwordHash)).toBe(true);
  });

  it('emails the author once when a post fails, unless they opted out', async () => {
    const [workspace] = await db.insert(workspaces).values({ name: 'W' }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId: user.id, role: 'owner' });
    const good = await saveAccount(db, { workspaceId: workspace!.id, provider: 'sandbox', profile: { externalId: 'good', handle: '@good' }, credentials: { name: 'good' } });
    const post = async (text: string) => {
      const result = await createPost(db, { workspaceId: workspace!.id, authorId: user.id, text, accountIds: [good.id], scheduledAt: null });
      if (!result.ok) throw new Error(result.errors.join());
      return result.postId;
    };
    const finished: FinishedPost[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failing = await post('Broken #fail');
    await post('Fine');
    await runPublishCycle(db, { onPostFinished: async (done) => void finished.push(done) });
    expect(finished.map((done) => done.status).sort()).toEqual(['failed', 'published']);

    for (const done of finished) await notifyPostProblem(db, done, APP);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ada@example.com', subject: 'A post could not be published' });
    expect(sent[0]!.text).toContain('“Broken #fail”');
    expect(sent[0]!.text).toContain('@good (Sandbox): Sandbox rejected the post (#fail).');
    expect(finished.find((done) => done.postId === failing)).toBeDefined();

    await updateProfile(db, user.id, { notifyFailures: false });
    expect(await notifyPostProblem(db, { postId: failing, status: 'failed' }, APP)).toBe(0);
    vi.restoreAllMocks();
  });
});
