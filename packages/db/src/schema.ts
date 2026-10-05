import { relations, sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
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

export const postsRelations = relations(posts, ({ many }) => ({ targets: many(postTargets) }));

export const postTargetsRelations = relations(postTargets, ({ one }) => ({
  post: one(posts, { fields: [postTargets.postId], references: [posts.id] }),
  account: one(socialAccounts, { fields: [postTargets.socialAccountId], references: [socialAccounts.id] }),
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
export type PostStatus = (typeof postStatus.enumValues)[number];
export type TargetStatus = (typeof targetStatus.enumValues)[number];
