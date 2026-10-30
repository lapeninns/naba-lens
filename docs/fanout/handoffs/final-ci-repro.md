# Final candidate CI reproduction

Goal: independently reproduce `docs/ci.md` at candidate `5d28d640b7e15443538f95e31c953f2ae4f3816a`, without changing code.

Completed 2026-10-30, approximately 02:23–02:35 UTC, in `/Users/amankumarshrestha/.t3/worktrees/nabalens/review-nl-final-ci`, branch `review/nl-final-ci`. Candidate checkout was clean. Only this report was committed; the intermediate continuity commit changed documentation only. No remote CI, deployment or other stack was touched.

## Invocation and environment

Node 24.16.0 and Supabase CLI 2.117.0 matched documentation. Default pnpm was 11.17.0. Initial `bash scripts/ci/local-ci.sh` exited 1 with `Requires pnpm 10.30.1` at `scripts/ci/local-ci.sh:11`, before stack creation. Its start/end uptime load averages were both `7.04 / 5.03 / 4.72` (uptime 4 days 16:38, 3 users).

A temporary executable outside the repository selected `corepack pnpm@10.30.1`; then ran:

```sh
PATH="/tmp/nl-final-ci-tools:$PATH" bash scripts/ci/local-ci.sh
```

The unchanged gate executed all stages and returned **1**. The install stage itself ran the documented frozen installation. Browser binaries were available and Chromium launched successfully; no separate browser-install command was run. Default Chromium lane only; Firefox/WebKit NOT RUN.

## Stage results

`WORK` below is `/var/folders/t4/b7qzq59j6y95v59m5_32snvw0000gn/T/nabalens-ci.mGq8si`.
Exit 0/1 for top-level stages follows the gate PASS/FAIL result (its wrapper does not retain arbitrary nonzero codes); suite codes 0/1 follow their runners. Counts are tests, except where specified. Non-test stages have N/A counts.

| Stage | Command | Exit | Passed / failed / skipped |
|---|---|---:|---|
| install | `pnpm install --frozen-lockfile` | 0 | N/A |
| typecheck | `pnpm typecheck` | 0 | N/A |
| lint | `pnpm lint` | 0 | N/A |
| unit | `pnpm test` | 0 | 153 / 0 / 0; 21 files passed |
| build | `pnpm build` | 0 | N/A |
| scan-bundle | `node scripts/ci/scan-bundle.mjs` | 0 | 0 findings; 57 files, 8 rules |
| prepare | `node scripts/ci/prepare-stack.mjs WORK` | 0 | N/A |
| start | `supabase --workdir WORK start` | 0 | N/A |
| reset | `supabase --workdir WORK db reset` | 0 | N/A |
| status | `supabase --workdir WORK status -o json` | 0 | N/A; reached subsequent stage |
| database-and-browser | `node scripts/ci/run-suites.mjs WORK` | 1 | Detail below |
| integration | `pnpm test:integration` | 1 | 190 / 13 / 11; files 15 passed, 4 failed, 1 skipped |
| lifecycle | `pnpm test:lifecycle WORK` | 0 | 23 / 0 / 0; 2 files passed |
| security | `pnpm test:security WORK` | 0 | 153 / 0 / 0; 3 files passed |
| browser | `pnpm exec playwright test --config scripts/ci/playwright.config.ts` | 1 | 57 / 1 / 16; 74 total, 9.5 minutes |
| privacy-runtime | `node scripts/ci/privacy-runtime.mjs WORK` | 1 | 0 / 0 / 11; 1 failed suite during setup |
| stop | `supabase --workdir WORK stop --no-backup` | 0 | N/A |

## First failures

- Integration first reported assertion: `tests/integration/auth-bootstrap.test.ts:134:39`, `expect(authUserCount(user.email)).toBe(1)`, expected 1, received 0. Earlier stderr also reports invalid refresh tokens; that diagnostic has no application file:line. Another integration failure is `Command failed: supabase status -o json` at `tests/integration/auth-support.ts:236:15`. No root cause is claimed.
- Browser: `tests/e2e/responsive.spec.ts:145` (test declared at line 165), `admin-row-actions-menu@360: axe serious/critical`; expected no violations, received `aria-hidden-focus`. Responsive 390/768/1280 checks passed. Desktop and mobile core journeys passed. One worker, zero retries; no additional reruns.
- Privacy-runtime setup: `tests/integration/privacy-runtime.test.ts:171:22`, expected auth confirmation status 303, received 200; called from line 217. Eleven skipped tests do not constitute a passing privacy check.

## Load evidence and execution limits

**Per-stage start/end uptime was not captured. This requested evidence is unavailable for every stage; these observations must not be substituted for it.** The unchanged script redirects stage output and does not record load. The successful-version invocation began shortly after 02:22; nearby 02:23 observation: uptime 4 days 16:39, 3 users, load `7.02 / 5.22 / 4.80`. Final actual uptime at script completion: 02:35, up 4 days 16:51, 3 users, load `7.98 / 7.35 / 6.18`. Other observations: 02:24 `6.34 / 5.37 / 4.88`; 02:25 `4.84 / 5.11 / 4.82`; 02:26 `8.73 / 5.97 / 5.15`; 02:30 `11.77 / 7.18 / 5.74`; 02:35 `8.69 / 7.43 / 6.18`.

The invocation exceeded eight minutes and was allowed to finish in the foreground; it was **not split into individual stage commands**, contrary to the requested fallback. Both browser expiry tests intentionally took 2.1 minutes. No background job remains. This report is therefore a completed failing gate reproduction with incomplete requested load instrumentation.

QA-with-e2e and e2e skills were read. Agentic e2e was unavailable in this checkout: `corepack pnpm@10.30.1 exec e2e --version` reported `Command "e2e" not found`; no project e2e config exists. An initial probe with default pnpm also aborted its automatic install with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No agentic journey is claimed. Playwright viewport coverage does not certify physical devices.

## Evidence, cleanup and continuity

Local stage logs: `WORK/logs/`; gate console `/tmp/nl-final-ci-run.log`. Browser failure artifacts: `test-results/responsive-screens-and-dialogs-at-360px-chromium/` (trace, screenshots, error context). These are local evidence only, not committed. Startup/status logs contain fixture credentials; do not publish them.

Owned project ID: `nabalens-ci-mgq8si`. Temporary config confirmed Studio, Realtime, Analytics and Edge Runtime disabled. Gate cleanup returned 0 and reported that exact project stopped. Independent `docker ps --format '{{.Names}}'` inspection found no matching CI containers after completion. Other stacks were not stopped.

Done: complete gate, count/error inspection, independent unit-log review, owned-stack shutdown, report. In progress: none. Next exact step: review failures and, if separately authorised, fix in another change; instrument stage boundaries before any future reproduction. No application changes are authorised by this task. Open question: whether a subsequent fully instrumented reproduction is desired. To reproduce later, use documented pinned tools and `bash scripts/ci/local-ci.sh`; it creates its own new stack. Never restart or reset other stacks.
