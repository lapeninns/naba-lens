# NabaLens fan-out contract

> **v0.3 (30 Oct 2026):** the menu catalogue / media labels feature uses
> [CONTRACT-v0.3-menus.md](CONTRACT-v0.3-menus.md) for branches, ownership and
> interfaces. The wave-era branch (`feat/nabalens-mvp`), track names and the
> "exactly the spec's columns" rule below are historical for that feature;
> the hard limits still apply.

Several coding agents build NabaLens in parallel, each on its own branch and git
worktree. This file fixes the shared names and file ownership so their work merges
cleanly. The product spec is `docs/spec/NabaLens-MVP-Execution-v0.2.md`; the agent
brief is `docs/spec/NabaLens-Coding-Agent-Prompt.md`. Read both first.

## Branches

- Integration branch: `feat/nabalens-mvp`. Never commit to `main`.
- Each track works on its own `feat/nl-<track>` branch, based on the current
  `feat/nabalens-mvp`, in its own worktree. Commit with Conventional Commits.
- Only the integrator thread merges into `feat/nabalens-mvp`.
- There is no git remote yet. Do not add one, push, or open PRs.

## Hard limits for every track

- Read `AGENTS.md`: this is Next.js 16.4 with breaking changes. Read the relevant
  guide in `node_modules/next/dist/docs/` before writing Next code (for example
  `proxy.ts` replaces `middleware.ts` if the docs say so).
- `pnpm` only, `pnpm install --frozen-lockfile` when nothing changed; when your
  track must add a dependency, `pnpm add` it and commit `package.json` and
  `pnpm-lock.yaml`. Don't upgrade existing dependencies.
- No hosted Supabase project, deploys, `supabase db push`, `supabase link`, secret
  or DNS changes. Use the local stack only (`supabase start`, Docker is installed).
- Never read or print `.env*` files that you did not create. Commit only
  `.env.example`.
- Don't invent venue names, staff or credentials. Venues come from
  `supabase/seed/venues.json` (production: owner-supplied) and dev fixtures in
  `supabase/seed.sql`, clearly labelled `DEV FIXTURE`.
- Two roles only: `staff`, `admin`. Nothing from the spec's out-of-scope list.
- Before you finish: run `pnpm typecheck`, `pnpm lint`, `pnpm test` (when it
  exists) and `pnpm build`, and report the real output. Commit all your work on
  your branch. End your final message with a `## Handoff` section: branch, what
  is done, what is stubbed, commands and results, and anything the next wave
  must know.

## Shared names (from spec section 6)

Tables: `venues`, `profiles`, `media_assets`, with exactly the spec's columns.

**Amendment (wave 2, slice):** `media_assets.client_upload_key text` (nullable,
`^[A-Za-z0-9_-]{8,128}$`, immutable) with a unique index on
`(uploader_id, client_upload_key)`. `reserve_media_asset` takes an optional fifth
argument `p_client_upload_key` and returns `(id, original_path, venue_id,
upload_state, reused)`; a repeated key from the same uploader returns the existing
asset (spec §5: "retry the same asset ID"). Migration
`supabase/migrations/20261029160000_media_client_upload_key.sql`. This is the only
column beyond the spec.
Enums: `app_role` (`staff`, `admin`), `media_type` (`image`, `video`),
`upload_state` (`uploading`, `processing`, `ready`, `failed`).
Private buckets: `media` (originals and derivatives), `avatars`.
Object keys: `media/{uploader_id}/{asset_id}/original.{ext}`,
`.../preview.webp`, `.../thumb.webp`; `avatars/{user_id}/{uuid}.webp`.
Media limits live only in `lib/config/media.ts`.

## Module ownership

| Path                                                                                                            | Owner track       |
| --------------------------------------------------------------------------------------------------------------- | ----------------- |
| `supabase/**` (config, migrations, seed, policies)                                                              | foundation        |
| `lib/supabase/**` (server, browser, admin/service clients)                                                      | foundation        |
| `lib/auth/**` (`getCurrentProfile`, `requireStaff`, `requireAdmin`, active checks)                              | foundation        |
| `lib/config/**`, `lib/db/types.ts`                                                                              | foundation        |
| `app/login/**`, `app/auth/**`, `proxy.ts`/route guards, role redirects                                          | foundation        |
| `vitest.config.ts`, `playwright.config.ts`, `tests/` harness                                                    | foundation        |
| `scripts/bootstrap-admin.ts`                                                                                    | foundation        |
| `lib/media/**` (sniffing, validation, image/HEIC derivatives, video probe)                                      | media             |
| `app/globals.css` theme tokens, `components/ui/**` (shadcn), `components/nabalens/**` presentational components | ui                |
| `app/staff/**`, `app/admin/page.tsx`, upload/download/sign routes                                               | slice (wave 2)    |
| `app/admin/staff/**`, invitation/account actions                                                                | accounts (wave 2) |

Presentational components in `components/nabalens/**` take data and callbacks
as props and never fetch data or import `lib/supabase`. Server code never
imports from `components/`.

`lib/media` exposes pure server functions with no Supabase imports, roughly:
`sniffMedia(bytes) -> { kind, mime, ext } | null`,
`validateMedia(input, limits) -> result`,
`createImageDerivatives(bytes, mime) -> { preview, thumb, width, height }`,
`probeVideo(bytes | path) -> { mime, width?, height?, durationSeconds? }`.
