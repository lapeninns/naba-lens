<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Workstream delivery and verification

- Begin with a finite batch of task IDs and acceptance criteria. Preserve the
  agreed delivery branch and one bundled PR. New improvements discovered after
  the batch is complete belong to the next batch unless release-blocking.
- Only the coordinator starts broad regression, a full browser matrix, formal
  CI, a push or a release. Worker agents own scoped implementation and focused
  checks; return evidence and blocking findings to the coordinator.
- Stages: implementation -> integration/review -> frozen candidate -> formal
  qualification -> release/live verification. Collect review findings into one
  repair pass before freezing. Do not modify, push or expand the frozen candidate
  while CI runs. A running check may finish; do not restart it through polling.
- Iterate with `pnpm verify:change` and explicit test/spec files. Use
  `pnpm verify:batch` to record tasks, source fingerprints, checks and review
  evidence. Full suites need a stated coverage reason, not a timer or every edit.
- Run the actual `~/.local/bin/lci` once on the final head after rebasing on the
  latest default branch. Use `pnpm verify:release` as the normal entry point.
  Do not call lci directly to evade a batch hold or duplicate an in-flight gate.
  Never use `--force`, `--only`, `--no-codex`, an admin merge, or a profile change
  that omits required checks. Same-tree passing proof may be reused by lci.
- A genuine blocking failure may require a repair and new qualification. Record
  the finding, collect related fixes, run focused reproductions, re-review the
  changed head, then qualify it. An older head's pass does not qualify new code.
- Poll long-running checks only when new information is expected. Prefer durable
  completion receipts and a single summary over repeated model-driven wait loops.
- For applicable browser/mobile QA, load the qa-with-e2e skill and use the e2e
  runner alongside required project checks. CLI-only policy/receipt tests have
  no browser journey. Separate local checks, CI, deployment and live proof.
- Operation: see `docs/verification-policy.md`. The ledger is workflow evidence,
  not a security boundary or permission to bypass required release checks.

## Parallel local runs

The dev Mac has 18 cores and Docker has all of them, while a single Postgres
query uses one. Serial runs on one stack leave most of the machine idle.

- Repeat runs (for example a suite run three times): reset one stack per run to
  the same clean head and run them at once. Every run is then a first run on a
  fresh database. Repeats on one stack get slower as rows build up (B05: 332,
  451, then 590 s).
- Independent suites (security, lifecycle, migrations lint, unit) can run at
  once on different stacks.
- Long compare or bench passes (`tests/perf/*`): split them into `--slice` runs
  across stacks (`PERF_STACK`, `/tmp/nabalens-ws/<stack>/env.sh`), about 12 to
  16 at once. Load another stack only when the pass is longer than loading its
  world takes. Short passes can share one stack.
- Keep the load average under about 16 so the desktop stays usable. Follow
  each stack's lock and local-Docker guard. Keep each command in the
  foreground and under about 8 minutes.
- If one run fails with a socket or `fetch failed` error, rerun only that run on
  a freshly reset stack, not the whole set.
- Review and repair loops: after two repair rounds, stop and report to the owner
  before starting another.
