# B01 knowledge design (server side)

Status: design for review before any migration (revision 3: B00 exit-gate
items G1 to G10 and re-check items R1 and R3 addressed). Owner: WS1 knowledge domain. Tasks: B01-01,
B01-02, B01-03, B01-04 (server), plus the resolver and data that B01-05 (WS5
reader) and B01-06 (WS2 history) read. Source baseline: `f8c49430`.

Inputs: plan §6 and §16 and V01 to V05, V11, V12; the independent review of the
plan's claims (ten risks, indexed in §18); the B00 exit-gate review (G1 to G10,
indexed in §18); WS5's internal reader v1 contract
(`docs/knowledge/internal-reader-api.md`, `task/b01-ws5-reader` `0f2dde6b`);
WS2's B01 UI design (programme contracts folder). Companion contracts:
[state model](state-model.md), [identities](identities.md),
[access and rights](access-and-rights.md).

Source references: **AC** = `supabase/migrations/20261107120000_amenity_catalogue.sql`,
**TG** = `supabase/migrations/20261109120000_venue_monthly_completion_targets.sql`.

## 1. Design in one paragraph

Existing amenity checks, submissions and events stay as they are. A small set
of new append-only tables records what they cannot: proposals,
Couldn't-establish findings, change reports, requests for detail,
confirmations and other decisions, server drafts and the per-venue working
list. A finding becomes an `amenity_submissions` row, with its `submitted`
event, only when it is **adopted** as the venue's answer. That happens
automatically under the question's rule, or by a manager's decision. That one
choke point keeps target credit, the current answer and the assignee's work
truthful. One resolver function reduces each (venue, question) slot to
available or unavailable with a reason, an integer slot revision and an
allowlisted set of fields. The reader and the knowledge screens read only
that resolver. Every working-list slot must be written through the new path:
the legacy submit RPC refuses those slots, after its replay lookup and under
the check lock, so nothing reaches the answer silently. Turning a slot off the
working list restores today's behaviour exactly.

## 2. Data model

### 2.1 Existing tables: what changes

| Table                                               | Change                                                                                                                                                                                                           | Why it is safe                                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venue_amenity_checks`                              | None to schema. Written only by existing RPCs and the new adoption function, through the same transitions as today (answer, `complete`, `current_submission_id`, revision + 1).                                  | Its CHECK constraints (AC:66-72) are unchanged, so Unknown can never become `current_submission_id` or the answer.                                                                             |
| `amenity_submissions`                               | Three **nullable** columns for new rows only: `source_contribution_id uuid unique` (FK to `knowledge_contributions`), `redaction_confirmed boolean`, `submitter_basis text` (`staff`, `venue_manager`, `admin`). | `ADD COLUMN` without a default rewrites no row and fires no row trigger. Existing rows stay NULL ("not recorded"). The append-only triggers (AC:252-271) stay in force. Nothing is backfilled. |
| `amenity_submission_assets`, `amenity_check_events` | None. Event kinds unchanged.                                                                                                                                                                                     | Credit and the existing history UI read these (§3).                                                                                                                                            |
| `amenity_catalogue`                                 | None.                                                                                                                                                                                                            | —                                                                                                                                                                                              |
| `venue_amenity_facts`                               | None, and not read by the resolver (§5.4).                                                                                                                                                                       | —                                                                                                                                                                                              |

### 2.2 No enum widening in B01 (review risk 7)

The review states that the answer, progress and event-kind CHECKs and the
coupled constraints (AC:66-72) must be widened, with TS tolerant first,
**before writing Unknown into those tables**. B01 never writes Unknown or any
new state into them:

- Couldn't-establish findings are `knowledge_contributions` rows with
  `answer = 'unknown'`.
- New history goes to `knowledge_events`, not `amenity_check_events`.
- Slot statuses are derived.

So no released constraint is widened. The unchanged constraints become the
database proof that Unknown cannot reach `current_submission_id`:
`amenity_submissions.answer in ('yes','no','not_applicable')`, and the
check's coupled constraint ties `current_submission_id` to a non-`to_check`
answer. A test asserts both constraint definitions are byte-identical after
the B01 migrations.

If a later batch does need a wider enum, the order is fixed:

1. Make the TS contract (`lib/amenities/contract.ts`, views, chip maps) and
   every reader tolerant of the new value.
2. Release that.
3. Widen the constraint in a forward migration.
4. Only then write the value.

The new tables' own enums are defined in TS at the same time as their
migration.

### 2.3 New tables

All new tables are in `public`, with RLS enabled and every privilege revoked
from `anon` and `authenticated`. `service_role` gets `select` (tests and
operations). All reads and writes go through SECURITY DEFINER functions (§12).
"Append-only" means the existing `private.append_only_guard` triggers for
UPDATE, DELETE and TRUNCATE (pattern AC:252-271).

| Table                           | Purpose                                                                                        | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Mutability                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `knowledge_question_rules`      | Versioned rule per question key                                                                | `(question_key, rule_version)` PK; `confirmation` (`none`, `venue_manager`); `self_confirmation_allowed`; `unassigned_auto_complete`; `staff_text_internal` (reader may return finding and limitations); `redaction_required`; `created_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Append-only. The rule in force is the highest version. Seeded by migration only. |
| `knowledge_working_list`        | Which slots of which venue are in the pilot                                                    | `id`; `venue_id`; `question_key`; `enabled_at/by`; `disabled_at/by`; `reason`. Partial unique: one open row per (venue, key).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Insert, then one update setting `disabled_*` (guard rejects any other change)    |
| `knowledge_contributions`       | Every finding sent through the new path: proposals, Couldn't establish, change reports, detail | `id`; `venue_id`; `check_id` (FK `(check_id, venue_id)` → checks); `question_key`; `contributed_by`; `contributor_basis`; `kind` (`finding`, `change_report`, `detail`); `answer` (`yes`, `no`, `not_applicable`, `unknown`); `finding`; `limitations`; `reason` (No and Not applicable); `unknown_preset`; `tried_text`; `change_reason`; `responds_to_decision_id`; `based_on_slot_revision` (the slot revision the sender saw, §4.2); `based_on_submission_id`; `rule_version`; `template_version`; `evidence_rule`; `internal_metadata` (Wi-Fi test notes); `redaction_confirmed`; `confirm_own`; `initial_outcome` (`current`, `awaiting_confirmation`, `recorded`); `idempotency_key` unique; `request_hash`; `created_at` (the **send time**) | Append-only                                                                      |
| `knowledge_contribution_assets` | Evidence of a contribution                                                                     | `(contribution_id, asset_id)` PK; `venue_id`; `evidence_kind`; FK `(asset_id, venue_id)` → `media_assets` (upload-time venue, as AC:117)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Append-only                                                                      |
| `knowledge_decisions`           | Every decision about a contribution or a submission                                            | `id`; `venue_id`; `check_id`; `question_key`; exactly one of `contribution_id`, `submission_id`; `decision` (`adopted`, `confirmed`, `declined`, `revoked`, `detail_requested`, `seen`, `replaced`, `reaffirmed`); `decided_by` (NULL for a rule); `decider_basis` (`venue_manager`, `admin`, `self`, `rule`); `self_confirmed`; `rule_version`; `note`; `slot_revision` (as seen by the decider); `resulting_submission_id`; `idempotency_key` (unique per command); `request_hash`; `created_at`                                                                                                                                                                                                                                                   | Append-only                                                                      |
| `knowledge_events`              | Knowledge history and the event part of the slot revision                                      | `id bigint identity`; `venue_id`; **`question_key`** (not null); `check_id` (nullable); `kind` (`contribution_recorded`, `decision_recorded`, `working_list_enabled`, `working_list_disabled`, `rule_version_added`, `question_version_changed`, `evidence_withdrawn`, `assignment_closed_by_other`); `actor_id`; refs; `detail`; `created_at`. Index `(venue_id, question_key, id)`.                                                                                                                                                                                                                                                                                                                                                                | Append-only                                                                      |
| `knowledge_drafts`              | One unsent draft per person and check (WS2 default 2)                                          | `(user_id, check_id)` PK; `venue_id`; `draft_revision`; `payload jsonb` (a JSON object ≤ 16 KiB; B01 checks only its type and size, not its fields); `asset_ids uuid[]` (≤ 10); `idempotency_key`; `updated_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Mutable and deletable. Not history, never credited, never read by the resolver.  |
| `knowledge_outcome_dismissals`  | "Dismiss" on a closed-assignment row (S13)                                                     | `(user_id, event_id)` PK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | UI state only                                                                    |

Row checks on `knowledge_contributions`:

- `answer = 'unknown'` requires `unknown_preset` and `tried_text` (1 to 500
  characters).
- `no` and `not_applicable` require `reason`.
- `kind = 'change_report'` requires `change_reason`.
- `kind = 'detail'` requires `responds_to_decision_id`.
- `internal_metadata` is only allowed for `guest_wifi`.

Text limits match `amenity_submissions`. Unknown presets (WS2 default 1):
`no_one_sure`, `could_not_access`, `needs_access`, `other`.

**Slot revision (G3).** A slot is (venue, question key). Its revision is the
slot's check revision (0 when there is no check) plus the number of
`knowledge_events` with that `venue_id` and `question_key`
([state model §5](state-model.md#5-revisions)). Events are counted by key, not
by check, so a slot without a check is defined and a later check creation
still raises the revision.

**Definition changes write events (G3).** `private.knowledge_note_definition_change(p_question_key, p_kind)`
writes one `knowledge_events` row for every open working-list slot of that
key, in one statement, with kind `rule_version_added` or
`question_version_changed`. Every migration that inserts a rule version, and
every catalogue-version migration generated by
`scripts/db/amenity-catalogue-sql.ts`, calls it in the same transaction. The
generator change is part of B01. Test T9d covers it.

### 2.4 Rule seed (B00-04 defaults, owner to confirm)

| Key                                        | Confirmation  | Self-confirmation | Unassigned auto-complete | Staff text to internal reader | Redaction required |
| ------------------------------------------ | ------------- | ----------------- | ------------------------ | ----------------------------- | ------------------ |
| `onsite_parking`                           | none          | —                 | yes                      | yes                           | no                 |
| `step_free_entrance`                       | venue_manager | allowed           | no (confirmation needed) | yes                           | no                 |
| `guest_toilets`                            | none          | —                 | yes                      | yes                           | no                 |
| `guest_wifi`                               | none          | —                 | yes                      | **no**                        | **yes**            |
| `dogs_inside`, `dogs_outside` (fixtures)   | venue_manager | allowed           | no                       | yes                           | no                 |
| `sports_screen` (disputed-service fixture) | none          | —                 | yes                      | yes                           | no                 |

Rules are product configuration, not venue facts. A key enters a venue's
working list only if it has a rule. The Old Crown working list holds only the
four pilot keys. Fixture keys are enabled only at isolated fixture venues. The
seed migration calls `private.knowledge_note_definition_change` for each key
(a no-op at seed time, since no slot is in scope yet).

## 3. Credit compatibility (review points 1 and 10)

### 3.1 How credit is computed today

`private.monthly_venue_completion_counts` (TG:152-218), used by
`coverage_staff_progress_v2`, counts for a venue V, person P and London month
M:

> the number of distinct `check_id` over rows `s` of `amenity_submissions`
> with `s.venue_id = V`, `s.submitted_by = P`, `s.created_at` in M (and not
> in the future), where the latest `amenity_check_events` row for that check
> of kind `submitted`, `reopened` or `evidence_lost`, before the end of M,
> is `submitted` with `detail.submissionId = s.id`; and the latest
> `archived`/`restored` event before the end of M is not `archived`.

Consequences, confirmed against source and by the integration agent's measured
baseline:

- There is no filter on `answer`: Yes, No and Not applicable all count.
- Only `amenity_submissions` rows and those five event kinds affect credit.
  Event kinds outside that set are invisible to it.
- A later submission by anyone on the same check moves the credit away from
  the earlier submitter if both fall in the same month. Across months, the
  earlier month keeps its credit.
- A reopen or evidence loss in the same month removes the credit until the
  check is completed again. Archive suspends credit and restore brings it
  back.

### 3.2 What B01 writes, by outcome

| Outcome                                                                                                                            | `amenity_submissions` row                  | `submitted` event | Other counted events      | Credit effect                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yes, No or Not applicable adopted automatically (staff, open slot, confirmation-free rule)                                         | Yes, `submitted_by` = contributor          | Yes               | —                         | Counted under the existing rule, in the adoption month (= send month)                                                                                                                                                                                                 |
| Yes, No or Not applicable adopted by a manager's Confirm or conflict choice                                                        | Yes, `submitted_by` = contributor          | Yes               | —                         | Counted in the **adoption** month, not the send month                                                                                                                                                                                                                 |
| **Manager or admin captures directly** on a confirmation-free question that already has a current answer (outcome `current`, §4.2) | Yes, `submitted_by` = the manager or admin | Yes               | —                         | Credit moves from the earlier submitter to the capturer in the same month (existing rule, identical to a manager re-answering today). A manager **account** is not a staff participant and gets no credit row; a staff account with a transitional grant is credited. |
| Couldn't establish (`unknown`)                                                                                                     | **No**                                     | **No**            | —                         | Never counted                                                                                                                                                                                                                                                         |
| Spontaneous proposal, not yet decided                                                                                              | No                                         | No                | —                         | None                                                                                                                                                                                                                                                                  |
| Pending confirmation (confirmation-required rule)                                                                                  | No                                         | No                | —                         | None                                                                                                                                                                                                                                                                  |
| Declined                                                                                                                           | No                                         | No                | —                         | Never counted                                                                                                                                                                                                                                                         |
| Detail requested, then detail sent                                                                                                 | No (until adopted)                         | No                | —                         | None until adopted                                                                                                                                                                                                                                                    |
| Change report, pending                                                                                                             | No                                         | No                | —                         | Current answer's credit unchanged                                                                                                                                                                                                                                     |
| Seen, keep in use                                                                                                                  | No                                         | No                | —                         | None; current answer's credit unchanged                                                                                                                                                                                                                               |
| Reopen (existing RPC, or a decline of a current unconfirmed answer, §9.4)                                                          | —                                          | —                 | `reopened`                | Existing rule: removes the reopened submission's credit if in the same month                                                                                                                                                                                          |
| Confirmation revoked                                                                                                               | —                                          | —                 | none                      | **No change** (B08)                                                                                                                                                                                                                                                   |
| Dispute opened or resolved by keeping the answer                                                                                   | —                                          | —                 | none                      | **No change** (B08)                                                                                                                                                                                                                                                   |
| Evidence withdrawn on any answer that the legacy trigger does not move to recheck (§10)                                            | —                                          | —                 | none (no `evidence_lost`) | **No change** (B08)                                                                                                                                                                                                                                                   |
| Working list disabled or enabled                                                                                                   | —                                          | —                 | none                      | **No change**                                                                                                                                                                                                                                                         |

**Supersession paths (G1).** A credited current answer can lose its credit to
a later submission in the same month in exactly three B01 ways. Each is
today's "a later submission moves credit" rule; none is new:

1. **Adoption by a manager decision** (Confirm, or a conflict choice) of
   another person's finding while an answer is current.
2. **A manager or admin capturing directly** on a confirmation-free question
   that already has an answer. This is the same act as today's Capture myself
   or manager re-answer.
3. **Automatic adoption on a `needs_recheck` slot.** Here the earlier
   submission's same-month credit was already removed by the reopen or
   evidence loss that put the slot in recheck, so nothing further moves.

Automatic adoption never happens while an answer is current, so a staff
member's own send can never wipe someone else's credit. A Couldn't-establish
finding, a change report, a proposal, a `seen` mark or `keep_in_use` writes
neither a submission nor a progress event, so it can neither earn credit nor
remove anyone's.

### 3.3 Proof that new outcomes cannot change credit

1. The credit function reads exactly two relations: `amenity_submissions`
   and `amenity_check_events`. It also reads the policy and membership
   tables, which B01 does not touch.
2. B01 inserts into `amenity_submissions` in exactly one place, the private
   adoption function (§4.3). It runs only for a contribution whose answer is
   Yes, No or Not applicable, and only when the rule or a manager decision
   adopts it. A manager's or admin's direct capture is also a contribution
   adopted under the rule (§4.2). The unchanged answer CHECK makes any other
   insert fail.
3. B01 inserts `amenity_check_events` rows of kinds `submitted` (adoption
   only) and `reopened` (a manager's reopen, through the existing reopen
   logic). It inserts no `evidence_lost`, `archived` or `restored` rows
   beyond what existing RPCs and triggers already write.
4. Every other B01 write goes to `knowledge_*` tables. They are append-only
   and not read by the credit function.
5. So for any history, adding Couldn't-establish findings, undecided or
   declined proposals, change reports, detail requests, confirmations,
   revocations, reaffirmations, `seen` marks, `keep_in_use` decisions,
   drafts or working-list changes leaves every `coverage_staff_progress_v2`
   value unchanged.
6. The only credit-relevant B01 actions are adoption (equivalent to a finding
   submitted under today's rule) and reopen (equivalent to today's manager
   reopen). Adoption supersedes an earlier credited submission only through
   the three paths in §3.2, each of which is today's rule.

This assumes, as the orchestrator instructed, that there is no answer-value
filter. Source and the measured baseline confirm it (§3.1).

### 3.4 Deferred to B08 (review point 10)

Until B08 changes scoring, these do **not** remove credit already counted:
confirmation revocation, an open or resolved dispute, evidence withdrawal on
an answer the legacy trigger does not move to recheck, and a working-list
change. A reopen, or a Yes answer's evidence loss under the legacy trigger, in
the same month removes credit, exactly as today. Credit is counted in the
adoption month, and a later adoption or direct capture can move credit within
a month (§3.2). Those are existing rules, and B08 may change them. WS2's
recognition line follows the server: `scored` rows keep their line after such
changes.

### 3.5 Per-finding recognition (WS2 S3, S5, S14)

`private.knowledge_submission_scored(submission_id)` applies the credit
function's predicate to one submission in its creation month. It returns
`scored` with the period, or not scored. Recognition:

- `none` when the venue has no completion-target policy that month, or the
  person is not a participant;
- `scored` per the predicate;
- `not_scored` for Couldn't establish and declined findings;
- `pending` for undecided proposals.

A test asserts that, for every fixture person and month, the number of their
`scored` submissions equals `amenity_checks_completed` from
`coverage_staff_progress_v2`. That stops the two drifting apart.

### 3.6 Regression tests on `coverage_staff_progress_v2`

These are DB-level tests on an isolated stack, with a fixture venue under a
completion-target policy. Each one records `amenity_checks_completed` and
`completion_count` before and after, for the contributor, any earlier
submitter, and the current and previous month.

| #   | Scenario                                                                                                 | Expected                                             |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| C1  | Unassigned staff A, Yes with evidence, auto-adopted                                                      | +1 for A                                             |
| C2  | Same with No (reason)                                                                                    | +1                                                   |
| C3  | Same with Not applicable (reason)                                                                        | +1                                                   |
| C4  | Couldn't establish                                                                                       | 0 for everyone                                       |
| C5  | Proposal on an assigned-to-other slot, undecided                                                         | 0                                                    |
| C6  | `step_free_entrance` finding, pending confirmation                                                       | 0                                                    |
| C7  | C6 then declined                                                                                         | 0                                                    |
| C8  | C6 then confirmed in the same month                                                                      | +1 for contributor, not the manager                  |
| C9  | C6 sent on the last day of a month, confirmed the next month                                             | 0 in the send month, +1 in the confirmation month    |
| C10 | C1 then reopened in the same month                                                                       | back to 0 (existing rule)                            |
| C11 | C1 then reopened next month                                                                              | the earlier month stays +1                           |
| C12 | C8 then confirmation revoked                                                                             | stays +1 (B08 deferral)                              |
| C13 | C2 then its evidence deleted                                                                             | stays +1; slot `withdrawn` / `evidence_withdrawn`    |
| C14 | C1, then a contradicting change report                                                                   | stays +1; slot `disputed`                            |
| C15 | C1 by A, then a proposal by B adopted in the same month                                                  | A 0, B +1 (existing "later submission moves credit") |
| C16 | Working list disabled after C1                                                                           | unchanged                                            |
| C17 | Detail requested on a proposal, detail sent, then confirmed                                              | +1 once, for the detail's author                     |
| C18 | The same request retried 3 times (same key)                                                              | +1 once                                              |
| C19 | Menu-photo credit for the same person across C1 to C18                                                   | unchanged                                            |
| C20 | Per-finding `scored` count equals `amenity_checks_completed`                                             | equal for all fixtures                               |
| C21 | C1, then a manager on a staff account with a transitional grant captures directly in the same month (G1) | A 0, manager +1                                      |
| C22 | C1, then a manager **account** captures directly in the same month                                       | A 0; the manager account has no credit row           |
| C23 | C4 by A on a slot answered by B, then `seen`, then `keep_in_use` on a later report                       | B's credit unchanged throughout                      |

## 4. No silent overwrite (review point 2)

### 4.1 All working-list writes use the new path (legacy guard, G2)

`public.amenity_submit_finding` is replaced (`CREATE OR REPLACE`, same
signature, owner and grants) by a version with one added guard. Everything
else, in this order, is today's code (AC:1335-1488):

1. Answer and key validation, the advisory lock on the idempotency key, and
   the **replay lookup** (AC:1378-1388). A replay of a key recorded before the
   slot entered the working list still returns its original result. The guard
   never blocks a replay.
2. Readable check, `amenity_can_submit`, asset-list validation.
3. Asset rows FOR SHARE, then the check row **FOR UPDATE** (AC:1409), the
   repeated `amenity_can_submit`, the active-venue check.
4. **The guard, here.** If the check's (venue, key) has an open
   `knowledge_working_list` row, raise `knowledge_path_required` with
   **SQLSTATE `NLK01`**. It runs in a statement after the check lock was
   granted, so under READ COMMITTED it sees any working-list row committed
   before the lock.
5. The rest unchanged, plus storing `redaction_confirmed` and
   `submitter_basis` on the new row (§8).

`knowledge_set_working_list` (enable and disable) locks every affected check
row FOR UPDATE, in check id order, before it writes the working-list row and
its events. A legacy submission and an enablement on the same check therefore
serialise:

- the submission commits first, and it is then an ordinary answer recorded
  before the slot entered scope, which the resolver reads normally; or
- the enablement commits first, and the waiting submission meets the guard.

There is no window in which a legacy write lands on an in-scope slot.

**Error mapping (R1).** Every new knowledge error has its own SQLSTATE in the
`NL` class, reserved for NabaLens knowledge errors. That class is not
PostgREST's `PT` class and not the generic `P0001`. The server maps errors by
message or by SQLSTATE in `lib/server/amenities/errors.ts` (legacy RPCs) and
`lib/server/knowledge/errors.ts` (knowledge RPCs). Today an unmapped `P0001`
becomes `unavailable`, and the capture form retries `unavailable` (its
`RETRYABLE` set, `capture-form.tsx:92`), so an unmapped refusal would loop.

**General rule:** every `NL`-class SQLSTATE and every new knowledge error code
maps to a non-retryable code (status 4xx, never in `RETRYABLE`), never to
`unavailable`. An `NL`-class SQLSTATE without a specific entry (for example
one added later) maps to `state_conflict` (409, reload), not `unavailable`.

| Database error (message)                                              | SQLSTATE | Raised by                                                                  | TS code                                                 | Status | Retryable |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | ------ | --------- |
| `knowledge_path_required`                                             | `NLK01`  | Legacy `amenity_submit_finding` on an in-scope slot (§4.1)                 | `knowledge_path_required` (added to `AmenityErrorCode`) | 409    | No        |
| `knowledge_slot_out_of_scope`                                         | `NLK02`  | `knowledge_submit` and adopting decisions on a disabled slot (§9.5)        | `knowledge_slot_out_of_scope`                           | 409    | No        |
| `already_decided`                                                     | `NLK03`  | A decision on a contribution with a terminal decision (§9.1)               | `already_decided`                                       | 409    | No        |
| `self_confirmation_not_permitted`                                     | `NLK04`  | Self-confirmation the rule forbids, including `p_confirm_own` (§4.2, §9.1) | `self_confirmation_not_permitted`                       | 403    | No        |
| `draft_conflict`                                                      | `NLK05`  | `knowledge_save_draft` with a stale draft revision (S4)                    | `draft_conflict`                                        | 409    | No        |
| `knowledge_venue_not_found`                                           | `NLK06`  | `knowledge_reader_answers_v1` (§5.3)                                       | WS5 maps it to `404 venue_not_found`                    | 404    | No        |
| any other `NL`-class SQLSTATE                                         | `NLKxx`  | —                                                                          | `state_conflict`                                        | 409    | No        |
| `amenity_conflict` (existing; also a stale `p_slot_revision`, §4.2)   | `P0001`  | Existing RPCs and every knowledge command                                  | `revision_conflict` (existing mapping)                  | 409    | No        |
| `idempotency_key_reused` (existing)                                   | `P0001`  | Existing RPCs and every knowledge command                                  | `state_conflict` (existing mapping)                     | 409    | No        |
| `not_venue_manager` (existing; also `p_confirm_own` from staff, §4.2) | `42501`  | Existing RPCs and knowledge decisions                                      | `not_permitted` (existing mapping)                      | 403    | No        |

The knowledge codes are defined in `lib/knowledge/contract.ts`.
`knowledge_path_required` is also added to `AmenityErrorCode` in
`lib/amenities/contract.ts`, because the legacy capture form receives it. The
person-facing copy for each code is WS2's (UI design §3.1 for
`knowledge_path_required`: "Open the question again", never "Try again").

The legacy reopen, assign, archive, restore and notes RPCs keep working on
pilot slots. The existing `tests/security/amenities*.test.ts` must pass
unmodified.

### 4.2 Outcome of a new-path finding

`public.knowledge_submit(...)` (S3) decides the outcome on the server, under
the locks of §4.4:

1. Idempotency replay lookup first (§11). A replay returns the original
   result, whatever has changed since.
2. **Slot revision check (G4).** `p_slot_revision` is the slot revision (check
   revision plus the slot's knowledge events), not
   `venue_amenity_checks.revision`. If it differs from the current slot
   revision, raise `amenity_conflict` with the current slot revision in
   `detail`. Nothing is recorded: no contribution, no decision, no event.
3. Eligibility (§12), then the outcome:

| Caller                                     | Slot state                                                                            | Rule                                                                     | Outcome                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Staff, unassigned slot or assigned to them | Open (no current answer, or `needs_recheck`), no undecided proposal from someone else | confirmation `none` and `unassigned_auto_complete`                       | `current`: adopted at once                                                                                          |
| Staff                                      | Open, assigned to **someone else**                                                    | any                                                                      | `awaiting_confirmation` (proposal)                                                                                  |
| Staff                                      | Current answer exists (complete)                                                      | any                                                                      | `awaiting_confirmation`, as a change report or proposal. Never replaces it.                                         |
| Staff                                      | any                                                                                   | confirmation required                                                    | `awaiting_confirmation`                                                                                             |
| Staff                                      | Open, someone else's undecided proposal exists                                        | confirmation `none`                                                      | `awaiting_confirmation`, so the manager compares (WS2 §3)                                                           |
| Manager or admin                           | Open, or a current answer exists                                                      | confirmation `none`                                                      | `current`: manager authority, as today's Capture myself (credit effect: §3.2, G1)                                   |
| Manager or admin                           | any                                                                                   | confirmation required, `p_confirm_own = true`, self-confirmation allowed | `current`: adopted and self-confirmed in one transaction, recorded `self_confirmed`                                 |
| Manager or admin                           | any                                                                                   | confirmation required, `p_confirm_own = false`                           | `awaiting_confirmation`                                                                                             |
| Anyone                                     | any                                                                                   | answer `unknown`                                                         | `recorded`. Never adopted; the assignment is unchanged. With a current answer it is sent as a change report (§9.2). |

**`p_confirm_own` rules (G5).**

- From a staff caller (no manager or admin authority at the venue): refused
  with `not_venue_manager`.
- Where the rule requires confirmation and forbids self-confirmation: refused
  with `self_confirmation_not_permitted`. It is never silently turned into
  `awaiting_confirmation`.
- On a confirmation-free key: ignored. The outcome is the same as with
  `false`.
- It is always part of `request_hash`, as given. A retry that changes it is
  `idempotency_key_reused`.

A spontaneous finding therefore never reaches `answer` or
`current_submission_id` while an answer is current or confirmation is
required. It also never takes another person's assignment.

### 4.3 Adoption (the only path into `amenity_submissions`)

`private.knowledge_adopt(contribution, decider, locked_check)` is called with
the check row the caller has already locked (§4.4). It never takes locks in
another order. It runs in the caller's transaction:

1. Refuse unless the check is active and the venue active.
2. Re-check every asset (`private.amenity_asset_ineligibility`, with the
   contributor as owner) and the evidence rule for Yes. Evidence deleted since
   sending refuses adoption with `evidence_not_eligible`.
3. Insert the `amenity_submissions` row:
   - `submitted_by` = the contributor;
   - `created_at` = now (adoption time; never presented as observation time);
   - `template_version` and `evidence_rule` from the contribution;
   - `internal_metadata` and `redaction_confirmed` copied;
   - `source_contribution_id` and `submitter_basis` set;
   - a fresh `idempotency_key`;
   - `result_revision` = check revision + 1.

   Then insert asset rows copied from the contribution.

4. Update the check exactly as `amenity_submit_finding` does today:
   - `answered_by` = contributor;
   - `answered_at` = now;
   - `complete`;
   - `current_submission_id`;
   - `recheck_reason` = null;
   - revision + 1.
5. Insert the `submitted` check event with `{submissionId, answer,
contributionId}`. Insert decision `adopted`, plus `confirmed` when the rule
   requires it and the decider confirmed. Write the knowledge events. If the
   check had an assignee other than the contributor, write
   `assignment_closed_by_other` (§6).

### 4.4 Lock order (G7)

Every knowledge command that can change a slot takes its locks in this order,
matching AC (`amenity_submit_finding`, AC:1398-1409) and the evidence-lost
trigger (AC:614-651, which locks the check after the asset row is updated):

1. The caller's own `profiles` row **FOR SHARE** (§7).
2. The idempotency-key advisory lock and replay lookup.
3. The evidence assets involved **FOR SHARE**, in asset id order: the
   command's own assets for `knowledge_submit`; the target contribution's
   assets for an adopting decision.
4. The check row **FOR UPDATE**.
5. The slot revision check (§4.2, §9.1), then the decision logic, passing the
   locked check into `private.knowledge_adopt`.

`knowledge_set_working_list` takes only check locks (id order). Non-adopting
decisions lock the profile and the check. No function locks a check and then
an asset.

## 5. One resolver (review point 5)

### 5.1 Name and callers

| Function                                                                                               | Role                                                                                                                                                                         | Callers                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `private.knowledge_slot_state(p_venue_id uuid, p_keys text[])`                                         | **The single resolver.** One row per requested key. `LANGUAGE sql STABLE`, one statement.                                                                                    | Only the SECURITY DEFINER wrappers below. No grants to any client role. |
| `public.knowledge_reader_answers_v1(p_venue_id uuid, p_keys text[])`                                   | The reader's entry point, with the reader allowlist applied (§5.3). **`LANGUAGE plpgsql STABLE`** (G10): it raises `knowledge_venue_not_found`, which a SQL function cannot. | WS5 server route only. Granted to `service_role` only.                  |
| `public.knowledge_working_list()`, `public.knowledge_check(uuid)`, `public.knowledge_to_confirm(uuid)` | Screen reads (S1, S2, S6) built on the resolver, with audience fields. `STABLE`.                                                                                             | `authenticated`                                                         |

Nothing that serves knowledge answers reads `venue_amenity_checks`,
`amenity_submissions` or `venue_amenity_facts` except through the resolver.
The legacy amenity screens keep their own reads; they are not knowledge
consumers.

### 5.2 Resolver columns

| Column                                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venue_id`, `question_key`, `check_id`                                    | Slot identity. `check_id` is null when the venue has no check for the key.                                                                                                                                                                                                                                                                                              |
| `in_scope`                                                                | An open working-list row exists                                                                                                                                                                                                                                                                                                                                         |
| `status`                                                                  | `available` or `unavailable`                                                                                                                                                                                                                                                                                                                                            |
| `reason`, `detail`                                                        | WS5 vocabulary ([state model §4.5](state-model.md#45-current-answer-status)); null when available                                                                                                                                                                                                                                                                       |
| `revision`                                                                | `bigint` slot revision: check revision (or 0) + `knowledge_events` for (venue, key) ([state model §5](state-model.md#5-revisions))                                                                                                                                                                                                                                      |
| `question_version`                                                        | The current submission's `template_version`, else the catalogue version                                                                                                                                                                                                                                                                                                 |
| `value`                                                                   | `yes`, `no`, `not_applicable` when available; else null                                                                                                                                                                                                                                                                                                                 |
| `current_submission_id`, `current_contribution_id`                        | Opaque provenance IDs. The second is null for submissions made before B01 and for direct legacy-path submissions.                                                                                                                                                                                                                                                       |
| `contribution_kind`                                                       | Which ID identifies the current answer: `'contribution'` when `current_contribution_id` is set (a B01-era finding, adopted from a contribution), `'submission'` when only `current_submission_id` is set (made before B01 or through the legacy path). Null when there is no current answer. The name and values match WS5's reader (`task/b01-ws5-reader` `8a13fa23`). |
| `source_basis`                                                            | `staff`, `venue_manager`, `admin`, or null (not recorded, before B01)                                                                                                                                                                                                                                                                                                   |
| `finding`, `limitations`, `reason_text`                                   | The current submission's staff text. **Null when the rule's `staff_text_internal` is false** (`guest_wifi`).                                                                                                                                                                                                                                                            |
| `confirmation_required`, `confirmation_state`                             | `not_required`, `pending`, `confirmed`, `revoked`                                                                                                                                                                                                                                                                                                                       |
| `confirmation_basis`, `confirmation_self`, `confirmation_saved_at`        | Role (`venue_manager`, `admin`), the self-confirmed flag, and the decision's save time. Never a person.                                                                                                                                                                                                                                                                 |
| `evidence_photos`, `evidence_videos`, `evidence_state`                    | Counts of available attached assets; `none_attached`, `complete`, `withdrawn`                                                                                                                                                                                                                                                                                           |
| `redaction_proof`                                                         | `recorded`, `not_recorded` (redaction-required keys), `not_applicable`                                                                                                                                                                                                                                                                                                  |
| `saved_at`                                                                | The current submission's `created_at`: when it was adopted as the answer                                                                                                                                                                                                                                                                                                |
| `sent_at` (G10)                                                           | When the person sent the finding behind the current answer: the contribution's `created_at`. Equal to `saved_at` for submissions made before B01 and for direct legacy-path submissions. For screens; the reader wrapper drops it unless WS5 adds a field for it.                                                                                                       |
| `observed_at`                                                             | Always null in B01                                                                                                                                                                                                                                                                                                                                                      |
| `next_check_due`, `freshness_state`                                       | Null and `unrated` (no expiry in B01)                                                                                                                                                                                                                                                                                                                                   |
| `pending_count`, `open_dispute`, `last_unknown_at`, `last_unknown_preset` | Workflow summaries for screens. The reader wrapper drops them.                                                                                                                                                                                                                                                                                                          |
| `rule_version`                                                            | The rule in force                                                                                                                                                                                                                                                                                                                                                       |

### 5.3 Reader wrapper

`knowledge_reader_answers_v1`:

- raises `knowledge_venue_not_found` (the reader's `404 venue_not_found`) when
  the venue does not exist, is inactive, or has no open working-list row;
- then returns, in a single `RETURN QUERY` over the resolver, only the columns
  in the [internal allowlist](access-and-rights.md#3-internal-audience-allowlist-per-key),
  which include `current_contribution_id`, `current_submission_id` and
  `contribution_kind`;
- returns no names, user IDs, notes, internal metadata, asset IDs or
  idempotency keys, and none of the workflow summaries or `sent_at`;
- **accepts an empty `p_keys` array** (WS5 `61e699de`: the reader always calls
  it, with an empty list when nothing permitted was requested). It still runs
  the venue check first, so an unknown or inactive venue, or one with no open
  working-list row, raises `knowledge_venue_not_found` (`NLK06`). Otherwise it
  returns zero rows. A `NULL` `p_keys` is treated as empty.

### 5.4 Algorithm and legacy mapping

For each requested key, in one SQL statement:

1. Not in scope (no check, or no open working-list row): `unknown` /
   `not_enabled`. Nothing else is revealed.
2. Read the check, its current submission, the rule in force, decisions on the
   current assertion, contributions without a terminal decision, the latest
   progress event (`reopened` or `evidence_lost`) and evidence availability.
3. Apply [state model §4.5](state-model.md#45-current-answer-status) in its
   precedence order.

Legacy mapping:

- **`venue_amenity_checks` and `amenity_submissions`** are the resolver's
  inputs for the current assertion. Rows written before B01 resolve like new
  ones, with `source_basis`, `current_contribution_id` and `redaction_proof`
  "not recorded", and no confirmation. A confirmation-required key answered
  before B01 is therefore `not_confirmed` / `pending` until a manager
  confirms it. Old Crown has no submissions (9 November readback), so this
  affects only other venues and fixtures.
- **`venue_amenity_facts` is not an input.** The keys map many to many,
  `guest_wifi` has no legacy key, and legacy `unknown` means "not verified"
  rather than "tried, unable to establish"
  ([identities §7](identities.md#7-legacy-facts-mapping-venue_amenity_facts)).
  B03-06 may add reviewed mapping rows. Until then legacy facts change no
  slot.
- `answered_at`, a submission's `created_at` and a legacy `confirmed_at` are
  save times. They appear only as `saved_at` (or not at all), never as
  `observed_at`.

### 5.5 Revision and snapshot guarantees

- `revision` never decreases, and it rises on every change that can alter a
  slot's output. Both terms are increment-only or append-only (state model
  §5).
- The resolver is one SQL statement. The reader wrapper and screen wrappers
  are `STABLE`. PostgreSQL runs every query inside a `STABLE` function on the
  snapshot of the calling statement, so every row in a call, and its revision,
  comes from one MVCC snapshot. WS5's "one response is one snapshot" holds for
  any number of keys.
- Rule-version, question-version and working-list changes write a
  `knowledge_events` row per affected slot in the same transaction, so their
  revision change is atomic with the state change.

## 6. Assignee visibility (review point 3)

Today a non-assignee's answer makes the check vanish from the assignee's list
with no explanation (AC:831-834).

For working-list slots, whenever an answer becomes current through adoption
and the check is assigned to someone other than the contributor, the adoption
writes `knowledge_events` kind `assignment_closed_by_other`. It carries the
assignee, the submission and the answerer.

- S1 returns it as `closedAssignment {answeredBy, at}` until the assignee
  dismisses it (S13) or 14 days pass (WS2 default 9).
- S5 lists it in the assignee's history permanently.
- The assignee field itself is not changed. A later reopen puts the check back
  on the assignee's list (existing behaviour).
- `answeredBy` is the answerer's display name (access and rights §2 allows
  this one name for the assignee).

Outside the working list (legacy path), behaviour is unchanged. It is listed
for B02.

## 7. Venue transfer (review point 4)

- `knowledge_submit`, `knowledge_save_draft` and every decision RPC first run
  `select … from public.profiles where id = auth.uid() for share`, as
  `amenity_assign_check` does (AC:1218-1226), as step 1 of the lock order
  (§4.4). Only then do they read the caller's venue and role. An admin's venue
  change takes the row's update lock, so the two serialise:
  - the contribution commits first and is recorded at the old venue, where
    the person still worked; or
  - the transfer commits first and the contribution is refused
    (`amenity_not_permitted`).

  It never lands at the new venue.

- Evidence cannot cross venues: contribution asset rows carry the FK
  `(asset_id, venue_id)` → `media_assets`, whose venue is fixed at upload.
- Drafts for an old venue cannot be sent. S4 and S5 show them for discard.
- Undecided proposals by a transferred person stay at the old venue. A manager
  may still adopt or decline them. Credit then follows the existing membership
  rules. **Owner to confirm.** The knowledge was gathered while the person
  worked there.
- **Read access after transfer (default, owner to confirm):** the person keeps
  read-only access to their own contributions and submissions, through
  `knowledge_my_contributions` (S5). Today they lose it (AC:387-403). No
  evidence media, no Wi-Fi notes, no old-venue current answer, no writes.
  A deactivated account keeps nothing. `hiddenEarlierVenues` is always empty
  under this default. Reasons:
  [access and rights §5](access-and-rights.md#5-contributions-after-a-transfer).

Step-10 fixture (T10 in §17):

1. Two database sessions. Session A, as staff, begins `knowledge_submit` and
   pauses after the profile lock. Session B, as admin, changes the person's
   venue and blocks.
2. A commits, then B commits. Expect the contribution at the old venue, and
   B's trigger clears assignments.
3. Reverse the order: B commits first, then A. Expect A refused, and no row at
   either venue.
4. Then: old-venue evidence attached to a new-venue check is refused;
   an old-venue draft cannot be sent; history is still readable.

## 8. Wi-Fi redaction proof (review point 8)

Today `p_redaction_confirmed` is checked but never stored (AC:1452,
AC:1459-1467).

- From B01 every new `amenity_submissions` row stores `redaction_confirmed`,
  whether written by the replaced legacy RPC or by adoption. Every
  contribution stores it too. For `guest_wifi`, a Yes, or any attached photo,
  still requires `true` (existing rule, applied in `knowledge_submit` too).
- **Existing Wi-Fi evidence has no redaction proof.** Rows before B01 keep
  `redaction_confirmed` NULL, reported as `not_recorded`. No backfill assumes
  the tick was given (it would be an UPDATE on an append-only table, and a
  manufactured fact). Old Crown had no submissions at the 9 November
  readback. Other venues' existing `guest_wifi` rows are counted in the B01
  dry run (§16) and recorded as "redaction not recorded".
- The resolver reports `redaction_proof`. The internal reader returns
  `guest_wifi` value and counts only, whatever the proof. Public use
  (B06) requires `recorded`.

## 9. Confirmation, conflict, reopen and history (B01-04)

### 9.1 Confirmation

- `knowledge_decide` confirms either an undecided contribution (adopt and
  confirm) or a current submission that awaits confirmation (a submission
  made before B01 or outside a self-confirm). Either way it writes `confirmed`
  against the **submission ID**, with `slot_revision`, `rule_version`,
  `decider_basis` and `self_confirmed`.
- Every decision takes `p_slot_revision`. After the replay lookup, a mismatch
  with the current slot revision raises `amenity_conflict` and records
  nothing (G4). A new contribution arriving while a manager looks at the slot
  therefore forces a reload before any decision.
- Refused with `already_decided` if the contribution has a terminal decision.
- Refused with `self_confirmation_not_permitted` when the decider is the
  author and the rule forbids it, and with `not_venue_manager` for staff.
- A confirmation binds to one submission. Any new answer is a new submission,
  so a field edit after confirmation is never covered by the old
  confirmation (V04).
- Revocation (`revoked`) and reaffirmation (`reaffirmed`, after evidence
  withdrawal) are decisions too. None of them touches credit (§3.4).

### 9.2 Conflict and dispute

- A slot is **disputed** while a contribution without a terminal decision
  exists whose answer differs from the current value. That includes Couldn't
  establish sent in change mode ("I'm no longer sure"). The current assertion
  stays the selected answer, but the reader reports `disputed` / `conflict`.
  Plan journey step 8 requires a conflict to change eligibility. This differs
  from WS2's copy ("stays in use"); see §15, D1.
- **Terminal decisions end a dispute (G6).** Adopted, declined, replaced and
  `seen` are terminal. `seen` is how a manager ends a Couldn't-establish
  dispute without changing the answer.
- Several undecided proposals with no current answer: the slot is
  `not_confirmed` / `pending` and the manager chooses (S10).
- **A conflict decision settles every finding listed in it** (WS2 revision 3
  §10 item 9). The listed findings are every contribution without a terminal
  decision at the slot revision the manager decided against. A stale slot
  revision is refused (§9.1), so nothing can be settled unseen.
  `knowledge_resolve_conflict` (S10), in one transaction:
  - `choose = contribution` ("Use this answer") adopts and confirms that one;
  - `keep_in_use` ("Keep the answer in use") adopts nothing;
  - in both cases every other listed Yes, No or Not applicable finding is
    `declined` with the manager's reason, including one that matches the chosen
    value, whose content the decision already covers;
  - in both cases every listed Couldn't-establish finding is marked `seen`,
    which ends its dispute (G6).

  After the decision no listed finding is undecided, so the slot is not
  disputed. **Only findings that arrive after the decision can dispute the new
  answer.**

**One report can dispute an answer (G9, owner to confirm).** In the pilot,
one staff member's contradicting report makes the slot `disputed` for the
reader, even when the answer was confirmed.

- The manager sees it at once (S6 queue and nav badge).
- After `keep_in_use` or `seen`, a new report from the same person is a new
  contribution and disputes the slot again. There is no rate limit or
  suppression in B01. The one-undecided-per-person rule (§9.3) still applies,
  so one person can hold at most one open dispute per question at a time.
- Disputes per contributor are monitored in B01-07.
- This rule must be decided again before any public audience (B06).

Test T8h covers it.

### 9.3 One undecided finding per person per question (WS2 default 5)

Under the check lock, a new contribution by the same person writes a
`replaced` decision (`decider_basis = 'self'`) on their earlier undecided
one. S3 returns `replacedOwn`.

### 9.4 Reopen, decline, request detail and mark as seen

| Action                                                                               | Effect                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reopen                                                                               | Existing `amenity_reopen_check`, unchanged. The slot goes to `stale` / `recheck_requested` immediately. Undecided proposals stay.                                                                               |
| Decline an undecided contribution                                                    | Decision `declined` with reason (terminal). Nothing else changes.                                                                                                                                               |
| Decline a **current** unconfirmed submission ("Don't confirm" on an answer in place) | The answer cannot stay selected, so the same transaction runs the reopen logic with preset `other` and the reason, and records `declined` on the submission. Credit follows the existing reopen rule.           |
| Request more detail                                                                  | Decision `detail_requested` with a note shown to the contributor. Not terminal: the contribution stays undecided. The contributor's `detail` contribution (`responds_to_decision_id`) replaces it (`replaced`). |
| Mark as seen (Couldn't establish)                                                    | Decision `seen` (terminal). It ends any dispute that finding raised (G6). No other effect.                                                                                                                      |
| Use this answer or keep the answer in use (S10)                                      | Settles every listed finding (§9.2): adopts at most one, declines the other Yes, No and Not applicable findings, marks Couldn't-establish findings `seen`. All terminal (G6).                                   |

### 9.5 Decisions on a disabled slot (G7)

When a slot's working-list row is disabled:

- **Allowed:** decline, `seen`, request detail, revoke, reaffirm,
  `keep_in_use`, and confirming an existing current submission. None of them
  writes `amenity_submissions`, so managers can still clear the queue.
- **Refused** with `knowledge_slot_out_of_scope` (SQLSTATE `NLK02`): adopting
  decisions (confirming or choosing a contribution) and `knowledge_submit`.
  The slot's writes are back on the legacy path, so adoption would mix the two
  paths.
- **Re-enabling restores pending disputes at once.** Disabling never closes a
  contribution, and the resolver evaluates undecided contributions at read
  time against whatever answer is current then. That includes an answer
  written on the legacy path while the slot was disabled. The enable event
  raises the revision.

### 9.6 History

Every contribution and decision is a row, with `knowledge_events` as the
timeline. S2 merges these with `amenity_check_events` for WS2's event lines.
Nothing is updated in place, so a history reconstruction can replay any slot
state.

## 10. Evidence loss (review point 9)

Today `evidence_lost` (AC:614-651) forces a recheck only for a current Yes
whose rule is no longer met. No and Not applicable answers are untouched, and
so is a Yes that still meets its rule after losing one of several assets.

New logic, additive and not a change to the legacy trigger:

- A new trigger, `media_assets_knowledge_evidence_withdrawn`, runs AFTER
  UPDATE OF `deleted_at` (same condition as the legacy trigger). For each
  in-scope slot whose current submission includes the asset, it writes a
  `knowledge_events` row of kind `evidence_withdrawn`. That raises the slot
  revision.
- The resolver reports `evidence_state = 'withdrawn'` when any asset attached
  to the current submission is unavailable and there is no `reaffirmed`
  decision after the latest withdrawal. A complete check is then
  `withdrawn` / `evidence_withdrawn`.
- A Yes that the legacy trigger moved to `needs_recheck` reads `stale` /
  `evidence_lost`, the WS5 mapping.
- A manager restores availability by reaffirming (S7 variant: "the remaining
  evidence is enough") or by reopening.
- No `evidence_lost` check event is written for No or Not applicable, so
  credit is unchanged (§3.4).

## 11. Idempotency

- Every write RPC takes `p_idempotency_key uuid`. Under
  `pg_advisory_xact_lock(hashtextextended('nabalens_knowledge:' || key, 0))`
  it looks up the key in its own table, **before** the slot revision check and
  any state check.
- A replay with the same actor, the same command and the same
  `request_hash` returns the original result, including `initial_outcome`,
  even if the slot changed since. The hash is SHA-256 of all arguments
  normalised as canonical JSON, including `p_slot_revision` and
  `p_confirm_own` (the `coverage_requirements` pattern).
- Any difference in actor, command or hash raises `idempotency_key_reused`,
  which TS maps to `state_conflict` (WS2 §8).
- Drafts carry the key, so another device that finishes a draft after a lost
  response replays rather than sending twice.
- The composite (contribution, adoption, decisions, events) commits or rolls
  back as one transaction.
- The legacy RPC's replay (no payload comparison) is unchanged. Its replay
  lookup runs before the working-list guard (§4.1), so earlier keys still
  replay, but no new legacy write reaches a pilot slot.

## 12. RLS and grants

- New tables: RLS enabled, no policies for `authenticated` (deny), privileges
  revoked from `public`, `anon` and `authenticated`, `select` for
  `service_role`.
- Write and read functions are SECURITY DEFINER with `set search_path = ''`.
  Each re-reads the caller through `private.is_active_user`,
  `private.active_staff_venue_id`, `private.can_manage_venue` and
  `private.is_active_admin` on every call. JWT claims are never trusted.
  Function privileges follow AC:1492-1582: private helpers are revoked from
  `public` and `anon`; definer-only helpers are granted to `service_role`
  only.
- Staff eligibility to contribute:
  - active staff whose current venue is the check's venue;
  - the venue is active and the check active;
  - the slot is in scope;
  - the profile row is locked FOR SHARE (§4.4, §7).

  `private.amenity_can_submit` and `private.amenity_can_read` are **not**
  widened, so the legacy reads and the evidence-media gate keep today's
  exposure.

- Unknown and forbidden IDs return the same `not_found`.

## 13. Server operations for WS2 (UI design §9)

All names are WS1's. Service functions go in `lib/server/knowledge/**` and
contract types in `lib/knowledge/contract.ts`. Server actions follow the
`app/_amenities/actions.ts` pattern (WS2 or the integration owner places
them). Every read returns `slotRevision`; every command takes it back as
`p_slot_revision` (G4).

| #   | WS2 operation                             | WS1 design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `getWorkingList`                          | `public.knowledge_working_list()` → `getWorkingList(actor)`. Caller's current venue; in-scope slots only. Fields as WS2 lists, with `slotRevision`, `answerInUse` including `available`, `reason`, `savedAt` and `sentAt` (G10), `latestAttempt`, assignee first name, `mode`, `requiresConfirmation`, `myLatest`, `myDraft`, `othersPending` (a count, see D3) and `closedAssignment`. `lastCheckedAt` is always null in B01 (no observation time).                                                                                                                                                                                                                              |
| S2  | `getCheck` (extended)                     | `public.knowledge_check(p_check_id)` → `getKnowledgeCheck`. Returns `inScope` (the resolver's `in_scope`; WS2's CaptureScreen uses it to switch every capture route for the question to the knowledge form) and resolver state with `slotRevision`, `savedAt` and `sentAt`, plus pending findings with their send times (managers: all; staff: own, plus `othersPending` count), permissions (`canContribute`, `canReportChange`, `canConfirm`, `canSelfConfirm`, `canRequestDetail`, `canDecline`), `mode` and `requiresConfirmation`. The existing `getCheck` stays for legacy screens.                                                                                         |
| S3  | `submitFinding` (extended)                | `public.knowledge_submit(p_check_id, p_slot_revision, p_idempotency_key, p_kind, p_answer, p_finding, p_limitations, p_reason, p_unknown_preset, p_tried_text, p_change_reason, p_responds_to, p_asset_ids, p_internal_metadata, p_redaction_confirmed, p_confirm_own)` → `submitKnowledgeFinding`. Returns `{findingRef, slotRevision, replayed, outcome: 'current' / 'awaiting_confirmation' / 'recorded', replacedOwn, recognition}`. Errors add `amenity_conflict` on a stale slot revision (nothing recorded), `not_venue_manager` and `self_confirmation_not_permitted` for `p_confirm_own` (G5), and `knowledge_slot_out_of_scope`. There is no `processing` outcome (D2). |
| S4  | `saveDraft` / `getDraft` / `discardDraft` | `public.knowledge_save_draft(p_check_id, p_draft_revision, p_payload, p_asset_ids, p_idempotency_key)`, `knowledge_get_draft`, `knowledge_discard_draft`. `draft_conflict` on revision mismatch. Drafts are purged 90 days after last save (owner to confirm) and deleted after the send that used their key.                                                                                                                                                                                                                                                                                                                                                                     |
| S5  | `listMyFindings`                          | `public.knowledge_my_contributions(p_cursor, p_limit ≤ 20)`. Own contributions (with send time), own submissions (including before B01), drafts and closed assignments, across venues, read-only for old venues. `hiddenEarlierVenues` is always `[]` under the history-kept default.                                                                                                                                                                                                                                                                                                                                                                                             |
| S6  | `listToConfirm`                           | `public.knowledge_to_confirm(p_venue_id)`. Manager or admin. Undecided contributions (with send time) plus current submissions awaiting confirmation or reaffirmation, with `conflict` and `slotRevision`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S7  | `confirmFinding`                          | `public.knowledge_decide(p_target, p_decision 'confirm', p_slot_revision, p_idempotency_key, p_note)`. `p_target` is a typed `findingRef` (D5). Also covers `reaffirm` (§10). Returns `replacedAnswer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S8  | `requestMoreDetail`                       | `knowledge_decide(…, 'request_detail', note required)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S9  | `declineFinding`                          | `knowledge_decide(…, 'decline', reason required)`. On a current submission it also reopens (§9.4). On a Couldn't-establish finding it records `declined` (terminal), as defined; WS2 does not use S9 for that case (R3).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S10 | `resolveConflict`                         | `public.knowledge_resolve_conflict(p_check_id, p_slot_revision, p_idempotency_key, p_choose, p_reason)`, `p_choose` a `findingRef` or `keep_in_use`. Settles every finding listed at that slot revision (§9.2). For a single disputing Couldn't-establish finding, WS2 calls S10 `keep_in_use` (R3), which marks it `seen` and ends the dispute.                                                                                                                                                                                                                                                                                                                                  |
| S11 | `markUnknownSeen`                         | `knowledge_decide(…, 'seen')`. Only for `unknown` contributions. Terminal; ends their dispute (G6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S12 | `reopenCheck`                             | Existing `amenity_reopen_check`, unchanged. S1 and S2 then report the slot `stale`, with the previous answer as `previousAnswer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S13 | `dismissClosedAssignment`                 | `public.knowledge_dismiss_outcome(p_event_id)`. Own rows only; best effort.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S14 | `getMyRecognition`                        | Existing `coverage_staff_progress_v2` for target figures, unchanged, plus `public.knowledge_my_pending(p_period)` → `{awaitingConfirmation, unknownRecorded}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

`findingRef` is `{type: 'contribution' | 'submission', id}`. B01-era findings
are contributions (auto-adopted ones link to their submission). Only
submissions made before B01 are `submission` refs.

## 14. WS2 assumptions (§10) and defaults (§12)

### 14.1 Assumptions

| #   | WS2 assumption                                                                                                                                 | WS1 answer                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Couldn't establish never becomes current, never creates a credited submission or `submitted` event, never changes the assignment               | **Confirmed** (§2.2, §3, §4.2)                                                                                              |
| 2   | Spontaneous findings while an answer is in use, confirmation is required, or assigned to someone else are proposals, adopted only by S7 or S10 | **Confirmed**, and stricter: every write to a working-list slot goes through the new path (§4.1)                            |
| 3   | An explicit assignment outcome when someone else's answer becomes current                                                                      | **Confirmed** for working-list slots (§6)                                                                                   |
| 4   | Reopen makes the answer ineligible at once; S1 and S2 show none in use                                                                         | **Confirmed**: `stale` / `recheck_requested`, with `previousAnswer`                                                         |
| 5   | "Last checked" only from an observation time                                                                                                   | **Confirmed.** No observation time exists in B01, so it is never shown. Screens may show "Sent {date}" from `sentAt` (G10). |
| 6   | Recognition server-side; until B08, revoke, dispute and withdraw do not remove `scored`                                                        | **Confirmed** (§3.4, §3.5)                                                                                                  |
| 7   | Transfer: history kept or `hiddenEarlierVenues`; FOR SHARE profile lock                                                                        | **Confirmed**: history kept by default; lock as §4.4 and §7                                                                 |
| 8   | `requiresConfirmation` and `canSelfConfirm` from B00-04                                                                                        | **Confirmed**: from `knowledge_question_rules` (§2.4)                                                                       |

### 14.2 Defaults

| WS2 default                                                                      | WS1                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. One Unknown outcome, "Couldn't establish", data value `unknown`, with presets | **Accepted.** Presets `no_one_sure`, `could_not_access`, `needs_access`, `other`, plus required "what did you try". Never current (§2.2).        |
| 2. Drafts on the server                                                          | **Accepted**, with limits: one per person and check, ≤ 16 KiB, owner-only, never credited or read by the resolver, purged after 90 days (§13 S4) |
| 3. Open questions and proposals are not To do                                    | No server impact. Accepted.                                                                                                                      |
| 4. A non-assignee's contribution is a proposal                                   | **Accepted** (§4.2)                                                                                                                              |
| 5. At most one undecided finding per person and question                         | **Accepted** (§9.3)                                                                                                                              |
| 6. To confirm on the Amenities screen                                            | No server impact. Accepted.                                                                                                                      |
| 7. Confirm without a dialog unless replacing or resolving                        | No server impact. S7 returns `replacedAnswer` either way.                                                                                        |
| 8. Unknown gets "Mark as seen", never Confirm                                    | **Accepted** (§9.4). `seen` is terminal and ends the dispute (G6). The server refuses `confirm` on an `unknown` contribution.                    |
| 9. Closed-assignment rows on Home for 14 days                                    | **Accepted** (§6)                                                                                                                                |
| 10. Recognition only when the server says `scored`                               | **Accepted** (§3.5)                                                                                                                              |

## 15. Disagreements for the orchestrator to reconcile

| ID  | With                  | Topic                                                                  | WS1 choice                                                                                                                                                                                                                                    | Reason                                                                                                                                                                                                        |
| --- | --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | WS2                   | A pending change report or proposal that contradicts the answer in use | The slot is `disputed` for consumers. The answer stays selected for staff. WS2's copy "stays in use until your manager confirms" should become, for example, "It's still the recorded answer, marked as disputed until your manager decides." | Plan journey step 8: a conflict changes eligibility. Unknown is safer than possibly wrong certainty. A same-value report does not dispute.                                                                    |
| D2  | WS2                   | Outcome "used once its photos finish processing"                       | Dropped                                                                                                                                                                                                                                       | Evidence must be `ready` to attach (existing `not_ready` refusal); the Add queue already waits.                                                                                                               |
| D3  | WS2                   | Names of other people's pending findings to staff                      | `othersPending` is a count, without names. Assignee first name and the closed-assignment answerer's name are allowed.                                                                                                                         | Minimises staff attribution in the newly widened staff view. The two allowed names are needed for coordination. WS2's row copy "{First name} also sent a finding" becomes "Someone else also sent a finding". |
| D4  | WS2                   | Manager Capture myself on a confirmation-required question             | `current` only when self-confirmation is allowed and requested (`p_confirm_own`), otherwise awaiting confirmation; refused, not downgraded, where the rule forbids self-confirmation (G5)                                                     | Consistent with WS2 §6.3; WS2's §3 table says "current (manager authority)" without that condition                                                                                                            |
| D5  | WS2                   | `findingId`                                                            | A typed `findingRef` (contribution or legacy submission)                                                                                                                                                                                      | Submissions made before B01 can be confirmed too                                                                                                                                                              |
| D6  | WS5                   | An archived check with an answer                                       | `withdrawn` / `answer_withdrawn`. An archived check never answered stays `unknown` / `not_enabled`.                                                                                                                                           | A consumer holding the old answer must see a withdrawal (tombstone), not "not enabled"                                                                                                                        |
| D7  | WS5                   | Confirmation on core keys                                              | `step_free_entrance` requires venue-manager confirmation; the other three do not                                                                                                                                                              | Plan §2: sensitive claims need authority. Access and rights §6.                                                                                                                                               |
| D8  | WS5                   | `sourceKind` for submissions made before B01                           | `source_basis` is null (not recorded). Suggest WS5 maps it to a neutral `observation`, not `staff_observation`.                                                                                                                               | Their submitter's role at the time was never stored. Guessing is manufacturing provenance.                                                                                                                    |
| D9  | WS5                   | Self-confirmed answers                                                 | The resolver returns `confirmation_self`; suggest an optional `selfConfirmed` in provenance                                                                                                                                                   | Plan V04 and access rules require self-confirmation to be visible                                                                                                                                             |
| D10 | Review risk 7         | Enum widening                                                          | No widening in B01 (§2.2)                                                                                                                                                                                                                     | Unknown and new states never enter the amenity tables, and the unchanged constraints are the proof                                                                                                            |
| D11 | Review risk 1 wording | An unassigned finding on an open, unassigned, confirmation-free slot   | Auto-adopted and credited under the existing rule. Every other spontaneous finding is an uncredited proposal.                                                                                                                                 | Plan §2 default ("straightforward evidence-backed observations can complete automatically"), WS2 §3 agrees. One rule flag (`unassigned_auto_complete`) switches it off with no code change.                   |

## 16. Migration and rollback (plan §16 steps)

| Step                    | B01 action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Inventory            | Read-only admin dry-run function `knowledge_pilot_preview(p_venue_id)`, per working-list key: check state, submission count, pre-B01 `guest_wifi` rows without redaction proof, related legacy fact rows (shown, not used), and what the resolver would return. Run on fixtures; on production only with authorisation, by venue UUID (identities O1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2. Compatible schema    | Production is at `f8c49430` with every migration through `20261109120000` (B00-01). Two forward migrations, both sorting after `20261109120000` and after any other migration the integration owner has merged first: (a) `…_knowledge_b01_schema.sql`: new tables, guards, indexes, RLS, the three nullable `amenity_submissions` columns, rule seed (with `knowledge_note_definition_change` calls); (b) `…_knowledge_b01_functions.sql`: resolver, wrappers, write RPCs, the evidence-withdrawn trigger, the replaced `amenity_submit_finding` (§4.1). TS contract (`lib/knowledge/contract.ts`, and `knowledge_path_required` in `lib/amenities/contract.ts`) and the error-code mapping (the §4.1 table: `NLK01` to `NLK06`, and the non-retryable default for any other `NL`-class SQLSTATE) land in the same release. No existing enum widens. `lib/db/types.ts` is regenerated by the integration owner. `scripts/db/amenity-catalogue-sql.ts` emits the definition-change call (G3). |
| 3. Dry run              | Step 1's preview on the fixture stack and on a copy of the migration chain (`supabase db reset`), with counts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4. Idempotent apply     | Migrations are additive (`create`, `add column` without default, `create or replace` of one function). There is no backfill and no data conversion. Re-running the rule seed is `on conflict do nothing`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5. Compare              | After apply: row counts of every amenity table unchanged; constraint definitions unchanged (§2.2); `coverage_staff_progress_v2` for every venue and the current and previous month identical before and after.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6. Shadow read          | With the working list still empty, the resolver for fixture venues is compared with the check table: every complete check without knowledge rows is `available` (or `not_confirmed` for `step_free_entrance`); differences explained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7. Enable scope         | An admin enables the Old Crown working list (four keys, venue `9240a6e7-5eaf-426b-b272-214f95c08ab0`) through `knowledge_set_working_list` after release authorisation (X1) and admin confirmation of the venue (identities O1). Each key needs an existing check at the venue (otherwise `amenity_check_not_found`), so add any missing check with `amenity_add_checks` first. Fixture keys only at fixture venues.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8 to 9. Observe, expand | B01-07 pilot; other venues in B10 waves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10. Retire legacy       | Not in B01. The legacy submit stays for non-working-list slots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Release order:

1. App code that maps the new error codes and reads the new outcomes ships with
   or before the migrations. `knowledge_path_required` is mapped as
   non-retryable before any slot can be enabled.
2. At deploy no slot is in scope, so every existing path behaves exactly as
   today.
3. Enabling the working list is a separate authorised step.

Rollback, from lightest to heaviest:

1. **Disable the working list** per slot or venue (admin RPC, immediate, under
   the check locks of §4.1). The legacy submit guard lifts, the reader returns
   `404` for a venue with no scope, and staff screens fall back to the existing
   list. Every contribution, decision and adopted submission stays. Adopted
   submissions are ordinary findings that remain the legacy current answer.
   Non-adopting decisions remain possible on the disabled slot; adoption and
   new knowledge sends are refused (§9.5). **Re-enabling restores pending
   disputes at once**, evaluated against whatever answer is current then.
2. **App rollback.** The previous app works unchanged: the old RPC behaves as
   before off the working list.
3. **Schema.** Forward-only. A forward migration can restore the original
   `amenity_submit_finding` body. Tables holding data are never dropped and
   triggers are never disabled.

## 17. Tests mapped to the B01 qualification journey

Test homes:

- `tests/security/knowledge-*.test.ts` (database and RPC, isolated stack run by
  the integration owner on spare6);
- `tests/integration/knowledge-services.test.ts`;
- `tests/unit/knowledge-*.test.ts` and `tests/unit/amenities-*.test.ts`
  additions (contract, views, error mapping).

UI and e2e coverage belongs to WS2 and WS6, the reader's tests to WS5.

| Step                                                            | Tests (V family)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Correct venue, unassigned core question                      | T1a: staff at the venue sends Yes on an unassigned `onsite_parking` → `current`. T1b: staff at another venue → `not_found`, including the similar-name fixture pair modelled on the two White Horse venues (identities §2). T1c: an out-of-scope key → refused. T1d: role matrix: staff, staff assigned elsewhere, manager account, staff-held grant, admin, deactivated, anonymous, `service_role` (V01). T1e: legacy `amenity_submit_finding` on an in-scope slot → `knowledge_path_required` / `NLK01` for every role; off-list unchanged (existing security tests unmodified).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2. Evidence and conditions                                      | T2a: Yes without the rule's evidence → `evidence_rule_unmet` (`step_free_entrance` video, `guest_wifi` both). T2b: limitations stored and returned by the resolver. T2c: `guest_wifi` photo without the tick → `redaction_not_confirmed`; with it → `redaction_confirmed = true` stored; a pre-B01 row → `not_recorded`. T2d: another person's or another venue's asset → `evidence_not_eligible` (V02).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3. Interrupted upload, recovery                                 | T3a: draft save, get, discard; `draft_conflict` on a stale revision; owner-only. T3b: `not_ready` asset refused. T3c: a draft finished on a second device replays with the same key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4. Lost response retried, exactly one contribution              | T4a: the same key three times → one contribution, one submission, one `submitted` event, `replayed` true. T4b: the same key with different payload (including a changed `p_confirm_own` or `p_slot_revision`) → `idempotency_key_reused`. T4c: two concurrent sessions with the same key → one row. T4d: the same key used by another person → refused (V03). T4e (G4): a stale `p_slot_revision` (a knowledge event since, with the check revision unchanged) → `amenity_conflict`, and no contribution, decision or event is recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. Manager confirms or asks for detail                          | T5a: `step_free_entrance` staff finding → `not_confirmed` / `pending`, no submission. Confirm → `available`, `confirmation_basis = venue_manager`. T5b: request detail → detail contribution → confirm. T5c: confirm with a stale slot revision → `amenity_conflict`; a second decision → `already_decided`. T5d: self-confirmation recorded; forbidden when the rule says so. T5e: staff cannot confirm. T5f: dog-policy fixture: a staff photo finding stays pending until the manager confirms (V04). T5g (G5): `p_confirm_own` from staff → `not_venue_manager`; where the rule forbids self-confirmation → `self_confirmation_not_permitted` with nothing recorded; on a confirmation-free key → ignored (`current`, no `confirmed` decision).                                                                                                                                                                                                                                                                               |
| 6. Reader returns the current permitted answer with provenance  | T6a: resolver columns per state, including `sent_at` ≠ `saved_at` for a finding confirmed later (G10). T6b: `knowledge_reader_answers_v1` returns only allowlisted columns; `guest_wifi` text null; no names, metadata, asset IDs or `sent_at` (V11). T6c: granted to `service_role` only; `authenticated` refused. T6d: venue with no scope → `knowledge_venue_not_found` raised from the plpgsql wrapper. T6e (WS5 `61e699de`): an empty (and a `NULL`) `p_keys` with an in-scope venue → zero rows, no error; with an unknown, an inactive and a no-scope venue → `knowledge_venue_not_found` / `NLK06` in each case.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7. Another question returns Unknown                             | T7a: Couldn't establish on `guest_toilets` → `unknown` / `unable_to_establish`, no submission, no check event. T7b: never adoptable (confirm refused; direct insert fails the constraint). T7c: mark as seen. T7d: legacy fact `unknown` does not change the slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8. Conflict, recheck or evidence withdrawal changes eligibility | T8a: a contradicting change report → `disputed`; a same-value report → no dispute. T8b: reopen → `stale` / `recheck_requested`. T8c: Yes evidence deleted with its rule unmet → `stale` / `evidence_lost`. T8d: No evidence deleted → `withdrawn` / `evidence_withdrawn`; reaffirm → `available`. T8e: revoke → `withdrawn` / `confirmation_revoked`. T8f: disputed-service fixture: S10 choose and `keep_in_use`; each settles every listed finding (the chosen one adopted, other Yes, No and Not applicable declined, Couldn't establish `seen`), the slot is not disputed afterwards, and a finding sent after the decision disputes the new answer. T8g: archive → `withdrawn` / `answer_withdrawn` (V04). T8h (G6, G9): Couldn't-establish change report → `disputed`; `seen` → `available`; the same person reports again → `disputed` again; `keep_in_use` → `available` with the report marked `seen`; a fourth report while one is undecided replaces it (one undecided per person); credit unchanged throughout (C23). |
| 9. Consumer reads the revised state                             | T9a: the slot revision rises strictly across every T8 transition, submit, reopen and resubmit, and never decreases. T9b: a multi-key call returns one snapshot (concurrent writer test). T9c: a working-list disable raises the revision of each slot. T9d (G3): `knowledge_note_definition_change` for a rule version and for a question version raises the revision of every in-scope slot of that key and of no other key; a slot without a check has revision 0 plus its events, and rises when a check is added (V12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10. Venue transfer                                              | T10a/b: the FOR SHARE race in both orders (§7). T10c: old-venue evidence refused at the new venue (FK). T10d: old-venue draft cannot be sent. T10e: own history still readable, no media and no Wi-Fi notes (V02).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 11. Menu-photo and monthly target compatibility                 | C1 to C23 (§3.6). T11a: `amenity_submissions` and `venue_amenity_checks` constraint definitions unchanged; `amenity_check_events` kinds unchanged. T11b: existing amenity security, integration and unit tests pass unmodified. T11c: menu-photo credit unchanged. T11d: the pinned baseline tests (§17.1) pass unmodified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Legacy guard (G2)                                               | T14a (security): a key recorded through `amenity_submit_finding` before enablement replays with its original result after enablement (`replayed` true, no new row), while a new key on the same slot gets `knowledge_path_required`. T14b (security, two sessions): session A holds the check lock inside `amenity_submit_finding`'s transaction while session B runs `knowledge_set_working_list`; B waits, A's submission commits as a pre-scope answer. In the reverse order, A gets `knowledge_path_required`. T14c (unit): `lib/server/amenities/errors.ts` maps message `knowledge_path_required` and SQLSTATE `NLK01` to `knowledge_path_required` (409), and `knowledge_slot_out_of_scope` / `NLK02` to `knowledge_slot_out_of_scope` (409); `lib/server/knowledge/errors.ts` maps every row of the §4.1 table; an unknown `NLK99` maps to `state_conflict`. For every `NL`-class SQLSTATE in the table, and the unknown one, the mapped code is not `unavailable` and is not in the capture form's retry set (R1).       |
| Disabled slot (G7)                                              | T15: on a disabled slot, decline, `seen`, request detail, revoke, reaffirm and `keep_in_use` succeed; confirming a contribution and `knowledge_submit` get `knowledge_slot_out_of_scope`; after re-enabling, a still-undecided contradicting report makes the slot `disputed` at once with a higher revision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Lock order (G7)                                                 | T16: a concurrent asset deletion and an adopting decision on the same check, in both orders, never deadlock; the outcome is either adoption refused (`evidence_not_eligible`) or adoption followed by `evidence_withdrawn` or `evidence_lost`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Assignee visibility (risk 3)                                    | T12: an adoption on a check assigned to another → `assignment_closed_by_other` event; S1 shows it; dismiss hides it for that person only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Append-only (risk 6)                                            | T13: UPDATE and DELETE on every new append-only table → refused; no B01 function issues an UPDATE on `amenity_submissions`, submission assets or events.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 17.1 Baseline pin and changes to existing tests

**Baseline pin first (G8).** The integration agent measured today's credit
rules on spare6 at `f8c49430` (integration 317 passed and 13 skipped;
security 537 passed). Its "amenity credit baseline" tests on
`codex/b01-knowledge-pilot` (`58adc4ce`, then `624d5c5c` for the archive pin;
`tests/security/completion-targets.test.ts`; security 541/541) pin today's behaviour. The pinned behaviours are four:

1. the answer value is ignored;
2. a later submission by anyone moves the credit;
3. `evidence_lost` applies only to Yes;
4. archive suspends credit and restore brings it back (pinned at `624d5c5c`).

Those tests, and the two existing completion-target tests, are the baseline
pin. They must keep passing, unmodified, on every B01 commit. This design keeps
them passing because it changes none of those rules: the legacy path is
untouched off the working list, and the adoption function writes the same row
and event a finding writes today. B01 implementation starts from `624d5c5c` (archive and restore pin committed; security 541/541), merged with the WS1 docs commits.

WS1 adds only what they do not cover, before any Unknown, proposal or
adoption code lands. The additions go in
`tests/security/completion-targets.test.ts` as new cases (no existing case
edited or removed), or in a new `completion-targets-baseline.test.ts` if the
integration owner prefers:

- a month boundary and a transfer alongside menu-photo acceptance;
- then, with B01, C1 to C23 (§3.6), including "a Couldn't-establish finding
  neither adds credit nor removes someone else's credit" (C4, C14, C23).

Expected values come from the TG semantics (§3.1) and must agree with the
measured baseline.

**Who may submit.** `tests/security/amenities.test.ts` asserts that only the
assignee, the venue's manager or an admin may submit, for example the
`amenity_not_permitted` case after unassignment. B01-02 deliberately lets
unassigned venue staff contribute. In this design that change lives in the new
`knowledge_submit` path. `amenity_submit_finding` and `private.amenity_can_submit`
keep today's rule, so the existing assertions stay true and the file stays
unmodified, as the regression guard for the legacy path. The deliberate change
is asserted in new files:

- `tests/security/knowledge-contribute.test.ts`: unassigned staff may
  contribute only to in-scope slots at their own venue, with the outcome table
  of §4.2;
- `tests/security/knowledge-legacy-guard.test.ts`: the legacy submit refuses
  in-scope slots for the assignee, the manager and an admin, and is unchanged
  off the working list (T1e, T14a, T14b).

If integration prefers one file per RPC family, the second may move into
`amenities.test.ts` as an added case. No existing assertion is edited or
removed.

## 18. Review index

| Item                                                                                                                  | Where addressed                                           |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Risk 1. Credit leakage                                                                                                | §3 (outcome table, supersession paths, proof, C1 to C23)  |
| Risk 2. Silent overwrite                                                                                              | §4 (legacy guard, outcome table, adoption choke point)    |
| Risk 3. Hidden assignee work                                                                                          | §6, T12                                                   |
| Risk 4. Transfer race                                                                                                 | §4.4, §7, T10                                             |
| Risk 5. One resolver and legacy mapping                                                                               | §5; identities §7 and §8                                  |
| Risk 6. Append-only                                                                                                   | §2.1, §2.3, §8, T13                                       |
| Risk 7. Enum widening                                                                                                 | §2.2 (not widened, with the order fixed for later), D10   |
| Risk 8. Wi-Fi redaction proof                                                                                         | §8; access and rights §4                                  |
| Risk 9. Evidence loss                                                                                                 | §10, T8c, T8d                                             |
| Risk 10. B08 deferral                                                                                                 | §3.4                                                      |
| Transfer read access                                                                                                  | §7 default; access and rights §5                          |
| G1. Third supersession path                                                                                           | §3.2 (row and supersession paths), §3.3 point 6, C21, C22 |
| G2. Legacy guard order, lock, error code                                                                              | §4.1, §16 release order, T1e, T14a, T14b, T14c            |
| G3. `question_key` on events, definition changes                                                                      | §2.3, state model §5, T9d                                 |
| G4. Slot revision as the command token                                                                                | §4.2, §9.1, §13, T4e, T5c                                 |
| G5. `p_confirm_own`                                                                                                   | §4.2, §11, T4b, T5g                                       |
| G6. `seen` and `keep_in_use` terminal                                                                                 | §9.2, §9.4, state model §4.1 and §4.5, T8h                |
| G7. Lock order; disabled slots                                                                                        | §4.4, §9.5, §16 rollback, T15, T16                        |
| G8. Four pinned behaviours                                                                                            | §17.1                                                     |
| G9. One report disputes                                                                                               | §9.2, §19 item 14, T8h                                    |
| G10. Send time; plpgsql reader wrapper                                                                                | §5.1, §5.2, §5.3, §5.5, §13, T6a, T6d                     |
| WS5 `contribution_kind`                                                                                               | §5.2, §5.3                                                |
| WS2 UI design §10, conflict decisions settle every listed finding (item 9 in revision 3; WS2 renumbers in revision 4) | §9.2, §9.4, state model §4.5, T8f                         |
| R1. Mapping for `NLK02` and every `NL`-class error                                                                    | §4.1 error mapping table, T14c                            |
| R3. Single Couldn't-establish dispute uses S10 `keep_in_use`                                                          | §13 S9 and S10                                            |
| WS5 empty `p_keys` on the reader wrapper                                                                              | §5.3, T6e                                                 |
| WS2 UI design §10, S3 `amenity_conflict` and S2 `in_scope` (item 10 in revision 3)                                    | §4.2, §13 S2 and S3, T4e                                  |

## 19. Decisions to confirm (decided by default)

1. Confirmation: only `step_free_entrance` among the pilot keys. `guest_wifi`
   is sensitive data, not a sensitive claim.
2. Self-confirmation allowed for `step_free_entrance` and the dog-policy
   fixture, always recorded. Where a rule forbids it, a self-confirm request is
   refused, never downgraded.
3. A confirmation survives the confirming person's later loss of authority.
4. Unassigned findings on open, unassigned, confirmation-free slots
   auto-complete and are credited (D11).
5. Credit for an adopted proposal is counted in the adoption month.
6. A contradicting pending report makes the slot `disputed` (D1).
7. Evidence withdrawal of any attached asset makes a complete answer
   unavailable until it is reaffirmed or reopened.
8. Own contribution history stays readable after a transfer; undecided
   proposals of a transferred person may still be adopted.
9. No expiry for the four keys in B01.
10. Legacy `venue_amenity_facts` are not a resolver input until B03-06.
11. Drafts on the server, purged after 90 days; reader logs kept 90 days.
12. All working-list writes use the new path; the legacy submit refuses them
    (SQLSTATE `NLK01`, non-retryable).
13. Staff see other people's pending work as a count only (D3).
14. **One report disputes (G9).** In the pilot, one staff member's
    contradicting report disputes the answer for the reader, including a
    confirmed answer. The manager sees it at once. A repeated report after
    `keep_in_use` or `seen` disputes it again, with no rate limit. Disputes
    per contributor are monitored in B01-07. The rule must be decided again
    before any public audience (B06).
15. `seen` and `keep_in_use` are terminal and end a Couldn't-establish
    dispute (G6).
16. On a disabled slot, non-adopting decisions stay possible; adoption and new
    sends are refused (G7).
17. Knowledge events are keyed by (venue, question key), and definition
    changes write events for every in-scope slot (G3).
18. A conflict decision ("Use this answer" or "Keep the answer in use")
    settles every finding listed at the decided slot revision: Couldn't
    establish marked `seen`, other Yes, No and Not applicable findings
    declined. Only later findings can dispute the result.

Open items: identities O1 to O3; named people for X4 (product owner, policy
confirmers, internal reader operator, public-use granter).
