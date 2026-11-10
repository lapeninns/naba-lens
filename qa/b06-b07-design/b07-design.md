# B07 design (WS5): connect NabaPresence without bypassing provider review

Status: design draft 2 (proposal), 10 Nov 2026. Repairs the design-gate review
(reviewer 5dd2f40c: M1 and lows 1 and 2) and the proposal review of the first
repair (B07-1 to B07-3). It is a self-contained replacement for draft 1. It
is not yet reviewed, and it does not qualify any implementation or authorise
any enablement. Changelog: §13. Findings map:
`qa/b06-b07-design/findings-resolution.md`.

Authors: WS5 consumers (draft 1, session a9813544); draft 2 prepared by a pool
worker from the review evidence, read-only. No NabaLens, NabaPresence or
Google data, code or configuration was changed, no SQL was executed, no test,
build or network call was made, and no provider was called.

Plan: §12 (B07-01 to B07-06), §16, §17 (V14), §18, §19. Depends on B03 (value
schemas, qualified answers, freshness), B05 (grants and derivatives) and the
B06 contract (`b06-design.md` draft 2 in this folder: consumer registry,
public projection, immutable publication tuples and eligibility overlays,
epochs, the destination feed and snapshot, receipts).

Source evidence:

| Repository    | Ref                                                    | What was read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| naba-presence | `f003430cfd92f324743faf527ebfce46b9e8f515` (5 Nov 2026) | Draft 1, via `git show`: `AGENTS.md`; `vercel.json`; migrations `0028_import_review.sql`, `0063_gbp_change_sets.sql`, `0065_attribute_change_sets.sql`, `0086_mutation_operation.sql`; `lib/contracts/gbp-change-set.ts`, `mutation-operations.ts`; `lib/server/gbp-change-sets.ts`, `business-information.ts`, `bulk-families/attributes.ts`, `authz/approval-policy.ts`, `mutation-recovery.ts`, `resource-observations.ts`; `lib/domain/google-attributes.ts`, `readback/compare.ts`. Draft 2, read-only in the checkout (HEAD equals `f003430c`; the only local changes are someone else's `supabase/.temp/cli-latest` and `.tmp-view/`, left untouched): `lib/server/business-information.ts` (`confirmBusinessInformation` :475-600, `previewBusinessAttributes` :1043-1095, `updateBusinessAttributes` :1111-1167, `executeBusinessAttributes` :1169-1284); `lib/server/gbp-management.ts` (`gbpManagementAttemptStore` :68-83, `gbpManagementIdempotencyKey` :134-143, `startGbpMutation` :178-258, `settleGbpMutation` :260-280); `lib/server/gbp-confirmation.ts` (`executeAndConfirmGbpMutation` :22-62, `observeAndConfirmGbpMutation` :64-89); `lib/server/google-write-session.ts` (whole file); `lib/server/gbp-change-sets.ts` (`checkedRow` :60-80, `approvedGbpChange` :167-185); `lib/server/operations-health.ts` :370-377; `lib/server/bulk-listing-runner.ts` :385-415; the list of `lib/server` files that reference `mutation_operation`; migrations `0026_complete_gbp_management_foundation.sql` :43-122, `0062_management_confirmation.sql`, `0063_gbp_change_sets.sql` :37-38, `0088_gbp_management_started_at.sql`; the file list under `docs/` (`ci.md`, `release/`, `runbook.md`, `testing.md` exist; not read) |
| NabaLens      | `9bd92504` + WS5 `23e0c0fd`; WS5 `973cfd5c` (draft 2)    | Reader contract; B03 design §3.2, §3.8, §5, §7; B06 draft 2 source list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Programme     | `contracts/b00-03-destination-inventory.md` §1, §3; `evidence/b06-b07-b08-b10-design-reviews.md`; `evidence/b06-b07-pool-proposal.md` (`68ea5995…`); `evidence/b06-b07-proposal-review.md` (`d0250a41…`) | NabaPresence identity, the crosswalk proposal, the reviews                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Draft 1 is `contracts/b07-design.md` (`2f719aac…`). It stays untouched.

**Correction to draft 1 and to the first repair proposal.** Both assumed the
attributes publish path records `mutation_operation.state = 'sent'` before
the Google request. It does not. The single-location attributes publish
(`business-information.ts`, `gbp-management.ts`, `gbp-confirmation.ts`)
never references `mutation_operation` (`0086`); that ledger is used by
other surfaces, including bulk listing runs (`bulk-listings.ts`,
`bulk-listing-runner.ts`). The attributes path at `f003430c` records its attempt in
`gbp_management_mutation` through `startGbpMutation`, and
`executeAndConfirmGbpMutation` commits `execution_state = 'pending',
confirmation_state = 'pending'` on that attempt before `input.execute()`
calls `patchGoogleLocationAttributes`. This draft extends that actual path
(§2.1, §6.3).

---

## 1. Summary

NabaLens offers suggestions; NabaPresence decides, through its own review and
change sets, what reaches Google; Google readback decides what is "live".
Nothing in B07 lets NabaLens write to a provider.

| Task   | Outcome                                                                                                                                                                      | Owner                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| B07-00 | Start gate: read NabaPresence's release, verification and CI process and confirm the publish-path facts in §2.1 before any implementation brief                              | NabaPresence owner, WS5                           |
| B07-01 | An approved crosswalk from NabaLens venues to NabaPresence locations, and a per-location mapping from question keys to Google attributes, with unsupported meanings recorded | NabaPresence owner, WS1 (meaning), WS5 (contract) |
| B07-02 | Idempotent, claim-fenced intake: NabaPresence pulls the B06 destination feed per approved link and epoch and stores one suggestion per publication revision                 | NabaPresence owner; WS5 for the NabaLens feed     |
| B07-03 | A review view comparing each suggestion with a recent Google observation; matching values close as already satisfied                                                          | NabaPresence owner, WS2 for wording               |
| B07-04 | Approval through the existing `gbp_change_set` flow, with source revalidation and an atomic send claim on the real `gbp_management_mutation` attempt                          | NabaPresence owner                                |
| B07-05 | Distinct states back to NabaLens: received, awaiting review, approved, sent, provider-confirmed, rejected, failed, ambiguous (plus the closing states)                       | NabaPresence owner, WS5 (receipts)                |
| B07-06 | Edge-case verification and one narrowly authorised live example with provider readback                                                                                       | WS6, coordinator                                  |

Five design choices:

1. **NabaPresence pulls.** It holds a NabaLens consumer credential
   (`kind = provider_sync`, purpose `provider_suggestion`) and reads the B06
   destination feed. NabaPresence has no machine-to-machine inbound API today
   (only a cron bearer and provider webhooks), so pulling adds no new inbound
   surface there, and NabaLens never holds a NabaPresence or Google secret.
2. **One suggestion per publication revision, scoped to its epoch and
   link.** The intake key is `(organisation, link, epoch, question key,
   publication revision)`, so a duplicate delivery resolves to the same row.
   A higher revision supersedes lower pre-send rows; in-flight rows are never
   superseded, and a newer revision queues behind them.
3. **Reuse the change-set model unchanged in spirit.** A suggestion becomes a
   `gbp_change_set` (`resource_type = 'attributes'`) only when a person
   generates the review from a live Google baseline. The existing hash
   binding, 24-hour approval expiry, two-person policy and current-manager
   checks all apply. B07 adds source checks and binds `sent` to the actual
   persisted attempt.
4. **Unknown, disputed, qualified, settling and withdrawn never become
   provider writes.** They stop at a visible review state. A source
   withdrawal never clears Google by itself; it raises a review item (plan
   §12 rollback).
5. **The source head serialises everything per key.** Intake, prepare,
   approval, the send claim and terminal resolution all lock the same
   `nabalens_source_head` row, so their outcomes are the same in any order.

## 2. What exists in NabaPresence (evidence)

| Concern               | Today (`f003430c`)                                                                                                                                                                                                                                                                                                                                                       | Use in B07                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Tenancy               | `organisation`, RLS by `app.organisation_id` (forced RLS on `gbp_management_mutation`); runtime role `naba_app_runtime`; tenant transactions through `withTenant`                                                                                                                                                                                                      | Every new table follows the same RLS pattern                                                 |
| Location identity     | `location` unique on `(organisation_id, name)`; Google identity in `external_location.google_location_name` (unique per organisation) via one active `location_link`                                                                                                                                                                                                     | Crosswalk to NabaLens is a new explicit table; names never match                             |
| Change sets           | `gbp_change_set` (`0063`; `resource_type` includes `attributes` since `0065`): `payload` + `payload_hash`, `baseline` + `baseline_hash`, `update_mask`, `requested_by`, `approved_by/at`, `require_two_person_approval`, `approval_expires_at` (24 h), `expires_at` (180 d). The runtime role may update only `approved_by`, `approved_at` (and later assurance columns) | B07-04 creates attribute change sets through the existing path                               |
| Approval checks       | `approveGbpChange`: expected payload hash, second approver, current manager, unchanged two-person policy. `approvedGbpChange` at publish: the dispatch pause, then `checkedRow` (`select … for update`, `approval_expired`), `approval_required`, current manager, `approval_stale` on the payload hash                                                                  | B07 adds `source_stale` and `source_unreachable`                                             |
| Attribute reads       | `getGoogleLocationAttributes`, `listGoogleAttributeMetadata`; `unsupportedAttributeNames()` refuses deprecated or wrongly typed values (`BOOL`, `ENUM`, `URL`, `REPEATED_ENUM`) (`lib/domain/google-attributes.ts`)                                                                                                                                                      | B07-01 mapping validation; B07-03 observation                                                |
| Attribute publish     | §2.1                                                                                                                                                                                                                                                                                                                                                                     | B07-04 extends it (§6.3)                                                                     |
| Attempt ledger        | `gbp_management_mutation` (`0026`): `status` `started`/`validated`/`succeeded`/`failed`/`ambiguous`; `unique (organisation_id, idempotency_key)`; `0062` adds `execution_state` (`unrecorded`, `pending`, `accepted`, `rejected`, `unknown`), `confirmation_state` (`unrecorded`, `pending`, `confirmed`, `unresolved`), `confirmation_response`, `confirmation_observed_at`, `confirmation_error_code`; `0063` adds `change_set_id` with a **unique index on `(organisation_id, change_set_id)`**; `0088` adds `started_at` | One attempt per change set; B07 states map from it (§7.2)                                    |
| Attributes readback   | `confirmBusinessInformation` (person-initiated, under the `business_info` and `attributes` lock keys): refuses `google_target_changed`, answers confirmed rows as idempotent, needs `recovery_ready` (`status = 'ambiguous'`, or `started`/`validated` older than 5 minutes), then calls `observeAndConfirmGbpMutation` (a read, never a resend)                       | B07 recovery reuses it (§7.3)                                                                |
| Outcome vocabulary    | `mutation_operation.state` and `OPERATION_OUTCOMES` (`saved_locally`, `awaiting_approval`, `sent`, `awaiting_confirmation`, `confirmed_applied`, `rejected`, `failed`, `uncertain`) for the surfaces that use `mutation_operation`; `mutation-recovery.ts` reads those back and never re-sends                                                                       | B07-05 keeps the same words; the attributes evidence comes from `gbp_management_mutation`    |
| Readback compare      | `lib/domain/readback/compare.ts`; `googleAttributesMatch(observed, attributes, mask)` and `matchesGoogleUpdateMask` compare only the mask's fields                                                                                                                                                                                                                       | B07-05 per-key confirmation                                                                  |
| Inbound suggestions   | `presence_import_proposal` (`0028`): Google-drift suggestions decided per row, pinned hashes, one live row per identity, `superseded` status, 90-day expiry                                                                                                                                                                                                              | The pattern B07-02 copies; not reused directly (fixed `resource_type` and `field_key` lists) |
| Operations health     | `operations-health.ts` counts `gbp_management_mutation` rows `started`, `validated`, `ambiguous` or with `confirmation_state` `pending`/`unresolved`                                                                                                                                                                                                                    | B07's in-flight rows show there too                                                          |
| Scheduling            | Vercel Cron, `/api/jobs/run` every minute                                                                                                                                                                                                                                                                                                                                | Intake, status, resolution and readback run as job kinds                                     |

### 2.1 The attributes publish path at `f003430c`

1. `updateBusinessAttributes` refuses without a `changeSetId`, then runs
   inside `withGoogleWriteSession({ surface: 'business_attributes', keys:
   ['<organisationId>:<locationId>:attributes'] })`. That is a
   **transaction-scoped advisory lock** (`pg_advisory_xact_lock(
   hashtextextended(key, 0))`) on a dedicated session-pooler connection,
   held across the live Google read, the checks, the write and its readback,
   with `lock_timeout` (busy → `409 google_write_busy`), a statement timeout
   and an idle-in-transaction timeout sized from a deadline below the
   route's 60 s. The module states that the lock is **advisory only**: if
   the lock connection fails mid-work, mutual exclusion is lost while the
   work's own pooled transactions settle the outcome. Work must not write
   through the lock connection.
2. Inside the session: `loadedContext` and `canPublish`;
   `approvedGbpChange` (pause, `checkedRow … for update`, expiry, approval,
   current manager, payload hash); `approval_stale` when the reviewed
   baseline hash differs from `expectedGoogleHash`; then a lookup of
   `gbp_management_mutation where change_set_id = $1`. An existing attempt
   returns `idempotent: true` and nothing is sent.
3. `executeBusinessAttributes`: `writesEnabled()`, token, a live
   `getGoogleLocationAttributes` whose hash must equal `expectedGoogleHash`
   (`attributes_stale`), metadata and `unsupportedAttributeNames`.
4. `startGbpMutation({ resourceType: 'attributes', operation: 'patch',
   targetResourceName: '<googleLocationName>/attributes', requestId:
   changeSetId, changeSetId, blockUnresolved: true, lockHeld: true, … })`
   runs **one** `withTenant` transaction: (`lockHeld` skips re-taking the
   advisory key) find an attempt by idempotency key (`attributes:patch:
   <target>:<changeSetId>`) and return it as idempotent; the
   **unresolved-operation guard** refuses `409
   google_confirmation_unresolved` if any attributes attempt at the location
   is `started`, `validated` or `ambiguous` or has `confirmation_state`
   `pending`/`unresolved`; then `attemptStore.start` inserts the attempt
   with `on conflict do nothing` (a concurrent winner returns its row as
   idempotent).
5. `executeAndConfirmGbpMutation` commits `execution_state = 'pending',
   confirmation_state = 'pending'`, calls `patchGoogleLocationAttributes`,
   records `accepted`, `unknown` (2xx without a resource body, or an
   ambiguous transport error) or `rejected` (an `ApiError`, with `status =
   'failed'` and the error code), then reads back, records
   `confirmation_state` `confirmed` or `unresolved` with the observed
   payload, caches the snapshot, and settles `succeeded` or `ambiguous`.
6. `auditGbpMutation` writes the audit row.
7. **Bulk attribute children use the same advisory key but another
   ledger.** `bulk-listing-runner.ts` (:395-415) takes the same per-location
   key (`<org>:<location>:<resourceKey>`, mode `try`; when busy, the child
   returns to `queued` with `resource_busy`, deferred) from its baseline
   read through readback. Its durable attempt is a
   `bulk_listing_write_attempt` row (`0125_bulk_child_receipts.sql`, with
   `family in ('attributes', 'place_action')`, `location_id` and `status in
   ('validating', 'validated', 'publishing', 'succeeded', 'failed',
   'ambiguous')`). `runGbpWrite`'s start transaction inserts it
   (`gbp-write.ts` :1116 `store.start`, via `runBulkWrite` in
   `bulk-families/write-attempts.ts` :305). Its receipt is in
   `mutation_operation`, linked from `bulk_listing_child.mutation_operation_id`.
   That start transaction never reads `gbp_management_mutation`, and the
   step 4 guard never reads `bulk_listing_write_attempt`, so each guard is
   blind to the other path. Once either path's send is ambiguous and its
   advisory session has ended or been lost, the other path can take the key
   and send while the earlier effect is unresolved. B07 closes this in both
   directions with one shared claim fence (§6.5).

## 3. B07-00 start gate and B07-01 identity and field mapping

### 3.0 B07-00 start gate (low 1)

Before any B07 implementation brief, the NabaPresence owner and WS5:

1. read NabaPresence's release and verification process and CI profile
   (`docs/ci.md`, `docs/release/`, `docs/runbook.md`, `docs/testing.md`,
   which exist at `f003430c` and were not read for this draft) and
   `0026_complete_gbp_management_foundation.sql` in full;
2. confirm each fact in §2.1 on the then-current head, and that the
   retention cron's stranded-attempt reaper
   (`lib/server/retention/purge.ts`) never removes an attempt referenced by
   an in-flight suggestion;
3. classify the attributes path's provider error codes into "Google refused"
   and "request did not complete" (OD-B7-8);
4. pin both actual unresolved-attempt predicates and the shared location
   attributes claim fence of §6.5 on the then-current head: the
   single-attribute predicate on `gbp_management_mutation` (§2.1 step 4) and
   the bulk predicate on `bulk_listing_write_attempt` (§6.5). Confirm that
   bulk recovery (`mutation_recover`, `bulkAttributesRecoveryAdapter`)
   always settles the attempt row's `status`; if it does not, the bulk
   predicate also reads the linked `mutation_operation` receipt state.
   Confirm the two claim phases of §6.5 item 3 (`beforeClaim` before
   `beginIntent`, `beforeStart` immediately before `store.start`) and that
   `runBulkWrite`'s catch is still the only place the attributes bulk path
   maps a thrown claim error. The fence is a B07 implementation dependency
   for every mapped location;
5. record any difference as a change to this design before work starts.

### 3.1 Sub-tasks

| ID      | Deliverable                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B07-01a | `nabalens_location_link`: `(organisation_id, location_id) ↔ nabalens_venue_id`, unique on both sides, with the approver and the evidence shown at approval; rows are never edited except revocation, so a link's `id` is its version |
| B07-01b | `nabalens_field_mapping` per location: question key → Google attribute resource name, value map, mapping version, state, approver; validated against that location's live attribute metadata |
| B07-01c | Unsupported-meaning register: the question keys and value cases NabaPresence will never send, with the reason shown in the review view                                                       |
| B07-01d | The NabaLens side: destination `nabapresence_google_<venue>` per approved venue (B05 registry), a `provider_sync` consumer, and a field manifest whose `publishable_fields` are `value` only |

### 3.2 Acceptance criteria

1. A NabaLens venue reaches a NabaPresence location only through an approved
   link row. The approval screen shows the NabaLens venue ID and name, the
   location's `google_location_name`, place ID and address, and the website
   domain from the B00-03 crosswalk; it never pre-selects by name. The two
   White Horse venues are approved separately, compared by postcode.
2. A mapping is approved only when the location's attribute metadata lists
   the attribute, it is not deprecated, and every mapped value is valid for
   its `valueType` (`unsupportedAttributeNames` returns nothing).
3. Metadata is re-checked when the review is generated (B07-04); a mapping
   whose attribute has become unsupported moves the suggestion to
   `unsupported`, not to an error.
4. A mapping never sends credentials or staff text. `guest_wifi` maps at most
   the presence (or free versus paid, once B03 has a publishable detail for
   it), never anything else.
5. Relinking a location, or linking a venue again after revocation, creates
   a new link row with a new cursor that must bootstrap from a complete
   snapshot, even when the source revision is unchanged (§4.6).
6. A mapping change is one transaction that disables the old version and
   inserts the new one, so it serialises with the send claim's lock on the
   old row (§6.3).

### 3.3 Proposed pilot mappings (owner to confirm, OD-B7-2)

Attribute names must come from the location's live metadata at approval; the
names below are what to look for, not verified identifiers.

| Question key         | Google attribute to look for               | Value map                                                                       | Notes                                                                                                                      |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `guest_toilets`      | a restroom attribute (`BOOL`)              | Yes → `true`; No → `false`                                                      | Closest match in meaning                                                                                                   |
| `onsite_parking`     | an on-site or free parking attribute       | Yes → `true` only if the attribute means on-site parking without a charge claim | "Free" is not something NabaLens records in v1; a "free parking" attribute is **unsupported** until B03 records charges    |
| `step_free_entrance` | a wheelchair-accessible entrance attribute | **Unsupported by default**                                                      | Step-free is weaker than wheelchair accessible; sending it would overstate an accessibility claim. Needs OD-B7-3 and OD-12 |
| `guest_wifi`         | a Wi-Fi attribute (`ENUM`, free or paid)   | Unsupported until B03 publishes free versus paid                                | Never the password; never test notes                                                                                       |

Not applicable is never sent. Unknown, `not_confirmed`, `stale`, `disputed`,
`settling` and `withdrawn` produce no proposed value (§4.4).

### 3.4 Data model (NabaPresence migration, owner: NabaPresence)

```sql
create table nabalens_location_link (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  nabalens_venue_id uuid not null,
  destination_key text not null,      -- nabapresence_google_<venue>, as approved
  evidence jsonb not null,            -- google_location_name, placeId, address, domain shown at approval
  approved_by uuid not null references app_user(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references app_user(id) on delete restrict
);
create unique index nabalens_location_link_location on nabalens_location_link (organisation_id, location_id) where revoked_at is null;
create unique index nabalens_location_link_venue on nabalens_location_link (organisation_id, nabalens_venue_id) where revoked_at is null;

create table nabalens_field_mapping (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  question_key text not null,
  mapping_version integer not null,
  attribute_name text not null check (attribute_name ~ '^attributes/[^\s/,]+$'),
  value_map jsonb not null,          -- {"yes": true, "no": false}; absent answers are never sent
  state text not null check (state in ('active', 'disabled')),
  metadata_snapshot jsonb not null,  -- the metadata row checked at approval
  approved_by uuid not null references app_user(id) on delete restrict,
  approved_at timestamptz not null default now(),
  unique (organisation_id, location_id, question_key, mapping_version)
);
create unique index nabalens_field_mapping_active on nabalens_field_mapping (organisation_id, location_id, question_key)
  where state = 'active';
```

Both: RLS on `app.organisation_id` as every other table; runtime role gets
select and insert, plus update of `revoked_at`, `revoked_by` and `state` only.

## 4. B07-02: idempotent suggestion intake

### 4.1 Sub-tasks

| ID      | Deliverable                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B07-02a | NabaLens: the destination feed and snapshot (B06 §4.8) return, per settled current item, `seq`, `venueId`, `fieldKey`, `questionKey`, `publicationRevision`, `state`, `value`, `qualification` (schema `1.1`), `confirmedBy` (role), `validUntil`, `evidence` (public derivative publication IDs only, when a grant names this destination), `permittedUse` (`provider_suggestion`), `digest`, plus the epoch; superseded items value-free |
| B07-02b | NabaPresence: `nabalens_suggestion`, `nabalens_source_head`, `nabalens_intake_cursor`, `nabalens_intake_event` and a job kind `nabalens_intake` that pulls the feed per approved link from its stored, epoch-scoped cursor under a claim token                                                                                                                  |
| B07-02c | Supersession: a higher revision for the same key moves the pre-send row (`received`, `awaiting_review`, `approved`) to `superseded`; an `unavailable` or `withdrawn` publication moves it to `withdrawn_at_source`. Rows in flight (`sent`, `awaiting_confirmation`, `uncertain`) are never superseded; a newer revision queues behind them (§4.5)             |
| B07-02d | Intake refusals recorded as states, not dropped: `unsupported` (no active mapping, qualified, Not applicable), `not_linked` (venue without an approved link)                                                                                                                                                                                                     |
| B07-02e | Bootstrap and epoch reset from the complete snapshot (§4.6)                                                                                                                                                                                                                                                                                                      |

### 4.2 Acceptance criteria

1. Delivering the same publication twice, or concurrently, leaves one row.
2. A lower or equal revision arriving after a higher one in the same epoch
   is recorded as ignored and changes nothing; the rest of its page is still
   processed.
3. A suggestion holds no staff identity, staff text, evidence original,
   asset ID or Wi-Fi detail. Evidence is a public derivative URL only, and
   only where a B05 grant names this destination; otherwise none.
4. Pausing intake (a setting per organisation) stops new rows; open rows and
   their review continue.
5. A newer revision is never dropped. It is recorded in the source head and,
   when reviewable, as a pre-send row, whatever state the older row is in.
6. The cursor advances only in the transaction that durably records every
   item up to it, under a live claim token, the same epoch and the same
   active link.
7. A NabaLens outage stops intake without losing anything: the cursor is
   kept, retries back off, and the status shows "Intake behind since
   {time}", with an alert after 30 minutes. Open rows and their review
   continue. This is separate from `source_unreachable` at publish time (low
   2).

### 4.3 Data model (NabaPresence)

```sql
create table nabalens_suggestion (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  link_id uuid not null references nabalens_location_link(id) on delete restrict,
  nabalens_venue_id uuid not null,
  destination_key text not null,
  epoch_id uuid not null,
  epoch_ordinal integer not null,
  field_key text not null,
  question_key text not null,
  publication_revision bigint not null,
  scope_seq bigint not null,
  source_digest text not null,
  source_state text not null check (source_state in ('published', 'unavailable', 'withdrawn')),
  proposed jsonb,                    -- {"value": "yes"}; null unless published
  qualification jsonb,
  confirmed_by text check (confirmed_by in ('venue_manager', 'admin')),
  valid_until timestamptz,
  evidence jsonb not null default '[]',
  mapping_id uuid references nabalens_field_mapping(id),
  mapping_version integer,
  status text not null check (status in ('received', 'awaiting_review', 'already_satisfied',
    'unsupported', 'not_linked', 'superseded', 'withdrawn_at_source', 'approved', 'sent',
    'awaiting_confirmation', 'confirmed_applied', 'rejected', 'failed', 'uncertain')),
  status_reason text,
  provider_detail text check (provider_detail in ('behind_in_flight', 'source_changed_during_flight',
    'source_withdrawn_during_flight')),
  change_set_id uuid references gbp_change_set(id) on delete set null,
  mutation_id uuid,                  -- the gbp_management_mutation attempt that carried it; kept after retention
  decided_by uuid references app_user(id) on delete set null,
  decided_at timestamptz,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,           -- set on entering confirmed_applied, failed or rejected after send
  unique (organisation_id, link_id, epoch_id, question_key, publication_revision),
  check ((status in ('sent', 'awaiting_confirmation', 'uncertain', 'confirmed_applied')) <= (mutation_id is not null))
);
create unique index nabalens_suggestion_pending on nabalens_suggestion (organisation_id, location_id, question_key)
  where status in ('received', 'awaiting_review', 'approved');
create unique index nabalens_suggestion_in_flight on nabalens_suggestion (organisation_id, location_id, question_key)
  where status in ('sent', 'awaiting_confirmation', 'uncertain');

-- The newest settled NabaLens tuple per key and link; the serialisation point (§1 choice 5).
create table nabalens_source_head (
  organisation_id uuid not null references organisation(id) on delete cascade,
  link_id uuid not null references nabalens_location_link(id) on delete restrict,
  question_key text not null,
  field_key text not null,
  epoch_id uuid,                     -- null only for a placeholder row created to take the lock
  epoch_ordinal integer,
  publication_revision bigint,
  scope_seq bigint,
  source_digest text,
  source_state text check (source_state in ('published', 'unavailable', 'withdrawn')),
  valid_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organisation_id, link_id, question_key)
);

create table nabalens_intake_cursor (
  organisation_id uuid not null references organisation(id) on delete cascade,
  link_id uuid not null references nabalens_location_link(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  nabalens_venue_id uuid not null,
  destination_key text not null,
  epoch_id uuid,                     -- null until the first bootstrap
  epoch_ordinal integer,
  feed_cursor bigint not null default 0,  -- the last covered scope_seq in epoch_id
  claim_token uuid,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  consecutive_failures integer not null default 0,
  behind_since timestamptz,
  last_success_at timestamptz,
  last_error text,
  halted_reason text check (halted_reason in ('cursor_ahead', 'epoch_regressed', 'revision_conflict', 'link_revoked')),
  primary key (organisation_id, link_id),
  check ((claim_token is null) = (claim_expires_at is null))
);

create table nabalens_intake_event (   -- append-only diagnostics
  id bigint generated always as identity primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  link_id uuid not null,
  epoch_id uuid not null,
  scope_seq bigint not null,
  question_key text not null,
  publication_revision bigint not null,
  outcome text not null check (outcome in ('ignored_stale', 'recorded', 'head_only')),
  created_at timestamptz not null default now()
);

create table nabalens_review_item (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  question_key text not null,
  kind text not null check (kind in ('source_withdrawn_after_confirm')),
  confirmed_suggestion_id uuid not null references nabalens_suggestion(id) on delete restrict,
  head_epoch_ordinal integer not null,
  head_revision bigint not null,
  head_state text not null check (head_state in ('unavailable', 'withdrawn')),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references app_user(id) on delete set null,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now(),
  unique (organisation_id, confirmed_suggestion_id, kind)
);

create table nabalens_receipt_outbox (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  suggestion_id uuid not null references nabalens_suggestion(id) on delete restrict,
  kind text not null,                -- provider_* (§7.4)
  provider_detail text,
  close_reason text,
  occurred_at timestamptz not null default now(),
  posted_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  unique (organisation_id, suggestion_id, kind)
);
```

- Each key has at most one pre-send row and at most one in-flight row. Intake
  inserts with `on conflict (organisation_id, link_id, epoch_id,
  question_key, publication_revision) do nothing`: the explicit revision
  identity, and only it. A conflict on `nabalens_suggestion_pending` is
  never suppressed; it raises and aborts the page (§4.5), so a missing
  suggestion can never sit behind an advanced cursor.
- RLS and grants follow §3.4. The runtime role may update only the status
  columns of `nabalens_suggestion`, the head and cursor columns, and
  `status`/`closed_*` of review items; delete is not granted on any of
  them.
- **Lock order**, used by every B07 transaction: the link row, then the
  source heads of the affected keys in `question_key` order, then
  suggestions, then the change set, then everything else. This prevents
  deadlocks between intake, the send claim and resolution.

### 4.4 Which publications become reviewable

| Feed item (settled, current)                                            | Suggestion status                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `published`, value Yes or No, active mapping, no in-flight row for the key | `awaiting_review`                                                                                      |
| `published`, value Yes or No, active mapping, a row in flight for the key | `awaiting_review` with `provider_detail = 'behind_in_flight'`, shown "Newer NabaLens answer waiting: the earlier change is still being confirmed"; cannot be prepared until the in-flight row resolves (§6.1) |
| `published`, Not applicable                                             | `unsupported` ("Not applicable is not sent to Google")                                                   |
| `published` with `qualification` (Conditional, temporarily unavailable) | `unsupported` with the qualifier shown; never sent as a plain Yes                                         |
| `unavailable` (any reason) or `withdrawn`                               | head only, no new reviewable row; the pre-send row → `withdrawn_at_source`; review-item rule (§7.5)      |
| No active mapping, or mapping unsupported                               | `unsupported`                                                                                             |
| Venue not linked                                                        | `not_linked`                                                                                              |
| `superseded: true` (a historic, value-free tuple)                       | head rises; the pre-send row below it → `superseded`; no new row                                         |

The feed never returns `settling` or an overlay as an item: such an item
ends the page before it (B06 §4.8). `received` is the status vocabulary's
first state and the `provider_received` receipt; in the pilot intake
classifies in the same transaction, so a persisted row is always in one of
the statuses above.

### 4.5 Intake transaction (claim-fenced)

**Claim-owned writes.** Every write a claim holder makes to its cursor row
after step 1 (the page commit, the bootstrap commit, an error or backoff,
and a halt) is guarded the same way. In its transaction it first locks
the row (`select … from nabalens_intake_cursor where organisation_id =
$org and link_id = $link for update`), then runs one guarded `update`
whose predicate is the **live claim guard**:

```sql
organisation_id = $org and link_id = $link and claim_token = $token
  and claim_expires_at > clock_timestamp()
```

`clock_timestamp()` is evaluated by that `update`, after the row lock was
obtained; `now()` is fixed at transaction start and is never used for a
lease. No row means the claim expired or was replaced: the write changes
nothing (it neither releases the token nor changes the cursor, halt,
failure count, `next_attempt_at`, `behind_since` or `last_error`). An
expired token that has never been replaced therefore stays on the row
until a new claim (step 1) takes it over, and that claimant re-detects any
condition the late writer saw.

Each `nabalens_intake` job handles one link:

1. **Claim** (its own short tenant transaction):
   `update nabalens_intake_cursor set claim_token = gen_random_uuid(),
   claim_expires_at = clock_timestamp() + interval '2 minutes' where
   organisation_id = $org and link_id = $link and halted_reason is null and
   next_attempt_at <= clock_timestamp() and (claim_token is null or
   claim_expires_at < clock_timestamp()) returning
   claim_token, epoch_id, epoch_ordinal, feed_cursor`. No row: another
   claim is live, or the cursor is halted or backing off. A cursor with
   `epoch_id is null` goes to the bootstrap (§4.6).
2. **Fetch** outside any transaction: `GET …/publications?venueId=&epoch=
   <epoch_id>&after=<feed_cursor>&limit=100`, within the claim's expiry
   minus a margin. `409 epoch_changed` → bootstrap (§4.6) under the same
   claim. `409 cursor_ahead` → halt (step 6, §4.7). A network failure, timeout,
   `publication_paused` or `5xx` → step 5. `403 not_permitted` (the link's
   credential does not cover the stream's complete field set, B06 §4.8) →
   step 5 with `feed_not_permitted` and an alert. No identity was returned,
   and the cursor stays.
3. **Validate the page** before opening the transaction: schema-valid,
   every item for this link's destination and venue, `seq` values exactly
   `feed_cursor + 1, feed_cursor + 2, …` up to `coveredThrough` with no gap
   or repeat. Anything else is malformed → step 5 with `feed_malformed`,
   and an alert.
4. **Commit** in one tenant transaction:
   1. `select … from nabalens_intake_cursor where organisation_id = $org and
      link_id = $link for update`; require `claim_token = $token`,
      `claim_expires_at > clock_timestamp()` (read after the row lock is
      acquired; `now()` is fixed at transaction start and is never used for
      a lease), `epoch_id = page.epoch`
      and `feed_cursor = $old`. Any mismatch: roll back and drop the page
      (another claim owns it, or it is late).
   2. `select … from nabalens_location_link where id = $link and
      revoked_at is null for share`; no row: roll back, then persist the
      `link_revoked` halt (step 6).
   3. Create missing head rows for the page's keys (`insert … on conflict do
      nothing`) and lock them `for update` in `question_key` order.
   4. For each item in `seq` order:
      - **Digest conflict** (same epoch, `publicationRevision` equal to the
        head revision, digest different): roll back the page, then persist
        the `revision_conflict` halt (step 6). This means a same-epoch
        restore was observed (B06 §5.8.5).
      - **Stale or duplicate** (same epoch, `publicationRevision` ≤ head
        revision, otherwise): write an `ignored_stale` intake event and
        **continue** with the next item.
      - **Historic** (`superseded: true`): move the pre-send row for the key
        with a lower revision to `superseded`; advance the head to the item.
      - **Current**: move the pre-send row for the key (if lower) to
        `superseded` or `withdrawn_at_source` per §4.4, never touching an
        in-flight row; insert the new row per §4.4 with the revision
        conflict target; evaluate the review-item rule (§7.5) for a
        negative item; advance the head; add outbox rows.
      - Any other error (a pending-index unique violation, a constraint, a
        mapping lookup error) raises and rolls back the whole page.
   5. `update nabalens_intake_cursor set feed_cursor = page.coveredThrough,
      claim_token = null, claim_expires_at = null, consecutive_failures = 0,
      behind_since = null, last_success_at = now(), last_error = null where`
      the live claim guard (the row is already locked by 4.1). No row means
      the claim expired during the commit: roll back the page. Otherwise
      commit.
5. **Error or backoff** (its own transaction, a claim-owned write): lock
   the cursor row `for update`, then `update … set last_error = $code,
   consecutive_failures = consecutive_failures + 1, behind_since =
   coalesce(behind_since, now()), next_attempt_at = now() + backoff,
   claim_token = null, claim_expires_at = null where` the live claim guard.
   A late error from an expired claim, whether or not its token has been
   replaced, matches nothing and changes nothing: no release, no failure
   count, no backoff. Backoff: 1, 2, 5, 10, then every 15 minutes;
   "Intake behind" alerts after 30 minutes.
6. **Halt** (its own transaction, a claim-owned write). A halt found in a
   page or bootstrap transaction that must roll back (`link_revoked`,
   `revision_conflict`, `epoch_regressed`), or found at the fetch
   (`cursor_ahead`, §4.7), is persisted after that rollback in a separate
   transaction under the same live claim: lock the cursor row `for
   update`, then `update … set halted_reason = $reason, last_error =
   $reason, claim_token = null, claim_expires_at = null where` the live
   claim guard. The halt does not change the cursor, failure count or
   backoff. The alert is raised when the halt row is written. No row means
   the claim expired or was replaced: nothing is halted by this worker, and
   the next live claim meets the same condition and halts under its own
   claim.

Why no item is skipped: the B06 feed is one stream per epoch, destination
and venue; every producer of that stream holds the venue's lock until
commit, so `scope_seq` *n+1* commits after *n* is visible; the feed returns
only a settled prefix; the page check rejects any gap; and the cursor
advances only to the covered prefix, atomically with every item's effect. A
stale item is ignored on its own and the loop continues, so the page suffix
is always processed. A crash at any step leaves the cursor unchanged; every
write is idempotent, so the retried page gives the same rows.

### 4.6 Bootstrap and epoch reset

A cursor with no epoch (a new link) or a `409 epoch_changed` fetches `GET
…/snapshot?venueId=` under the current claim (a `409 settling` backs off
and retries through §4.5 step 5). Then, in one tenant transaction with the
fences of §4.5 step 4.1 and 4.2 (except that `epoch_id` must be null or
have a lower ordinal than the snapshot's; a stored epoch with a higher
ordinal, or the same ordinal and a different ID, rolls back and persists
the `epoch_regressed` halt through §4.5 step 6; a revoked link persists
`link_revoked` the same way):

1. Lock the heads for every key in the snapshot and every key the link
   already has a head for, in key order.
2. For every key in the snapshot, apply the item as in §4.5 step 4.4, except
   that a head from an older epoch is replaced whatever its revision. Old-
   epoch pre-send rows for the key move to `superseded` with
   `status_reason = 'epoch_reset'`; their approvals can no longer pass the
   send claim (§6.3).
3. For every key the link holds a head for that the snapshot omits (a
   missing tombstone after a restore), set the head to `withdrawn` in the
   new epoch with no revision of its own (`publication_revision = 0`), move
   the pre-send row to `withdrawn_at_source` with `status_reason =
   'epoch_reset'`, keep any in-flight row, evaluate the review-item rule
   (§7.5), and never clear Google.
4. Set the cursor's `epoch_id`, `epoch_ordinal` and `feed_cursor =
   snapshot.fence` and clear the claim, with the live claim guard of §4.5
   (the row is locked by the step 4.1 fence; no row rolls back the whole
   bootstrap). Commit.

The snapshot is read from an epoch NabaLens accepted only after its
rebuild settled (B06 §5.8 step 3.7), so each item is that field's final
settled head in the new epoch, at revision 1 or higher; the bootstrap
replaces an older-epoch head whatever either revision is. After a restore
two cases follow (P19a, P19b):

- a key **present** in the snapshot as a settled `withdrawn` tombstone
  (a restored field whose lost withdrawal RB-12 replayed) is applied by
  step 2: the head becomes that tombstone, old-epoch pre-send rows close
  `superseded` / `epoch_reset`, and the review-item rule is evaluated;
- a key the link holds but the snapshot **omits** (a field first delivered
  after the backup point and missing from the restored register) is
  handled by step 3: a `withdrawn` head at revision 0, pre-send rows close
  `withdrawn_at_source` / `epoch_reset`, and the review-item rule is
  evaluated.

In both, in-flight rows are kept, provider audit history is untouched and
no provider mutation happens during the reset.

In-flight rows from the old epoch resolve normally (§7.3); completion is
judged against the new head (§7.6). Provider audit rows (attempts, change
sets, receipts) are never deleted or rewritten.

### 4.7 Halts

`cursor_ahead` (the feed's high-water is below the stored cursor in the
same epoch: a restore without a new epoch, B06 §5.8.5), `epoch_regressed`,
`revision_conflict` and `link_revoked` set `halted_reason` only through
the claim-owned halt write of §4.5 step 6: its own transaction, after any
page or bootstrap rollback, under the live claim guard (exact organisation,
link and token, and `claim_expires_at > clock_timestamp()` evaluated after
the cursor row lock). A halt from an expired or replaced claim writes
nothing; the next live claim re-detects the condition. A persisted halt
stops intake for the link and alerts. Open rows stay as they are.
`link_revoked` is terminal for that link's cursor: a relink is a new link
row with its own cursor and bootstrap (P3), and no halt is cleared for it.
For `cursor_ahead`, `epoch_regressed` and `revision_conflict`, nothing
resumes until a new NabaLens epoch is accepted and the cursor bootstraps;
clearing the halt is an owner action recorded in the audit log (OD-B7-9).

## 5. B07-03: review view

### 5.1 Sub-tasks and acceptance

| ID      | Deliverable and acceptance                                                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B07-03a | Observation: before showing a suggestion, read the location's attributes from Google (or use a stored observation younger than the editor's staleness budget, `presence_resource_reconcile_state`); record it with the time read                                 |
| B07-03b | Comparison: proposed provider value versus observed value, normalised as `readback/compare.ts` does. Equal → `already_satisfied`, closed with the observation as evidence. For a row behind an in-flight write, only an observation read after the in-flight row's `resolved_at` counts |
| B07-03c | The view shows: the question in plain words, the NabaLens value and who confirmed it (role), conditions and qualifier, `validUntil`, the observation time, unsupported details, the exact provider change (attribute, current value, new value, update mask), any "newer answer waiting" or open review item |
| B07-03d | Actions: "Prepare change for approval" (creates the change set, B07-04), "Not now" (stays open), "Reject" (with a reason; `rejected`)                                                                                                                            |
| B07-03e | Wording owned by WS2 with the NabaPresence owner; "live" used only for `confirmed_applied`                                                                                                                                                                       |

A disagreement between the NabaLens value and Google's current value is the
normal case to review, not an error; the reviewer decides.

## 6. B07-04: change-set approval, revalidation and the send boundary

### 6.1 Prepare (B07-04a)

"Prepare change" builds the attribute payload from the active mapping, reads
the Google baseline and calls the existing `previewBusinessAttributes` /
`saveGbpChangeSet({ resourceType: 'attributes', … })`. It first refuses:

- `source_stale`: the suggestion is not `awaiting_review`, or the head (read
  under `for share`) is not at the suggestion's epoch and revision, or not
  `published`;
- `source_unreachable` or `source_stale`: a live NabaLens read of the key
  (B06 answers route, `audience=public`, purpose `provider_suggestion`) is
  unreachable, `publication_paused`, `settling`, a withdrawal overlay, or a
  settled tuple other than the suggestion's `(epoch, revision, digest)`;
- `in_flight_pending`: any suggestion at the location is in flight, or any
  `gbp_management_mutation` with `resource_type = 'attributes'` at the
  location is unresolved by the §2.1 step 4 guard's predicate, or any bulk
  attributes attempt at the location is unresolved by the bulk predicate on
  `bulk_listing_write_attempt` (§6.5). There is one Google attributes
  resource per location, so this covers every mapped key. This is an early
  refusal; the enforcing check is the claim fence of §6.5;
- `google_baseline_stale`: the observation used was read before the latest
  `resolved_at` of any in-flight row at the location;
- `attribute_not_supported`: metadata refuses the mapping (the suggestion
  moves to `unsupported`).

Otherwise it adds a nullable `source_ref jsonb` column value on the change
set: an array with one entry per suggestion in the change set (normally
one; several keys at one location may share a change set), each
`{ suggestionId, venueId, questionKey, fieldKey, epochId, epochOrdinal,
publicationRevision, digest, validUntil, mappingId, mappingVersion, linkId
}`. A suggestion whose earlier change set's approval expired may be prepared
again; it stays `awaiting_review` until approved.

### 6.2 Approve (B07-04b)

Approval is unchanged (`approveGbpChange` with the expected payload hash,
two-person policy, current manager). When `source_ref` is set, the same
tenant transaction locks the link (`for share`) and the heads (`for share`,
key order), requires each head to equal its `source_ref` entry and each
suggestion to be `awaiting_review`, and moves the suggestions to `approved`.
Otherwise it refuses `source_stale` and approves nothing.

### 6.3 Publish: the send claim on the actual attempt (B07-04c)

When the change set has `source_ref`, the existing path of §2.1 runs with
these additions, in this order:

1. **Unchanged:** `withGoogleWriteSession` with the existing key
   `'<organisationId>:<locationId>:attributes'`; `loadedContext`,
   `canPublish`; `approvedGbpChange`; the reviewed-baseline check; the
   existing-attempt lookup by `change_set_id`. An existing attempt is
   **never redispatched**: B07 runs resolution for its suggestions (§7.3)
   and returns the idempotent result.
2. **New, outside any transaction:** a live NabaLens read of every key in
   `source_ref`. Each must be a settled tuple equal to its entry, in an
   accepted epoch, `published`, with `validUntil` in the future. Unreachable
   or paused → `409 source_unreachable`; anything else → `409
   source_stale`. Nothing is written.
3. **Unchanged:** `executeBusinessAttributes`: `writesEnabled()`, the live
   Google read and `attributes_stale`, metadata and
   `unsupportedAttributeNames`.
4. **Changed: one tenant transaction claims the attempt and the
   suggestions.** `startGbpMutation` gains two optional hooks that run inside
   its existing `withTenant` transaction: `beforeStart(sql)` and
   `afterStart(sql, attempt)`. In that single transaction:
   1. `beforeStart` takes the B07 locks in the lock order of §4.3: the
      active link row `for update` (this serialises every B07 send claim at
      the location in the database, independent of the advisory lock, which
      the write session documents can be lost); the heads `for update`; the
      mapping rows `for share`; the suggestions `for update`; the change set
      `for update`.
   2. `beforeStart` revalidates, refusing `source_stale` (and rolling back)
      unless: the link is the same row and not revoked; every head equals its
      entry (epoch, revision, digest), is `published` and its `valid_until`
      is in the future; the intake cursor for the link is not halted and is
      in the same epoch; every mapping is the active version named in the
      entry; every suggestion is `approved` with this `change_set_id`; the
      change set is still approved, unexpired (`approval_expires_at >
      now()`), with the same payload hash and `source_ref`; and no
      suggestion at the location is in flight.
   3. **Changed (§6.5):** the shared location attributes claim fence row
      `for update`; then, unchanged, the existing-attempt `find`; then the
      location's attributes unresolved-operation guard (all attributes
      operations at the location, not only mapped keys), now evaluated over
      both ledgers, `gbp_management_mutation` and
      `bulk_listing_write_attempt`; then `attemptStore.start` with `on
      conflict do nothing`.
   4. `afterStart`, only when `start` created the attempt: `update
      nabalens_suggestion set status = 'sent', mutation_id = $attempt,
      updated_at = now() where id = any($ids) and status = 'approved' and
      change_set_id = $changeSet`; fewer rows than `$ids` raises
      `source_stale`, rolling back the attempt insert too. Then one
      `provider_sent` outbox row per suggestion.
   5. Commit. The attempt row, its `change_set_id` association, the `sent`
      transitions and the outbox rows become visible together, or none of
      them does.
   When `start` found or lost to an existing attempt, `afterStart` does not
   run, nothing is marked `sent` by this request, and nothing is sent.
5. **Unchanged:** `executeAndConfirmGbpMutation` for the attempt this
   request created, and only for it: Google is called only after step 4
   committed.
6. **New:** after the attempt settles, and after any error thrown once step
   4 committed, call resolution (§7.3) for the attempt.

Consequences:

- **Intake against publish.** Both lock the head `for update`. If intake
  commits first with a higher revision, step 4.2 sees the head moved and
  refuses `source_stale`; no attempt exists and Google is not called. If
  the claim commits first, the row is `sent`, and intake then queues the
  newer revision as a `behind_in_flight` pre-send row.
- **Two keys, one resource.** Two change sets at one location serialise on
  the link row in step 4.1 and on the unresolved guard in step 4.3; the
  second sees an in-flight suggestion or an unresolved attempt and refuses.
- **Bulk against single, either order.** Both claims lock the same fence
  row before checking both ledgers (§6.5). An unresolved bulk attempt
  refuses this claim with `google_confirmation_unresolved`. An unresolved
  attempt from this claim makes a later bulk child's claim throw the typed
  pre-attempt refusal, which the attributes bulk path maps to the existing
  `deferred` / `resource_busy` outcome, so the child returns to `queued`
  (§6.5 item 3). If
  the advisory sessions are lost, simultaneous claims still serialise on
  the fence, and only one commits a new attempt.
- **Mapping or link change after the live reads.** The change is one
  transaction that updates the old mapping or link row; it either commits
  before step 4.1 (then 4.2 refuses `source_stale`) or waits for step 4 to
  commit (then the row is `sent` under the old mapping, and the change
  applies to later suggestions).
- **Crash before step 4 commits:** nothing was claimed; the suggestion stays
  `approved`. **Crash after step 4 commits**, before or after the Google
  request: the suggestion is `sent` with its `mutation_id`; resolution and
  readback recovery (§7.3) decide the outcome; nothing redispatches it.
- **Residual window.** A NabaLens withdrawal that commits after step 2's live
  read is not seen before the Google call. It is bounded by the write
  session's budget (under 50 s), and it is handled as a withdrawal during
  flight: the review-item rule raises "Source withdrawn: review the Google
  value" if the write confirms (§7.5).

### 6.4 Acceptance criteria

1. Approval binds to the payload hash, the Google baseline hash and the
   NabaLens epoch, publication revision and digest of every key.
2. No publish happens with an expired approval (24 h), a stale payload, a
   changed Google baseline, a changed NabaLens source, a settling source, a
   changed mapping version or a changed link.
3. A NabaLens outage at publish time refuses the publish
   (`source_unreachable`); it never publishes on an unverified source.
4. No NabaLens path can create, approve or send a change set.
5. At most one `gbp_management_mutation` attempt exists per change set
   (`0063`'s unique index), Google is called only for the attempt the
   request created, and only after the claim committed.
6. An unresolved attributes attempt at a location in either ledger blocks a
   new attempt from the other path. Simultaneous claims cannot both commit.
   The guard is scoped to tenant, location and the attributes resource, and
   terminal attempts unblock either path (§6.5).

### 6.5 Shared location attributes claim fence (both directions)

This is a B07 implementation dependency for every mapped location (B07-00
item 4), in NabaPresence. It changes only the attributes claim of the two
existing paths. It adds no other bulk family, approval flow or result code,
and it keeps the session advisory lock and the idempotency paths.

1. **Fence row.** One additive table, `location_resource_claim_fence
   (organisation_id, location_id, resource_key)`, with a primary key on all
   three and `resource_key` checked to `'attributes'` in this batch. It uses
   the same tenant RLS as `bulk_listing_write_attempt`, grants select,
   insert and update to `naba_app_runtime`, and allows no delete. The row
   holds no state; it exists to be locked. Each claim transaction runs
   `insert … on conflict do nothing`, then `select … for update` on
   `(organisation_id, location_id, 'attributes')`. This is an ordinary row
   lock in the same pooled tenant transaction that inserts the attempt, so
   it is held until that transaction ends, whether or not the advisory
   session survives.
2. **Single-attribute claim** (`startGbpMutation` with `resourceType =
   'attributes'` and `blockUnresolved`, for every caller, B07 or not):
   after `beforeStart` (if any) and before `find`, take the fence. Then run
   `find`, the existing guard on `gbp_management_mutation` (unchanged), the
   bulk predicate below, and `attemptStore.start`. A bulk hit refuses with
   the existing `409 google_confirmation_unresolved`.
3. **Bulk attribute claim** (`runGbpWrite`'s claim transaction, for
   attributes children only). The claim is one `withTenant` transaction
   (`gbp-write.ts` :1081-1139 at `f003430c`): `beginIntent(sql)` records
   the intent receipt (:1083), then `find`/`decide`, the receipt checks,
   and `input.store.start` (:1116). `runGbpWrite` gains one additive
   optional hook with **two phases**, which `runBulkWrite` passes only
   when `spec.family = 'attributes'`:
   1. `beforeClaim(sql)`, the first statement of the claim transaction,
      **before** `beginIntent` and before `find`/`decide`: take the fence
      (`insert … on conflict do nothing`, then `select … for update`).
      Every later statement of the claim runs under the fence.
   2. `beforeStart(sql, { existing })`, run **immediately before
      `store.start`** and only on the path where `decide` answered `start`
      (a new attempt, or the re-arm of a settled `failed` row): evaluate
      the single-attribute predicate and the bulk predicate below, the bulk
      one excluding the row being re-armed. A hit throws a typed internal
      **pre-attempt refusal**, `AttributesClaimBusyError` (not an
      `ApiError`, no HTTP status, carrying only the blocking ledger name).
   The receipt, `idempotent`, `in_flight` and `uncertain` answers return
   before phase 2, so idempotent replay and the readback recovery of the
   child's own uncertain row (`recoverForIntent`, outside the claim) are
   unchanged, and they never meet the refusal. `runGbpWrite` calls `claim()`
   a second time after its own-attempt recovery (:1426); both phases run
   again there. The refusal is thrown inside the claim transaction, so it
   rolls back everything that transaction wrote, including an intent
   receipt `beginIntent` inserted in it. No attempt row is inserted, the
   refused transaction commits no intent, and the provider is not called.
   On the first claim that leaves no receipt at all. On the **re-arm
   path** (the second `claim()`), the first claim already committed the
   intent receipt, still `sent` and unlinked, before the child's own row
   was read back and settled `failed`. `runGbpWrite` therefore catches
   `AttributesClaimBusyError` around the second `claim()` only, links that
   receipt to the child's own settled row in its own tenant transaction
   with the existing `recordOnRow` (as `recoverForIntent` does on its error
   path, :1364-1384), and rethrows. The receipt then reports the earlier
   attempt's settled failure and is never left `sent` without an attempt.
   No other path in `runGbpWrite` catches the refusal.

   **Mapping to the existing queued outcome.** The generic exception
   adapter cannot do this: `runBulkWrite` (`bulk-families/write-attempts.ts`
   :361-362) passes every thrown error to `outcomeOfThrownWrite`
   (`bulk-families/shared.ts` :103-127), which, with no receipt, maps an
   ordinary `ApiError` to `{ kind: "failed", code }` and rethrows any other
   error, which the runner's own catch then settles as failed. So
   `runBulkWrite`'s catch gains one explicit branch **before**
   `outcomeOfThrownWrite`: `if (error instanceof AttributesClaimBusyError)
   return { kind: "deferred", code: "resource_busy" }`. That is the
   existing deferred outcome: the runner's `record` settles the child back
   to `queued` with `resource_busy` (`bulk-listing-runner.ts` :335-340), as
   its advisory busy callback does today (:408-413). Only the attributes
   family's hook throws this error, so every other family's error mapping
   is unchanged, and `outcomeOfThrownWrite` is not edited. The queued
   child is claimed again on a later run and starts once neither predicate
   holds (the blocking attempt is terminal).
4. **Predicates** (tenant by RLS and an explicit `organisation_id`):
   - single: `gbp_management_mutation where location_id = $loc and
     resource_type = 'attributes' and (status in ('started', 'validated',
     'ambiguous') or confirmation_state in ('pending', 'unresolved'))`,
     which is the predicate `startGbpMutation` already uses;
   - bulk: `bulk_listing_write_attempt where location_id = $loc and family
     = 'attributes' and status in ('validating', 'validated', 'publishing',
     'ambiguous')`. `succeeded` and `failed` are terminal and unblock either
     path. B07-00 confirms this against recovery (§3.0 item 4).
5. **Why it holds.** Both claims lock the same row before checking, and
   each inserts its attempt in the transaction that holds the lock. Under
   `READ COMMITTED`, each statement after the lock wait takes a new
   snapshot, so the second claim's checks see the first claim's committed
   attempt. Either order blocks, and two simultaneous claims with lost
   advisory sessions cannot both commit a new attempt. Other tenants,
   other locations and other resources (hours, place actions) take no fence
   row in common. An existing attempt is never redispatched, and recovery
   stays readback-only.

## 7. B07-05: delivery states, resolution and status feedback

### 7.1 State model

| Plan state            | NabaPresence suggestion status                                                        | Underlying evidence                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| received              | `received`                                                                            | Intake recorded the publication (`provider_received`)                                                                   |
| awaiting review       | `awaiting_review`                                                                     | Mapped, reviewable (possibly `behind_in_flight`)                                                                         |
| approved              | `approved`                                                                            | Change set approved with `source_ref`, not yet claimed                                                                   |
| sent                  | `sent`                                                                                | The send claim committed: a `gbp_management_mutation` attempt for the change set, `mutation_id` set (§6.3 step 4)       |
| (accepted, not shown) | `awaiting_confirmation`                                                               | Attempt `execution_state = 'accepted'`, readback does not show this key's value yet                                      |
| provider-confirmed    | `confirmed_applied`                                                                   | Readback (`confirmation_response`) shows this key's mapped value (the only "live" state)                                 |
| rejected              | `rejected`                                                                            | A person rejected it, or the attempt was rejected with an error code classified as a Google refusal (OD-B7-8)           |
| failed                | `failed`                                                                              | The attempt was rejected without a refusal classification, or readback shows the baseline after the recovery ceiling    |
| ambiguous             | `uncertain`                                                                           | Execution `unknown`, or an interrupted attempt; recovery reads back before anyone may retry                              |
| closing states        | `already_satisfied`, `unsupported`, `not_linked`, `superseded`, `withdrawn_at_source` | As §4.4                                                                                                                 |

### 7.2 Attempt-to-status mapping (per suggestion, per key)

Resolution reads the attempt row named by `mutation_id`. Per key it compares
`confirmation_response` with that key's mapped value through
`googleAttributesMatch` restricted to the key's attribute.

| Attempt row                                                                                              | Key's value in `confirmation_response` | Suggestion status                                  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `status` `started`/`validated`, not `recovery_ready`                                                     | –                                      | `sent` (unchanged)                                 |
| `status` `started`/`validated`, `recovery_ready` (older than 5 minutes)                                  | –                                      | `uncertain`                                        |
| `status = 'failed'`, `execution_state = 'rejected'`, error classified as a Google refusal (OD-B7-8)      | –                                      | `rejected` (`status_reason` = the error code)      |
| `status = 'failed'`, `execution_state = 'rejected'`, otherwise                                           | –                                      | `failed` (`status_reason` = the error code)        |
| `status = 'succeeded'`, `confirmation_state = 'confirmed'`                                               | equal                                  | `confirmed_applied`                                |
| `status = 'ambiguous'`, `execution_state = 'accepted'`, `confirmation_state = 'unresolved'`              | equal                                  | `confirmed_applied`                                |
| as above                                                                                                 | not equal, under 5 minutes since `started_at` | `awaiting_confirmation`                     |
| as above                                                                                                 | not equal, 5 minutes or more           | `uncertain`                                        |
| `status = 'ambiguous'`, `execution_state = 'unknown'`                                                    | equal                                  | `confirmed_applied`                                |
| as above                                                                                                 | not equal, or no readback              | `uncertain`                                        |
| after the recovery ceiling (§7.3), readback shows the change set's baseline value for the key            | baseline                               | `failed` (`status_reason = 'readback_baseline'`)   |

`confirmed_applied`, `failed` and `rejected` reached from an in-flight
status set `resolved_at`. `uncertain` is not terminal.

### 7.3 Resolution and recovery

- **Resolution** `nabalensResolveAttempt(organisationId, mutationId)` is
  one tenant transaction: lock the link (`for share`), the heads of the
  attempt's keys (`for update`, key order) and the in-flight suggestions
  (`for update`); read the attempt row; move each suggestion forward by
  §7.2 only from an in-flight status; set `resolved_at`; set
  `provider_detail` to `source_changed_during_flight` or
  `source_withdrawn_during_flight` when the head moved past the row's
  revision while it was in flight; evaluate the review-item rule (§7.5);
  write outbox rows. Re-running it changes nothing. It is called at §6.3
  step 6, by the readback path, and by a `nabalens_resolution` job every
  minute for in-flight suggestions whose attempt is settled or
  `recovery_ready`, so a crash between the attempt's settle and resolution
  is repaired.
- **Intake never changes an in-flight row.** Only resolution does, from the
  attempt evidence, under the same head locks as intake.
- **Readback recovery** reads back only, never re-sends: it uses the
  existing `confirmBusinessInformation` path (same lock keys,
  `google_target_changed` check, `recovery_ready` rule,
  `observeAndConfirmGbpMutation` on the stored `requested_payload`) and then
  resolution. Today that path is person-initiated. A `nabalens_readback`
  job kind that calls it automatically at 5, 15, 60 and 240 minutes is
  specified but disabled until OD-B7-7; until then a person starts it from
  the review view. After the last scheduled readback (the ceiling), a key
  still neither equal nor at baseline stays `uncertain` and a person is
  told.
- **Retries** are a person's decision and a new change set on a fresh
  baseline, after the in-flight row resolves.

### 7.4 Suggestion transitions

| From                                       | Event                                                                                  | To                                                    | Serialised on        |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| (none)                                     | intake, current settled item (§4.4)                                                    | `awaiting_review` / `unsupported` / `not_linked` / head only | head                 |
| `received`, `awaiting_review`, `approved`  | intake: higher published or historic revision; or epoch reset                          | `superseded`                                          | head                 |
| `received`, `awaiting_review`, `approved`  | intake: `unavailable` or `withdrawn`; or key omitted at epoch reset                    | `withdrawn_at_source`                                 | head                 |
| `unsupported` (reason `no_active_mapping`) at the head revision | a mapping becomes active for the key                             | `awaiting_review`                                     | head                 |
| `awaiting_review`                          | fresh observation equals the proposed value                                            | `already_satisfied`                                   | head                 |
| `awaiting_review`                          | person rejects                                                                         | `rejected`                                            | head                 |
| `awaiting_review`                          | approval with matching heads (§6.2)                                                    | `approved`                                            | head (`for share`)   |
| `approved`                                 | approval expired; person prepares again                                                | `awaiting_review`                                     | head                 |
| `approved`                                 | send claim committed (§6.3 step 4)                                                     | `sent`                                                | link, head           |
| `sent`                                     | resolution (§7.2)                                                                      | `awaiting_confirmation` / `confirmed_applied` / `rejected` / `failed` / `uncertain` | head |
| `awaiting_confirmation`                    | resolution (§7.2)                                                                      | `confirmed_applied` / `uncertain`                     | head                 |
| `uncertain`                                | readback then resolution                                                               | `confirmed_applied` / `failed` / `uncertain`          | head                 |
| `sent`, `awaiting_confirmation`, `uncertain` | intake of any newer item                                                             | **unchanged**; the head rises; a newer pre-send row may queue | head          |

Nothing reopens a `superseded`, `withdrawn_at_source`, `already_satisfied`,
`rejected`, `failed` or `confirmed_applied` row.

### 7.5 Review-item rule (one rule, every order)

Evaluated under the key's head lock by intake (negative items), the epoch
reset (omitted keys) and resolution (after a terminal move):

> Let C be the most recently resolved `confirmed_applied` suggestion for the
> location and key. If C exists, the head is `unavailable` or `withdrawn`,
> and the head is newer than C (a higher epoch ordinal, or the same epoch and
> a higher revision), insert the review item `(C, 'source_withdrawn_after_
> confirm')` with `on conflict do nothing`.

Withdrawal then confirmation: at intake C does not exist yet (the row is in
flight), so no item; resolution then confirms C, sees the withdrawn head,
and inserts the item. Confirmation then withdrawal: resolution sees a
published head, no item; intake of the withdrawal inserts it. Either order
gives exactly one item. A later published head does not close the item; a
person does. The item never writes to Google; any reversal is a new reviewed
change set on the current Google baseline (plan §12 rollback).

### 7.6 Completion semantics

- `confirmed_applied` means Google's readback showed the value of *that
  row's* revision. It never means "matches current NabaLens".
- A key is **complete** only when the head is `published` and a row at the
  head's epoch and revision is `confirmed_applied` or `already_satisfied`.
- When an in-flight row resolves, a queued `behind_in_flight` row is
  unblocked but still needs an observation read after `resolved_at` (an
  equal value closes it as `already_satisfied`) and a new approval.
- `failed` or `rejected` raises no item.

### 7.7 Feedback to NabaLens

- Each status change writes a `nabalens_receipt_outbox` row in the same
  transaction. The `nabalens_status` job posts outbox rows with `POST
  /api/knowledge/v1/receipts` (NabaLens, B06 §5.9), using its NabaLens
  credential: `{ epoch, destination, venueId, fieldKey,
  publicationRevision, kind, providerRef, providerDetail, closeReason, at
  }`. `providerRef` is the suggestion ID, never a Google token or account
  name. A retry is idempotent at NabaLens on `(epoch, destination, venue,
  field, revision, kind, providerRef)`.
- NabaLens stores them as `knowledge_publication_events` with provider kinds
  (`provider_received`, `provider_awaiting_review`, `provider_approved`,
  `provider_sent`, `provider_confirmed`, `provider_rejected`,
  `provider_failed`, `provider_uncertain`, `provider_closed`), monotonic per
  epoch, revision and kind, and shows managers one line per venue and key
  ("Sent to Google; confirmed on {date}", "Waiting for review in
  NabaPresence", "Confirmed on Google for an earlier answer; a newer answer
  is waiting in NabaPresence" when the latest `provider_confirmed` revision
  is below the current publication revision).
- `providerDetail` (optional): `behind_in_flight`,
  `source_changed_during_flight`, `source_withdrawn_during_flight`.
  `provider_closed` carries `closeReason`: `already_satisfied`,
  `unsupported`, `not_linked`, `superseded`, `withdrawn_at_source`,
  `epoch_reset`.
- The receipts route accepts only the consumer's own destination and only
  receipt kinds; it is the reader's only write, and it changes no answer,
  contribution or credit.
- **B10 handoff (M-DL-8):** add the `providerDetail` and `closeReason`
  enums above (including `epoch_reset`). No new status or kind is added.

### 7.8 Withdrawal and reversal

A NabaLens withdrawal never changes Google by itself. It moves the pre-send
row to `withdrawn_at_source`; an in-flight write is not cancelled; and the
review-item rule (§7.5) raises "Source withdrawn: review the Google value"
for a key whose confirmed value is older than the withdrawal, in either
order. Any reversal is a new reviewed change set on the current Google
baseline (plan §12 rollback).

## 8. B07-06 verification

### 8.1 Cases (V14 plus the plan list and the repairs)

| Case                                                                                         | Expected                                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsupported field (`step_free_entrance` with no approved equivalence)                        | `unsupported`, reason shown; no change set possible                                                                                                              |
| Duplicate suggestion (same revision twice, and concurrently)                                 | One row                                                                                                                                                          |
| Lower revision after higher                                                                  | Ignored, logged; the rest of the page processed                                                                                                                  |
| Conflicting baseline (Google changed between review and approval)                            | `attributes_stale` / `approval_stale` at preview or publish                                                                                                       |
| Expired approval (25 h)                                                                      | `approval_expired`                                                                                                                                               |
| Changed source (NabaLens revision rises after approval)                                      | `source_stale`; suggestion `superseded`                                                                                                                          |
| Source withdrawn after `confirmed_applied`                                                   | One review item; Google untouched                                                                                                                                |
| Partial provider update (two attributes in one change set, one applied)                      | Per-key readback; the applied key `confirmed_applied`; the other `awaiting_confirmation` then `uncertain`; no automatic resend                                  |
| Ambiguous outcome (timeout)                                                                  | `uncertain`; readback; `confirmed_applied` or, at the ceiling with the baseline shown, `failed`                                                                   |
| Qualified answer, Not applicable, Unknown                                                    | `unsupported` or no row, as §4.4                                                                                                                                 |
| NabaLens down at publish                                                                     | `source_unreachable`; nothing sent                                                                                                                               |
| Privacy                                                                                      | Suggestion rows, review view, NabaPresence logs, outbox and receipts contain no staff identity, staff text, Wi-Fi detail, asset ID or original                  |
| P1. Page with a duplicate followed by a new item                                             | Duplicate `ignored_stale`; the new item recorded; cursor at `coveredThrough`                                                                                     |
| P2. Fetch delayed past claim expiry; the same worker identity reclaims                       | The late commit fails the claim-token fence and rolls back; the new claim's page commits once                                                                    |
| P3. Link revoked, or relinked, during the fetch                                              | The commit fails the link fence; `link_revoked` halt; a new link bootstraps from the snapshot even at the same source revision                                  |
| P4. Out-of-order commits in different NabaLens scopes                                        | Each link's stream is gap-free; a page with a gap is rejected as `feed_malformed`                                                                                |
| P5. Page writes and cursor advance                                                           | Atomic: a forced failure on the last item leaves no row from the page and the cursor unchanged                                                                   |
| P6. Deliberate pending-index conflict                                                        | The page aborts; the cursor does not advance; no row is lost                                                                                                     |
| P7. Newer revision while `sent`, `awaiting_confirmation` and `uncertain`                     | Head rises; one `awaiting_review` row `behind_in_flight`; the in-flight row unchanged                                                                            |
| P8. Two newer revisions behind one uncertain write                                           | The first queued row `superseded` by the second; one pre-send row                                                                                                |
| P9. Withdrawal then old-write confirmation; old-write confirmation then withdrawal           | Exactly one review item in both orders; no automatic provider write                                                                                              |
| P10. In-flight `failed` or `rejected`                                                        | The queued row proceeds after a fresh observation; no item                                                                                                       |
| P11. Prepare, approve or publish while any attributes write at the location is in flight, including an unresolved bulk attempt | `in_flight_pending` (or `google_confirmation_unresolved` at the guard)                                                                                           |
| P12. Intake and publish race on one key                                                      | Exactly one of the §6.3 outcomes; no Google call when intake wins                                                                                                |
| P13. Two keys at one location prepared and published concurrently                           | One claim commits; the other refuses; one Google request                                                                                                         |
| P14. Mapping version or link changed after the live reads and before the claim               | `source_stale` if the change committed first; otherwise the change waits and the row is `sent`                                                                    |
| P15. Crash before the claim commits; crash after it, before and after the Google call        | Before: `approved`, nothing sent. After: `sent` with `mutation_id`; resolution and readback; never redispatched                                                  |
| P16. Publish retried for a change set that already has an attempt                            | Idempotent; no second Google request; resolution runs                                                                                                            |
| P17. Settling or withdrawn-overlay item at the head of a page                                | The page ends before it; the cursor stays; the next drain settles it and intake proceeds                                                                         |
| P18. NabaLens outage at intake                                                               | Cursor kept; backoff; "Intake behind" and an alert after 30 minutes; review continues                                                                            |
| P19a. NabaLens epoch reset after a restore older than the cursor; a key present in the backup and the restored register whose post-backup withdrawal was lost and replayed (including after a private early build: value at revision 1, then tombstone at revision 2) | `epoch_changed`; bootstrap from the accepted, settled snapshot; the key's head is the present `withdrawn` tombstone at its final revision; old-epoch pre-send rows closed `superseded` / `epoch_reset`; in-flight rows kept; provider audit history unchanged; review item where confirmed; no provider mutation during the reset; new revisions reviewable |
| P19b. The same reset; a key first delivered after the backup point, missing from the restored register and omitted from the snapshot | A `withdrawn` head at revision 0 in the new epoch; pre-send rows closed `withdrawn_at_source` / `epoch_reset`; in-flight rows kept; provider audit history unchanged; review item where confirmed; no provider mutation during the reset |
| P20. Restore without a new epoch                                                             | `cursor_ahead`; intake halts; alert                                                                                                                              |
| P21. Receipt posted twice, or out of order, or for an old epoch                              | One event; the lower one or old epoch `ignored_stale`                                                                                                             |
| P22. Retention reaper runs while a suggestion is in flight                                   | The referenced attempt is kept (B07-00 item 2)                                                                                                                   |
| P23. A key-scoped credential reads a stream with an unauthorised current and superseded item; then a fully scoped one | Key-scoped: `403 not_permitted`, no identities, `feed_not_permitted`, cursor unchanged. Fully scoped: a contiguous page and a complete snapshot |
| P24. The commit waits on the cursor lock until the claim has expired                         | The `clock_timestamp()` fence fails at 4.1 or 4.5; the page rolls back; the cursor is unchanged |
| P24a. A claim expires while its fetch fails; its token is still on the row and has never been replaced; the late error/backoff write runs | The live claim guard matches nothing: the token is not released; `feed_cursor`, `halted_reason`, `consecutive_failures`, `next_attempt_at`, `behind_since` and `last_error` are unchanged; a later claim takes over the expired token |
| P24b. As P24a, but the late write is a halt (`link_revoked` after a rolled-back page, `revision_conflict`, `epoch_regressed` after a rolled-back bootstrap, or `cursor_ahead` at the fetch) | No halt is set and nothing else changes (as P24a); no halt alert; the next live claim meets the same condition and halts under its own claim |
| P24c. The same failure and the same halt under a live matching claim | The error write records the failure count, `behind_since` and the intended backoff and releases the claim; the halt write sets `halted_reason`, releases the claim and alerts; neither moves the cursor |
| P24d. A late error or halt from a claim whose token was replaced by a newer claim | Matches nothing; the newer claim's token, expiry and the cursor are untouched |
| P24e. A page commit or bootstrap commit after its claim expired (token present or replaced) | Fails 4.1 or the guarded update; the page or bootstrap rolls back; only a live matching claim commits either |
| P25. An unresolved bulk attributes attempt, then a B07 publish at the same location          | Refused `google_confirmation_unresolved`; no attempt and no Google call (the reverse of P26, unchanged by the bulk refusal mapping) |
| P26. An unresolved B07 attempt, then a bulk attributes child at the same location            | The child's claim throws `AttributesClaimBusyError` at `beforeStart`; `runBulkWrite` maps it to `{ kind: "deferred", code: "resource_busy" }` and the child returns to `queued` with `resource_busy` (not `failed`); no bulk attempt row, no new committed intent receipt (the provisional one rolled back; for the re-arm path see P26c), no Google call |
| P26a. P26, then the B07 attempt reaches `succeeded` or `failed`, and the runner claims the queued child again | The fence check passes; the child's attempt starts and is sent once |
| P26b. Mapping scope: an ordinary pre-receipt `ApiError` from the claim of an attributes or another bulk family; a busy advisory key | Unchanged: the `ApiError` still settles `failed` through `outcomeOfThrownWrite`; the busy key still defers `resource_busy` through the advisory callback; only the typed refusal takes the new branch |
| P26c. Re-arm path: the child's own uncertain row is read back and settled `failed`; a B07 attempt claims the fence before the second `claim()`; that claim is refused | The child returns to `queued` with `resource_busy`; no new attempt and no Google call; the receipt committed by the first claim is linked to the child's own settled row (reporting its failure), not left `sent` without an attempt; the next run claims under a new intent, finds the child's own `failed` row by its idempotency key and re-arms it (once neither predicate holds), never answering idempotently from the linked receipt |
| P27. Simultaneous B07 and bulk claims with both advisory sessions lost                       | Both serialise on the fence row; exactly one new attempt commits; a losing bulk child returns to `queued` with `resource_busy` as P26 |
| P28. Scope and release: other tenant, other location, an hours write; then the blocking attempt reaches `succeeded` or `failed` | Not blocked by the fence; terminal attempts unblock either path; an ambiguous attempt is recovered by readback only, never redispatched; a bulk child's own uncertain row is read back and an idempotent replay answers from its receipt, neither meeting the refusal |
| P29. A same-epoch item at the head's revision with a different digest                        | The page rolls back; `revision_conflict` halt; alert |

Where: NabaPresence's own test suites (unit, integration with its local
stack, its Playwright e2e for the review view) with a recorded NabaLens feed
fixture; NabaLens security tests for the feed, snapshot and receipts routes;
the cross-repository journey on fixture stacks, with a Google API double. No
Google call happens in tests.

### 8.2 Narrowly authorised live example

One supported fact at one verified location, after every other gate:

1. X6: provider publication authority, the named NabaPresence approver(s),
   and the live test location (expected: Old Crown, once linked and verified
   in NabaPresence's production organisation).
2. X8: the Old Crown crosswalk row; the NabaPresence link approved in
   NabaPresence.
3. X4: the NabaLens production credential for `provider_sync`.
4. The owner chooses the fact (proposed: `guest_toilets` Yes, confirmed,
   current) and confirms the mapping.
5. A person reviews and approves in NabaPresence; NabaPresence publishes;
   readback shows `confirmed_applied`; NabaLens shows the provider receipt.
6. Retain: the change set (payload, baseline, hashes, approver, `source_ref`),
   the attempt row (states, readback payload and time), the NabaLens epoch,
   publication revision and receipts.
7. No reversal on the live listing unless the owner asks; a reversal would be
   its own reviewed change.

## 9. Migration and compatibility

| Repository   | Change                                                                                                                                                                                                                                                                                     | Behaviour change                                                                      | Rollback                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| NabaLens     | Destinations per venue, `provider_sync` consumer, manifest rows; the feed, snapshot and receipts routes (B06)                                                                                                                                                                              | None until a `provider_sync` consumer exists and an epoch is accepted                 | Disable the consumer; withdrawals still publish                                                           |
| NabaPresence | `nabalens_location_link`, `nabalens_field_mapping`, `nabalens_suggestion`, `nabalens_source_head`, `nabalens_intake_cursor`, `nabalens_intake_event`, `nabalens_review_item`, `nabalens_receipt_outbox`; `gbp_change_set.source_ref`; `startGbpMutation` hooks; `location_resource_claim_fence`, the two-phase `runGbpWrite` claim hook and the `runBulkWrite` refusal mapping (§6.5); job kinds `nabalens_intake`, `nabalens_status`, `nabalens_resolution`, `nabalens_readback` (disabled); review view; publish checks | None until a link and mapping are approved and intake is enabled for the organisation | Pause intake or disable a mapping; existing provider values stay under NabaPresence's own correction flow |

- Existing change sets, attempts, snapshots, observations and audit history
  are not rewritten. `source_ref` is nullable; change sets without it behave
  exactly as today, the hooks are no-ops, and the publish checks run only
  when it is set.
- `startGbpMutation`'s signature is frozen for its callers (its module
  comment); the hooks are optional parameters, so every existing caller is
  unchanged.
- NabaPresence never stores the full NabaLens answer; only the value its
  mapping needs, the qualifier for display, the epoch, revision and digest
  (plan §12 "Do not copy every NabaLens field into a provider payload").

## 10. Owner decisions

| ID      | Decision                                                                                                                        | Default until decided                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| X6      | NabaPresence provider publication authority, approvers, the live test location, and per-location metadata (link, verified flag) | Nothing linked; no live example                                          |
| X8      | Venue crosswalk rows used for the NabaPresence links                                                                            | Probable only; no link approved                                          |
| X4      | Production `provider_sync` credential and its operator                                                                          | None issued                                                              |
| OD-B7-1 | Pull (NabaPresence reads NabaLens) vs push (NabaLens posts into a new NabaPresence intake API)                                  | Pull                                                                     |
| OD-B7-2 | The pilot mappings (§3.3)                                                                                                       | Only `guest_toilets` mappable at first                                   |
| OD-B7-3 | Whether step-free entrance may map to Google's wheelchair-accessible entrance                                                   | No (unsupported)                                                         |
| OD-B7-4 | Whether qualified answers (temporarily unavailable) may ever map, for example to clearing an attribute                          | No                                                                       |
| OD-B7-5 | Two-person approval for NabaLens-sourced changes regardless of the organisation's policy                                        | Follow the organisation's policy                                         |
| OD-B7-6 | Who in NabaPresence may approve links and mappings                                                                              | Organisation owners and admins                                           |
| OD-B7-7 | Whether the `nabalens_readback` job may read Google back automatically for uncertain attempts (reads only, never sends)        | Disabled; readback stays person-initiated through the existing confirm path |
| OD-B7-8 | Which attributes-path error codes count as "Google refused" (`rejected`) rather than "did not complete" (`failed`)               | Every rejected attempt maps to `failed`; neither state is retried automatically |
| OD-B7-9 | Who may clear an intake halt (`cursor_ahead`, `epoch_regressed`, `revision_conflict`)                                                                 | Organisation owners only, after a new NabaLens epoch is accepted         |

## 11. Integration ownership (one PR per repository per batch)

| Repository and branch                     | Owner                                                           | Contents                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| NabaLens `codex/b07-provider-feed`        | Integration agent; WS5 code                                     | Feed and snapshot hardening for `provider_sync`, receipts route with provider kinds, manager receipt line (WS2), security tests  |
| naba-presence `codex/b07-nabalens-intake` | NabaPresence owner (WS5 may draft under that owner's direction) | Migrations, intake, status, resolution and readback jobs, review view, publish checks and hooks, tests, under NabaPresence's own gate |

WS5 does not change NabaPresence code without the NabaPresence owner. The
NabaLens gate does not qualify the NabaPresence change (plan §18).

## 12. Risks for the register

| Risk                                                 | Control                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A name match links the wrong White Horse             | Link table approved per row; evidence by postcode and `google_location_name`; never automatic                         |
| Overstated accessibility claim on Google             | Step-free unsupported by default (OD-B7-3)                                                                            |
| Approval outlives a source change                    | Live read and head checks at prepare, approval and the send claim; supersession on intake                             |
| Duplicate or replayed suggestions                    | Unique key on epoch and publication revision; monotonic receipts                                                      |
| Ambiguous write retried blindly                      | One attempt per change set; existing attempts never redispatched; readback only; retries are a person's new change set |
| Private evidence reaches the provider                | Feed carries public derivative IDs only, under a B05 grant naming the destination                                     |
| Newer source dropped behind an in-flight write       | Source head; split indexes; queue behind in-flight; explicit revision conflict target (§4.3 to §4.5)                  |
| Intake skips an item or advances on a stale claim    | Claim token with expiry, epoch and link fences; contiguity check; continue past stale items (§4.5)                    |
| Old write confirms after the source changed          | Completion per revision; one review-item rule for both orders (§7.5, §7.6)                                            |
| The advisory attributes lock is lost mid-write       | The send claim locks the link row in the database; single and bulk attributes claims lock one fence row and check both ledgers (§6.3, §6.5) |
| A NabaLens restore resurrects a withdrawn source     | Epoch-scoped identities; snapshot bootstrap treats omitted keys as withdrawn; `cursor_ahead` halt (§4.6, §4.7)        |

## 13. Changelog

- Draft 1 (10 Nov 2026): first design.
- Draft 2 (proposal, 10 Nov 2026): repairs the design-gate review and the
  proposal review; replaces the first repair proposal, which was not
  approved.
  - M1: split pre-send and in-flight indexes, the source head, queue
    behind in-flight, completion per revision (§4.3, §4.4, §7.6).
  - Low 1: B07-00 start gate, now naming the docs that exist (§3.0). Low 2:
    intake outage and cursor rules (§4.2.7, §4.5 step 5).
  - B07-1 (proposal review): cursor per approved link and epoch, unique claim
    token with expiry, link fence, continue past stale items, atomic page
    commit, guarded error writes, why the cursor cannot skip a commit,
    bootstrap for every new link (§4.5, §4.6).
  - B07-2: the send claim on the actual `gbp_management_mutation` attempt
    inside `startGbpMutation`'s transaction, under the existing attributes
    lock and unresolved guard; the `mutation_operation = 'sent'` assumption
    withdrawn (§2.1, §6.3).
  - B07-3: intake, claim and resolution serialised on the head; explicit
    revision conflict target; one review-item rule for both orders;
    attempt-derived resolution (§4.3, §7.2 to §7.5).
- Draft 2, bounded repair (10 Nov 2026), for the draft-2 review:
  - R3: a feed `403 not_permitted` is handled as `feed_not_permitted`
    without cursor coverage. Claim expiry is checked with
    `clock_timestamp()` after the lock and again in the guarded cursor
    update (§4.5, §4.6; P23, P24).
  - R4: the bulk ledger is `bulk_listing_write_attempt`. One shared
    location attributes claim fence and a two-ledger check sit in both the
    single and the bulk claim transactions, reusing the existing refusal
    and defer results (§2.1, §3.0, §6.1, §6.3, §6.5; P25 to P28).
  - R2 (B07 side): `revision_conflict` halt on a same-epoch digest conflict
    (§4.5, §4.7; P29).
- Draft 2, second bounded repair (10 Nov 2026), for the final design
  rereview (R2 B07 side, R3 and R4):
  - R2: the bootstrap reads only an epoch accepted after a settled rebuild.
    A present restored tombstone (at any final revision) closes old-epoch
    pre-send work `superseded` / `epoch_reset`; a post-backup key omitted
    from the snapshot gets a `withdrawn` head at revision 0 and closes
    pre-send work `withdrawn_at_source`. Both keep in-flight rows and audit
    history and make no provider mutation (§4.6; P19a, P19b).
  - R3: every claim-owned cursor write (page commit, bootstrap commit,
    error/backoff and halt) locks the cursor row and uses one live claim
    guard: exact organisation, link and token, plus `claim_expires_at >
    clock_timestamp()` evaluated after the lock. A halt from a rolled-back
    page or bootstrap is persisted in its own transaction under that guard
    (§4.5 steps 4.2, 4.4, 4.5, 5 and 6; §4.6; §4.7; P24a to P24e).
  - R4: the bulk attributes claim takes the fence in a `beforeClaim` phase
    before `beginIntent` and checks both ledgers in a `beforeStart` phase
    immediately before `store.start`; a hit throws the typed
    `AttributesClaimBusyError`, rolling back the claim and its provisional
    intent, and `runBulkWrite` maps it explicitly to `deferred` /
    `resource_busy` before the generic adapter (§3.0, §6.3, §6.5, §9; P25
    to P28, P26a, P26b).
