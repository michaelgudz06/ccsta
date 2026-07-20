# CCSTA — Charter Bus Quote/Booking App

TanStack Start (React 19) + Supabase. Customer-facing quote form, admin
dashboard, driver/trip management for a charter bus company.

## Stack
- TanStack Start + React Router (file-based routes in `src/routes`)
- Supabase (Postgres + RLS + edge functions) — schema lives in
  `supabase/migrations`, functions in `supabase/functions`
- shadcn/ui + Radix + Tailwind v4 (`src/components/ui`)
- react-hook-form + zod for forms
- Supabase MCP is configured (`.mcp.json`) — use it for DB queries/migrations
  instead of guessing schema from code

## Commands
- `vite dev` / `npm run dev` — local dev server
- `npm run lint` / `npm run format` — eslint / prettier
- No test runner configured (playwright is a devDependency but unused so far)

## Critical facts — check before assuming otherwise
- **`main` is production and is live for real customers right now.** Do not
  assume work on a feature branch is deployed. Check the current branch and
  `NEXT_SESSION.md` for what's actually merged/deployed before making claims
  about "the live site."
- Migrations can be applied to the live Supabase DB *before* the frontend
  that uses them ships — additive columns/tables are safe, but don't assume
  DB state matches what's on `main`.
- `NEXT_SESSION.md` is the standing handoff note — read it first each
  session, update it before ending a session, delete/replace stale entries
  rather than letting it grow indefinitely.
- `WHATS_NEW.md` is the running changelog/backlog — check it for context on
  recent work instead of re-deriving history from git log.

## Conventions
- Match existing component patterns in `src/components` before introducing
  new ones; this is a shadcn/ui project, so prefer composing existing
  primitives over new dependencies.
- Business logic (pricing, estimates, trip assignment) lives in Supabase
  SQL functions (`supabase/migrations/*_fn.sql` files), not duplicated in
  the frontend — check there first when estimate/pricing numbers look wrong.
- Real money and real customer bookings are involved — treat schema changes
  and deploys to `main` with corresponding care; don't push to `main`
  without being asked.

## Token-usage notes
- Keep this file the only thing read at session start — don't re-read
  `WHATS_NEW.md`/`NEXT_SESSION.md` in full every turn; grep/read the
  relevant section only.
- Prefer targeted file reads over broad greps across `node_modules` or
  `supabase/migrations` (41 migration files) when you already know which
  migration or component is relevant.
