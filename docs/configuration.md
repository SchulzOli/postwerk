# Configuration

MarketingAsAService reads its settings from environment variables, for Docker usually from `.env` (copy [`.env.example`](https://github.com/SchulzOli/MarketingAsAService/blob/main/.env.example)). Web app and worker need the same values. Restart both after a change.

## Basics

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `POSTGRES_PASSWORD` | with the bundled database | Password of the Postgres container in `docker-compose.yml` |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the access to connected accounts; never change it later |
| `APP_URL` | yes | Public address without trailing slash. Callbacks, links in emails and media links depend on it |
| `ENABLE_SANDBOX` | no | `true` shows the fake Sandbox network |
| `WORKER_POLL_INTERVAL_MS` | no | How often the worker looks for due posts (default 10000) |

## Media

| Variable | What it does |
|---|---|
| `MEDIA_STORAGE` | `local` (default) keeps uploads in `MEDIA_DIR` and serves them at `APP_URL/media/…`; `s3` uses S3-compatible storage |
| `MEDIA_DIR` | Folder for local uploads (a Docker volume) |
| `MEDIA_MAX_VIDEO_MB` | Largest video upload in MB (default 512; images up to 20 MB) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | S3 storage (AWS, MinIO, Cloudflare R2, Backblaze, Hetzner…) |
| `S3_PUBLIC_URL` | Public address of the bucket or a CDN; without it, files are shared with presigned links |

Instagram, Threads, TikTok and Pinterest download media from MarketingAsAService, so `APP_URL` (or `S3_PUBLIC_URL`) must be reachable from the internet for them.

## Email

| Variable | What it does |
|---|---|
| `SMTP_URL` | `smtp://user:pass@host:587` (STARTTLS) or `smtps://user:pass@host:465`. Without it, emails are written to the server log |
| `MAIL_FROM` | Sender, e.g. `MarketingAsAService <maas@example.com>` |

## About and legal pages

| Variable | What it does |
|---|---|
| `OPERATOR_NAME`, `OPERATOR_EMAIL` | Who runs the server. Turn on `/about`, privacy policy, terms and data deletion page |
| `OPERATOR_ADDRESS` | Postal address, lines separated by `;`. Turns on the imprint |
| `OPERATOR_PHONE` | Phone number for the imprint |
| `OPERATOR_HOSTING` | Hosting provider, named on the privacy page |
| `LEGAL_PRIVACY_URL`, `LEGAL_TERMS_URL`, `LEGAL_IMPRINT_URL`, `LEGAL_DATA_DELETION_URL` | Your own pages instead of the built-in ones |

Details: [About and legal pages](legal.md).

## Networks

| Variable | What it does |
|---|---|
| `<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET` | Your own developer app for a network. Prefixes: `FACEBOOK`, `INSTAGRAM`, `THREADS`, `LINKEDIN` (profile and pages), `X`, `TIKTOK`, `GOOGLE` (YouTube and Business Profile), `PINTEREST`, `REDDIT` |
| `ZERNIO_API_KEY` | Connects every network without its own app through [Zernio](bridge.md) |
| `ZERNIO_NETWORKS` | Comma-separated network ids that use Zernio even with an own app; when set, other networks never use Zernio |
| `ZERNIO_ACCOUNT_PRICE` | Your price per connected account and month, e.g. `6` or `5.50 EUR`, for cost estimates |
| `ZERNIO_BASE_URL` | Zernio's API address; only for tests against a fake server |
| `HIDE_NETWORKS` | Comma-separated network ids you don't offer at all, e.g. `x,tiktok` |

Network ids: `mastodon`, `bluesky`, `facebook`, `instagram`, `threads`, `linkedin`, `linkedin_page`, `x`, `tiktok`, `youtube`, `google_business`, `pinterest`, `reddit`, `telegram`, `discord`. Which to pick: [Choose how to offer each network](networks/index.md).

## Paid ads

| Variable | What it does |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Turns on [Google Ads](marketing/ads.md#set-up-google-ads) (search and YouTube video ads), with the Google app from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | The manager account (MCC) the ad accounts are reached through, if any |
| `ENABLE_META_ADS` | `true` turns on [Meta Ads](marketing/ads.md#set-up-meta-ads) (Facebook and Instagram ads), with the Facebook app from `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` |
| `GOOGLE_ADS_API_URL`, `META_GRAPH_URL` | The platforms' API addresses; only for tests against fake servers |

## Letters by post

| Variable | What it does |
|---|---|
| `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET` | Sends letter pieces by post through [Pingen](marketing/print.md#send-letters-with-pingen), billed to your Pingen account |
| `PINGEN_ORGANISATION_ID` | The Pingen organisation to send from (default: the first one) |
| `PINGEN_STAGING` | `true` uses Pingen's test environment; letters are checked but never sent |
| `PINGEN_API_URL` | Pingen's API address; only for tests against a fake server |

## Tests

| Variable | What it does |
|---|---|
| `TEST_DATABASE_URL` | Postgres database for the integration tests (`npm test`) |
