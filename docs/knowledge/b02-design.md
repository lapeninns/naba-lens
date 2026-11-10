# B02 server design (WS1): reads and writes for coherent staff and manager work

Owner: WS1 (knowledge domain). Status: **draft 3 (amended), approved for
build**. Batches B02-a and B02-b are built from this design; B02-c waits for
owner decisions Q1 and Q4.

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

| #   | Need (UI §10)                               | Proposal                                                                                                                             | New database objects                                       | Blocked by an owner decision?                          |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| R1  | Labels-needed count                         | `public.my_label_work()`: two counts with Me's exact rule                                                                            | 1 function                                                 | No                                                     |
| R2  | Better-photo requests for the caller        | Extend the existing `listMyMenuPhotoDecisions` read; no SQL needed                                                                   | none                                                       | OD-2 (old-menu requests), OD-3 (who asked)             |
| R3  | Manager triage counts and oldest waiting    | `public.manager_triage_summary(p_venue_id)`: one row per queue, never summed                                                         | 1 function                                                 | No (queue visibility follows today's rules)            |
| R4  | `waitingSince` on To confirm rows           | Additive key on `knowledge_to_confirm`                                                                                               | `create or replace` of a B01 function in a B02 migration   | No                                                     |
| R5  | One-cursor My contributions feed            | `public.my_contributions_feed(p_cursor, p_limit)`: typed rows, `(time, key)` cursor                                                  | 1 function, up to 1 additive index                         | OD-4 (sort by send time or by latest activity)         |
| R6  | Revision numbers the UI may show            | Task sends: replacement chain. Findings: B01 replaced-own. Menu photos: **none exists**                                              | none (derived in R5)                                       | OD-5 (link menu retakes)                               |
| R7  | Permitted use per photo                     | Only "menu use accepted" in B02; no grants before B05                                                                                | none (derived in R5)                                       | Owner to confirm (OD-6)                                |
| R8  | Capabilities for the caller                 | `public.my_venue_capabilities(p_venue_id)`, computed from the same predicates the write gates use                                    | 1 function                                                 | No (it reports whatever the gates allow)               |
| R9  | Delete impact for a photo (HM-04)           | `public.my_asset_delete_impact(p_asset_id)`: uploader only; predicts each answer's effect with the triggers' own predicates          | 1 function                                                 | OD-10 (admins in the Library)                          |
| R10 | Request keys on legacy check writes (MG-01) | `public.amenity_commands` and six keyed overloads that replay before the revision check; old signatures kept                         | 1 table, 6 functions                                       | No                                                     |
| R11 | Draft-save guard (L-b)                      | `knowledge_save_draft` overload with `p_base_sent_at` (from `knowledge_check.mySentAt`); refuses with `draft_already_sent` (`NLK09`) | 1 function, 3 `create or replace`                          | No                                                     |
| W1  | Contribution group                          | Two additive tables and four functions (WS1 owns them); groups never widen visibility and add no credit                              | 2 tables, 4 functions                                      | OD-7 (one group per asset, size)                       |
| W2  | `from` return parameter                     | Client only                                                                                                                          | none                                                       | No                                                     |
| W3  | Manager-account upload                      | Shape ready, **not to be built until decided**                                                                                       | `create or replace` of the upload gates, 1 additive column | **Q1, Q10, Q11; OD-8 (audit), OD-9 (Photos audience)** |
| W4  | Manager-account labelling                   | Shape ready, **not to be built until decided**                                                                                       | `create or replace` of the label gates                     | **Q4** (and Q1)                                        |
| W5  | Page `loadedAt`                             | Server render time; no database work                                                                                                 | none                                                       | No                                                     |

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
  count cannot drift. The rule is Me's, as WS2 states it (D-12): a ready photo
  needs labels when its labels have no menu item and no content type. A note
  or a missing-item report alone still needs labels.

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

- **OD-2:** WS2 settles the display (D-13): a request for an item no longer
  on the menu is not a To do item. The read still returns it, with
  `canRetake: false`, for Me. Hiding it server-side stays an owner option.
- **OD-3:** whether the card names who asked. Today Me shows the reason, not
  the reviewer. Showing the reviewer's first name would be a new disclosure to
  staff.

### R3. Manager triage summary

**Need.** UI §6.2: one row per queue (menu photos to review, findings to
confirm, checklist photos to review), each with its own count and oldest
waiting time, never summed (D-6).

**Shape.**
`public.manager_triage_summary(p_venue_id uuid default null) returns table (queue text, available boolean, waiting integer, oldest_waiting_at timestamptz, own_waiting integer)`.

| `queue`       | `available` when                                                                                          | `waiting` and `oldest_waiting_at` equal                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu_photos` | `manager_menu_photo_overview` serves the caller for the venue today (MO, AD; SG only as that read allows) | its `pending_photos` and `oldest_pending_at`; `own_waiting` is its `own_waiting_photos`. The test pins that `waiting` equals the rows `manager_menu_photo_queue` returns to the same caller |
| `findings`    | `knowledge_basis` is `venue_manager` or `admin`                                                           | `knowledge_to_confirm` count, oldest `waitingSince` (R4)                                                                                                                                    |
| `checklist`   | SG or AD (MO is refused today, matrix §4.3 and OA4)                                                       | the venue's pending coverage items, as `venue_coverage_summary.pending_review_count`                                                                                                        |

- **Venue:** MO and SG use their grant venue (another `p_venue_id` is
  `wrong_venue`); AD must name one. SO is refused (`not_venue_manager`).
- A queue the caller can't act on comes back with `available = false` and no
  numbers, never an error, so one read serves every shell.
- Each existing read is called only for a queue that is available to the
  caller, so a refusal inside it never reaches the caller.
- It is one `stable` statement. It calls the three existing reads unchanged
  (`manager_menu_photo_overview` for `pending_photos`, `own_waiting_photos`
  and `oldest_pending_at`; `knowledge_to_confirm`;
  `venue_coverage_summary`) inside its own body, so it reimplements no filter
  and re-creates no existing function. Each of those already re-checks the
  caller.
- **One snapshot.** All three are declared `stable` today:
  - `manager_menu_photo_overview`, `20261107100500_manager_item_photo_reads.sql:41`;
  - `venue_coverage_summary`, `20261102150000_coverage_procedures.sql:2219`;
  - `knowledge_to_confirm`, `20261109145934_knowledge_b01_functions.sql:2057`,
    and still `stable` after R4.

  A `stable` function called from a `stable` one uses the caller's snapshot,
  so the three counts come from one snapshot. If one of them were ever made
  `volatile`, its queue's count could come from a separate snapshot. That is
  acceptable for counts shown side by side and never summed, and the
  catalogue test below would flag the change.

**Migration and rollback.** One additive function. Nothing existing is
re-created. Rollback: drop it, or switch off `managerTriage`.

**Tests.**

- For MO, SG and AD, each `waiting` equals the existing read's count, and each
  oldest time equals that read's oldest. Fixtures cover: a menu queue with own
  photos (MO's own count as `own_waiting`, not in `waiting`), findings of each
  To confirm kind, and checklist items.
- MO's `checklist` row is `available = false`.
- SO is refused; another venue's id is `wrong_venue` for MO and SG.
- **Catalogue assertion (T9b style):** `manager_triage_summary`,
  `manager_menu_photo_overview`, `venue_coverage_summary` and
  `knowledge_to_confirm` all have `provolatile = 's'` and are security
  definer. They are added to the `pg_proc` check in
  `tests/security/knowledge-compat.test.ts`.

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

**Visible order change.** Today the items are ordered by `sentAt`, which for
`evidence_withdrawn` and `confirmation_revoked` rows is the original
answer's send time. Ordering by `waitingSince` moves those two kinds to their
event time (the withdrawal or the revoke), usually later in the list. Finding
rows keep their place. This is an intended, visible change in To confirm, and
WS2's UI tests should expect it.

**Tests.**

- Each kind's `waitingSince`.
- The new order: a revoked or evidence-withdrawn row whose answer was sent
  before a pending finding, but withdrawn or revoked after it, now sorts
  after the finding.
- Every existing `knowledge-screens` assertion unchanged, apart from that
  order.

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
- It calls the existing named predicates where they exist
  (`uploadable_venue_id`, `knowledge_basis`, `can_manage_venue`,
  `menu_photo_self_blocked`, `is_active_manager`, `knowledge_question_rules`).
- Two rules live only inline today: the label role list in
  `save_media_labels_as`, and the manager-deny coverage triggers. This read
  restates them in its own body rather than re-creating either. The
  equivalence matrix below is the drift guard: it runs the real writes, so a
  later change to either gate fails the test until this read follows.
- AD must name a venue. SO, SG and MO get their own.

**Migration and rollback.** One additive function. Nothing existing is
re-created.
Rollback: drop it. The UI falls back to today's per-shell assumptions.

**Tests.** The equivalence matrix: for each of MO, SO, SG, AD and the one-acc
venue, each capability is `true` exactly when the matching write succeeds and
`false` exactly when it is refused, run against the real write functions. This
pins the read to the gates as both change (for example W3). It is also listed
in the T9b guard.

**Owner decisions.** None for the read. Its values change only when a gate
changes.

---

## 3a. Further reads and writes asked in WS2 revisions 3 and 4

### R9. Delete impact for a photo (audit HM-04)

**Need.** UI §8.8: before a staff member deletes their photo on Me, say which
venue answers it is evidence for, and whether deleting it takes an answer out
of use. The delete itself is unchanged.

**What a deletion does today.** `delete_media_asset` sets `deleted_at` (the
uploader while active staff, or an admin). Two triggers then react:

- `media_assets_knowledge_evidence_withdrawn` (B01): for every check whose
  **current** submission uses the asset and whose slot is on the working list,
  it records `evidence_withdrawn`. The resolver then reports the answer
  `withdrawn / evidence_withdrawn` until a manager reaffirms it or it is
  answered again. This happens even when the remaining evidence still meets
  the rule.
- `media_assets_amenity_evidence_lost` (legacy, and a credit input): for a
  check whose current submission is a complete **Yes** using the asset, if
  the remaining ready evidence no longer meets the rule, the check moves to
  `needs_recheck`. **It runs on working-list slots too.** There the progress
  change takes precedence in the resolver, which reports
  `stale / evidence_lost` rather than `withdrawn`.
- A pending (undecided) knowledge contribution is not changed at delete time,
  but adopting a Yes that relied on the asset is then refused
  (`evidence_not_eligible` or `evidence_rule_unmet`).
- Earlier, non-current submissions keep their history. The asset is hidden.

**Shape.** `public.my_asset_delete_impact(p_asset_id uuid) returns jsonb`:

```text
{ assetId, impacts: [
    { kind: 'answer_in_use' | 'pending_finding' | 'earlier_answer',
      effect: 'withdrawn' | 'needs_recheck' | 'none' | 'pending_loses_evidence',
      venueId, venueName, checkId, questionKey, question,
      yours: boolean,            -- the answer or finding is the caller's own
      findingRef?: { type, id }  -- own pending finding only
    } ] }
```

- One `answer_in_use` item per check whose current submission uses the
  asset. `effect` is evaluated in this order:
  1. `needs_recheck`: the answer is a complete Yes whose remaining ready
     evidence would not meet its rule, **whether or not** the slot is on the
     working list (the legacy trigger runs in both cases, and the resolver
     then reads `stale / evidence_lost`);
  2. `withdrawn`: otherwise, the slot is on the working list (the B01
     trigger records `evidence_withdrawn`);
  3. `none`: otherwise.
- One `pending_finding` item per undecided contribution that uses the asset,
  with `effect = 'pending_loses_evidence'`. This includes **other people's**
  undecided findings that use the uploader's photo (a manager may attach a
  staff member's legacy coverage photo). Those are listed with `yours: false`
  and no `findingRef`, as "a finding being decided at {venue}", rather than
  omitted, because deleting the photo affects them too.
- `earlier_answer` items (effect `none`) for the caller's own non-current
  submissions, so the person knows the photo stays in that history, hidden.
- The prediction calls the **same existing predicates** the triggers use
  (`private.knowledge_in_scope`, `private.amenity_rule_met` over the
  remaining ready evidence), from a new private helper
  `private.asset_removal_effects(p_asset_id)`. **Neither trigger is
  re-created.** In particular, the credit-input trigger
  `media_assets_amenity_evidence_lost` is left exactly as it is. The
  predict-then-delete tests are the drift guard.
- It is advisory and one `stable` statement. A manager may act between the
  read and the delete, so WS2's wording says what deleting it "will" do only
  for the answer as loaded.

**Authorisation and disclosure.**

- **The uploader only:** active staff, own, non-deleted asset (the same rule
  `delete_media_asset` applies to staff). Anyone else, or an unknown or
  deleted id, gets `not_found`.
- An admin deleting from the Library is not covered here (OD-10).
- **No other people's data beyond D3.** Every item carries the venue name, the
  question text (catalogue wording, not personal data) and the effect, and
  `yours`. None carries a name, profile id, the answer value, finding text,
  notes or Wi-Fi notes. A `yours: false` item is one item per answer or
  finding, worded "an answer at {venue}" or "a finding being decided at
  {venue}", with the question.
- After a transfer, the person still owns and may delete the photo, so the
  former venue's name is shown, as B01 history already does.

**Migration and rollback.** One additive function and one new private
helper in batch B02-a. No trigger or existing function is re-created.
Rollback: drop both; WS2's dialog falls back to today's text.

**Tests (predict, then delete, then compare).** For each fixture, read the
impact, delete the asset through `delete_media_asset` as the uploader, and
assert the actual state change equals the predicted `effect`:

- current Yes on a working-list slot, sole photo → `needs_recheck`; progress
  `needs_recheck`, the slot reads `stale / evidence_lost`;
- current Yes on a working-list slot, another photo still meets the rule →
  `withdrawn`; still complete, the slot reads `withdrawn / evidence_withdrawn`;
- current Yes off the list, sole photo → `needs_recheck`; progress
  `needs_recheck`;
- current Yes off the list, another photo still meets the rule → `none`;
  still complete;
- current No with a photo, off the list → `none`;
- current No with a photo on the list → `withdrawn` (B01 behaviour);
- own pending finding → `pending_loses_evidence`; a later confirm is refused;
- a manager's undecided finding using the uploader's legacy photo →
  `pending_finding`, `yours: false`, no `findingRef`, no name;
- an earlier, replaced submission → `earlier_answer`, `none`;
- legacy media in a manager's answer → `yours: false`, and the JSON contains
  no profile id or name;
- an unused photo → `impacts: []`.

Refusals:

- a colleague, another venue's staff, a manager account and an admin calling
  for the uploader's asset → `not_found`;
- a deleted asset → `not_found`.

**Owner decisions.** **OD-10:** whether admins should see the same impact
when deleting from the Library (they may already read everything, so it is a
product choice, not a disclosure question).

### R10. Request keys on legacy amenity check writes (audit MG-01)

**Need.** UI §8.2 rule 3. A retry after a lost reply on assign, notes,
reopen, archive, restore or add from catalogue today meets its own committed
change as a stale revision (`amenity_conflict`, "Someone else changed this
check").

**Shape (same pattern as B01's knowledge commands).**

- **New table** `public.amenity_commands`, separate from the frozen
  `knowledge_commands`:
  - `idempotency_key uuid primary key`;
  - `actor_id uuid not null` (profiles);
  - `command text not null`, one of `assign`, `set_notes`, `reopen`,
    `archive`, `restore`, `add_checks`;
  - `request_hash text not null` (sha256 of the canonical jsonb of the
    arguments);
  - `venue_id uuid not null`;
  - `check_id uuid null` (null for `add_checks`);
  - `result jsonb not null`;
  - `created_at`.

  RLS on, no policies, append-only guard.

- **New overloads** with a **required** `p_idempotency_key uuid`:
  - `amenity_assign_check(p_check_id, p_assignee_id, p_revision, p_idempotency_key)`;
  - `amenity_set_check_notes(…, p_idempotency_key)`;
  - `amenity_reopen_check(…, p_idempotency_key)`;
  - `amenity_archive_check(…, p_idempotency_key)`;
  - `amenity_restore_check(…, p_idempotency_key)`;
  - `amenity_add_checks(p_venue_id, p_keys, p_idempotency_key)`.

  Each returns `jsonb {revision, replayed}`, or `{checkIds, replayed}` for
  add.

- **Order in each:**
  1. the active-account check (`private.amenity_assert_active_user`), as
     B01 runs `knowledge_lock_actor` first;
  2. validate the key;
  3. `pg_advisory_xact_lock` on the key;
  4. look up a prior command. Same actor, command and hash returns its stored
     result with `replayed: true`. Anything else raises the existing
     `idempotency_key_reused`;
  5. otherwise call the **unchanged** existing function in the same
     transaction (its revision check, locks, event and authorisation all
     apply);
  6. record the result.

  The replay lookup comes before the revision check, so a lost-reply retry
  replays instead of conflicting.

- **The old signatures stay** exactly as they are. The key is a required
  parameter in the new overloads, so PostgREST picks each overload by its
  named arguments without ambiguity. Old clients keep working, and new
  clients send a key.
- A refused write records nothing (as in B01). A retry of a refused request
  runs again and meets the current state.
- **Mapping:** no new code. `idempotency_key_reused` is already
  `state_conflict`, and `amenity_conflict` is still `revision_conflict` for a
  genuine conflict under a fresh key.
- **Retention:** like `knowledge_commands`, rows are kept. A purge after a
  bounded age is a B10 operations item (keys only matter for retries).

**Authorisation.** Unchanged: the wrapped function re-checks role, venue and
grant on every call, including a replay's first run. A replay is served only
to the same actor.

**Migration and rollback.** One additive migration (the table, the guard, six
functions). Rollback: the client calls the old signatures again (they never
left); the table stays.

**Tests.**

- **Lost reply:** call with key K at revision N (succeeds, revision N+1).
  Call again with K, the same arguments and N: same result, `replayed:
true`, one event, revision still N+1.
- **Same key, other changes:** different arguments → `idempotency_key_reused`;
  another person (a second manager) → `idempotency_key_reused`.
- **Fresh key, stale revision** → `amenity_conflict` (a genuine conflict
  still says so).
- **Each of the six commands**, including `add_checks` returning the same ids.
- **Old signatures** work unchanged (the existing amenities suites run
  unmodified).
- **Lost grant or account:** a deactivated account gets `not_active_user`,
  even on a replay. An active caller whose grant has since ended gets the
  stored result of the write it already made (no new effect); a new key is
  refused as today.

**Owner decisions.** None.

### R11. Draft-save guard (reviewer L-b)

**Need.** UI §8.10 L-b. A draft save that was in flight when the person sent,
and reaches the server after the send's delete (CA-01), recreates a draft of
work already sent. The client should learn "already sent" and clear its
device copy.

**Shape.**

- **A "my latest send" time, defined once.** For a caller and a check it is
  the newest `created_at` among:
  - the caller's `knowledge_contributions` on the check (any kind, answer or
    outcome); and
  - the caller's `amenity_submissions` on the check with
    `source_contribution_id is null` (legacy answers only).

  An adoption is **not** a send. `knowledge_adopt` inserts a submission
  under the contributor's name at the adoption time, and that row carries
  `source_contribution_id`, so it is excluded. The value lives in a private
  helper used by both the read and the guard.

- **Where the client gets it (M3):** `knowledge_check` gains the own-data
  key **`mySentAt`** (the value above for the caller, or null). Only the
  caller's own time is exposed. The send's result gains **`sentAt`** (that
  contribution's `created_at`).
- **New overload** of `public.knowledge_save_draft` with a **required**
  `p_base_sent_at timestamptz` (null allowed as a value). This is
  `knowledge_check.mySentAt` as the form loaded it, or the `sentAt` of a
  send made from the same form.
- **Refusal** `draft_already_sent`, SQLSTATE **`NLK09`**, with detail
  `{reason, sentAt}`, when either:
  - `reason = 'key_sent'`: `knowledge_commands` already has a `submit` by
    this caller with the save's `p_idempotency_key`; or
  - `reason = 'newer_send'`: the caller's latest send time on this check
    (above; adoptions excluded) is later than `p_base_sent_at`, or exists at
    all when `p_base_sent_at` is null. `sentAt` is that time.
- The guard runs **before** the draft-revision check, so a late save gets
  `draft_already_sent` rather than `draft_conflict` (its draft was deleted by
  the send).
- **The old signature** is replaced with a body that adds only the `key_sent`
  test (it has no base). This narrows the race for old clients without
  blocking anything legitimate.
- **TS:** a new `KnowledgeErrorCode` `draft_already_sent` (409, never
  retryable), mapped by message or `NLK09`. Old clients that don't know it get
  B01's default for an unknown `NL` code, `state_conflict` (reload), which is
  safe.

**Edge cases.**

| Case                                                                                      | Result                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person sends, then starts a new draft on the same question (fresh page or refreshed form) | The form's base is that send's `sentAt`, so nothing is newer and the save is allowed. **Not blocked.**                                                                                                                |
| Same form stays open after sending and the person starts again                            | The client takes `sentAt` from the send's own result (additive key) and uses it as the new base                                                                                                                       |
| The person's proposal is adopted later by a manager                                       | The adoption's submission has `source_contribution_id` and is not a send, so a draft with base = the proposal's `sentAt` (or the reloaded `mySentAt`) is allowed                                                      |
| A manager confirms or declines the person's finding                                       | Decisions are not sends; nothing changes                                                                                                                                                                              |
| A save sent before the send but processed after it (L-b)                                  | Its base predates the send → `newer_send` → refused; nothing is written                                                                                                                                               |
| A save carrying the send's own key (the form saved, then sent with the same key)          | `key_sent` → refused; the UI says "This finding was already sent."                                                                                                                                                    |
| A second device sends while this device has the form open                                 | This device's next save is refused `newer_send` with the other send's `sentAt`. The UI says "You sent a finding on {date}. Start a new draft to change it."; "Start a new draft" saves with that `sentAt` as the base |
| The send was replayed (same key)                                                          | No new contribution, so no new time; nothing changes                                                                                                                                                                  |
| Someone else sends on the question                                                        | Not counted: only the caller's own sends are compared                                                                                                                                                                 |
| The caller answered through the legacy path (question off the list)                       | Counted as a send (CA-01 also deletes the draft there)                                                                                                                                                                |
| Clock or ordering                                                                         | Times are the database's own `created_at` for both the send and the base, never the device clock. Equal times count as not newer                                                                                      |
| Transfer to another venue                                                                 | Unchanged: the check is not found for the caller, as today                                                                                                                                                            |

**Migration and rollback.** In batch B02-a, in a new migration:

- the new overload;
- a `create or replace` of the old `knowledge_save_draft` (key guard only);
- `create or replace` of `knowledge_submit` (additive `sentAt`) and of
  `knowledge_check` (additive `mySentAt`).

Rollback: the client calls the old signature, and a later migration restores
the B01 bodies.

**Tests.**

- **L-b:** save with base null and key K1; send with key K2; a late save with
  base null → `draft_already_sent` / `newer_send`; no draft row exists.
- **Key:** after sending with K, a save with K and a fresh base →
  `draft_already_sent` / `key_sent`.
- **New draft after sending:** a save with base = the send's `sentAt` and a
  new key → allowed, `draftRevision` 1.
- **Second device:** refused with the other send's `sentAt`; a retry with
  that base is allowed.
- **Not blocked by others:** a colleague's send doesn't block my save.
- **Legacy answer:** counts as a send; its `sentAt` as base allows a new
  draft.
- **Adoption is not a send (M2):** a proposal adopted later by a manager, then
  a new draft with base = the proposal's `sentAt` → allowed. `mySentAt`
  still equals the proposal's send time after the adoption.
- **`mySentAt`:** equals the newest own contribution or legacy answer, and
  never shows another person's time.
- **Order:** a late save with a stale draft revision gets
  `draft_already_sent`, not `draft_conflict`.
- **Old signature:** only `key_sent` is enforced.
- **Unit:** `NLK09` maps to `draft_already_sent` (409) and is never retryable
  (the T14c loop covers the new code).

**Owner decisions.** None.
---

## 4. Writes

### W1. Contribution group (B02-05)

**Need.** UI §7: one acknowledgement for several images of one subject; each
asset keeps its own state. B05-01 later adds per-file state to the same model.

**Shape (WS1 owns these tables).**

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
- Reads: R5 `photo` rows carry `groupId`. For the manager review page, a new
  batch read `public.contribution_groups_for_assets(p_asset_ids uuid[])`
  returns `asset_id, group_id` for the ids the page already shows, so WS2 can
  show one card per group (UI §7). The existing queue read is not re-created.
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
- **Table owner:** WS1.

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

| #     | Decision                                                      | Today                       | Design default until decided                       |
| ----- | ------------------------------------------------------------- | --------------------------- | -------------------------------------------------- |
| OD-2  | Better-photo requests for items no longer on the menu         | Me shows them               | Returned with `canRetake: false`; not To do (D-13) |
| OD-3  | Name the reviewer on a better-photo request                   | Reason shown, reviewer not  | Not named                                          |
| OD-4  | My contributions order: send time or latest activity          | n/a                         | Send time (stable cursor)                          |
| OD-5  | Link a menu retake to the photo it replaces                   | No link                     | No link; consider in B05-01                        |
| OD-6  | Use claims beyond "Accepted for menu use"                     | None exist                  | None                                               |
| OD-7  | One group per asset; maximum group size                       | No groups                   | One group; 10 members                              |
| OD-8  | Record the uploader's role on new uploads (if W3)             | Not recorded                | Add a nullable snapshot column                     |
| OD-9  | Manager uploads in colleagues' Photos (if W3)                 | n/a (managers don't upload) | Not shown                                          |
| OD-10 | Show the delete impact (R9) to admins deleting in the Library | No warning for anyone       | Uploader only                                      |

---

## 7. Migration plan and rollback

Each batch is a new migration file after the B01 freeze, additive, with a
rollback note. None edits a B01 migration.

| Batch | Contents                                                                                                                                                                                   | Rollback                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| B02-a | New: R1, R3, R5, R8 and R9 functions, the R9 helper, the R10 table and keyed overloads, the R11 overload and send-time helper, any R5 index. Re-created: the four functions listed in §7.1 | Drop the new objects; restore the B01 bodies of the §7.1 functions; the client calls the old signatures; UI switches off |
| B02-b | New: W1 tables, their append-only guard, and the four group functions. Re-created: none                                                                                                    | UI switches off; tables stay (no data loss)                                                                              |
| B02-c | W3 and W4, **only after Q1 and Q4 are decided**. Re-created: the gates listed in §7.2                                                                                                      | Restore the staff-only gates; uploads and labels already made stay                                                       |

### 7.1 Every existing function re-created in B02-a

Each is a `create or replace` with the same signature, owner and grants, in a
new migration.

| Function                                    | Change                                                                                                                                                                                      | Behaviour otherwise            | Tests that pin it                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `public.knowledge_to_confirm` (B01)         | Additive `waitingSince` on every item; items ordered by it. Findings keep their order; `evidence_withdrawn` and `confirmation_revoked` rows move to their event time (a visible change, R4) | Identical otherwise            | `knowledge-screens.test.ts`, `knowledge-confirm.test.ts` screen reads, `tests/ui/knowledge-to-confirm.test.tsx` |
| `public.knowledge_check` (B01)              | Additive own-data `mySentAt`                                                                                                                                                                | Identical                      | `knowledge-confirm.test.ts` screen reads, `knowledge-screens.test.ts`, `knowledge-capture.test.ts`              |
| `public.knowledge_submit` (B01)             | Additive `sentAt` in the result                                                                                                                                                             | Identical; no credit input     | `knowledge-contribute.test.ts`, `knowledge-credit.test.ts` (C1 to C23), `knowledge-legacy-guard.test.ts`        |
| `public.knowledge_save_draft` (B01, 5 args) | Refuses a save whose key is an already-recorded send (`draft_already_sent`, `key_sent`)                                                                                                     | Identical for every other save | `knowledge-contribute.test.ts` drafts (T3) and CA-01 blocks                                                     |

**Not re-created in any B02 batch,** because the reads call or restate the
existing predicates instead:

- `media_assets_amenity_evidence_lost`: a credit input, pinned by C13 and the
  credit baseline in `completion-targets.test.ts`;
- `media_assets_knowledge_evidence_withdrawn`;
- `save_media_labels_as`;
- the coverage manager-deny triggers (`deny_manager_coverage_writes`);
- `manager_menu_photo_queue` and `manager_menu_photo_overview`;
- `venue_coverage_summary`;
- the six legacy check writes (R10 wraps them unchanged).

The integration credit-function hash check confirms it for each batch.

### 7.2 Gates re-created in B02-c (only after Q1 and Q4)

These **change behaviour by design**, for manager accounts only:

- `private.uploadable_venue_id`;
- `public.reserve_media_asset`;
- `private.can_upload_media_object` and its storage insert policy;
- the trigger function behind `guard_media_original_write`;
- `private.save_media_labels_as`;
- `public.stage_media_labels`;
- the `media_pending_labels` RLS policies;
- the community functions, only if OD-9 says manager uploads appear in Photos.

For staff, staff with a grant and admins they stay identical. That is pinned
by:

- `tests/security/access.test.ts:526-552`;
- `tests/security/labels-db.test.ts:133`, `:219` and `:295`;
- `tests/security/amenities.test.ts`, run unmodified.

The manager-account refusal tests (`manager-denials.test.ts:181`, `:197`,
`:232`, `:261`, `:295`, `:310`; `tests/unit/labels-refuse-manager.test.ts`;
`tests/integration/manager-boundary.test.ts:171`, `:199`) are updated
explicitly, in the same change, to the owner's decision.

### 7.3 Checks for every batch

Every batch runs, on a spare stack after a full-chain reset:

- the full security suites;
- the B01 knowledge suites;
- the credit baseline and C-tests;
- the credit-function hash check;
- the T9b and T11a compatibility guards.

### 7.4 Timing to measure before B10

- **My contributions waiting rows.** Each photo row on a page calls
  `private.menu_photo_pending_tuples(venue, false, true)` for the photo's
  venue (the own-only waiting set), so a 20-row page of photos runs that
  read up to 20 times. Each call is bounded by one venue's active menu and the
  caller's own labels. Measure a full page on a seeded venue with a large menu
  before B10; if it is slow, compute the caller's waiting set once per page
  and pass it to the photo helper.

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

**Draft 2 (9 Nov 2026):** answers WS2's revisions 3 and 4.

- New §3a:
  - **R9:** delete impact for a photo (audit HM-04), uploader only,
    predicted with the triggers' own predicates and tested by deleting
    afterwards.
  - **R10:** request keys for the six legacy check writes (audit MG-01),
    using B01's command pattern, with the old signatures kept.
  - **R11:** the draft-save guard `draft_already_sent` (`NLK09`; reviewer
    L-b), with its edge cases.
- R1 now states Me's rule (D-12), and R2 notes D-13.
- New OD-10. The migration plan places R9, R10 and R11 in batch B02-a.

**Draft 3 (9 Nov 2026):** the design gate's requested changes.

- **M1:** R9 predicts `needs_recheck` first (in or out of scope), then
  `withdrawn`, then `none`. The working-list fixture is split into sole
  photo and photo-to-spare.
- **M2:** R11 counts only contributions and legacy answers as sends. An
  adoption's submission (`source_contribution_id` set) is not one; a test
  covers a proposal adopted later.
- **M3:** `knowledge_check` gains `mySentAt`, the base for
  `p_base_sent_at`.
- **L1:** `yours: false` items carry the question text, one item per answer
  or finding. Other people's undecided findings using the photo are listed,
  without names.
- **L2:** §7 names every re-created function per batch, with the tests that
  pin it. R3, R8 and R9 call or restate the existing predicates, so no
  trigger, label gate, coverage trigger or queue read is re-created; in
  particular, the credit-input trigger is left alone. W1's review grouping is
  a new read.
- WS1 owns the W1 tables.

**Draft 3, amendment (9 Nov 2026):**

- R3 records that the three reads it calls are `stable` (one snapshot), and
  adds them to the T9b-style catalogue assertion.
- R4 and §7.1 state the visible order change for `evidence_withdrawn` and
  `confirmation_revoked` rows.

**Approved for build (10 Nov 2026):** the R11 edge cases quote the UI copy
for `key_sent` and `newer_send` (WS2 revision 5).
