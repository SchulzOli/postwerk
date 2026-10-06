import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, oauthStates, rateLimits, sessions, users, workspaces, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import { audit, listUserSecurityAudit, listWorkspaceAudit } from '../src/audit';
import { runHousekeeping } from '../src/housekeeping';
import { checkRateLimit, clearRateLimit, hitRateLimit, rateLimitKey, retryIn } from '../src/ratelimit';

const url = process.env.TEST_DATABASE_URL;

describe('retryIn', () => {
  it('rounds up to whole minutes', () => {
    expect(retryIn(10_000)).toBe('in a minute');
    expect(retryIn(12 * 60_000 + 1)).toBe('in 13 minutes');
  });
});

describe.skipIf(!url)('rate limits and audit log (Postgres)', () => {
  let db: Database;
  let userId: string;
  let workspaceId: string;
  const rule = { limit: 3, windowMs: 60_000 };

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });

  afterAll(async () => db?.close());

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, workspaces, rate_limits, audit_log, oauth_states CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'Ada', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Test' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });

  it('allows up to the limit per window, then blocks until it resets', async () => {
    const key = rateLimitKey('login:email', ' A@Example.com ');
    expect(key).toBe('login:email:a@example.com');
    const start = new Date('2026-01-01T00:00:00Z');
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(db, key, rule, start));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
    expect(results[3]!.retryAfterMs).toBe(60_000);

    const later = new Date(start.getTime() + 61_000);
    expect(await hitRateLimit(db, key, rule, later)).toMatchObject({ allowed: true, count: 1 });
  });

  it('checks without counting, and clears', async () => {
    const key = 'login:email:b@example.com';
    const now = new Date();
    expect(await checkRateLimit(db, key, rule, now)).toMatchObject({ allowed: true, count: 0 });
    for (let i = 0; i < 3; i++) await hitRateLimit(db, key, rule, now);
    expect(await checkRateLimit(db, key, rule, now)).toMatchObject({ allowed: false, count: 3 });
    expect(await checkRateLimit(db, key, rule, now)).toMatchObject({ count: 3 });
    await clearRateLimit(db, key);
    expect(await checkRateLimit(db, key, rule, now)).toMatchObject({ allowed: true });
  });

  it('counts concurrent requests exactly', async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit(db, 'burst', rule, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('records workspace and personal events separately', async () => {
    await audit(db, { action: 'login.succeeded', userId, ip: '203.0.113.7' });
    await audit(db, { action: 'account.connected', userId, workspaceId, target: '@demo', details: { provider: 'sandbox' } });
    const workspaceEvents = await listWorkspaceAudit(db, workspaceId);
    expect(workspaceEvents).toHaveLength(1);
    expect(workspaceEvents[0]).toMatchObject({ action: 'account.connected', target: '@demo', details: { provider: 'sandbox' }, user: { name: 'Ada' } });
    const personal = await listUserSecurityAudit(db, userId);
    expect(personal.map((entry) => [entry.action, entry.ip])).toEqual([['login.succeeded', '203.0.113.7']]);
  });

  it('pages through activity with `before`', async () => {
    for (let i = 0; i < 3; i++) {
      await audit(db, { action: 'flow.created', userId, workspaceId, target: `Flow ${i}` });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const [newest, middle] = await listWorkspaceAudit(db, workspaceId, { limit: 2 });
    expect([newest!.target, middle!.target]).toEqual(['Flow 2', 'Flow 1']);
    const older = await listWorkspaceAudit(db, workspaceId, { before: middle!.createdAt });
    expect(older.map((entry) => entry.target)).toEqual(['Flow 0']);
  });

  it('never throws when the audit row cannot be written', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(audit(db, { action: 'flow.created', workspaceId: '00000000-0000-0000-0000-000000000000' })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('housekeeping drops expired counters, sign-in states and sessions', async () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);
    await db.insert(rateLimits).values([
      { key: 'old', count: 1, resetAt: past },
      { key: 'new', count: 1, resetAt: future },
    ]);
    await db.insert(oauthStates).values({ state: 's', workspaceId, userId, provider: 'mastodon', expiresAt: past });
    await db.insert(sessions).values([
      { id: 'expired', userId, expiresAt: past },
      { id: 'valid', userId, expiresAt: future },
    ]);
    await runHousekeeping(db);
    expect((await db.select().from(rateLimits)).map((row) => row.key)).toEqual(['new']);
    expect(await db.select().from(oauthStates)).toHaveLength(0);
    expect((await db.select().from(sessions)).map((row) => row.id)).toEqual(['valid']);
  });
});
