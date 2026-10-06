import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { bridgeProfiles, bridgeUsage, socialAccounts, type Database } from '@postwerk/db';
import { getBridge, type BridgeId } from '@postwerk/providers';

type Env = Record<string, string | undefined>;

/** The calendar month (UTC) usage is counted in, e.g. "2026-10". */
export const usageMonth = (date: Date) => date.toISOString().slice(0, 7);

type Counts = { accounts: number; profiles: number };

/** A workspace's accounts and profiles on each bridge right now. */
async function currentUsage(db: Database, workspaceId: string): Promise<Map<string, Counts>> {
  const usage = new Map<string, Counts>();
  const entry = (bridge: string) => {
    if (!usage.has(bridge)) usage.set(bridge, { accounts: 0, profiles: 0 });
    return usage.get(bridge)!;
  };
  const accounts = await db
    .select({ bridge: socialAccounts.bridge, count: count() })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, workspaceId), isNotNull(socialAccounts.bridge)))
    .groupBy(socialAccounts.bridge);
  for (const row of accounts) entry(row.bridge!).accounts = row.count;
  const profiles = await db
    .select({ bridge: bridgeProfiles.bridge, count: count() })
    .from(bridgeProfiles)
    .where(eq(bridgeProfiles.workspaceId, workspaceId))
    .groupBy(bridgeProfiles.bridge);
  for (const row of profiles) entry(row.bridge).profiles = row.count;
  return usage;
}

/**
 * Notes a workspace's bridged accounts and profiles for this month's bill
 * (after connecting or disconnecting, and hourly). Each month keeps its peak.
 */
export async function recordBridgeUsage(db: Database, workspaceId: string, now = new Date()): Promise<void> {
  const month = usageMonth(now);
  const usage = await currentUsage(db, workspaceId);
  // A bridge whose last account went away this month drops to zero.
  const known = await db
    .select({ bridge: bridgeUsage.bridge })
    .from(bridgeUsage)
    .where(and(eq(bridgeUsage.workspaceId, workspaceId), eq(bridgeUsage.month, month)));
  for (const { bridge } of known) if (!usage.has(bridge)) usage.set(bridge, { accounts: 0, profiles: 0 });

  for (const [bridge, { accounts, profiles }] of usage) {
    await db
      .insert(bridgeUsage)
      .values({ workspaceId, bridge, month, accounts, peakAccounts: accounts, profiles, peakProfiles: profiles, updatedAt: now })
      .onConflictDoUpdate({
        target: [bridgeUsage.workspaceId, bridgeUsage.bridge, bridgeUsage.month],
        set: {
          accounts,
          profiles,
          peakAccounts: sql`greatest(${bridgeUsage.peakAccounts}, ${accounts})`,
          peakProfiles: sql`greatest(${bridgeUsage.peakProfiles}, ${profiles})`,
          updatedAt: now,
        },
      });
  }
}

/** Housekeeping: every workspace on a bridge gets this month's numbers, also when nothing changed. */
export async function recordAllBridgeUsage(db: Database, now = new Date()): Promise<void> {
  const [withAccounts, withProfiles] = await Promise.all([
    db.selectDistinct({ workspaceId: socialAccounts.workspaceId }).from(socialAccounts).where(isNotNull(socialAccounts.bridge)),
    db.selectDistinct({ workspaceId: bridgeProfiles.workspaceId }).from(bridgeProfiles),
  ]);
  for (const workspaceId of new Set([...withAccounts, ...withProfiles].map((row) => row.workspaceId))) {
    await recordBridgeUsage(db, workspaceId, now);
  }
}

/** What the admin pays per connected account and month (ZERNIO_ACCOUNT_PRICE, e.g. "6" or "5.50 EUR"), for estimates. */
export function bridgePrice(env: Env = process.env): { amount: number; currency: string } | null {
  const match = env.ZERNIO_ACCOUNT_PRICE?.trim().match(/^(\d+(?:[.,]\d+)?)\s*([A-Za-z]{3})?$/);
  if (!match) return null;
  return { amount: Number(match[1]!.replace(',', '.')), currency: (match[2] ?? 'USD').toUpperCase() };
}

export interface BridgeUsageSummary {
  bridge: BridgeId;
  name: string;
  /** Connected right now. */
  accounts: number;
  profiles: number;
  /** Newest first (at most 12); the current month is always included. */
  months: { month: string; peakAccounts: number; peakProfiles: number }[];
  price: { amount: number; currency: string } | null;
}

/** A workspace's use of the bridge, or null when the server has none and the workspace never used one. */
export async function bridgeUsageSummary(db: Database, workspaceId: string, env: Env = process.env, now = new Date()): Promise<BridgeUsageSummary | null> {
  const bridge = getBridge('zernio');
  const live = (await currentUsage(db, workspaceId)).get(bridge.id) ?? { accounts: 0, profiles: 0 };
  const rows = await db
    .select()
    .from(bridgeUsage)
    .where(and(eq(bridgeUsage.workspaceId, workspaceId), eq(bridgeUsage.bridge, bridge.id)))
    .orderBy(desc(bridgeUsage.month))
    .limit(12);
  if (!env.ZERNIO_API_KEY?.trim() && rows.length === 0 && live.accounts === 0) return null;

  const months = rows.map((row) => ({ month: row.month, peakAccounts: row.peakAccounts, peakProfiles: row.peakProfiles }));
  // The worker records hourly; today's numbers count already.
  const month = usageMonth(now);
  const current = months.find((entry) => entry.month === month);
  if (current) {
    current.peakAccounts = Math.max(current.peakAccounts, live.accounts);
    current.peakProfiles = Math.max(current.peakProfiles, live.profiles);
  } else {
    months.unshift({ month, peakAccounts: live.accounts, peakProfiles: live.profiles });
  }
  return { bridge: bridge.id, name: bridge.name, ...live, months: months.slice(0, 12), price: bridgePrice(env) };
}
