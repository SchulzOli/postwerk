import type { FlowGraph } from '@postwerk/core/flow';
import type { ColorMode, ThemeCanvas, ThemeManifest } from '@postwerk/core/theme';
import type { ActivityItem } from '@/lib/activity';
import type { FormField, PostStatus, TargetStatus } from './shared-types';
import type { ProviderId, ProviderInfo } from '@postwerk/providers/catalog';

export interface NetworkData {
  info: ProviderInfo;
  available: boolean;
  connector: { kind: 'form'; fields: FormField[] } | { kind: 'oauth2' | 'mastodon' };
}

export interface AccountData {
  id: string;
  provider: ProviderId;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  maxLength: number | null;
  status: 'active' | 'needs_reauth';
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
  targets: { accountId: string; status: TargetStatus; url: string | null; error: string | null }[];
}

export interface PluginData {
  manifest: ThemeManifest;
  builtin: boolean;
  /** False for a built-in that was uninstalled; it can be installed again. */
  installed: boolean;
}

export interface WorldData {
  user: { name: string; email: string };
  workspace: { name: string };
  canManage: boolean;
  networks: NetworkData[];
  accounts: AccountData[];
  flows: FlowData[];
  posts: PostData[];
  positions: Record<string, { x: number; y: number }>;
  /** Built-ins first (installed or not, so their cards keep their place), then custom themes. */
  plugins: PluginData[];
  appearance: { mode: ColorMode; themeId: string | null; canvas: ThemeCanvas };
  /** Latest workspace activity; null for members who may not see it (editors). */
  activity: ActivityItem[] | null;
  notice: { kind: 'success' | 'error'; text: string } | null;
}
