# NabaLens architecture (M0 discovery + M1 foundation)

Written by the foundation track on 29 October 2026. It records what the repository
actually contained, how the spec's proposed names map to real paths, the commands
that exist, and the decisions/assumptions made. Spec: `docs/spec/NabaLens-MVP-Execution-v0.2.md`;
shared names and ownership: `docs/fanout/CONTRACT.md`.

## 1. What the repository contained (M0 evidence)

At `06d6040` (base of `feat/nabalens-mvp`):

| Area            | Found                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | `next@16.4.2`, `react@19.3.1`, App Router (`app/`), TypeScript 5.9, `tsconfig` path alias `@/* → ./*`.                                      |
| UI              | Tailwind 4 (`app/globals.css`), shadcn 4 with Base UI (`components/ui/button.tsx`), `next-themes`, Phosphor icons. Template home page only. |
| Package manager | pnpm 10 (`pnpm-lock.yaml`, `pnpm-workspace.yaml` with `allowBuilds`). Node 24 locally.                                                      |
| Auth / DB       | None. No Supabase, no migrations, no env conventions.                                                                                       |
| Tests           | None.                                                                                                                                       |
| Deploy config   | None (no `vercel.json`, no CI). No git remote.                                                                                              |
| Next config     | `next.config.ts` empty: **Cache Components is not enabled**, so the previous caching model applies; pages that read cookies are dynamic.    |

### Next 16.4 facts checked in `node_modules/next/dist/docs/`

- **Proxy replaces Middleware** (`01-app/01-getting-started/16-proxy.md`): file `proxy.ts` at the
  root, exporting `proxy()` and an optional `config.matcher`. It runs on the Node.js runtime by
  default and the `runtime` option is not allowed. Docs: use Proxy only for _optimistic_ checks;
  Server Functions are POSTs to their page route, so **authorise inside every Server Function and
  Route Handler**, never in Proxy alone.
- `cookies()`, `headers()`, `params` and `searchParams` are **async** (`await`).
- A relative `Location` is rejected inside Proxy ("Invalid URL"); in Route Handlers it works.
  `request.url` can name `localhost` when the browser used `127.0.0.1`, so auth Route Handlers
  return relative 303 redirects (`app/auth/redirect.ts`) to keep cookies on the right origin.
- `@supabase/ssr@0.12`: `setAll(cookies, headers)` also passes no-store cache headers that must be
  forwarded on responses that set auth cookies (done in `lib/supabase/proxy.ts`).

## 2. Proposed names → real paths

| Spec / contract name                      | Real path                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/login`                                  | `app/login/page.tsx` (renders `LoginCard`), `actions.ts` (Server Function `requestSignInLink`)                            |
| Auth callback / confirm                   | `app/auth/confirm/page.tsx` + `verify/route.ts` (token_hash; used by our templates), `app/auth/callback/route.ts` (PKCE `code` fallback)    |
| Logout                                    | `app/auth/logout/route.ts` (POST) + `app/auth/sign-out-button.tsx`                                                      |
| Blocked account page                      | `app/auth/blocked/page.tsx` (`/auth/blocked`)                                                                           |
| Role redirect                             | `app/page.tsx` (`/` → `/staff`, `/admin`, `/login` or `/auth/blocked`)                                                  |
| Route guards                              | `proxy.ts` (optimistic, session refresh) + `lib/auth` (authoritative, per page/action/route)                            |
| `/staff`, `/admin`                        | `app/staff/page.tsx`, `app/admin/page.tsx` — **placeholders**, wave 2 replaces them                                     |
| Supabase clients                          | `lib/supabase/server.ts`, `browser.ts`, `admin.ts` (service role, `server-only`), `proxy.ts`, `env.ts`                  |
| `getCurrentProfile`, `requireStaff/Admin` | `lib/auth/index.ts` (`getAuthState`, `getCurrentProfile`, `requireActiveStaff`, `requireActiveAdmin`, `authorize`)      |
| Media limits                              | `lib/config/media.ts` (`MEDIA_LIMITS`) — the only place limits are defined                                              |
| Buckets and object keys                   | `lib/config/storage.ts` (`STORAGE_BUCKETS`, `mediaObjectKeys`, `avatarObjectKey`)                                       |
| DB types                                  | `lib/db/types.ts` (generated: `pnpm db:types`)                                                                          |
| Migrations / policies                     | `supabase/migrations/20261029120000_nabalens_schema.sql`, `…120100_nabalens_access.sql`, `…120200_nabalens_storage.sql` |
| Seeds                                     | `supabase/seed/venues.json` (owner-confirmed, empty), `supabase/seed.sql` (DEV FIXTURE, local only)                     |
| First admin                               | `scripts/bootstrap-admin.ts` (`pnpm bootstrap:admin`)                                                                   |
| Venue loader                              | `scripts/seed-venues.ts` (`pnpm seed:venues`)                                                                           |
| Auth email templates                      | `supabase/templates/magic_link.html`, `invite.html`                                                                     |
| Tests                                     | `vitest.config.ts` (projects `unit`, `integration`), `playwright.config.ts`, `tests/{unit,integration,e2e,support}`     |

## 3. Commands

| Command                                         | What it does                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | Install.                                                                                                 |
| `pnpm dev` / `build` / `start`                  | Next.js.                                                                                                 |
| `pnpm typecheck`, `pnpm lint`                   | `tsc --noEmit`, ESLint (next core-web-vitals + typescript).                                              |
| `pnpm test`                                     | Vitest unit project (no services needed).                                                                |
| `pnpm test:integration`                         | Vitest integration project against the **local** Supabase stack (refuses non-localhost URLs).            |
| `pnpm test:e2e`                                 | Playwright (mobile Pixel 7 + desktop 1280) against `next dev` on :3417 (`E2E_PORT`) and the local stack. |
| `pnpm db:start`, `pnpm db:reset`                | `supabase start` / `supabase db reset` (migrations + DEV FIXTURE seed).                                  |
| `pnpm db:types`                                 | Regenerate `lib/db/types.ts` from the local database.                                                    |
| `pnpm bootstrap:admin --email <e> [--name <n>]` | Promote an existing auth user to admin (service role from env).                                          |
| `pnpm seed:venues [--file <path>]`              | Upsert owner-confirmed venues by slug.                                                                   |

Local Supabase uses ports **554xx** (API 55421, DB 55422, Studio 55423, Mailpit 55424) so it can run
next to other local Supabase projects on the default 543xx ports. Edge runtime and analytics are
disabled locally (unused).

## 4. Data model (spec §6)

Exactly the spec's columns for `venues`, `profiles`, `media_assets`; enums `app_role`,
`media_type`, `upload_state`.

- **Object keys are stored relative to their bucket.** Bucket `media`:
  `{uploader_id}/{asset_id}/original.{ext}`, `…/preview.webp`, `…/thumb.webp`. Bucket `avatars`:
  `{user_id}/{uuid}.webp`. (The contract's `media/…` and `avatars/…` prefixes name the bucket.)
  Check constraints enforce these shapes against the row's own `uploader_id`/`id`.
- `profiles.venue_id` is required for `staff` (check constraint) and optional for `admin`.
- `media_assets.validated_mime_type` and `size_bytes` are nullable until processing; a check
  constraint requires both for `ready`.
- Indexes (partial, `deleted_at is null`): uploader feed `(uploader_id, created_at desc, id desc)`
  (all states, for the staff portfolio); venue feed and central feed `(… created_at desc, id desc)`
  restricted to `ready`. Cursor pagination uses `(created_at, id)`.
- Triggers:
  - `profiles_guard`: id/created_at immutable; venue must be active when assigned; for end users
    (`authenticated`) role never changes, and job title/venue/active change only for an active
    admin; an admin cannot deactivate themself.
  - `media_assets_insert_guard`: rows start `uploading`, without derivatives, at an active venue.
  - `media_assets_guard` (applies to **every** role, including the service role): owner, venue,
    type, filename and original key are immutable after reservation; derivative keys are set once;
    `deleted_at` is permanent; a `ready` asset's validated facts are frozen; state machine
    `uploading → processing|failed`, `processing → ready|failed|uploading`, `failed → uploading|processing`.

## 5. Access control (spec §7)

- SECURITY DEFINER helpers in the non-exposed `private` schema read the caller's **current**
  profile: `is_active_user()`, `is_active_staff()`, `is_active_admin()`, `uploadable_venue_id()`.
  Nothing reads roles from JWT claims or user metadata.
- Column-level grants: end users may `UPDATE` only `display_name, avatar_path, job_title, venue_id, active`
  on `profiles` (never `role`), and `profiles_guard` limits the last three to admins. No end-user
  `INSERT/UPDATE/DELETE` on `media_assets` or `venues` at all.
- RLS:
  - `venues`: select for any active user.
  - `profiles`: own row always readable (so a deactivated user can be told why); active admin reads
    all; staff update own row while active; admin updates staff rows and own row.
  - `media_assets`: staff read own non-deleted rows in any state while active; active admin reads
    non-deleted `ready` rows.
- RPCs for signed-in users:
  - `reserve_media_asset(p_media_type, p_extension, p_original_filename, p_size_bytes)` → `{id, original_path, venue_id}`.
    Generates the asset id and key, derives owner and venue from the current profile, requires an
    active staff profile at an active venue. **Size/format limits are not checked here**; server
    routes must check `lib/config/media.ts` first (the bucket cap is 200 MiB).
  - `delete_media_asset(p_asset_id)`: idempotent tombstone; owner (active staff) or active admin;
    unknown and forbidden look identical (`media_asset_not_found`).
- Storage (`storage.objects`), private buckets:
  - `media` (200 MiB cap, no MIME allow-list because content is validated from bytes): select only
    for a `ready`, non-deleted asset's original/preview/thumb key, by its active owner or an active
    admin; insert only to a key reserved by `reserve_media_asset` for the caller while `uploading`.
    No update/delete policies → no overwrite (`upsert` fails) and no direct removal.
  - `avatars` (5 MiB cap, `image/webp` only): select own folder (active user) or any (active admin).
    **No end-user writes**: the server validates the upload with `lib/media`, writes the derivative
    with the service role to `{user_id}/{uuid}.webp`, then sets `avatar_path`.
- Service role (`lib/supabase/admin.ts`, `import "server-only"`) bypasses RLS: callers must
  authorise with `lib/auth` first and re-check the resource.

## 6. Deletion and cleanup design (retryable tombstone)

The `media_assets` row is the tombstone. `deleted_at` hides it from every read path and every new
access grant immediately. Physical removal is a separate, retryable service-role job:

1. `prepare_media_cleanup(p_abandoned_after interval, p_limit int)` (service role only) tombstones
   abandoned reservations (`uploading`/`failed`, untouched longer than the window, which is
   `abandonedUploadInterval()` from `lib/config/media.ts` = 24 hours) and returns tombstoned assets
   that **still have objects** in `storage.objects`, with their object names.
2. The worker removes those names via the Storage API (service role).
3. Anything that failed reappears on the next run, because the source of truth is
   `storage.objects` itself. Rows are kept after cleanup (keys stay unique; audit trail).

**Not built here**: the worker/schedule itself (a server route or cron belongs to wave 2 / M6).
Do not claim cleanup runs until a scheduled job is deployed. Old avatar objects replaced by a new
avatar are not cleaned up by this function.

## 7. Authentication flow

- Sign-up is disabled (`[auth] enable_signup = false`). `[auth.email] enable_signup` must stay
  `true`: in the Supabase CLI it switches the whole email provider on (setting it to false gives
  "Email logins are disabled"). The login action also sends `shouldCreateUser: false`.
- `/login` → `requestSignInLink` → `sendSignInLink` always answers "Check your email", whether the
  address is invited, unknown or rate-limited (errors are logged by code only, never the email).
- Email templates link to `/auth/confirm?token_hash=…&type=email|invite`. Opening it only shows a
  **Continue** page and does not use the one-time token, because corporate mail scanners prefetch
  links with GET. Continue POSTs the token to `/auth/confirm/verify` (same-origin only), which calls
  `verifyOtp` server-side (works when the link is opened in another browser/app) and redirects to
  `/`. Failures go to `/login?error=link_invalid` (expired/used-link recovery).
- `/` re-reads the profile: active staff → `/staff`, active admin → `/admin`, no profile or
  inactive → `/auth/blocked`, no session → `/login`.
- `lib/auth` never caches: each call reads `profiles` again, so deactivation blocks existing
  sessions on their next request (proven in integration and e2e tests).
- Hosted setup still required (M6): set the same two templates, Site URL and redirect URLs in the
  Supabase dashboard, configure SMTP (e.g. existing Resend), and disable sign-ups.

## 8. Decisions and assumptions

- Smallest decisions taken where the spec was silent:
  - Venues are readable by every active user (names are organisational, not private).
  - A user can always read their own profile row, even when inactive, to show the blocked page.
  - Admins cannot change roles in-app or edit other admins; admin changes go through
    `bootstrap:admin` (spec: "controlled bootstrap procedure only").
  - The blocked page lives at `/auth/blocked` to stay inside foundation-owned paths.
  - Staff may see their own non-ready rows (to show uploading/processing/failed), but not the
    objects until `ready`.
- Avatars and derivatives are written only by the server; wave 2 needs a server action for avatar
  upload using `lib/media`.
- `allowBuilds` in `pnpm-workspace.yaml` was not changed; `tsx`'s esbuild works without its
  postinstall script.
- Integration and e2e tests create uniquely named `TEST …` users and venues and leave them in the
  local database; `pnpm db:reset` clears them.
