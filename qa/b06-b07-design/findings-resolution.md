# B06/B07 draft 2: findings-resolution map

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
| **B06-3** restore epoch and complete replay, missing tombstones | Epoch table (one live, ordinal, external record, acceptance by a second admin); deployment fence outside the DB; RB-12 B06 steps; reset builds the new epoch from scratch with known tombstones from a durable delivered-field register; consumers reset from a complete snapshot and clear omitted fields; cursors, receipts, jobs epoch-scoped; manifest version header allows an empty latest version; regression latch / `cursor_ahead` / `revision_regressed` when an epoch is missed; numeric rebase dropped | Review text; draft 1 manifest DDL (field rows only) | B06 §3.3, §5.3, §5.8; B07 §4.6, §4.7; R18 to R21, P19, P20 |
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
| OD-B6-11 | Epoch opener/acceptor and the RB-12 external record | Two different admins plus X1; until named, nothing is served |
| OD-B7-7 | Automatic Google readback for uncertain attempts | Disabled; person-initiated confirm path only |
| OD-B7-8 | Error-code classification `rejected` vs `failed` | All rejected attempts → `failed`; no automatic retry either way |
| OD-B7-9 | Who clears an intake halt | Organisation owners, after a new accepted epoch |

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
4. NabaPresence's owner accepts optional hooks on `startGbpMutation` (its
   module freezes signatures for existing callers; hooks are additive).
5. The exact `mutation_operation` predicate for unresolved bulk attribute
   writes, error-code classification and retention-reaper exclusion are
   confirmed at B07-00.
6. Residual race: a NabaLens withdrawal after the publish-time live read is
   not seen before the Google call (bounded by the < 50 s write budget) and
   is handled by the review-item rule.
7. The website can hold a shared CAS store (OD-B6-10); otherwise it stays in
   shadow.

## 6. State-table consistency check

| Table | Checked against | Result |
| --- | --- | --- |
| B06 delivery-state transitions (§5.4, rows 1 to 9) | §4.7 read rows; §5.2 tombstone list; V12 | Never-delivered failing a gate stays undelivered → `not_permitted` (row 6 ↔ §4.7 row 2); delivered failing a gate → overlay at once (§4.7 row 3) then tombstone (rows 7 to 9); re-enable continues from next revision (rows 4, 5, 7). Consistent |
| B06 read evaluation (§4.7) | Feed (§4.8); consumer rules (§5.7) | `settled` is the only outcome carrying a value or feed payload; overlays end feed pages and are applied as negatives by consumers. Consistent |
| B06 job phases (§5.6) | Jobs DDL checks (`phase`, `claim`); events kinds (`superseded`, `covered`) | Terminal phases are `free`; `readback` never → `superseded` within its epoch (only epoch open retires it); all kinds used exist in the check. Consistent |
| B06 epoch states (§5.3, §5.8) | Gating (§4.2.7); drain (`pending` or `accepted`); B07 §4.6 | Drain builds a `pending` epoch; reads/deliveries only `accepted` + deployment match; B07 bootstraps on a higher ordinal and halts (`epoch_regressed`) on a higher stored ordinal or an equal ordinal with a different ID; the website latches on the latter (§5.7.2). Consistent |
| B07 suggestion transitions (§7.4) | Status check; pending / in-flight indexes; `mutation_id` check; §7.2 mapping | Every in-flight status requires `mutation_id`; intake never edits in-flight rows; terminal statuses never reopen; `unsupported → awaiting_review` only for `no_active_mapping` at head. Consistent |
| B07 attempt mapping (§7.2) | `0026`/`0062` status, execution and confirmation values; `confirmBusinessInformation` `recovery_ready` | Every reachable combination after `executeAndConfirmGbpMutation` maps to one status; 5-minute window equals the existing `recovery_ready` rule. Consistent |
| B07 intake/claim (§4.5, §4.6) | Cursor DDL check (`claim_token` ⇔ `claim_expires_at`); halts | Claim set/cleared together on success, error and bootstrap; halts set only under the claim. Consistent |
| Cross-document | B06 §4.8 feed codes ↔ B07 §4.5/§4.7; B06 §5.9 receipt key ↔ B07 §7.7 and events unique index; B06 §5.8.4 ↔ B07 §4.6 | Same codes (`epoch_changed`, `cursor_ahead`, `settling`, `publication_paused`), same idempotency key, same reset semantics. Consistent |
