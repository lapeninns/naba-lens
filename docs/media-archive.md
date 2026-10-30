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

Apply `20261030150000_media_original_archives.sql` before deploying this code.
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

Vercel invokes `/api/internal/media-archive` at minute 43 each hour using the existing
`CRON_SECRET`/`CLEANUP_SECRET` bearer convention. It backfills up to ten earlier ready
assets, then verifies up to fifty archive receipts, subject to an 80-second shared
deadline. A durable receipt cursor resumes the next invocation; only a fully
verified cycle with zero missing ready originals updates `last_complete_at`.
The maintenance lease prevents concurrent audits. This adds function execution,
source reads during backfill and R2 read operations; those use the existing plans'
quotas and can incur usage charges.

`GET /api/internal/media-archive/status` is read-only. It accepts the existing
cleanup bearer or an optional independent `MEDIA_ARCHIVE_MONITOR_SECRET`. The
monitor credential grants access only to this status endpoint; it cannot run the
archive copy/audit job or cleanup, and cannot remove media. It must be a separate
32–256-character ASCII token containing only letters, digits, `_` or `-`. Set it
as a server-only production environment value and keep the matching local value
in macOS Keychain, never in a committed file or the monitor command arguments.

The endpoint fails when no complete cycle exists, the last complete cycle is more than 26
hours old, ready originals are missing receipts, or the last run failed. It reports
an in-progress cursor separately, including when a recent completed cycle remains
fresh. Failed and partial runs do not become fresh successful backups. At greater
volume, more frequent invocations or a resumable larger budget may be needed; a
stale status is an operational failure, not permission to weaken the threshold.

The local checker reads the narrow credential from macOS Keychain using service
`nabalens-production-archive-monitor` and account `https://nabalens.vercel.app`.
It pins that production origin before accessing Keychain and never sends the
credential to another origin or follows a redirect. Run the combined signed-out
smoke checks and authenticated archive health check with:

```sh
node scripts/ci/monitor-archive.mjs --with-smoke https://nabalens.vercel.app
```

The checker preserves the existing signed-out smoke checks and then makes one
read-only status request. It requires HTTP 200, JSON, `private, no-store`, a current
successful report, zero missing originals, no recorded failure, valid non-future
run times, and a completed verification cycle no older than **26 hours**. A new
cycle may be in progress while an earlier complete cycle is still fresh. Missing,
invalid or unavailable Keychain credentials fail with exit code 1 and a redacted
message; the checker never falls back to the more powerful cleanup credential.
It also fails on timeouts, redirects, oversized or malformed responses and stale
or incomplete health. A successful run prints `NabaLens archive freshness: PASS`;
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
