# B06/B07 draft 2 (fourth bounded repair): findings-resolution map

Design preparation only. It does not qualify implementation or authorise
enablement. Artifacts: `qa/b06-b07-design/b06-design.md`,
`qa/b06-b07-design/b07-design.md` (self-contained replacements for
`contracts/b06-design.md` `57505847…` and `contracts/b07-design.md`
`2f719aac…`, which stay untouched). Inputs: design-gate review
(`b06-b07-b08-b10-design-reviews.md`), the first repair proposal
(`b06-b07-pool-proposal.md` `68ea5995…`, not approved) and its review
(`b06-b07-proposal-review.md` `d0250a41…`). Owning source read only:
NabaLens WS5 `973cfd5c`, NabaPresence `f003430c`. No SQL, test, build,
network or provider call; WS5's unfinished replacement script not run.
Bounded repair of draft 2 (`320604af`) for R1 to R4 of
`b06-b07-draft2-review.md` only; the closed producer/drain (B06-1), durable
readback (B06-4) and in-flight resolution (B07-3) contracts are unchanged.
Second bounded repair of `2538cc79` (tree `d2f56d2e…`) for R1 to R4 of the
independent final rereview (`evidence/b06-b07-final-design-review.md`)
only. NabaPresence `f003430c` re-read for R4 (`gbp-write.ts`,
`bulk-families/write-attempts.ts`, `bulk-families/shared.ts`,
`bulk-listing-runner.ts`). Closed findings, RB-12 authority under X1 and
every owner gate are unchanged.
Third bounded repair of `f32c9973` (tree `ffe4e31f…`) for R1, R2 and the
R4 fixture wording of the static review
(`evidence/b06-b07-f32c-review.md`) only; R3 was closed there. No shared
contract, application source, migration or test code changed.
Fourth bounded repair of `b6c4dd5a` (tree `5112bfc5…`) for the required
correction and the two wording clarifications of the final static review
(`evidence/b06-b07-b6c4-final-review.md`) only. No shared contract,
application source, migration or test code changed.

## b6c4dd5a final-review correction and clarifications

Static design checks only: no test, SQL, build, network or provider call.

| Finding | Resolution | Where | Acceptance |
| --- | --- | --- | --- |
| **Required** keep the overlay's tuple identity at reset | A `settling` or `withdrawn_overlay` outcome in a valid higher-epoch reset initializes a value-free `suppressed` field that records the overlay's authorized `publication.revision` and `publication.digest` as its per-field high-water, beside `suppressedAsOf = eligibility.asOfRevision` and `suppressedAtCounter = k`. The old epoch's identity and payload are still discarded. `not_permitted` stays value-free with no per-field identity. Rule 4 applies unchanged: a settled tuple below the stored revision is never applied (whatever its snapshot watermark or counter), an equal revision with a different digest sets `regressionLatched`, and only the same identity read after the reset (counter above *k*) or a higher revision passes the fence. No API field, ordering mechanism or grant is added | B06 §5.7 rule 2 (overlay and `not_permitted` rows, paragraph after the table), §7.1 V13, R37a, §15 | R37a for both overlay types: O recorded at revision 3, digest *d*, no payload; branch (i) revision 2 at snapshot revision 4 or 5, issued after the reset, refused; branch (ii) revision 3 with *d′* latches and shows nothing; branch (iii) revision 3 with *d*, settled, eligible, unexpired: refused at counter ≤ *k*, shown at counter above *k*. The pre-reset counter refusal, R37b to R37d, R18 and P19 outcomes and P26c are unchanged |
| **Clarify** consumer reset read paths | The settled-only reset snapshot is NabaPresence's destination snapshot route (B06 §4.8, B07 §4.6, `409 settling` otherwise). The website resets from its complete answers read (§5.7 rule 2), which applies §4.7 at read time and can return value-free overlays after acceptance | B06 §5.8 step 4 | Wording; R37a covers the overlay outcomes on the website path |
| **Clarify** reviewability of a present head | A present published head is reviewable only as B07 §4.4 allows; a present `unavailable` head is head-only and creates no reviewable row. Epoch-reset closeout (`superseded` / `epoch_reset`) and in-flight preservation are unchanged | B06 §5.8 step 4; B07 §4.6, §13 | Wording; P19a to P19c unchanged |

## f32c9973 static-review clarifications (R1, R2, R4 wording)

Static design checks only: no test, SQL, build, network or provider call.

| Finding | Resolution | Where | Acceptance |
| --- | --- | --- | --- |
| **R1** define the complete higher-epoch answers response | The answers read returns the `snapshot` envelope once and exactly one explicit §4.7 outcome per requested key; `not_permitted` (`reason: not_permitted`, `revision: null`) carries no value, `publication`, `eligibility`, `provenance` or `freshness`. A website reset takes the epoch and snapshot watermark from the envelope and applies only from an authoritative, schema-valid response for the complete configured set with one outcome per requested key; a missing, duplicated, other-epoch or unrequested entry makes it partial or malformed, refused whole (outage for that read), the record unchanged apart from the allocated `requestCounter`. Applying a valid reset discards old-epoch state, then initializes per outcome in one table: unexpired settled value → `value` (renderable only within `validUntil`); expired positive → `absent`, never renderable, revision/digest high-water, omission fence; settled tombstone → value-free `tombstone` with the rule-3 fence; `settling` / `withdrawn_overlay` → value-free `suppressed`, `suppressedAsOf = asOfRevision`, `suppressedAtCounter = k` (refined by the `b6c4dd5a` row above: the overlay's `publication.revision` and `publication.digest` are kept as high-water); `not_permitted` and held keys outside the request set → `absent` with `omittedAtCounter = k`. Same-epoch rules 3 to 5 (including rule 5's left-out key), the feed and snapshot grant rules and every endpoint and public field are unchanged | B06 §4.3, §4.5 (one outcome per key), §4.7, §5.7 rules 2 and 5, §6.2, §7.1 V13, §15 | R37a mixed reset (fresh settled positive, settled tombstone, `not_permitted`, `settling` and the `withdrawn_overlay` variant, held key X outside the new set; pre-reset-issued read refused, later read passes); R37b expired positive stays unavailable and a fresh authoritative read populates it; R37c missing, duplicated, other-epoch or unrequested outcome refuses the reset; R37d delayed epoch-1 responses refused, R30a to R30c unchanged in the new epoch |
| **R2** reset omission is decided from the rebuilt snapshot | A key is omitted from the complete reset snapshot only when the reconciled rebuild leaves it no non-shadow head; the rebuild projects both the restored latest manifest and the restored delivered-field register. A field absent from both is omitted; an enabled, verified, still-eligible manifest-only field (backup before its first drain) gets a settled head (first tuple revision 1) and is present; unresolved evidence keeps step 5's fail-closed disable/deactivate. Consumers apply the actual snapshot outcome. Pending-epoch fence, marks, the settled-rebuild predicate, admin/RB-12/X1 authority, the first-tuple revision rule and the present-tombstone and omitted-key transitions are unchanged | B06 §5.8 steps 3.6 and 4, §7.3, §15; B07 §4.6, §8.1, §13 | B06 R18b and R32 (absent from both restored manifest and register → omitted; website `absent`, NabaPresence revision-0 `withdrawn` head, `withdrawn_at_source`), R18c (manifest-only still-eligible field present as its settled new-epoch head; variant unresolved → disabled, omitted or tombstoned); B07 P19b (absent from both), P19c (manifest-only key applied as a present head, `superseded` / `epoch_reset`, reviewable). Old in-flight rows and provider audit history kept in every case |
| **R4** P26c provider assertion | P26c allows the existing own-attempt recovery readback before the second `claim()`; the refused re-arm makes no new provider mutation and no provider call after the refusal. §6.5 item 3 says the same. The two-phase fence, receipt linkage via `recordOnRow`, the explicit queued `resource_busy` mapping, P26's zero-dispatch first claim and P26a's retry are unchanged | B07 §6.5 item 3, §8.1 P26c, §13 | P26c (re-arm refusal after the recovery readback); P26 and P26a unchanged |

## Final-rereview repairs (R1 to R4)

Static design checks only: no test, SQL, build, network or provider call.

| Finding | Resolution | Where | Acceptance |
| --- | --- | --- | --- |
| **R1** website omission must preserve the negative fence | Within an epoch a complete authoritative, applicable response (for the website's complete configured field set) changes an omitted field (left out, or returned `not_permitted`) only when its `snapshotRevision` is at least the stored one; omission in older or partial responses is ignored. An accepted omission is fail-closed: the value is cleared, revision and digest stay high-water, `suppressedAsOf` / `suppressedAtCounter` are kept and `omittedAtCounter` is recorded. Rule 4 consults the fence for every positive in every display state (`absent` or `suppressed`); the explicit-negative clause and its proof are unchanged; the omission clause is passed only by a later-issued authoritative read (*c* > `omittedAtCounter`) returning the field settled and eligible. An in-flight pre-negative response passes only the explicit revision clause. Expired positives never apply. Only a verified complete higher-epoch reset replaces fields and fences. The status route lists `omittedFields`; §6.2 renders `absent` as nothing | B06 §5.7 (record, monotonic record, rules 0, 2, 4, 5, proof), §6.2, §6.3, §5.8 step 3.3, §7.1 V13, §14, §15 | R30a delayed S9 omission after S10 and suppression (and the equal-revision variant); R30b current scope omission, already-issued same-revision S10 positive refused, later authoritative read re-exposes; R30c cached, subset and expired inputs cannot reveal or clear |
| **R2** restore rebuild must be settled before acceptance | The pending epoch may be built early but stays private; the deployment fence stays closed from step 3.1 to 3.8 and gates only consumer-facing work, so the drain and sweep still build the pending epoch. Reconciliation re-applies changes through existing commands that take the shared epoch lock (a domain-writer withdrawal is followed by `knowledge_publication_reconcile`), and their marks are drained; unresolved scope stays disabled. `epoch_accept` (existing authorised admin path, X1, RB-12 record) takes the epoch lock exclusively (waiting for in-flight commands), drains every visible mark of the scope in its own transaction, then evaluates in one statement: live `pending` epoch; every register row (including register-only fields) and every enabled manifest field headed; every head, shadow included, settled against the live projection. An earlier pending tuple is never evidence while a mark is outstanding. Otherwise `rebuild_unsettled`, full rollback. First revision 1; final revision may exceed 1. Present restored tombstone and post-backup omitted key are separate cases on both consumers | B06 §5.2 tombstones, §5.4 locks and command marks, §5.6 tick order, §5.8 steps 2, 3.4 to 3.7, 4, 6, §7.1, §8, §14, §15; B07 §4.6, §13 | B06 R18a (present tombstone), R18b (post-backup omitted; refined by the `f32c9973` R2 row above: omitted only with no non-shadow head after the rebuild, R18c), R19, R31a (no early build), R31b (early private positive, replay, revision-2 tombstone), R32, R36 (in-flight command waited for, outstanding mark drained before judging, unsettled acceptance refused, routine marks drained, a racing capture refuses and a retry succeeds); B07 P19a (present tombstone, `superseded` / `epoch_reset`), P19b (omitted key, revision-0 `withdrawn` head, `withdrawn_at_source`) |
| **R3** live expiry on every claim-owned cursor write | One live claim guard (exact organisation, link and token, plus `claim_expires_at > clock_timestamp()` evaluated by the guarded update after the cursor row lock) on the page commit, bootstrap commit, error/backoff and halt. Halts from a rolled-back page or bootstrap, and `cursor_ahead` at the fetch, are persisted in their own transaction under that guard; a late writer changes nothing and the next live claim re-detects. Error codes, alert policy, owner halt-clear path (OD-B7-9, for `cursor_ahead`, `epoch_regressed`, `revision_conflict`; `link_revoked` stays terminal for that link, P3), full-stream authorisation and success/bootstrap guards unchanged | B07 §4.5 (claim-owned writes, steps 2, 4.2, 4.4, 4.5, 5, 6), §4.6, §4.7, §13 | P24 (existing), P24a late failure with an expired unreplaced token, P24b late halt likewise, P24c live claim records backoff or halt, P24d replaced claim cannot write, P24e success/bootstrap need a live claim |
| **R4** bulk fence refusal must reach queued `resource_busy` | `runGbpWrite`'s claim hook has two phases: `beforeClaim` takes the fence before `beginIntent` and `find`/`decide`; `beforeStart` checks both ledgers immediately before `store.start`, only on the `start` path. A hit throws the typed internal `AttributesClaimBusyError`, rolling back the claim including its provisional intent. `runBulkWrite`'s catch maps exactly that error to `{ kind: "deferred", code: "resource_busy" }` before `outcomeOfThrownWrite`, which would otherwise give `failed`; the runner settles the child `queued`. On the re-arm path `runGbpWrite` links the receipt the first claim already committed to the child's own settled row before rethrowing, so no receipt stays `sent` without an attempt. Session advisory lock, single-path `409 google_confirmation_unresolved`, terminal/re-arm semantics, own-attempt readback and idempotent replay unchanged | B07 §3.0 item 4, §6.3 consequences, §6.5 item 3, §9, §13 | P25 (reverse order still refused), P26 (deferred `resource_busy`, no attempt, no committed intent, no provider call), P26a retry after the prior attempt settles, P26b mapping scope (ordinary `ApiError` still `failed`, advisory busy unchanged), P26c re-arm path receipt linked, P27, P28 |

## 0. Draft-2 review repairs (R1 to R4)

| Finding | Resolution | Evidence used | Where | Acceptance |
| --- | --- | --- | --- | --- |
| **R1** a cached response cannot clear suppression | Two read kinds. Only an authoritative `no-store` origin read for the complete field set, with its counter allocated by CAS immediately before the read, applies positives, clears suppression, makes fields absent or accepts an epoch. A cached body (tagged data cache, CDN, replay, subset) only serves the current applied value within `validUntil` or applies negatives. The record's counters and revisions are monotonic high-water marks; a stale negative suppresses without lowering them; an equal revision with a different digest latches. Derived outputs keep tags and revalidation | Review R1; B06 §6.1 `revalidate: 120` fetch; Next.js data cache (§2.3) | B06 §5.7 (monotonic record, rules 0 to 5, proof), §6.1 B06-04a, §6.3, §6.4 | R28 primed-cache withdrawal; R29 old-epoch response after reset; R30 stale negative and subset response |
| **R2** restore must reconcile still-present withdrawn fields | RB-12 step 3.5: while the new epoch is pending and unserved, post-backup eligibility changes (manifest disable/drop, destination deactivation, grant/rights revocation, redaction loss, answer withdrawal) are re-applied from durable evidence outside the restored DB or by the responsible owner. Unresolved fields are disabled before acceptance. The pending epoch may be built early and privately; acceptance requires a settled rebuild after reconciliation (superseded in detail by the final-rereview R2 row). Regression detection is restated as a backstop (a same-epoch backup shares the epoch ID), with a digest-conflict latch (website) and a `revision_conflict` halt (B07). Authority: `accepted_by <> opened_by` removed, the different-admin rule and the OD-B6-11 default removed; the existing admin path, RB-12 and X1 remain, and both identities and times are kept | Review R2; B06 §5.3 epoch DDL, §5.8 | B06 §5.3, §5.8 steps 3.3, 3.5 to 3.7, 5, 6, §6.3 `withdrawnFields`, OD-B6-11; B07 §4.5, §4.7 | R18 (now R18a and R18b), R31 backup-present withdrawal (now R31a and R31b), R32 post-backup field absent, R33 unresolved evidence fails closed, R34 same-epoch digest conflict; P29 |
| **R3** the gap-free feed must keep key-level authorisation | The feed and snapshot require the existing grant to cover the stream's complete field set (delivered-field register ∪ latest manifest fields). Otherwise `403 not_permitted` with no identity, `seq`, `coveredThrough` or `fence`, and no cursor coverage. Narrower credentials keep the key-scoped read; no grant is widened. B07 treats the refusal as `feed_not_permitted`. Claim expiry is `clock_timestamp()` after the lock and in the guarded cursor/bootstrap update | Review R3; B06 §4.7 row 1, §4.8; B07 §4.5 | B06 §4.8; B07 §4.5 steps 1, 2, 4.1, 4.5; §4.6 step 4 | R35; P23, P24 |
| **R4** the unresolved-attributes guard must work both ways | B07-00 pins both actual predicates: `gbp_management_mutation` (existing `startGbpMutation` guard) and `bulk_listing_write_attempt` (`family = 'attributes'`, status `validating`/`validated`/`publishing`/`ambiguous`). One shared tenant/location/attributes fence row is locked in both existing claim transactions (`startGbpMutation`, and `runGbpWrite`'s start via an additive `beforeStart` hook) before a two-ledger check and the attempt insert. The existing `google_confirmation_unresolved` is reused; the bulk `resource_busy` deferral now comes from the typed refusal mapped explicitly in `runBulkWrite` (final-rereview R4); advisory lock, idempotency, no-redispatch and readback-only recovery are kept | Review R4; NabaPresence `f003430c` `bulk-listing-runner.ts` :395-415, `bulk-families/write-attempts.ts` :305, `gbp-write.ts` :1116, `gbp-management.ts` :196-216, `0125_bulk_child_receipts.sql` | B07 §2.1 item 7, §3.0 item 4, §6.1, §6.3 step 4.3 and consequences, §6.4 item 6, §6.5, §12 | P25 bulk blocks B07; P26 B07 blocks bulk; P27 simultaneous claims with lost advisory sessions; P28 scope and terminal release |

## 1. Design-gate review findings (reviewer 5dd2f40c)

| Finding | Disposition | Where |
| --- | --- | --- |
| B06 M1: producer runs heavy work in every domain write | Resolved. Statement-level mark triggers write only the dirty table inside one exception block per statement; all computation moved to the per-venue drain; isolation limits stated; R1 to R3b | B06 §5.3, §5.4, §7.3 |
| B06 low 1: failed-auth bucket on first `x-forwarded-for` hop | Resolved. `x-vercel-forwarded-for`, then `x-real-ip`, else `fail:unknown`; spoof test | B06 §4.6, §7.1 V12 |
| B06 low 2: `publication_withdrawn` in schema fixtures and validator | Resolved, with `publication_settling` added | B06 §4.5, §7.2, §6.1 B06-04a |
| B06 low 3: status route may refetch; state it never changes applied revision, not cached | Resolved. Reads the applied-state record only, `no-store`, R27 | B06 §6.3, §7.3 |
| B07 M1: intake drops a newer revision behind an in-flight row | Resolved. Split pre-send / in-flight indexes, source head, queue behind in-flight, completion per revision | B07 §4.3, §4.4, §7.4, §7.6 |
| B07 low 1: NabaPresence release process not read | Resolved as gate B07-00; docs now named (`docs/ci.md`, `docs/release/`, `docs/runbook.md`, `docs/testing.md`) but still to read | B07 §3.0 |
| B07 low 2: intake outage behaviour | Resolved. Cursor kept, claim-guarded backoff, "Intake behind" alert at 30 min | B07 §4.2.7, §4.5 step 5 |

## 2. First-proposal pre-application findings (D1 to D10)

| ID | Disposition |
| --- | --- |
| D1 to D3 (script corrupts Ordering row, drops isolation row, deletes a risk row) | Avoided: script not run; full text written. Ordering row intact, Producer isolation row present (B06 §7.1), "manifests drift" risk row kept (B06 §14) |
| D4 amenity subject needs a lookup | `check:<check_id>`; the drain maps via immutable `template_key` (B06 §5.4) |
| D5 subtransaction per row | Statement triggers with transition tables; residual per-statement cost measured by R3b |
| D6 drains not serialised; `DELETE … SKIP LOCKED` | Venue advisory lock (try), shared epoch lock; delete needs no row locks (B06 §5.4) |
| D7 enabling an unchanged field never pings | Delivery state in the digest; R9 |
| D8 removed fields never tombstoned | Manifest version headers, delivered-field register, transition rows 7 to 9, backstop; R11, R12 |
| D9 drain lag gives one revision two contents | Superseded by B06-2 below (immutable tuples, overlays); `(revision, readAt)` ordering removed |
| D10 restore lowers revisions | Superseded by B06-3 below (epochs); numeric rebase removed |

## 3. Proposal-review blockers (seven)

| Blocker | Resolution | Evidence used | Where |
| --- | --- | --- | --- |
| **B06-1** producer/drain executable and self-contained | Complete DDL for `private.knowledge_publication_dirty` (unique `(venue_id, subject, writer_xid)`, age index, RLS, no client or direct `service_role` access) and both trigger functions; drain is one RPC per venue (the per-venue transaction boundary), `READ COMMITTED`, try-lock, one delete statement, one later projection statement into a variable, writes only from it; commit/rollback set stated; isolation limits (cancellation, timeouts, shared resources, subtransaction overflow) stated; 15-minute backstop as a healthy-system target with lag visible | `knowledge_events` :191 (non-null venue/key, no trigger); `amenity_check_events` :133 (check_id only); `template_key` guard :225; `knowledge_note_definition_change` one statement; `knowledge_upgrade_run` per-row loop; credit triggers `media_assets_amenity_evidence_lost`, `media_assets_knowledge_evidence_withdrawn`; reader RPC per call (`_reader/source.ts`) | B06 §2.1, §5.3 to §5.5, §7.3 R1 to R8 |
| **B06-2** immutable content per revision; separate eligibility | Tuples stored once with payload; read returns payload only when live digest and gates match in the same snapshot; otherwise value-free `settling` or `withdrawn` overlay scoped to destination and field, never a tuple; consumer rules: negatives applied at once, suppression cleared only by a higher settled revision or a request issued after the suppression; `readAt` kept for freshness only; feed emits settled items only and ends the page before an unsettled one; prepare/approve/send require a settled, eligible live read | Review text; Next.js last-writer-wins data cache (draft 1 §2.3) | B06 §4.3, §4.5, §4.7, §4.8, §5.2, §5.7; B07 §6.1 to §6.3; R13 to R15 |
| **B06-3** restore epoch and complete replay, missing tombstones | Epoch table (one live, ordinal, external record, acceptance through the existing admin path under X1; second-admin rule removed by R2); deployment fence outside the DB; RB-12 B06 steps; reset builds the new epoch from scratch with known tombstones from a durable delivered-field register; consumers reset from a complete snapshot and clear omitted fields; cursors, receipts, jobs epoch-scoped; manifest version header allows an empty latest version; regression latch / `cursor_ahead` / `revision_regressed` when an epoch is missed; numeric rebase dropped | Review text; draft 1 manifest DDL (field rows only) | B06 §3.3, §5.3, §5.8; B07 §4.6, §4.7; R18a to R21, P19a, P19b, P20 |
| **B06-4** verification after acknowledgement; fenced claims | Every transition via one function fenced by job ID, current `attempt_id` and unexpired lease (`lease_owner` diagnostics only); acknowledgement moves the job to a durable `readback` phase; readback jobs never superseded, only `done`, `covered` by a verified snapshot ≥ target, or `failed`; settling readback reschedules without ping | Draft 1 §5.5 three receipts | B06 §5.3 jobs DDL, §5.6; R22 to R25; B05 sign-off condition 2 extended (§9.1) |
| **B07-1** cursor over a fully accounted page, fresh claim fence | Cursor per approved link and epoch; claim token + expiry (DB clock); commit fences token, expiry, epoch, old cursor and active link; stale item → log and continue; malformed or unexpected conflict → roll back page; cursor advance and claim clear atomic; error writes claim-guarded; contiguity proof (per-scope `scope_seq` under the venue lock, gap check); bootstrap for every new link | B06 identity sequence concern (events `id` no longer a cursor) | B07 §4.3, §4.5, §4.6; B06 §4.8, §5.2; P1 to P6, R26 |
| **B07-2** `sent` bound to the actual attributes attempt | Send claim inside `startGbpMutation`'s existing tenant transaction via optional hooks: link row `for update`, heads, mappings, suggestions, change set; revalidation; existing find, unresolved guard and `attemptStore.start`; `approved → sent` with `mutation_id` and outbox in the same transaction; Google only after commit and only for the created attempt; existing attempt → resolution, never redispatch; `mutation_operation='sent'` assumption withdrawn; bulk children's `mutation_operation` ledger added to the in-flight check | `business-information.ts` :1111-1284, `gbp-management.ts` :178-258, `gbp-confirmation.ts` :22-89, `google-write-session.ts` (advisory, can be lost), `0063` unique `(organisation_id, change_set_id)`, `confirmBusinessInformation` :475-600, `bulk-listing-runner.ts` :395-415 | B07 §2, §2.1, §6.3, §7.2, §7.3; P11 to P16 |
| **B07-3** intake and in-flight resolution consistent | Intake, approval, send claim and resolution lock the same head row in a fixed lock order; in-flight rows change only by attempt-derived resolution; explicit revision conflict target; pending-index conflict aborts the page; one idempotent review-item rule evaluated by intake, reset and resolution gives one item in either order; newer queued row needs observation after `resolved_at` and new approval; completion per current settled revision; no automatic Google clear | Review text; `0062` execution/confirmation states | B07 §4.3, §4.5, §7.2 to §7.6; P7 to P10 |

Kept from the review's "evidence limits": prior lows (client IP, public-only
withdrawal schema/validator, read-only uncached status route); B07 owner
release-process gate; intake outage behaviour; B10 receipt-enum handoff
(`providerDetail`, `closeReason`, now including `epoch_reset`).

## 4. Product decisions stated instead of assumed (fail-closed defaults)

| ID | Decision | Default |
| --- | --- | --- |
| OD-B6-10 | Website shared compare-and-set store for the applied-state record | No field enabled on a multi-instance deployment until it exists |
| OD-B6-11 | Epoch opener/acceptor and the RB-12 external record | Existing authorised admin path plus X1 and the RB-12 evidence; no second-admin rule; both identities kept; until the record is named, nothing is served |
| OD-B7-7 | Automatic Google readback for uncertain attempts | Disabled; person-initiated confirm path only |
| OD-B7-8 | Error-code classification `rejected` vs `failed` | All rejected attempts → `failed`; no automatic retry either way |
| OD-B7-9 | Who clears an intake halt (`cursor_ahead`, `epoch_regressed`, `revision_conflict`; `link_revoked` is terminal for the link) | Organisation owners, after a new accepted epoch |

All X4, X6, X7, X8, X1 and OD-B6-1..9 / OD-B7-1..6 gates unchanged and
closed; rights rules (access and rights §8, presence only, step-free
unsupported) unchanged.

## 5. Remaining assumptions

1. PostgREST runs each RPC in its own `READ COMMITTED` transaction, so one
   RPC per venue is the per-venue commit boundary (Supabase default; confirm
   at implementation).
2. `xid8` / `pg_current_xact_id()` available (PostgreSQL ≥ 13).
3. `media_use_destinations` exposes the venue set and `active` flag B05
   describes.
4. NabaPresence's owner accepts optional hooks on `startGbpMutation` and
   one two-phase claim hook on `runGbpWrite` (`beforeClaim`,
   `beforeStart`), the typed `AttributesClaimBusyError` and its explicit
   mapping in `runBulkWrite`, plus the additive
   `location_resource_claim_fence` table (signatures for existing callers
   unchanged).
5. B07-00 confirms both unresolved predicates on the then-current head,
   including that bulk recovery always settles
   `bulk_listing_write_attempt.status` (otherwise the bulk predicate also
   reads the linked `mutation_operation` state), plus error-code
   classification and retention-reaper exclusion.
6. Residual race: a NabaLens withdrawal after the publish-time live read is
   not seen before the Google call (bounded by the < 50 s write budget) and
   is handled by the review-item rule.
7. The website can hold a shared CAS store (OD-B6-10); otherwise it stays in
   shadow.
8. The website can make server-side `no-store` origin reads to NabaLens
   within its route budgets (3-second timeout).
9. Post-backup eligibility changes are recoverable from evidence outside
   the restored database (B10 audit-log export, RB-12, release and consumer
   records) or from the responsible owner. Whatever is not recoverable is
   held disabled (fail closed), so a gap delays publication but cannot
   publish a withdrawn field.
10. A consumer whose grant does not cover a destination's complete field set
    uses the key-scoped read, not the feed; no current consumer is known to
    need a partial-scope feed.
11. Not re-checked in this pass: the review's note to use §5.4's precise
    failure-isolation wording throughout (B06-1, closed); R1 to R4 only.
12. A same-epoch omission for the website arises only from a change to the
    consumer's grant (§4.7 row 1) or from a configured field with no
    non-shadow head in the epoch (§4.7 row 2); a delivered field always
    stays in its epoch's snapshot as a head or tombstone. Both appear as
    `not_permitted` in the answers read, and the omission fence covers
    them without a per-field revision.
    At a higher-epoch reset the explicit outcome per requested key is
    required instead (B06 §5.7 rule 2); within an epoch a left-out key is
    still an omission.
13. Ongoing domain writes during RB-12 add marks; `epoch_accept` drains
    every mark visible once it holds the exclusive lock. A capture or an
    unswept time boundary landing between that drain and the clause
    check refuses acceptance (`rebuild_unsettled`, fail closed), and the
    owner retries. A mark committed later by a writer that takes no
    B06 lock is ordinary post-acceptance work; every reconciliation change
    ends in a command that holds the shared epoch lock (B06 §5.8 step
    3.5). Running drains in `epoch_accept`'s transaction under its own
    exclusive lock relies on PostgreSQL never blocking a backend on its
    own advisory locks (confirm at implementation).
14. In PostgreSQL the guarded `update`'s `clock_timestamp()` is evaluated
    after the preceding `select … for update` returned, so the live claim
    check uses time after the cursor row lock (confirm at implementation).
15. The `runGbpWrite` re-arm path's committed receipt is linked with the
    existing `recordOnRow`, and the next run (new intent ID) re-arms the
    child's own `failed` row by its idempotency key; B07-00 confirms both
    on the then-current head.
16. A positive whose `validUntil` has already passed when a reset applies
    it is recorded `absent` with its revision and digest as high-water and
    the omission fence, so only a read issued after the reset can show it;
    a reset response carrying an unrequested key is treated as malformed
    like a missing or duplicated one (fail closed, B06 §5.7 rule 2).
17. The website's complete configured field set fits one answers read
    (the reader's existing key bound); otherwise no complete reset
    response can be formed and the website stays on its last-good record.

## 6. State-table consistency check

| Table | Checked against | Result |
| --- | --- | --- |
| B06 delivery-state transitions (§5.4, rows 1 to 9) | §4.7 read rows; §5.2 tombstone list; V12 | Never-delivered failing a gate stays undelivered → `not_permitted` (row 6 ↔ §4.7 row 2); delivered failing a gate → overlay at once (§4.7 row 3) then tombstone (rows 7 to 9); re-enable continues from next revision (rows 4, 5, 7). Consistent |
| B06 read evaluation (§4.7) | Feed (§4.8); consumer rules (§5.7) | `settled` is the only outcome carrying a value or feed payload; overlays end feed pages and are applied as negatives by consumers. Consistent |
| B06 job phases (§5.6) | Jobs DDL checks (`phase`, `claim`); events kinds (`superseded`, `covered`) | Terminal phases are `free`; `readback` never → `superseded` within its epoch (only epoch open retires it); all kinds used exist in the check. Consistent |
| B06 epoch states (§5.3, §5.8) | Gating (§4.2.7); drain (`pending` or `accepted`); B07 §4.6 | Drain builds a `pending` epoch (possibly early and privately); acceptance only when the rebuild settlement predicate holds under the exclusive epoch lock (§5.8 step 3.7); reads/deliveries only `accepted` + deployment match; B07 bootstraps on a higher ordinal and halts (`epoch_regressed`) on a higher stored ordinal or an equal ordinal with a different ID; the website latches on the latter (§5.7.2). Consistent |
| B07 suggestion transitions (§7.4) | Status check; pending / in-flight indexes; `mutation_id` check; §7.2 mapping | Every in-flight status requires `mutation_id`; intake never edits in-flight rows; terminal statuses never reopen; `unsupported → awaiting_review` only for `no_active_mapping` at head. Consistent |
| B07 attempt mapping (§7.2) | `0026`/`0062` status, execution and confirmation values; `confirmBusinessInformation` `recovery_ready` | Every reachable combination after `executeAndConfirmGbpMutation` maps to one status; 5-minute window equals the existing `recovery_ready` rule. Consistent |
| B07 intake/claim (§4.5, §4.6) | Cursor DDL check (`claim_token` ⇔ `claim_expires_at`); halts | Claim set/cleared together on success, error, halt and bootstrap; every claim-owned write uses the live claim guard after the row lock; halts persisted only under a live claim, after any rollback. Consistent |
| Cross-document | B06 §4.8 feed codes ↔ B07 §4.5/§4.7; B06 §5.9 receipt key ↔ B07 §7.7 and events unique index; B06 §5.8.4 ↔ B07 §4.6 | Same codes (`epoch_changed`, `cursor_ahead`, `settling`, `publication_paused`, feed `not_permitted` ↔ `feed_not_permitted`), same idempotency key, same reset semantics; B06 §5.8.5 digest conflict ↔ B07 `revision_conflict` halt (DDL check, §4.7, OD-B7-9). Consistent |
| B06 consumer rules after R1 (§5.7) | §6.1 B06-04a, §6.3, §6.4, R13, R28 to R30 | Only authoritative reads apply positives, clear, make absent or reset; negatives from any read; no rule lowers a high-water. After final-rereview R1: same-epoch omission only from a complete snapshot at or above the stored one, keeps every fence; rule 4 consults the fence in every display state; R30a to R30c. After the `f32c9973` R1 clarification: a higher-epoch reset needs one explicit outcome per requested key and initializes each field by one outcome table (overlays and tombstones value-free and fenced, expired positives never renderable, `not_permitted` and out-of-set keys `absent` with the omission fence); R37a to R37d. After the `b6c4dd5a` correction: an overlay-initialized field keeps the tuple's revision and digest value-free, so rule 4's lower-revision refusal and equal-revision digest latch guard it before the fence; `not_permitted` keeps no per-field identity. Consistent |
| B07 claim fence after R4 (§6.5) | §2.1 item 7, §3.0 item 4, §6.1, §6.3 step 4.3, §6.4 item 6, P25 to P28 | Same fence row and both predicates named in every place; lock order B07 rows → fence, bulk → fence only, so no cycle. After final-rereview R4: bulk fence taken before `beginIntent`, two-ledger check immediately before `store.start`, typed refusal mapped to `deferred` / `resource_busy` in `runBulkWrite` only. Consistent |
| Restore reset (final-rereview R2) | B06 §5.2, §5.8 steps 3.4 to 3.7 and 4, R18a, R18b, R18c, R31a, R31b, R32, R36; B07 §4.6, P19a, P19b, P19c | No remaining unconditional revision-1 promise: first revision 1, final settled revision 1 or higher. Present tombstone → website `tombstone`, B07 `superseded` / `epoch_reset`; omitted key → website `absent`, B07 revision-0 `withdrawn` head and `withdrawn_at_source`. Both keep in-flight rows and audit history, apply the review-item rule and make no provider mutation. After the `f32c9973` R2 clarification omission means no non-shadow head after the reconciled rebuild (manifest and register both projected): R18b/R32/P19b use a key absent from both; a still-eligible manifest-only key is present (R18c, P19c). After the `b6c4dd5a` clarifications: NabaPresence resets from the settled-only snapshot route and the website from the answers read (overlays possible); a present published head is reviewable only per B07 §4.4 and a present `unavailable` head is head-only. Consistent |
