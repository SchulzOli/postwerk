import { relations, sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'editor']);
export const provider = pgEnum('provider', [
  'mastodon',
  'bluesky',
  'facebook',
  'instagram',
  'threads',
  'linkedin',
  'linkedin_page',
  'x',
  'tiktok',
  'youtube',
  'pinterest',
  'reddit',
  'google_business',
  'telegram',
  'discord',
  'sandbox',
]);

export interface PostMedia {
  url: string;
  kind: 'image' | 'video';
  altText?: string;
}
export const accountStatus = pgEnum('account_status', ['active', 'needs_reauth']);
export const postStatus = pgEnum('post_status', ['draft', 'scheduled', 'publishing', 'published', 'partial', 'failed']);
export const targetStatus = pgEnum('target_status', ['pending', 'publishing', 'published', 'failed']);
export const pluginKind = pgEnum('plugin_kind', ['theme']);

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** Set once the user clicked the link we emailed them. */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  /** Email the user when one of their posts fails. */
  notifyFailures: boolean('notify_failures').notNull().default(true),
  createdAt: createdAt(),
});

export const emailTokenKind = pgEnum('email_token_kind', ['verify_email', 'reset_password']);

/** Single-use links we email (verification, password reset); only the hash is stored. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: emailTokenKind('kind').notNull(),
    /** The address the link was sent to (verification confirms exactly this one). */
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** The workspace this session works in (switchable); null falls back to the user's first one. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('editor'),
    /** Id of the theme plugin this member chose; null (or uninstalled) means the workspace default. */
    theme: text('theme'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
);

/** Invitations to join a workspace; each link works once and expires. */
export const invites = pgTable(
  'invites',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Who it is meant for (shown, prefilled and emailed); anyone with the link can use it once. */
    email: text('email'),
    role: memberRole('role').notNull().default('editor'),
    /** SHA-256 of the token for lookup, plus the token encrypted so admins can copy the link again. */
    tokenHash: text('token_hash').notNull(),
    tokenEnc: text('token_enc').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invites_token_idx').on(t.tokenHash), index('invites_workspace_idx').on(t.workspaceId)],
);

/** Plugins installed in a workspace (themes for now, see @postwerk/core/theme). */
export const plugins = pgTable(
  'plugins',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The manifest's id, e.g. "paper". */
    pluginId: text('plugin_id').notNull(),
    kind: pluginKind('kind').notNull(),
    /** Built-in plugins ship with Postwerk and are read from code, so they update with it. */
    builtin: boolean('builtin').notNull().default(false),
    /** The validated manifest of a custom plugin; null for built-ins. */
    manifest: jsonb('manifest'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.pluginId] })],
);

/** OAuth clients we registered ourselves on Mastodon servers (one per server). */
export const mastodonApps = pgTable(
  'mastodon_apps',
  {
    id: id(),
    instanceUrl: text('instance_url').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretEnc: text('client_secret_enc').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mastodon_apps_instance_redirect_idx').on(t.instanceUrl, t.redirectUri)],
);

/** Short-lived state for OAuth round trips (CSRF protection + context). */
export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: provider('provider').notNull(),
  data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: provider('provider').notNull(),
    externalId: text('external_id').notNull(),
    handle: text('handle').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    /** Provider credentials, AES-256-GCM encrypted with ENCRYPTION_KEY. */
    credentialsEnc: text('credentials_enc').notNull(),
    maxLength: integer('max_length'),
    status: accountStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('social_accounts_workspace_external_idx').on(t.workspaceId, t.provider, t.externalId)],
);

/** Saved publishing flows (graph of steps, see @postwerk/core/flow). */
export const flows = pgTable('flows', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  graph: jsonb('graph').$type<{ steps: unknown[]; edges: unknown[] }>().notNull(),
  /** Where the flow's frame sits on the canvas. */
  x: integer('x').notNull().default(0),
  y: integer('y').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Positions of canvas nodes the user moved (networks, accounts, panels), per workspace. */
export const canvasPositions = pgTable(
  'canvas_positions',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    nodeKey: text('node_key').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.nodeKey] })],
);

export const posts = pgTable(
  'posts',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    media: jsonb('media').$type<PostMedia[]>().notNull().default([]),
    flowId: uuid('flow_id').references(() => flows.id, { onDelete: 'set null' }),
    status: postStatus('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('posts_workspace_scheduled_idx').on(t.workspaceId, t.scheduledAt)],
);

/** One row per (post, account): each network is published and retried independently. */
export const postTargets = pgTable(
  'post_targets',
  {
    id: id(),
    postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id').notNull().references(() => socialAccounts.id, { onDelete: 'cascade' }),
    /** Network-specific fields (subreddit, video title, privacy…), defaults already applied. */
    options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
    /** Text adapted by a flow for this account; null means the post's text. */
    text: text('text'),
    status: targetStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    remoteId: text('remote_id'),
    remoteUrl: text('remote_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('post_targets_post_account_idx').on(t.postId, t.socialAccountId),
    index('post_targets_due_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);

/** Fixed-window counters for rate limits (login attempts, sign-ups, reset emails…), shared by all app instances. */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
});

/** Security and admin events. Workspace events are shown to owners and admins; sign-ins belong to the user only. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** e.g. "login.failed", "account.connected", "member.role_changed". */
    action: text('action').notNull(),
    /** What it was about, in words: an account handle, a member's email, a flow name. */
    target: text('target'),
    details: jsonb('details').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_workspace_idx').on(t.workspaceId, t.createdAt), index('audit_log_user_idx').on(t.userId, t.createdAt)],
);

export const postsRelations = relations(posts, ({ many }) => ({ targets: many(postTargets) }));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));

export const postTargetsRelations = relations(postTargets, ({ one }) => ({
  post: one(posts, { fields: [postTargets.postId], references: [posts.id] }),
  account: one(socialAccounts, { fields: [postTargets.socialAccountId], references: [socialAccounts.id] }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  workspace: one(workspaces, { fields: [invites.workspaceId], references: [workspaces.id] }),
  inviter: one(users, { fields: [invites.invitedBy], references: [users.id] }),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Flow = typeof flows.$inferSelect;
export type PostTarget = typeof postTargets.$inferSelect;
export type Plugin = typeof plugins.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type MemberRole = (typeof memberRole.enumValues)[number];
export type PostStatus = (typeof postStatus.enumValues)[number];
export type TargetStatus = (typeof targetStatus.enumValues)[number];
