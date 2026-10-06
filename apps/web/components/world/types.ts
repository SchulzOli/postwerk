import type { FlowGraph } from '@postwerk/core/flow';
import type { ColorMode, ThemeCanvas, ThemeManifest } from '@postwerk/core/theme';
import type { TeamData } from '@/components/team';
import type { ActivityItem } from '@/lib/activity';
import type { CalendarData } from '@/lib/calendar';
import type { FormField, PostStatus, TargetStatus } from './shared-types';
import type { ProviderId, ProviderInfo } from '@postwerk/providers/catalog';

export interface NetworkData {
  info: ProviderInfo;
  /** People can connect it here: natively, or through the bridge. */
  available: boolean;
  /** The server admin switched it off (HIDE_NETWORKS); shown only while accounts of it are connected. */
  off: boolean;
  /** Where the network sends people back after signing in, for the admin's developer app (null when no app is needed). */
  callbackUrl: string | null;
  /** Name of the bridge it connects through ("Zernio"), or null when it connects natively or not at all. */
  bridge: string | null;
  /** The bridge that could connect it once the admin sets it up (for the setup notes), or null. */
  bridgeable: { name: string; env: string } | null;
  connector:
    | { kind: 'form'; fields: FormField[] }
    | { kind: 'oauth2' | 'mastodon' }
    /** Bluesky: sign in on the user's server when `oauth` (this server's address allows it), else app passwords. */
    | { kind: 'atproto'; fields: FormField[]; oauth: boolean };
}

export interface AccountData {
  id: string;
  provider: ProviderId;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  maxLength: number | null;
  status: 'active' | 'needs_reauth';
  /** Name of the bridge it publishes through, or null. */
  bridge: string | null;
}

export interface FlowData {
  id: string;
  name: string;
  graph: FlowGraph;
  x: number;
  y: number;
}

export interface PostData {
  id: string;
  text: string;
  status: PostStatus;
  scheduledAt: string | null;
  mediaCount: number;
  /** The first few attachments, for thumbnails. */
  media: { url: string; kind: 'image' | 'video'; altText?: string }[];
  targets: { accountId: string; status: TargetStatus; url: string | null; error: string | null }[];
}

export interface PluginData {
  manifest: ThemeManifest;
  builtin: boolean;
  /** False for a built-in that was uninstalled; it can be installed again. */
  installed: boolean;
}

/** What the workspace uses of the bridge (admins only). */
export interface BridgeUsageData {
  name: string;
  accounts: number;
  profiles: number;
  /** Newest first; the first is the current month ("2026-10"). */
  months: { month: string; peakAccounts: number; peakProfiles: number }[];
  price: { amount: number; currency: string } | null;
}

export interface WorldData {
  user: { name: string; email: string };
  /** Show the "confirm your email" reminder. */
  needsVerification: boolean;
  workspace: { id: string; name: string };
  /** Every workspace the user belongs to, for the switcher. */
  workspaces: { id: string; name: string }[];
  team: TeamData;
  canManage: boolean;
  networks: NetworkData[];
  accounts: AccountData[];
  flows: FlowData[];
  posts: PostData[];
  /** Posts around today for the calendar; it loads other weeks itself. */
  calendar: CalendarData;
  positions: Record<string, { x: number; y: number }>;
  /** Built-ins first (installed or not, so their cards keep their place), then custom themes. */
  plugins: PluginData[];
  appearance: { mode: ColorMode; themeId: string | null; canvas: ThemeCanvas };
  /** Latest workspace activity; null for members who may not see it (editors). */
  activity: ActivityItem[] | null;
  bridgeUsage: BridgeUsageData | null;
  /** The server's about and legal pages that are set up. */
  legal: { page: 'about' | 'privacy' | 'terms' | 'imprint' | 'data-deletion'; href: string }[];
  /** This server's public address (APP_URL). */
  serverUrl: string;
  notice: { kind: 'success' | 'error'; text: string } | null;
}
