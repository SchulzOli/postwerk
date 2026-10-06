# Facebook, Instagram and Threads

One Meta developer app covers all three. Inside it, Instagram and Threads get their own app ids and secrets, so Postwerk has three pairs of settings:

| Network | Settings | Callback URL to register |
|---|---|---|
| Facebook Pages | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `${APP_URL}/api/connect/facebook/callback` |
| Instagram | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | `${APP_URL}/api/connect/instagram/callback` |
| Threads | `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET` | `${APP_URL}/api/connect/threads/callback` |

The canvas shows these URLs with your real address: click the network, then "Setup on this server".

::: tip Only your own accounts? No review needed
While the app only serves accounts of people who have a role on it (admin, developer or tester), **standard access** is enough. Meta's App Review and business verification are only needed before other people connect their accounts.
:::

## Before you start

- A Facebook account, registered as a developer at [developers.facebook.com](https://developers.facebook.com/).
- Postwerk on a public https address (`APP_URL`). Instagram and Threads download images and videos from it.
- Your legal pages (set `OPERATOR_NAME` and `OPERATOR_EMAIL`, see [About and legal pages](../legal.md)).
- Instagram: a professional account (business or creator).

## Create the app

1. In the developer dashboard, choose **Create app**.
2. Pick the use cases you need: managing a Page's content, Instagram's API with Instagram Login, and the Threads API. Meta changes the wording of this dialog from time to time; the names of the products below stay.
3. Under **App settings → Basic**, fill in:
   - **Privacy Policy URL:** `${APP_URL}/legal/privacy`
   - **Terms of Service URL:** `${APP_URL}/legal/terms`
   - **User data deletion:** "Data deletion instructions URL" → `${APP_URL}/legal/data-deletion`
   - **App domain** (your server's host), an icon and a category.

## Facebook

1. Add **Facebook Login for Business** to the app.
2. Under its settings, add `${APP_URL}/api/connect/facebook/callback` to **Valid OAuth Redirect URIs**.
3. Copy the **App ID** and **App secret** (App settings → Basic) into `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET`, then restart Postwerk.
4. *Only your own Pages:* under **App roles**, give everyone whose Pages you connect a role (admin, developer or tester).
5. On the canvas, click Facebook → **Continue to Facebook** and pick the Pages. Each Page becomes its own account.

Postwerk asks for `pages_show_list`, `pages_manage_posts` and `pages_read_engagement`.

## Instagram

Postwerk uses the **Instagram API with Instagram Login**: people sign in with Instagram itself, no Facebook Page needed.

1. In the app, open the Instagram product's **API setup with Instagram login**.
2. Copy the **Instagram app ID** and **Instagram app secret** into `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET`. They are different from the Meta app's id and secret.
3. Under **business login settings**, add `${APP_URL}/api/connect/instagram/callback` as redirect URL.
4. *Only your own accounts:* under **App roles**, add each Instagram account as **Instagram tester**. Accept the invite in Instagram (Settings → Apps and websites → Tester invites).
5. Restart Postwerk; on the canvas, click Instagram → **Continue to Instagram**.

Postwerk asks for `instagram_business_basic` and `instagram_business_content_publish`. Instagram only takes JPEG images; Postwerk checks this while you write.

## Threads

1. Add the **Threads API** use case. Copy the **Threads app ID** and **Threads app secret** into `THREADS_CLIENT_ID` and `THREADS_CLIENT_SECRET`.
2. Add `${APP_URL}/api/connect/threads/callback` as redirect callback URL in the Threads settings.
3. *Only your own accounts:* under **App roles**, add each Threads account as **Threads tester** and accept the invite in Threads (account settings → website permissions).
4. Restart Postwerk; on the canvas, click Threads → **Continue to Threads**.

Postwerk asks for `threads_basic` and `threads_content_publish`.

## When other people should connect

1. **Business verification** of the business portfolio that owns the app (Meta asks for documents of a registered business).
2. **App Review** for each permission, with a screencast of the real flow and a test account for the reviewer. See [App reviews](reviews.md) for the screencast script.
3. Switch the app to **Live**.

Texts you can adapt for the review form (describe what *your* server does):

| Permission | Why Postwerk needs it |
|---|---|
| `pages_show_list` | Lists the Facebook Pages the person manages, so they can choose which ones to connect as publishing targets. |
| `pages_manage_posts` | Publishes the posts the person wrote and scheduled in Postwerk to the Page they chose, at the time they chose. |
| `pages_read_engagement` | Reads the Page's name and picture to show which Page a post goes to, and the link of a published post. |
| `instagram_business_basic` | Reads the account's username and profile picture to show which account the person connected. |
| `instagram_business_content_publish` | Publishes the photos, carousels and reels the person scheduled in Postwerk. |
| `threads_basic` | Reads the profile's username and picture to show which account the person connected. |
| `threads_content_publish` | Publishes the text, photo and video posts the person scheduled in Postwerk. |

## Or use the bridge

Without an app, set `ZERNIO_API_KEY` and all three connect through [Zernio](../bridge.md).

Meta's documentation: [Pages API](https://developers.facebook.com/docs/pages-api/posts) · [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) · [Threads posts](https://developers.facebook.com/docs/threads/posts) · [App roles](https://developers.facebook.com/docs/development/build-and-test/app-roles)
