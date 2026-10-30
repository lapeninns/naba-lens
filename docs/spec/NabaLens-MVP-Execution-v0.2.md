# NabaLens — MVP execution brief

**Version:** 0.2 · 29 October 2026  
**Status:** Implementation handoff; no application, deployment or repository inspection is claimed by this document.  
**Amended by:** [v0.3 menu catalogue and media labels](NabaLens-Menus-Labels-v0.3.md) (30 Oct 2026), which authorises optional labelling and replaces the "captions or tagging workflow" exclusion below for that feature only.  
**Supersedes:** The earlier v0.1 feature scope. Content requests, review/approval, campaign tools and extra user roles must not carry over.

## 1. Product contract

**NabaLens is a private staff portfolio and marketing media library for one group of 10 pubs/restaurants.**

Staff have individual profiles and upload photos/videos. Each successful upload appears in the staff member’s portfolio and the admin’s shared library. These are two views of the same asset, not separate submissions or copies.

**Core journey:** Admin invites staff → staff logs in → staff uploads → portfolio and admin library show the media → admin downloads it for marketing outside NabaLens.

There are exactly two application roles: `staff` and `admin`. Job titles such as curry chef, tandoori chef and bartender are descriptive profile fields, not permissions.

### In scope

- Individual accounts, profiles and one assigned venue per staff member.
- Staff photo/video upload and own portfolio.
- Admin’s combined media library, staff directory and individual portfolios.
- Filtering by venue, contributor and media type.
- Media preview, individual-file download and basic deletion.
- Admin invitations, profile/venue assignment and account deactivation.
- The authentication, storage, validation and error handling needed to make these functions safe and reliable.

### Explicitly out of scope

No content tasks, approval/rejection workflow, manager role, public portfolios, staff-to-staff browsing, captions or tagging workflow, comments, likes, notifications other than authentication emails, AI, editing tools, scheduled publishing, usage tracking, analytics dashboard, leaderboard, payments, native apps, offline mode, bulk ZIP export, multi-organisation SaaS or NabaPresence integration.

Technical states such as “Uploading” and “Processing” are not editorial approval states.

## 2. Fixed MVP decisions

| Area | Decision |
|---|---|
| Product form | Responsive web app; phone-first for staff and desktop-friendly for admin. |
| Organisation | One organisation. Seed the owner-confirmed 10 venues; do not invent their names. |
| Accounts | Invite-only individual accounts. No shared venue logins and no public sign-up. |
| Sign-in | Reuse established Naba authentication. For a greenfield Supabase build, use email magic links with account creation disabled in the login path. |
| Staff venue | Exactly one current assigned venue. Admin controls assignment. |
| Historical venue | Save the venue on each upload; never derive old assets’ venue from the contributor’s current profile. |
| Portfolio visibility | Staff sees only their own portfolio. Admin sees all portfolios, including inactive contributors’ retained assets. |
| Upload metadata | Contributor, venue and upload time are automatic. No mandatory title, caption, tags or category. |
| Profile editing | Staff may change their own display name and profile photo. Admin controls job title, venue, account activation and application role. |
| Media deletion | Staff may remove their own media; admin may remove any media. Confirmation explains that both views lose the asset. |
| Downloads | Admin downloads one original uploaded file at a time. Browser preview saving is not claimed to be preventable. |
| Admin creation | First admin provisioned by a secure deployment procedure; never promote the first person who signs up. Additional admins use the same controlled procedure in this MVP. |

An account without an active, valid profile must not access the app. An active staff profile without a valid venue may see a setup message, but must not upload.

## 3. Screens and interactions

Route names below are **proposed**, not claims about an existing repository. Map them to actual project conventions during discovery.

### Shared login — `/login`

NabaLens branding, email input, “Send sign-in link”, sent state, expired-link recovery and logout. Send staff to their portfolio and admins to the library after authentication. Use a neutral response for unknown/uninvited emails; do not expose a public account directory.

### Staff portfolio — `/staff`

Header: profile photo or initials, display name, job title and assigned venue. Main action: **Upload photos or videos**. Below: newest-first gallery of the staff member’s own media.

An upload dialog/sheet contains file selection, previews, per-file progress, cancel/remove-before-upload, retry and clear completion. An edit-profile dialog changes only the permitted fields. A viewer opens an image or video. Delete requires confirmation.

Empty state: “Your portfolio starts here. Upload your first photo or video.” No dashboard statistics, required descriptions or unrelated navigation.

### Admin library — `/admin`

Newest-first gallery across all venues and contributors. Three filters: **Venue**, **Staff member**, **Photos / Videos / All**. Show contributor, original venue and upload date on each asset or in its viewer. Use server-side filtering and pagination.

Admin can preview, download the original, open the contributor’s portfolio, or remove the asset. There is no approval button. Filters combine correctly and can be cleared.

An open library refreshes in the foreground approximately every 15 seconds and when the tab regains focus. New ready assets require no manual approval or page reload. Do not add a separate realtime infrastructure layer just for this behaviour.

### Staff directory — `/admin/staff`

Show profile photo/initials, name, job title, current venue and account status. Actions: open portfolio, invite staff, edit account details/venue, resend invitation and deactivate/reactivate.

The invite form collects name, email, job title and venue. Handle existing-email and partial invitation failures without duplicate accounts or false success. Invitations create staff accounts only.

### Individual portfolio — `/admin/staff/[id]`

Display that person’s profile and gallery. Media retains its upload-time venue, including after a transfer. Admin’s preview/download/delete actions work here too. Reuse the portfolio/gallery components instead of building a second implementation.

The admin navigation has only **Content** and **Staff**. Authentication callback routes are infrastructure, not another user-facing area.

## 4. UI requirements

Reuse verified Naba brand tokens and components. When no shared design system exists in the target repo, create a restrained NabaLens theme rather than guessing other products’ exact styles.

Use large, clearly labelled upload controls; readable text; keyboard-accessible dialogs; visible focus; loading and empty states; and a responsive media grid. Preserve full images inside the viewer even when thumbnails are cropped. Never autoplay videos with sound.

Test at 360, 390, 768, 1280 and 1440 CSS-pixel viewport widths, plus actual participating phones. These are project QA targets, not device guarantees. Avoid horizontal overflow, hidden primary actions and hover-only controls.

Camera capture is an enhancement. Always retain ordinary file selection because the HTML capture attribute has limited and device-dependent support. [S4]

## 5. Media handling contract

These are **chosen initial product limits**, not claims about hosting allowances. Keep them in shared configuration and enforce server-side; verify storage-plan and bucket limits before release.

| Item | Initial limit / behaviour |
|---|---|
| Batch | Up to 10 files, with at most 2 simultaneous transfers. |
| Photo | Up to 20 MiB per file. |
| Video | Up to 200 MiB per file. Encourage short clips; no separate duration rule in this MVP. |
| Avatar | Up to 5 MiB; create a small standard image derivative. |
| Photo input | JPEG, PNG, WebP, HEIC/HEIF; generate displayable thumbnails/previews. |
| Video input | MP4, MOV and WebM; validate actual media content, not extension alone. |
| Originals | Preserve the uploaded file’s bytes for the admin download. |
| Preview | Standard image derivative; native video playback where the browser supports the actual codec. |
| Unsupported video playback | Show “Preview unavailable in this browser”; admin can still download the validated original. No universal transcoding service in this MVP. |

HEIC/HEIF support requires a deployable decoder proven with real sample files. Implement and verify that path before claiming support; do not label a broken browser image as a successful preview. If the runtime cannot provide it, record a release blocker instead of silently advertising support or adding a fake conversion.

Media containers and codecs are different. Accepting an MP4 or MOV file does not guarantee browser playback; test actual files and present the explicit fallback. [S7]

### Upload sequence

1. Client performs early size/type checks for useful feedback.
2. Server verifies an active staff account and venue, allocates an immutable asset ID and storage path, and derives owner/venue itself.
3. Upload directly to private storage with a narrowly scoped credential. Use resumable uploads for large files and unreliable connections. Supabase documents its TUS-based resumable path for these cases. [S1]
4. Validate completed content server-side, including real type, size and safe decode/probe. File extensions and client MIME values are not sufficient security checks. [S5]
5. Create required image previews without unnecessary embedded metadata, then mark the asset ready. Only validated ready assets are downloadable from the marketing library.
6. Refresh the staff gallery; admin’s next foreground refresh includes the same asset.

Show independent progress and errors for each file. One failed video must not invalidate successful photos. Retry the same asset ID safely so network retries do not create duplicate gallery records. Disable object overwrites; never use filenames as unique IDs.

The storage transfer finishing is not the same as server validation finishing. Show “Processing” until the record is ready, and display a real error when processing fails. Failed/unvalidated originals are not available to admin for marketing downloads.

No promise of upload continuation after the browser closes. Warn before navigating away from active uploads where possible. Reopening the app must accurately distinguish completed, incomplete and failed uploads.

Cancel, cleanup and validation must be idempotent. An authenticated cleanup job may remove abandoned uploads after a configured 24-hour window. Protect currently active transfers from cleanup and document the actual scheduling mechanism; do not claim a job exists unless it is deployed.

## 6. Minimal data model

Reuse compatible existing tables when verified. For a new isolated application, propose three domain tables plus the authentication provider’s user records. Names below are proposed, not existing database facts.

### `venues`

`id`, `name`, `slug`, `active`, `created_at`.

Use unique IDs/slugs, keep confirmed names in a seed/configuration file, and avoid a separate venue-management interface. An inactive venue cannot receive new staff assignments or uploads. Retained media remains attributed to it.

### `profiles`

`id` (auth user ID), `display_name`, `avatar_path` (nullable), `job_title` (nullable), `role` (`staff | admin`), `venue_id` (required for staff), `active`, `created_at`, `updated_at`.

Treat authentication email as owned by the auth system unless the existing project has a verified synchronised email pattern. Roles, activation and venue assignment are server-controlled; do not authorise from client-editable user metadata. Do not expose an admin’s private account details to staff.

### `media_assets`

`id`, `uploader_id`, `venue_id`, `original_path`, `preview_path` (nullable), `thumbnail_path` (nullable), `original_filename`, `media_type` (`image | video`), `validated_mime_type`, `size_bytes`, `width`/`height` (nullable), `duration_seconds` (nullable), `upload_state`, `created_at`, `updated_at`, `deleted_at` (nullable).

Recommended technical states: `uploading`, `processing`, `ready`, `failed`. A deletion marker immediately excludes a record from normal reads. Owner, venue and storage keys become immutable once the upload is reserved.

Derive object paths from server-generated IDs, for example `media/{uploader_id}/{asset_id}/original.ext`. Never trust a requested owner ID, venue ID or storage path from the browser.

Index the actual gallery access patterns: uploader + creation time + ID, venue + creation time + ID, and creation time + ID for the central feed. Use ready/non-deleted predicates where appropriate. Use stable cursor pagination, initially 24 assets per page. Add indexes based on actual queries, not speculative future analytics.

Store object keys, not long-lived public/signed URLs. One original plus lightweight derivatives is sufficient; the portfolio and library reference the same record.

## 7. Permission and storage rules

| Operation | Staff | Admin |
|---|---|---|
| Read profile | Own | All staff profiles |
| Update display name/avatar | Own | Any staff profile |
| Change venue/job title/activation | No | Yes |
| Promote application roles | No | Controlled bootstrap procedure only in this MVP |
| Upload | Own account, assigned active venue | Not required for this MVP |
| Read media | Own validated assets | All validated assets |
| Remove media | Own | Any |
| Issue invitation | No | Staff invitations only |

Use private buckets, including avatars and derivatives. Supabase private-bucket reads are subject to access control and can use authenticated downloads or time-limited signed URLs. Public buckets are unsuitable for this private portfolio model. [S2]

Enforce permissions at each server action/API and in database/storage policies. Hiding an admin button is not authorisation. Next.js recommends checking access close to data and inside mutations; Supabase provides database row-level security. [S3, S8]

- Staff cannot change their own role, activation, venue, asset owner, stored path or validation state through direct API/database requests.
- An inactive account is denied new data reads, uploads, downloads and mutations even if it still has an old session token.
- Admin access is also checked from trusted, current role/activation data.
- Keep privileged keys server-only. When a privileged client bypasses RLS, explicitly re-check the caller and requested resource before acting.
- Restrict profile updates by allowed columns; a row-owner policy alone must not allow privilege escalation.
- Unvalidated or removed objects are not generally readable. Only the restricted processing path may inspect them.
- Do not share private responses through public caches or image-optimisation routes that bypass access control.

For signed reads, choose a short expiry, initially 60 seconds for newly issued links, and refresh authorised previews as needed. Existing bearer links may remain usable until expiry; an already downloaded copy cannot be revoked. Do not claim instant recall of all bytes when an account is disabled or an asset is deleted.

### Removal and account lifecycle

Deletion confirmation: “Remove this file from your portfolio and the admin library? Previously downloaded copies cannot be recalled.”

Hide the media immediately, refuse new access grants, then remove originals and derivatives through a retryable server operation. A technical tombstone may support retries; there is no trash/recovery interface. Do not claim complete physical erasure while storage deletion is still failing. Ensure the database and object-storage lifecycle agree.

Deactivation stops the staff member’s access; it does not silently delete their portfolio. Admin can retain access subject to the organisation’s retention policy. Account retention, backup expiry and public-use permissions remain operational policies, not new workflow screens.

## 8. Stack and implementation boundaries

The preferred Naba-aligned baseline is **Next.js + TypeScript, Tailwind + shadcn/ui, Supabase Auth/Postgres/Storage**, reusing existing email delivery such as Resend where configured. This is a starting direction, not a claim about the target repo’s current versions or infrastructure.

Before modifying code, inspect the repository, lockfile, app structure, authentication, environment conventions, shared components, schema/migrations, tests and deployment configuration. Reuse verified patterns. Do not replace existing authentication, upgrade unrelated frameworks or invent a shared Naba SSO system.

For a fresh Supabase login flow, explicitly disable automatic user creation; Supabase documents that passwordless sign-in otherwise creates users by default. Enforce the invitation/profile requirement in the backend as well. [S6]

Use one application and one database. Add only the small validation/image-processing execution path needed for media; do not introduce generic microservices, a second backend or a paid media provider without a concrete requirement and explicit setup evidence. Verify runtime CPU/memory/timeout limits for actual decoding work.

Host separately or within the established monorepo boundary without altering NabaPerks or NabaPresence behaviour. Reuse existing CI/security conventions. Keep credentials and real staff/customer media out of source control and test fixtures.

## 9. Ordered execution backlog

| ID | Work | Depends on | Completion evidence |
|---|---|---|---|
| M0 | Inspect repo and deployment constraints; map proposed names to real paths; list existing versus missing. | — | Repository evidence, exact discovered commands, concise plan and documented assumptions. |
| M1 | Add data/migrations, private storage policies, secure admin bootstrap, invitation-only sign-in and role routing. | M0 | Two users cannot cross-read; staff cannot grant themselves admin; invite flow works with real configured email. |
| M2 | Build staff profile and one-photo upload end to end. | M1 | Real photo persists, appears in own portfolio, and is inaccessible to another staff member. |
| M3 | Build admin content gallery, filters, portfolio view and original download. | M2 | Admin finds the same real asset and downloads an identical-byte original. No approval step. |
| M4 | Add batch/video upload, resumable transfer, image format handling, preview fallback and failure recovery. | M2, M3 | Physical-phone tests, interrupted transfer, partial batch failure and retry without duplicates. |
| M5 | Complete staff invitations/edits/deactivation, own/admin deletion, responsive states and automated regression tests. | M1–M4 | Lifecycle and negative-access tests pass; interface has no out-of-scope features. |
| M6 | Configure confirmed venues and deployment, run staging smoke tests, then pilot and release. | M5 | Environment/migration/storage checks, real-phone evidence, owner-confirmed venue data and documented remaining limitations. |

**First milestone worth demonstrating:** One staff member uploads a real dish photo; it appears in their portfolio; a different admin sees it centrally and downloads it. Build that vertical slice before polishing all screens.

Complete each stage against its exit criteria before proceeding to release.

## 10. Acceptance tests

| Test | Required result |
|---|---|
| Invite and login | Invited staff signs in and lands on own portfolio; uninvited login does not create access. |
| Account setup | Missing/inactive profile or missing staff venue blocks uploads and protected data as appropriate. |
| Own profile | Permitted profile edits save; role, venue and activation tampering fails server-side. |
| Image upload | Valid image persists after reload with correct contributor, venue and date. |
| Admin availability | Ready asset appears without approval and within the foreground refresh interval. |
| Staff isolation | Staff A cannot list, view, sign a URL for, download or delete Staff B’s media, even at the same venue. |
| Cross-role access | Staff cannot access admin data/actions through altered URLs, direct HTTP, database calls or storage calls. |
| Original download | Admin download matches the uploaded source bytes; image preview is not substituted. |
| Attribution | Moving staff from Venue A to Venue B leaves older assets labelled A; later uploads use B. |
| Filters | Venue, contributor and media-type filters combine; changing pages preserves filter correctness. |
| Partial batch | A failed file does not lose successful uploads; retry creates no duplicate record. |
| Interrupted upload | A supported resumable transfer recovers; unrecoverable cases explain the required action. |
| Content validation | Oversized, disguised, corrupt and unsupported files do not become ready marketing assets. |
| Real phone media | Actual iPhone/Android images, including HEIC/HEIF, and video files follow the advertised support policy. |
| Video preview | Supported codecs play; unsupported codecs show the explicit fallback and valid original download. |
| Deactivation | Existing sessions fail new authorised operations; retained assets remain available to authorised admins. |
| Deletion | Both gallery views lose the same asset; no new access grants; storage cleanup is verified/retried. |
| Signed-link expiry | Expired links recover only after fresh authorisation; do not claim earlier links are instantly recalled. |
| Empty and failure states | New accounts, empty filters, offline errors, invalid links and failed downloads have usable UI. |
| Responsive/accessibility | Main actions work at target widths, with keyboard and labelled controls, without overflow. |

Automate unit/integration tests for validation, attribution, idempotency and authorisation; use end-to-end tests for the core staff/admin journey. Test RLS/storage with separate identities, not only a service-role client.

Browser emulation does not prove physical camera selection, HEIC decoding or mobile background behaviour. Report those as untested until physical-device evidence exists. Never invent a passing test run.

## 11. Release checklist

Configure real auth redirect URLs, email delivery, private buckets, limits, migrations, server secrets and confirmed venue data. Verify storage and database backup arrangements separately. Confirm the processing/cleanup path actually runs in the deployed environment.

Use owner-authorised bootstrap credentials for the first admin, not a hard-coded default password or first-user promotion. Keep demo users/venues clearly separate from production.

Pilot with two confirmed venues and both BOH/FOH contributors before inviting all 10 venues. The pilot’s success condition is the complete upload–portfolio–admin-download journey on real devices, not upload quotas or a new reporting dashboard.

Provide a brief operational guideline outside the application: capture safely, do not interrupt service, avoid exposing private information, and follow the organisation’s permission process before capturing or publishing identifiable people. Appearing in the admin library is not a declaration of legal clearance to publish. No consent/approval product workflow is added by this brief.

Document storage usage/error checks as operational maintenance, not another user-facing dashboard. Define retention and cleanup configuration before launch; do not claim indefinite storage or cost-free usage.

## 12. Required implementation handoff

The coding agent/developer must deliver working source changes, migrations/storage rules, automated tests, environment/setup documentation and a minimal staff/admin usage guide. Its final report must show:

- Actual changed paths and why they changed.
- Commands run and their real results, separating passed, failed and not-run checks.
- Screens/browser/device paths verified and limitations still present.
- Auth, database, storage, email and deployment configuration still required.
- Explicit exclusions preserved and any release-blocking issue.

Do not stop at a static dashboard, localStorage demo, fake upload timer or mock-only gallery. When credentials or deployment access are absent, complete testable repository work and report the exact blocked integration without claiming a production launch.

## Technical references

Product decisions and thresholds above are project choices. The following primary documentation supports the implementation constraints; it is not evidence that the app has been built.

- **[S1]** Supabase, Resumable Uploads: `https://supabase.com/docs/guides/storage/uploads/resumable-uploads`
- **[S2]** Supabase, Storage Buckets: `https://supabase.com/docs/guides/storage/buckets/fundamentals`
- **[S3]** Next.js, Authentication and Authorisation: `https://nextjs.org/docs/app/guides/authentication`
- **[S4]** MDN, HTML capture attribute: `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture`
- **[S5]** OWASP, File Upload Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html`
- **[S6]** Supabase, Passwordless email sign-in: `https://supabase.com/docs/guides/auth/auth-email-passwordless`
- **[S7]** MDN, Media types and formats: `https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats`
- **[S8]** Supabase, Row Level Security: `https://supabase.com/docs/guides/database/postgres/row-level-security`

References checked on 29 October 2026. Verify actual installed package versions and runtime behaviour during implementation.
