import { asc, eq } from 'drizzle-orm';
import { isProviderAvailable, listFlows, listPosts, loadCanvasPositions } from '@postwerk/core';
import { getDb, socialAccounts } from '@postwerk/db';
import { getProvider, providerInfos } from '@postwerk/providers';
import { World, type WorldData } from '@/components/world/world';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Canvas · Postwerk' };

export default async function CanvasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, workspace, role } = await requireSession();
  const { connected, error } = await searchParams;
  const db = getDb();
  const [accounts, flows, posts, positions] = await Promise.all([
    db.query.socialAccounts.findMany({
      where: eq(socialAccounts.workspaceId, workspace.id),
      orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)],
    }),
    listFlows(db, workspace.id),
    listPosts(db, workspace.id),
    loadCanvasPositions(db, workspace.id),
  ]);

  const data: WorldData = {
    user: { name: user.name, email: user.email },
    workspace: { name: workspace.name },
    canManage: role !== 'editor',
    networks: providerInfos
      .filter((info) => info.id !== 'sandbox' || isProviderAvailable('sandbox'))
      .map((info) => {
        const { connector } = getProvider(info.id);
        return {
          info,
          available: isProviderAvailable(info.id),
          connector: connector.kind === 'form' ? { kind: 'form' as const, fields: connector.fields } : { kind: connector.kind },
        };
      }),
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      handle: account.handle,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      maxLength: account.maxLength,
      status: account.status,
    })),
    flows: flows.map((flow) => ({ id: flow.id, name: flow.name, graph: flow.graph, x: flow.x, y: flow.y })),
    posts: posts.slice(0, 12).map((post) => ({
      id: post.id,
      text: post.text,
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      mediaCount: post.media.length,
      targets: post.targets.map((target) => ({ accountId: target.socialAccountId, status: target.status, url: target.remoteUrl, error: target.lastError })),
    })),
    positions,
    notice: connected ? { kind: 'success', text: `Connected ${connected}.` } : error ? { kind: 'error', text: error } : null,
  };
  return <World data={data} />;
}
