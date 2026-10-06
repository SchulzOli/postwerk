# YouTube and Google Business Profile

One Google Cloud project with one OAuth client serves both. Postwerk reads it from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

| Network | Callback URL to register | Scopes |
|---|---|---|
| YouTube | `${APP_URL}/api/connect/youtube/callback` | `youtube.upload youtube.readonly` |
| Google Business Profile | `${APP_URL}/api/connect/google_business/callback` | `business.manage` |

## Create the project and OAuth client

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. Configure the **OAuth consent screen** (Google Auth Platform → Branding):
   - app name and support email,
   - **Application home page:** `${APP_URL}/about`,
   - **Privacy policy:** `${APP_URL}/legal/privacy`, **Terms of service:** `${APP_URL}/legal/terms` (see [About and legal pages](../legal.md)),
   - your domain under **Authorized domains** (Google asks you to verify it in Search Console).
3. Under **Clients**, create an **OAuth client ID** of type **Web application** and add both callback URLs above as **Authorized redirect URIs**.
4. Copy the client id and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart Postwerk.

While the app's publishing status is **Testing**, only the test users you add can sign in, and their sign-ins expire after **7 days**: Postwerk then marks the account "reconnect needed". Publishing the app to **In production** with sensitive scopes needs Google's **OAuth verification**.

## YouTube

1. Enable the **YouTube Data API v3** in the project.
2. On the canvas, click YouTube → **Continue to YouTube** and pick the channel.

::: warning Uploads stay private until the audit
Google restricts videos uploaded through unverified API projects created after July 2020 to private viewing, **also on your own channel**. To publish public videos, the project must pass YouTube's [API compliance audit](https://support.google.com/youtube/contact/yt_api_form). Until then, use [Zernio](../bridge.md) for YouTube (`ZERNIO_NETWORKS=youtube`).
:::

What the audit and the verification look for, and what Postwerk already provides:

- The privacy policy says that the service uses YouTube API Services and links Google's privacy policy; the terms refer to YouTube's Terms of Service. Postwerk's [built-in pages](../legal.md) include both when YouTube is offered.
- People can revoke access: the data deletion page links Google's permissions page, and disconnecting in Postwerk deletes the tokens.
- A screencast of signing in, choosing the channel and uploading (see [App reviews](reviews.md)).

| Scope | Why Postwerk needs it |
|---|---|
| `youtube.upload` | Uploads the videos the person scheduled in Postwerk to their channel. |
| `youtube.readonly` | Reads the channel's name and picture to show which channel the person connected. |

## Business Profile

1. Request access to the **Business Profile APIs** as Google's [prerequisites](https://developers.google.com/my-business/content/prereqs) describe, with your Cloud project's number. Google expects a business profile you manage that has been verified and active for at least 60 days, and a website for the business. Approval takes days to weeks.
2. Once approved, enable the Business Profile APIs (Account Management and Business Information) in the project.
3. On the canvas, click Google Business Profile → **Continue to Google Business Profile**. Each location becomes its own account.

| Scope | Why Postwerk needs it |
|---|---|
| `business.manage` | Lists the person's business locations and publishes the updates they scheduled in Postwerk. |

Google's documentation: [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) · [Business Profile posts](https://developers.google.com/my-business/content/posts-data) · [OAuth verification](https://support.google.com/cloud/answer/9110914)
