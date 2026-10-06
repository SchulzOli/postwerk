# Platform guide

Every network is a module in `packages/providers/src/` behind one interface (`Provider` in `types.ts`). Its static rules — text limits, media, per-post fields, setup — live in `catalog.ts` as plain data, so the composer validates in the browser with exactly the rules the server enforces.

## Status

All networks below are implemented and unit-tested against mocked APIs. **"Live-verified" means a real post went out through the real API.** Networks that need an operator app can only be live-verified once that app exists and (where noted) has passed review.

| Network | Connect | Operator setup (env prefix) | Media | Per-post fields | Token refresh | Live-verified |
|---|---|---|---|---|---|---|
| Mastodon | OAuth, app auto-registered per server | none | 4 images or 1 video, alt text | — | not needed | mock server |
| Bluesky | AT Protocol OAuth on the user's server; app password as fallback | none | 4 images, alt text | — | OAuth: short tokens, single-use refresh tokens | mock servers |
| Telegram | bot token + channel | none | up to 10 photos/videos (album) | — | not needed | — |
| Discord | channel webhook URL | none | 10 image embeds, video links | — | not needed | — |
| Facebook Pages | OAuth → one account per page | `FACEBOOK` | 10 images or 1 video | — | page tokens don't expire | — |
| Instagram | OAuth (Instagram Login) | `INSTAGRAM` | **required**: image, reel, or carousel ≤ 10 | — | long-lived token, refreshed 7 days before expiry | — |
| Threads | OAuth | `THREADS` | carousel ≤ 10, alt text | — | long-lived token, refreshed 7 days before expiry | — |
| LinkedIn (profile) | OAuth | `LINKEDIN` | 20 images, alt text | — | partners only; otherwise reconnect after ~60 days | — |
| LinkedIn Page | OAuth → one account per page | `LINKEDIN` | 20 images, alt text | — | same as above | — |
| X | OAuth 2.0 + PKCE | `X` | 4 images | — | 2 h tokens, rotating refresh token | — |
| TikTok | OAuth | `TIKTOK` | **required**: 1 video or ≤ 35 photos | privacy (must be chosen) | 24 h tokens | — |
| YouTube | Google OAuth → one account per channel | `GOOGLE` | **required**: 1 video | title, visibility | 1 h tokens | — |
| Google Business Profile | Google OAuth → one account per location | `GOOGLE` | 1 image | — | 1 h tokens | — |
| Pinterest | OAuth → one account per board | `PINTEREST` | **required**: 1 image, alt text | title, link | 30-day tokens | — |
| Reddit | OAuth | `REDDIT` | — (text posts) | subreddit, title | 1 h tokens | — |
| Sandbox | name | `ENABLE_SANDBOX=true` | anything | — | — | n/a |

## Bluesky sign-in

Bluesky needs no developer app. Postwerk describes itself in a client metadata document at its own address, and the user's server reads it:

- **On https** (`APP_URL=https://…`), Postwerk is a confidential client: `${APP_URL}/oauth/bluesky/client-metadata.json` is its client id, and it signs token requests with an ES256 key that it creates on first use, stores encrypted (`server_secrets`), and publishes at `/oauth/bluesky/jwks.json`. Sessions last as long as the user's server allows confidential clients.
- **On `http://localhost`** (development), it is a "loopback" client without a key; Bluesky sends people back to `127.0.0.1`, and the callback continues on `localhost`. Loopback sessions are shorter.
- **Elsewhere on plain http** (e.g. a LAN address), OAuth is not possible and people connect with app passwords.

Tokens are bound to a per-account DPoP key. If `ENCRYPTION_KEY` changes, the signing key is replaced and OAuth accounts must reconnect. Accounts connected with app passwords keep working; connecting the same account with OAuth replaces its app password.

## Setting up an operator app

1. Create the developer app in the network's console (links in the table below).
2. Register the callback URL **`${APP_URL}/api/connect/<network>/callback`** (e.g. `https://postwerk.example.com/api/connect/instagram/callback`). LinkedIn profile and page use `linkedin` and `linkedin_page`; YouTube and Business Profile use `youtube` and `google_business` — add both if you use both.
3. Set `<PREFIX>_CLIENT_ID` and `<PREFIX>_CLIENT_SECRET` (see `.env.example`) and restart. The network moves from "needs setup" to "Connect" on the accounts page.
4. Until the app passes review, only you and the testers you add in the console can connect.

| Network | Developer console / docs | Review before strangers can connect |
|---|---|---|
| Facebook | developers.facebook.com → Facebook Login for Business | Business verification + App Review: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` |
| Instagram | developers.facebook.com → Instagram API with Instagram Login | App Review: `instagram_business_basic`, `instagram_business_content_publish`; business verification for advanced access |
| Threads | developers.facebook.com → Threads API | App Review: `threads_basic`, `threads_content_publish` |
| LinkedIn | linkedin.com/developers | Profile: self-serve products "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect". Pages: Community Management API (partner review, registered legal entity) |
| X | developer.x.com | Paid API access; enable OAuth 2.0 (confidential client) with `tweet.read tweet.write users.read media.write offline.access` |
| TikTok | developers.tiktok.com → Content Posting API (Direct Post) | Audit before posts can be public; media URLs must be on a verified domain |
| Google | console.cloud.google.com | YouTube: OAuth verification for `youtube.upload` + quota extension. Business Profile: API access request form. Apps in "Testing" get refresh tokens that expire after 7 days |
| Pinterest | developers.pinterest.com | Trial access on creation (may be limited to the sandbox API); Standard access needs review |
| Reddit | reddit.com/prefs/apps | Manual approval under the Responsible Builder Policy |

## Known gaps and unverified details

The developer docs of most networks were not reachable while these modules were written, so some details come from prior knowledge. Check these first when live-testing:

- **Meta**: Graph API `v26.0`; Instagram code-exchange response shape (both wrapped and flat are handled); whether Threads' authorize host is now `threads.com`; Threads carousel limit (10 assumed, may be 20); `appsecret_proof` is not sent ("Require App Secret" must be off).
- **X**: v2 media upload request/response shape; alt text is not sent yet.
- **TikTok**: PKCE not used (web app); exact error codes; `publicaly_available_post_id` field name; brand-content disclosure fields not sent.
- **Google**: `languageCode` in the Business Information read mask; YouTube `categoryId` fixed to 22 (People & Blogs). A YouTube upload whose response is lost may be retried and upload twice (no idempotency key).
- **Pinterest**: trial apps may only write to `api-sandbox.pinterest.com`.
- **Telegram / Discord**: error description wording; Discord avatar CDN path.
- **Bluesky OAuth**: implemented from the AT Protocol OAuth spec and tested against fake servers that check PAR, PKCE, DPoP nonces and proofs, client assertions and refresh-token rotation, not yet against bsky.social. It asks for `atproto transition:generic` (the same access as an app password), not the newer fine-grained scopes.
- **Media links (security)**: besides uploads, the composer accepts public media links, which the server downloads for Mastodon, Bluesky, LinkedIn, X and YouTube. Obviously internal hosts are refused, but DNS is not resolved, so a hostname pointing at an internal address is not caught. On multi-tenant instances, prefer uploads.
- **Not yet supported**: Bluesky, LinkedIn and X videos; Pinterest videos; Reddit image/link posts; first comments.

## Adding a network

1. Add the id to `PROVIDER_IDS` (`types.ts`) and the `provider` enum in `packages/db/src/schema.ts` (a test fails if they differ), then `npm run db:generate`.
2. Describe it in `catalog.ts`: limits, media, options, setup.
3. Create `packages/providers/src/<network>.ts` exporting a `Provider`: spread the catalog entry, add a `connector` (`oauth2`, `form` or `mastodon`), `publish`, and `refresh`/`needsRefresh` if tokens expire. `linkedin.ts` is the reference implementation.
4. Use `http.ts` helpers so errors map to `ProviderError` (`retryable`, `needsReauth`); pass a `mapError` when the network encodes errors in the body.
5. Register it in `index.ts` and write tests with `test/helpers.ts` (`mockFetch`).
