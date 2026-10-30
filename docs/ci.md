# Reproducible CI

The fixture gate is `.github/workflows/ci.yml`; the shared implementation is
`scripts/ci/local-ci.sh`. No remote is configured yet, so the workflow has not
executed on GitHub. It neither deploys nor links to a hosted Supabase project.

## Tools and execution

Use Node **24.16.0**, pnpm **10.30.1**, Supabase CLI **2.117.0**, Docker with a
running daemon, and the browsers supplied by the locked Playwright dependency.
The lifecycle suite also needs `psql` on PATH (on macOS, install PostgreSQL client
tools separately). Hosted Ubuntu runners provide PostgreSQL client tools; ensure
they remain available if changing the runner image.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
bash scripts/ci/local-ci.sh
```

For another browser, install it and select the same lane that GitHub uses:

```sh
pnpm exec playwright install firefox webkit
CI_BROWSER=firefox bash scripts/ci/local-ci.sh
CI_BROWSER=webkit bash scripts/ci/local-ci.sh
```

On Linux use `pnpm exec playwright install --with-deps chromium` (or the selected
browser) to install operating-system dependencies. Do not run these commands
against staging or production. Local runs default to Chromium. GitHub runs
Chromium, Firefox and WebKit on separate Ubuntu 24.04 runners with `fail-fast:
false`; each lane executes the same full gate. `CI result` requires all three.
The workflow uses read-only repository permission and does not persist checkout
credentials. Actions are pinned to commit SHAs.

The gate runs frozen installation, typecheck, lint, unit tests and production
build; then prepares and starts an isolated Supabase stack, resets only that
stack, runs integration, lifecycle and security suites, and executes Playwright.
The CI-owned Playwright wrapper (`scripts/ci/playwright.config.ts`) reuses the
root config's projects unchanged and keeps only those for the requested engine:
Chromium runs `chromium` (every spec, 1280×800) and `mobile-chromium` (Pixel 7:
the `@core` journey plus auth, slice, staff-accounts, library and gaps); Firefox
and WebKit run the `@core` journey. `run-suites.mjs` passes the CI stack as
`E2E_SUPABASE_WORKDIR`, and `prepare-stack.mjs` points its Auth Site URL at the
e2e server (`E2E_PORT`, default 3457). One worker and zero retries. Phone viewport tests do not certify physical devices, camera selection,
background transfer behavior or actual phone HEIC files.

The script prints a PASS/FAIL summary and log location, returns nonzero on a
failed required check, and attempts to stop its own stack on exit. Read each
suite's log for individual test counts and failures; an aggregate row is not
evidence that every test ran. A missing prerequisite is a failure, not a skip
that can satisfy CI. The workflow uploads root `test-results/` and
`playwright-report/` on failure with seven-day retention. Traces can contain
fixture session tokens and fixture media: keep artifact access restricted to
repository collaborators and never add real staff or customer data to fixtures.

## Stack isolation and credentials

`scripts/ci/prepare-stack.mjs` copies this checkout's Supabase configuration,
migrations and seed into a new temporary directory, excluding CLI transient
state. It gives the copy a unique project ID and an available port block outside
the foundation 554xx block. The tracked `supabase/config.toml` is unchanged.
Studio, Realtime, Analytics and Edge Runtime are disabled in the temporary copy
to reduce load. Auth, database, storage and local mail capture remain enabled.
Port conflicts fail startup; do not stop another worktree's containers to fix
one. `docker ps` can identify current stacks without changing them.

Connection settings come from `supabase --workdir <temporary-directory> status`
for this run. Integration and browser tests receive explicit loopback URLs and
local keys; lifecycle/security runners also validate their isolated local target.
No real provider secret or hosted project credential is required. Local auth
email is captured by Mailpit. Never supply Resend, SMTP, production Supabase or
management API credentials to this gate, and never source a personal `.env`.
Framework commands may load checkout `.env` files automatically: run from a clean
checkout without such files; the gate must not inherit provider credentials.

After an interrupted run, find the temporary workdir in its logs and inspect the
project ID before stopping **only that run's stack**:

```sh
supabase --workdir <temporary-directory> stop --no-backup
```

Do not use a repository-wide `supabase stop`, Docker prune, or remove containers
belonging to another worktree. Temporary status files contain local keys; do not
commit or upload them. Remove the owned temporary directory after reviewing its
logs and confirming its containers have stopped.

## Existing Naba conventions inspected

Read-only references were `platform/naba-presence/.github/workflows/ci.yml`, its
shared setup action, and `platform/local-ci/profiles/{naba-presence,nabaperks,
naba-table}.json` under `~/LapenInns Project/`. NabaPresence's workflow and local
profile invoke one shared verification implementation. The profiles distinguish
fixture gates from provider-dependent operational jobs and keep browser evidence
separate from release/deployment evidence. This track adopts those boundaries
with a smaller application-specific gate. No `lci` command was run, no profile
was changed and no other repository was modified.

## Protected staging smoke job (future, manual only)

**NOT RUN / unavailable:** there is no staging environment, remote, staging
identity or protected GitHub Environment. This is a separate job design, not a
passing check or a deployment command. Do not connect it to pull-request events
or reuse local fixture reset commands against staging.

When the owner provisions staging, create a separate
`.github/workflows/staging-smoke.yml` with `workflow_dispatch` as its only trigger.
Use a GitHub Environment named `staging` with required reviewers, prevent
self-review, and restrict allowed deployment branches to the protected default
branch. These protections are repository settings; writing `environment: staging`
alone does not create approval protection. Require a dispatch from that protected
branch and serialize runs without canceling an approved run:

```yaml
name: Staging smoke
on: workflow_dispatch
permissions:
  contents: read
concurrency:
  group: staging-smoke
  cancel-in-progress: false
jobs:
  smoke:
    if: github.ref_name == github.event.repository.default_branch
    environment: staging
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      # Install the same pinned tools and locked dependencies as fixture CI.
      # Validate an owner-configured exact HTTPS staging origin, then invoke
      # a reviewed staging-only smoke harness. Never run local-ci.sh here.
      - name: Require the staging harness before enabling this workflow
        run: exit 1
```

The deliberate failing placeholder above prevents an incomplete copy from
claiming success. Replace it only after implementing and reviewing a dedicated
staging harness. Before enabling, confirm exact app origin and Supabase project,
redirect/email configuration, private storage limits, deployment revision and
migration parity. Provide dedicated synthetic staff/admin accounts through
environment-scoped secrets after approval; never production accounts or service
role keys in browser tests. The smoke harness should use those fixture accounts
to verify login, one-photo upload, staff isolation, admin original-byte download,
deactivation and removal, with bounded cleanup of only its own fixture records.
No schema resets, invitations to real staff, real provider sends, seed loading,
or automatic deployment are part of the smoke job. Record authenticated browser
evidence separately from a simple unauthenticated HTTP availability check.
