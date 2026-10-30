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
