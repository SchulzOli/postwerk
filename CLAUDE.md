# Postwerk

Self-hosted social media scheduler. TypeScript monorepo (npm workspaces). Plan: `docs/PLAN.md`.

## Layout
- `apps/web` — Next.js 16 App Router. Read `apps/web/AGENTS.md` before changing Next.js code.
- `apps/worker` — publishing loop (`runPublishCycle` from `@postwerk/core`), bundled with esbuild.
- `packages/core` — business logic; web and worker only call into this.
- `packages/db` — Drizzle schema. After schema changes: `npm run db:generate`, commit the SQL in `packages/db/drizzle/`.
- `packages/providers` — one file per network implementing `Provider`; static limits/options in `catalog.ts` (browser-safe). Throw `ProviderError` with `retryable`/`needsReauth`. `linkedin.ts` is the reference; see `docs/PLATFORMS.md` → "Adding a network".

## Checks before committing
```bash
npm run typecheck && npm test && npm run build
```
Integration tests need Postgres (`npm run services:up`) and `TEST_DATABASE_URL` (see `.env.example`).

## Conventions
- Workspace packages export TypeScript source directly (no build step); imports are extensionless.
- Every server action re-checks the session (`requireSession` / `requireAdmin`) and scopes queries by `workspaceId`.
- Credentials are stored only via `encryptJson`; never log them.
- UI copy is short and plain; errors tell the user what to do next.
