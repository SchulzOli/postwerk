import { asc, eq } from 'drizzle-orm';
import { isProviderAvailable, listFlows, listPosts, listWorkspaceAudit, loadCanvasPositions, needsEmailVerification } from '@postwerk/core';
import { builtinThemes, defaultCanvas } from '@postwerk/core/theme';
import { getDb, socialAccounts } from '@postwerk/db';
import { getProvider, providerInfos } from '@postwerk/providers';
import { World, type WorldData } from '@/components/world/world';
import { toActivity } from '@/lib/activity-server';
import { getAppearance } from '@/lib/appearance';
import { requireSession } from '@/lib/session';
import { loadTeam } from '@/lib/team';

export const metadata = { title: 'Canvas · Postwerk' };

export default async function CanvasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { user, workspace, role } = session;
  const { connected, error, notice } = await searchParams;
  const db = getDb();
  const canManage = role !== 'editor';
  const [accounts, flows, posts, positions, appearance, activity, team] = await Promise.all([
    db.query.socialAccounts.findMany({
      where: eq(socialAccounts.workspaceId, workspace.id),
      orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)],
    }),
    listFlows(db, workspace.id),
    listPosts(db, workspace.id),
    loadCanvasPositions(db, workspace.id),
    getAppearance(),
    canManage ? listWorkspaceAudit(db, workspace.id, { limit: 30 }) : null,
    loadTeam(session),
  ]);
  const installed = new Set(appearance.installed.map((plugin) => plugin.id));

  const data: WorldData = {
    user: { name: user.name, email: user.email },
    needsVerification: needsEmailVerification(user),
    workspace,
    workspaces: session.workspaces,
    team,
    canManage,
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
      media: post.media.slice(0, 4).map(({ url, kind, altText }) => ({ url, kind, altText })),
      targets: post.targets.map((target) => ({ accountId: target.socialAccountId, status: target.status, url: target.remoteUrl, error: target.lastError })),
    })),
    positions,
    plugins: [
      ...builtinThemes.map((manifest) => ({ manifest, builtin: true, installed: installed.has(manifest.id) })),
      ...appearance.installed.filter((plugin) => !plugin.builtin).map((plugin) => ({ manifest: plugin.manifest, builtin: false, installed: true })),
    ],
    activity: activity?.map(toActivity) ?? null,
    appearance: { mode: appearance.mode, themeId: appearance.theme?.id ?? null, canvas: appearance.theme?.canvas ?? defaultCanvas },
    notice: connected
      ? { kind: 'success', text: `Connected ${connected}.` }
      : error
        ? { kind: 'error', text: error }
        : notice === 'verified'
          ? { kind: 'success', text: 'Thanks, your email address is confirmed.' }
          : notice === 'verify-expired'
            ? { kind: 'error', text: 'That confirmation link has expired. Send a new one from your account settings.' }
            : null,
  };
  // A different workspace is a different world: remount instead of merging.
  return <World key={workspace.id} data={data} />;
}
