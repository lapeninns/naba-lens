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
calling the real `~/.local/bin/lci run naba-lens --pr N --post --comment`, then
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
- `browser`: verify that receipt, install dependencies, build, scan the bundle,
  prepare/start/reset an isolated Supabase stack, run integration/lifecycle/
  security and the selected browser cases, run privacy runtime checks, and clean
  up. Build and mutable databases remain isolated per lane.

A receipt includes the source tree, dependency lock digest, Node/pnpm versions,
CI run identity and relevant environment digest. A dirty checkout, another run,
changed toolchain/lock/source or incomplete check list fails before stack startup.
Changing the local lci profile invalidates its prior proof-cache fingerprint.

Hosted CI requires the common job and all four existing browser/shard lanes.
The local profile requires the common job and all three existing browser lanes,
plus the existing smoke contract. Nothing substitutes a common pass for browser,
database/security or privacy coverage. `local-matrix.sh` remains a complete
standalone full matrix; agents should not use it as an iteration loop.

## Applicability of e2e

Load the qa-with-e2e skill for QA. For app behavior changes, run the e2e runner
alongside required project browser checks using the intended isolated target.
Policy/receipt/CLI orchestration has no user-facing browser/mobile journey.
Deterministic contract tests exercise the real orchestration with fixture
executables; they do not claim product browser, database or live-provider proof.
