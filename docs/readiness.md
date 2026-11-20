# Readiness gates and owner actions

## Verify a change

Use Node 24.16.0, pnpm 10.30.1 and Gitleaks 8.30.1. Install with
`pnpm install --frozen-lockfile`, then run `pnpm hooks:install` once. The
checked-in pre-push hook and shared CI gate enforce the same quality,
documentation and tracked-source secret checks. Keep the existing tests and
build gates; `pnpm test:coverage` separately enforces redaction and request
correlation coverage. The dev container is for editing and local checks;
run Docker-backed Supabase and browser qualification using the isolated
host setup in [CI](ci.md).

`pnpm quality` uses ESLint for cyclomatic complexity and large source files,
Prettier for formatting, Knip for unused exports, files and dependencies,
jscpd for duplication, and source checks for import layers, kebab-case
filenames and issue-linked TODO/FIXME comments. Existing findings are recorded
by check and file or symbol. Fix an existing finding and run
`pnpm quality --record` to lower the checked-in baseline; do not raise it.
Review changes to the baseline in the same PR. When formatting an old file,
keep unrelated formatting-only changes in their own commit.

`pnpm docs:check` checks the root instructions' local links and package
commands, the flag registry and the minimum package age. New flag owners add
the definition and its in-use accessor to the registry and remove both when
the rollout or preview ends. New dependency releases wait at least one day.
`pnpm docs:api --write` regenerates the versioned reader's
[OpenAPI document](knowledge/openapi.json); review the checked-in diff. At
release review, run `pnpm release:notes <previous-commit> <candidate-commit>`
to generate Markdown from the main-line history without tagging or deploying.

Shared CI records step duration and a separate client bundle size report.
The first Chromium lane adds a passive ZAP baseline against its own
loopback `next start` process. Docker Desktop reaches the Mac's loopback
listener through its built-in `host.docker.internal` alias; Linux uses the
host network directly. The script refuses a hosted URL, never takes
credentials and does not run an active scan.

## Owners and operations

- **Review requirement.** Do not run this until the owner approves a new main
  ruleset and confirms there is no equivalent existing rule:

  ```sh
  gh auth switch --user lapeninns
  gh api --method POST repos/lapeninns/naba-lens/rulesets --input - <<'JSON'
  {
    "name": "Require one approving review on main",
    "target": "branch",
    "enforcement": "active",
    "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
    "bypass_actors": [],
    "rules": [{
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    }]
  }
  JSON
  ```

- **Tracked env files.** `git ls-files -- '.env*' '**/.env*' '.dev.vars'
  '**/.dev.vars'` returned only `.env.example`; no remediation needed.
- **Sentry.** Create the project separately. Set `SENTRY_DSN` for server
  events; at build time set `SENTRY_ORG`, `SENTRY_PROJECT`, and a scoped
  `SENTRY_AUTH_TOKEN` for private source map uploads. Server traces sample
  at 10%, profiling sessions at 5%. Validate the Node profiler binary on
  the actual deployment target without changing dependency install policy.
  Server diagnostics use correlation IDs and do not send staff identities,
  raw request bodies, cookies or authentication headers.
- **Browser consent.** Leave `NEXT_PUBLIC_SENTRY_DSN` unset until the owner
  has reviewed the privacy notice and wired explicit diagnostics consent.
  The first-party bridge accepts `nabalens:diagnostics-consent` with a
  boolean `CustomEvent.detail` (`true` opts in, `false` withdraws). Without
  an opt-in the Sentry browser SDK is not loaded; this change adds no UI.
- **Errors to issues.** In Sentry, install the GitHub integration for
  `lapeninns/naba-lens`. Link the project to the repo and configure the
  issue-creation rule for actionable error groups. Confirm user details
  are not forwarded. An unconfigured integration is not a pass.
- **Smoke alerts.** The existing nightly `lci smoke --all --notify` is the
  availability alert. On a failed Naba-Lens result, after `gh auth switch
  --user lapeninns`, run `pnpm smoke:issue failed` to file or update a single
  labelled issue without including the raw notification. Have the owner
  connect this to the existing notifier if automatic issue reporting is
  desired; do not add a second production probe or alter the lci profile.
- **CI and deployments.** [PR #39](https://github.com/lapeninns/naba-lens/pull/39)
  addresses duplicated fixture suites. Recheck the mean of the last 20
  merged PR primary check windows after the latency work lands. Verify
  deployment cadence in the provider's deployment history. Do not deploy
  merely to satisfy the readiness metric.
