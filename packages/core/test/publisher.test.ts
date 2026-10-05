import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, posts, socialAccounts, users, workspaces, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import { deleteAccount, getOrRegisterMastodonApp, saveAccount } from '../src/accounts';
import { decryptJson } from '../src/crypto';
import { createPost, deletePost } from '../src/posts';
import { claimDueTargets, publishTarget, releaseStaleLocks, runPublishCycle } from '../src/publisher';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('publishing (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });

  afterAll(async () => db?.close());

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await db.execute(sql`TRUNCATE users, workspaces, mastodon_apps CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Test' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });

  const sandboxAccount = (name: string) =>
    saveAccount(db, { workspaceId, provider: 'sandbox', profile: { externalId: name, handle: `@${name}` }, credentials: { name } });

  async function post(text: string, accountIds: string[], scheduledAt: Date | null = null) {
    const result = await createPost(db, { workspaceId, authorId: userId, text, accountIds, scheduledAt });
    if (!result.ok) throw new Error(result.errors.join(', '));
    return result.postId;
  }

  const getPost = (id: string) => db.query.posts.findFirst({ where: eq(posts.id, id), with: { targets: true } });

  it('publishes due posts to every account', async () => {
    const [a, b] = await Promise.all([sandboxAccount('one'), sandboxAccount('two')]);
    const id = await post('Hello world', [a.id, b.id]);

    expect(await runPublishCycle(db)).toBe(2);
    const result = await getPost(id);
    expect(result!.status).toBe('published');
    expect(result!.targets.every((t) => t.status === 'published' && t.remoteId && t.publishedAt)).toBe(true);
    expect(await runPublishCycle(db)).toBe(0);
  });

  it('waits until the scheduled time', async () => {
    const account = await sandboxAccount('one');
    const at = new Date(Date.now() + 60 * 60_000);
    const id = await post('Later', [account.id], at);

    expect(await runPublishCycle(db)).toBe(0);
    expect(await runPublishCycle(db, { now: () => new Date(at.getTime() + 1000) })).toBe(1);
    expect((await getPost(id))!.status).toBe('published');
  });

  it('retries retryable errors with backoff, then gives up', async () => {
    const account = await sandboxAccount('one');
    const id = await post('Hello #flaky', [account.id]);
    let now = Date.now();

    expect(await runPublishCycle(db, { now: () => new Date(now) })).toBe(1);
    let target = (await getPost(id))!.targets[0]!;
    expect(target).toMatchObject({ status: 'pending', attempts: 1 });
    expect(target.lastError).toContain('flaky');
    expect(target.nextAttemptAt.getTime()).toBe(now + 60_000);
    expect((await getPost(id))!.status).toBe('publishing');

    // Not due yet.
    expect(await runPublishCycle(db, { now: () => new Date(now + 30_000) })).toBe(0);

    for (let attempt = 2; attempt <= 5; attempt++) {
      now += 2 * 60 * 60_000;
      expect(await runPublishCycle(db, { now: () => new Date(now) })).toBe(1);
    }
    target = (await getPost(id))!.targets[0]!;
    expect(target).toMatchObject({ status: 'failed', attempts: 5 });
    expect((await getPost(id))!.status).toBe('failed');
  });

  it('marks posts partial when only some networks fail', async () => {
    const [a, b] = await Promise.all([sandboxAccount('one'), sandboxAccount('two')]);
    const id = await post('ok', [a.id, b.id]);
    // Credentials that no longer decrypt (e.g. ENCRYPTION_KEY rotated) fail permanently.
    await db.update(socialAccounts).set({ credentialsEnc: 'v1.broken' }).where(eq(socialAccounts.id, b.id));

    await runPublishCycle(db);
    const result = await getPost(id);
    expect(result!.status).toBe('partial');
    expect(result!.targets.find((t) => t.socialAccountId === b.id)!.lastError).toMatch(/reconnect/);
    const broken = await db.query.socialAccounts.findFirst({ where: eq(socialAccounts.id, b.id) });
    expect(broken!.status).toBe('needs_reauth');
  });

  it('marks the account for reconnect when the token is revoked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'revoked' }), { status: 401 })));
    try {
      const account = await saveAccount(db, {
        workspaceId,
        provider: 'mastodon',
        profile: { externalId: 'social.example:1', handle: '@me@social.example' },
        credentials: { instanceUrl: 'https://social.example', accessToken: 't' },
      });
      const id = await post('Hello', [account.id]);
      await runPublishCycle(db);

      const result = await getPost(id);
      expect(result!.status).toBe('failed');
      expect(result!.targets[0]!.attempts).toBe(1);
      const updated = await db.query.socialAccounts.findFirst({ where: eq(socialAccounts.id, account.id) });
      expect(updated!.status).toBe('needs_reauth');

      const again = await createPost(db, { workspaceId, authorId: userId, text: 'x', accountIds: [account.id], scheduledAt: null });
      expect(again).toEqual({ ok: false, errors: ['@me@social.example: Account needs to be reconnected.'] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never hands the same target to two workers', async () => {
    const accounts = await Promise.all(Array.from({ length: 5 }, (_, i) => sandboxAccount(`a${i}`)));
    await post('Hello', accounts.map((a) => a.id));

    const claims = await Promise.all(Array.from({ length: 4 }, () => claimDueTargets(db, 2)));
    const ids = claims.flat();
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('requeues targets left behind by a crashed worker', async () => {
    const account = await sandboxAccount('one');
    const id = await post('Hello', [account.id]);
    const [targetId] = await claimDueTargets(db);

    expect(await releaseStaleLocks(db, new Date(Date.now() + 5 * 60_000))).toBe(0);
    expect(await releaseStaleLocks(db, new Date(Date.now() + 11 * 60_000))).toBe(1);
    await runPublishCycle(db, { now: () => new Date(Date.now() + 11 * 60_000) });
    const result = await getPost(id);
    expect(result!.status).toBe('published');
    expect(result!.targets[0]!.id).toBe(targetId);
  });

  it('validates text against every selected account', async () => {
    const sandbox = await sandboxAccount('one');
    const bsky = await saveAccount(db, {
      workspaceId,
      provider: 'bluesky',
      profile: { externalId: 'did:plc:x', handle: '@me.bsky.social' },
      credentials: {},
    });
    const result = await createPost(db, { workspaceId, authorId: userId, text: 'a'.repeat(301), accountIds: [sandbox.id, bsky.id], scheduledAt: null });
    expect(result).toEqual({ ok: false, errors: ['@me.bsky.social: Text is 301 characters; Bluesky allows 300.'] });
  });

  it('rejects accounts from another workspace', async () => {
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    const foreign = await saveAccount(db, { workspaceId: other!.id, provider: 'sandbox', profile: { externalId: 'f', handle: '@f' }, credentials: { name: 'f' } });
    const result = await createPost(db, { workspaceId, authorId: userId, text: 'x', accountIds: [foreign.id], scheduledAt: null });
    expect(result.ok).toBe(false);
  });

  it('only deletes posts that have not gone out', async () => {
    const account = await sandboxAccount('one');
    const later = await post('Later', [account.id], new Date(Date.now() + 60 * 60_000));
    const now = await post('Now', [account.id]);
    await runPublishCycle(db);

    expect(await deletePost(db, workspaceId, now)).toBe(false);
    expect(await deletePost(db, workspaceId, later)).toBe(true);
    expect(await getPost(later)).toBeUndefined();
  });

  it('drops unpublished posts that lose their last account', async () => {
    const [a, b] = await Promise.all([sandboxAccount('one'), sandboxAccount('two')]);
    const later = new Date(Date.now() + 60 * 60_000);
    const onlyB = await post('only b', [b.id], later);
    const both = await post('both', [a.id, b.id], later);

    await deleteAccount(db, workspaceId, b.id);
    expect(await getPost(onlyB)).toBeUndefined();
    expect((await getPost(both))!.targets).toHaveLength(1);
  });

  it('stores media and per-network options and validates them', async () => {
    const reddit = await saveAccount(db, {
      workspaceId,
      provider: 'reddit',
      profile: { externalId: 'u1', handle: 'u/oli' },
      credentials: { accessToken: 't' },
    });
    const missing = await createPost(db, { workspaceId, authorId: userId, text: 'Body', accountIds: [reddit.id], scheduledAt: null });
    expect(missing).toEqual({ ok: false, errors: ['u/oli: Subreddit is required.', 'u/oli: Title is required.'] });

    const sandbox = await sandboxAccount('one');
    const result = await createPost(db, {
      workspaceId,
      authorId: userId,
      text: 'Body',
      media: [{ url: 'https://cdn.example/a.png', kind: 'image' }],
      options: { reddit: { subreddit: 'physio', title: 'Hello' } },
      accountIds: [sandbox.id],
      scheduledAt: new Date(Date.now() + 60_000),
    });
    expect(result.ok).toBe(true);
    const stored = await getPost((result as { postId: string }).postId);
    expect(stored!.media).toEqual([{ url: 'https://cdn.example/a.png', kind: 'image' }]);
    // Options only apply to the network they belong to.
    expect(stored!.targets[0]!.options).toEqual({});
  });

  it('refreshes expiring tokens before publishing', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'cid';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push(`${init.method ?? 'GET'} ${url}`);
        if (url.includes('/oauth/v2/accessToken')) return Response.json({ access_token: 'new-token', expires_in: 3600, refresh_token: 'r2' });
        return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } });
      }),
    );
    try {
      const account = await saveAccount(db, {
        workspaceId,
        provider: 'linkedin',
        profile: { externalId: 'abc', handle: 'Oli' },
        credentials: { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1000, author: 'urn:li:person:abc' },
      });
      const id = await post('Hello', [account.id]);
      await runPublishCycle(db);

      expect((await getPost(id))!.status).toBe('published');
      expect(requests).toEqual(['POST https://www.linkedin.com/oauth/v2/accessToken', 'POST https://api.linkedin.com/rest/posts']);
      const updated = await db.query.socialAccounts.findFirst({ where: eq(socialAccounts.id, account.id) });
      expect(decryptJson(updated!.credentialsEnc)).toMatchObject({ accessToken: 'new-token', refreshToken: 'r2' });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
    }
  });

  it('shares rotated refresh tokens with accounts from the same login', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'cid';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/oauth/v2/accessToken')
          ? Response.json({ access_token: 'new', expires_in: 3600, refresh_token: 'rotated' })
          : new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } }),
      ),
    );
    try {
      const shared = { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1000 };
      const page = (id: string) =>
        saveAccount(db, {
          workspaceId,
          provider: 'linkedin_page',
          profile: { externalId: `urn:li:organization:${id}`, handle: id },
          credentials: { ...shared, author: `urn:li:organization:${id}` },
        });
      const [one, two] = [await page('1'), await page('2')];
      await post('Hello', [one.id]);
      await runPublishCycle(db);

      const sibling = await db.query.socialAccounts.findFirst({ where: eq(socialAccounts.id, two.id) });
      expect(decryptJson(sibling!.credentialsEnc)).toMatchObject({ accessToken: 'new', refreshToken: 'rotated', author: 'urn:li:organization:2' });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
    }
  });

  it('re-registers a Mastodon app whose secret no longer decrypts', async () => {
    let registrations = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ client_id: `cid-${++registrations}`, client_secret: 'secret' })),
    );
    try {
      const first = await getOrRegisterMastodonApp(db, 'https://social.example', 'https://app/cb', 'Postwerk');
      expect(await getOrRegisterMastodonApp(db, 'https://social.example', 'https://app/cb', 'Postwerk')).toEqual(first);
      await db.execute(sql`UPDATE mastodon_apps SET client_secret_enc = 'v1.broken'`);
      const second = await getOrRegisterMastodonApp(db, 'https://social.example', 'https://app/cb', 'Postwerk');
      expect(second).toEqual({ clientId: 'cid-2', clientSecret: 'secret' });
      expect(registrations).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores unknown targets', async () => {
    await expect(publishTarget(db, '00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});
