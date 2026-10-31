# Indefinite original-media archive

The owner chose to retain uploaded food/media originals indefinitely, including
originals later removed from the staff portfolio and admin library. Successful
uploads in **required** mode receive a verified private archive before they are
marked ready. Live deletion still hides the file immediately; physical removal
waits for archival if an older ready upload has not been archived yet.

This guarantee covers validated media originals. Incomplete, cancelled and invalid
transfers are not successful uploads and are outside it. Avatars and generated
previews/thumbnails are outside this original-media archive; previews can be
regenerated from retained originals. A validated attempt can already be archived
even if a later derivative/database step fails. The archive is private recovery
storage, not an additional public portfolio or proof of publishing permission.

## Configuration and rollout

Apply `20261030150000_media_original_archives.sql` and
`20261030170000_media_archive_audit_cycles.sql` before deploying this code.
Set these variables only in the intended deployment environment:

| Variable                             | Production value/purpose                      |
| ------------------------------------ | --------------------------------------------- |
| `NABALENS_ENVIRONMENT`              | `production` (`staging` in the staging project) |
| `MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF` | Production Supabase ref in both projects |
| `MEDIA_ARCHIVE_MODE`                 | `required`                                    |
| `MEDIA_ARCHIVE_SOURCE_PROJECT_REF`   | Exact production Supabase project reference   |
| `MEDIA_ARCHIVE_R2_ACCOUNT_ID`        | Cloudflare account ID                         |
| `MEDIA_ARCHIVE_R2_BUCKET`            | Dedicated private backup bucket               |
| `MEDIA_ARCHIVE_R2_ACCESS_KEY_ID`     | Object Read & Write restricted to that bucket |
| `MEDIA_ARCHIVE_R2_SECRET_ACCESS_KEY` | Matching credential; server only              |

The existing Supabase URL and server service credential are used for source reads.
The module requires an exact HTTPS project origin matching the configured reference
and derives the R2 endpoint from the account ID. It does not accept a caller URL.
Never expose an R2 public development URL or attach a public domain to this bucket.
Do not enable an age-based lifecycle deletion rule for retained archive prefixes.

Only a validated loopback Supabase source with no hosted identity defaults to
disabled when no mode is set. Remote operator CLI sources require the same bound
identity/ref/mode even when `VERCEL_ENV` is absent; the cleanup CLI validates this
before any database request. Conflicting public/operator source URLs fail closed. Every Vercel deployment
must declare `NABALENS_ENVIRONMENT` as `production` or `staging` and set
`MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF` to the production reference in both projects.
The public Supabase URL must match that reference for production and differ for
staging. Missing or inconsistent identity fails closed, including when the staging
project uses Vercel's `production` deployment target. A staging deployment may use
`disabled` explicitly or its own separate archive. Production rejects `disabled`
and requires `required`; copying local disabled defaults into production cannot
silently remove retention.

Provision indefinite R2 bucket locks for exactly:

```text
<production-project-ref>/blobs/
<production-project-ref>/manifests/
```

The app never deletes or overwrites either prefix. There is no mutable R2 control
object: audit progress is held in the service-only database table. The operator
must verify the bucket is private, credentials are scoped and locks are enabled;
configuration names alone do not prove those provider properties.

The operator cleanup CLI and Playwright fixture runner explicitly select the
published `server-only` server export through `scripts/lib/server-runtime.mjs`.
This Node-only bootstrap changes resolution for that marker package alone; it
sets no global React condition or inherited `NODE_OPTIONS`. This tooling uses
Node synchronous module hooks (Node 22.15+; local CI uses Node 24.16). Application/browser
builds never import it and retain the normal `server-only` boundary.

## Write and deletion boundaries

The server validates an upload, then streams its original into a mode-0600 temporary
file while calculating SHA-256 and checking the exact size. It conditionally
creates a content-addressed R2 blob and reads the entire stored blob back to verify
size and SHA-256. It then conditionally writes and reads back an immutable JSON
manifest with source project/bucket/key, asset/owner/venue IDs, names at archival,
upload time, original filename, media type, MIME, size and hash. Only after both
copies verify does it record an append-only database receipt and mark the upload
ready. Temporary files are removed in `finally`.

Identical originals share one blob within the source project. Each asset retains
its own manifest and attribution; a filename/name change can add a small new
manifest, without duplicating original bytes. No repeated full daily snapshot is
created. R2 creation is conditional (`If-None-Match: *`). An existing key, including
R2's locked-object response, must still pass full read-back verification. No
ETag-as-SHA-256 assumption is made.

If archival is unavailable, finalisation remains retryable and never reports an
unarchived file ready. If deletion of a ready original cannot verify its archive,
the tombstone remains hidden while source bytes remain for cleanup to retry. The
existing Storage guard prevents end-user replacement of processing/ready originals.
A deletion racing with processing cannot make a tombstoned asset ready.

Each inline archival shares a 45-second I/O deadline and spools at most the existing
200 MiB product cap. It does not buffer an entire video in the JavaScript heap.
Provider throughput and the deployed function's temporary-disk/time limits still
need target verification. Unit tests and a local build do not certify that a
200 MiB video can complete the copy/read-back within that deadline on Vercel.
Never describe maximum-size hosted video support as passed without that evidence.

## Reconciliation and monitoring

Verified explicitly disabled staging returns a successful `disabled`/`skipped`
cron response without opening a privileged client. Its status endpoint remains
unavailable, so this skip cannot be mistaken for a healthy archive.

Vercel invokes `/api/internal/media-archive` every 10 minutes (`*/10 * * * *`)
using the existing `CRON_SECRET`/`CLEANUP_SECRET` bearer convention. Verification
is a resumable **cycle**:

- A cycle targets every receipt that existed when it started
  (`cycle_target_id`, with the receipt count in `cycle_target_count`). Eight
  workers read each stored blob and manifest back and compare size and SHA-256.
  Workers pull receipts continuously with no per-batch barrier. The durable cursor
  (`cursor_id`) is checkpointed every 20 receipts, and once more when a run ends,
  at the end of the unbroken run of verified receipts. It never passes a receipt
  that is not verified, so a slow or failing receipt holds the cursor back while
  later receipts are still read and counted in `bytes_verified`.
- Each invocation backfills up to five ready originals that have no receipt yet,
  then verifies receipts until a **480 s soft budget** is spent. It then stops
  taking new receipts and ends `partial` (progress saved, cycle continues). A
  **540 s hard deadline** abandons in-flight work and ends `timeout`, keeping
  progress up to the last checkpoint. The route's `maxDuration` is 600 s, the
  lease TTL is 600 s and is renewed at every checkpoint. A test keeps the deadline
  at least 60 s under `maxDuration` and the soft budget at least 30 s under the
  deadline. An overlapping invocation returns `locked` without touching cycle
  state. If a lease renewal is refused the run stops writing at once and records
  only a `lease_lost` row in `media_archive_audit_runs`; it never edits the audit
  state, which the new holder owns.
- Only a cycle that verifies every targeted receipt, with zero ready originals
  missing receipts, sets `last_complete_at`. A failed or timed-out run never makes
  the archive look fresh, and it does not delay the retry of an open cycle.
  `media_archive_missing_count` runs once per invocation.
- **Cycle throttle.** A new cycle starts only when no cycle is open and the last
  complete cycle started at least 12 hours ago. Invocations inside that window end
  `idle`: they still backfill, update `last_run_at` and write a run row, and are
  not failures. This keeps R2 read operations proportional to need.
- **Freshness.** The 26-hour limit is unchanged. The age of the last complete
  cycle is about the larger of the 12-hour throttle and the cycle time, plus any
  growth in cycle time between cycles. For example a 12-hour throttle with a cycle
  that grew from 2 to 14 hours reaches 24 hours; if cycle time grows faster than
  that the threshold would be crossed. The monitor's `cycle_slow` warning (cycle
  time above 20 hours) is the early signal that the schedule is being outgrown.
  A cycle of the representative library must complete within 24 hours; the sizing
  is in `docs/archive-capacity.md`. Stale status is an operational failure, not
  permission to weaken the threshold.
- Every invocation writes one row to the append-only, service-role-only
  `media_archive_audit_runs` table (outcome, counts, bytes read back, error code,
  cursor range). Rows older than 90 days are pruned by the audit; nothing else may
  update or delete them. This table is for operators, not the monitor.

Outcomes are `completed_cycle`, `partial`, `idle`, `locked`, `timeout`, `lease_lost`
and `failed`. `partial`, `idle` and `locked` are not failures and the cron route
answers 200. `timeout` and `lease_lost` answer 503 and `failed` answers 500 with a
redacted body. `timeout` and `failed` increment `consecutive_failures`; a `partial`, `idle` or
`completed_cycle` run clears `last_error` and resets it (`locked` and `lease_lost`
write no state). A backfill failure ends the run `failed`, even inside the
throttle window, so it alerts. Stored error codes are fixed
(`archive_audit_failed`, `archive_audit_timeout`, `archive_checkpoint_failed`,
`archive_store_unavailable`, `archive_source_unavailable`); the real R2 store
reports every read-back problem (unreachable, missing, wrong size or hash) as
`archive_audit_failed`, so the code does not distinguish corruption from an outage.
A corrupt or missing receipt holds the cursor at that receipt and repeats as a
failure each run until a person resolves it.

This adds function execution, source reads during backfill and R2 read operations
(roughly two GET requests per receipt per cycle). Keep the archive bucket in
Cloudflare R2 **Standard** storage. Infrequent Access charges per-GB retrieval for
every verification read, which would cost on the order of $2,000 a month at the
high capacity case. These costs use the existing plans and can incur usage charges.

A 10-minute cron and a 600-second function need a Vercel plan that allows them.
`docs/INFRASTRUCTURE.md` records production as Vercel Pro; a human must confirm the
project is on Pro before this schedule ships, because Hobby limits crons to once a
day and shorter function durations.

`GET /api/internal/media-archive/status` is read-only. It accepts the existing
cleanup bearer or an optional independent `MEDIA_ARCHIVE_MONITOR_SECRET`. The
monitor credential grants access only to this status endpoint; it cannot run the
archive copy/audit job or cleanup, and cannot remove media. It must be a separate
32–256-character ASCII token containing only letters, digits, `_` or `-`. Set it
as a server-only production environment value and keep the matching local value
in macOS Keychain, never in a committed file or the monitor command arguments.

The endpoint fails when no complete cycle exists, the last complete cycle is more than 26
hours old, ready originals are missing receipts, or the last run failed. It reports
an open cycle separately (`inProgress`, from `cycle_id`), including when a recent
completed cycle remains fresh. Failed and partial runs do not become fresh
successful backups. Besides the existing fields, the body carries `lastError` (a
code, never a message), `lastRunOutcome`, `consecutiveFailures`, `cycleStartedAt`,
`cycleProgress` (`{ checked, target }` counts), `lastCycleDurationSeconds`,
`maxAgeSeconds` (93600) and `scheduleIntervalSeconds` (600), so an independent
checker can tell a job that stopped running from a slow one. It still contains no
object keys, asset IDs or bucket names. If the schedule is outgrown, raise the
budget or frequency; never weaken the 26-hour threshold.

The local checker reads the narrow credential from macOS Keychain using service
`naba-lens-production-archive-monitor` and account `https://naba-lens.vercel.app`.
It pins that production origin before accessing Keychain and never sends the
credential to another origin or follows a redirect. Run the combined signed-out
smoke checks and authenticated archive health check with:

```sh
node scripts/ci/monitor-archive.mjs --with-smoke https://naba-lens.vercel.app
```

The checker preserves the existing signed-out smoke checks and then makes one
read-only status request. It requires HTTP 200, JSON, `private, no-store`, a current
successful report, zero missing originals, no recorded failure, valid non-future
run times, and a completed verification cycle no older than **26 hours**. A new
cycle may be in progress while an earlier complete cycle is still fresh. Missing,
invalid or unavailable Keychain credentials fail with exit code 1 and a redacted
message; the checker never falls back to the more powerful cleanup credential.
It also fails on timeouts, redirects, oversized or malformed responses and stale
or incomplete health. A successful run prints `Naba-Lens archive freshness: PASS`;
a failure prints `FAIL` with a safe reason and exits nonzero.

The existing local `com.lapeninns.local-ci.smoke` LaunchAgent is loaded with an
intended daily schedule of **06:00 in the Mac's local time zone**. That schedule
and the monitor implementation do not prove that a future check will execute or
that a notification will arrive. A daily check can discover the 26-hour freshness
failure only on a later scheduled run; this is not continuous monitoring. If the
Mac is off, asleep, offline, or unable to access Keychain, prompt detection and
alerting are not guaranteed. An always-on external checker is needed to remove
that dependency on this Mac.

**Real owner notification delivery remains unverified.** The endpoint, local
schedule and nonzero exit code do not themselves establish alert delivery. Do
not mark monitoring complete until the checker runs against the deployed endpoint
with its real read-only credential and an observed failure reaches the intended
notification destination.

## Recovery and retention limits

Database backups preserve archive receipts but exclude media bytes. The immutable
R2 manifest also preserves attribution if a file was removed before a later database
snapshot. A recovery operator can enumerate private manifests, download the
referenced blob and compare SHA-256/size before using it. Recreating a live portfolio
requires a separately rehearsed restore on an isolated target, including Auth,
private Storage settings, source IDs/venue attribution and access checks.

Deleting a live photo does **not** delete its retained archive copy. Staff-facing
retention guidance must disclose this. Archive removal is a separate exceptional
owner process; this implementation has no removal or expiry endpoint. Indefinite
retention still depends on keeping provider accounts, billing, credentials,
security controls and independent recovery tests operational.

Implementation references: [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[R2 bucket locks and conditional-write order](https://developers.cloudflare.com/r2/buckets/bucket-locks/).
