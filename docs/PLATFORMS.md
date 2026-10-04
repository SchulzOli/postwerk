# Platform integration guide

What each network needs before Postwerk can publish to it natively, and what the user experience looks like. Requirements change often — check the linked developer docs before starting a review.

**Status legend:** ✅ implemented · 🌉 planned via bridge (Phase 2) · 🛠 planned native (Phase 3)

| Network | Status | Operator setup | User experience | Notable limits |
|---|---|---|---|---|
| Mastodon | ✅ | None. Postwerk registers an OAuth client on each server automatically | Enter server → approve on Mastodon | Per-server character limit (read from the server) |
| Bluesky | ✅ | None | Handle + app password (Phase 1: OAuth) | 300 graphemes |
| Sandbox | ✅ | `ENABLE_SANDBOX=true` | Enter a name | Fake network for demos/tests |
| LinkedIn (personal) | 🛠 | LinkedIn app with self-serve "Share on LinkedIn" (`w_member_social`) | Click → LinkedIn login | — |
| Facebook Pages | 🌉🛠 | Meta app, business verification, app review (`pages_manage_posts`, …) | Click → Facebook login → pick pages | — |
| Instagram | 🌉🛠 | Same Meta app; Instagram API with Instagram Login (`instagram_business_content_publish`), advanced access needs a verified business + app review | Click → Instagram login | Professional (Business/Creator) accounts only; 100 API posts / 24 h; media required |
| Threads | 🌉🛠 | Same Meta app, Threads permissions + review | Click → login | — |
| Google Business Profile | 🌉🛠 | Google Cloud project + Business Profile API access request form | Click → Google login → pick location | Update/event/offer posts |
| LinkedIn (company pages) | 🌉🛠 | Community Management API via partner program: registered legal entity, development tier → standard tier after screencast review (weeks–months) | Click → LinkedIn login → pick page | Admin role on page required |
| YouTube | 🌉🛠 | Google OAuth app verification for `youtube.upload`; quota extension audit | Click → Google login | Default quota allows only a few uploads/day; unverified apps' uploads are private |
| Reddit | 🌉🛠 | Manual approval under the Responsible Builder Policy (self-service ended Nov 2025; ~2–4 weeks) | Click → Reddit login | Subreddit rules, rate limits |
| TikTok | 🌉🛠 | Content Posting API + audit | Click → TikTok login | Unaudited apps can only post privately |
| Pinterest | 🌉🛠 | Trial access → standard access review | Click → Pinterest login | Image/video required |
| X | 🌉🛠 | Paid API (pay-per-use) | Click → X login | Cost per post |

## Adding a native provider

1. Add the id to `ProviderId` (`packages/providers/src/types.ts`) and the `provider` enum in `packages/db/src/schema.ts`, then `npm run db:generate`.
2. Create `packages/providers/src/<network>.ts` implementing `Provider`:
   - `validate()` — length/media rules, return readable messages
   - `publish()` — map HTTP errors with `ProviderError.fromHttpStatus` so retries and "reconnect needed" work automatically; pass `context.idempotencyKey` if the API supports it
3. Export connect helpers (authorize URL, code exchange, profile fetch) and add a connect action + callback route in `apps/web`.
4. Store only what `publish()` needs in the credentials object; it is encrypted at rest.
5. If tokens expire, add a refresh step before publishing (Phase 1 adds a shared token-refresh job).
6. Tests: mock `fetch` like `packages/providers/test/mastodon.test.ts`.

## Sources

- Instagram Platform overview: https://developers.facebook.com/docs/instagram-platform/overview
- LinkedIn Community Management API: https://learn.microsoft.com/linkedin/marketing/community-management/
- Reddit Responsible Builder Policy announcement (r/redditdev, Nov 2025)
- Google Business Profile API prerequisites: https://developers.google.com/my-business/content/prereqs
