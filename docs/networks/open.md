# Mastodon, Bluesky, Telegram and Discord

These four need no developer app and no review. They work on every Postwerk server right away; switch any of them off with `HIDE_NETWORKS` if you don't want to offer it.

## Mastodon

People enter their server (for example `mastodon.social`) and approve access there. Postwerk registers itself on each server automatically, the first time someone from that server connects. It reads the server's character limit, so long-post servers get their full length.

## Bluesky

People sign in on their own Bluesky server (AT Protocol OAuth); app passwords remain as a fallback. How it works depends on `APP_URL`:

- **On https** (`APP_URL=https://…`), Postwerk is a confidential client. `${APP_URL}/oauth/bluesky/client-metadata.json` is its client id. It signs token requests with an ES256 key that it creates on first use, stores encrypted, and publishes at `/oauth/bluesky/jwks.json`. Sessions last as long as the user's server allows confidential clients.
- **On `http://localhost`** (development), it is a "loopback" client without a key. Bluesky sends people back to `127.0.0.1`, and the callback continues on `localhost`. Loopback sessions are shorter.
- **Elsewhere on plain http** (for example a LAN address), OAuth is not possible and people connect with app passwords.

Tokens are bound to a per-account DPoP key. If `ENCRYPTION_KEY` changes, the signing key is replaced and OAuth accounts must reconnect. Accounts connected with app passwords keep working; connecting the same account with OAuth replaces its app password.

## Telegram

Postwerk posts through a bot you create:

1. In Telegram, write to [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. Add the bot to your channel or group as an administrator that may post messages.
3. In Postwerk, enter the token and the channel's `@username` (or its numeric id for private chats).

## Discord

Postwerk posts through a channel webhook:

1. In Discord: Server Settings → Integrations → Webhooks → New Webhook, pick the channel, then **Copy Webhook URL**.
2. In Postwerk, paste the webhook URL.
