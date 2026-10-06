# Postwerk

Self-hosted social media scheduler. TypeScript monorepo (npm workspaces). Plan: `docs/PLAN.md`.

## Layout
- `apps/web` — Next.js 16 App Router. Read `apps/web/AGENTS.md` before changing Next.js code.
  - `/canvas` is the main UI: `components/world/` (React Flow). `layout.ts` builds the world from server data; node ids (`network:x`, `account:id`, `flow:id`, `step:flow:step`, `region:x`) are also deep-link targets. Inputs inside nodes need `nodrag` (and `nowheel` for scrollables).
  - The flow planner (`@postwerk/core/flow`) is pure and runs in the browser and on the server — keep it free of Node/DB imports.
  - The look is a theme plugin (`@postwerk/core/theme`, also browser-safe; built-ins in `packages/core/src/themes/`, format in `docs/THEMES.md`). Style components with the tokens from `app/globals.css` (`var(--surface)`, `var(--radius-card)`…), never hard-coded colors, fonts or radii, so every theme works in light and dark.
- `apps/worker` — publishing loop (`runPublishCycle` from `@postwerk/core`), bundled with esbuild.
- `packages/core` — business logic; web and worker only call into this.
- `packages/db` — Drizzle schema. After schema changes: `npm run db:generate`, commit the SQL in `packages/db/drizzle/`.
- `packages/providers` — one file per network implementing `Provider`; static limits/options in `catalog.ts` (browser-safe). Throw `ProviderError` with `retryable`/`needsReauth`. `linkedin.ts` is the reference; see `docs/PLATFORMS.md` → "Adding a network".
  - Aggregators (Zernio) implement `Bridge` in `bridges/`; routing, linking and usage live in `@postwerk/core` (`bridge.ts`, `bridge-usage.ts`). See `docs/BRIDGE.md`.

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
- Every UI text exists in English and German ("du"): add both to the area's catalog in `apps/web/messages/` (`useMessages` in client components, `getMessages` on the server). Core errors are `LocalizedError`s; core and provider texts live in their `messages.ts`.
