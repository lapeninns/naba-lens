# Technical debt and bug backlog: shared contracts

Status: **agreed** for Workstream 1 (Reproducible Regression and Journey
Evidence) and Workstream 2 (Archive Audit Capacity and Independent Alerting).
Workstream 3 (Catalogue and Media Performance) is deferred and has no contract
here yet.

Base revision: `origin/main` at `c234487` or newer. Changing a contract means
asking the orchestrator first. The orchestrator updates this file and tells
every affected agent. Until then, the version here wins.

## 0. Common ground rules

- **No production access.** No production database, storage, deploys,
  secrets or live alert channels. No hosted Supabase, Vercel, R2 or Keychain
  production entries. Everything runs on a Harness-owned local stack, local
  fixtures, fake object stores and the stub alert sink.
- **One worktree per agent** at
  `../nabalens-techdebt-agents/<agent-name>` on branch `<ws>/<agent-name>`
  (for example `ws1/harness`, `ws2/audit`), created from the contract commit
  on `ws/tech-debt-backlog`. Run `pnpm install --frozen-lockfile` in a new
  worktree before anything else. Never touch `../nabalens` (the main
  checkout) or another agent's worktree.
- **Messaging.** Agents can message only the orchestrator. "Ask the owner"
  means: send the request to the orchestrator, who relays it.
- **Product code.** WS1 agents write journeys, fixtures, runners and
  evidence. They do not change application code (`app/`, `components/`,
  `lib/`). A reproduced defect is recorded as `fail` with evidence and
  reported, not fixed, unless the orchestrator says otherwise.
- **Next.js.** This repo uses Next.js 16.4.2. Read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next.js code.
- **Secrets.** Local stack keys live only in the Harness status files under
  `/tmp/nabalens-ws/`. Never commit them, print them, or put them in the
  shared folder. Never commit Playwright traces or runner session files
  (they hold cookies).

## 1. Local stack ownership

**Owner: Harness.** Harness is the only agent that starts and stops Supabase
stacks or any other Docker service. Nobody else runs `supabase start`,
`supabase stop`, `supabase db reset`, `docker run`, `docker compose` or any
Docker cleanup. Never stop, prune or remove containers that are not listed
below: other projects on this Mac use 543xx, 554xx and 622xx.

### 1.1 Port and stack allocation

| Stack name | Used by                              | Port block | API / DB / Mailpit    | App port | Workdir                        |
| ---------- | ------------------------------------ | ---------- | --------------------- | -------- | ------------------------------ |
| `ws1`      | Harness, Menus, Media, Evidence      | 641xx      | 64121 / 64122 / 64124 | 3641     | `/tmp/nabalens-ws/ws1`         |
| `ws2`      | Audit, Verification, Capacity        | 642xx      | 64221 / 64222 / 64224 | 3642     | `/tmp/nabalens-ws/ws2`         |
| `gate`     | Harness, final-head gate only        | 643xx      | 64321 / 64322 / 64324 | 3643     | `/tmp/nabalens-ws/gate`        |
| spare      | assigned by Harness on request       | 644xx–649xx | `64N21` / `64N22` / `64N24` | `364N` | `/tmp/nabalens-ws/<name>` |

At most three stacks from this workstream run at once. Ports other than API,
DB and Mailpit keep their offsets from `supabase/config.toml` (554xx → 64Nxx).
Studio, Realtime, Analytics and Edge Runtime stay disabled, as in
`scripts/ci/prepare-stack.mjs`.

### 1.2 Harness commands

Harness delivers one command (name and path are Harness's choice, documented
in `docs/qa/harness.md`) with at least these subcommands:

| Subcommand              | Who may run it                          | Effect                                                                       |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `up <name>`             | Harness only                            | Prepare and start the named stack on its block; idempotent                   |
| `down <name>`           | Harness only                            | Stop only that stack (`supabase --workdir <dir> stop --no-backup`)           |
| `reset <name>`          | Harness, or the stack's listed users    | Re-apply migrations and fixtures on that stack only; serialised by a lock    |
| `status <name>`         | anyone                                  | Report running/stopped, revision of migrations applied, ports. No keys       |
| `env <name>`            | anyone                                  | Print shell exports or write an env file for that stack, for local use only  |

`reset` takes an exclusive lock per stack, so two agents cannot reset the same
stack at once. A user that resets a shared stack must tell the orchestrator,
because it wipes other agents' fixture data. When migrations change on a
branch, Harness applies them by resetting that stack from the requesting
worktree's `supabase/` directory, and `status` reports which revision's
migrations are applied.

## 2. Journey result format

Every journey run (deterministic Playwright or agentic runner) writes one JSON
file per journey under `<results-dir>/journeys/<journey-id>.json`, plus
`<results-dir>/summary.json` and `<results-dir>/summary.md`. Default
`<results-dir>` is `.artifacts/journeys/<run-id>/` (gitignored). Harness owns
the schema file and validator.

```jsonc
{
  "schema": "nabalens.journey-result/v1",
  "journey": "menus.activation",          // stable id: <area>.<slug>
  "title": "Admin activates a reviewed draft menu",
  "result": "pass",                        // "pass" | "fail" | "unavailable"
  "reason": null,                          // required string when fail or unavailable
  "revision": {
    "commit": "<full 40-char sha of HEAD>",
    "branch": "ws1/menus",
    "dirty": false                         // true if the tree had uncommitted changes
  },
  "stack": { "name": "ws1", "apiPort": 64121, "migrations": "<sha or latest file>" },
  "runner": { "kind": "playwright", "version": "1.64.1" }, // or "agentic"
  "startedAt": "2026-10-31T10:00:00.000Z",
  "finishedAt": "2026-10-31T10:01:12.000Z",
  "scenarios": ["MENUS-QA-03"],            // acceptance ids (section 2.2)
  "historical": {                          // only for previously reported failures
    "source": "docs/qa/menus-qa-report.md#4-defects-for-the-lead",
    "id": "MENUS-D2",
    "reproducedOnHead": true
  },
  "evidence": [
    { "kind": "log", "path": "logs/menus.activation.log", "description": "runner log" },
    { "kind": "screenshot", "path": "shots/activate-dialog.png", "description": "..." }
  ]
}
```

### 2.1 Result rules

- `pass`: every deterministic assertion ran and held.
- `fail`: an assertion ran and did not hold. `reason` names the assertion.
- `unavailable`: the journey could not run, with `reason` naming the missing
  prerequisite (stack down, browser missing, agentic model credentials
  absent, fixture missing, timeout before the first assertion). It is never
  counted as a pass. A run that selects a journey and gets `unavailable`
  exits nonzero unless the caller passes an explicit "allow unavailable"
  flag, and the summary always lists it.
- Agentic model judgements are recorded as evidence. A journey `pass` must
  rest on at least one deterministic assertion, not on a model judgement
  alone.
- Evidence paths are relative to `<results-dir>`. No traces, cookies, tokens
  or keys in kept evidence.
- A historical failure is treated as resolved only when a journey ran on the
  current HEAD and passed; `historical.reproducedOnHead` records whether the
  original failure still reproduces.

### 2.2 Acceptance ids

Evidence owns the catalogue `docs/qa/acceptance-ids.md`. Until it lands, use:
`MENUS-QA-01`…`MENUS-QA-15` for rows of `docs/qa/menus-qa-report.md` §3,
`MENUS-D1`, `MENUS-D2`, `MENUS-O1`…`MENUS-O5` for its defects and
observations, and `MEDIA-<slug>` for media upload and recovery scenarios
(Media proposes slugs, Evidence confirms them).

## 3. Single owners

| Path or concern                                                                                         | Owner        |
| ------------------------------------------------------------------------------------------------------- | ------------ |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, any new test tooling or dependency             | Harness      |
| `playwright.config.ts`, `playwright.visual.config.ts`, `scripts/ci/*` (except the monitor files), `tests/support/`, stack commands, `docs/ci.md`, `docs/qa/harness.md`, journey schema and validator | Harness |
| `tests/e2e/menus-*.spec.ts`, menus journeys and fixtures under `tests/fixtures/menus/`                  | Menus        |
| `tests/e2e/upload-recovery.spec.ts`, media journeys and fixtures under `tests/fixtures/uploads/`, `tests/fixtures/media/` | Media |
| `docs/qa/acceptance-ids.md`, `docs/qa/evidence/`, the evidence mapping in `docs/acceptance.md`, `docs/qa/menus-qa-report.md` updates | Evidence |
| Any database migration for archive audit state, `lib/server/archive/audit.ts`, `app/api/internal/media-archive/**`, `vercel.json` cron entries, `lib/db/types.ts` regeneration, `docs/media-archive.md` | Audit |
| Capacity model and synthetic-growth harness (`scripts/archive/capacity/`, `docs/archive-capacity.md`) | Capacity     |
| `scripts/ci/monitor-archive.mjs` and its test, the independent checker, the stub alert sink, `docs/archive-monitoring.md` | Monitoring |
| Archive failure-mode suites (`tests/archive/`, plus additions to `tests/unit/media-archive-*.test.ts` coordinated with Audit) | Verification |
| `docs/workstreams/contracts.md`                                                                         | Orchestrator |

Anyone needing a change in a file they don't own asks the owner through the
orchestrator. New npm dependencies, new scripts in `package.json` and lockfile
changes all go through Harness.

## 4. Archive audit state contract

This section is the interface between Audit (writer), Monitoring (reader) and
Verification (tester). Capacity uses the same numbers for its model.

### 4.1 Freshness target

- A **verification cycle** verifies every archive receipt that existed when
  the cycle started, plus backfills ready originals without receipts.
- **Target:** a representative library (defined by Capacity, at least the
  projected size 24 months out) completes a full cycle in **at most 24
  hours** of wall time on the production schedule, leaving 2 hours of margin
  under the existing **26-hour** maximum age (`ARCHIVE_MAX_AGE_MS`).
- The 26-hour threshold is not weakened. If Capacity shows 24 hours cannot be
  met with the planned schedule and budget, it reports to the orchestrator,
  who takes it to the human.

### 4.2 Stored state

Audit adds one migration (Audit is its only author) that extends
`public.media_archive_audit_state` additively. Existing columns keep their
meaning. Names below are binding. Types are binding unless Audit asks for a
change before writing the migration.

| Column                       | Type          | Meaning                                                                                    |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `cursor_id` (existing)       | `bigint`      | Checkpoint: id of the last receipt verified in the current cycle. Committed after each receipt or batch. `0` means no cycle in progress |
| `cycle_id`                   | `uuid null`   | Current cycle. Set when a cycle starts, cleared when it completes                          |
| `cycle_started_at`           | `timestamptz null` | When the current cycle started                                                        |
| `cycle_target_id`            | `bigint null` | Highest receipt id that existed when the cycle started. The cycle is complete when `cursor_id >= cycle_target_id` and missing count is 0 |
| `cycle_checked`              | `bigint not null default 0` | Receipts verified in the current cycle                                       |
| `last_run_at` (existing)     | `timestamptz` | End of the most recent invocation, whatever its outcome                                     |
| `last_run_outcome`           | `text null`   | One of the outcomes in 4.4                                                                  |
| `last_complete_at` (existing)| `timestamptz` | End of the most recent fully verified cycle with zero missing originals                    |
| `last_complete_cycle_started_at` | `timestamptz null` | Start of that cycle (oldest verification it covers)                              |
| `last_cycle_duration_seconds`| `integer null`| Wall time of that cycle                                                                     |
| `last_error` (existing)      | `text null`   | Error code of the most recent failed run, cleared by the next run that does not fail. Allowed: `archive_audit_failed`, `archive_audit_timeout`, `archive_lease_lost`, `archive_checkpoint_failed`, `archive_store_unavailable`, `archive_source_unavailable` |
| `consecutive_failures`       | `integer not null default 0` | Runs ending in `failed` or `timeout` since the last non-failing run          |

A new append-only table `public.media_archive_audit_runs` keeps one row per
invocation, service-role only, with: `id bigint identity`, `run_id uuid`,
`cycle_id uuid null`, `started_at`, `finished_at`, `outcome` (4.4),
`checked`, `copied`, `missing`, `error` (same codes as `last_error`),
`cursor_from`, `cursor_to`. Retention: Audit may prune rows older than 90
days. This table is for operators, Verification and Capacity. The monitor
does not read it.

### 4.3 Lease and schedule

- Lease name stays `media_archive_audit` in `private.maintenance_leases`.
  Each invocation uses a fresh holder uuid.
- The lease TTL must exceed the invocation deadline, and the audit renews the
  lease (by re-acquiring with the same holder) at least once per batch. If a
  renewal returns false, the run stops writing immediately, records
  `lease_lost`, and does not advance the cursor.
- Checkpoints are idempotent: re-verifying a receipt after a crash is safe.
  An interrupted run resumes from `cursor_id` on the next invocation within
  the same `cycle_id`.
- Overlapping invocation: the second one returns outcome `locked` without
  touching cycle state.
- The schedule (Vercel cron in `vercel.json`) and per-invocation budget
  (receipts per batch, deadline) are Audit's to set, based on Capacity's
  numbers. Audit exports them as constants. The status endpoint reports the
  interval (4.5) so the monitor can detect a job that stopped running.
- Production schedule changes in `vercel.json` ship only through the PR. No
  agent deploys.

### 4.4 Run outcomes

`completed_cycle` (this run finished a cycle), `partial` (progress saved,
cycle continues), `locked` (another run holds the lease), `timeout` (deadline
hit; progress up to the last checkpoint kept), `lease_lost`, `failed`
(verification or dependency error). `partial` and `locked` are not failures.
`timeout` and `failed` increment `consecutive_failures`. A `timeout` that
still advanced the cursor is recorded as `timeout`, not `partial`.

### 4.5 Status endpoint (what the monitor reads)

`GET /api/internal/media-archive/status` stays read-only, keeps its existing
authorisation (cleanup bearer or `MEDIA_ARCHIVE_MONITOR_SECRET`), keeps
`Cache-Control: private, no-store`, returns `200` only when `ok` is true and
`503` otherwise. The JSON body keeps every existing field with the same
meaning and adds fields additively:

| Field                       | Type                         | Notes                                                                 |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `ok`                        | boolean                      | existing                                                              |
| `status`                    | `"current" \| "stale" \| "disabled"` | existing                                                      |
| `missing`                   | number                       | existing                                                              |
| `lastCompleteAt`            | ISO string \| null           | existing                                                              |
| `lastRunAt`                 | ISO string \| null           | existing                                                              |
| `failed`                    | boolean                      | existing: `last_error` is set                                         |
| `inProgress`                | boolean                      | existing: a cycle is in progress                                      |
| `lastError`                 | string \| null               | code from 4.2, never a message or provider detail                     |
| `lastRunOutcome`            | string \| null               | from 4.4                                                              |
| `consecutiveFailures`       | number                       |                                                                       |
| `cycleStartedAt`            | ISO string \| null           |                                                                       |
| `cycleProgress`             | `{ checked: number, target: number } \| null` | counts, not ids                                      |
| `lastCycleDurationSeconds`  | number \| null               |                                                                       |
| `maxAgeSeconds`             | number                       | `93600` (26 h)                                                        |
| `scheduleIntervalSeconds`   | number                       | cron interval Audit configured                                        |

No other data (object keys, asset ids, bucket names, owner data) appears in
the body. The body stays under the monitor's 16 KiB limit.

### 4.6 Alert conditions and stub sink

Monitoring owns the checker and sink. The checker raises one alert per
condition, deduplicated by `condition` until it clears:

| Condition            | Trigger                                                                       | Severity |
| -------------------- | ----------------------------------------------------------------------------- | -------- |
| `stale`              | no complete cycle, or `lastCompleteAt` older than `maxAgeSeconds`             | critical |
| `missing_originals`  | `missing > 0`                                                                 | critical |
| `run_failed`         | `failed` true or `consecutiveFailures >= 1`                                   | warning (critical at ≥ 3) |
| `not_running`        | `lastRunAt` older than 3 × `scheduleIntervalSeconds`                          | critical |
| `unreachable`        | timeout, network error, non-JSON, redirect, oversized body, 5xx without a valid body | critical |
| `auth_rejected`      | 401 or 403 (credential revoked or wrong)                                      | critical |
| `monitor_error`      | the checker itself could not run (bad config, missing credential)            | critical |
| `recovered`          | a previously alerted condition cleared                                        | info     |

Alert payload, delivered as JSON to the sink:

```json
{
  "schema": "nabalens.archive-alert/v1",
  "alertId": "<uuid>",
  "condition": "stale",
  "severity": "critical",
  "summary": "Archive verification has not completed for 31 hours",
  "ownerAction": "Check the media-archive cron logs; see docs/archive-monitoring.md#stale",
  "observedAt": "2026-10-31T06:00:00.000Z",
  "target": "local",
  "status": { "...": "the status fields from 4.5, nothing else" }
}
```

Payload rules (agreed with Monitoring):

- `recovered` alerts carry an additional `recoveredCondition` field naming
  the cleared condition, which also appears in `summary`.
- `status` is `null` when there is no valid status body (`unreachable`,
  `auth_rejected`, `monitor_error`).
- A valid body with `status: "disabled"` maps to `stale` (critical): the
  archive must never be disabled in production. A 503 without a valid status
  body (for example `{ "error": "unconfigured" }`) maps to `unreachable`.
- `run_failed` re-alerts once when it escalates from warning to critical at
  3 consecutive failures. Otherwise alerts are deduplicated per condition
  until it clears.

The stub sink is local only: an HTTP listener on `127.0.0.1:3650` (range
3650–3659) that appends each alert to `/tmp/nabalens-ws/alerts/alerts.jsonl`.
If delivery fails (refused, timeout, non-2xx) the checker appends the alert to
`/tmp/nabalens-ws/alerts/undelivered.jsonl` and exits nonzero. Stub mode
accepts only loopback `http` sink URLs. A sink delivery failure is itself reported
(nonzero exit and a fallback local record), never swallowed. Real credentials
and the real alert destination are documented for a human to provision; no
agent creates or uses them.

### 4.7 Local archive store

The archive is disabled on loopback stacks, and real R2 is out of bounds.
Audit, Capacity and Verification use an in-process fake `ArchiveStore` (the
interface in `lib/server/archive/core.ts`) with injectable latency, errors,
corruption and hangs. If a real S3-compatible container (for example MinIO)
is needed, Harness runs it on a spare block port; nobody else starts one.

## 5. Final-head gate

Before each PR, on the final workstream branch head, run once:
`pnpm lint`, `pnpm typecheck`, `pnpm test`, plus every integration, security,
lifecycle, e2e or journey suite the change touches. Harness runs suites that
need a stack on the `gate` stack. The PR description lists each command, its
exit code and test counts, and anything skipped with the reason.
