# Shared amenity catalogue and evidence workflow

Status: approved plan, in build. Contract: `lib/amenities/contract.ts` (the
version there wins; changes go through the integration owner).

## Outcome

One shared, versioned catalogue of 39 amenity questions
(`supabase/seed/amenity_catalogue.csv`). Each venue has its own checks,
answers, assignees, evidence and history. Enabling Amenities for a venue (admin
only) creates four core checks: `step_free_entrance`, `onsite_parking`,
`guest_toilets`, `guest_wifi`. Managers add or archive any other entry.

There is **no review step**. A submission that meets the evidence rule
immediately becomes the venue's current answer (progress `complete`). Managers
can look at evidence later; if something is wrong or conditions change they
**reopen** the check with a reason (progress `needs_recheck`) and staff
recapture it. The finished label is "Complete", never "Verified".

Amenities stay separate from monthly Coverage targets and drink-photo counting:
no writes to `coverage_*` tables, `venue_amenity_facts` or monthly preparation.
Google handoff stays manual in NabaPresence.

## Repository facts (confirmed in step 0)

| Plan said                     | Actual                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/manager`                    | Manager tools are `/staff/manage/**`; the admin mirror is `/admin/coverage/[venueId]/**`, both built from `app/staff/manage/_shared/**` with a `ManageContext` (`basePath`). Tabs: `components/nabalens/coverage/manage-nav.tsx`. |
| `lib/amenities/*` server code | Services in `lib/server/amenities/` (pattern: `lib/server/coverage/`). Server actions in `app/_amenities/actions.ts` (pattern: `app/_coverage/actions.ts`). Contract in `lib/amenities/contract.ts` (client-safe).                |
| `amenity_templates`           | `public.amenity_catalogue` (the existing `coverage_amenity_templates` belongs to Coverage and is untouched).                                                                                                                      |
| asset tables                  | `public.media_assets` (`media_type` enum `image`/`video`, `upload_state` = `ready`, tombstone `deleted_at`, `venue_id` snapshot, `uploader_id`).                                                                                  |
| role checks                   | `private.can_manage_venue(venue)`, `private.assert_can_manage_venue(venue)`, `private.active_staff_venue_id()`, `public.coverage_access_scope()`; server side `lib/server/coverage/context.ts` (`readAccess`, `resolveVenue`).    |
| membership change hook        | Trigger pattern `private.profiles_revoke_manager_grants()` in `supabase/migrations/20261102130000_venue_manager_grants.sql`.                                                                                                      |
| preview / playback            | Photo derivatives: `signEvidence` in `lib/server/coverage/evidence.ts` + `app/api/coverage/evidence/[assetId]/{thumb,preview}`. Video: `streamOriginal` in `lib/server/media/access.ts` (used by `app/api/media/[id]/stream`).    |

## Data model (migration `supabase/migrations/20261107120000_amenity_catalogue.sql`)

- `amenity_catalogue` (key pk, category, question, capture_brief,
  evidence_rule `photo|video|either|both`, is_core, position,
  catalogue_version). Seeded from the CSV by a generator; changes only via a
  new migration.
- `venue_amenity_settings` (venue_id pk, enabled_at, enabled_by).
- `venue_amenity_checks`: unique `(venue_id, template_key)`; status
  `active|archived`; progress `needs_capture|complete|needs_recheck`; answer
  `to_check|yes|no|not_applicable`; current_submission_id, answered_by,
  answered_at, assignee_user_id, notes, recheck_reason, revision.
- `amenity_submissions`: append-only; check_id, venue_id, submitted_by,
  answer, finding, limitations, reason, template_version and evidence_rule
  snapshots, internal_metadata jsonb (Wi-Fi test spot/date/Mbps), unique
  idempotency_key.
- `amenity_submission_assets`: submission -> media_assets, evidence_kind
  `photo|video`.
- `amenity_check_events`: append-only history (see `CHECK_EVENT_KINDS`).

States: enable/add -> `needs_capture`; valid submit -> `complete`; reopen or
evidence lost -> `needs_recheck`; valid submit -> `complete`. `archived` is a
separate status: it hides the check and keeps history; re-adding the key
restores the same row.

## Rules

- Enable (admin): creates missing core checks only, unassigned. Idempotent.
- Add / archive / restore: venue's effective manager or admin; venue must be
  enabled. Adding an existing active key returns it; an archived key is
  restored.
- Assign: manager/admin; assignee must be active staff whose current venue is
  the check's venue; `null` unassigns. Stale revision rejected.
- Submit: the assignee, the venue's manager, or an admin; check active.
  Assets: same venue, ready, not deleted, and either the submitter's own upload
  or (manager/admin only) legacy Coverage media per `LEGACY_COVERAGE_MATCHES`.
  Yes must satisfy the evidence rule (`both` needs a photo and a video). No /
  Not applicable need a reason; evidence optional. `guest_wifi` + Yes needs
  Wi-Fi metadata and `redactionConfirmed = true`. Valid submit sets answer,
  `complete`, answered_by/at, clears recheck_reason. Same idempotency key
  returns the first result (`replayed`).
- Reopen: manager/admin; preset reason (free text required for "other");
  `needs_recheck`; answer stays visible.
- Evidence access (thumb/preview/stream): the submitter, the venue's effective
  manager, admins; plus a caller's own submittable assets. No original
  downloads. Unknown and forbidden are the same 404. Amenity uploads
  (`purpose = 'amenity'`) and non-Coverage assets attached to submissions are
  excluded from the community feed.
- Writes at a deactivated venue raise `venue_inactive`; reads still work.
- Every read, write and media request re-checks the current role in the
  database: a revoked manager loses access at once.
- Asset deleted: if the current Yes no longer meets its rule -> `needs_recheck`
  - `evidence_lost` event; the submission is kept.
- Assignee leaves the venue, is deactivated or changes role: assignee cleared,
  `unassigned` event (`cause: assignee_left`), submissions kept.

## Ownership (parallel build)

| Worker              | Owns                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 DB               | `supabase/migrations/20261107120000_amenity_catalogue.sql`, `scripts/db/amenity-catalogue-sql.ts`, `lib/db/types.ts` (regenerated), `tests/security/amenities*.test.ts`, `tests/unit/amenity-catalogue-seed.test.ts`                                                                                                                                                                                |
| W2 Server           | `lib/server/amenities/**`, `app/_amenities/actions.ts`, `app/api/amenities/**`, the `EvidenceCheck` union in `lib/server/coverage/evidence.ts`, `tests/unit/amenities-*.test.ts`, `tests/integration/amenities*.test.ts`, `docs/amenities.md`                                                                                                                                                       |
| W3 Manager/admin UI | `app/staff/manage/amenities/**` (except `capture`), `app/admin/coverage/[venueId]/amenities/**` (except `capture`), `app/staff/manage/_shared/screens/amenities*.tsx`, `components/nabalens/amenities/manage/**`, `components/nabalens/amenities/evidence-tile.tsx`, `components/nabalens/coverage/manage-nav.tsx`, `tests/ui/amenities-manage*.test.tsx`, amenity section of `docs/usage-admin.md` |
| W4 Staff UI         | `app/staff/tasks/amenities/**`, `app/staff/manage/amenities/[checkId]/capture/**`, `app/admin/coverage/[venueId]/amenities/[checkId]/capture/**`, `components/nabalens/amenities/capture/**`, amenity entry on staff Home (`app/staff/tasks/page.tsx`, `components/nabalens/tasks/**` minimal edits), `tests/ui/amenities-capture*.test.tsx`, amenity section of `docs/usage-staff.md`              |
| W5 E2E              | `tests/e2e/amenities*.spec.ts`, `tests/e2e/helpers/amenities-world.ts`, mobile project list in `playwright.config.ts`                                                                                                                                                                                                                                                                               |

`lib/amenities/contract.ts`, `supabase/seed/amenity_catalogue.csv` and
anything else shared: integration owner only.

## Release criteria

1. Migration applies cleanly to an isolated local stack; types regenerated.
2. DB/security/integration tests pass, plus lint, typecheck, unit.
3. E2E: admin enables a venue; darts (photo) add/assign/capture/complete;
   step-free entrance (video) rejects photo-only then completes with video;
   Wi-Fi needs photo + video + redaction tick; No with reason; manager
   captures; reopen then recapture; archive then restore; mobile viewport.
4. Coverage and drink-photo journeys unchanged; amenity checks absent from
   monthly targets.
5. Two-venue isolation: same key, different answers; no cross-venue reads of
   submissions or media.
6. `lci` once on the rebased final head. Merge and deploy need separate
   approval.

## Pilot and rollout

Pilot at The Old Crown after deploy approval: enable, check the roster (no
active front-of-house account at the last audit; name a floor lead and bar
lead or use Capture myself), add manager-chosen extras, one capture round
including a No/Not applicable and one reopen, then device checks on iPhone
Safari and Android Chrome. Roll out in batches with per-venue counts of needs
capture / complete / needs recheck.
