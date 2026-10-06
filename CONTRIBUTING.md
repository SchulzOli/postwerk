# Contributing to Postwerk

Thanks for helping! Bug reports, ideas, translations and code are all welcome.

## Before you start

- **Bugs and ideas:** open an issue first, so we can agree on the approach before you put time into a pull request.
- **Security problems:** please report them privately, see [SECURITY.md](SECURITY.md).
- **Larger changes:** check [docs/plan.md](docs/plan.md) to see where the project is heading.

## Development setup

Requirements: Node 22+ and Docker (for Postgres). The [README](README.md#quick-start-development) has the full quick start:

```bash
npm install
cp .env.example .env        # then set ENCRYPTION_KEY (openssl rand -base64 32)
npm run services:up         # Postgres on localhost:5432
npm run db:migrate
npm run dev                 # web on http://localhost:3000 + worker
```

`ENABLE_SANDBOX=true` gives you a fake network to post to without real accounts.

## Checks

Run these before you open a pull request; CI runs the same:

```bash
npm run typecheck && npm test && npm run build
```

Integration tests need Postgres and `TEST_DATABASE_URL` (see `.env.example`); without it they are skipped.

## How the code is organized

- `apps/web` is the Next.js app: the canvas (`components/world/`), list pages and server actions.
- `apps/worker` is the publishing loop.
- `packages/core` holds the business logic; web and worker only call into it.
- `packages/db` has the Drizzle schema and SQL migrations.
- `packages/providers` has one file per network behind a common `Provider` interface.

Conventions:

- **Server actions** re-check the session (`requireSession` / `requireAdmin`) and scope every query by workspace.
- **Credentials** are stored only encrypted (`encryptJson`) and never logged.
- **Styling** uses the design tokens from `app/globals.css`, never hard-coded colors, fonts or radii, so every theme works in light and dark mode.
- **Text** shown to people exists in English and German (informal "du"). Add both to the area's catalog in `apps/web/messages/`; core and provider texts live in their `messages.ts`. TypeScript tells you when a translation is missing.
- **UI copy** is short and plain, and error messages say what to do next.
- **Schema changes** need a migration: change `packages/db/src/schema.ts`, run `npm run db:generate`, and commit the SQL.
- **New networks** follow `docs/platforms.md` → "Adding a network"; `packages/providers/src/linkedin.ts` is the reference implementation.
- **Documentation** lives in `docs/` and is published to [schulzoli.github.io/postwerk](https://schulzoli.github.io/postwerk/). Preview it with `cd docs && npm install && npm run dev`.

## Pull requests

- Keep each pull request focused on one change, with tests for new behavior.
- Describe what changed and why. For UI changes, add a screenshot.
- By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), like the rest of Postwerk.

## Code of conduct

Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
