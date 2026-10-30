# NabaLens scope audit

**Audited:** `feat/nabalens-mvp` @ `3a23c9b` (branch `review/nl-scope`)
**Against:** `docs/spec/NabaLens-MVP-Execution-v0.2.md`, `docs/spec/NabaLens-Coding-Agent-Prompt.md`
**Method:** read of every file under `app/`, `components/`, `lib/`, `supabase/`, `scripts/`; keyword sweeps over source, copy and `pnpm-lock.yaml`/`package.json` for each out-of-scope item.

## Verdict: PASS

No out-of-scope feature ships. The product surface is exactly the two-interface MVP: staff portfolio + upload, admin library + staff directory. One in-scope gap (admin portfolio page is preview-only) and minor observations are listed at the end.

## Exactly two roles

- DB enum: `create type public.app_role as enum ('staff', 'admin')` — `supabase/migrations/20261029120000_nabalens_schema.sql:13`. Generated types agree: `app_role: "staff" | "admin"` — `lib/db/types.ts:198` and `lib/db/types.ts:325`.
- RLS/policies: helpers `private.is_active_staff()` / `private.is_active_admin()` — `supabase/migrations/20261029120100_nabalens_access.sql:24-48`; no third role appears in any policy in that file or `supabase/migrations/20261029120200_nabalens_storage.sql`.
- Code: `AppRole` derives from the generated enum — `lib/auth/routes.ts:3`; checks are `requireActiveStaff`/`requireActiveAdmin` (`lib/auth/index.ts:65-72`), `requireAdminCaller` (`lib/server/accounts/context.ts:87-96`), `getMediaActor(role)` (`lib/server/media/context.ts:20-28`).
- UI: only `"staff" | "admin"` shell variants — `components/nabalens/app-shell.tsx:7-30`; edit dialog variants `"staff" | "admin"` — `components/nabalens/edit-profile-dialog.tsx:44`.
- No `manager`/moderator/other role anywhere (grep over `*.{ts,tsx,sql}`).

## Staff interface: no navigation to other portfolios

- Staff shell renders only the wordmark and Log out — `components/nabalens/app-shell.tsx:64-83` (`variant: "staff"` shows no `nav`).
- Staff gallery queries only the caller's rows: `listOwnMedia` — `app/staff/page.tsx:22-25`, `lib/server/media/library.ts:166-174`; viewer gets no `getPortfolioHref`/`getDownloadHref` — `app/staff/staff-portfolio.tsx:99-106`.
- Server-side isolation repeats in RLS: `media_assets_select_own` (`...120100_nabalens_access.sql:163-169`) and `profiles_select_own` (`:137-139`) — staff cannot read other profiles or assets even via the Data API; `/admin/*` redirects non-admins (`lib/auth/index.ts:48-59`).

## Admin navigation: only Content and Staff

- `NAV` has exactly two entries — `components/nabalens/app-shell.tsx:27-30` (`Content → /admin`, `Staff → /admin/staff`).
- Route inventory confirms nothing else user-facing: `/` (role redirect, `app/page.tsx`), `/login`, `/auth/{blocked,callback,confirm,logout}` (infrastructure), `/staff`, `/admin`, `/admin/staff`, `/admin/staff/[id]` (+ `/avatar` POST), `/api/{profile,avatars/[id],media/[id]/*,internal/cleanup}`, and dev-only `/(dev)/ui-preview`.

## Out-of-scope features — none present

| Item | Result |
|---|---|
| Admin-upload feature | None. `UploadDialog` mounts only in `app/staff/staff-portfolio.tsx:107-116` (and the dev preview). `reserveUpload`/`finaliseUpload` force a staff actor — `app/staff/actions.ts:20,37`; `reserve_media_asset` raises `not_active_staff` — `supabase/migrations/20261029160000_media_client_upload_key.sql:75-77`; `finaliseAsset` refuses non-staff — `lib/server/media/finalise.ts:~161`. |
| Venue-management UI | None. No venue CRUD route, action or mutation exists. Admin only assigns an existing active venue to a staff account — `lib/server/accounts/directory.ts:153-166` (`listAssignableVenues`, read-only), `lib/server/accounts/manage.ts:83-96`. `scripts/seed-venues.ts` is the spec-allowed seed/config path; `venues.json` stays empty pending owner data. |
| Approval/review states | None. `upload_state` is `uploading,processing,ready,failed` — `supabase/migrations/20261029120000_nabalens_schema.sql:15` (technical, per spec §6). No approve/reject action in any component or Server Function. |
| Tasks | None. No task model, route or copy. |
| Captions/tagging workflow | None. `media_assets` has no caption/tag columns (`...120000_nabalens_schema.sql:70-103`); `MediaItem` carries none — `components/nabalens/types.ts:9-30`. `<figcaption>` in `components/nabalens/media-tile.tsx:104` is the HTML element showing contributor/venue/date, not an editable caption. |
| Comments/likes | None. |
| Notifications beyond auth emails | Only `supabase/templates/invite.html` and `supabase/templates/magic_link.html`; configured at `supabase/config.toml:251-257`. No notification table, UI or sender. |
| Analytics/usage tracking | None. No analytics/event code or dependency (`package.json:25-42`). `lastSignInAt` feeds only the invited/active status derivation — `lib/server/accounts/directory.ts:46-52`; it is not displayed. |
| ZIP export / bulk download | None. Only per-file `GET /api/media/[id]/download`, admin-gated — `app/api/media/[id]/download/route.ts:15`. No archive dependency. |
| Public profiles | None. Every profile/media route authenticates; profile reads are own-row or admin-only by RLS (`...120100_nabalens_access.sql:137-155`). `[auth] enable_signup = false` — `supabase/config.toml:176`; login never creates users — `lib/auth/magic-link.ts:27`. |
| AI | None. No AI dependency or call. |
| Editing tools | None. `sharp` only produces fixed-size derivatives server-side — `lib/media/index.ts:86-165` (`.rotate()` is EXIF auto-orientation). No crop/annotate UI. |
| Multi-org fields | None. `venues`/`profiles`/`media_assets` have no organisation/tenant column; comments assert one organisation (`...120000_nabalens_schema.sql:36`, `lib/server/accounts/directory.ts:92`). |
| Realtime infra for refresh | None used. Foreground polling at 15 s + focus — `app/_media/media-gallery.tsx:112-131`; no realtime/channel code. |

## Copy/text check

Swept `app/` and `components/` for "approve", "pending review", "submitted"/"submit" and adjacent terms (task, caption, tag, comment, like, notif, analytic, zip, export, AI, crop, manager, org, tenant, sign-up, dashboard, stats, share, follow, feed, public profile). User-visible strings are clean: queue states read "Uploading / Processing / Uploaded / Failed / Cancelled" (`components/nabalens/upload-dialog.tsx:49-57`), badges read "Uploading / Processing / Ready / Failed" (`components/nabalens/format.ts:45-50`), and the delete confirmation is the exact spec sentence (`components/nabalens/confirm-delete-dialog.tsx:19-20`). Only non-product hits: one test title using "approve" for content validation (`tests/media/sniff.test.ts:8`, see observations) and comments asserting the states are not approval states (`components/nabalens/upload-state-badge.tsx:13`, `components/nabalens/types.ts:6`).

## Findings and observations

1. **In-scope gap (not a violation):** the individual portfolio page is preview-only. Spec §3 requires the admin's preview/download/delete to work there too, but `MediaViewer` is rendered without `getDownloadHref`/`onDelete` — `app/admin/staff/[id]/portfolio-gallery.tsx:76-82`; the file's own comment admits it (`:17-18`). Download/delete do work in the library view (`app/admin/admin-library.tsx:86-90`).
2. **`tests/media/sniff.test.ts:8`** — test titled "size-only cannot approve content". It describes validation semantics, not an editorial state; flagged only because the audit searched for the word.
3. **`app/(dev)/ui-preview`** — development component gallery with fake fixtures; `notFound()` in production (`app/(dev)/ui-preview/page.tsx:13`), `robots: noindex`, unlinked. Consistent with the contract's labelled-fixture rule.
4. **`supabase/config.toml:87`** — `[realtime] enabled = true` is a stock local-stack service; the app never uses it (polling per spec §3). No violation.
5. **`supabase/config.toml:224`** — `[auth.email] enable_signup = true` enables the email provider for magic links; public sign-up stays blocked by `[auth] enable_signup = false` (`:176`) and `shouldCreateUser: false` (`lib/auth/magic-link.ts:27`). Documented in the file's comments.
6. **`media_assets.client_upload_key`** — one column beyond spec §6; it is the documented contract amendment (`docs/fanout/CONTRACT.md`, `supabase/migrations/20261029160000_media_client_upload_key.sql`), an idempotency key, not a product feature.

## Final candidate 5d28d64

**Audited:** `feat/nabalens-mvp` @ `5d28d64` (re-audit of `3a23c9b` above; same checklist, plus everything merged since).
**Method:** full read of `git diff 3a23c9b..5d28d64` across `app/`, `components/`, `lib/`, `supabase/`, `scripts/`, CI config and `package.json`/`pnpm-lock.yaml`; every original checklist claim re-verified against the tree; the forbidden-feature sweeps re-run.

### Verdict: PASS

Nothing merged since `3a23c9b` adds a product feature. The product surface is still exactly the two-interface MVP. The audit's one in-scope gap is now closed: the admin portfolio page runs the same library gallery with working preview, download and delete (`app/admin/staff/[id]/admin-portfolio.tsx:29-39`).

### Checklist re-verified at 5d28d64

- **Two roles.** `app_role` is still `('staff','admin')` (`supabase/migrations/20261029120000_nabalens_schema.sql:13`); generated types unchanged (`lib/db/types.ts:208,335`); no third role in code or policies.
- **Staff isolation.** `listOwnMedia` still filters to the caller (`lib/server/media/library.ts:166-173`); the staff gallery still gets no `getDownloadHref` (`app/staff/staff-portfolio.tsx:99-116`); RLS own-row policies unchanged. New `app/staff/layout.tsx` only rejects non-staff earlier (real 307 before streaming).
- **Admin navigation.** Still exactly Content and Staff (`components/nabalens/app-shell.tsx:27-30`).
- **Routes.** The inventory adds only `/auth/confirm` (page) and `/auth/confirm/verify` (handler) — email-link landing infrastructure — plus `/staff` and `/admin` layout gates. No new product screen or API.
- **Forbidden features.** All sweeps clean: no approval/review states, comments, likes, tagging, captions, notifications, analytics, ZIP export, AI, tasks, venue management UI, public profiles, multi-org fields or realtime refresh. `upload_state` is unchanged. The only new dependency is `@axe-core/playwright` (devDependency, accessibility checks in the visual suite).
- **Copy.** New user-visible strings are the email-link landing ("Accept your invitation" / "Sign in to NabaLens" + Continue), the auth-outage notice, and 503 retry messages — all in-scope plumbing, no feature language.

### New pieces since the audit — in-scope infrastructure, not features

| Piece | What it is | Scope call |
|---|---|---|
| Security headers (`next.config.ts`) | Static CSP plus nosniff, Referrer-Policy, Permissions-Policy and X-Frame-Options on every route (wave-3 finding 7) | Hardening; adds no surface |
| Cleanup reaper | `fail_stale_media_processing` RPC and DB-side `take_over_stale_media_claim` reap crashed finalises; `runCleanup` batches storage removal behind a lease (`lib/server/lifecycle/cleanup.ts`). `/api/internal/cleanup` already existed; it gains a GET twin for Vercel Cron and a constant-time secret check | Spec §5/§7 maintenance job, not a user feature |
| CI scripts | `.github/workflows/ci.yml` (three browser lanes) and `scripts/ci/*`: frozen installs, isolated stack prep, suite runner, privacy runtime, `scan-bundle.mjs` secret-leak gate | Test/CI plumbing |
| Visual tests | `playwright.visual.config.ts`, `tests/visual/*`, axe-core accessibility and screenshot QA across widths/browsers | Test plumbing |
| Auth interstitial | `/auth/confirm` renders a Continue form; only its POST to `/auth/confirm/verify` spends the one-time token (mail scanners prefetch GETs), behind a same-origin check | Auth plumbing for the existing magic-link/invite flow |
| Directory degradation | Auth admin-API calls bounded (`AUTH_LOOKUP_DEADLINE_MS`, 20 pages max in `lib/server/accounts/auth-users.ts`); on an Auth outage `/admin/staff` renders with `AuthDetailsNotice` instead of failing | Reliability on the existing directory |

Everything else in the range is a fix or hardening inside an existing feature: `proxy.ts` session refresh (Next 16 proxy), `lib/server/http/same-origin.ts` CSRF backstop on cookie-bearing POSTs, `lib/upload/upload-keys.ts` resume idempotency, `app/_media/preview-recovery.ts` re-sign on stale preview URLs, the `20261030100000_security_hardening` migration (drops end-user storage SELECT, re-checks reservations on every original write, enforces reserve-time limits), `scripts/db/*` local-only backup/restore drill, and UI polish (hit areas, contrast, ellipsis, download-error alert, video decode fallback). `lib/server/accounts/portfolio.ts` was removed; the portfolio page reuses `listLibrary` via `loadLibraryPage`, which is also what fixed the gap.

### Scope-guard

`pnpm exec vitest run tests/unit/scope-guard.test.ts`: **10/10 pass** — route allow-list, forbidden-feature scan over `app/`+`lib/`+`components/`+`proxy.ts`+migrations, dependency scan, and the self-check. The guard itself encodes the route inventory audited above.

### Observations carried forward

- Observations 2–6 from the `3a23c9b` audit stand unchanged (test title wording, dev-only `/ui-preview` 404-gated in production, stock `[realtime]` local service, `[auth.email] enable_signup` for magic links with public sign-up still off, the documented `client_upload_key` column).
- Observation 1 is resolved: `/admin/staff/[id]` preview/download/delete now work through the shared `MediaGallery`.
