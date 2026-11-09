# Knowledge state model

Status: B00-02 contract draft for review. Owner: WS1 knowledge domain.
Source baseline: `f8c49430`. Companion documents: [identities](identities.md),
[access and rights](access-and-rights.md), [B01 design](b01-design.md).

Items marked **owner to confirm** are defaults chosen under the programme's
recommended decisions. They can be changed without redesigning the model.

## 1. Why the dimensions are separate

A staff member's input, the venue's current fact, the confirmation of that
fact, the permission to use it somewhere, its delivery to that place, and the
credit a person earned are different things. Each changes for different
reasons and on a different timetable. Coupling them causes the failures the
programme exists to prevent: a photo becoming policy, a reopened answer staying
on a website, or a fact correction rewriting last month's target.

Rules that follow from this:

- Technical validity (the evidence rule was met) never implies confirmation.
- Confirmation never implies permission to publish.
- Permission never implies delivery.
- Historical credit is a record of work in a period. A later change to the fact
  does not rewrite it unless an approved scoring policy (B08) says so.

## 2. Objects

| Object            | Meaning                                                                                                                                       | B01 storage                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contribution      | One person's recorded input about one answer slot: a finding (including Couldn't establish), a change report, or requested detail.            | `amenity_submissions` (findings that became an answer) and new `knowledge_contributions` (proposals, Unknown, change reports).                                      |
| Asset             | One uploaded photo or video.                                                                                                                  | `media_assets` (existing). Links: `amenity_submission_assets`, new `knowledge_contribution_assets`.                                                                 |
| Assertion         | The claim a contribution makes: value, conditions text, evidence set and scope (venue, question, catalogue version). Immutable once recorded. | The fields of a submission or a `finding` contribution. A Couldn't-establish finding carries no value assertion; a change report asserts its proposed answer.       |
| Confirmation      | A decision by a person with authority about one specific assertion.                                                                           | New `knowledge_decisions` (append-only).                                                                                                                            |
| Current answer    | The one selected assertion per answer slot under the resolution rules, with its derived status.                                               | Derived: `venue_amenity_checks` (operational input) plus knowledge tables, through one resolver (see [B01 design §5](b01-design.md#5-one-resolver-review-point-5)). |
| Publication       | A record that a named revision of an answer was offered to, delivered to and verified at a destination.                                       | Not in B01. Contract defined here for B06.                                                                                                                          |
| Historical credit | Scored completion for a person, venue and London month, plus unscored contribution recognition.                                               | Derived at read time by `private.monthly_venue_completion_counts` (existing, unchanged in B01). Recognition derived from contributions.                             |

An **answer slot** is the pair (venue, question) in B01, with the venue as the
subject. It maps one to one to a `venue_amenity_checks` row
([identities §3](identities.md#3-subject-and-answer-slot-identity)).

## 3. Dimensions by object

Cells say which values apply. "—" means the dimension does not apply to that
object. **S** marks a stored value and **D** a value derived at read time.

| Dimension    | Contribution                                                                                                                          | Asset                                                                                        | Assertion                                                                                         | Confirmation                                                             | Current answer                                                                                            | Publication                                                                     | Historical credit                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Value        | Kind `finding`, `change_report`, `detail`; answer `yes`, `no`, `not_applicable` or `unknown` ("Couldn't establish") (S)               | —                                                                                            | `yes`, `no`, `not_applicable` (S). Unknown is never an assertion value.                           | Applies to named fields of one assertion (S)                             | `yes`, `no`, `not_applicable` or `unknown` (D)                                                            | The revision and allowlisted fields offered (S, B06)                            | Counts (D)                                                                  |
| Resolution   | Outcome: `pending`, `adopted`, `declined`, `detail_requested`, `replaced`, `seen`, no longer in use (D from decisions and slot state) | —                                                                                            | `proposed`, `current`, `superseded`, `withdrawn` (D)                                              | —                                                                        | Slot status: available, or an unavailable reason and detail (§4.5) (D)                                    | —                                                                               | —                                                                           |
| Confirmation | —                                                                                                                                     | —                                                                                            | `not_required`, `pending`, `confirmed`, `declined`, `revoked` (D from decisions and rule version) | Decision, actor, authority basis, rule version, time, check revision (S) | Confirmation of the selected assertion (D)                                                                | Must be satisfied before offering (B06)                                         | Not an input in B01                                                         |
| Freshness    | Saved time (S)                                                                                                                        | Upload time (S). Not capture time.                                                           | Saved time (S). Observation time not collected in B01 (see §6).                                   | Saved time of the decision (S)                                           | `savedAt`, `confirmationSavedAt`, `observedAt` (null in B01), `nextCheckDue` (null: no expiry in B01) (D) | Delivered and verified times (S, B06)                                           | London month boundaries (D)                                                 |
| Evidence     | Asset links (S)                                                                                                                       | `upload_state`, `deleted_at`, `purpose` (S); available (D)                                   | Evidence set, rule version, rule met (S at write, D now)                                          | —                                                                        | `complete`, `none_attached`, `withdrawn` (D)                                                              | Approved derivatives only (B05)                                                 | Yes needs its evidence rule (existing)                                      |
| Use          | —                                                                                                                                     | No use grants in B01. Purpose `amenity` keeps evidence out of the community feed (existing). | —                                                                                                 | —                                                                        | Audience allowlist per [access and rights](access-and-rights.md) (D)                                      | Destination, permitted fields, grant, period (S, B06)                           | —                                                                           |
| Delivery     | —                                                                                                                                     | —                                                                                            | —                                                                                                 | —                                                                        | Answer revision (D)                                                                                       | `desired`, `attempted`, `acknowledged`, `verified`, `failed` revisions (S, B06) | —                                                                           |
| Recognition  | Acknowledgement and outcome shown to the contributor (D)                                                                              | —                                                                                            | —                                                                                                 | —                                                                        | —                                                                                                         | —                                                                               | Scored credit (D, existing rule) kept separate from pending recognition (D) |

## 4. Allowed transitions and accountable actors

"Staff" means an active staff account whose current venue is the slot's
venue. "Manager" means the venue's effective manager: a manager account with
an open grant, or a staff account with a transitional grant
(`private.can_manage_venue`). "Admin" means an active admin.

### 4.1 Contribution

| From                               | To                                                    | Trigger                                                                                                                                                | Accountable actor                                                  |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| (none)                             | draft                                                 | "Save for later". Stored on the server per person and check, and cached on the device. Not a contribution: never credited, never read by the resolver. | Contributor                                                        |
| draft                              | recorded                                              | Server accepts the send (idempotent). The draft is deleted.                                                                                            | Contributor                                                        |
| recorded (Yes, No, Not applicable) | adopted (becomes a submission and the current answer) | Automatic completion allowed by the slot rule, or a manager confirms it or chooses it in a conflict.                                                   | Rule (system) for automatic completion; manager or admin otherwise |
| recorded                           | declined                                              | Manager declines with a reason.                                                                                                                        | Manager or admin                                                   |
| recorded                           | detail requested                                      | Manager asks for more detail. It stays undecided.                                                                                                      | Manager or admin                                                   |
| recorded                           | replaced                                              | The same person sends a newer finding for the same question, including a requested detail. At most one undecided finding per person and question.      | Contributor                                                        |
| recorded (Couldn't establish)      | seen                                                  | Manager marks it as seen. It can never be adopted.                                                                                                     | Manager or admin                                                   |
| adopted                            | no longer in use (derived)                            | A later answer is adopted, the check is reopened or archived, or its evidence is withdrawn.                                                            | Whoever caused that change                                         |

A contribution is never edited or deleted. A changed mind is a new
contribution with a new idempotency key.

### 4.2 Asset

| From                   | To                                   | Trigger                                                                                                                                                                                                                                         | Accountable actor              |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| reserved               | uploading, processing, ready, failed | Existing upload pipeline (`public.upload_state`).                                                                                                                                                                                               | Uploader; processing is system |
| ready                  | deleted (tombstone `deleted_at`)     | Owner or admin deletes; cleanup.                                                                                                                                                                                                                | Uploader or admin              |
| attached and available | attached and unavailable             | Derived from deletion. A Yes answer whose rule is no longer met goes to recheck (existing trigger). Any other loss sets the answer's evidence to `withdrawn` (new, read-time, [B01 design §10](b01-design.md#10-evidence-loss-review-point-9)). | Whoever deleted                |

### 4.3 Assertion

| From     | To                                   | Trigger                                                                                              | Accountable actor             |
| -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------- |
| (none)   | proposed                             | A `finding` contribution is recorded but not adopted.                                                | Contributor                   |
| proposed | current                              | Adopted.                                                                                             | Rule or manager (see 4.1)     |
| current  | superseded                           | A later assertion is adopted for the same slot.                                                      | Whoever adopted the later one |
| current  | withdrawn                            | The check is archived.                                                                               | Manager or admin              |
| current  | (stays current, slot status changes) | Reopen, evidence loss, dispute or confirmation revocation change the slot status, not the assertion. | See 4.5                       |

### 4.4 Confirmation

| From         | To             | Trigger                                                                                          | Accountable actor                                                                                                                                |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| not_required | (fixed)        | The slot rule version requires none.                                                             | Product owner (rule)                                                                                                                             |
| pending      | confirmed      | Confirmation decision against this exact assertion and check revision.                           | Manager or admin. The assertion's author may confirm only when the rule allows self-confirmation, and the decision records it as self-confirmed. |
| pending      | declined       | Decline with reason. The assertion never becomes current.                                        | Manager or admin                                                                                                                                 |
| confirmed    | revoked        | Revoke with reason.                                                                              | Manager or admin                                                                                                                                 |
| revoked      | confirmed      | A new confirmation decision.                                                                     | Manager or admin                                                                                                                                 |
| any          | (inapplicable) | Any new assertion for the slot. Confirmation binds to an assertion id, so it never carries over. | —                                                                                                                                                |

A confirmation stays valid when the confirming person later loses their grant
or leaves. The decision records the authority basis at the time. **Owner to
confirm.** The alternative, invalidating every confirmation a departing
manager made, removes facts without any new information about the venue.

### 4.5 Current answer status

The resolver ([B01 design §5](b01-design.md#5-one-resolver-review-point-5))
reduces each slot to one status. Unavailable statuses use the reason and
detail vocabulary of the internal reader contract
(`docs/knowledge/internal-reader-api.md` §4), so the reader never translates
states.

| Slot status           | Reason / detail                      | Holds when                                                                                                                                                                                            | Who moves it out                                    |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| available             | —                                    | A current assertion exists and none of the rows below holds. The only status a consumer may present as an answer.                                                                                     | —                                                   |
| out of scope          | `unknown` / `not_enabled`            | No check row, or the slot is not on an active working list. Hides every other state.                                                                                                                  | Admin enables the working list                      |
| withdrawn             | `withdrawn` / `answer_withdrawn`     | The check is archived and had an answer. An archived check that was never answered is `unknown` / `not_enabled`.                                                                                      | Manager or admin restores                           |
| confirmation revoked  | `withdrawn` / `confirmation_revoked` | The rule requires confirmation and the latest decision on the current assertion is a revocation.                                                                                                      | Manager or admin confirms again, or reopens         |
| evidence withdrawn    | `withdrawn` / `evidence_withdrawn`   | Evidence attached to a current No or Not applicable became unavailable, with no later reaffirmation. A Yes goes to `stale` / `evidence_lost` instead (existing trigger).                              | Manager reaffirms or reopens                        |
| disputed              | `disputed` / `conflict`              | An undecided finding or change report exists whose answer differs from the current value, including Couldn't establish sent as a change ("I'm no longer sure"). A same-value report does not dispute. | Manager or admin declines it, adopts it, or reopens |
| reopened              | `stale` / `recheck_requested`        | Check progress is `needs_recheck` and the latest progress event is `reopened`.                                                                                                                        | Contributor recaptures                              |
| evidence lost         | `stale` / `evidence_lost`            | Check progress is `needs_recheck` and the latest progress event is `evidence_lost`.                                                                                                                   | Contributor recaptures                              |
| expired               | `stale` / `expired`                  | Read-time freshness policy says expired. No B01 key has a policy, so this never holds in B01.                                                                                                         | Contributor recaptures                              |
| awaiting confirmation | `not_confirmed` / `pending`          | The rule requires confirmation and the current assertion has no confirming decision; or there is no current assertion and a proposed finding awaits a decision.                                       | Manager or admin                                    |
| declined              | `not_confirmed` / `declined`         | No current assertion, and the newest proposed finding for the slot was declined.                                                                                                                      | Contributor sends a new finding                     |
| unable to establish   | `unknown` / `unable_to_establish`    | No current assertion, and an Unknown contribution was recorded since the slot was last answered or reopened.                                                                                          | Contributor sends a finding                         |
| not checked           | `unknown` / `not_checked`            | No current assertion and none of the above.                                                                                                                                                           | Contributor sends a finding                         |

Precedence follows the reader contract: `withdrawn`, `disputed`, `stale`,
`not_confirmed`, `unknown`. The one exception is out of scope
(`unknown` / `not_enabled`), which is evaluated first and hides everything,
so a slot outside the working list reveals nothing about its state.

The plan's resolution list is proposed, current, disputed, superseded and
withdrawn. Those values remain the assertion's resolution (§4.3). The slot
statuses add the plan's "needs checking" and "awaiting confirmation" semantic
cases (plan §8), which a consumer needs as distinct unavailable reasons.

### 4.6 Publication (contract for B06; nothing implemented in B01)

desired → attempted → acknowledged → verified, with `failed` from attempted
and a withdrawal (tombstone) revision that supersedes any earlier revision.
Ordering uses the answer revision (§5). A destination applies a revision
only when it is newer than the last it applied, so a delayed delivery cannot
resurrect withdrawn information. Accountable actor: the delivery worker,
under a use grant approved by a named granter ([access and rights §6](access-and-rights.md#8-public-use-rule)).

### 4.7 Historical credit

There are no transitions in B01. Credit is a read-time function of immutable
history (`private.monthly_venue_completion_counts`). B01 changes none of its
inputs except by creating completed answers under the existing rule
([B01 design §3](b01-design.md#3-credit-compatibility-review-points-1-and-10)).
Revocation, dispute, evidence withdrawal of No or Not applicable, and
working-list changes do not remove credit until B08 decides otherwise.

## 5. Revisions

Each answer slot has one integer revision:

`answer revision = venue_amenity_checks.revision + (number of knowledge_events rows for the slot)`

Both terms only increase. Every change that can alter the derived status
increases one of them: legacy check changes increment
`venue_amenity_checks.revision`, and every knowledge change (a contribution,
a decision, a working-list change, a rule change, an evidence withdrawal)
inserts at least one `knowledge_events` row for each affected slot. The sum
therefore rises strictly on every relevant change, including when an answer
becomes unavailable, and never decreases, because both sources are
append-only or increment-only. With no knowledge events it equals today's
check revision. Slots without a check row have revision 0 plus their event
count.

## 6. Stored versus derived

Stored, append-only: contributions, contribution assets, submissions,
submission assets, check events, knowledge decisions, knowledge events, rule
versions, and working-list enable and disable records.

Stored, mutable (existing): `venue_amenity_checks`, the operational record of
the amenity workflow. Its mutation rules are unchanged except for the guard in
[B01 design §4](b01-design.md#4-no-silent-overwrite-review-point-2).

Derived at read time: slot status, eligibility, confirmation state, evidence
availability, contribution outcome, the answer revision, freshness and all
credit.

Never manufactured:

- **Observation time.** Not collected in B01. `answered_at`, a submission's
  `created_at`, a legacy fact's `confirmed_at`, asset upload time and the
  migration time are not observation times. They are reported under their own
  names (savedAt, confirmation savedAt, uploadedAt) or not at all.
- **Confirmation.** Task completion or a legacy `confirmed_at` never creates a
  confirmation decision.
- **Attribution.** A missing actor stays missing.
- **Public-use permission.**
