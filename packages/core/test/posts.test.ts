import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, posts, postTargets, users, workspaces, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import { saveAccount } from '../src/accounts';
import { planPost } from '../src/flow';
import { createFlow, saveFlow } from '../src/flows';
import { createPost, getPostForEdit, reschedulePost, retryPost, updatePost } from '../src/posts';
import { runPublishCycle } from '../src/publisher';

describe('planPost', () => {
  const providerOf = (id: string) => ({ a: 'mastodon', b: 'linkedin' })[id];
  it('gives each network its own text, or the main one', () => {
    const plan = planPost({ text: 'Hello', variants: { linkedin: 'Hello, professionals' }, providerOf, accountIds: ['a', 'b', 'a'] });
    expect(plan.targets).toEqual([
      { accountId: 'a', text: 'Hello', delayMinutes: 0 },
      { accountId: 'b', text: 'Hello, professionals', delayMinutes: 0 },
    ]);
  });

  it('runs the flow on each network’s text', () => {
    const graph = {
      steps: [
        { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 } },
        { id: 'add', type: 'addText' as const, placement: 'end' as const, text: '#tag', position: { x: 0, y: 0 } },
        { id: 'a', type: 'target' as const, accountId: 'a', position: { x: 0, y: 0 } },
        { id: 'wait', type: 'delay' as const, minutes: 30, position: { x: 0, y: 0 } },
        { id: 'b', type: 'target' as const, accountId: 'b', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 't', target: 'add' },
        { id: '2', source: 'add', target: 'a' },
        { id: '3', source: 'add', target: 'wait' },
        { id: '4', source: 'wait', target: 'b' },
      ],
    };
    const plan = planPost({ text: 'Hi', variants: { linkedin: 'Dear network' }, providerOf, graph });
    expect(plan.targets).toEqual([
      { accountId: 'a', text: 'Hi\n\n#tag', delayMinutes: 0 },
      { accountId: 'b', text: 'Dear network\n\n#tag', delayMinutes: 30 },
    ]);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('editing posts (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let authorId: string;
  let one: string;
  let two: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await db.execute(sql`TRUNCATE users, workspaces CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'W' }).returning();
    authorId = user!.id;
    workspaceId = workspace!.id;
    const account = (name: string) => saveAccount(db, { workspaceId, provider: 'sandbox', profile: { externalId: name, handle: `@${name}` }, credentials: { name } });
    one = (await account('one')).id;
    two = (await account('two')).id;
  });

  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
  async function create(input: Partial<Parameters<typeof createPost>[1]> = {}) {
    const result = await createPost(db, { workspaceId, authorId, text: 'Hello', accountIds: [one], scheduledAt: later(60), ...input });
    if (!result.ok) throw new Error(result.errors.join());
    return result.postId;
  }
  const targetsOf = (postId: string) => db.select().from(postTargets).where(eq(postTargets.postId, postId)).orderBy(postTargets.delayMinutes);
  const postOf = async (postId: string) => (await db.select().from(posts).where(eq(posts.id, postId)))[0]!;

  it('stores per-network text only where it differs and is used', async () => {
    const id = await create({ variants: { sandbox: 'Hello sandbox', mastodon: 'Not used', x: '' } });
    expect((await postOf(id)).variants).toEqual({ sandbox: 'Hello sandbox' });
    expect((await targetsOf(id)).map((target) => target.text)).toEqual(['Hello sandbox']);
  });

  it('replaces text, accounts and time of a scheduled post', async () => {
    const id = await create();
    const at = later(120);
    expect(await updatePost(db, id, { workspaceId, text: 'Changed', accountIds: [one, two], scheduledAt: at })).toEqual({ ok: true });
    const post = await postOf(id);
    expect(post).toMatchObject({ text: 'Changed', status: 'scheduled' });
    expect(post.scheduledAt!.getTime()).toBe(at.getTime());
    const targets = await targetsOf(id);
    expect(targets.map((target) => target.socialAccountId).sort()).toEqual([one, two].sort());
    expect(targets.every((target) => target.nextAttemptAt.getTime() === at.getTime())).toBe(true);
  });

  it('validates edits like new posts', async () => {
    const id = await create();
    const result = await updatePost(db, id, { workspaceId, text: '   ', accountIds: [one], scheduledAt: later(5) });
    expect(result).toMatchObject({ ok: false });
    expect((await postOf(id)).text).toBe('Hello');
  });

  it('refuses changes once a post went out', async () => {
    const id = await create({ scheduledAt: null });
    await runPublishCycle(db);
    expect((await postOf(id)).status).toBe('published');
    expect(await updatePost(db, id, { workspaceId, text: 'Too late', accountIds: [one], scheduledAt: null })).toEqual({
      ok: false,
      errors: ['This post is already going out, so it cannot be changed anymore.'],
    });
    expect(await reschedulePost(db, workspaceId, id, later(10))).toMatchObject({ ok: false });
  });

  it('refuses posts of other workspaces', async () => {
    const id = await create();
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    expect(await updatePost(db, id, { workspaceId: other!.id, text: 'x', accountIds: [], scheduledAt: null })).toEqual({ ok: false, errors: ['This post no longer exists.'] });
    expect(await getPostForEdit(db, other!.id, id)).toBeUndefined();
  });

  it('keeps a flow’s delays when rescheduling', async () => {
    const flow = await createFlow(db, workspaceId, { name: 'Spread', x: 0, y: 0 });
    await saveFlow(db, workspaceId, flow.id, {
      graph: {
        steps: [
          { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 } },
          { id: 'a', type: 'target', accountId: one, position: { x: 0, y: 0 } },
          { id: 'wait', type: 'delay', minutes: 45, position: { x: 0, y: 0 } },
          { id: 'b', type: 'target', accountId: two, position: { x: 0, y: 0 } },
        ],
        edges: [
          { id: '1', source: 'trigger', target: 'a' },
          { id: '2', source: 'trigger', target: 'wait' },
          { id: '3', source: 'wait', target: 'b' },
        ],
      },
    });
    const id = await create({ flowId: flow.id, accountIds: undefined });
    expect((await targetsOf(id)).map((target) => target.delayMinutes)).toEqual([0, 45]);

    const at = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    expect(await reschedulePost(db, workspaceId, id, at)).toEqual({ ok: true });
    const targets = await targetsOf(id);
    expect(targets.map((target) => target.nextAttemptAt.getTime() - at.getTime())).toEqual([0, 45 * 60_000]);
    expect((await postOf(id)).scheduledAt!.getTime()).toBe(at.getTime());
  });

  it('retries the failed networks of a post', async () => {
    const id = await create({ text: 'Broken #fail', accountIds: [one, two], scheduledAt: null });
    await runPublishCycle(db);
    expect((await postOf(id)).status).toBe('failed');
    expect(await retryPost(db, workspaceId, id)).toBe(true);
    expect((await postOf(id)).status).toBe('publishing');
    expect((await targetsOf(id)).every((target) => target.status === 'pending' && target.attempts === 0 && target.lastError === null)).toBe(true);
    await runPublishCycle(db);
    expect((await postOf(id)).status).toBe('failed');
    expect(await retryPost(db, workspaceId, await create())).toBe(false);
  });

  it('loads a post for the composer', async () => {
    const id = await create({ accountIds: [one, two], variants: { sandbox: 'Sandbox text' }, media: [{ url: 'https://example.com/a.jpg', kind: 'image', altText: 'A' }] });
    expect(await getPostForEdit(db, workspaceId, id)).toMatchObject({
      id,
      editable: true,
      text: 'Hello',
      variants: { sandbox: 'Sandbox text' },
      media: [{ url: 'https://example.com/a.jpg', kind: 'image', altText: 'A' }],
      accountIds: expect.arrayContaining([one, two]),
      flowId: null,
    });
  });
});
