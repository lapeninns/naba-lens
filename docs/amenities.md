# Amenities

Per-venue amenity checks built on one shared, versioned catalogue. The
approved plan, ownership and release criteria are in
[plans/amenity-catalogue.md](plans/amenity-catalogue.md); the binding contract
(enums, DTOs, RPC names, error codes, UI words, routes) is
`lib/amenities/contract.ts`.

Amenities are separate from monthly Coverage: no writes to `coverage_*`
tables, `venue_amenity_facts`, monthly targets or drink-photo counts.

## Data model

Migration `supabase/migrations/20261107120000_amenity_catalogue.sql`.

| Table                       | What it holds                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amenity_catalogue`         | The 39 shared questions (key, category, question, capture brief, evidence rule, is_core, position, version). Generated from `supabase/seed/amenity_catalogue.csv`; changes only by a new migration. |
| `venue_amenity_settings`    | One row per enabled venue (`enabled_at`, `enabled_by`).                                                                                                                                             |
| `venue_amenity_checks`      | One per venue and catalogue key: status, progress, answer, current submission, assignee, notes, recheck reason, `revision`.                                                                         |
| `amenity_submissions`       | Append-only findings with the catalogue version and rule at the time, Wi-Fi `internal_metadata` and a unique idempotency key.                                                                       |
| `amenity_submission_assets` | Submission -> `media_assets`, with the evidence kind (`photo`/`video`).                                                                                                                             |
| `amenity_check_events`      | Append-only history (`CHECK_EVENT_KINDS`).                                                                                                                                                          |

Progress: enable/add -> `needs_capture`; valid submission -> `complete`; reopen
or evidence lost -> `needs_recheck`; next valid submission -> `complete`.
`archived` is a separate status: it hides the check and keeps its history.
Re-adding an archived key restores the same row.

## Rules

- **Enable** (admin only) creates the four core checks
  (`CORE_CHECK_KEYS`), unassigned. Repeating it creates nothing.
- **Add, archive, restore, assign, notes, reopen**: the venue's effective
  manager or an admin, on an enabled venue. A manager always acts on their
  managed venue (another `venueId` is `wrong_venue`); an admin names one.
- **Assign**: the assignee must be active staff whose current venue is the
  check's venue; `null` unassigns.
- **Submit**: the assignee, the venue's manager or an admin, on an active
  check. Yes must meet the evidence rule (`both` = at least one photo and one
  video). No / Not applicable need a reason (1-500 characters); evidence is
  optional. `guest_wifi` + Yes needs Wi-Fi test notes and
  `redactionConfirmed: true`. At most 10 assets: the submitter's own ready
  uploads at the venue, or (managers/admins) legacy Coverage media listed in
  `LEGACY_COVERAGE_MATCHES`. A valid submission is the current answer at once;
  there is no review step.
- **Idempotency**: the client keeps one UUID per draft and reuses it on retry.
  The same key returns the first result with `replayed: true`; reusing it for a
  different check is `state_conflict`.
- **Revisions**: every mutation sends the revision the caller saw. A stale one
  is `revision_conflict` with `currentRevision`; reload and try again.
- **Reopen**: a preset reason (`REOPEN_PRESETS`); "Other" needs free text. The
  answer stays visible while the check needs a recheck.
- **Wi-Fi notes** (test spot, London date not in the future, download and
  upload Mbps) are internal: the database returns them only to the submitter,
  the venue's manager and admins, never to guests.
- **People leaving**: an assignee who leaves the venue, is deactivated or
  changes role is unassigned (`assignee_left`); their submissions stay.
- **Evidence deleted**: if the current Yes no longer meets its rule the check
  goes to `needs_recheck` with an `evidence_lost` event.

## Server code

| Path                               | Role                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/server/amenities/index.ts`    | The `AmenityServices` functions: `(actor, untrusted input) => AmenityResult`.                                                                                                         |
| `lib/server/amenities/validate.ts` | Input checks with the contract's `LIMITS`; field errors keyed by input field (`wifi.<field>` for Wi-Fi).                                                                              |
| `lib/server/amenities/errors.ts`   | RPC error -> `AmenityFailure`, by exception message or SQLSTATE, never HTTP status. Unexpected errors are logged redacted (`[amenities] <op> failed`) and become `unavailable` (503). |
| `lib/server/amenities/views.ts`    | Rows -> DTOs: evidence links, recently completed (newest 10), counts, permission flags, Wi-Fi notes.                                                                                  |
| `lib/server/amenities/rpc.ts`      | Typed RPC call from the contract's `AmenityRpcs`, independent of the generated `lib/db/types.ts`.                                                                                     |
| `lib/server/amenities/media.ts`    | Video playback authorisation for the stream route.                                                                                                                                    |
| `app/_amenities/actions.ts`        | Server Actions: re-authorise, call the service, then revalidate `/staff` and `/admin/coverage` after writes.                                                                          |

Every service re-reads the caller's role, venue and manager grant
(`coverage_access_scope`) where it needs to pick a venue, and every RPC
re-checks them in the same transaction. A revoked manager loses access on the
next request. Permission flags in `CheckDetail.permissions` only decide which
controls the UI shows.

## Media routes

| Route                                           | Serves                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| `GET /api/amenities/evidence/[assetId]/thumb`   | 302 to a 60 s signed URL of a photo's thumbnail.       |
| `GET /api/amenities/evidence/[assetId]/preview` | 302 to a 60 s signed URL of a photo's display preview. |
| `GET /api/amenities/evidence/[assetId]/stream`  | Video playback, proxied with Range support, `inline`.  |

Each request runs the caller-scoped `amenity_evidence_asset` check first (the
submitter, the venue's manager, admins, plus the caller's own submittable
assets); only then does the service role read storage paths. Responses are
`private, no-store` with `nosniff`. There is no original download and no
filename in the stream response. Unknown and forbidden assets are the same 404.

Amenity evidence stays out of the organisation community feed. Uploads from the
capture form (its own dialog or the shared Add button) are reserved with
`media_assets.purpose = 'amenity'`, which never changes after reservation.
`community_readable_assets`, `community_media_page` and the community member
counts skip those assets, and also any asset attached to an amenity submission
unless it is Coverage media (`coverage_submission_items` or
`venue_amenity_fact_media`), so Coverage screens are unchanged. The uploader and
admins keep access (migration `20261107130000_amenity_media_purpose.sql`).

## Operations

- Enabling a venue: an admin opens Admin -> Coverage -> venue -> Amenities and
  chooses "Enable Amenities".
- Per-venue state for rollout tracking: `counts` in `getVenueAmenities`
  (needs capture / complete / needs recheck).
- Catalogue changes: edit `supabase/seed/amenity_catalogue.csv` and generate a
  new migration; never edit the table by hand. Existing submissions keep the
  catalogue version and rule they were made under.
- Errors to watch in server logs: `[amenities] <operation> failed` lines are
  unexpected database failures (expected refusals are not logged).
