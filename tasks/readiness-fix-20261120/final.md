# Factory readiness re-score — 2026-11-20

Target: `lapeninns/naba-lens` · lci `naba-lens` · branch `task/readiness-fix-20261120`.
See [the baseline](baseline.md) and [owner actions](../../docs/readiness.md).

| Level | Baseline pass / fail / skip | Candidate pass / fail / skip | Candidate applicable pass rate |
| --- | --- | --- | --- |
| 1 | 6 / 1 / 0 | 7 / 0 / 0 | 100.0% |
| 2 | 13 / 12 / 1 | 22 / 3 / 1 | 88.0% |
| 3 | 16 / 11 / 2 | 27 / 0 / 2 | 100.0% |
| 4 | 9 / 9 / 2 | 15 / 3 / 2 | 83.3% |
| 5 | 0 / 2 / 0 | 1 / 1 / 0 | 50.0% |

**Baseline:** 44 pass / 35 fail / 5 skip (55.7% applicable). **Candidate:** 72 pass / 7 fail / 5 skip (91.1% applicable).
This is a criterion-by-criterion assessment, not an lci qualification or a promise of Level 5.
Criteria with operational evidence requirements are not credited for configuration alone.

| Criterion | Baseline | Candidate | Evidence or named blocker |
| --- | --- | --- | --- |
| `large_file_detection` | Fail | Pass | `pnpm quality`: bound ESLint max-lines per existing source file; no new oversized file allowed. |
| `tech_debt_tracking` | Pass | Pass | `docs/acceptance.md`, the TODO/FIXME issue-link ratchet and labelled issues #40–41. |
| `build_cmd_doc` | Pass | Pass | `README.md` retains `pnpm build`. |
| `deps_pinned` | Pass | Pass | Updated `pnpm-lock.yaml` installed with pnpm 10.30.1 and `--frozen-lockfile`. |
| `vcs_cli_tools` | Pass | Pass | Active `lapeninns` CLI account authenticated; authenticated label, issue and PR reads succeeded. |
| `automated_pr_review` | Pass | Pass | Recent review metadata includes automated Codex reviews on PRs #35, #34, #32, #31 and #30. |
| `agentic_development` | Pass | Pass | Agent-attributed history plus `.factory/skills/verify-and-ship/SKILL.md`. |
| `fast_ci_feedback` | Fail | Fail | Fresh 20 merged PR sample: 47.95 minutes mean. PR #39 and subsequent receipts are needed to show a mean below 10 minutes. |
| `build_performance_tracking` | Fail | Fail | Shared gate now logs build duration; the candidate did not produce a formal CI timing receipt or demonstrate a build optimization. Retain and compare build durations on qualified heads. |
| `deployment_frequency` | Fail | Fail | No GitHub release/workflow/deployment records in the audit sample. One documented shipping batch does not establish sustained cadence; owner must verify provider history. |
| `single_command_setup` | Pass | Pass | `README.md` and `docs/setup.md` retain frozen install and fixture development path. |
| `feature_flag_infrastructure` | Pass | Pass | `lib/auth/captcha.ts`, `lib/album/mock-photos.ts`, `lib/config/album-upload-tray.ts` and the checked registry. |
| `release_notes_automation` | Fail | Pass | `pnpm release:notes HEAD~1` generated Markdown for the first-parent range without a release/deploy. |
| `progressive_rollout` | Skip | Skip | Application repo, not infrastructure. |
| `rollback_automation` | Skip | Skip | Application repo, not infrastructure. |
| `monorepo_tooling` | Skip | Skip | Single app package; `pnpm-workspace.yaml` has `packages: []`. |
| `version_drift_detection` | Skip | Skip | One build package. |
| `release_automation` | Pass | Pass | `docs/release/2026-11-19-five-tab-staff-app.md` records automatic Vercel production deploy on merge. |
| `dead_feature_flag_detection` | Fail | Pass | `pnpm docs:check` checked all three definitions and source references; lifecycle in `docs/readiness.md`. |
| `agents_md` | Pass | Pass | `AGENTS.md` remains at the root and documents focused checks and new hook/naming conventions. |
| `readme` | Pass | Pass | `README.md` retains setup and usage and links the readiness gates. |
| `automated_doc_generation` | Fail | Pass | `pnpm docs:api --write` generated the checked-in reader contract; `pnpm docs:api` reverified it byte-for-byte. |
| `skills` | Fail | Pass | `.factory/skills/verify-and-ship/SKILL.md` documents the repository's real branch and qualification workflow. |
| `documentation_freshness` | Pass | Pass | `60e6db443` touched root documentation on 2026-11-19; this candidate also updates it. |
| `service_flow_documented` | Pass | Pass | `docs/architecture.md` remains the service flow reference; `docs/readiness.md` describes monitoring paths. |
| `agents_md_validation` | Fail | Pass | `pnpm docs:check` validates referenced local files and package scripts; required by pre-push and CI. |
| `devcontainer` | Fail | Pass | `.devcontainer/devcontainer.json` supplies a Node 24 TypeScript environment and frozen package install. |
| `env_template` | Pass | Pass | Filename-only tracked check returned allowed `.env.example`; no sensitive env file was opened. |
| `local_services_setup` | Pass | Pass | Live Supabase was retained. `supabase/config.toml` and `docs/setup.md` describe isolated Postgres/Auth/Storage/Mailpit. |
| `devcontainer_runnable` | Skip | Skip | `command -v devcontainer` did not find the CLI. |
| `runbooks_documented` | Pass | Pass | `README.md`, `docs/operations.md`, `docs/readiness.md` and `docs/archive-monitoring.md`. |
| `branch_protection` | Fail | Fail | Admin API shows no ruleset and unprotected `main`; exact owner-only rule is in `docs/readiness.md`. |
| `secret_scanning` | Fail | Pass | `pnpm scan:secrets` exited 0, with nine path/rule/content-pinned non-credential findings and no unapproved hits. |
| `codeowners` | Fail | Pass | `.github/CODEOWNERS` assigns `@lapeninns`; GitHub collaborator API confirms admin write permission. |
| `automated_security_review` | Pass | Pass | Existing fixture-run security suite and readable reports remain required (`scripts/ci/run-suites.mjs`). |
| `dependency_update_automation` | Fail | Fail | `.github/dependabot.yml` is prepared, but no Dependabot PR exists yet. Recheck after config lands on default branch and the first update cycle runs. |
| `gitignore_comprehensive` | Fail | Pass | `git check-ignore --no-index` confirms `.env.local`, `.dev.vars`, `.idea` and `.vscode` ignored, template allowed. |
| `privacy_compliance` | Pass | Pass | Existing retention, privacy procedures and runtime gate remain; the new browser diagnostics bridge defaults to off. |
| `secrets_management` | Pass | Pass | Tracked template and private variable separation retained. No Sentry or other secret was set. |
| `min_release_age` | Pass | Pass | Actual `pnpm` rejected a three-hour-old Knip release; 1,440 minutes remains enforced and documented. |
| `issue_templates` | Fail | Pass | GitHub bug and request forms include steps/acceptance criteria and fixture-data guidance. |
| `issue_labeling_system` | Fail | Pass | Live GitHub labels include P0–P3, bug/feature/chore and the three area labels. |
| `backlog_health` | Fail | Pass | Two of two open issues are descriptive, labelled and recent: #40 admin MFA fixtures; #41 retired staff component cleanup. |
| `pr_templates` | Fail | Pass | `.github/pull_request_template.md` includes description, testing, context and disposition. |
| `lint_config` | Pass | Pass | Existing ESLint gate retained and run. |
| `type_check` | Pass | Pass | `pnpm typecheck` passed with existing strict configuration. |
| `formatter` | Pass | Pass | Prettier is now checked by `pnpm quality`; 10 existing noncompliant files are tracked by filename. |
| `pre_commit_hooks` | Fail | Pass | `pnpm hooks:install` points Git to executable `.githooks/pre-push`, which runs quality/docs/secret checks. |
| `strict_typing` | Pass | Pass | Baseline and candidate strict typechecks passed with zero diagnostics; no suppressions or exclusions added. |
| `naming_consistency` | Fail | Pass | `pnpm quality` enforces kebab-case source filenames; AGENTS documents the convention. |
| `cyclomatic_complexity` | Fail | Pass | `pnpm quality` runs ESLint complexity threshold 18 and records per-file existing counts. |
| `dead_code_detection` | Fail | Pass | `pnpm quality` runs Knip across routes, scripts and tests; findings are counted by file/symbol. |
| `duplicate_code_detection` | Fail | Pass | `pnpm quality` runs jscpd and rejects any increase in duplicate line count or rate. |
| `code_modularization` | Fail | Pass | Source AST gate checks shared lib → route/UI and client → privileged imports and tracks eight existing exceptions. |
| `n_plus_one_detection` | Pass | Pass | Kept `tests/security/metrics-overview-plan.test.ts` with Postgres function call-count assertions; archive tests also verify no repeated missing-count RPC. |
| `heavy_dependency_detection` | Fail | Pass | `pnpm analyze:bundle` reported 225 client JS/CSS chunks after a passing build (6,828.2 KiB total; largest 548.6 KiB). Wired after the production build in CI. |
| `unused_dependencies_detection` | Fail | Pass | Knip findings are enforced by file, kind and dependency name. |
| `unit_tests_exist` | Pass | Pass | Original unit test roots retained; `tests/unit/readiness-logger.test.ts` added. |
| `integration_tests_exist` | Pass | Pass | `tests/integration/`, `playwright.config.ts` and existing CI lanes retained. |
| `unit_tests_runnable` | Pass | Pass | Bounded runner-native Vitest collection succeeds without executing tests. |
| `test_performance_tracking` | Pass | Pass | Vitest/Playwright timing and suite records retained; common gate now logs step times as well. |
| `flaky_test_detection` | Pass | Pass | `docs/acceptance.md` and `pnpm journeys` retain named flaky test tracking/rerun design. |
| `test_coverage_thresholds` | Fail | Pass | `pnpm test:coverage` passed with 93.75% statements, 96.66% branches, 85.71% functions and 93.02% lines on the logging boundary. |
| `test_naming_conventions` | Pass | Pass | Vitest explicit `.test.*` includes and Playwright `.spec.ts` convention retained. |
| `test_isolation` | Pass | Pass | Vitest unit isolation and per-lane fixture stack preparation retained. |
| `interactive_qa_exists` | Pass | Pass | Documented `docs/setup.md` fixture Mailpit sign-in and `tests/e2e/auth.spec.ts` interactive journey. |
| `interactive_qa_runnable` | Pass | Pass | Complete documented fixture path under rubric fallback; no fresh authenticated browser qualification claimed in this report. |
| `api_schema_docs` | Fail | Pass | `docs/knowledge/openapi.json` covers the versioned reader; `pnpm docs:api` checks its routes, methods, parameters and constants. |
| `database_schema` | Pass | Pass | Live Supabase retained; authoritative SQL under `supabase/migrations/` and generated types retained. |
| `structured_logging` | Fail | Pass | `lib/server/log/logger.ts` writes scrubbed structured JSON for server calls; focused tests passed. |
| `distributed_tracing` | Fail | Pass | `proxy.ts` issues correlation IDs; the server and reader propagate them, and the Supabase fetch adapter is unit-tested. |
| `metrics_collection` | Pass | Pass | Existing application event and archive metrics pipelines retained. |
| `code_quality_metrics` | Fail | Pass | `pnpm quality` and `pnpm test:coverage` report and enforce complexity and coverage measurements. |
| `error_tracking_contextualized` | Fail | Fail | Server hooks, stack frames, breadcrumbs, code-only context and private source-map configuration are present; no provider credentials, actual consent source or symbolication proof in this run. |
| `alerting_configured` | Pass | Pass | Existing nightly `lci smoke --all --notify` is documented; `pnpm smoke:issue` files or updates a fixed labelled issue on an explicit failed result. Existing archive alerts remain. |
| `deployment_observability` | Pass | Pass | Existing Vercel function log guidance plus new request correlation and verification docs. |
| `health_checks` | Pass | Pass | Existing archive health/status route and scripted availability probes retained; no routes changed. |
| `circuit_breakers` | Pass | Pass | Existing Supabase Storage retry/fallback controls retained. |
| `profiling_instrumentation` | Fail | Pass | Sentry Node profiling integration configured at 5%; native module import verified. No production activation was attempted. |
| `dast_scanning` | Pass | Pass | Existing live fixture response security suite retained; passive loopback ZAP is additionally wired to CI. No ZAP execution claimed until the image and Docker networking are verified. |
| `pii_handling` | Pass | Pass | Existing controls retained; explicit Sentry 11 data-collection denial and typed opt-in policy added. |
| `log_scrubbing` | Pass | Pass | `pnpm test:coverage` asserts no email, phone, credential or cookie material is emitted in structured logs. |
| `product_analytics_instrumentation` | Pass | Pass | First-party product events and operational rollups unchanged. |
| `error_to_insight_pipeline` | Fail | Fail | The owner must install and configure the Sentry GitHub issue integration. No integration or secrets were set. |

## Pre-push verification

- The first build exited with the Next.js 16.4.2 security advisory. The
  owner approved updating to 16.4.6. pnpm 10.30.1 resolved the matching
  lockfile, the frozen install passed, and the patched production build
  and existing client bundle scan passed without bypassing the advisory.
- Existing checks: strict typecheck passed on the candidate; lint exited
  zero with one warning on generated coverage output; focused auth/proxy
  checks 54/54; archive 174/174; monitoring 97/97;
  verification tooling 22/22. The archive cadence simulation now uses one
  event-loop turn to flush microtasks, retaining the ten simulated days,
  all assertions and the original 10-second timeout.
- New gates: quality passed without increasing any per-file size budget
  (aggregate 72,833 versus the original 72,853), docs/flags and both OpenAPI
  routes verified, and the tracked-source secret scan reported zero
  unapproved findings. The new redaction/correlation suite passed all 5 tests
  and its coverage floor.
- The full unit regression passed all 5,331 tests across 436 files. The
  nine previously failing paths also passed in the 222-test focused run:
  logging emits synchronously outside requests and retains safe diagnostics; Sentry
  uses request context rather than tagging; the slow UI case loads its
  component at collection instead of during the timed test. No test
  assertion, budget, coverage threshold or timeout was relaxed. The dish
  guide test now waits for the dialog to receive focus before sending keys.
- This pre-push evidence does not attest to formal qualification, a full
  fixture-browser matrix, or live production. Read those results on the
  delivered PR's exact head and merge commit.
- The initial hosted common gate failed when Knip loaded Playwright's
  config without Supabase. Static analysis now receives non-credential
  loopback placeholders in the Knip subprocess alone; it still evaluates
  the real config, and browser tests still need their real fixture stack.
  A built-app smoke with a loopback provider also verified that an internal
  cron failure retains the safe SQLSTATE and has the same request ID in its
  response, server log, and provider call, without exposing fixture data.
- No database migration, GitHub setting change, or edit to
  `platform/local-ci` is part of this candidate.
- The owner authorized only new, isolated, disposable fixture resets. Existing, shared and hosted stacks remain off-limits.
- Hosted CODEOWNERS API verification requires the candidate branch to be on GitHub; admin eligibility was verified independently.
