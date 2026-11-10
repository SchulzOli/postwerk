# MarketingApp4BusinessCentral

MarketingApp4BusinessCentral is an extension for Microsoft Dynamics 365 Business Central. It connects a company in Business Central to a MarketingAsAService workspace, so people can run their marketing from where their contacts, customers and sales already are.

Business Central knows who the customers are and what they bought. MarketingAsAService makes, approves and delivers the marketing and counts what it cost. The app joins the two: a campaign in Business Central gets its letters, ads and posts from MarketingAsAService, and MarketingAsAService learns from Business Central what the campaign sold.

> **Status: defined, not built yet.** The project is in `apps/business-central` and compiles in CI. Today it has the setup page with the server address and nothing else. This page says what the app will do and in which order it gets built.

## What it does

| In Business Central | What the app adds | Step |
|---|---|---|
| **MarketingAsAService Setup** | The server's address and an API key for one workspace, with **Test connection** | 1 |
| **Campaign** card | Link the campaign to one in MarketingAsAService, or create it there with its name and dates. A FactBox shows status, budget, spend, leads and cost per lead, and opens the campaign in the browser. | 2 |
| **Segment** | **Send letter**: pick an approved letter of the linked campaign, see the price, confirm. Every contact of the segment gets their own letter by post. Each letter's status comes back, and the contact's history shows the letter as an interaction. | 3 |
| Posted sales invoices and credit memos with a campaign number | Sales and revenue per day go to the campaign's results, so its return on ad spend comes from real invoices | 4 |
| **Company Information** | Name, address, phone, email, website and logo fill the company part of the brand kit, when someone asks for it | 5 |

Later, once the steps above are in use: a post or piece draft from an item (name, description, picture, price), and booking ad spend and postage as costs in Business Central.

## Who keeps what

- **Business Central** keeps people, addresses, items and sales. **MarketingAsAService** keeps the brand, the content, approvals, delivery and the marketing numbers. Nothing is copied that the other side does not need.
- **Approval stays in MarketingAsAService.** Business Central can only send pieces an owner or admin approved there, as for [every piece](marketing/index.md#approval).
- **Business Central calls the server, never the other way round.** The server needs no access to Business Central, and no app registration in Microsoft Entra. It has to be reachable over `https` from Business Central online.
- **One company, one workspace.** The setup is per company. Two companies can use two workspaces, or share one.

## Personal data

The app sends personal data only for letters: a contact's name and postal address, at the moment someone confirms the mailing. Nothing else about contacts or customers leaves Business Central. Sales go out as totals per campaign and day, without customers.

- Contacts marked **Privacy Blocked** are never sent, and the confirmation says how many were left out.
- The addresses are then handled like [any mailing's](marketing/print.md#send-letters-with-pingen): kept until someone deletes them, and passed to Pingen for printing.
- The API key is kept in Business Central's isolated storage, encrypted, and never appears in a table, a log or an error.

## How it talks to the server

The app is the first client of MarketingAsAService's public API (Phase 5 of the [roadmap](plan.md)). An owner or admin creates an API key for the workspace in MarketingAsAService and pastes it into the setup page. Every request carries it as `Authorization: Bearer …` and is scoped to that workspace, like every server action.

The API does not exist yet. These are the calls the app needs, in the order of the steps:

| Call | For |
|---|---|
| `GET /api/v1/workspace` | Test connection: the workspace's name and currency |
| `GET /api/v1/campaigns`, `POST /api/v1/campaigns`, `GET /api/v1/campaigns/{id}` | Link or create a campaign; its status, budget and totals |
| `GET /api/v1/campaigns/{id}/pieces` | The approved letters of a campaign |
| `POST /api/v1/mailings/estimate` | The price before sending |
| `POST /api/v1/mailings` with an `Idempotency-Key` | Send; a retry never sends twice |
| `GET /api/v1/mailings/{id}` | Where each letter stands |
| `PUT /api/v1/campaigns/{id}/results/business-central/{day}` | Sales and revenue of a day; sending a day again replaces it |
| `PATCH /api/v1/brand` | Company details and logo |

Errors come back in the user's language with what to do next, as in the web app, and the app shows them as they are.

## Decisions

| Decision | Why | Revisit when |
|---|---|---|
| An extension in AL for Business Central online (`target: Cloud`), from version 26 | Online is where most companies are; a cloud extension also runs on-premises | Someone needs an older version |
| Object numbers 50100–50199, names start with `MaaS` | The range every company may use for its own extensions, so the app installs as a per-tenant extension without registering anything | The app goes to AppSource: Microsoft then assigns a range and a prefix |
| It builds on Business Central's own campaigns, segments and contacts | People keep their lists and habits; no second address book | — |
| The API key is the only credential | Simple to set up and to revoke; fits a self-hosted server | Several people need their own rights: one key per person, or sign-in |
| Open source, with the source readable in the installed app | Same license as the rest (MIT) | — |

## The project

`apps/business-central` is an AL project inside the monorepo. It is not an npm workspace: the TypeScript build ignores it, and it has its own check in CI (`.github/workflows/business-central.yml`).

```
apps/business-central
  app.json           The app: name, version, object numbers, Business Central version
  src/               One object per file, in a folder per area: MaaSSetup.Table.al
  Translations/      German texts (…de-DE.xlf); the compiler writes the English …g.xlf
  scripts/build.sh   Compiles the app and checks the translation, as CI does
```

To work on it, open the folder in VS Code with the [AL Language extension](https://marketplace.visualstudio.com/items?itemName=ms-dynamics-smb.al), download symbols from a sandbox and publish with F5. To check it without a sandbox:

```bash
dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease
apps/business-central/scripts/build.sh
```

Rules for the code:

- Texts are English in the source and German in `Translations/`. The build fails when a German text is missing or its English text changed.
- Secrets are `SecretText` in isolated storage. They never go into a table field, a message or telemetry.
- The app only talks to the server's `/api/v1`. It holds no marketing logic of its own: formats, limits and checks stay in `@maas/core`.

## Build order

Each step is useful on its own. Sizes as in the [roadmap](plan.md).

1. [ ] **Connect (M).** API keys per workspace in MarketingAsAService (created and revoked by owners and admins, stored hashed) and `GET /api/v1/workspace`. In the app: the API key on the setup page and **Test connection**.
2. [ ] **Campaigns (M).** Link or create a campaign from the campaign card, the FactBox with its numbers, and a job queue entry that refreshes them.
3. [ ] **Letters to a segment (M).** Price, confirmation, sending, status per letter, and an interaction per contact.
4. [ ] **Sales and revenue (S–M).** A daily job queue entry sends each linked campaign's invoiced sales to its results.
5. [ ] **Company details to the brand kit (S).**
6. [ ] **AppSource (M, only if offered to others).** A registered object range and prefix, Microsoft's validation, and a listing.
