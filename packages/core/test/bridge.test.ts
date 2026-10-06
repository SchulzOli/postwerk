import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeProfiles, createDb, posts, postTargets, socialAccounts, users, workspaces, type Database } from '@postwerk/db';
import { mockFetch } from '../../providers/test/helpers';
import { runMigrations } from '../../db/src/migrate';
import { consumeOAuthState, saveConnectedAccounts } from '../src/accounts';
import { bridgeFor, disconnectAccount, finishBridgeConnect, networkRoute, startBridgeConnect } from '../src/bridge';
import { createPost } from '../src/posts';
import { runPublishCycle } from '../src/publisher';

const API = 'https://zernio.test/api/v1';
const env = { ZERNIO_API_KEY: 'zk_test', ZERNIO_BASE_URL: 'https://zernio.test/api' };

describe('network routing', () => {
  it('prefers the network’s own API, then the bridge, then "coming soon"', () => {
    expect(networkRoute('instagram', {})).toBe('unavailable');
    expect(networkRoute('instagram', env)).toBe('bridge');
    expect(networkRoute('instagram', { ...env, INSTAGRAM_CLIENT_ID: 'id', INSTAGRAM_CLIENT_SECRET: 'secret' })).toBe('native');
    // Networks that work without setup never need the bridge.
    expect(networkRoute('mastodon', env)).toBe('native');
    expect(networkRoute('telegram', env)).toBe('native');
  });

  it('follows the admin’s list of bridged networks', () => {
    const listed = { ...env, ZERNIO_NETWORKS: 'linkedin, x', LINKEDIN_CLIENT_ID: 'id', LINKEDIN_CLIENT_SECRET: 'secret' };
    expect(networkRoute('linkedin', listed)).toBe('bridge');
    expect(networkRoute('x', listed)).toBe('bridge');
    expect(networkRoute('instagram', listed)).toBe('unavailable');
    expect(networkRoute('mastodon', { ...listed, ZERNIO_NETWORKS: 'mastodon' })).toBe('native');
  });

  it('names the bridge that could cover a network, for the setup notes', () => {
    expect(bridgeFor('tiktok')).toEqual({ name: 'Zernio', env: 'ZERNIO_API_KEY' });
    expect(bridgeFor('telegram')).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('connecting and publishing through the bridge (Postgres)', () => {
  let db: Database;
  let workspace: { id: string; name: string };
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await db.execute(sql`TRUNCATE users, workspaces CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [row] = await db.insert(workspaces).values({ name: 'Praxis' }).returning();
    userId = user!.id;
    workspace = { id: row!.id, name: row!.name };
  });
  afterEach(() => vi.unstubAllGlobals());

  const appUrl = 'https://app.test';
  const instagram = { _id: 'acc_ig', platform: 'instagram', username: 'praxis', displayName: 'Praxis', profilePicture: 'https://img/p.png', platformUserId: '1784', isActive: true };

  async function connect(accounts: (profileId: string) => object[] = () => [instagram]) {
    let created = 0;
    const calls = mockFetch([
      [`POST ${API}/profiles`, () => ({ profile: { _id: `prof_${++created}` } })],
      [`GET ${API}/connect/instagram`, (call) => ({ authUrl: `https://zernio.test/auth?redirect=${encodeURIComponent(new URL(call.url).searchParams.get('redirect_url')!)}` })],
      [`GET ${API}/accounts`, (call) => ({ accounts: accounts(new URL(call.url).searchParams.get('profileId')!) })],
    ]);
    const target = await startBridgeConnect(db, { workspace, userId, network: 'instagram', appUrl }, env);
    const redirect = new URL(new URL(target).searchParams.get('redirect')!);
    return { calls, redirect, state: redirect.searchParams.get('state')! };
  }

  it('creates a profile for the workspace and connects the account the bridge reports', async () => {
    const { redirect, state } = await connect(() => []);
    expect(`${redirect.origin}${redirect.pathname}`).toBe('https://app.test/api/bridge/callback');
    const [profile] = await db.select().from(bridgeProfiles);
    expect(profile).toMatchObject({ workspaceId: workspace.id, bridge: 'zernio', profileId: 'prof_1' });

    mockFetch([[`GET ${API}/accounts`, () => ({ accounts: [instagram] })]]);
    const stored = (await consumeOAuthState(db, state, userId))!;
    const account = await finishBridgeConnect(stored, { accountId: 'acc_ig', profileId: 'prof_1' }, env);
    expect(account).toEqual({
      profile: { externalId: 'zernio:1784', handle: '@praxis', displayName: 'Praxis', avatarUrl: 'https://img/p.png' },
      credentials: { via: 'zernio', accountId: 'acc_ig', profileId: 'prof_1' },
    });
  });

  it('uses another profile when the first already has an account of the network', async () => {
    await db.insert(bridgeProfiles).values({ workspaceId: workspace.id, bridge: 'zernio', profileId: 'prof_full' });
    const { calls } = await connect((profileId) => (profileId === 'prof_full' ? [instagram] : []));
    expect(calls.map((call) => `${call.method} ${call.url.split('?')[0]}`)).toEqual([`GET ${API}/accounts`, `POST ${API}/profiles`, `GET ${API}/connect/instagram`]);
    expect(calls[1]!.body).toMatchObject({ name: 'Praxis · Postwerk 2' });
    expect(new URL(calls[2]!.url).searchParams.get('profileId')).toBe('prof_1');
  });

  it('refuses accounts from another profile', async () => {
    const { state } = await connect(() => []);
    const stored = (await consumeOAuthState(db, state, userId))!;
    await expect(finishBridgeConnect(stored, { accountId: 'acc_ig', profileId: 'prof_other' }, env)).rejects.toThrow(/expired/);
    mockFetch([[`GET ${API}/accounts`, () => ({ accounts: [] })]]);
    await expect(finishBridgeConnect(stored, { accountId: 'acc_someone_else', profileId: null }, env)).rejects.toThrow(/did not report/);
  });

  it('publishes bridged accounts through the bridge and disconnects them there', async () => {
    vi.stubEnv('ZERNIO_API_KEY', env.ZERNIO_API_KEY);
    vi.stubEnv('ZERNIO_BASE_URL', env.ZERNIO_BASE_URL);
    const [saved] = await saveConnectedAccounts(
      db,
      workspace.id,
      'instagram',
      [{ profile: { externalId: 'zernio:1784', handle: '@praxis' }, credentials: { via: 'zernio', accountId: 'acc_ig', profileId: 'prof_1' } }],
      'zernio',
    );
    expect(saved!.bridge).toBe('zernio');
    const created = await createPost(db, {
      workspaceId: workspace.id,
      authorId: userId,
      text: 'Hallo',
      media: [{ url: 'https://cdn.example/a.jpg', kind: 'image' }],
      accountIds: [saved!.id],
      scheduledAt: null,
    });
    if (!created.ok) throw new Error(created.errors.join());

    const calls = mockFetch([
      [
        `POST ${API}/posts`,
        () => ({ post: { _id: 'post_1', platforms: [{ accountId: 'acc_ig', status: 'published', platformPostId: 'ig_9', platformPostUrl: 'https://instagram.com/p/9' }] } }),
      ],
      [`DELETE ${API}/accounts/acc_ig`, () => new Response(null, { status: 204 })],
    ]);
    await runPublishCycle(db);
    const [target] = await db.select().from(postTargets).where(eq(postTargets.postId, created.postId));
    expect(target).toMatchObject({ status: 'published', remoteId: 'ig_9', remoteUrl: 'https://instagram.com/p/9' });
    expect(calls[0]!.headers['idempotency-key']).toBe(target!.id);
    expect((await db.select().from(posts).where(eq(posts.id, created.postId)))[0]!.status).toBe('published');

    expect(await disconnectAccount(db, workspace.id, saved!.id)).toMatchObject({ handle: '@praxis' });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `${API}/accounts/acc_ig` });
    expect(await db.select().from(socialAccounts)).toEqual([]);
    vi.unstubAllEnvs();
  });
});
