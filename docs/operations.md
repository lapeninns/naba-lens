# Operations

Use this with [setup](setup.md) and the [release checklist](release-checklist.md).
There is no operations dashboard or deployed scheduler implied by this guide.

## Capture safely; publishing is a separate decision

- Capture only when safe. Do not interrupt service, distract colleagues, block
  routes or use a phone while handling hot food, knives or equipment.
- Keep payment details, customer bookings, paperwork, screens and other private
  information out of frame. Check reflections and backgrounds too.
- Get permission **before capturing identifiable people**, including customers
  and colleagues. Follow the organisation's safeguarding and permission rules.
- **Presence in the admin library is not publishing clearance.** Technical
  validation checks a file, not legal rights, consent or suitability for a
  particular campaign. The person publishing must check the intended use and
  permission separately. Naba-Lens has no editorial approval or publishing tool.
  Accepting a photo for a monthly target or venue coverage task records task
  completion only; it is not publishing clearance either.

## Routine checks

At each operating day, and after a deploy or reported failure:

| Check | Action |
| --- | --- |
| Failed/incomplete uploads | Ask for the affected filename, time and visible error, not private media or login links in a ticket. Check the per-file status and private server logs. Successful files must not be re-uploaded to fix one failure. Retry the affected file; investigate repeated `decoder_busy`, timeout, corrupt-content or Storage failures rather than weakening validation. |
| Stuck processing | Check `media_assets.upload_state` and `updated_at` in authorised operator tools. `processing` is not abandonment-cleaned; retry finalisation through the upload UI where available, or escalate to the maintainer. There is no background processing-repair scheduler promised here. Never manually mark an unvalidated asset ready. |
| Pending deletions | Inspect cleanup reports and tombstoned assets that still have Storage objects. Hidden does not mean physically erased. Retry cleanup and track unresolved failures. |
| Storage/egress | Check Supabase project's usage/quota/billing, global and bucket upload caps, and growth of originals/derivatives/avatars. Include backup/export costs. No automatic storage budget or ready-media expiry is implemented. |
| Auth/email | Verify an authorised invitation and sign-in path after configuration changes; inspect Auth/SMTP error codes, sender health and limits. A neutral “Check your email” screen is deliberately not proof of delivery. |
| Coverage preparation | Early each month and after a deploy, confirm a successful run for the current month and no venue missing targets; see [monthly coverage preparation](#monthly-coverage-preparation). |
| Privacy/access | Confirm buckets stay private, RLS remains enabled, private responses are not CDN-cached, and a second staff identity cannot access the first's media. Do not publish signed URLs in logs or tickets. |

Useful **read-only** SQL for an authorised operator in the intended environment
(source: `media_assets`, Storage policies and cleanup migration):

```sql
-- Technical states, excluding removed assets. Counts are not a new app dashboard.
select upload_state, count(*)
from public.media_assets
where deleted_at is null
group by upload_state;

-- Tombstones that still have bytes, including possible leftover derivatives.
select count(*) as assets_with_pending_objects
from public.media_assets a
where a.deleted_at is not null
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'media'
      and o.name like a.uploader_id::text || '/' || a.id::text || '/%'
  );
```

These counts alone do not identify root cause or prove data loss. Check the time,
target environment and affected operation before changing anything. Avoid logging
PII, service keys, auth tokens, signed links or media contents.

## Cleanup: run, inspect, retry

No job is scheduled by this repository. Configure one with owner authorisation as
described in [setup §6](setup.md#6-hosted-staging-and-production-owner-authorisation-checklist).
For one pass in a trusted shell with the intended URL and service role exported:

```sh
pnpm cleanup
# If you deliberately use your own local env file instead:
pnpm exec tsx --env-file=.env.local scripts/cleanup.ts
```

The HTTP alternative is **POST `/api/internal/cleanup`** with
`Authorization: Bearer <CLEANUP_SECRET>` (at least 32 characters). No session
cookie is needed. GET returns 405; missing/short server configuration returns
503, wrong/missing bearer returns 401, runner errors return 500.

Inspect the report, including when HTTP status is 200:

- `status: "completed"` includes `removed.assets`, `removed.objects`,
  `removed.byState`, `failed` and `more`. A nonempty `failed` needs attention;
  the asset stays hidden and a later run retries its remaining objects.
- `more: true` means a later pass may have work left. Default budget is ten
  batches of 100 assets.
- `status: "skipped", reason: "locked"` means another run holds the lease
  (default ten-minute expiry). Repeated skips or growing backlog need investigation,
  not deletion of another run's lock.
- Script exits **0** for a completed pass without failures or a lease skip,
  **1** for reported removal failures, **2** for an error. A zero alone does not
  prove there was no remaining work.

The 24-hour abandoned-upload window comes from
`MEDIA_LIMITS.abandonedUploadWindowHours` in `lib/config/media.ts`.
Cleanup tombstones untouched `uploading`/`failed` reservations only when their
row **and every stored object under the prefix** are older than the window.
It excludes `processing` and `ready` assets from abandonment cleanup. User-removed
assets in any state can have their objects removed.

Reserve/retry/finalise record upload activity. Partial TUS bytes are invisible
to the DB and are expired by the Storage backend, not this cleanup script.
Confirm target TUS expiry is at most 24 hours before enabling scheduled cleanup.
See [cleanup internals](cleanup.md) for leases, activity protection and scheduler
options. Do not invent an env var to change these code/provider settings.

## Monthly coverage preparation

[v0.4](spec/NabaLens-Staff-Coverage-v0.4.md) monthly targets need one
preparation per Europe/London month. `vercel.json` calls **GET
`/api/internal/coverage/monthly-preparation`** hourly at minute 7
(`7 * * * *`); POST runs the same preparation for another scheduler or an
operator. Both need `Authorization: Bearer <CLEANUP_SECRET>` (at least 32
characters, equal to Vercel's `CRON_SECRET`, as for cleanup). No session cookie
is needed. Missing/short server configuration returns 503, a wrong/missing
bearer returns 401.

Each run computes the current London month from the database clock. For each
active staff member at an active venue it copies their latest target **at the
same venue**, or marks them **Needs setup**; a target never follows a transfer.
It also makes sure each active venue has its coverage checklist candidates.
Repeated, missed or concurrent runs do not duplicate targets, so a re-run is
safe. Managers and admins can run the same preparation from the coverage tools.
It sends nothing to staff.

Responses are `private, no-store` and hold counts and Postgres error codes
only; logs likewise name no people, ids or database text. HTTP 200 reports
`status: "succeeded"` with one entry per run. HTTP 500 means at least one venue
failed or the call errored; the next hourly run retries it. The handler may run
for up to 60 seconds. Apply the v0.4 migrations to the target before deploying
this schedule, otherwise every hourly run fails.

After the first of each month, check **Monthly preparation** in admin coverage
oversight (`/admin/coverage`). It shows the last successful run, recent
failures with their error code, and venues where active staff still have no
target row. To re-run, use **Prepare this month for all venues** there (a
manager's **Prepare this month** covers their own venue) or POST to the
handler. Do not insert or edit targets in SQL. A failure that repeats with the
same code needs the maintainer.

## Withdrawing coverage access (rollback)

Reverting the app code alone leaves the coverage database functions callable
by signed-in users. With owner authorisation, withdraw coverage like this:

1. Remove the monthly-preparation cron entry from `vercel.json`, or disable the
   scheduler, so hourly runs stop.
2. Rehearse first: `node tests/migrations/run.mjs "$W" withdraw` proves on an
   isolated stack that the script covers every coverage function and table and
   changes nothing else.
3. An authorised operator runs `tests/migrations/coverage-withdraw-access.sql`
   in one transaction against the confirmed target database. It revokes
   signed-in users' access to every coverage function and table, and the
   scheduled preparation from the service role. Targets, photos sent,
   decisions, audit events, media, archive and monitoring are kept.
4. Deploy code without the coverage screens. If access must end first, run the
   script before the deploy: portfolio, Explore and People keep working and the
   **Manage** link disappears, but **My tasks** and the coverage screens show
   an error until the deploy.

Restoring access later means re-running the grant statements of migrations
`20261102130000` to `20261102150000` as a reviewed change.

The withdrawal covers coverage only. Colleague media access (Explore, People
and colleague portfolios, including `20261102160000_community_asset_access`)
has its own rollback; see [community deployment](community.md#deployment-requirements).

## Retention, deletion and copies

The owner must approve retention periods before launch. There is **no automatic
age-based deletion of ready media** and no trash/recovery interface. Deactivation
does not delete a contributor's portfolio: admins retain authorised access.
Apply approved removals individually, not by bypassing Storage policies or
deleting DB rows without the matching object lifecycle.

Removal immediately hides the asset in both views and blocks new access grants;
physical deletion can still be pending. It also reopens any coverage task the
photo completed; past months keep its accepted count, marked as removed. Tombstones remain for idempotency and
cleanup. Newly issued derivative/avatar signed links last **60 seconds**;
already issued bearer links can remain usable until expiry. Already loaded
images, browser caches, screenshots and downloaded copies cannot be recalled.
Video/download routes reauthorise new requests, but cannot retrieve bytes already
delivered. Coverage evidence previews follow the same 60-second rule. They stay
available to the venue's manager and admins after a contributor leaves, while
Explore and People keep showing active staff only.

Originals remain unchanged, including any embedded source metadata. WebP
derivatives strip metadata; that does not sanitize or remove metadata from an
original exported for marketing. Keep downloads in approved restricted storage,
check metadata and publishing permission before external use, and apply the
organisation's exported-copy retention there too. Backups have separate retention;
a live deletion is not a promise of immediate backup erasure. Restoration is
**UNTESTED** until the [isolated rehearsal](setup.md#restore-rehearsal-untested)
has real evidence.

## Incident: lost or stolen phone

1. Verify the report through an approved channel and identify the individual
   account. Do not request their magic link or share their login.
2. A different active admin opens **Staff** (`/admin/staff`), locates the person
   and uses **Deactivate**, then confirms **Deactivate** in the named-person
   dialog. The staff UI
   cannot manage admin accounts; a lost admin device needs an authorised
   operator to disable the exact admin profile/Auth user through the controlled
   provider procedure, not the bootstrap script (which activates accounts).
3. Confirm the staff record is inactive. Deactivation first writes
   `profiles.active = false`, denying new protected operations even from an
   existing session, then attempts an Auth ban. If the UI warns that signing
   out other devices failed, the profile still blocks the next request:
   record/escalate the Auth failure and have an authorised maintainer retry
   the ban through approved operator tooling. Do not reactivate to “fix” that
   warning. Deactivation also ends any venue-manager grant and closes the
   person's open coverage assignments, so their venue's checklist may need
   reassigning.
4. Test refusal of new reads/uploads/downloads from the affected session where
   safe; confirm a different authorised admin still sees retained media.
   Do not delete the portfolio merely because the device was lost.
5. Explain the limits: previous signed links may survive their short expiry;
   downloaded or already displayed content cannot be recalled. Follow the
   organisation's device-lock/wipe, mailbox/session-security and privacy-incident
   process. Record times/actions without publishing private tokens or content.
6. Only after identity/device/mailbox security is restored and authorised, use
   **Reactivate**, which takes effect without a confirmation dialog. The
   **Account active** switch also changes access on **Save changes** without
   that dialog; use it deliberately. Verify new sign-in and correct venue;
   do not use a shared replacement account. Reactivation does not restore a
   manager grant; grant it again under **Coverage** → **Venue managers** if
   still appropriate.

For suspected service-key exposure or cross-account access, escalate immediately
to the owner/security contact. Restrict access under the approved incident plan,
rotate exposed credentials with authorisation and verify RLS/private Storage
before resuming. Never disable security controls to get uploads working.
