# Postwerk — Product & Technical Plan

Postwerk is a self-hostable social media scheduler. The goal: **anyone can connect their accounts with one click and plan posts for every network — without ever touching a developer console.**

This document is the long-term plan. It is a living document; update it when decisions change.

---

## 1. The core problem: developer apps

Every major network (Instagram, Facebook, LinkedIn, Reddit, TikTok, YouTube, X, Pinterest, Google Business Profile) only allows posting through a **registered developer app** that the network has reviewed. Self-hosted tools usually push this onto every user ("create a Meta app, paste your client ID…"). That is the part we want to remove.

How Buffer & co. solve it — and how we will too:

> **The operator registers one app per network, gets it approved once, and every user just clicks "Connect" and logs in.**

Postwerk therefore distinguishes three kinds of connections:

| Kind | Who needs a developer app? | Networks |
|---|---|---|
| **Open protocol** | Nobody | Mastodon (we register an OAuth client on each server automatically), Bluesky (AT Protocol OAuth on the user's own server; app passwords as a fallback) |
| **Native (operator app)** | Only the operator, once | Instagram, Facebook, Threads, LinkedIn, Reddit, YouTube, TikTok, Pinterest, Google Business Profile, X |
| **Bridge (aggregator)** | Nobody — the aggregator has the approvals | Everything an aggregator supports, until our own native approval is in place |

The **bridge** is the shortcut: services like [Ayrshare](https://www.ayrshare.com), [Upload-Post](https://www.upload-post.com) or [Zernio](https://zernio.com) (formerly Late) have already passed every platform review. We plug one of them in as a provider so users can connect Instagram, TikTok, LinkedIn pages, etc. **on day one**, then switch each network to our own native integration as our approvals come through. New connections then go direct and get cheaper; accounts already connected through the bridge keep working until they are connected again directly ([BRIDGE.md](BRIDGE.md)).

Per network, the operator configures which path is active:

```
native (if credentials configured)  →  bridge (if aggregator key configured)  →  "coming soon"
```

Self-hosters who prefer it can also enter their own platform credentials ("bring your own app").

---

## 2. Architecture

```
apps/web        Next.js (App Router): UI, server actions, OAuth callbacks
apps/worker     Publishing loop: claims due posts and publishes them
packages/core   Business logic: posts, accounts, publishing, crypto, auth helpers
packages/db     Drizzle ORM schema + migrations (Postgres)
packages/providers   One module per network behind a common Provider interface
```

**Data model (Phase 0):** users → workspace_members → workspaces → social_accounts; posts → post_targets (one per post × account, so each network is published and retried independently).

**Key decisions**

| Decision | Why | Revisit when |
|---|---|---|
| Postgres is the job queue (`FOR UPDATE SKIP LOCKED` polling) | One less service, no dual writes between DB and queue, transactional | > ~50 posts/second or sub-second scheduling needed → add a queue (BullMQ/pg-boss) |
| Credentials encrypted with AES-256-GCM (`ENCRYPTION_KEY`) | A leaked database alone exposes no tokens | Hosted version: move key to KMS, add key rotation |
| Minimal own auth (scrypt + hashed session tokens) | Small, auditable, no framework lock-in | Password reset, verification and rate limiting added in Phase 1; next: 2FA, "Sign in with Google" — evaluate Better Auth then |
| Provider errors carry `retryable` / `needsReauth` | Worker decides retry vs. fail vs. "please reconnect" uniformly | — |
| Idempotency key per target | A retried publish must never double-post (Mastodon supports it natively) | Add per-network dedupe where APIs allow |
| TypeScript monorepo, npm workspaces | One language end to end; matches the physio site | — |

---

## 3. Roadmap

Sizes: **S** ≈ days, **M** ≈ 1–2 weeks, **L** ≈ several weeks (one developer, with AI help).

### Phase 0 — Foundation ✅ *(this repository's first version)*
- Monorepo, Postgres schema + migrations, Docker images, Compose stack, CI
- Sign-up/login, sessions, one workspace per user (schema supports many)
- Connect **Mastodon** (zero-setup OAuth on any server) and **Bluesky** (app password)
- **Sandbox** network for demos and tests (`#fail`, `#flaky`)
- Composer with per-network character counters, publish now or schedule
- Worker: retries with exponential backoff, partial-failure status, crash recovery, "reconnect needed" detection
- Unit + integration tests (real Postgres), end-to-end tested in a browser

### Canvas & flows ✅
- One zoomable 2D world (React Flow): regions for Networks (provider overview), Accounts, Flows, Compose and Posts; positions persist per workspace
- Deep links to every node (`#n=<id>`) and every view (`#@x,y,zoom`); inspector side panel per node
- Flow builder: New post → Add text / Shorten to fit / Wait → Publish to account; autosaved, previewed live, used by the composer
- Next for flows: approval step, recurring triggers (RSS, schedule), conditions (e.g. only if media), flow templates

### Themes as plugins ✅
- The whole look is a plugin: a theme is a JSON manifest with design tokens for light **and** dark mode (both required), canvas options (grid, connection style) and optional extra CSS — format in [THEMES.md](THEMES.md)
- Three built-in themes — Aurora (default), Paper, Blueprint — installed in every workspace; owners/admins can uninstall and reinstall them; without any theme the plain base look remains
- Everyone picks their own theme; light / dark / system is remembered per browser
- Theme editor on the canvas: start from any theme, live preview of both modes, install, update by id, download and share
- Themes are self-contained by design: no remote URLs, imports or fonts, so a theme cannot track users or leak data
- Next: more plugin kinds behind the same install/uninstall model (e.g. flow steps, composer helpers), a shared theme gallery, trying a theme on the whole canvas before installing it

### Phase 1 — A product people can use daily ✅
- **Media uploads** to local disk or any S3-compatible storage (custom SigV4, no SDK): drag and drop with progress, files checked by their content (not their name), served with strict headers; networks that need the bytes read them straight from storage. Media links still work for files hosted elsewhere
- **Edit, reschedule, retry**: scheduled, draft and failed posts open in the composer again; flows keep their delays when a post moves; failed networks can be retried; published posts can be posted again. **Per-network text versions** ("customize for LinkedIn") — each network starts from its own text, then flows apply
- **Calendar region** (and `/calendar`): week and month views in the viewer's time zone and first day of the week; drag a post to another slot or day, or move it from its details; double-click to plan a new post at that time
- **Bluesky via AT Protocol OAuth**: sign in on your own server (PAR, PKCE, DPoP); Postwerk is a confidential client on https with its own signing key, a loopback client on localhost; app passwords stay as the fallback
- **Teams**: several workspaces per user with a switcher, invite links (optionally emailed), roles owner / admin / editor, and a rule that a workspace always keeps an owner
- **Email** (any SMTP server): address verification, password reset, invites, and an email to the author when a post fails or goes out only partly (can be turned off)
- **Security**: login and sign-up rate limiting per email and per IP, and an audit log of sign-ins, account, post, flow, plugin and team changes (Team region and `/activity`)
- **German and English UI**: everything people see, including validation, errors, emails and network texts; the language follows the browser or the account setting. Messages that come from the networks' APIs stay as the networks send them
- Next: two-factor sign-in, "Sign in with Google", per-network previews in the calendar, recurring posts

### Phase 2 — The bridge: every network, no approvals needed ✅
- **Aggregator chosen: [Zernio](https://zernio.com)** after comparing Ayrshare, Upload-Post and Zernio on price, EU data handling and API quality: an EU company with a DPA, billed per connected account (2 free), with idempotent publishing and per-network error categories. Evaluation in [BRIDGE.md](BRIDGE.md)
- **`Bridge` interface** next to `Provider` (`packages/providers/src/bridge.ts`), Zernio as the first implementation: profiles, hosted connect links, accounts, publishing with presigned media uploads, polling for videos, and errors mapped to retry / reconnect / give up
- **Hosted account linking**: "Continue to …" → Zernio's pages → `/api/bridge/callback` → the account appears, marked "via Zernio". Each workspace gets Zernio profiles as needed, so it can connect several accounts per network; expired accounts can be reconnected in place; disconnecting removes them on Zernio
- **Routing per network**: native (developer app) → bridge (`ZERNIO_API_KEY`) → "needs setup"; `ZERNIO_NETWORKS` forces or limits the bridged networks
- **Cost tracking**: bridged accounts and profiles per workspace and month (peak), shown to admins with an estimate from `ZERNIO_ACCOUNT_PRICE`
- Next: a live run against a real Zernio account; a second aggregator only if needed

With a Zernio API key, users can post to Instagram, Facebook, LinkedIn, TikTok, YouTube, Pinterest, Threads, Reddit, X and Google Business Profile.

### Phase 3 — Native integrations (start approvals early; they run in parallel)
**Code status:** all networks below are implemented behind the common provider interface (built breadth-first, ahead of Phases 1–2) and unit-tested against mocked APIs. What remains per network is the operator app, its review, and a first live post to verify the integration. Details and checklists in [PLATFORMS.md](PLATFORMS.md).

Ordered by value ÷ approval effort:

1. **LinkedIn personal profiles** — self-serve "Share on LinkedIn" (S)
2. **Meta: Facebook Pages + Instagram** — one Meta app, business verification + app review (L)
3. **Threads** — same Meta app, separate permissions (S once Meta is done)
4. **Google Business Profile** — access request form; very valuable for local businesses like a physio practice (M)
5. **LinkedIn company pages** — Community Management API, partner review, weeks to months (M)
6. **YouTube** — Google OAuth verification + quota extension (M)
7. **Reddit** — manual approval since Nov 2025 (Responsible Builder Policy) (M)
8. **TikTok** — Content Posting API audit; unaudited apps can only post privately (M)
9. **Pinterest** — trial → standard access review (S)
10. **X** — paid API (pay-per-use); decide based on demand (S)

### Phase 4 — Delight
- Live post previews per network
- AI assistant (Claude) to draft, shorten and adapt one post per network, suggest hashtags, write alt text
- Approval workflow (editor drafts → admin approves)
- First comment, link shortener with UTM tags
- Best-time-to-post suggestions; analytics from each network's insights API
- Content library / templates, recurring posts

### Phase 5 — Hosted / SaaS readiness (only if offered to others)
- Multi-tenant hardening, per-workspace rate limits, abuse handling
- Billing (Stripe), plans by connected accounts
- GDPR: EU hosting, DPA, data export & deletion, privacy policy (needed for platform reviews anyway)
- Observability (structured logs, metrics, alerts), backups, token-refresh jobs, webhook ingestion
- Public REST API + MCP server so agents can schedule posts

---

## 4. Platform approvals: start now

Approvals are the critical path, not code. Things the operator should start in parallel with Phase 1:

- [ ] Company details ready: legal name, address, website with **privacy policy** and **terms** pages, support email
- [ ] Meta Business account → business verification → create app (Instagram + Facebook Login for Business + Threads)
- [ ] LinkedIn app: request "Share on LinkedIn"; apply for Community Management API
- [ ] Google Cloud project: Business Profile API access form; YouTube Data API + OAuth consent screen verification
- [ ] Reddit: submit request under the Responsible Builder Policy
- [ ] TikTok developer app: Content Posting API, plan the audit
- [ ] Open a Zernio account for the bridge and set `ZERNIO_API_KEY` ([BRIDGE.md](BRIDGE.md))

Every review asks for a **screencast of the real flow**, so the corresponding UI must exist first (Phase 1 media upload is needed for Instagram/TikTok/YouTube).

---

## 5. Relation to `physio-ruhige-naehe`

The physio monorepo currently runs Mixpost Lite (`apps/social`) as a stopgap. Once Postwerk supports Instagram (via the bridge in Phase 2 at the latest), the practice can switch to a Postwerk instance and `apps/social` can be removed.
