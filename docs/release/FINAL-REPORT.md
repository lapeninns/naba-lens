# NabaLens — final verification report

## Overall status: **READY FOR STAGING REVIEW**

Implementation and every local check pass on the tested revision. This is **not** ready for
real staff: staging, deployed email, the deployed HEIC decoder, physical phones and
owner-confirmed venues are unverified (see "Blocked and not run"). It does not claim
"bug-free" or "fully tested" beyond the scope and environment below.

## 1. Environment and tested revision

| Item                   | Value                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tested code revision   | `0d7ce65` on `feat/nabalens-mvp` (later commits change docs only)                                               |
| Environment            | LOCAL ONLY, macOS arm64 (Darwin 27), Node 24.16.0, pnpm 10.30.1 and 11.17.0                                     |
| Services               | Local Supabase CLI stacks (Auth, Postgres, Storage, Mailpit). Isolated stacks per suite; default stack on 554xx |
| Email                  | Local Mailpit sink only — does not prove deployed delivery                                                      |
| Staging / hosting      | None exists. The owner chose local-only (2026-10-29); creating Supabase/Vercel projects was not authorised      |
| Remote                 | None. Creating the private GitHub repo was blocked by the permission system, so there is no PR and no `lci` run |
| Load during final runs | 1-minute load average 1.3–7.7 (quiet host); earlier runs at load 20–40 are not used as evidence                 |

## 2. What was built (meaningful paths)

- **Data and policies:** `supabase/migrations/` (6 migrations: schema, access/RLS, private
  storage, cleanup, idempotent reserve key, security hardening). Private `media` and
  `avatars` buckets; end users never read Storage directly — app routes sign with the
  service role after their own checks.
- **Auth:** `/login` (magic link, no sign-up), `/auth/confirm` interstitial + POST
  `/auth/confirm/verify` (scanner-safe), role guard returning real 307s, deactivation
  blocking existing sessions, `scripts/bootstrap-admin.ts`.
- **Staff:** `/staff` portfolio, upload dialog (batch 10, 2 parallel, resumable TUS for
  large/video), edit name/avatar, delete own.
- **Admin:** `/admin` library (venue/staff/type filters, cursor paging, 15 s + focus
  refresh via abortable GET `/api/library`), `/admin/staff` directory (invite, resend,
  edit, venue transfer, deactivate/reactivate), `/admin/staff/[id]` portfolio (same
  gallery: preview, download original, delete).
- **Media:** `lib/media/` (content sniffing, validation, WebP derivatives, HEIC via WASM in
  a disposable worker, bounded video probing), `lib/server/media/` (reserve/finalise,
  signing, download with `attachment` + `nosniff` + validated type).
- **Lifecycle:** `lib/server/lifecycle/` (soft delete + retried physical cleanup,
  abandoned/stale reservation reaper, secret-protected `POST /api/internal/cleanup`).
- **Tests and CI:** `tests/{unit,ui,media,upload,integration,security,lifecycle,migrations,e2e,visual,load}`,
  `scripts/ci/local-ci.sh`, `.github/workflows/`, bundle secret scan.
- **Docs:** `docs/setup.md`, `docs/usage-staff.md`, `docs/usage-admin.md`,
  `docs/operations.md`, `docs/release-checklist.md`, `docs/backup-restore.md`,
  `docs/runtime-sizing.md`, `docs/reviews/*`, `docs/release/LEDGER.md`.

## 3. Requirement → evidence (tested revision `0d7ce65`, lead-run)

| Requirement                                                                               | Result                   | Evidence                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Invite-only; no public sign-up; invitations create staff only                             | PASS                     | security 153/153; integration `auth-invites`, `staff-accounts`; e2e journey invite                               |
| Magic link, neutral unknown email, expired/reused link recovery, scanner-safe confirm     | PASS                     | e2e `negative` (uninvited, reused/expired); integration `auth-links`; privacy runtime 12/12                      |
| Role routing; staff denied admin with real 307; blocked page for missing/inactive profile | PASS                     | e2e `auth-guards` 4/4; integration `auth-access`                                                                 |
| Staff edit only name/avatar; role/venue/active/owner/keys/state not client-controlled     | PASS                     | security 153/153 (column tamper, direct PostgREST/Storage as real users)                                         |
| Venue snapshot; transfer keeps history                                                    | PASS                     | e2e negative "venue transfer keeps old attribution"; integration                                                 |
| One shared asset in both views; admin sees it within ~15 s without approval               | PASS                     | e2e journey (second admin's open library) on Chromium, Firefox, WebKit, mobile                                   |
| Batch 10 / 2 parallel / per-file states / retry without duplicates / resumable            | PASS                     | e2e `upload-recovery` 4/4; integration upload-recovery; unit transport                                           |
| Limits 20 / 200 / 5 MiB server-enforced; declared vs stored size checked                  | PASS                     | integration upload-recovery; real 200 MiB TUS upload (uploads track)                                             |
| JPEG/PNG/WebP/HEIC derivatives; content validated server-side                             | PASS (local)             | media unit tests; e2e journey uploads a `sips` HEIC; deployed decoder NOT RUN                                    |
| MP4/MOV/WebM validated; playback or explicit fallback; original downloadable              | PASS (browser emulation) | e2e negative HEVC fallback + hash-equal download; visual video cases                                             |
| Original bytes preserved (SHA-256 equal)                                                  | PASS                     | e2e journey downloads JPEG, MP4, HEIC and compares hashes                                                        |
| Private storage; no cache/image-route leaks; short signed links                           | PASS                     | privacy runtime 12/12; bundle scan clean; `privacy-bundle` 3/3; integration headers                              |
| Staff isolation incl. same venue (list/view/sign/download/delete)                         | PASS                     | security 153/153 as real JWTs; e2e negative; integration `gaps-http`                                             |
| Deactivation blocks existing sessions; reactivation; admin keeps media                    | PASS                     | e2e negative + `staff-accounts`; lifecycle 23/23                                                                 |
| Deletion: both views, no new grants, physical cleanup retried                             | PASS                     | e2e journey (objects verified gone); lifecycle 23/23 incl. storage-failure retry                                 |
| Invitations: duplicate, resend, partial failure, auth outage                              | PASS                     | integration `staff-accounts`, `auth-invites`, `auth-directory`                                                   |
| Filters combine, stable paging, empty states, refresh on focus                            | PASS                     | e2e `filters`, `library`, `gaps`                                                                                 |
| Failure states (profile outage, hung refresh, failed download) usable                     | PASS                     | e2e `profile-outage`, `refresh-hang`, negative "failed download"                                                 |
| Responsive 360–1440, keyboard, focus, axe serious/critical = 0                            | PASS                     | e2e `responsive` 7/7 ×2; visual 45/45 (Chromium 5 widths, WebKit, Firefox); 13 screenshots inspected by the lead |
| Migrations safe with retained data; backup/restore drill                                  | PASS (local)             | migrations upgrade 7/7, reset 3/3, lint 3/3; drill 12/12 objects byte-identical                                  |
| Scope: only Staff/Admin; nothing excluded                                                 | PASS                     | independent scope audit (final section); `scope-guard` unit test                                                 |
| Physical iPhone/Android capture, HEIC, video, backgrounding                               | BLOCKED / NOT RUN        | needs devices and a person                                                                                       |
| Staging E2E, deployed email, deployed decoder, cleanup schedule, hosted limits            | BLOCKED / NOT RUN        | no staging (owner decision)                                                                                      |

## 4. Commands and results on `0d7ce65`

| Command                                                           | Exit                   | Counts                                                                                                           |
| ----------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CI=true pnpm install --frozen-lockfile` (pnpm 10.30.1 / 11.17.0) | 0 / 0                  | lockfile passes `minimumReleaseAge`                                                                              |
| `pnpm typecheck` / `pnpm lint`                                    | 0 / 0                  | 0 warnings                                                                                                       |
| `pnpm test`                                                       | 0                      | 163 passed                                                                                                       |
| `pnpm test:integration` (fresh `db reset`)                        | 0                      | 205 passed, 0 failed, 13 skipped (privacy runtime 12 + bundle 1, run separately below)                           |
| `pnpm test:security`                                              | 0                      | 153 passed                                                                                                       |
| `pnpm test:lifecycle`                                             | 0                      | 23 passed                                                                                                        |
| `tests/migrations/run.mjs` upgrade / reset / lint                 | 0                      | 7 / 3 / 3 passed                                                                                                 |
| Backup → restore drill (`scripts/db/*`)                           | 0                      | 12/12 objects byte-identical; 48/48 direct reads denied                                                          |
| Critical e2e gate run 1 (`retries: 0`, 1 worker)                  | 0                      | A 10/10, B 7/7, C 3/3 (Firefox, WebKit, mobile)                                                                  |
| Critical e2e gate run 2 (consecutive)                             | 0                      | A 10/10, B 7/7, C 3/3                                                                                            |
| Other e2e specs, Chromium                                         | 0                      | 24 + 4 passed                                                                                                    |
| Other e2e specs, mobile-chromium                                  | 0                      | 15 passed, 1 skipped (desktop-only HTTP check, passed on Chromium)                                               |
| `pnpm test:visual` (Chromium, WebKit, Firefox)                    | 0                      | 45 passed                                                                                                        |
| `scripts/ci/privacy-runtime.mjs`                                  | 0                      | 12 passed, 0 skipped                                                                                             |
| `scripts/ci/scan-bundle.mjs` + `privacy-bundle` test              | 0                      | no findings; 3 passed                                                                                            |
| Full `scripts/ci/local-ci.sh` on the final revision               | NOT RUN as one command | every stage it runs was run individually above. An independent run on `5d28d64` found 3 defects, all since fixed |

Verified journey (twice, Chromium; once each on Firefox, WebKit, mobile): admin A invites a
new staff member in the UI → real invite email (Mailpit) → interstitial Continue → staff
uploads JPEG + MP4 + HEIC with real Uploading/Processing/Uploaded states → persists after
reload and in a fresh session → admin B's already-open library shows them without reload →
combined filters → portfolio → preview → download originals with matching SHA-256 → staff
deletes one → gone from both views, old links refused, original and derivatives removed.

## 5. Browser and device coverage

- Chromium, Firefox and WebKit desktop (Playwright), mobile-width Chromium emulation.
- WebKit is Playwright's engine on macOS, **not** Safari on iPhone. Emulation does not prove
  camera capture, HEIC from real phones, iOS/Android codecs or background behaviour.
- Screenshots: `.artifacts/screenshots/visual/` (gitignored). The lead inspected the staff
  portfolio, upload dialog, library, staff menu, viewer, HEVC fallback, login expiry, dark
  mode and long names. No defects found. The thin light edges on fixture tiles are part of
  the synthetic images (`tests/visual/fixtures.ts:106`), not the app.

## 6. Blocked and not run (affected gate → responsible party)

| Item                                                                                               | Blocks           | Who                                          |
| -------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------- |
| Staging Supabase + hosting; run the journey there                                                  | CONTROLLED PILOT | Owner: authorise creating projects           |
| Private GitHub repo `lapeninns/nabalens`, PR, `lci` profile run                                    | Review / merge   | Owner: allow `gh repo create` (or create it) |
| SMTP (e.g. Resend), auth redirect URLs, Site URL, email templates → `/auth/confirm`                | CONTROLLED PILOT | Owner / ops                                  |
| Owner-confirmed venue names (`supabase/seed/venues.json` is empty)                                 | CONTROLLED PILOT | Owner                                        |
| Physical iPhone + Android: camera, HEIC, MOV/HEVC playback, backgrounding                          | CONTROLLED PILOT | Owner + staff with devices                   |
| HEIC worker startup and memory on Linux/Vercel (≥ 2 GiB, 120–300 s timeout)                        | CONTROLLED PILOT | Engineering on staging                       |
| Hosted Storage limits ≥ 200 MiB; resumable URL expiry ≤ 24 h; trigger on `storage.objects` allowed | CONTROLLED PILOT | Engineering on staging                       |
| Cleanup scheduler (`CLEANUP_SECRET` + cron) actually running                                       | PRODUCTION       | Ops                                          |
| Hosted backup restored into a separate project; separate copy of media files                       | PRODUCTION       | Ops                                          |

## 7. Usage, deployment and recovery

Staff and admin guides: `docs/usage-staff.md`, `docs/usage-admin.md`. Setup and production
checklist (every item marked not done): `docs/setup.md`. Operations, capture guideline and
retention: `docs/operations.md`. Backup and restore: `docs/backup-restore.md` (restore tested
locally only). Runtime sizing: `docs/runtime-sizing.md`. Limits that stay true in any
environment: signed links already issued keep working until they expire (60 s), and
downloaded copies cannot be recalled.

## 8. Scope confirmation

Only the Staff and Admin interfaces exist (admin navigation: Content, Staff). There are no
approvals, tasks, manager role, public profiles, social features, captions or tagging, AI,
editing, notifications beyond auth emails, analytics, ZIP export, admin upload,
venue-management UI or multi-organisation fields. Confirmed by the independent scope audit
(`docs/reviews/scope-audit.md`, final section) and enforced by `tests/unit/scope-guard.test.ts`.
