# Factory readiness baseline — 2026-11-20

Target: `lapeninns/naba-lens` · lci `naba-lens` · `origin/main` at `f75dbfa6bb7eb1ebdbc0e60f7afc8dd3fb0b5062`. Scored against all 84 criteria in the owner-provided 20 November rubric, before any readiness changes.

**44 pass, 35 fail, 5 legitimately skipped** (55.7% of applicable criteria; Factory Level 2 unlocked by the Level 1 result).

| Level | Pass | Fail | Skip | Applicable pass rate |
| --- | ---: | ---: | ---: | ---: |
| 1 | 6 | 1 | 0 | 85.7% |
| 2 | 13 | 12 | 1 | 52.0% |
| 3 | 16 | 11 | 2 | 59.3% |
| 4 | 9 | 9 | 2 | 50.0% |
| 5 | 0 | 2 | 0 | 0.0% |

| Criterion | Level | Baseline | Evidence |
| --- | ---: | --- | --- |
| `large_file_detection` | 3 | Fail | `eslint.config.mjs` and the common gate have no size/line check; no LFS rule is tracked. |
| `tech_debt_tracking` | 3 | Pass | `docs/acceptance.md` assigns GAP IDs, priority and evidence for outstanding coverage and operational debt. |
| `build_cmd_doc` | 2 | Pass | `README.md:73-81` documents `pnpm build` and its companion checks. |
| `deps_pinned` | 2 | Pass | `pnpm-lock.yaml` is tracked; fresh `pnpm install --frozen-lockfile` exited 0. |
| `vcs_cli_tools` | 2 | Pass | `gh auth status --active --json hosts` reported `lapeninns`, active, state `success` (fields filtered). |
| `automated_pr_review` | 2 | Pass | Recent PR review metadata shows `chatgpt-codex-connector` on #35, #34, #32, #31 and #30. |
| `agentic_development` | 3 | Pass | Last 100 commits have 249 matching agent attribution lines; the PR history also has Codex-generated reviews. |
| `fast_ci_feedback` | 4 | Fail | Latest 20 merged PRs: mean 47.95 min, min 9.50 min, max 122.10 min, measured from first common/fixture check start to last primary check completion. PR #39 addresses duplicated suites but is not on the baseline. |
| `build_performance_tracking` | 4 | Fail | `.github/workflows/ci.yml` caches pnpm, not build output; no baseline-specific build duration trend or build cache is configured in the shared gate. |
| `deployment_frequency` | 4 | Fail | `gh release list` and deploy-related `gh run list` returned zero; deployment API returned no records. The 19 November release note proves a shipment, not automated multiple-per-week deployments. |
| `single_command_setup` | 3 | Pass | `README.md:37-71` and `docs/setup.md` document frozen install, isolated fixture services, then `pnpm dev`. |
| `feature_flag_infrastructure` | 4 | Pass | `lib/auth/captcha.ts` defines an operator-controlled CAPTCHA feature toggle; `docs/release-checklist.md` notes the retired layout flag. |
| `release_notes_automation` | 3 | Fail | `docs/release/` contains hand-maintained notes; no release-note generator is wired into repo scripts. |
| `progressive_rollout` | 4 | Skip | Single Next.js app, not an infrastructure repository; an older manual pilot is not a canary. |
| `rollback_automation` | 4 | Skip | Single Next.js app, not an infrastructure repository; `docs/release-checklist.md` has manual recovery instructions. |
| `monorepo_tooling` | 2 | Skip | One application manifest; `pnpm-workspace.yaml` has `packages: []`. |
| `version_drift_detection` | 3 | Skip | One build package; no sibling dependency graph to compare. |
| `release_automation` | 3 | Pass | `docs/release/2026-11-19-five-tab-staff-app.md` records that a merge to `main` automatically deploys the production app on Vercel, including the #35 and #37 shipments. Database migrations are separately coordinated. |
| `dead_feature_flag_detection` | 3 | Fail | `lib/auth/captcha.ts` has a flag, but no usage/lifecycle gate is present. |
| `agents_md` | 2 | Pass | `AGENTS.md` documents verification and project conventions and links to the detailed workflow. |
| `readme` | 1 | Pass | `README.md` includes setup, usage guides, checks and implementation references. |
| `automated_doc_generation` | 2 | Fail | `pnpm db:types` generates TypeScript, not documentation; no configured doc generation was found. |
| `skills` | 3 | Fail | No tracked `.factory/skills/`, `.skills/` or `.claude/skills/` entry. |
| `documentation_freshness` | 3 | Pass | `git log --since='180 days ago' -1 -- README.md AGENTS.md CONTRIBUTING.md` returned `60e6db443` (2026-11-19). |
| `service_flow_documented` | 3 | Pass | `docs/architecture.md` documents browser, Next.js, Supabase, Storage and operator service boundaries. |
| `agents_md_validation` | 4 | Fail | `scripts/ci/local-ci.sh` checks verification tooling but not `AGENTS.md` paths/commands. |
| `devcontainer` | 2 | Fail | No `.devcontainer/devcontainer.json` in the checkout. |
| `env_template` | 1 | Pass | Tracked `.env.example` and inventory in `docs/setup.md`. |
| `local_services_setup` | 2 | Pass | `supabase/config.toml` and `docs/setup.md` describe an owned Postgres/Auth/Storage/Mailpit stack. |
| `devcontainer_runnable` | 3 | Skip | `command -v devcontainer` found no CLI. |
| `runbooks_documented` | 2 | Pass | `README.md` points to `docs/setup.md`, `docs/operations.md` and release gates; `docs/archive-monitoring.md` has incident procedures. |
| `branch_protection` | 2 | Fail | GitHub API confirms admin access; rulesets `[]`, `main` 404 “Branch not protected”, `dev` 404. Prepare-only owner decision prevents this mission from closing it. |
| `secret_scanning` | 3 | Fail | GitHub API reports disabled; `scripts/ci/scan-bundle.mjs` scans generated client output, not committed source. |
| `codeowners` | 2 | Fail | No tracked CODEOWNERS; API returns 404. `lapeninns` is confirmed admin and eligible for a rule. |
| `automated_security_review` | 2 | Pass | `tests/security/run.mjs` runs in the fixture gate; `scripts/ci/run-suites.mjs` produces per-suite Vitest security assessments with readable, scrubbed findings. |
| `dependency_update_automation` | 2 | Fail | No Dependabot/Renovate config or matching author in latest 50 PRs; the pnpm age policy is not update automation. |
| `gitignore_comprehensive` | 1 | Fail | `.gitignore` already covers `.env*`, exceptions, dependencies, bundles and OS files, but lacks `.idea` and `.vscode`. Tracked env filename search found only allowed `.env.example`. |
| `privacy_compliance` | 4 | Pass | `docs/privacy-audit.md`, retention and removal operations, and fixture privacy runtime tests are checked in. |
| `secrets_management` | 2 | Pass | Ignored `.env*`, allowed `.env.example`, documented separation of public and server-only configuration. |
| `min_release_age` | 3 | Pass | `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`; `docs/setup.md` explains the one-day policy. |
| `issue_templates` | 2 | Fail | No `.github/ISSUE_TEMPLATE/`. |
| `issue_labeling_system` | 2 | Fail | GitHub lists `bug`, `enhancement` and other defaults but no complete priority/type/area system. |
| `backlog_health` | 4 | Fail | Authenticated `gh issue list --state open` returned `[]`; no active backlog to score. |
| `pr_templates` | 2 | Fail | No GitHub pull request template. |
| `lint_config` | 1 | Pass | `eslint.config.mjs`; `pnpm lint` exited 0. |
| `type_check` | 1 | Pass | `tsconfig.json` already has strict mode; `pnpm typecheck` exited 0 with no diagnostics. |
| `formatter` | 1 | Pass | `.prettierrc`, `.prettierignore` and `pnpm format`; not enforced in the baseline gate. |
| `pre_commit_hooks` | 2 | Fail | No versioned hook checker; `git config --get core.hooksPath` was unset. |
| `strict_typing` | 2 | Pass | Existing `"strict": true`; `pnpm typecheck` emitted 0 diagnostics. |
| `naming_consistency` | 3 | Fail | No dedicated lint rule or explicit general naming convention in `AGENTS.md`. |
| `cyclomatic_complexity` | 5 | Fail | No ESLint complexity rule or equivalent gate. |
| `dead_code_detection` | 3 | Fail | No Knip or equivalent repository-wide unused file/export check. |
| `duplicate_code_detection` | 3 | Fail | No jscpd or equivalent CI check. |
| `code_modularization` | 4 | Fail | Next's `server-only` sentinel protects the client boundary, but no general import-layer check enforces the documented architecture. |
| `n_plus_one_detection` | 4 | Pass | `tests/security/metrics-overview-plan.test.ts` asserts actual Postgres call counts via `pg_stat_user_functions`; the security runner is part of the fixture gate. |
| `heavy_dependency_detection` | 4 | Fail | Client bundle secret scan does not measure bundle sizes; no bundle budget/analyzer in gate. |
| `unused_dependencies_detection` | 3 | Fail | No Knip/depcheck or equivalent CI check. |
| `unit_tests_exist` | 1 | Pass | `tests/unit/`, `tests/ui/`, `tests/media/` and `tests/upload/` have tests. |
| `integration_tests_exist` | 3 | Pass | `tests/integration/` and `playwright.config.ts` are tracked with fixture coverage. |
| `unit_tests_runnable` | 2 | Pass | `pnpm exec vitest list --project unit` exited 0 and listed unit test names without running them. |
| `test_performance_tracking` | 4 | Pass | `scripts/ci/run-suites.mjs` keeps timed Vitest/Playwright reports; `docs/acceptance.md` tracks durations and load-sensitive regressions. |
| `flaky_test_detection` | 4 | Pass | `docs/acceptance.md:92-93,434` records named flaky journeys and repeat measurements under load/quiet runs; `pnpm journeys` is the runner. No duplicate check names in the sampled ten PRs. |
| `test_coverage_thresholds` | 2 | Fail | `vitest.config.ts` and the unit gate do not enforce instrumented coverage floors. |
| `test_naming_conventions` | 3 | Pass | `vitest.config.ts:29-33,42` enforces `.test.*` includes; Playwright uses `.spec.ts`. |
| `test_isolation` | 4 | Pass | Vitest projects isolate unit files; browser/database lanes get unique disposable Supabase project IDs and port blocks using `scripts/ci/prepare-stack.mjs`. |
| `interactive_qa_exists` | 2 | Pass | `docs/setup.md` gives an owned stack, development identities, a local Mailpit sign-in and `/login`; `docs/ci.md` and `tests/e2e/auth.spec.ts` drive an authenticated staff journey. |
| `interactive_qa_runnable` | 3 | Pass | Rubric's evaluation-environment fallback: documented fresh install, disposable test services, fixture auth and actual interaction (`docs/setup.md`, `tests/e2e/auth.spec.ts`). Initially scored before fixture reset authorization; current-run browser proof not claimed. |
| `api_schema_docs` | 3 | Fail | `app/api/` contains live route handlers, including `/api/knowledge/v1`, but no checked-in OpenAPI/Swagger/GraphQL schema. |
| `database_schema` | 2 | Pass | `supabase/migrations/` version controls the Postgres/RLS schema and `lib/db/types.ts` describes its TypeScript projection. |
| `structured_logging` | 2 | Fail | There is a dedicated message sanitizer (`lib/server/log/redact.ts`), but no structured logger; server call sites still log directly to console. |
| `distributed_tracing` | 3 | Fail | No server-generated correlation header follows normal requests through `proxy.ts` and downstream calls; request IDs in coverage forms are idempotency keys, not tracing. |
| `metrics_collection` | 3 | Pass | `lib/metrics/track.ts`, `lib/server/metrics/` and `/admin/metrics` collect and report application workflow/operational metrics. |
| `code_quality_metrics` | 4 | Fail | GitHub code-scanning analyses unavailable; the baseline linter/unit checks do not track coverage, complexity or maintainability. |
| `error_tracking_contextualized` | 2 | Fail | No Sentry or equivalent provider for source maps, breadcrumbs and user context. |
| `alerting_configured` | 3 | Pass | `docs/archive-monitoring.md`, `scripts/monitoring/check-archive.mjs` and Vercel's archive watchdog schedule define and deliver alerts; newest live smoke rule separately supplied by owner. |
| `deployment_observability` | 4 | Pass | `docs/archive-monitoring.md` and deploy/runbook docs direct operators to Vercel function logs and archive health readings. |
| `health_checks` | 3 | Pass | `app/api/internal/media-archive/status/route.ts` implements an authenticated health probe; `scripts/ci/smoke-production.mjs` checks public/auth route availability. |
| `circuit_breakers` | 4 | Pass | `lib/upload/uploader.ts` and `lib/upload/signed-put.ts` implement bounded retries/fallback for transient Supabase Storage transfer failures. |
| `profiling_instrumentation` | 4 | Fail | Performance benches exist, but no runtime profiler or flame-graph tool is configured. |
| `dast_scanning` | 4 | Pass | `tests/e2e/security-headers.spec.ts` tests running HTTP responses in the isolated CI fixture lane. Passive OWASP ZAP is an extra milestone requirement, not current evidence. |
| `pii_handling` | 3 | Pass | `docs/privacy-audit.md`, `docs/operations.md` and `tests/integration/privacy-runtime.test.ts` document/verify minimization and sensitive data boundaries. |
| `log_scrubbing` | 3 | Pass | `lib/server/log/redact.ts` and `scripts/ci/suite-report.mjs` redact error data and CI reports; no central production logging policy covers all call sites. |
| `product_analytics_instrumentation` | 3 | Pass | First-party `lib/metrics/events.ts`, server action and SQL `record_product_events` record and roll up named product events without a third-party client SDK. |
| `error_to_insight_pipeline` | 5 | Fail | No error tracker issue-linking integration or error-to-issue job is configured. |

## Validation notes and qualification blockers

- Worktree created from fetched `origin/main` after `gh auth switch --user lapeninns`. The original checkout was not changed.
- Frozen dependency install, strict typecheck, lint and runner-native Vitest collection all exited 0. An initial `pnpm test` timed out after 210 seconds. The bounded six-worker run finished in 282.74 seconds with **5,325 passed, 1 failed**. The failed People pagination test is in `tests/ui/people.test.tsx:209`; `pnpm verify:change unit tests/ui/people.test.tsx` passed all 20 tests in isolation (3.84 seconds). This is not a green full-suite result.
- This checkout's local/lci workflow runs `supabase --workdir "$work" db reset` (`scripts/ci/local-ci.sh:73-80`). No database operation ran before authorization. The owner subsequently allowed resets only on newly created, isolated disposable local fixture stacks. Hosted, shared and existing databases remain off-limits.
- Branch protection is an owner action, not a skip. Deploy frequency and CI latency are measured operational outcomes; a config-only change cannot backfill them. [PR #39](https://github.com/lapeninns/naba-lens/pull/39) intersects the CI path and is outside this branch.
