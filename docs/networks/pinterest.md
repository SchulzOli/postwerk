# Pinterest

Postwerk reads the app from `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`.

| Callback URL to register | Scopes |
|---|---|
| `${APP_URL}/api/connect/pinterest/callback` | `boards:read pins:read pins:write user_accounts:read` |

## Set it up

1. Create an app at [developers.pinterest.com](https://developers.pinterest.com/apps/). Pinterest asks for a business account, a company name, the app's website (`${APP_URL}/about`) and privacy policy (`${APP_URL}/legal/privacy`, see [About and legal pages](../legal.md)).
2. Add `${APP_URL}/api/connect/pinterest/callback` as redirect URI.
3. Copy the **App id** and **App secret key** into `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`, then restart Postwerk.
4. On the canvas, click Pinterest → **Continue to Pinterest**. Each board becomes its own account.

New apps get **trial access**, which only publishes to the Pinterest account that owns the app (Pinterest has also limited trial apps to its sandbox at times). For your own boards that can be enough. For other people's boards, request **standard access** in the app's settings, with a short video showing how people connect and pin (see [App reviews](reviews.md)).

Pinterest downloads the pin's image from Postwerk, so `APP_URL` (or `S3_PUBLIC_URL`) must be reachable from the internet.

| Scope | Why Postwerk needs it |
|---|---|
| `user_accounts:read` | Shows which Pinterest account the person connected. |
| `boards:read` | Lists the person's boards, so they choose where pins go. |
| `pins:read`, `pins:write` | Creates the pins the person scheduled in Postwerk and links to them afterwards. |

Or connect Pinterest through [Zernio](../bridge.md).

Pinterest's documentation: [API v5](https://developers.pinterest.com/docs/api/v5/)
