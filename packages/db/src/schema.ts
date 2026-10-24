import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
  /** A public https URL, or /media/<key> for uploads. */
  url: string;
  kind: 'image' | 'video';
  altText?: string;
  /** Set for uploads: the media row and storage key. */
  mediaId?: string;
  key?: string;
  mimeType?: string;
  size?: number;
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
  /** UI and email language ("en", "de"); null follows the browser. */
  locale: text('locale'),
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

/** Plugins installed in a workspace (themes for now, see @maas/core/theme). */
export const plugins = pgTable(
  'plugins',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The manifest's id, e.g. "paper". */
    pluginId: text('plugin_id').notNull(),
    kind: pluginKind('kind').notNull(),
    /** Built-in plugins ship with MarketingAsAService and are read from code, so they update with it. */
    builtin: boolean('builtin').notNull().default(false),
    /** The validated manifest of a custom plugin; null for built-ins. */
    manifest: jsonb('manifest'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.pluginId] })],
);

/** Secrets the server creates for itself, encrypted (e.g. the signing key of its Bluesky OAuth client). */
export const serverSecrets = pgTable('server_secrets', {
  name: text('name').primaryKey(),
  valueEnc: text('value_enc').notNull(),
  createdAt: createdAt(),
});

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
    /** Set when the account publishes through a bridge (an aggregator API, e.g. "zernio") instead of the network's own API. */
    bridge: text('bridge'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('social_accounts_workspace_external_idx').on(t.workspaceId, t.provider, t.externalId)],
);

/** A workspace's profiles on a bridge. A profile holds at most one account per network, so a workspace may need several. */
export const bridgeProfiles = pgTable(
  'bridge_profiles',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    bridge: text('bridge').notNull(),
    profileId: text('profile_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('bridge_profiles_bridge_profile_idx').on(t.bridge, t.profileId), index('bridge_profiles_workspace_idx').on(t.workspaceId, t.bridge)],
);

/**
 * What a workspace uses of a bridge per month (UTC), for the aggregator's bill:
 * it charges per connected account or per profile. `peak*` is the most at once.
 */
export const bridgeUsage = pgTable(
  'bridge_usage',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    bridge: text('bridge').notNull(),
    /** "2026-10" */
    month: text('month').notNull(),
    accounts: integer('accounts').notNull(),
    peakAccounts: integer('peak_accounts').notNull(),
    profiles: integer('profiles').notNull(),
    peakProfiles: integer('peak_profiles').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.bridge, t.month] })],
);

/** Saved publishing flows (graph of steps, see @maas/core/flow). */
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

export const mediaKind = pgEnum('media_kind', ['image', 'video']);

/** Uploaded files (local disk or S3, see @maas/core storage). Unused uploads are cleaned up after a day. */
export const media = pgTable(
  'media',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** "<workspace id>/<uuid>.<ext>" in the storage. */
    key: text('key').notNull(),
    kind: mediaKind('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('media_key_idx').on(t.key), index('media_workspace_idx').on(t.workspaceId, t.createdAt)],
);

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  background: string;
}

/** The company's recurring brand character (a mascot or a face of the brand) that appears in every spot, ad and print piece. */
export interface BrandCharacter {
  name: string;
  /** What the character is, e.g. "mascot", "a physiotherapist", "a talking kettle". */
  role: string;
  /** How it looks: enough for an illustrator, a casting or an image generator to get it right every time. */
  look: string;
  personality: string;
  /** How it speaks. */
  voice: string;
  catchphrase: string;
  /** What it never does or says. */
  rules: string;
  /** Reference pictures (uploaded images); the first is the main one. */
  imageMediaIds: string[];
}

/** A workspace's brand: who the company is, how it sounds and looks, and its brand character. Every channel builds on it. */
export const brandKits = pgTable('brand_kits', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  companyName: text('company_name').notNull().default(''),
  tagline: text('tagline').notNull().default(''),
  description: text('description').notNull().default(''),
  audience: text('audience').notNull().default(''),
  tone: text('tone').notNull().default(''),
  dos: text('dos').notNull().default(''),
  donts: text('donts').notNull().default(''),
  colors: jsonb('colors').$type<BrandColors>().notNull(),
  /** "sans" or "serif", for print pieces and briefings. */
  font: text('font').notNull().default('sans'),
  logoMediaId: uuid('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
  website: text('website').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  character: jsonb('character').$type<BrandCharacter>(),
  /** Every upload the kit uses (logo, character pictures), so media cleanup keeps them. */
  mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaignGoal = pgEnum('campaign_goal', ['awareness', 'traffic', 'leads', 'sales', 'event']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'planned', 'running', 'paused', 'done']);
export const pieceKind = pgEnum('piece_kind', ['ad', 'print', 'spot']);
export const pieceStatus = pgEnum('piece_status', ['draft', 'approved', 'live', 'done']);
export const pieceSource = pgEnum('piece_source', ['manual', 'ai']);

/** A campaign's planned spend on one channel. */
export interface ChannelBudget {
  channel: string;
  budgetCents: number;
}

/** A marketing campaign: goal, audience, message, time and budget, across channels (see @maas/core/marketing). */
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goal: campaignGoal('goal').notNull().default('awareness'),
    status: campaignStatus('status').notNull().default('draft'),
    audience: text('audience').notNull().default(''),
    /** The one thing people should remember. */
    message: text('message').notNull().default(''),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    currency: text('currency').notNull().default('EUR'),
    budgetCents: integer('budget_cents').notNull().default(0),
    channels: jsonb('channels').$type<ChannelBudget[]>().notNull().default([]),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_workspace_idx').on(t.workspaceId, t.startsOn)],
);

/** A campaign's ad, print piece or spot; its content's shape depends on kind and format. */
export const pieces = pgTable(
  'pieces',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: pieceKind('kind').notNull(),
    format: text('format').notNull(),
    title: text('title').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    status: pieceStatus('status').notNull().default('draft'),
    /** Written by a person, or drafted by the AI studio (needs a person's approval). */
    source: pieceSource('source').notNull().default('manual'),
    /** Uploads the piece uses, so media cleanup keeps them. */
    mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('pieces_campaign_idx').on(t.campaignId)],
);

/** Results of a campaign on a channel, entered by people (print, radio…) or synced from ad platforms. */
export const campaignResults = pgTable(
  'campaign_results',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    /** The day (or the end of the period) the numbers are for. */
    day: date('day').notNull(),
    reach: integer('reach').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    leads: integer('leads').notNull().default(0),
    sales: integer('sales').notNull().default(0),
    revenueCents: integer('revenue_cents').notNull().default(0),
    spendCents: integer('spend_cents').notNull().default(0),
    note: text('note').notNull().default(''),
    /** Where the numbers came from: "manual", or an ad platform's id for synced rows. */
    source: text('source').notNull().default('manual'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('campaign_results_campaign_idx').on(t.campaignId, t.day)],
);

export const mailingStatus = pgEnum('mailing_status', ['sending', 'done']);
export const letterStatus = pgEnum('letter_status', ['queued', 'uploading', 'submitted', 'sent', 'failed']);

/** A letter piece sent by post to a list of recipients, through a letter service (Pingen). */
export const mailings = pgTable(
  'mailings',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    pieceId: uuid('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    /** The letter service's product: "fast" or "cheap". */
    deliveryProduct: text('delivery_product').notNull(),
    color: boolean('color').notNull().default(true),
    /** Language of the letters' date line and country names. */
    locale: text('locale').notNull().default('de'),
    status: mailingStatus('status').notNull().default('sending'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('mailings_piece_idx').on(t.pieceId)],
);

/** One recipient's letter in a mailing. The address is kept until the mailing is deleted. */
export const mailingLetters = pgTable(
  'mailing_letters',
  {
    id: id(),
    mailingId: uuid('mailing_id').notNull().references(() => mailings.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Street, postcode and town, country. */
    lines: jsonb('lines').$type<string[]>().notNull(),
    /** ISO 3166 code, for prices. */
    country: text('country').notNull(),
    status: letterStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** The letter service's id and its own status word ("valid", "sent", "action_required"…). */
    serviceId: text('service_id'),
    serviceStatus: text('service_status'),
    priceCents: integer('price_cents'),
    priceCurrency: text('price_currency'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mailing_letters_mailing_idx').on(t.mailingId), index('mailing_letters_status_idx').on(t.status, t.updatedAt)],
);

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
    /** Per-network versions of the text ("customize for LinkedIn"), keyed by provider id. */
    variants: jsonb('variants').$type<Partial<Record<string, string>>>().notNull().default({}),
    flowId: uuid('flow_id').references(() => flows.id, { onDelete: 'set null' }),
    /** The campaign the post belongs to, if any. */
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
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
    /** Minutes after the post's time (a flow's "Wait" steps), kept so rescheduling keeps the spacing. */
    delayMinutes: integer('delay_minutes').notNull().default(0),
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
export type BridgeProfile = typeof bridgeProfiles.$inferSelect;
export type BridgeUsage = typeof bridgeUsage.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Flow = typeof flows.$inferSelect;
export type PostTarget = typeof postTargets.$inferSelect;
export type Plugin = typeof plugins.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Media = typeof media.$inferSelect;
export type BrandKit = typeof brandKits.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Piece = typeof pieces.$inferSelect;
export type CampaignResult = typeof campaignResults.$inferSelect;
export type Mailing = typeof mailings.$inferSelect;
export type MailingLetter = typeof mailingLetters.$inferSelect;
export type MemberRole = (typeof memberRole.enumValues)[number];
export type PostStatus = (typeof postStatus.enumValues)[number];
export type TargetStatus = (typeof targetStatus.enumValues)[number];

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  pieces: many(pieces),
  results: many(campaignResults),
}));

export const piecesRelations = relations(pieces, ({ one }) => ({
  campaign: one(campaigns, { fields: [pieces.campaignId], references: [campaigns.id] }),
}));

export const mailingsRelations = relations(mailings, ({ many }) => ({
  letters: many(mailingLetters),
}));

export const mailingLettersRelations = relations(mailingLetters, ({ one }) => ({
  mailing: one(mailings, { fields: [mailingLetters.mailingId], references: [mailings.id] }),
}));

export const campaignResultsRelations = relations(campaignResults, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignResults.campaignId], references: [campaigns.id] }),
}));
