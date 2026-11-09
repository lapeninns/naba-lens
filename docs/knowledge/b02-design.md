# B02 server design (WS1): reads and writes for coherent staff and manager work

Owner: WS1 (knowledge domain). Status: **draft 1, for review**. Docs only: no
B02 code or migration exists.

- **Baseline:** `codex/b01-knowledge-pilot` at `a86bdba8`.
- **Inputs:**
  - WS2's B02 UI design, revision 1 (`b02-ui-design.md`, §10 lists R1 to R8
    and W1 to W5);
  - the B02-03 account capability matrix (`b02-03-account-matrix.md`). The
    matrix is the authority for what each account kind can do **today**; this
    document cites its cells as "matrix §n".
- **Rules kept here:**
  - **No policy is decided.** Every policy point is either today's behaviour,
    with a code reference, or a numbered owner decision. Matrix questions Q1
    to Q14 and gaps OA1 to OA9 stay open (§6).
  - **Additive and reversible.** Prefer derived reads. New tables are additive.
    No existing row is rewritten. Media URLs, item links, contribution ids and
    every existing route stay as they are.
  - **The two B01 migrations are frozen** once the pilot branch is pushed.
    Every B02 change, including a change to a B01 function, is a new migration
    file with its own rollback note.
  - **Manager self-review of menu photos stays as it is today** (§5.3). Any
    change is an owner decision (matrix Q2, Q3, Q9).

Short names used below:

| Short   | Meaning                                                                                       |
| ------- | --------------------------------------------------------------------------------------------- |
| MO      | Dedicated manager account (`role='manager'` with an effective grant)                          |
| SO      | Staff account without a grant                                                                 |
| SG      | Staff account holding a legacy venue-manager grant                                            |
| AD      | Admin                                                                                         |
| One-acc | A venue whose only account is one MO (matrix §5)                                              |
| UI §n   | Section n of WS2's B02 UI design                                                              |
| D-n     | WS2's default decisions (UI §11)                                                              |
| OD-n    | Owner decisions raised in this document (§6.2); the matrix's questions are cited as Q1 to Q14 |

---

## 1. Summary

| #   | Need (UI §10)                            | Proposal                                                                                          | New database objects                                       | Blocked by an owner decision?                           |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| R1  | Labels-needed count                      | `public.my_label_work()`: two counts with Me's exact rule                                         | 1 function                                                 | No                                                      |
| R2  | Better-photo requests for the caller     | Extend the existing `listMyMenuPhotoDecisions` read; no SQL needed                                | none                                                       | OD-2 (old-menu requests), OD-3 (who asked)              |
| R3  | Manager triage counts and oldest waiting | `public.manager_triage_summary(p_venue_id)`: one row per queue, never summed                      | 1 function                                                 | No (queue visibility follows today's rules)             |
| R4  | `waitingSince` on To confirm rows        | Additive key on `knowledge_to_confirm`                                                            | `create or replace` of a B01 function in a B02 migration   | No                                                      |
| R5  | One-cursor My contributions feed         | `public.my_contributions_feed(p_cursor, p_limit)`: typed rows, `(time, key)` cursor               | 1 function, up to 1 additive index                         | OD-4 (sort by send time or by latest activity)          |
| R6  | Revision numbers the UI may show         | Task sends: replacement chain. Findings: B01 replaced-own. Menu photos: **none exists**           | none (derived in R5)                                       | OD-5 (link menu retakes)                                |
| R7  | Permitted use per photo                  | Only "menu use accepted" in B02; no grants before B05                                             | none (derived in R5)                                       | Owner to confirm (OD-6)                                 |
| R8  | Capabilities for the caller              | `public.my_venue_capabilities(p_venue_id)`, computed from the same predicates the write gates use | 1 function                                                 | No (it reports whatever the gates allow)                |
| W1  | Contribution group                       | Two additive tables and three functions; groups never widen visibility and add no credit          | 2 tables, 3 functions                                      | OD-7 (one group per asset, size), table owner to assign |
| W2  | `from` return parameter                  | Client only                                                                                       | none                                                       | No                                                      |
| W3  | Manager-account upload                   | Shape ready, **not to be built until decided**                                                    | `create or replace` of the upload gates, 1 additive column | **Q1, Q10, Q11; OD-8 (audit), OD-9 (Photos audience)**  |
| W4  | Manager-account labelling                | Shape ready, **not to be built until decided**                                                    | `create or replace` of the label gates                     | **Q4** (and Q1)                                         |
| W5  | Page `loadedAt`                          | Server render time; no database work                                                              | none                                                       | No                                                      |

---

## 2. Conventions for every B02 database change

- Functions are `security definer` with `set search_path = ''`. Each re-reads
  the caller's profile and grant on every call through the existing helpers
  (`private.is_active_user`, `private.active_staff_venue_id`,
  `private.can_manage_venue`, `private.is_active_admin`, `private.knowledge_basis`).
  JWT claims are never trusted.
- `revoke all ... from public, anon` and `grant execute ... to authenticated`.
  Private helpers are revoked from client roles.
- **Reads are one `stable` statement**, so a screen sees one snapshot (B01
  T9b). Each new read joins the T9b catalogue guard
  (`tests/security/knowledge-compat.test.ts`).
- Unknown and forbidden look the same (`not_found` or an empty result).
- New tables: RLS enabled, no policies for `authenticated`, access only
  through functions, `select` for `service_role`, append-only where they
  record history.
- Cursors are opaque `"<UTC instant>|<key>"` strings, ordered by
  `(time, key)` descending, as in B01's `knowledge_my_contributions`.
- New error codes get their own SQLSTATE in the `NL` class or reuse an
  existing message. None maps to the retryable `unavailable` (B01 §4.1 rule).
- Names avoid the scope guard's banned terms (`tests/unit/scope-guard.test.ts`).
- **Credit is untouched.** No B02 function writes `amenity_submissions`,
  `amenity_check_events`, `menu_item_photos`, `coverage_submission_items` or
  any input of `private.monthly_venue_completion_counts` or
  `private.monthly_credit_items`. The integration credit-function hash check
  and the B01 C-tests run on every B02 batch.

---

## 3. Reads

### R1. Labels-needed count

**Need.** To do item 5 (UI §3.1): a cheap count of the caller's photos that
need labels, plus label saves needing attention. Today Me computes this from
its page read; there is no count.

**Shape.** `public.my_label_work() returns table (needs_labels integer, needs_attention integer)`.

- `needs_labels`: the caller's own `media_assets` that are `ready`, not
  deleted, `purpose = 'general'` (amenity evidence is never labelled), and
  whose labels do not satisfy the rule behind `hasLabels`.
- `needs_attention`: the caller's own `media_pending_labels` rows with
  `status = 'needs_attention'` whose asset still exists.
- The predicate is written once, in a private function, so Me's list and this
  count cannot drift. If Me's rule differs from `!hasLabels` (for example a
  note or a missing-item report counting as labelled, as `discardPendingLabels`
  treats it), the count follows Me, and WS2 states which rule Me uses before
  the build.

**Authorisation.** The caller's own rows only. Labelling is staff (own) and
admin only today (matrix §4.2), so MO and AD get `0, 0`; R8 tells the UI not
to show the item. If the owner allows W4, MO is counted the same way as staff.

**Migration and rollback.** One additive function. Rollback: drop it, or
switch off `homeLayout` (D-10).

**Tests.**

- Fixtures: labelled, unlabelled, amenity-purpose, deleted, failed and
  processing assets, another person's asset, and a `needs_attention` draft.
- The count equals the length of Me's "Needs labels" list for the same fixture.
- MO and AD get zero; anonymous is refused.

**Owner decisions.** None.

### R2. Better-photo requests

**Need.** To do item 2: the caller's menu photos where a reviewer asked for a
better photo, with item, reason and time.

**Shape.** No new SQL. `listMyMenuPhotoDecisions` already reads
`menu_item_photos` where `author_id` is the caller and `state` is
`better_photo_requested`. It already returns item, variant, reason and the
`canRetake` flag (the item is on the caller's current venue's active menu).
B02 adds:

- `decidedAt` (already a column);
- a `requestsOnly` option that returns only `better_photo_requested`.

`withdrawn` and `invalidated` photos are already excluded by state.

**Authorisation.** Unchanged. RLS on `menu_item_photos` serves the author's own
rows.

**Migration and rollback.** None (TypeScript only). Rollback: the old service
signature still works.

**Tests.**

- Own requests only.
- A request on an item no longer on the menu (`canRetake: false`) follows OD-2.
- Withdrawn and invalidated rows never appear.
- After a transfer, requests from the old venue have `canRetake: false`.

**Owner decisions.**

- **OD-2:** show requests for items no longer on the menu (today's Me shows
  them), or hide them server-side.
- **OD-3:** whether the card names who asked. Today Me shows the reason, not
  the reviewer. Showing the reviewer's first name would be a new disclosure to
  staff.

### R3. Manager triage summary

**Need.** UI §6.2: one row per queue (menu photos to review, findings to
confirm, checklist photos to review), each with its own count and oldest
waiting time, never summed (D-6).

**Shape.**
`public.manager_triage_summary(p_venue_id uuid default null) returns table (queue text, available boolean, waiting integer, oldest_waiting_at timestamptz, own_waiting integer)`.

| `queue`       | `available` when                                                                | `waiting` and `oldest_waiting_at` equal                                                                                      |
| ------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `menu_photos` | the caller may decide menu photos at the venue (MO, SG for labelled photos, AD) | the rows `manager_menu_photo_queue` returns to this caller, and the oldest of them; `own_waiting` as the overview reports it |
| `findings`    | `knowledge_basis` is `venue_manager` or `admin`                                 | `knowledge_to_confirm` count, oldest `waitingSince` (R4)                                                                     |
| `checklist`   | SG or AD (MO is refused today, matrix §4.3 and OA4)                             | the venue's pending coverage items, as `venue_coverage_summary.pending_review_count`                                         |

- **Venue:** MO and SG use their grant venue (another `p_venue_id` is
  `wrong_venue`); AD must name one. SO is refused (`not_venue_manager`).
- A queue the caller can't act on comes back with `available = false` and no
  numbers, never an error, so one read serves every shell.
- It is one `stable` statement. It reuses the same private predicates as the
  three existing reads and does not reimplement their filters. Where a filter
  lives only inside a public function, the build moves it into a shared
  private helper, which that function then calls, with no change to its
  results.

**Migration and rollback.** One additive function (plus any shared private
helper, with existing results unchanged and tested). Rollback: drop it, or
switch off `managerTriage`.

**Tests.**

- For MO, SG and AD, each `waiting` equals the existing read's count, and each
  oldest time equals that read's oldest. Fixtures cover: a menu queue with own
  photos (MO's own count as `own_waiting`, not in `waiting`), findings of each
  To confirm kind, and checklist items.
- MO's `checklist` row is `available = false`.
- SO is refused; another venue's id is `wrong_venue` for MO and SG.
- The function is `stable` (T9b guard).

**Owner decisions.** None. Visibility follows today's rules. If Q8 later opens
the checklist to MO, `available` follows the gate.

### R4. `waitingSince` on To confirm rows

**Need.** UI §6.2 "All" view merges queues by waiting time.

**Shape.** An additive key `waitingSince` on every `knowledge_to_confirm`
item, and items ordered by it:

| Row kind                       | `waitingSince`                              |
| ------------------------------ | ------------------------------------------- |
| Finding, change report, detail | the contribution's send time (`created_at`) |
| `answer_awaiting_confirmation` | the answer's send time                      |
| `evidence_withdrawn`           | the `evidence_withdrawn` event's time       |
| `confirmation_revoked`         | the revoke decision's time                  |

**Authorisation.** Unchanged (`assert_can_manage_venue`).

**Migration and rollback.** B01's function is frozen, so this is a
`create or replace` of `public.knowledge_to_confirm` in a new B02 migration.
The rollback note restores the B01 body. Existing keys and their meaning are
unchanged.

**Tests.** Each kind's `waitingSince`, the order, and every existing
`knowledge-screens` assertion unchanged.

**Owner decisions.** None.

### R5. My contributions feed (one cursor)

**Need.** UI §6.1: one list of the caller's photos, task sends and findings,
newest first, 20 a page, with separate dimension lines.

**Shape.** `public.my_contributions_feed(p_cursor text, p_limit integer) returns jsonb`
`{items, nextCursor}`. Each item has `type`, `key`, `at` and the ids the
existing routes use, plus its own dimension fields:

| `type`              | Source (caller's own rows only)                                                                        | Fields                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `photo`             | `media_assets` uploaded by the caller, `purpose = 'general'`, not deleted                              | `assetId`, `venueId`, `mediaType`, `uploadState`, `labels` (has labels; needs attention), `menuDecisions[]` (each live `menu_item_photos` row for the asset: `photoId`, `itemId`, item name, `state`, `reason`), `menuUseAccepted` (R7), `groupId` (W1, when built) |
| `task_send`         | `coverage_submission_items` with `submitted_by` = caller and `origin = 'submitted'`                    | `itemId`, `submissionId`, `requirementId`, `assetId`, `state`, `reason`, `replacesItemId`, `revision` (R6)                                                                                                                                                          |
| `finding`           | exactly the items `knowledge_my_contributions` returns (contributions and pre-B01 amenity submissions) | as B01, including `findingRef`, `state`, `recognition`, `replacedOwn`                                                                                                                                                                                               |
| `assignment_closed` | as B01                                                                                                 | as B01                                                                                                                                                                                                                                                              |

- **Order and cursor:** by `(at, key)` descending, where `at` is the record's
  creation (send) time and `key` is a type prefix plus the id (`p:`, `t:`, and
  B01's `c:`, `s:`, `e:`). The cursor is stable because `at` never changes.
  Ordering by latest activity would let rows move between pages (OD-4).
- **Limits:** `p_limit` 1 to 20. Each branch is ordered and limited to
  `p_limit + 1` before the union, so a page costs at most four small indexed
  reads.
- **Amenity evidence** (`purpose = 'amenity'`) is not a `photo` row. It
  appears inside its `finding`, as today.
- **Drafts** stay in B01's `knowledge_my_contributions.drafts`. The feed
  doesn't page them.

**Authorisation.** Own rows only, across venues (B01's history-kept default,
access-and-rights §5). Media URLs come from the existing routes, so each
thumbnail is still authorised by today's gate for the viewer (own uploads).
MO gets its findings and any staff-era rows. AD gets an empty feed.

**Migration and rollback.** One additive function. Possibly one additive index
`coverage_submission_items (submitted_by, created_at desc, id)` if the plan
shows `coverage_submission_items_author_month_idx` doesn't serve the branch.
Rollback: drop both, or switch off `myContributions`.

**Tests.**

- Each type's fields against fixtures.
- Never another person's rows.
- Deleted assets excluded.
- Rows from a former venue still listed after a transfer.
- `finding` items equal `knowledge_my_contributions` items.
- The cursor tie-break: four rows at one instant across types, paged with
  limit 1.
- An invalid cursor is `invalid_cursor` (22023).
- A 20-row page reads in one statement (T9b), with `explain` on a seeded
  fixture.

**Owner decisions.** **OD-4:** order by send time (stable, proposed) or by
latest activity (rows move between pages; needs a different cursor design).
This is WS2's call with the owner.

### R6. Revisions the UI may show

| Record        | What exists                                                                                                               | Shown as                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task send     | `coverage_submission_items.replaces_item_id` chain (CD:313; one replacement per item, enforced by its trigger)            | `revision` = position in the chain (1 for an original), `replacesItemId` and the replaced item's send time. Computed in R5 with a bounded recursive walk |
| Finding       | B01's `replaced` decision, `replacedOwn` and `replacedOwnSentAt`                                                          | "Replaced your earlier finding of {time}". No number: B01 keeps one undecided finding per person, so a count would not mean anything                     |
| Menu photo    | **No link exists.** A retake is a new asset and a new decision. `menu_item_photos.revision` is an optimistic-lock counter | Nothing. The counter must never be shown as a version                                                                                                    |
| Slot revision | Concurrency token (B01 G4)                                                                                                | Never shown                                                                                                                                              |

**OD-5:** whether menu retakes should be linked to the photo they replace.
That needs new data (for example a nullable `retake_of_photo_id`, set when a
retake is uploaded from a request) and belongs with B05-01 per-file state,
not B02.

**Tests.** The chain depth for 1, 2 and 3 replacements. The menu photo
counter never appears in R5 output.

### R7. Permitted use

B02 shows only `menuUseAccepted`: the asset has a live `menu_item_photos` row
in state `accepted` (the existing "Accepted for menu use"). There is no grant,
rights or public-use state anywhere today (UI §1.4), and B02 adds none. B05-02
adds purpose-specific grants.

**OD-6 (owner to confirm):** B02 makes no use claim beyond menu acceptance.

**Tests.** `menuUseAccepted` is true only for a live accepted decision. It is
false after `withdrawn`, `invalidated` or `better_photo_requested`.

### R8. Capabilities for the caller

**Need.** UI §4.1 and §5: one read, for both shells, of what the caller may do
at the venue, so screens show only usable choices.

**Shape.** `public.my_venue_capabilities(p_venue_id uuid default null) returns jsonb`:

| Key                     | Computed by (the same predicate the write uses)                                                  | Today: MO / SO / SG / AD (matrix §3)               |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `accountKind`           | profile role plus `effective_manager_venue_id`                                                   | `manager` / `staff` / `staff_with_grant` / `admin` |
| `venueId`               | grant venue (MO, SG), profile venue (SO), `p_venue_id` (AD)                                      |                                                    |
| `canUpload`             | `private.uploadable_venue_id() = venueId`                                                        | no / yes / yes / no                                |
| `canLabel`              | the role allow-list in `private.save_media_labels_as` (own uploads)                              | no / yes / yes / yes (admin library)               |
| `canSendFindings`       | `private.knowledge_basis(venueId) is not null` and the venue has an open working list            | yes / yes / yes / yes                              |
| `canConfirmFindings`    | `knowledge_basis` in (`venue_manager`, `admin`)                                                  | yes / no / yes / yes                               |
| `canSelfConfirm`        | per in-scope key: confirmation-free, or `self_confirmation_allowed` (`knowledge_question_rules`) | object keyed by question                           |
| `canReviewMenuPhotos`   | `private.can_manage_venue(venueId)` and the menu-photo context rules                             | yes / no / partial / yes                           |
| `canDecideOwnMenuPhoto` | `not private.menu_photo_self_blocked(caller)` and the reviewable-uploader rule                   | **no** / n/a / yes, recorded / yes, recorded       |
| `canReviewChecklist`    | `can_manage_venue` and not a manager account (MD triggers)                                       | no / no / yes / yes                                |
| `canBeAssigned`         | the assignee rule (`staff_not_eligible` otherwise)                                               | no / yes / yes / no                                |

- The function reports what the gates allow. It is never consulted by a gate,
  so a wrong capability can hide a choice but never grant one.
- The predicates are shared, not copied. Where a rule lives only inline in a
  write function (the label role list, the coverage triggers), the build moves
  it into a named private helper that both the write and this read call, with
  the write's behaviour unchanged and pinned by its existing tests.
- AD must name a venue. SO, SG and MO get their own.

**Migration and rollback.** One additive function (plus any extracted helper).
Rollback: drop it. The UI falls back to today's per-shell assumptions.

**Tests.** The equivalence matrix: for each of MO, SO, SG, AD and the one-acc
venue, each capability is `true` exactly when the matching write succeeds and
`false` exactly when it is refused, run against the real write functions. This
pins the read to the gates as both change (for example W3). It is also listed
in the T9b guard.

**Owner decisions.** None for the read. Its values change only when a gate
changes.

---

## 4. Writes

### W1. Contribution group (B02-05)

**Need.** UI §7: one acknowledgement for several images of one subject; each
asset keeps its own state. B05-01 later adds per-file state to the same model.

**Shape (proposed; the table owner is to be assigned, WS2 suggests WS4).**

```text
public.media_contribution_groups
  id uuid pk, venue_id uuid (venues), created_by uuid (profiles),
  subject_kind text in ('menu_item', 'task', 'question', 'none'),
  subject_id uuid null (null only for 'none'),
  client_group_key text (8..128, [A-Za-z0-9_-]), created_at timestamptz
  unique (created_by, client_group_key)        -- idempotent create
  unique (id, venue_id)

public.media_contribution_group_members
  group_id uuid, venue_id uuid, asset_id uuid, position smallint, added_at timestamptz
  primary key (group_id, asset_id)
  foreign key (group_id, venue_id) -> groups (id, venue_id)
  foreign key (asset_id, venue_id) -> media_assets (id, venue_id)   -- same venue, always
  unique (asset_id)                            -- one group per asset (OD-7)
```

- `public.contribution_group_start(p_key text, p_subject_kind text, p_subject_id uuid) returns uuid`.
  Idempotent by key. The subject must exist at the caller's upload venue: a
  menu item on the venue's menu, a task (`coverage_requirements`) at the venue,
  or a working-list check at the venue.
- `public.contribution_group_add(p_group_id uuid, p_asset_ids uuid[]) returns integer`.
  The caller's own assets only, same venue as the group, not deleted, any
  upload state (a group is formed at pick time). Idempotent per asset.
- Reads: R5 `photo` rows carry `groupId`. The manager menu review read gains
  `groupId` per pending photo, so WS2 can show one card per group (UI §7).
  `public.contribution_group(p_group_id)` returns the subject and the members
  **the viewer may already see**, each with its own state.
- **Groups never widen visibility.** Every member is filtered through the
  viewer's existing asset gate (`community_readable_assets`,
  `menu_item_photo_asset`, the amenity evidence gate, own uploads). A group
  with no member visible to the viewer reads as not found.
- **No credit.** Credit functions don't read these tables (D-7). Pinned by the
  credit-function hash and the C-tests.
- Membership is append-only. A deleted asset stays a member and is hidden by
  the gate. Groups are never deleted.
- Manager accounts can create groups only if the owner allows W3 (they need their
  own uploads to add).

**Authorisation and RLS.** RLS on, no client policies, functions only.
`created_by` is the caller; only the creator adds members.

**Migration and rollback.** One additive migration (two tables, the functions,
append-only guards on members). Rollback: switch off `contributionEntry` and
`myContributions`. The tables stay, and B01 screens show the photos
individually.

**Tests.**

- Idempotent start and add.
- Another person's asset, another venue's asset and a deleted asset are
  refused.
- An unknown or other-venue subject is refused.
- A second group for the same asset is refused (if OD-7 keeps one group per
  asset).
- A colleague sees only the members today's gates show them.
- A group never makes an amenity-purpose asset visible in Photos.
- Credit hash and C-tests unchanged.
- One failed upload in a group leaves the others' states unchanged.

**Owner decisions.**

- **OD-7:** one group per asset, and the maximum group size. The proposal is
  one group per asset and 10, the batch size.
- **Table owner:** WS4 or WS1; for the orchestrator to assign.

### W2. `from` return parameter

Client only (UI §4.3). No server change.

### W3. Manager-account upload (B02-03): shape only, not to be built until decided

**Today** (matrix §4.1, OA1, OA2): only `role='staff'` can upload. The chain
has six refusals:

1. `reserve_media_asset` (`not_active_staff`, AP:101-103);
2. `private.uploadable_venue_id` (AC:51-62);
3. the storage insert policy through `can_upload_media_object`;
4. the trigger `guard_media_original_write`;
5. `finaliseAsset` (`lib/server/media/finalise.ts:251-253`);
6. `getMediaActor("staff")` in `reserveUpload`.

**Depends on:** Q1 (whether, and for which purposes), Q10 (manager media
visibility), Q11 (admin capture), OD-8 and OD-9 below.

**Shape if the owner says yes:**

- `private.uploadable_venue_id()` returns, for an active MO, its effective
  grant venue (which always equals its profile venue, MA:44-45), only while the
  venue is active. Staff are unchanged; admins stay null unless Q11 says
  otherwise.
- All six refusals change in the **same** migration to use
  `uploadable_venue_id() is not null` (or a named
  `private.can_upload_media()`), so no path disagrees. The open-upload limit
  (20) and the size and type limits are unchanged.
- **Purposes.** If Q1 allows amenity and knowledge evidence only, MO
  reservations accept only `p_purpose = 'amenity'`. If menu photos are
  included, `general` is allowed too.
- **Audit (OD-8).** An additive nullable `media_assets.uploader_role` (snapshot
  of the role at reservation), so later reports can tell manager uploads apart
  after a conversion. Existing rows stay null (unknown).
- **Photos audience (OD-9).** `community_readable_assets` and
  `community_media_page` name their roles (MD). Whether a manager's `general`
  upload appears in colleagues' Photos is a policy choice. The default
  proposal is that it does not until decided.
- **Losing the grant** mid-upload behaves like a staff member deactivated
  mid-upload today: finalise refuses, and the reservation is cleaned up by the
  existing abandoned-upload path.
- **Unchanged by W3:**
  - menu self-review (§5.3);
  - credit (MO is not a participant; Q5);
  - legacy coverage triggers (Q8);
  - assignment (Q7).

**Migration and rollback.** One migration replacing the six gates together,
plus the optional column. Rollback: a later migration restores the staff-only
predicate. Existing manager uploads stay, and stay attached to their findings.

**Tests.**

- The four-kind matrix for reserve, storage write, finalise and each purpose.
- An MO without an effective grant, at an inactive venue, or with a revoked
  grant mid-upload is refused.
- The asset's venue is the grant venue.
- SO and SG are unchanged (existing `access.test.ts` passes unmodified).
- AD is unchanged unless Q11 says otherwise.
- An MO dish photo, once labelled (W4), waits for an admin.
- The C-tests and credit hash are unchanged.
- R8 `canUpload` flips with the gate.

### W4. Manager-account labelling (B02-03): shape only, not to be built until decided

**Today** (matrix §4.2): labels are for staff (own uploads) and admins.

**Depends on:** Q4 (and Q1: without uploads an MO has nothing of its own to
label).

**Shape if the owner says yes:** add `manager` to the role allow-list in
`private.save_media_labels_as`, with the same own-upload rule as staff, and
the same in `stage_media_labels`, the `media_pending_labels` RLS and
`refuseManager`. Items still come from the asset's venue (PL:292-300). A
labelled MO dish photo becomes a pending menu photo at its venue. Today's
self-review rule then sends it to an admin (§5.3).

**Migration and rollback.** One migration with W3, or after it. Rollback: a
later migration removes `manager` from the list; saved labels stay.

**Tests.**

- MO labels its own upload.
- MO can't label another person's upload or an admin library asset.
- SO, SG and AD are unchanged.
- The pending-label draft flow works for MO.
- R1 and R8 follow.

### W5. `loadedAt`

The server render time, passed to the page. No database work. WS6 to confirm
that caching doesn't reuse it (UI §8.1).

---

## 5. B02-03 one-account venue: what this design changes and what it doesn't

### 5.1 Gaps (matrix §5) and where each goes

| Gap | Today                                      | In this design                                                                                                     |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| OA1 | MO can't upload, so it can't answer Yes    | W3, only if Q1 says yes                                                                                            |
| OA2 | No menu photo contribution                 | W3 and W4, only if Q1 and Q4 say yes                                                                               |
| OA3 | MO's own photos wait for an admin          | **Unchanged** (§5.3; Q2, Q9)                                                                                       |
| OA4 | Legacy coverage closed to MO               | **Unchanged** (Q8). R3 and R8 report it as unavailable                                                             |
| OA5 | No targets, credit or recognition for MO   | **Unchanged** (Q5). R5 shows no recognition line for MO                                                            |
| OA6 | MO can't be an assignee                    | **Unchanged** (Q7). R8 `canBeAssigned` false                                                                       |
| OA7 | Self-confirmation depends on the rule seed | **Unchanged** (Q6). R8 `canSelfConfirm` reports it per question                                                    |
| OA8 | Admin prerequisites (enable, working list) | **Unchanged**                                                                                                      |
| OA9 | Coverage evidence and general media hidden | **Unchanged** (Q10). If the owner allows W3, MO's own new uploads still need Q10 to open them through `/api/media` |

### 5.2 Fixtures

Every security test in §3 and §4 runs for MO, SO, SG and AD, plus one
one-account venue (a single MO and an admin, no staff). The one-account
journey in UI §9 runs at the RPC level before any UI work:

- capture No, Not applicable and Couldn't establish;
- confirm its own finding on a self-confirmable key;
- its own menu photo waiting for an admin (only reachable with a staff-era
  photo until W3).

### 5.3 Manager self-review of menu photos: unchanged, explicit

Today (matrix §4.3):

- **MO:** may not decide its own menu photo (`private.menu_photo_self_blocked`,
  MR:134-145, backed by the trigger `menu_item_photos_no_manager_self_review`,
  MR:69-108). The photo waits for an admin.
- **SG:** may, recorded with `self_review = true`, and the photo is credited.
- **AD:** may, recorded.

This design changes none of it. R8 reports `canDecideOwnMenuPhoto` from the
same predicate, so screens can say so up front (UI §5.3). Whether MO and SG
should be aligned, whether self-reviewed photos should be credited, and who
decides an MO's own photos at a one-account venue are **owner decisions Q2,
Q3 and Q9**. One gap is recorded, not fixed here: the self-review trigger does
not watch `is_primary` (matrix F9).

---

## 6. Owner decisions

### 6.1 From the matrix (§7), unchanged and undecided here

Q1 manager upload · Q2 manager self-review · Q3 credit for self-reviewed
photos · Q4 manager labelling · Q5 manager targets and recognition · Q6
self-confirmation at a one-account venue · Q7 managers as assignees · Q8
legacy coverage for managers · Q9 who decides a manager's own staff-era
photos · Q10 manager evidence visibility · Q11 admin capture · Q12
withdrawing a confirmation in the UI · Q13 recording conflict choices as
self · Q14 legacy grant retirement.

### 6.2 Raised by this design

| #    | Decision                                              | Today                       | Design default until decided                          |
| ---- | ----------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| OD-2 | Better-photo requests for items no longer on the menu | Me shows them               | Returned with `canRetake: false`; WS2 decides display |
| OD-3 | Name the reviewer on a better-photo request           | Reason shown, reviewer not  | Not named                                             |
| OD-4 | My contributions order: send time or latest activity  | n/a                         | Send time (stable cursor)                             |
| OD-5 | Link a menu retake to the photo it replaces           | No link                     | No link; consider in B05-01                           |
| OD-6 | Use claims beyond "Accepted for menu use"             | None exist                  | None                                                  |
| OD-7 | One group per asset; maximum group size               | No groups                   | One group; 10 members                                 |
| OD-8 | Record the uploader's role on new uploads (if W3)     | Not recorded                | Add a nullable snapshot column                        |
| OD-9 | Manager uploads in colleagues' Photos (if W3)         | n/a (managers don't upload) | Not shown                                             |

---

## 7. Migration plan and rollback

Each batch is a new migration file after the B01 freeze, additive, with a
rollback note. None edits a B01 migration.

| Batch | Contents                                                                                                        | Rollback                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| B02-a | R1, R3, R5, R8 functions; R4 `create or replace` of `knowledge_to_confirm`; any extracted helpers; any R5 index | Drop the functions; restore the B01 `knowledge_to_confirm` body; UI switches off |
| B02-b | W1 tables and functions                                                                                         | UI switches off; tables stay (no data loss)                                      |
| B02-c | W3 and W4, **only after Q1 and Q4 are decided**                                                                 | Restore the staff-only gates; uploads and labels already made stay               |

Every batch runs, on a spare stack after a full-chain reset:

- the full security suites;
- the B01 knowledge suites;
- the credit baseline and C-tests;
- the credit-function hash check;
- the T9b and T11a compatibility guards.

---

## 8. B01 follow-ups raised with the matrix (for the record)

- **F1** (unassigned staff, capture page): fixed in B01 without widening any
  permission. The capture screen reads the knowledge slot for in-scope checks
  (WS2), and staff list their own eligible uploads through
  `listKnowledgeAssets` (WS1, `task/b01-ws1-domain`). Own-photo thumbnails
  use the own-media route, which already serves an uploader's own assets of
  any purpose. Security tests pin that the legacy check reads still refuse
  unassigned staff.
- **F5** (conflict choice of one's own finding): a doc correction, now made
  in access-and-rights.md. Self-resolution is recorded through the decider and
  the author, and the self flag marks confirmations only. Q13 decides whether
  a visible marker is wanted.
- **F6** (no UI to withdraw a confirmation): server-side done and tested;
  access-and-rights.md now says it is server-only in B01. Q12 decides whether
  a screen offers it.
- **F8** (an account converted to manager mid-month may still score that
  month): noted for B08. B02 changes no credit rule.

## 9. Changelog

**Draft 1 (9 Nov 2026):** first B02 server design from WS2's UI design
revision 1 and the B02-03 account matrix, at pilot head `a86bdba8`.
