# Reddit

Since November 2025, Reddit approves new API access by hand under its **Responsible Builder Policy**. Postwerk reads the app from `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`.

| Callback URL to register | Scopes |
|---|---|
| `${APP_URL}/api/connect/reddit/callback` | `identity submit` |

## Set it up

1. Request API access as the [announcement](https://www.reddit.com/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/) describes, explaining what your server does (for example: "schedules the text posts I write to subreddits I take part in").
2. Once approved, create a **web app** at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) with the redirect URI `${APP_URL}/api/connect/reddit/callback`.
3. Copy the app id (under the app's name) and the secret into `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`, then restart Postwerk.
4. On the canvas, click Reddit → **Continue to Reddit**.

Each post needs a subreddit and a title; Postwerk asks for both in the composer. Postwerk posts text only so far.

| Scope | Why Postwerk needs it |
|---|---|
| `identity` | Shows which Reddit account the person connected. |
| `submit` | Submits the posts the person scheduled in Postwerk to the subreddit they chose. |

Or connect Reddit through [Zernio](../bridge.md).

Reddit's documentation: [API reference](https://www.reddit.com/dev/api/) · [Announcement of the Responsible Builder Policy](https://www.reddit.com/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/)
