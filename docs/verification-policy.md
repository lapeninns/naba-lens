# Workstream verification policy

A batch has a finite task list, one coordinator, one delivery branch and one PR.
The coordinator owns integration, broad regression, pushes and formal CI. Worker
agents run focused checks and return evidence; they do not independently run full
matrices. Required QA coverage, Codex review, release checks and live verification
remain separate requirements.

## Normal workflow

```sh
pnpm verify:batch start "Upload-label flow batch" 22 labels recovery review
pnpm verify:change unit tests/unit/example.test.ts
pnpm verify:change lint lib/example.ts
pnpm verify:change types
pnpm verify:change tooling
pnpm verify:change tooling scripts/ci/run-suites.test.mjs
# Browser checks require the project's usual isolated stack/config prerequisites:
pnpm verify:change browser chromium tests/e2e/menus-labels.spec.ts --grep "label filters"
pnpm verify:batch complete labels
pnpm verify:batch complete recovery
pnpm verify:batch complete review
pnpm verify:batch integrate
# Collect blocking review fixes before this point. Rebase on latest main, commit
# the final candidate, obtain review evidence for that head, then freeze it:
pnpm verify:batch freeze "$(git rev-parse HEAD)" /absolute/private/review-evidence.md
# Push the completed batch once; this may also trigger hosted required checks.
pnpm verify:release
pnpm verify:batch close
```

Example paths are illustrative: choose existing tests for the changed behavior.
Focused commands require explicit file paths; they do not silently expand a
missing selection into the whole test suite. They record start source, commands,
duration, result and whether source changed during execution. They never record
environment values. There is no automatic focused-test result reuse: database,
browser and other external state can change independently of git.

`freeze` records the clean exact commit/tree and a coordinator-attested review
reference. It does not manufacture a Codex review or replace the release runner's
review gate. All tasks must be completed and integrated first. A direct call to
lci remains technically possible: AGENTS.md requires the guarded entry point;
this CLI is workflow enforcement, not a security boundary against an agent that
ignores instructions.

`verify:release` checks the pushed PR head, records qualification intent before
calling the real `~/.local/bin/lci run naba-lens --pr N --post --comment --wait`, then
reads back the exact PR's result. No alternate runner, forced run, partial gate,
profile bypass, merge or deployment is performed. A dirty/moved candidate, a changed installed CI profile, missing required local
job statuses, or an unknown result is blocked. A second call against the same frozen candidate is
refused. lci may reuse its existing valid same-tree/profile evidence.

## Blocking findings and follow-up work

```sh
pnpm verify:batch repair pagination "Blocking review: changed filter loses the next page"
# Implement and run focused reproductions; collect related fixes into one pass.
pnpm verify:batch complete pagination
pnpm verify:batch integrate
# Commit/review the changed candidate, freeze, then qualify the new head.
```

A failed gate may legitimately require new qualification after a repair. Record
why; do not label it the same unchanged passing candidate. Enhancements that do
not block the agreed release go into the next batch. Never reopen a candidate
while its gate runs. A machine/process crash leaves qualification unresolved;
inspect the real lci/GitHub outcome, then use `pnpm verify:batch reconcile`.
It refuses a live owner or a pending/unknown gate and never starts CI. Do not blindly
restart an expensive gate.

## Evidence and elapsed time

`pnpm verify:batch status` prints the current phase, source fingerprint and ledger
path. Private state lives under the repository's shared git directory, keyed by
delivery branch. It is shared across worktrees of that branch and stays out of
commits. Events preserve earlier attempts and repair reasons. Session timers,
command wall time, overlapping worker time and productive model time are distinct
metrics. Prefer a completion receipt over repeated model-driven polling.

## CI common checks and browser lanes

`scripts/ci/local-ci.sh` defaults to `CI_PHASE=full` for compatibility. Full mode
still runs every original check, plus verification-tooling regression tests.

The formal split uses:

- `common`: install, typecheck, lint, unit, monitoring, archive and verification
  policy/contract tests. Publish a receipt only after every check passes.
- `database`: verify common evidence, install, prepare/start/reset its own stack,
  build against that stack, scan the bundle, run every integration/lifecycle/
  security assertion and stop the stack. Only then publish database evidence.
- `browser`: verify common and (when configured) database evidence before setup,
  install dependencies, prepare/start/reset an isolated stack, build once against
  its actual URL, scan that very build, run the selected browser cases with the
  successful same-stack build, run privacy runtime checks, and clean up.
  Without `CI_DATABASE_RECEIPT`, browser lanes still run all database suites.
  `full` always runs every common, database and browser boundary independently.

A receipt includes the source tree, dependency lock digest, Node/pnpm versions,
CI run identity and relevant environment digest. A dirty checkout, another run,
changed toolchain/lock/source or incomplete check list fails before stack startup.
Changing the local lci profile invalidates its prior proof-cache fingerprint.

Hosted CI requires common, database and all four existing browser/shard lanes.
The source-selected local profile retains common, both Chromium shards, Firefox,
WebKit and the smoke contract, and adds a required database tier without removing
any of those jobs. The release CLI now requires its explicit success status too.
Older source trees retain their old full-per-browser profile; the steward owns
the source-selected variant and its installation. Nothing substitutes a common
pass for database/security, browser or privacy coverage. `local-matrix.sh` remains a complete
standalone full matrix; agents should not use it as an iteration loop.

Database receipts use the same source/lock/toolchain/run/environment contract,
with a distinct mandatory check list (build, bundle scan, integration, lifecycle,
security, cleanup). A failed database step stops its expensive remaining suites;
their timing records explicitly say `NOT RUN`, never pass.
Common proof cannot satisfy database proof. A missing, failed, stale or partial
receipt fails before any browser stack starts. No database contents or signed-in
sessions are reused between lanes. Cross-stack build reuse is forbidden because
Next inlines each stack's public URL/key. Privacy runtime independently checks
the build's target. Retries remain zero and browser workers remain one: several
specs alter shared organisation-wide fixture state, so a worker increase without
per-worker database isolation is not safe.

The unit project is bounded to four workers rather than exhausting every core
on the shared runner. No test deadline or assertion is relaxed. `timings.tsv`
records each shell step (including cleanup), and `suite-results.json` records
each actual sub-suite's exit and elapsed milliseconds. They contain no environment
values. The focused lane now accepts explicit tooling files; its default still
runs the whole verification tooling selection. Serialise focused invocations on
one branch: their ledger deliberately has a single-writer lock.

## Pending owner approval: PR browser tier

**Proposal only, NOT applied.** Chromium desktop and phone-width projects would
run on ordinary PR iterations; Firefox, desktop WebKit and phone-width WebKit
would run on the frozen release candidate and nightly. All database/security,
privacy, bundle and smoke checks would remain required. The frozen candidate
must pass the full engine matrix before merge/release; an ordinary Chromium PR
pass would not qualify a release.

The measured 2026-11-19 run `6c8c2f5e-20261119T050833` spent 1,230.693 s in
Firefox and 1,239.256 s in WebKit, **41.17 runner-min total**. That is an upper
bound before database deduplication, not an additional saving: most of those
jobs were repeated database tests. The engines themselves took 56.8 s and about
66 s respectively; their build, stack and privacy overhead must be measured
after deduplication before quoting the remaining PR saving. Hosted lanes run
concurrently, so runner-min saved is not the same as PR wall-time saved.

Risk: engine-specific rendering, streamed React/hydration, image loading and
phone-width WebKit regressions would be detected later. Mitigation: the exact
frozen head still passes all five projects, nightly runs alert on failures,
and no promotion uses stale engine evidence. Owner decision and separate
workflow/profile changes are required. Rollback: restore the full engine
requirement on every PR. This batch leaves it in force.

## Applicability of e2e

Load the qa-with-e2e skill for QA. For app behavior changes, run the e2e runner
alongside required project browser checks using the intended isolated target.
Policy/receipt/CLI orchestration has no user-facing browser/mobile journey.
Deterministic contract tests exercise the real orchestration with fixture
executables; they do not claim product browser, database or live-provider proof.
