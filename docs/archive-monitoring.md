# Archive monitoring: independent checker and alerting

This page covers how Naba-Lens finds out, without human attention and without
depending on the app's own cron or the owner's Mac, that the media archive has
stopped being verified. For what the archive and its audit do, see
[media-archive.md](media-archive.md).

> **Provisioning and real delivery remain unverified.** The checker, Cloudflare
> email sink and Vercel heartbeat watchdog have local test coverage. The owner
> selected the existing Cloudflare account and `amanshresthaaaaa@gmail.com`; no
> new monitoring service is required. The production status credential already
> works, but this does not prove that the Worker, its restricted deployment token,
> email binding, watchdog migration or hosted delivery path is configured. Complete
> [Provisioning and rollout](#provisioning-and-rollout) and retain the evidence in
> [Verify end to end](#verify-end-to-end).

## Why this exists

The first monitor (`scripts/ci/monitor-archive.mjs`, run by the
`com.lapeninns.local-ci.smoke` LaunchAgent) checks once a day, reads a Keychain
secret, and only sets an exit code. It cannot find a failure while the Mac is off,
asleep or offline, and nothing tells the owner. It remains the only configured check until the external paths are provisioned;
once those are verified, it can remain as an additional local check.

## Architecture

```text
Cloudflare Worker (every 5 min) ── send_email ──▶ verified owner inbox
  │  GET /api/internal/media-archive/status      (Cloudflare transport)
  │  Bearer MEDIA_ARCHIVE_MONITOR_SECRET
  ▼
Vercel production archive status (read-only)

Worker: successful delivery + durable KV state
  │  POST /api/internal/archive-monitor/heartbeat
  │  Bearer ARCHIVE_MONITOR_HEARTBEAT_SECRET
  ▼
Supabase heartbeat singleton (database server timestamp)
  ▲
Vercel watchdog cron (every 5 min) ── Resend ──▶ same owner inbox
  GET /api/internal/archive-monitor/watchdog     (independent transport)
```

| Piece              | File                                                                                  | Notes                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Portable core      | `scripts/monitoring/archive-checker.mjs`                                              | Evaluates conditions, persists pending deliveries and deduplicates alerts.                                |
| Worker             | `scripts/monitoring/cloudflare-worker.mjs`                                            | KV state, restricted email binding and authenticated heartbeat. Requires separate provider deployment.    |
| Heartbeat receiver | `app/api/internal/archive-monitor/heartbeat/route.ts`                                 | POST authenticated with its own narrow secret; records database server time and ignores the request body. |
| Watchdog           | `app/api/internal/archive-monitor/watchdog/route.ts`, `lib/server/archive-monitor.ts` | Vercel cron checks for missing heartbeats and uses existing Resend for stopped/recovered email.           |
| Watchdog state     | `supabase/migrations/20261031180000_archive_monitor_watchdog.sql`                     | Service-role-only heartbeat and durable alert state.                                                      |
| Node CLI/stub      | `scripts/monitoring/check-archive.mjs`, `stub-alert-sink.mjs`                         | Local checks and controlled delivery tests; generic HTTPS sink remains supported.                         |
| Legacy monitor     | `scripts/ci/monitor-archive.mjs`                                                      | Mac-dependent extra check, with its existing Keychain credential.                                         |

### Guarantees

- **Separate credentials for separate authority.** `MEDIA_ARCHIVE_MONITOR_SECRET`
  is sent only to `GET /api/internal/media-archive/status` on the pinned origin
  `https://naba-lens.vercel.app`, with redirects refused, a 15 s timeout and a
  16 KiB body limit. The route accepts it for status only; it cannot run the
  archive job, cleanup or remove media. The distinct
  `ARCHIVE_MONITOR_HEARTBEAT_SECRET` is sent only by POST to the pinned Vercel
  heartbeat receiver. It records liveness and grants no archive-read, copy or
  delete authority. Neither credential is sent in a URL or persisted in KV.
- **No broader credentials.** The checker refuses to run, with `monitor_error`,
  if its environment holds `CLEANUP_SECRET`, `CRON_SECRET` or
  `SUPABASE_SERVICE_ROLE_KEY`. It never falls back to them.
- **The 26-hour limit cannot be widened by the server.** The checker uses the
  smaller of the reported `maxAgeSeconds` and 93 600 s (26 h).
- **Redaction.** Alerts contain only the whitelisted status fields from the
  contract, a fixed summary and a runbook link. Response bodies, URLs and error
  text are never copied. `lastError` is passed on only if it looks like a known
  error code.
- **Failures are never swallowed.** A failed delivery, failed state save or
  failed heartbeat gives exit code 2 (Workers: a failed invocation) and, for
  undelivered alerts, a local fallback record. Pending deliveries also persist
  in the checker state (the CLI state file or Worker KV), retaining the original
  alert ID and payload. They retry even if the condition clears before the next
  run, with recovery delivered after the original alert.
  An unreadable or malformed existing state fails closed with `state_load_failed`:
  the checker does not overwrite it, deliver new alerts or send a heartbeat until
  it can read valid state. A missing CLI state file is the only file-read case
  treated as a new checker; legitimate older version-1 state without an outbox
  remains compatible.
  Unchanged validated state is not rewritten: healthy cron ticks and already
  deduplicated conditions consume no state writes. Changed outbox/delivery state
  must persist before heartbeat. A fallback record is written once per pending
  event, with its success marker persisted in the outbox; failed fallback writes
  are retried. The Worker fallback expires after 30 days, while the pending
  outbox retains the original alert until delivered. Monitor shared account KV
  quotas as well as namespace usage; this optimisation is not a quota guarantee.

### Alert behaviour

- One alert per condition, deduplicated until the condition clears. A
  `recovered` alert (severity `info`, with `recoveredCondition`) follows when it
  clears.
- `run_failed` is a warning and sends one more alert when it rises to critical
  (3 or more consecutive failures).
- A probe failure (`unreachable`, `auth_rejected`, `monitor_error`) says nothing
  about the data conditions, so an active `stale` stays active and is not
  repeated or "recovered" during an outage. Moving from one probe failure to
  another replaces the first without a `recovered` alert.
- Payload: `nabalens.archive-alert/v1` as in the workstream contract, with one
  addition: `recoveredCondition` on `recovered` alerts. `status` is `null` when no
  valid status body was read.
- Exit codes of the CLI: `0` healthy, `1` at least one condition is active (alerts
  delivered or already sent), `2` the checker, delivery, state or heartbeat
  failed. `node scripts/monitoring/check-archive.mjs --help` prints the same.
- **Exit 1 is not a page.** It means only "at least one condition is active",
  including a lone `cycle_slow`, which is a non-paging warning. Whether something
  pages is decided by the alert's `severity` and its routing (main sink or digest
  sink), never by the exit code. Anyone wrapping the CLI, for example a cron
  runner, a CI job or a supervisor, must not page on exit 1 alone. Treat exit 2
  as a fault in the checker itself, and read `alerts.jsonl` or the sink for what
  is active.
- **Paging and non-paging.** `cycle_slow` (and its `recovered`) is routed to an
  optional second destination, the digest sink (CLI `--digest-sink` /
  `ARCHIVE_ALERT_DIGEST_SINK_URL`, Worker secret `DIGEST_SINK_URL`), for a digest
  or email, not a page. If no digest sink is configured it goes to the main sink.
  All other conditions always use the main (paging) sink.
- **Run outcomes.** `idle` (no open cycle, the 12 hour cycle throttle has not
  elapsed) is not a failure and still updates `lastRunAt`, so it never raises
  `not_running`. The checker raises conditions only from the explicit flags and
  timestamps, never from `lastRunOutcome` alone, so an outcome code it does not
  know yet neither alerts nor hides a problem; it is passed through in the alert
  only if it is a plain lowercase code.
- Reminders are not sent. An unacknowledged critical alert is sent once; the
  heartbeat and a destination that keeps history (not a transient chat message)
  are what make a missed alert recoverable. Add repeat reminders only if the
  owner asks.

## What "fresh" means

`lastCompleteAt` is the time a verification cycle **finished**. A cycle verifies
the receipts that existed when it started, and with the 12 hour cycle throttle a
new cycle does not start until 12 hours after the previous one started.

The age of the last complete cycle therefore stays under 26 hours only while the
cycle duration stays under about 14 hours. In the worst case it is about
`max(12 h, previous duration) + (new duration - previous duration)`, so a cycle
that jumps from 2 hours to 20 hours reaches about 30 hours. Nothing guarantees the
age is always under 26 hours.

The checker does not loosen the 26 hour limit to allow for this. `stale` fires when
`lastCompleteAt` is older than 26 hours, and `cycle_slow` (a cycle over 20 hours)
is the early warning that the margin is gone.

## Existing-services hosting and dead man's switch

The selected design uses the owner's existing Cloudflare account, Vercel Pro,
Supabase and Resend. Cloudflare sends primary alerts directly through the
`ARCHIVE_ALERT_EMAIL` binding, restricted at the provider to the fixed verified
recipient. `ALERT_EMAIL_FROM` must be a confirmed sender under an existing routed
or onboarded domain. No Resend key or archive credentials belong in the Worker.
Cloudflare documents free sends to verified destinations even when only Email
Routing is configured; provider acceptance and inbox delivery still need testing.
See [verified destinations](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
and [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/).

The account also holds the archive bucket. Bootstrap the Worker using the owner's
existing account access, then use an account-owned **Editor token restricted to
that Worker** for ongoing deployment, secrets and schedule changes. The broad
Wrangler OAuth credential is not the ongoing monitor deployment credential.
Cloudflare supports deploying an existing Worker's KV binding without direct KV
access; grant no R2 or other application permissions. See
[Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/).
Record the actual token policy and verify its scope rather than inferring it from
its name. A scoped token does not isolate the monitor from a Cloudflare-wide
outage or an account-owner compromise.

### Dead man's switch

After successful alert delivery and persistence of any changed checker state,
the Worker posts an authenticated heartbeat to the fixed Vercel receiver. An unhealthy archive
can still produce a heartbeat when its alert has been delivered: liveness and
archive health are separate. Failed delivery, failed state persistence or failed
heartbeat produces a failed Worker invocation.

The Vercel watchdog runs every five minutes and alerts when no successful heartbeat
has been recorded for **25 minutes**, or on recovery. It uses database server time,
service-role-only state and the separate existing Resend transport. Watchdog email
is fixed to `amanshresthaaaaa@gmail.com`; its sending-only key should be dedicated
to this purpose and limited to its sender domain. No new heartbeat vendor account
is needed. Durable claims and stable delivery IDs support retry and deduplication.

Cloudflare failure is detected from Vercel; Vercel failure is detected by the Worker
and its Cloudflare email transport. Both paths depend on the same destination
mailbox. If the mailbox blocks mail, both transports fail, or Vercel and Cloudflare
are unavailable together, timely delivery is not assured. Supabase failure must
be treated as a watchdog storage fault, not a fresh heartbeat; retain hosted tests
for that path. Cron delivery is best effort and detection can be later than 25
minutes if watchdog invocations are delayed. The watchdog's own cron has no third
independent supervisor in this existing-services design.

### GitHub Actions secondary (documented, not committed)

Not committed, because a workflow without its secrets would only fail. A human who
wants it creates the workflow (adjust the cron to taste):

```yaml
on:
  schedule: [{ cron: "*/10 * * * *" }]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node scripts/monitoring/check-archive.mjs
        env:
          MEDIA_ARCHIVE_MONITOR_SECRET: ${{ secrets.MEDIA_ARCHIVE_MONITOR_SECRET }}
          ARCHIVE_ALERT_SINK_URL: ${{ secrets.ARCHIVE_ALERT_SINK_URL }}
          ARCHIVE_HEARTBEAT_URL: ${{ secrets.ARCHIVE_SECONDARY_HEARTBEAT_URL }}
```

It exits 1 while any condition is active, so the failed run is an extra signal.
That includes the non-paging `cycle_slow`, so do not route a failed run to a page;
the sink alert's severity and routing decide paging.
With no state restored between runs, every run re-alerts; restore
`ARCHIVE_CHECKER_STATE_FILE` with a cache step if that is too noisy.

## Alert runbooks

Each `ownerAction` in an alert links to one of these anchors. Throughout, "status"
means the fields in the alert's `status` object. The archive audit runs from the
Vercel cron `/api/internal/media-archive` (hourly, minute 43).

### stale

No verification cycle has completed, or the last one finished more than 26 hours
ago (or the archive reports `disabled`). Originals may be unprotected.

1. Read `lastRunOutcome`, `lastError`, `consecutiveFailures`, `cycleProgress` and
   `lastCycleDurationSeconds` in the alert.
2. Open the Vercel logs for `/api/internal/media-archive`. A cycle that keeps
   ending `partial` or `timeout` without completing means the library has outgrown
   the per-run budget: see [archive-capacity.md](archive-capacity.md) when present
   and raise the budget or frequency through a reviewed change. Do not widen the
   26-hour threshold.
3. `disabled` means archive configuration is missing in the environment; restore it.
4. Re-run the check after the next cycle completes. A `recovered` alert closes it.

### missing_originals

`missing` ready originals have no verified archive copy.

1. Do not delete or clean up media until this clears.
2. Check whether `run_failed` is also active: a failing audit explains a count
   that is not shrinking.
3. Follow the recovery guidance in [media-archive.md](media-archive.md) to
   backfill the missing copies, then confirm `missing` returns to 0.

### run_failed

The last archive run failed (`lastError`), or `consecutiveFailures` is at least 1.
Warning until 3 consecutive failures, then critical.

1. Use `lastError` to find the cause: `archive_store_unavailable` or
   `archive_source_unavailable` point at R2 or Supabase Storage reachability or
   credentials; `archive_audit_timeout` at the budget; `archive_lease_lost` at an
   overlapping or slow run; `archive_checkpoint_failed` and `archive_audit_failed`
   at the database or a bug.
2. Check the Vercel function logs for the matching run.
3. A later successful run clears `lastError`; wait for `recovered`.

**Repeating `archive_audit_failed`.** A corrupt or missing receipt holds the audit
cursor at that receipt. The archive store reports every read-back problem
(unreachable, missing, wrong size or wrong hash) as `archive_audit_failed`, so the
code does not say which it is. Later receipts are still checked, but the cycle
cannot complete while one receipt stays unverified, so every run fails the same way
until a person fixes the object or the receipt. Nobody and nothing fixes it by
waiting. The alert is a warning at first and pages when `consecutiveFailures`
reaches 3. If `cycleProgress.checked` has stopped moving between alerts, suspect
this case. `stale` will follow when the last complete cycle passes 26 hours.

What the owner should check, in this order:

1. Rule out an outage first. If `archive_store_unavailable` or
   `archive_source_unavailable` is also appearing, or other runs recently
   succeeded, the store or the source may simply be unreachable. Check the
   Cloudflare R2 and Supabase status pages and the credentials, and wait one more
   run.
2. If the failure repeats from the same position, read the run history in the
   archive audit tables for the receipt where the cursor stopped, and the Vercel
   function logs for that run. Note the asset the receipt belongs to.
3. Check the archive object for that receipt in the R2 console (does it exist, and
   does its size match the receipt?) and check the original in Supabase Storage.

What the owner should do, with the media still in place:

- **Archive object missing or damaged, original intact:** have the archive copy
  rewritten from the original through the reviewed archive tooling, then let the
  next run verify it.
- **Original gone or damaged, archive copy intact:** the archive copy is now the
  only good copy. Restore the original from it and do not delete the archive
  object.
- **Both gone or damaged:** the media cannot be recovered from this system. Look
  for another copy (the uploader's device, a backup) and record the loss.
- **Receipt wrong, objects fine:** the receipt record is at fault. Correct or
  rebuild it through a reviewed change or migration, not by hand in production.

Do not run cleanup or delete media while this is active. Changes to the archive
data or code go through a reviewed change; this runbook does not give commands for
production. Once the next run verifies the receipt, the cursor moves on and
`recovered` follows.

### cycle_slow

Warning, non-paging. The last complete cycle took more than 72 000 s (20 hours),
leaving little room under the 24 hour target. Route this to a digest or email, not
a page. Nothing is wrong yet; act in working hours.

1. Compare `lastCycleDurationSeconds` with the planned capacity in
   [archive-capacity.md](archive-capacity.md) (when present).
2. Look at library growth and at `partial` or `timeout` runs, then raise the
   per-run budget or invocation frequency through a reviewed change.
3. A later faster cycle closes it with `recovered`.

### not_running

`lastRunAt` is older than three times `scheduleIntervalSeconds`: the job is not
being invoked, whatever the data says. With the planned 600 s interval that is 30
minutes. Vercel crons are best effort and can miss or double-fire, so a single
missed firing is expected noise and is the reason for the 3x factor; the alert
should fire only when several in a row are missing. `idle` runs update
`lastRunAt`, so a quiet archive does not trip it.

1. In the Vercel dashboard, confirm the cron `/api/internal/media-archive` exists
   in the current production deployment and is enabled.
2. Confirm the deployment is the intended one and the app's `CLEANUP_SECRET` /
   `CRON_SECRET` are set; a rejected cron call leaves no run.
3. Redeploy or fix the cron configuration through the normal PR flow.

### unreachable

The checker could not read a valid status: timeout, network error, redirect,
non-JSON or oversized body, wrong cache headers, or an error status without a valid
body. The summary names the reason.

1. Open `https://naba-lens.vercel.app` in a browser and check the Vercel and
   Supabase status pages.
2. `http_503` with `invalid_body` often means `MEDIA_ARCHIVE_MONITOR_SECRET` and
   `CLEANUP_SECRET` are both unset on the app (the route returns `unconfigured`).
3. `redirect` or `bad_headers` means something changed in front of the app (domain,
   proxy, framework upgrade). The checker deliberately does not follow it.
4. Data conditions that were active stay active and are not repeated.

### auth_rejected

The route answered 401 or 403: the monitor credential was revoked, rotated on one
side only, or the app's value changed.

1. Compare the checker's `MEDIA_ARCHIVE_MONITOR_SECRET` with the app's value
   without printing either.
2. Re-provision one value in both places (see the rotation steps below). Do not
   substitute the cleanup secret.

### monitor_error

The checker itself could not run: missing or malformed credential, a forbidden
broad credential in its environment, a bad origin or mode. The summary gives a
code, never the value.

| Code                                                                 | Meaning                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bad_secret`                                                         | Secret missing, not 32–256 characters of `A–Z a–z 0–9 _ -`, or two credential sources set                            |
| `broad_credential`                                                   | `CLEANUP_SECRET`, `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` is present where the checker runs: remove it          |
| `origin_not_pinned`, `bad_origin`, `bad_mode`, `origin_not_loopback` | Configuration points somewhere other than the pinned production origin (or a loopback origin in explicit local mode) |
| `checker_error`                                                      | Unexpected internal error; read the Worker logs                                                                      |

If no alert destination is usable, the CLI exits 2 and writes the record to
`undelivered.jsonl`, and the Worker invocation fails.

### recovered

A condition cleared. `recoveredCondition` names it. No action needed; confirm the
archive stays healthy over the next cycle.

## Run it locally (stub only)

Local mode is an explicit opt-in and accepts only `http(s)://127.0.0.1:<port>` or
`http(s)://[::1]:<port>` origins, so the production pin is never weakened. Sink and
heartbeat URLs must also be loopback in local mode.

```sh
# 1. Stub alert sink: 127.0.0.1 only, ports 3650-3659 (default 3650).
node scripts/monitoring/stub-alert-sink.mjs --port 3650 --dir /tmp/nabalens-ws/alerts

# 2. One check against a local app, with a local stub credential (the app uses the
#    same value for MEDIA_ARCHIVE_MONITOR_SECRET).
MEDIA_ARCHIVE_MONITOR_SECRET=<local stub, 32-256 chars [A-Za-z0-9_-]> \
node scripts/monitoring/check-archive.mjs --local \
  --origin http://127.0.0.1:3642 \
  --sink http://127.0.0.1:3650/alerts \
  --alerts-dir /tmp/nabalens-ws/alerts
```

Files in the alerts directory: `alerts.jsonl` (every alert the sink received),
`undelivered.jsonl` (alerts the checker could not deliver, with the reason) and
`checker-state.<mode>.json` (dedup state; delete it to start a scenario afresh).
Other options: `--state`, `--sink-format json|slack`, `--heartbeat`, or the
`ARCHIVE_*` environment variables listed in `scripts/monitoring/check-archive.mjs`.

Tests (no network beyond loopback):

```sh
node --test scripts/monitoring/archive-checker.test.mjs scripts/ci/monitor-archive.test.mjs
```

## Provisioning and rollout

The owner authorised configuration using existing services. The following are
rollout tasks, not a record of completed setup. Never place actual secret values
in this document, repository, shell arguments, chat or logs.

1. Confirm Vercel production targets project `naba-lens` on its Pro team. Verify
   the project link explicitly: an old local `.vercel/project.json` may still point
   to the retired staging project. Do not deploy using that stale link.
2. Resolve PR review findings, finish local checks, rebase on the current default
   branch and run the required final-head `lci` gate once. Do not bypass a gate.
3. Coordinate the audit migration `20261030170000_media_archive_audit_cycles.sql`
   and application switch away from the existing minute-43 hourly audit. The old
   audit can write a positive cursor without a cycle ID, which the new constraint
   rejects. Prevent an old audit invocation during this window; verify the new
   code and schema together before enabling the ten-minute archive schedule.
4. Apply the watchdog migration `20261031180000_archive_monitor_watchdog.sql` in
   the authorised production rollout and deploy its receiver/watchdog routes.
   Initialise the Worker promptly: the watchdog should correctly report missing
   heartbeats if setup remains incomplete. Do not fabricate liveness timestamps.
5. Keep the existing independent `MEDIA_ARCHIVE_MONITOR_SECRET` in Vercel and
   matching Worker secret storage. It must be a 32–256-character URL-safe token,
   distinct from cleanup and cron secrets. Keep the Mac copy in its existing
   Keychain service/account if the local extra check is retained.
6. Generate a separate `ARCHIVE_MONITOR_HEARTBEAT_SECRET` with the same shape,
   distinct from monitor, cleanup and cron secrets. Store it only in Vercel and
   Worker secrets. It authenticates POST to
   `https://naba-lens.vercel.app/api/internal/archive-monitor/heartbeat`; no query
   token or custom heartbeat host is accepted in this mode.
7. Configure Vercel `ARCHIVE_WATCHDOG_RESEND_API_KEY` as a dedicated sending-only
   Resend key limited to its sender domain, and `ARCHIVE_WATCHDOG_EMAIL_FROM` as
   the confirmed sender address. Verify that its production cron bearer is set.
   These keys must not appear in the Worker environment.
8. Bootstrap Worker `naba-lens-archive-checker` and its dedicated KV namespace,
   bind KV as `CHECKER_STATE`, enable Workers logs and schedule `*/5 * * * *`.
   Use compatibility date `2026-10-31` or a reviewed later date. Bind
   `ARCHIVE_ALERT_EMAIL` as `send_email` with
   `destination_address = "amanshresthaaaaa@gmail.com"`. Set `ALERT_EMAIL_FROM`
   to a sender confirmed under an existing routed/onboarded domain. The source
   also fixes the recipient; do not add recipient overrides or broad email keys.
9. Create the account-owned deployment token restricted to **Editor on this
   Worker only** and verify it can update the Worker while lacking archive/R2
   access. Store it through the owner's existing secure credential mechanism.
   The monitor runtime holds no deployment token, cleanup/cron secret, Supabase
   credential, R2 binding or archive-write authority.
10. Deploy the reviewed Worker with the narrow deployment credential, then inspect
    cron invocations, state persistence and authenticated heartbeat receipt.
    Optional `DIGEST_SINK_URL` and legacy HTTPS sinks remain supported but are not
    needed for the selected email setup. Do not enable repository Actions merely
    to add another monitor.

Rotate either narrow application credential on suspicion or on the owner's
rotation schedule. Coordinate Vercel and Worker updates, then verify recovery;
a brief authentication failure during an intentional rotation must not be marked
as successful monitoring.

### Verify end to end

Record dates, deployed revisions, provider message IDs and inbox observations.
Provider API acceptance alone does not prove the owner received an alert.

1. **Primary alert and recovery:** temporarily give the Worker an incorrect,
   well-shaped monitor credential. Observe one `auth_rejected` email in the
   owner's inbox, restore the credential and observe `recovered`. Confirm dedup
   across at least two broken cron invocations.
2. **Delivery failure and replay:** in a controlled maintenance window, use an
   invalid sender or controlled rejected binding configuration. Confirm the
   invocation fails, pending deliveries remain in KV and heartbeat is withheld.
   Restore it and verify the original alert is retried even if health has recovered.
3. **Heartbeat authentication:** confirm POST with the separate credential stores
   database server time. Incorrect credentials, the status token and cron/cleanup
   tokens must fail. Receiver calls must not run or mutate archive audits.
4. **Stopped Worker:** disable its cron for more than 25 minutes plus the next
   watchdog interval. Verify the Vercel watchdog sends a stopped email through
   Resend. Re-enable the cron, verify a fresh recorded heartbeat and recovery email.
5. **Watchdog faults:** exercise email rejection and heartbeat-store failure in an
   isolated environment. Confirm durable retry on email failure, safe errors and
   no fabricated healthy state. Confirm logs redact tokens and provider responses.
6. **Real archive status:** verify the real pinned status route with the narrow
   credential and confirm the current schedule, audit progress and freshness.
   Where practical, record a real archive-condition alert without deleting media
   or weakening the 26-hour threshold.

Until these hosted checks are complete, record the operational status as
**implementation locally tested; provisioning and real delivery unverified**.

## Limits

- Unreachable and probe failures alert on the first failed run; there is no
  consecutive-failure threshold. Raise one only if blips prove noisy.
- One missed alert is not repeated. Prefer a destination with history.
- The checker trusts the status route's data. It detects a stopped or failing
  audit, not corruption the audit itself cannot see.
- Worker source changes take effect only after its separate provider deployment.
  Application deployment alone does not update the Worker.
- Existing-service reuse removes the need for another vendor but does not remove
  the correlated outage and mailbox dependencies described above.
