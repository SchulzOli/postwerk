import { asc, eq } from 'drizzle-orm';
import { bridgeFor, bridgeSetup, bridgeUsageSummary, findMedia, getBrandKit, isBlueskyOAuthAvailable, listCampaigns, isProviderAvailable, listFlows, listPosts, listWorkspaceAudit, loadCanvasPositions, needsEmailVerification, networkRoute } from '@maas/core';
import { builtinThemes, defaultCanvas } from '@maas/core/theme';
import { getDb, socialAccounts } from '@maas/db';
import { bridges, getProvider, isBridgeId, localizeFields, localizeInfo, providerInfos } from '@maas/providers';
import { World, type WorldData } from '@/components/world/world';
import { toActivity } from '@/lib/activity-server';
import { loadCalendarAroundNow } from '@/lib/calendar-server';
import { appUrl, redirectUriFor } from '@/lib/env';
import { getAppearance } from '@/lib/appearance';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { legalLinks } from '@/lib/legal';
import { requireSession } from '@/lib/session';
import { loadTeam } from '@/lib/team';
import { canvasMessages } from '@/messages/canvas';
import { commonMessages } from '@/messages/common';
import { networksMessages } from '@/messages/networks';

export async function generateMetadata() {
  const common = await getMessages(commonMessages);
  return { title: common.title(common.nav.canvas) };
}

export default async function CanvasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { user, workspace, role } = session;
  const { connected, error, notice } = await searchParams;
  const locale = await getLocale();
  const [t, networksText] = await Promise.all([getMessages(canvasMessages), getMessages(networksMessages)]);
  const db = getDb();
  const canManage = role !== 'editor';
  const [accounts, flows, posts, positions, appearance, activity, team, calendar, usage, brandKit, campaigns] = await Promise.all([
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
    loadCalendarAroundNow(workspace.id),
    canManage ? bridgeUsageSummary(db, workspace.id) : null,
    getBrandKit(db, workspace),
    listCampaigns(db, workspace.id),
  ]);
  const brandUploads = await findMedia(db, workspace.id, brandKit.mediaIds);
  const uploadUrl = (id: string | null | undefined) => {
    const row = id ? brandUploads.get(id) : undefined;
    return row ? `/media/${row.key}` : null;
  };
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
      // Networks the admin switched off stay only while accounts of them are connected.
      .filter((info) => networkRoute(info.id) !== 'off' || accounts.some((account) => account.provider === info.id))
      .map((info) => {
        const { connector } = getProvider(info.id);
        const route = networkRoute(info.id);
        return {
          info: localizeInfo(info, locale),
          available: route === 'native' || route === 'bridge',
          off: route === 'off',
          callbackUrl: info.setup.operator === 'operator-app' ? redirectUriFor(info.id) : null,
          bridge: route === 'bridge' ? (bridgeSetup()?.bridge.name ?? null) : null,
          bridgeable: bridgeFor(info.id),
          connector:
            connector.kind === 'form'
              ? { kind: 'form' as const, fields: localizeFields(info.id, connector.fields, locale) }
              : connector.kind === 'atproto'
                ? { kind: 'atproto' as const, fields: localizeFields(info.id, connector.fields, locale), oauth: isBlueskyOAuthAvailable(appUrl) }
                : { kind: connector.kind },
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
      bridge: isBridgeId(account.bridge) ? bridges[account.bridge].name : null,
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
    calendar,
    positions,
    plugins: [
      ...builtinThemes.map((manifest) => ({ manifest, builtin: true, installed: installed.has(manifest.id) })),
      ...appearance.installed.filter((plugin) => !plugin.builtin).map((plugin) => ({ manifest: plugin.manifest, builtin: false, installed: true })),
    ],
    activity: activity?.map(toActivity) ?? null,
    legal: legalLinks(),
    brand: {
      companyName: brandKit.companyName,
      tagline: brandKit.tagline,
      colors: brandKit.colors,
      logoUrl: uploadUrl(brandKit.logoMediaId),
      character: brandKit.character && {
        name: brandKit.character.name,
        role: brandKit.character.role,
        catchphrase: brandKit.character.catchphrase,
        imageUrl: uploadUrl(brandKit.character.imageMediaIds[0]),
      },
    },
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      message: campaign.message,
      startsOn: campaign.startsOn,
      endsOn: campaign.endsOn,
      currency: campaign.currency,
      budgetCents: campaign.budgetCents,
      spendCents: campaign.spendCents,
      pieceCount: campaign.pieceCount,
      postCount: campaign.postCount,
    })),
    serverUrl: appUrl,
    bridgeUsage: usage && { name: usage.name, accounts: usage.accounts, profiles: usage.profiles, months: usage.months, price: usage.price },
    appearance: { mode: appearance.mode, themeId: appearance.theme?.id ?? null, canvas: appearance.theme?.canvas ?? defaultCanvas },
    notice: connected
      ? { kind: 'success', text: networksText.connectedNotice(connected) }
      : error
        ? { kind: 'error', text: error }
        : notice === 'verified'
          ? { kind: 'success', text: t.verified }
          : notice === 'verify-expired'
            ? { kind: 'error', text: t.verifyExpired }
            : null,
  };
  // A different workspace is a different world: remount instead of merging.
  return <World key={workspace.id} data={data} />;
}
