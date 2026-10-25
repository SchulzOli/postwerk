# MarketingAsAService — Product & Technical Plan

MarketingAsAService is a self-hostable marketing platform for a business. It started as a social media scheduler; the goals are: **anyone can connect their accounts with one click and plan posts for every network — without ever touching a developer console**, and **a business can run its whole marketing in campaigns — social posts, ads, print, letters and spots — with one brand and one recurring brand character.**

This document is the long-term plan. It is a living document; update it when decisions change.

---

## 1. The core problem: developer apps

Every major network (Instagram, Facebook, LinkedIn, Reddit, TikTok, YouTube, X, Pinterest, Google Business Profile) only allows posting through a **registered developer app** that the network has reviewed. Self-hosted tools usually push this onto every user ("create a Meta app, paste your client ID…"). That is the part we want to remove.

Hosted tools like Buffer register one app per network, get it approved once, and every user just clicks "Connect". MarketingAsAService is self-hosted, so there is no central operator: **whoever runs a MarketingAsAService server registers the apps for that server**, and everyone on that server then just clicks "Connect".

> **The MarketingAsAService project does not register apps or apply for reviews on behalf of the people who use it.** Each operator does that for their own server, only as far as they need it; for their own accounts, many networks need no review at all. The author applies only for the server he runs for his own work as a self-employed person.

MarketingAsAService therefore distinguishes three kinds of connections:

| Kind | Who needs a developer app? | Networks |
|---|---|---|
| **Open protocol** | Nobody | Mastodon (we register an OAuth client on each server automatically), Bluesky (AT Protocol OAuth on the user's own server; app passwords as a fallback) |
| **Native (operator app)** | The operator of each server, for that server | Instagram, Facebook, Threads, LinkedIn, Reddit, YouTube, TikTok, Pinterest, Google Business Profile, X |
| **Bridge (aggregator)** | Nobody — the aggregator has the approvals | Everything an aggregator supports, until our own native approval is in place |

The **bridge** is the shortcut: services like [Ayrshare](https://www.ayrshare.com), [Upload-Post](https://www.upload-post.com) or [Zernio](https://zernio.com) (formerly Late) have already passed every platform review. We plug one of them in as a provider so users can connect Instagram, TikTok, LinkedIn pages, etc. **on day one**, then switch each network to our own native integration as our approvals come through. New connections then go direct and get cheaper; accounts already connected through the bridge keep working until they are connected again directly ([the bridge](bridge.md)).

Per network, the operator decides which path is active ([guide](networks/index.md)):

```
native (if credentials configured)  →  bridge (if aggregator key configured)  →  "needs setup"
```

`ZERNIO_NETWORKS` sends chosen networks through the bridge even when an app exists; `HIDE_NETWORKS` switches networks off.

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
- The whole look is a plugin: a theme is a JSON manifest with design tokens for light **and** dark mode (both required), canvas options (grid, connection style) and optional extra CSS — format in [themes.md](themes.md)
- Three built-in themes — Aurora (default), Paper, Blueprint — installed in every workspace; owners/admins can uninstall and reinstall them; without any theme the plain base look remains
- Everyone picks their own theme; light / dark / system is remembered per browser
- Theme editor on the canvas: start from any theme, live preview of both modes, install, update by id, download and share
- Themes are self-contained by design: no remote URLs, imports or fonts, so a theme cannot track users or leak data
- Next: more plugin kinds behind the same install/uninstall model (e.g. flow steps, composer helpers), a shared theme gallery, trying a theme on the whole canvas before installing it

### Phase 1 — A product people can use daily ✅
- **Media uploads** to local disk or any S3-compatible storage (custom SigV4, no SDK): drag and drop with progress, files checked by their content (not their name), served with strict headers; networks that need the bytes read them straight from storage. Media links still work for files hosted elsewhere
- **Edit, reschedule, retry**: scheduled, draft and failed posts open in the composer again; flows keep their delays when a post moves; failed networks can be retried; published posts can be posted again. **Per-network text versions** ("customize for LinkedIn") — each network starts from its own text, then flows apply
- **Calendar region** (and `/calendar`): week and month views in the viewer's time zone and first day of the week; drag a post to another slot or day, or move it from its details; double-click to plan a new post at that time
- **Bluesky via AT Protocol OAuth**: sign in on your own server (PAR, PKCE, DPoP); MarketingAsAService is a confidential client on https with its own signing key, a loopback client on localhost; app passwords stay as the fallback
- **Teams**: several workspaces per user with a switcher, invite links (optionally emailed), roles owner / admin / editor, and a rule that a workspace always keeps an owner
- **Email** (any SMTP server): address verification, password reset, invites, and an email to the author when a post fails or goes out only partly (can be turned off)
- **Security**: login and sign-up rate limiting per email and per IP, and an audit log of sign-ins, account, post, flow, plugin and team changes (Team region and `/activity`)
- **German and English UI**: everything people see, including validation, errors, emails and network texts; the language follows the browser or the account setting. Messages that come from the networks' APIs stay as the networks send them
- Next: two-factor sign-in, "Sign in with Google", per-network previews in the calendar, recurring posts

### Phase 2 — The bridge: every network, no approvals needed ✅
- **Aggregator chosen: [Zernio](https://zernio.com)** after comparing Ayrshare, Upload-Post and Zernio on price, EU data handling and API quality: an EU company with a DPA, billed per connected account (2 free), with idempotent publishing and per-network error categories. Evaluation in [the bridge](bridge.md)
- **`Bridge` interface** next to `Provider` (`packages/providers/src/bridge.ts`), Zernio as the first implementation: profiles, hosted connect links, accounts, publishing with presigned media uploads, polling for videos, and errors mapped to retry / reconnect / give up
- **Hosted account linking**: "Continue to …" → Zernio's pages → `/api/bridge/callback` → the account appears, marked "via Zernio". Each workspace gets Zernio profiles as needed, so it can connect several accounts per network; expired accounts can be reconnected in place; disconnecting removes them on Zernio
- **Routing per network**: native (developer app) → bridge (`ZERNIO_API_KEY`) → "needs setup"; `ZERNIO_NETWORKS` forces or limits the bridged networks
- **Cost tracking**: bridged accounts and profiles per workspace and month (peak), shown to admins with an estimate from `ZERNIO_ACCOUNT_PRICE`
- Next: a live run against a real Zernio account; a second aggregator only if needed

With a Zernio API key, users can post to Instagram, Facebook, LinkedIn, TikTok, YouTube, Pinterest, Threads, Reddit, X and Google Business Profile.

### Phase 3 — Native integrations, each operator for their own server ✅ (prepared)
**Who applies:** every server's operator, for that server. The project ships the code, the guides and the pages reviews ask for; it holds no apps and applies for no reviews on anyone's behalf. The author applies only for the server he uses for his own work.

**Code status:** all networks are implemented behind the common provider interface and unit-tested against mocked APIs. What software can prepare is done:

- **A choice per network** for the server admin: own developer app (for their own accounts only, or for other people's too), the Zernio bridge, or off (`HIDE_NETWORKS`). The canvas shows what each path needs, the exact callback URL and the legal page URLs to paste into the developer console.
- **Pages for reviews and EU law** on every server, from `OPERATOR_*`: about, privacy policy (from what MarketingAsAService really stores, with the networks, processors and YouTube API wording), terms, imprint, data deletion. IP addresses in the activity log are deleted after 90 days.
- **A documentation website** ([schulzoli.github.io/MarketingAsAService](https://schulzoli.github.io/MarketingAsAService/)) with a step-by-step guide per network, the scopes and why MarketingAsAService needs each, and a screencast script for reviews. Links are checked in CI.

**What remains** happens per server with a real app: register it, pass a review where needed, and make a first live post (then mark the network "live-verified" in [platforms.md](platforms.md)). For one person's own accounts, ordered by value ÷ effort:

1. **LinkedIn profile** — self-serve products, minutes (S)
2. **Meta: Facebook Pages, Instagram, Threads** — standard access with app roles/testers, no review (S); for other people's accounts business verification and App Review (L)
3. **Google Business Profile** — access request for a profile verified 60+ days (M)
4. **Pinterest** — trial access publishes to the app owner's account (S); standard access after a review (S)
5. **Reddit** — manual approval under the Responsible Builder Policy (M)
6. **X** — paid API, no review (S); decide on demand
7. **YouTube** — even own-channel uploads stay private until the API audit (M); bridge meanwhile
8. **LinkedIn company pages** — Community Management API, registered companies only (M); bridge meanwhile
9. **TikTok** — tools for one's own accounts are not approved; bridge. Public services would also need TikTok's posting screen in the composer (L, open)

Open code tasks: TikTok's required posting screen (only for public services), an optional Meta data deletion callback (the instructions page is enough for Meta), self-service account deletion (now by email).

### Marketing beyond social media ✅
A business's marketing runs in campaigns across every channel it uses, with one brand. See [the marketing docs](marketing/index.md).

- **Brand kit**: company details, tone of voice, do's and don'ts, colors, a typeface for print, logo, and one **brand character** (look, personality, voice, catchphrase, what it never does, reference pictures) that every piece builds on
- **Campaigns**: goal, key message, audience, dates, a budget split across channels (social, search/social/video ads, print, mail, radio, TV, cinema, outdoor); pieces in fixed formats with an approval step (draft → approved → live → done); posts belong to campaigns; results per channel with cost per lead and return on ad spend
- **Print and letters**: print-ready PDFs (3 mm bleed, CMYK, embedded fonts, optional crop marks) for flyers, posters, newspaper ads, postcards and DIN 5008 letters; letters and postcards sent by post through **Pingen**, with a price estimate, a confirmation step, and status and postage booked into the campaign
- **Spots**: scripts for video, TV, cinema and radio spots checked for length, pace and the brand character; a production briefing PDF; the finished file kept with the piece and uploaded to YouTube
- **Paid ads**: Google search and YouTube (Demand Gen) video ads on **Google Ads**, image ads on **Meta Ads**; ad accounts connected by owners and admins; campaigns created paused from approved pieces, started and paused here; numbers read back every hour into the campaign's results
- **AI studio** (optional, `ANTHROPIC_API_KEY`): Claude drafts ads, print texts, spot scripts and post ideas into a campaign in the brand's voice; drafts need the same approval as any piece
- Next: picture generation for the brand character (consistent across pieces), TikTok and LinkedIn ads, outdoor booking, an export of a campaign's results

### Autopilot — our marketing runs on its own (next)
Content is planned, drafted, checked, published and measured without anyone starting it; ads spend within their caps and improve themselves. People set goals, budgets and rules, approve in one short weekly sitting, and act on alerts. The full todo is in section 6 below.

### Phase 4 — Delight
- Live post previews per network
- AI assistant (Claude) in the composer to shorten and adapt one post per network, suggest hashtags, write alt text (campaign drafts and post ideas come from the AI studio)
- Approval workflow for posts (editor drafts → admin approves), as campaign pieces already have
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

## 4. Setting up your own server

The operator's checklist (the author works through the same list for his own server). Guides: [Choose how to offer each network](networks/index.md).

- [ ] Server on a public https address (`APP_URL`), `OPERATOR_NAME`, `OPERATOR_EMAIL` and `OPERATOR_ADDRESS` set; `/about` and the [legal pages](legal.md) reachable
- [ ] LinkedIn app with "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" ([guide](networks/linkedin.md))
- [ ] Meta app with standard access and your accounts as admins/testers ([guide](networks/meta.md))
- [ ] Google Cloud project; Business Profile API access request ([guide](networks/google.md))
- [ ] Zernio account for TikTok, YouTube and LinkedIn Pages, or switch them off ([bridge](bridge.md))
- [ ] Optional: Pinterest, Reddit, X ([guides](networks/index.md))

Only if other people should connect their accounts through your apps: business verification and reviews, with a screencast of the real flow ([App reviews](networks/reviews.md)).

---

## 5. Relation to `physio-ruhige-naehe`

The physio monorepo currently runs Mixpost Lite (`apps/social`) as a stopgap. Once MarketingAsAService supports Instagram (via the bridge in Phase 2 at the latest), the practice can switch to a MarketingAsAService instance and `apps/social` can be removed.

---

## 6. Autopilot todo: our advertising and social media on their own

The goal for the practice: marketing that runs by itself all year. What stays with people is about 15 minutes a week to approve what comes next, and answers when an alert asks for one.

**Levels.** Each level works on its own, so the practice gets value along the way:

| Level | Who does what | People's time |
|---|---|---|
| 1 — today | People start the AI studio, edit and approve every piece, schedule posts, start ads | hours a week |
| 2 — planned for you | MarketingAsAService plans the month, drafts every post and piece and schedules them; people approve the week in one sitting | ~15 min a week |
| 3 — autopilot | Recurring series and post variants go out without individual approval; ads pace and optimize themselves within caps; people read the weekly report and act on alerts | alerts only |

New claims, new ad texts, budget increases and letters to people always keep a human approval, also at level 3: health advertising rules apply, and money and personal data are involved.

### A. Set up once (us)

- [ ] **Server:** MarketingAsAService on a public https address with `OPERATOR_*`, SMTP for alerts and a nightly database backup (section 4)
- [ ] **Switch from Mixpost:** move the practice's posting from `apps/social` to MarketingAsAService (section 5)
- [ ] **Channels:** Instagram and the Facebook Page, Google Business Profile, LinkedIn; YouTube and TikTok through the bridge until their reviews are through ([guides](networks/index.md))
- [ ] **Brand kit, complete:** tone of voice, do's and don'ts, colors, logo, and the brand character with 3–6 reference pictures ([brand kit](marketing/index.md#brand-kit))
- [ ] **Health advertising rules:** have the rules for health advertising (Heilmittelwerbegesetz: no healing promises, no fear, nothing misleading) checked once by someone who knows them, then write them into the brand kit's don'ts, where every draft and check reads them
- [ ] **Picture library:** 30 or more own photos (practice, team, exercises, the character) uploaded, with the consent of everyone shown
- [ ] **Year plan:** goals per quarter, a monthly budget per channel, and the seasons' themes (for example new-year resolutions, the running season, back weeks in autumn, gift vouchers in December)
- [ ] **Ads:** Google Ads account and a developer token with Basic access, a Meta ad account; payment methods; spending limits where the platform has them as the last safety net ([paid ads](marketing/ads.md))
- [ ] **Conversions:** appointment bookings counted as conversions in Google Ads and Meta (with the website's consent banner), so ads can optimize for patients instead of clicks
- [ ] **AI:** an Anthropic API key with a monthly spend limit in the Claude Console ([AI studio](marketing/ai-studio.md))
- [ ] **Letters (optional):** a Pingen account. Patient lists count as health data: write only to people who explicitly agreed ([letters](marketing/print.md#send-letters-with-pingen))
- [ ] **Roles:** who approves (owner or admin), who gets alerts, and the weekly approval slot

### B. Build (MarketingAsAService)

In this order; each step is useful on its own. Sizes as in the roadmap.

1. [ ] **Approval for posts and an approval queue (S).** Posts get the same draft → approved step as pieces. One page lists everything due next week; approve all, one by one, or from a signed link in the weekly email.
2. [ ] **Guardrails before anything goes out (S–M).** An automatic check of every post and piece against the brand's don'ts and the health advertising rules (Claude as the reviewer), blocked words, broken links, pictures without consent, budget caps. Anything that fails waits for a person. A kill switch pauses all automation of a workspace.
3. [ ] **The month planned by AI (M).** On a fixed day the worker asks Claude for next month's plan from the year plan, campaigns, seasons and holidays, and past results: dates, channels, topics and formats. The plan lands as draft posts and pieces on the calendar.
4. [ ] **Real post drafts, not just ideas (M).** The studio writes complete posts for chosen accounts or flows: per-network versions, hashtags, alt text, and a fitting picture from the tagged library (Claude tags uploads by looking at them). They are scheduled at good times.
5. [ ] **Series (S).** Recurring formats, such as "exercise of the week" every Tuesday, filled anew each week from an approved template. At level 3 they go out without individual approval.
6. [ ] **The rhythm in the worker (S).** One schedule per workspace: plan the month (20th), draft the week (Thursday), remind approvers (Friday), publish (daily), report (Monday).
7. [ ] **Ads that run themselves (M).** Approved ads start at the campaign's start and stop at its end or when the channel's budget is spent, with even daily pacing. Once conversions are counted, ads bid for them instead of clicks. Rules within the caps: pause an ad whose cost per lead stays above the target, shift budget to the better ad, and ask the studio for fresh variants when an ad wears out. Every change is logged and can be undone.
8. [ ] **Measure what matters (M).** Post numbers from each network's insights API, ad conversions (leads, not only clicks), UTM links on every link, and appointments from the practice's booking system (API or export) as the real result. All of it flows into the campaign's results.
9. [ ] **Weekly report (S).** Monday email: what ran, what it cost, how many enquiries and appointments, what comes next, and Claude's suggestions. The best posts and ads of the past months go back into the prompts as examples of what works for us.
10. [ ] **Triggers (S–M).** Free short-notice appointments in the booking system → a post or a small ad push; a new article on the website (RSS) → a post series; holidays and closures → opening hours on Google Business Profile and a post; a new five-star review → a thank-you post draft (checked against the health advertising rules).
11. [ ] **Pictures of the brand character (M–L).** Generated pictures that keep the character the same from the reference pictures, through an image provider plugged in like the networks. Claude writes the picture descriptions.
12. [ ] **Inbox (L).** Comments, messages and reviews from all networks in one place, with suggested answers. Health questions are never answered automatically.
13. [ ] **API and MCP server (M, Phase 5).** A public API so scheduled AI agents can plan and draft through the same rules and approval queue. That is also a shortcut to level 2 before steps 3–6 are built.

### C. Done when

- [ ] A whole month went out with no more than the weekly approval sitting
- [ ] Ads stayed within budget all month without manual changes, and their cost per appointment is known
- [ ] The Monday report arrived every week and its suggestions were used
