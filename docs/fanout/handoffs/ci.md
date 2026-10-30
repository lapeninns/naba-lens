# CI track continuity

Goal: reproducible fixture-only GitHub and local CI.

Done: workflow matrix and protected staging blueprint (0497247); CI-owned local
stack preparation, suite runner and cross-browser Playwright wrapper implemented.
No shared harness or Supabase source config modified. No remote, push or lci.

In progress: pinned local end-to-end gate, logs /tmp/nabalens-ci-pinned.log;
stack workdir recorded in final command output. Initial pnpm 11 attempt failed
because esbuild approval is missing; pnpm 10.30.1 frozen install passes.
Typecheck and lint passed so far. Unit/build/database/browser results pending.

Run: pnpm 10.30.1 on PATH; bash scripts/ci/local-ci.sh. Requires Docker,
Supabase CLI 2.117.0 and pnpm exec playwright install chromium (or CI_BROWSER).
Temporary stack has unique project ID and probed port block, optional services
are disabled; EXIT trap stops only owned stack with --no-backup.

Next: finish execution, record exact outcome and commit final evidence.
Open questions: staging does not exist; protected manual job is documented only.
Agentic e2e runner is not installed on PATH; no agentic execution claimed.

## Executed evidence

Pinned command: `CI=true PATH=/tmp/nabalens-pnpm10:$PATH bash scripts/ci/local-ci.sh`
(wrapper executes `npx --yes pnpm@10.30.1`). Completed full sequence, exit 1.
Logs: `/tmp/nabalens-ci-verified.log` and
`/var/folders/t4/b7qzq59j6y95v59m5_32snvw0000gn/T/nabalens-ci.VRQzXs/logs`.

- frozen install PASS; lint PASS; unit 12 files / 102 tests PASS.
- Integration 7 files / 84 tests PASS; lifecycle 17 PASS; security 114 PASS.
- Chromium desktop + phone viewport: 12 PASS, 6 FAIL, 3.3 minutes; no retries.
  Four desktop failures: invalid-link recovery, deactivation, vertical slice,
  profile editing. Two phone failures: staff magic-link login and admin login.
  Captured fixture auth timeout errors; do not infer assertion-level product bugs.
  Phone upload/original-byte download/isolation and profile editing did pass.
- Owned stack stop PASS, no other containers stopped.
- Earlier complete static run typecheck/build PASS. Final full run captured
  typecheck/build FAIL from intermediate wrapper type definition; corrected
  wrapper's follow-up `pnpm typecheck` exit 0. Follow-up build recorded separately.
- `actionlint` and offline `zizmor`: PASS (workflow agent); `git diff --check` PASS.
- Firefox/WebKit NOT_RUN locally; configured hosted lanes. Hosted CI NOT_RUN,
  no remote. Physical phones NOT_RUN. Agentic e2e NOT_RUN: no e2e CLI on PATH;
  no provider credentials introduced for this fixture-only CI track.

Traces and error contexts: checkout `test-results/` (ignored). Next wave should
investigate fixture auth timeouts under parallel Mac load and run all matrix
lanes on dedicated Linux runners. No auth/RLS/assertion changes were made.

Final corrected wrapper: `CI=true /tmp/nabalens-pnpm10/pnpm build` exit 0;
log `/tmp/nabalens-ci-final-build.log`. Final typecheck exit 0 as above.

## Post-orchestrator merge run

Merged `feat/nabalens-mvp` at merge commit `2f389c4` including esbuild policy fix.
`CI=true pnpm install --frozen-lockfile`: exit 0, pnpm 11.17.0.
Fresh pinned gate running: `/tmp/nabalens-ci-after-merge.log`, workdir
`/var/folders/t4/b7qzq59j6y95v59m5_32snvw0000gn/T/nabalens-ci.qKkxtJ`.
Install/typecheck/lint/unit (102)/build passed. Isolated startup passed; reset
is waiting at container restart under slow Docker response. Suites pending.
