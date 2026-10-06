# About and legal pages

Every Postwerk server is run by someone: the operator. The networks' developer consoles and reviews ask for the app's website, privacy policy, terms and data deletion instructions, and EU law asks for the operator's contact details. Postwerk can serve all of these, filled in for your server.

## Turn them on

```bash
OPERATOR_NAME=Oli Schulz – Physiotherapie Beispiel
OPERATOR_EMAIL=hallo@example.com
# Lines separated by ";"
OPERATOR_ADDRESS=Hauptstraße 1; 12345 Berlin; Germany
# Optional:
OPERATOR_PHONE=+49 30 1234567
# Optional, named as a service provider:
OPERATOR_HOSTING=Hetzner Online GmbH, Germany
```

With name and email set, these pages appear (in English and German, following the visitor's language):

| Page | Use it as |
|---|---|
| `/about` | the app's website or home page in developer consoles |
| `/legal/privacy` | privacy policy URL |
| `/legal/terms` | terms of service URL |
| `/legal/data-deletion` | data deletion instructions URL (Meta) |
| `/legal/imprint` | imprint (Impressum, § 5 DDG); needs `OPERATOR_ADDRESS` |

They are linked from the sign-in pages and from the account menu. The canvas lists their full addresses next to each network's setup, ready to copy.

## What the pages say

They are written from what Postwerk really does, and adapt to your settings:

- **Privacy policy:** who is responsible; what Postwerk stores and why (account, content, connected accounts with encrypted access, sign-in protection, an activity log whose IP addresses are deleted after 90 days, only necessary cookies, emails); the privacy policies of the networks offered on your server; the YouTube API Services wording Google requires, when YouTube is offered; the service providers your settings use (hosting, S3 storage, SMTP, Zernio); how long data is kept; people's rights.
- **Terms:** the service, accounts, content, liability, ending, changes; YouTube's terms when YouTube is offered.
- **Data deletion:** disconnecting accounts (and that Zernio removes them too), revoking access at the network, deleting everything by email.
- **About:** who runs the server, what Postwerk does, which networks people can connect and which go through Zernio.

::: warning Templates, not legal advice
The texts are a careful starting point for a small, self-hosted server in the EU. Your situation may need more, for example other processors, analytics you added, or rules of your profession. Have them checked, or use your own pages instead (below).
:::

## Use your own pages instead

If you already have a privacy policy or imprint on your website, link them:

```bash
LEGAL_PRIVACY_URL=https://example.com/datenschutz
LEGAL_TERMS_URL=https://example.com/agb
LEGAL_IMPRINT_URL=https://example.com/impressum
LEGAL_DATA_DELETION_URL=https://example.com/daten-loeschen
```

Postwerk then links to these and redirects its own `/legal/…` addresses there. Mention in your own policy what Postwerk stores; the list above is a good start.
