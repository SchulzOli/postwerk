# Postwerk

[![CI](https://github.com/SchulzOli/postwerk/actions/workflows/ci.yml/badge.svg)](https://github.com/SchulzOli/postwerk/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Self-hosted social media scheduling. Connect your accounts with one click, write a post once, publish it everywhere — now or later.

- **One big canvas.** Networks, accounts, flows, the composer and your posts live in a single zoomable 2D world. Drag things where you like, and link to any node or view (`/canvas#n=network:instagram`, `/canvas#@x,y,zoom`).
- **Flows.** Build reusable publishing pipelines on the canvas: *New post → add hashtags → shorten to fit → wait 30 min → publish to these accounts*. Each account receives its own adapted version.
- **Plan on a calendar.** Week and month views on the canvas; drag a post to move it, double-click to plan one. Edit or retry posts until they go out, and give each network its own version of the text.
- **Work as a team.** Several workspaces, invite links, roles (owner, admin, editor), an activity log, and an email when a post fails.
- **German and English.** The UI, validation and emails follow the browser's language or the account setting.
- **Make it yours.** The look is a plugin. Three themes come installed — *Aurora*, *Paper* and *Blueprint*, each with a light and a dark mode — and everyone picks their own. Uninstall the ones you don't want, or build your own in the theme editor on the canvas ([docs/THEMES.md](docs/THEMES.md)).
- **15 networks behind one interface.** Mastodon, Bluesky (sign in on your own server, no app password needed), Telegram and Discord work out of the box. Facebook, Instagram, Threads, LinkedIn (profiles and pages), X, TikTok, YouTube, Google Business Profile, Pinterest and Reddit work through the [Zernio](https://zernio.com) bridge with just an API key, or through the server's own developer apps once they are approved — users then just click "Connect" ([docs/BRIDGE.md](docs/BRIDGE.md)).
- **Validates as you type.** Each network's limits, media rules and required fields (subreddit, video title, TikTok privacy…) are checked live in the composer.
- **Reliable publishing.** Every network is published and retried independently, with backoff, token refresh, crash recovery and clear "reconnect needed" states.
- **Your data stays yours.** Tokens are encrypted at rest; runs anywhere Docker runs.

![The Postwerk canvas](docs/screenshots/canvas-world.png)

| Flow builder | Composing through a flow |
|---|---|
| ![Flow](docs/screenshots/canvas-flow.png) | ![Composer](docs/screenshots/canvas-composer.png) |

| Calendar | Auf Deutsch |
|---|---|
| ![Calendar](docs/screenshots/canvas-calendar.png) | ![German UI](docs/screenshots/canvas-german.png) |

| Aurora | Paper | Blueprint |
|---|---|---|
| ![Aurora](docs/screenshots/theme-aurora-dark.png) | ![Paper](docs/screenshots/theme-paper-light.png) | ![Blueprint](docs/screenshots/theme-blueprint-dark.png) |

## Status

Phases 0 (foundation), 1 (uploads, editing, calendar, teams, email, Bluesky sign-in, German and English) and 2 (the bridge: every network without app reviews, through Zernio) are done. Every network integration is implemented, and the canvas with flows is the main interface (the classic list pages remain under “List view”). Its look comes from theme plugins. The networks' own developer apps still have to be set up and live-verified — see [docs/PLATFORMS.md](docs/PLATFORMS.md); the bridge covers them meanwhile ([docs/BRIDGE.md](docs/BRIDGE.md)). Next up: native integrations as approvals come through ([docs/PLAN.md](docs/PLAN.md)).

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

This starts Postgres, runs migrations, and launches the web app (port 3000) and the worker. Put a reverse proxy with HTTPS in front of the web app and set `APP_URL` to the public URL — OAuth callbacks and links in emails depend on it. The proxy should set `X-Forwarded-For`; login rate limits per IP rely on it (limits per email address do not).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts account tokens; do not change after accounts are connected |
| `APP_URL` | yes | Public URL without trailing slash |
| `ENABLE_SANDBOX` | no | `true` shows the fake Sandbox network |
| `WORKER_POLL_INTERVAL_MS` | no | How often the worker checks for due posts (default 10000) |
| `MEDIA_STORAGE` | no | `local` (default) keeps uploads in `MEDIA_DIR` (a Docker volume), `s3` uses any S3-compatible storage (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, see `.env.example`) |
| `MEDIA_MAX_VIDEO_MB` | no | Largest video upload (default 512; images up to 20 MB) |
| `SMTP_URL` | no | Outgoing mail for password resets, invites, email confirmation and failed-post alerts, e.g. `smtp://user:pass@smtp.example.com:587`. Without it, emails are printed to the log |
| `MAIL_FROM` | no | Sender address, e.g. `Postwerk <postwerk@example.com>` |
| `OPERATOR_NAME`, `OPERATOR_EMAIL` | for app reviews | Who runs the server. Turns on `/about`, a privacy policy, terms and data deletion instructions; with `OPERATOR_ADDRESS` also an imprint. `LEGAL_*_URL` links your own pages instead. See [docs/legal.md](docs/legal.md) |
| `<NETWORK>_CLIENT_ID` / `_CLIENT_SECRET` | no | Operator developer apps, e.g. `INSTAGRAM_CLIENT_ID`. See [docs/PLATFORMS.md](docs/PLATFORMS.md) |
| `HIDE_NETWORKS` | no | Network ids you don't offer at all, e.g. `x,tiktok` |
| `ZERNIO_API_KEY` | no | Connects every network without a developer app through [Zernio](https://zernio.com). `ZERNIO_NETWORKS` limits or forces the list, `ZERNIO_ACCOUNT_PRICE` (e.g. `6` or `5.50 EUR`) shows cost estimates. See [docs/BRIDGE.md](docs/BRIDGE.md) |

## Project structure

```
apps/web             Next.js app: canvas (components/world), list pages, server actions, OAuth callbacks
apps/web/messages    UI texts in English and German, one catalog per area
apps/worker          Publishing worker (polls Postgres for due posts)
packages/core        Posts, accounts, flows (planner is browser-safe), theme plugins, publishing loop, encryption
packages/db          Drizzle schema + SQL migrations
packages/providers   Network integrations behind one Provider interface
docs/                Plan, platform guide, theme format, screenshots
```

## Languages

The UI is in English and German. Texts live in typed catalogs — `apps/web/messages/*.ts` for the app, `packages/core/src/messages.ts` for errors and emails, `packages/providers/src/messages.ts` for validation and network texts. Each catalog has an `en` and a `de` object, and TypeScript refuses a German catalog that misses a message or takes other values. To add a language, add it to `locales` in `packages/providers/src/i18n.ts` and follow the type errors.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web app + worker with hot reload |
| `npm test` | Unit tests; integration tests run when `TEST_DATABASE_URL` is set |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Production builds of web and worker |
| `npm run db:generate` | Create a migration after changing `packages/db/src/schema.ts` |
| `npm run db:migrate` | Apply migrations |

## Contributing

Contributions are welcome — bug reports, ideas, translations and code. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, checks and conventions, and report security problems privately as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

Postwerk is open source under the [MIT License](LICENSE). Its dependencies have their own licenses, almost all MIT, Apache-2.0, ISC or BSD; the image library `sharp` that Next.js installs includes `libvips` under LGPL-3.0.
