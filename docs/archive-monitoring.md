# Archive monitoring: independent checker and alerting

This page covers how Naba-Lens finds out, without human attention and without
depending on the app's own cron or the owner's Mac, that the media archive has
stopped being verified. For what the archive and its audit do, see
[media-archive.md](media-archive.md).

> **Real alert delivery is not verified.** Everything below is built and tested
> against local stubs only. No real credential, hosting account or alert
> destination exists yet. Do not treat monitoring as complete until the human
> steps in [Human provisioning checklist](#human-provisioning-checklist) are done
> and the end-to-end test in [Verify end to end](#verify-end-to-end) has reached the
> owner.

## Why this exists

The first monitor (`scripts/ci/monitor-archive.mjs`, run by the
`com.lapeninns.local-ci.smoke` LaunchAgent) checks once a day, reads a Keychain
secret, and only sets an exit code. It cannot find a failure while the Mac is off,
asleep or offline, and nothing tells the owner. It stays as a local extra check;
it is no longer the alerting path.

## Architecture

```text
  Cloudflare Worker (cron, every 5 min)          Owner's alert destination
  scripts/monitoring/cloudflare-worker.mjs  ───▶  (chosen by owner, HTTPS)
        │  GET status, Bearer MEDIA_ARCHIVE_MONITOR_SECRET
        ▼
  https://naba-lens.vercel.app/api/internal/media-archive/status   (read-only)

  Worker KV: dedup state (+ undelivered alerts)    Heartbeat URL (dead man's switch)
```

| Piece | File | Notes |
| --- | --- | --- |
| Portable core | `scripts/monitoring/archive-checker.mjs` | Fetch only, no `node:` imports. Evaluates the conditions, dedups, delivers. Runs in Workers, Node and GitHub Actions. |
| Node CLI | `scripts/monitoring/check-archive.mjs` | File state, JSONL fallback, secret from env or file. Used for local runs and the GitHub Actions secondary. |
| Worker entry | `scripts/monitoring/cloudflare-worker.mjs` | Cron handler with KV state. Not deployed by this repo. |
| Stub sink | `scripts/monitoring/stub-alert-sink.mjs` | Local stand-in for the owner's destination. |
| Legacy monitor | `scripts/ci/monitor-archive.mjs` | Unchanged. Origin pinned, Keychain credential, daily LaunchAgent. |

### Guarantees

- **One credential, one URL.** The only secret is `MEDIA_ARCHIVE_MONITOR_SECRET`.
  It is sent only to `GET /api/internal/media-archive/status` on the pinned origin
  `https://naba-lens.vercel.app`, with redirects refused, a 15 s timeout and a
  16 KiB body limit. The route accepts it for status only; it cannot run the
  archive job, cleanup or remove media.
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
  undelivered alerts, a local fallback record. The alert is retried on the next
  run.

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
- Exit codes of the CLI: `0` healthy, `1` archive unhealthy (alerts delivered or
  already sent), `2` the checker, delivery, state or heartbeat failed.
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
new cycle does not start until 12 hours after the last one. So the oldest
verification covered by the last complete cycle can be up to about 12 hours plus
the cycle duration old. The 26 hour limit on `lastCompleteAt` still holds
unchanged; it is not loosened to allow for this, and `stale` fires when
`lastCompleteAt` is older than 26 hours.

## Hosting options

| | Cloudflare Worker cron (**recommended**) | GitHub Actions schedule (secondary) | External uptime service |
| --- | --- | --- | --- |
| Independent of Vercel and Supabase | Yes | Yes | Yes |
| Independent of the Mac | Yes | Yes | Yes |
| Schedule | 1 min minimum; use 5 min | 5 min minimum, best effort: runs are delayed or dropped under load; scheduled workflows are disabled after 60 days without repository activity | 1–5 min |
| Secret handling | Worker secret, never in the repo | Actions secret, exposed to the runner process | Header value in a vendor UI |
| Dedup and `recovered` | Yes (KV) | Only with a cached state file; a lost cache repeats the alert | Vendor's own logic, no condition logic of ours |
| JSON assertions | Full (our code) | Full (our code) | Limited or paid; custom auth headers vary by plan |
| Alert delivery | Our code posts to the owner's HTTPS destination; a failure fails the invocation | Same, plus GitHub's failed-run email | Vendor's channels, outside our control |
| Dead man's switch | Heartbeat ping after each delivered run | Same | Built in, but covers the vendor only |
| Cost | Free tier covers 288 runs/day and one KV namespace | Free within quota | Free tiers are limited; JSON checks may be paid |

**Recommendation:** the Cloudflare Worker. It has the finest schedule, keeps the
secret out of the repository, runs our own condition logic with dedup, and is
independent of both Vercel and Supabase. Keep a GitHub Actions run as a documented
secondary only if the owner wants two paths. The archive's R2 bucket also lives on
Cloudflare, so use a separate Cloudflare account (preferred) or at least an API
token scoped to this one Worker and KV namespace, so a Cloudflare-wide problem or
credential leak does not take out both the archive and its monitor.

### Dead man's switch

A checker that dies silently is the failure this design must not have. Use an
external heartbeat monitor (for example healthchecks.io or Better Stack Heartbeats,
the owner's choice) with a 15 minute period and a 10 minute grace. The checker
calls the heartbeat URL after every run whose alerts were delivered, including
runs that raised an alert, and not after a delivery failure. If pings stop, the
heartbeat service alerts the owner by its own channel. That channel must differ
from the alert destination, otherwise one outage hides both.

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

It exits 1 while the archive is unhealthy, so the failed run is an extra signal.
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

| Code | Meaning |
| --- | --- |
| `bad_secret` | Secret missing, not 32–256 characters of `A–Z a–z 0–9 _ -`, or two credential sources set |
| `broad_credential` | `CLEANUP_SECRET`, `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` is present where the checker runs: remove it |
| `origin_not_pinned`, `bad_origin`, `bad_mode`, `origin_not_loopback` | Configuration points somewhere other than the pinned production origin (or a loopback origin in explicit local mode) |
| `checker_error` | Unexpected internal error; read the Worker logs |

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

## Human provisioning checklist

Nothing here has been done. An agent must not do any of it.

### 1. The credential

- [ ] **Name:** `MEDIA_ARCHIVE_MONITOR_SECRET`.
- [ ] **Scope:** read-only access to `GET /api/internal/media-archive/status` and
      nothing else. It must be a new random token, 32–256 characters from
      `A–Z a–z 0–9 _ -`, different from `CLEANUP_SECRET` and `CRON_SECRET`.
- [ ] **Where stored:** (a) as a server-only environment value on the Vercel
      production project, as the app already expects; (b) as a Worker secret on the
      checker (`wrangler secret put MEDIA_ARCHIVE_MONITOR_SECRET`); optionally
      (c) as the same Keychain item the legacy monitor uses. Never in the repository,
      shell history, chat, CI logs or the shared folder.
- [ ] **Rotation:** every 90 days and on any suspicion. Generate a new value, set it
      on Vercel and redeploy, update the Worker secret, run the checker once and
      confirm no `auth_rejected`. A short `auth_rejected` between the two steps is
      expected. Revoke by removing the Vercel value: the route then
      answers 401 (`auth_rejected`) while `CLEANUP_SECRET` is set.
- [ ] Confirm the checker holds no other secret: the Worker has no cleanup, cron,
      Supabase or R2 bindings.

### 2. The alert destination (owner's choice)

- [ ] Choose where critical alerts must reach the owner, ideally a channel that
      notifies a phone: email, SMS, a Slack or Discord channel, or a push service.
- [ ] Obtain an **HTTPS** endpoint that accepts a POST. The checker sends the alert
      JSON by default, or `{ "text": "..." }` with `ARCHIVE_ALERT_SINK_FORMAT=slack`
      (Worker binding `ALERT_SINK_FORMAT`), which Slack-style incoming webhooks
      accept. Email and SMS need a relay or automation service in between.
- [ ] Store the URL as the Worker secret `ALERT_SINK_URL` (it usually contains a
      secret path). Do not commit it.
- [ ] Optional: a second, **non-paging** HTTPS destination (a digest or email) for
      `cycle_slow`, stored as the Worker secret `DIGEST_SINK_URL`.
- [ ] Choose a **separate** destination for the heartbeat service's own alerts.

### 3. The hosting account and settings

- [ ] A Cloudflare account separate from the one holding the archive R2 bucket
      (or, at minimum, an API token scoped to this Worker and KV namespace only).
- [ ] Create the Worker from `scripts/monitoring/cloudflare-worker.mjs`, a KV
      namespace bound as `CHECKER_STATE`, and a cron trigger `*/5 * * * *`. A
      minimal `wrangler.toml`:

      name = "naba-lens-archive-checker"
      main = "scripts/monitoring/cloudflare-worker.mjs"
      compatibility_date = "2026-10-01"
      [triggers]
      crons = ["*/5 * * * *"]
      [[kv_namespaces]]
      binding = "CHECKER_STATE"
      id = "<namespace id>"

- [ ] Secrets only: `MEDIA_ARCHIVE_MONITOR_SECRET`, `ALERT_SINK_URL`, optionally
      `DIGEST_SINK_URL`, and `HEARTBEAT_URL` (below). Turn on Workers logs so failed invocations are visible.
- [ ] Heartbeat: create a check with a 15 minute period and 10 minute grace, and
      set its URL as `HEARTBEAT_URL`. Point its alerts at the separate channel.
- [ ] Optional: the GitHub Actions secondary, with matching repository secrets.

### Verify end to end

Do this after provisioning, and again after any change to the destination or the
credential. Record the result with the date; delivery counts as verified only when
a person confirms receipt.

1. **Alert path.** Temporarily set the Worker secret `MEDIA_ARCHIVE_MONITOR_SECRET`
   to a wrong value of valid shape. Within two cron cycles the owner must receive an
   `auth_rejected` alert on the chosen channel, on their phone. Restore the correct
   value and confirm a `recovered` alert arrives and no further alert follows.
2. **Dedup.** While broken, confirm only one alert was received, not one per run.
3. **Delivery failure.** Temporarily set `ALERT_SINK_URL` to an invalid HTTPS URL
   and confirm the Worker shows failed invocations and `undelivered:` keys appear
   in KV. Restore it.
4. **Dead man's switch.** Disable the cron trigger for longer than the heartbeat
   period plus grace and confirm the owner is alerted by the heartbeat service's
   channel. Re-enable it.
5. **Routing.** If a digest destination is set, confirm a `cycle_slow` test alert
   (for example from the local stub with `--digest-sink`) lands there and not on the
   paging channel.
6. **Real condition.** When practical, confirm one genuine `stale` or `not_running`
   alert against the deployed endpoint using the real read-only credential.

Until all six are confirmed by a person, the status of this system is: code and
local stub tests exist; real delivery unverified.

## Limits

- Unreachable and probe failures alert on the first failed run; there is no
  consecutive-failure threshold. Raise one only if blips prove noisy.
- One missed alert is not repeated. Prefer a destination with history.
- The checker trusts the status route's data. It detects a stopped or failing
  audit, not corruption the audit itself cannot see.
- The Worker is not deployed by this repository; changes to
  `scripts/monitoring/` take effect only after a human redeploys it.
