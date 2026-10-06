# X

X has no app review, but its API is paid: you pay per use, for your own posts as well. Postwerk reads the app from `X_CLIENT_ID` and `X_CLIENT_SECRET`.

| Callback URL to register | Scopes |
|---|---|
| `${APP_URL}/api/connect/x/callback` | `tweet.read tweet.write users.read media.write offline.access` |

## Set it up

1. Sign in at the [X developer console](https://developer.x.com/) and set up paid API access.
2. Create a project and an app.
3. Under **User authentication settings**, turn on **OAuth 2.0**:
   - app type: **Web App** (a confidential client),
   - callback URI: `${APP_URL}/api/connect/x/callback`,
   - website URL: `${APP_URL}/about` (see [About and legal pages](../legal.md)).
4. Copy the OAuth 2.0 **Client ID** and **Client Secret** into `X_CLIENT_ID` and `X_CLIENT_SECRET`, then restart Postwerk.
5. On the canvas, click X → **Continue to X**.

X tokens last two hours; Postwerk refreshes them by itself.

## Other options

- Through [Zernio](../bridge.md): no X developer account needed. Zernio passes X's API costs on at X's prices.
- Not at all: `HIDE_NETWORKS=x`.

Known gap: alt text is not sent to X yet ([status](../platforms.md#known-gaps-and-unverified-details)).
