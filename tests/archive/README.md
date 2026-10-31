# Archive audit and monitoring failure-mode suites

Verification's tests for contract §4 (`docs/workstreams/contracts.md`): the
archive audit (`lib/server/archive/audit.ts`), its status endpoint, and the
independent checker (`scripts/monitoring/`). Everything runs locally. No
production access, no real R2, no live alert channel.

## Running

```sh
# Layer 1: fully in-process (fake database, fake store, controllable clock)
node node_modules/vitest/vitest.mjs run --config tests/archive/vitest.config.ts

# Layer 2: real database (Harness-owned ws2 stack). Needs the stack's env:
#   node "$H/scripts/ci/stack.mjs" env ws2 --write && . /tmp/nabalens-ws/ws2/env.sh
ARCHIVE_SUITE=db  node node_modules/vitest/vitest.mjs run --config tests/archive/vitest.config.ts

# Layer 3: audit + status route + checker + stub sink, controlled failures
ARCHIVE_SUITE=e2e node node_modules/vitest/vitest.mjs run --config tests/archive/vitest.config.ts
```

Suites that need Audit's or Monitoring's code skip themselves (via
`loadAudit()` / `loadChecker()` in `support/`) until that code is on the
branch, then run unchanged. A skipped suite is never a pass: the final report
lists skipped counts.

## Infrastructure (`support/`)

| File              | What it is                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clock.ts`        | `TestClock`: simulated time with its own timers. `sleep`, `deadline(ms)` (an `AbortSignal`), `advance`, and `drive(promise)` which jumps to each pending timer and fails if the work never settles (an unbounded hang). `install()` pins `Date`.                                                                                   |
| `fake-bucket.ts`  | `FakeBucket`: in-process `ArchiveStore` (§4.7) with injectable `error`, `latency`, `hang` (honouring or ignoring the abort signal), persistent `corrupt` and `vanish`, per-op and per-key matching, `after`/`times`, and a call log.                                                                                               |
| `fake-db.ts`      | `FakeDb`: PostgREST-shaped in-memory database with lease TTL on the test clock, identity ids, upsert conflicts, append-only tables, column projection, pluggable RPCs, fault injection (error, crash, before/after hooks), a write log, and `killable()` clients that simulate process death (no `finally`, lease left to expire). |
| `world.ts`        | A whole fake deployment: seeded receipts with matching bucket objects, ready assets with or without source originals, backfill, `reseed` (operator repair), state/run row accessors.                                                                                                                                               |
| `driver.ts`       | `startAudit`/`runAudit`/`runCycle`: one invocation with injected store, clock, deadline signal and backfill; `verifiedReceiptIds` (receipts whose blob and manifest were both read back).                                                                                                                                          |
| `invariants.ts`   | `watchCheckpoints`: observes every cursor write and records any receipt at or below the new cursor that has not been fully verified.                                                                                                                                                                                               |
| `monitor.ts`      | Checker harness: scripted status route, persistent dedup state, recording sink, digest sink and undelivered fallback.                                                                                                                                                                                                              |
| `module-mocks.ts` | `vi.mock` replacements for config, index and object-store, and `setupWorld()` (fresh world and clock per test).                                                                                                                                                                                                                    |

`unit/infra.test.ts` pins the behaviour of the fakes themselves.

## Rule to test map

IDs are the contract section. "Unit" is `tests/archive/unit/`.

### §4.2 stored state, §4.4 outcomes (`audit-cycle.test.ts`)

| Rule                                                                                                                                                    | Test                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Cycle record on completion (`cycle_*` cleared, `last_complete_at`, `last_complete_cycle_started_at`, `last_cycle_duration_seconds`, `last_run_outcome`) | completed_cycle verifies every receipt once                 |
| Empty library completes                                                                                                                                 | an empty library completes immediately                      |
| `partial`: progress kept, not a failure, `cycle_id` and target set                                                                                      | soft budget stops new work                                  |
| Resume keeps one `cycle_id`, cursor monotone, each receipt verified once, runs table matches                                                            | multi-invocation cycle                                      |
| Receipts after cycle start belong to the next cycle                                                                                                     | receipts created after the cycle started                    |
| `cycle_target_id`/`cycle_target_count` recorded before verifying                                                                                        | first run records its target                                |
| Id gaps do not break the target                                                                                                                         | receipt id gaps                                             |
| No false completion with missing originals (beyond backfill limit; source gone)                                                                         | unarchived ready originals beyond the limit; source is gone |
| Partial runs never refresh `last_complete_at`                                                                                                           | partial runs never refresh                                  |
| `consecutive_failures` counts and resets; `last_error` cleared                                                                                          | counts failed/timeout runs and resets                       |
| Timestamps from the injected clock                                                                                                                      | timestamps come from the injected clock                     |
| Runs table: one row per invocation, fields, error codes, append-only, 90-day retention                                                                  | audit runs table suite                                      |

### §4.3 lease, overlap, resume (`audit-lease.test.ts`)

| Rule                                                                                                                                                                      | Test                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Lease name, fresh holder per invocation, released                                                                                                                         | uses the media_archive_audit lease                                |
| TTL exceeds deadline                                                                                                                                                      | lease TTL exceeds the invocation deadline; `audit-budget` margins |
| Renewal at least once per batch and before each checkpoint                                                                                                                | renews (same holder)                                              |
| Long run outlives initial TTL by renewing                                                                                                                                 | keeps a long run alive                                            |
| Overlap returns `locked`, state untouched, run row written                                                                                                                | second invocation while the lease is held                         |
| `locked` is not a failure                                                                                                                                                 | locked is not a failure                                           |
| Lease RPC error throws `archive_lease_failed`, writes nothing; disabled throws `archive_disabled`                                                                         | lease RPC error; archive that is disabled                         |
| Lease lost: writes stop at once, only a run row, state untouched, other holder's lease kept                                                                               | renewal returning false mid-run; injected lease client            |
| Lease expiry during a slow batch with a second worker: loser writes nothing                                                                                               | lease that expires during a slow batch                            |
| Crash mid-batch (killed before or after a checkpoint): resume same cycle from the durable cursor, no skipped receipt, no false completion, no run row for the crashed run | crash mid-batch suite                                             |

### Failure modes (`audit-faults.test.ts`)

| Failure                                                                                            | Test                                                                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Store error / corruption / missing object, on blob and on manifest                                 | the 3 x 2 matrix: fails, cursor below the damaged receipt, heals after repair, no provider text persisted |
| Damage in the first batch                                                                          | no checkpoint, no completion                                                                              |
| Uneven latencies, concurrency: no skip, cursor monotone                                            | concurrent verification                                                                                   |
| Backfill store failure: `archive_store_unavailable`, original stays missing                        | store failure while backfilling                                                                           |
| Hang that honours the signal: `timeout` at the hard deadline, cursor kept, `timeout` not `partial` | store call that honours the signal                                                                        |
| Hang that ignores the signal: still `timeout` on time; late result changes nothing                 | store that ignores the abort signal                                                                       |
| Repeated timeouts accumulate, clear on success                                                     | repeated timeouts                                                                                         |
| Backfill hang                                                                                      | hang while backfilling                                                                                    |
| Checkpoint write failure: cursor stays at last durable value                                       | failing checkpoint write                                                                                  |
| Completion write failure: no false completion                                                      | failing completion write                                                                                  |
| Unknown missing count cannot complete                                                              | RPC error on missing_count                                                                                |
| Read errors: failed, never an empty completed cycle                                                | receipt read error; state row unreadable                                                                  |
| Stale run cannot forge a late completion                                                           | late completion cannot be forged                                                                          |

### Budget, pipelining, throttle, idle (`audit-budget.test.ts`)

| Rule                                                                                                                                      | Test                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Constants: cron 600 s, soft 480 s, hard 540 s, `maxDuration` 600, TTL 600 s, concurrency 8, checkpoint 20, backfill 5, `vercel.json` cron | agreed budget constants and margins                                     |
| Soft budget gives `partial`, hard deadline gives `timeout`                                                                                | slow but progressing run; in-flight receipt outliving the hard deadline |
| Checkpoint cadence and "cursor never passes an unverified receipt" (invariant observed on every write)                                    | checkpoints roughly every 20                                            |
| Slow early receipt never skipped: across timeout, across crash, across failure; does not block others                                     | pipelined watermark suite                                               |
| `missing_count` once per invocation                                                                                                       | runs missing_count once                                                 |
| `bytes_verified`                                                                                                                          | records bytes_verified                                                  |
| Throttle: new cycle only after 12 h from last cycle start, to the millisecond; open cycle never throttled; first run immediate            | cycle throttle suite                                                    |
| `idle`: not a failure, `last_run_at` updated, run row written, still backfills                                                            | idle tests                                                              |
| Age of last complete cycle stays under 26 h over 10 simulated days at the 12 h cadence                                                    | keeps the age under 26 h                                                |

### §4.5 status endpoint (`audit-status.test.ts`)

| Rule                                                                                 | Test                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| Exact field set and types, 93600, interval                                           | returns exactly the contract fields           |
| `ok`/`status` table including 26 h boundary, future time, missing, last error        | ok/status cases                               |
| Partials do not hide staleness                                                       | stale freshness is independent of recent runs |
| `inProgress` from open cycle, `cycleProgress` counts                                 | inProgress derives from an open cycle_id      |
| No keys, hashes, bucket names, ids; under 16 KiB                                     | exposes no object keys                        |
| Read errors throw `archive_status_unavailable`; read-only                            | throws on read error; is read-only            |
| Route: auth, `private, no-store`, 200/503, no provider detail                        | status route tests                            |
| Run route: monitor credential cannot run a job; outcome to HTTP mapping incl. `idle` | run route tests                               |

### §4.6 alerts (`monitor-checker.test.ts`, `monitor-integration.test.ts`)

| Rule                                                                                                                           | Test                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `stale`: never completed, 26 h boundary, disabled, future time                                                                 | stale suite                              |
| `missing_originals`, `run_failed` severity and escalation once at 3                                                            | conditions and dedup suites              |
| `not_running`: 3 x interval boundary; `idle` never trips it                                                                    | not_running tests; integration idle test |
| `cycle_slow`: above 72,000 s, non-paging, digest sink                                                                          | cycle_slow tests                         |
| `unreachable` (11 variants), `auth_rejected` (401, 403), `monitor_error` (loader, secret shape, broad credentials, origin pin) | probe failure suite                      |
| Dedup by condition, `recovered` with `recoveredCondition`, probe failures do not clear data conditions                         | dedup suite                              |
| Payload shape and allowlist, no free text, no extra fields, no credential                                                      | payload suite                            |
| Sink failure: exit 2, fallback record, retry next run; heartbeat                                                               | sink and heartbeat suites                |
| Audit's real status body drives the real checker                                                                               | integration suite                        |

### Database level (`db/`, needs the Verification stack)

Run on spare4 only (`assertVerificationStack()` refuses anything else, including
ws2). Real time, real leases, real constraints; only the archive store is fake.

| Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Test                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 25 concurrent acquirers: one winner; renewal; expiry takeover; holder-only release; TTL bounds 1 s to 1 h; invalid names; grants                                                                                                                                                                                                                                                                                                                                                  | `db/lease.test.ts`                   |
| Columns, types and defaults; outcome and error allow-lists; cycle all-or-nothing and cursor-within-cycle checks; counters; grants and RLS                                                                                                                                                                                                                                                                                                                                         | `db/state-runs.test.ts` (state)      |
| Checkpoint is conditional on `cycle_id` and a larger cursor; racing cycle starters give one winner; durability across a new connection                                                                                                                                                                                                                                                                                                                                            | `db/state-runs.test.ts` (checkpoint) |
| Runs table: constraints (outcome/error agreement, time order, non-negative counters), unique `run_id`, append-only (update, delete, truncate refused), 90-day retention, service-role-only grants, index                                                                                                                                                                                                                                                                          | `db/state-runs.test.ts` (runs)       |
| Real audit: full cycle and status; idle in the throttle window; partial then resume on a new connection with every receipt verified once; crash mid-cycle resumes from the durable cursor; two simultaneous invocations; lease takeover gives `lease_lost` with no state write; hang gives `timeout` at the deadline; vanished object fails below that receipt and heals; missing source original; failed backfill while idle; run-row retention; store failure while backfilling | `db/audit-real.test.ts`              |

### End to end (`e2e/controlled-failures.test.ts`, needs the Verification stack and the stub sink port)

**What this is.** The real status route handler is served **outside Next.js** on
127.0.0.1:3644 with only `readArchiveConfig` mocked, against the real spare4
database. The audit runs in-process with an injected fake store. The real
checker CLI (`--local`) reads the route and delivers to the real stub sink
(127.0.0.1:3651, `/tmp/nabalens-ws/alerts-verification`). Authorization is real,
so the checker's secret is exercised; one scenario uses a wrong secret.

**Why not a real Next.js app.** `readArchiveConfig` rejects any source that is not
`<20 chars>.supabase.co`, so a loopback Supabase can only yield `disabled`. No
product code was changed to get around it. The fake store's call log is asserted
empty around every status request and no R2 code path is reachable.

Scenarios: healthy, idle (never trips `not_running`), stale, run failed (warning,
one escalation at 3, recovery), timeout, missing original, not running,
cycle slow, disabled, auth rejected, unreachable, sink down (undelivered record,
exit 2, retry), and a hygiene scan of every alert for keys, ids and credentials.
Evidence is written to `.artifacts/archive-verification/` (gitignored), with a
README table generated from it.

## Assumptions confirmed with the owners

1. A failing backfill ends the run `failed` (`archive_source_unavailable` for a
   source read, `archive_store_unavailable` for a destination write), also during
   `idle`; verification progress is still saved first.
2. `idle`, `partial` and `completed_cycle` clear `last_error` and reset
   `consecutive_failures`; only `failed` and `timeout` set them. `locked` and
   `lease_lost` write no state, only a run row.
3. Store verify errors are recorded as `archive_audit_failed`.
4. Completion after the soft budget expired is legitimate when every page is
   fetched, the queue is empty and the watermark equals everything issued.

## Observations (not defects)

- `media_archive_audit_state` gives `service_role` Supabase's default table
  privileges (including DELETE and TRUNCATE). That predates the audit changes.
- The checker exits 1 for `cycle_slow`, which is non-paging by contract.
