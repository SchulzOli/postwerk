# Postwerk

Self-hosted social media scheduling. Connect your accounts with one click, write a post once, publish it everywhere — now or later.

- **One big canvas.** Networks, accounts, flows, the composer and your posts live in a single zoomable 2D world. Drag things where you like, and link to any node or view (`/canvas#n=network:instagram`, `/canvas#@x,y,zoom`).
- **Flows.** Build reusable publishing pipelines on the canvas: *New post → add hashtags → shorten to fit → wait 30 min → publish to these accounts*. Each account receives its own adapted version.
- **Make it yours.** The look is a plugin. Three themes come installed — *Aurora*, *Paper* and *Blueprint*, each with a light and a dark mode — and everyone picks their own. Uninstall the ones you don't want, or build your own in the theme editor on the canvas ([docs/THEMES.md](docs/THEMES.md)).
- **15 networks behind one interface.** Mastodon, Bluesky, Telegram and Discord work out of the box. Facebook, Instagram, Threads, LinkedIn (profiles and pages), X, TikTok, YouTube, Google Business Profile, Pinterest and Reddit work as soon as the server admin registers one developer app per network — users then just click "Connect".
- **Validates as you type.** Each network's limits, media rules and required fields (subreddit, video title, TikTok privacy…) are checked live in the composer.
- **Reliable publishing.** Every network is published and retried independently, with backoff, token refresh, crash recovery and clear "reconnect needed" states.
- **Your data stays yours.** Tokens are encrypted at rest; runs anywhere Docker runs.

![The Postwerk canvas](docs/screenshots/canvas-world.png)

| Flow builder | Composing through a flow |
|---|---|
| ![Flow](docs/screenshots/canvas-flow.png) | ![Composer](docs/screenshots/canvas-composer.png) |

| Aurora | Paper | Blueprint |
|---|---|---|
| ![Aurora](docs/screenshots/theme-aurora-dark.png) | ![Paper](docs/screenshots/theme-paper-light.png) | ![Blueprint](docs/screenshots/theme-blueprint-dark.png) |

## Status

Phase 0 (foundation) is done, every network integration is implemented, and the canvas with flows is the main interface (the classic list pages remain under “List view”). Its look comes from theme plugins. Networks that need an operator app still have to be set up and live-verified — see [docs/PLATFORMS.md](docs/PLATFORMS.md). Next up: media uploads, editing and the calendar ([docs/PLAN.md](docs/PLAN.md)).

## Quick start (development)

Requirements: Node 22+, Docker.

```bash
npm install
cp .env.example .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
npm run services:up        # Postgres on localhost:5432
docker compose exec postgres psql -U postwerk -c "CREATE DATABASE postwerk_test"   # for tests
npm run db:migrate
npm run dev                # web on http://localhost:3000 + worker
```

Sign up, add a **Sandbox** account and schedule a post. Put `#fail` or `#flaky` in the text to see error handling.

## Self-hosting

```bash
cp .env.example .env       # set ENCRYPTION_KEY, APP_URL, POSTGRES_PASSWORD
docker compose --profile app up -d --build
```

This starts Postgres, runs migrations, and launches the web app (port 3000) and the worker. Put a reverse proxy with HTTPS in front of the web app and set `APP_URL` to the public URL — OAuth callbacks depend on it.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts account tokens; do not change after accounts are connected |
| `APP_URL` | yes | Public URL without trailing slash |
| `ENABLE_SANDBOX` | no | `true` shows the fake Sandbox network |
| `WORKER_POLL_INTERVAL_MS` | no | How often the worker checks for due posts (default 10000) |
| `<NETWORK>_CLIENT_ID` / `_CLIENT_SECRET` | no | Operator developer apps, e.g. `INSTAGRAM_CLIENT_ID`. See [docs/PLATFORMS.md](docs/PLATFORMS.md) |

## Project structure

```
apps/web             Next.js app: canvas (components/world), list pages, server actions, OAuth callbacks
apps/worker          Publishing worker (polls Postgres for due posts)
packages/core        Posts, accounts, flows (planner is browser-safe), theme plugins, publishing loop, encryption
packages/db          Drizzle schema + SQL migrations
packages/providers   Network integrations behind one Provider interface
docs/                Plan, platform guide, theme format, screenshots
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web app + worker with hot reload |
| `npm test` | Unit tests; integration tests run when `TEST_DATABASE_URL` is set |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Production builds of web and worker |
| `npm run db:generate` | Create a migration after changing `packages/db/src/schema.ts` |
| `npm run db:migrate` | Apply migrations |
