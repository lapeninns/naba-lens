# NabaLens — coding-agent execution prompt

Read the accompanying `NabaLens-MVP-Execution-v0.2.md` and implement that specification end to end in the target repository. This prompt and v0.2 supersede the earlier expanded NabaLens plan.

## Your assignment

Act as the lead full-stack engineer and product designer. Build NabaLens, a private staff portfolio and admin marketing media library for one organisation operating 10 pubs/restaurants.

There are exactly TWO application roles and interfaces:

**Staff:** Individual profile with name, photo, job title and assigned venue. Upload photos/videos, see only their own portfolio, edit their own name/photo, and remove their own uploads.

**Admin:** See all ready uploaded assets centrally, filter by venue/staff/media type, preview and download individual originals, view individual staff portfolios, invite/manage/deactivate staff, and remove media.

A staff upload automatically becomes available centrally after technical validation. There is NO editorial approval, separate submission workflow or manual synchronisation. Portfolio and library reference the same asset.

Do not add tasks, review statuses, manager roles, public profiles, social features, AI, editing, publishing, analytics, notifications beyond login/invitation emails, campaigns, usage tracking, payments, bulk ZIP export or multi-organisation architecture.

## 1. Inspect before implementation

Read the actual repo, project instructions, package/lock files, framework versions, authentication, shared components/styles, migrations, storage setup, environment conventions, tests and deployment configuration. Identify existing versus missing functionality using real paths. Do not invent repository findings.

Reuse the verified Naba stack and security boundaries. The preferred greenfield baseline is Next.js + TypeScript, Tailwind + shadcn/ui and Supabase Auth/Postgres/Storage, with existing configured email delivery. Do not replace existing auth or upgrade unrelated dependencies. Do not alter NabaPerks/NabaPresence core behaviour or assume shared SSO exists.

When a non-blocking detail is missing, make the smallest documented decision consistent with v0.2 and proceed. Never invent venue names, staff records, credentials or provider access. Use clearly labelled development fixtures only outside production.

## 2. Build the vertical slice first

Implement authentication, trusted staff/admin permissions, private storage and the minimum data model. Then complete this real journey before expanding:

1. Admin invites staff and assigns a venue.
2. Staff signs in and uploads one real photo.
3. The photo persists in their portfolio.
4. A different admin sees the same ready asset in the shared library.
5. Admin downloads the unchanged uploaded original.
6. Another staff member cannot access that asset through any UI, API or storage path.

Do not deliver a static mock, localStorage-only application, placeholder upload success or fake progress.

## 3. Complete the small product surface

Proposed routes are `/login`, `/staff`, `/admin`, `/admin/staff`, and `/admin/staff/[id]`; adapt them to repository conventions. Use dialogs for upload, profile edits, invitations and preview where appropriate.

Staff’s primary screen is their profile/gallery with one prominent Upload action. Admin navigation is Content and Staff. Reuse gallery, portfolio and media-viewer components with permission-aware actions. Make the interface responsive, accessible and consistent with verified Naba branding. Do not add decorative dashboards or fake statistics.

Use server-side pagination and filtering. Refresh staff after upload and admin’s foreground library approximately every 15 seconds and on focus. No realtime service is required.

## 4. Enforce media and security behaviour

Follow v0.2’s configurable limits: 10 files per batch, two parallel transfers, 20 MiB photos, 200 MiB videos and 5 MiB avatars. Verify provider/bucket limits; these are product defaults, not assumptions about a purchased plan.

Support the specified real phone formats, including HEIC/HEIF photo conversion through a verified deployable decoder. Preserve originals and create lightweight previews. Validate content server-side, not just extensions. Accept validated MP4/MOV/WebM video originals; use native preview where supported and an explicit unsupported-preview fallback. Universal video transcoding is out of scope.

Use private storage and resumable transfers where appropriate. Reserve server-generated asset IDs and paths, derive owner/venue from trusted account data, and finalise idempotently. Retry a failed file without duplicating successful assets. Show actual uploading/processing/ready/failure states; these are technical, not approval states.

Enforce staff/admin checks in every server action/API and in database/storage policies. Privileged credentials stay server-only. Staff cannot modify role, venue, activation, asset ownership, object keys or validation state. Avoid leaking private media through caches or public image routes.

Snapshot venue at upload so staff transfers never relabel historical content. Account deactivation blocks new protected operations even from existing sessions. Staff can remove only their own media; admin can remove any. Hide deleted media in both views, deny new access grants, and retry physical cleanup. Clearly acknowledge that existing short-lived signed links and already downloaded copies are not instantly recalled.

## 5. Test and release honestly

Follow the ordered backlog and acceptance matrix in v0.2. Test separate staff identities, an admin, direct API/storage access, privilege escalation, venue transfers, duplicate retries, partial failures, deletion, deactivation, original-byte downloads and combined filters.

Run the actual repo’s lint, type, unit/integration, build and end-to-end checks. Verify the visible staff/admin journey at mobile and desktop widths. Record actual physical-phone checks separately from browser emulation. Do not claim HEIC/camera/device support based on desktop tests alone.

Bootstrap the first admin securely, disable public account creation, use confirmed venue data and document exact auth/email/storage/processing/deployment setup. Do not push production changes or run destructive migrations without the environment’s required authorisation.

If external credentials or deployment access are missing, finish all safely testable implementation work, clearly report the blocked integration, and do not claim it is live. Do not stop merely to ask about non-blocking design details.

## Deliverables

Working source, database migrations and storage policies, automated tests, safe environment/setup documentation, and a short staff/admin usage guide. Finish with actual changed paths, commands and real outcomes, verified workflows, remaining limitations/setup, and confirmation that the two-interface scope was preserved.

Start with repository discovery, then implement. Do not stop after generating another plan.
