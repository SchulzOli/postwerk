# LinkedIn

One LinkedIn developer app serves both personal profiles and company pages. Postwerk reads it from `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

| Network | Callback URL to register | Scopes |
|---|---|---|
| LinkedIn (profile) | `${APP_URL}/api/connect/linkedin/callback` | `openid profile w_member_social` |
| LinkedIn Page | `${APP_URL}/api/connect/linkedin_page/callback` | `r_organization_admin w_organization_social` |

## Create the app

1. Go to [linkedin.com/developers](https://www.linkedin.com/developers/apps) → **Create app**.
2. Link the app to a **LinkedIn Page**. LinkedIn requires one, and a Page admin confirms the link. Your own business page works.
3. Add your privacy policy URL (`${APP_URL}/legal/privacy`, see [About and legal pages](../legal.md)) and a logo.
4. Under **Auth**, copy the **Client ID** and **Primary Client Secret** into `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, and add the callback URLs above as **Authorized redirect URLs**.

## Profile

Add two products under **Products**:

- **Share on LinkedIn**
- **Sign In with LinkedIn using OpenID Connect**

Both are self-serve: they work right away, for your own profile and for everyone else's. Restart Postwerk, then on the canvas click LinkedIn → **Continue to LinkedIn**.

LinkedIn gives these apps tokens for about 60 days and no refresh tokens. Postwerk marks the account "reconnect needed" when it expires; reconnecting takes one click.

## Company pages

Posting as a company page needs the **Community Management API**. LinkedIn grants it on request and reviews the request, also for your own pages. It is only for registered legal entities: you describe your company and how the app uses the API. Request it under **Products** once the app exists.

Until it is granted, LinkedIn Page can connect through [Zernio](../bridge.md): with `ZERNIO_API_KEY` set, list it in `ZERNIO_NETWORKS` (for example `ZERNIO_NETWORKS=linkedin_page`). That way the profile keeps using your own app.

Texts you can adapt for the access request:

| Scope | Why Postwerk needs it |
|---|---|
| `r_organization_admin` | Lists the pages the person administers, so they can choose which ones to connect. |
| `w_organization_social` | Publishes the posts the person wrote and scheduled in Postwerk to the page they chose. |

LinkedIn's documentation: [Share on LinkedIn](https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin) · [Posts API for pages](https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api)
