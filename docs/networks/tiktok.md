# TikTok

For most Postwerk servers, **TikTok goes through [Zernio](../bridge.md)**. TikTok's rules make an own app impractical:

- Until an app passes TikTok's audit, everything it posts is **private** (visible only to the account owner).
- TikTok's [content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines) do not approve "a utility tool to help upload contents to the account(s) you or your team manages". A server for your own work is exactly that.

So for your own accounts, use Zernio (`ZERNIO_API_KEY`) or switch TikTok off (`HIDE_NETWORKS=tiktok`).

## If you run a public service

A Postwerk server that many unrelated people use can apply. Postwerk has the code (`TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`, callback `${APP_URL}/api/connect/tiktok/callback`, scopes `user.info.basic video.publish`), but the audit also checks the posting screen, and Postwerk's composer does not have all of it yet. TikTok asks for:

- the creator's nickname, read fresh from TikTok, on the posting screen,
- a privacy choice offering only the options TikTok returns for that creator, with no default,
- switches for comments, duets and stitches,
- the commercial content disclosure,
- the music usage confirmation, and a preview the person confirms before posting.

TikTok also downloads videos and photos from Postwerk (`PULL_FROM_URL`), so the media address (your domain or `S3_PUBLIC_URL`) must be verified in the TikTok developer portal.

These are open tasks on the [roadmap](../plan.md). Until they are done, apply only if you build them.

TikTok's documentation: [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started) · [Content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)
