# Regression and journey harness

How to run a journey against an isolated local stack from a clean checkout and
read the result. Local Docker and fixture data only: nothing here touches a
hosted Supabase project, Vercel, R2 or any real alert channel. The rules for
who may start stacks and which paths each agent owns are in
`docs/workstreams/contracts.md`; the fixture CI gate is in `docs/ci.md`.

## 1. Prerequisites

Node 24.16.0, pnpm, Supabase CLI 2.117.0, Docker with a running daemon, `ffmpeg`
and `psql` on PATH, and the
Playwright browser for the engine a journey uses:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # firefox / webkit for journeys that declare them
```

A journey that needs something missing is reported `unavailable` with the
reason, never `pass` (section 5).

## 2. Stacks

`scripts/ci/stack.mjs` (also `pnpm stack`) manages named stacks. Each has its
own port block, Docker project (`nabalens-ws-<name>`) and workdir under
`/tmp/nabalens-ws/<name>`. It never touches a container it did not start.

| Stack              | Port block   | API / DB / Mailpit          | App    | Used by                         |
| ------------------ | ------------ | --------------------------- | ------ | ------------------------------- |
| `ws1`              | 641xx        | 64121 / 64122 / 64124       | 3641   | Harness, Menus, Media, Evidence |
| `ws2`              | 642xx        | 64221 / 64222 / 64224       | 3642   | Audit, Verification, Capacity   |
| `gate`             | 643xx        | 64321 / 64322 / 64324       | 3643   | final-head gate (Harness)       |
| `spare4`..`spare9` | 644xx..649xx | `64N21` / `64N22` / `64N24` | `364N` | assigned by Harness on request  |

Studio, Realtime, Analytics and Edge Runtime are disabled, and the sign-in and
email rate limits are raised on these throwaway stacks only. At most three
stacks run at once (`up` refuses a fourth).

```sh
H=<path to the checkout holding the command>
node "$H/scripts/ci/stack.mjs" status [<name>] [--json]    # anyone; no keys
node "$H/scripts/ci/stack.mjs" env <name> --write          # anyone; writes /tmp/nabalens-ws/<name>/env.sh (mode 600)
node "$H/scripts/ci/stack.mjs" reset <name> --from <worktree> [--no-fixtures] [--lock-timeout <s>]
node "$H/scripts/ci/stack.mjs" up <name> [--from <worktree>]   # Harness only
node "$H/scripts/ci/stack.mjs" down <name>                     # Harness only
```

- `status` reports running or stopped, ports, how many migrations the database
  has applied and the latest one, whether they match the last reset, and the
  commit, branch, dirty flag and migrations digest of the last reset.
- `reset` copies `<worktree>/supabase` (config, migrations, seed) into the
  workdir, runs `supabase db reset --local`, loads the fixture world and records
  the revision. It takes an exclusive per-stack lock (waits up to 600 s). It
  **wipes the stack's data**, so only the stack's listed users reset it, and they
  tell the orchestrator when the stack is shared. `ws2` is reset only by Audit
  (from its worktree) until its branch merges.
- `env` exports `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` / `E2E_DB_URL`,
  `SUPABASE_JWT_SECRET`, `MAILPIT_URL`, `E2E_SUPABASE_WORKDIR`, `E2E_PORT`,
  `VISUAL_PORT` and `NEXT_PUBLIC_SITE_URL`. Source the file for existing suites
  (`pnpm test:integration`, `pnpm test:security /tmp/nabalens-ws/<name>`,
  `pnpm exec playwright test`). Never commit or paste it: it holds local keys.
- `status.json`, `env.sh` and `revision.json` live in the workdir, not in the
  repository. Keys never go in logs, the repo or the shared folder.

If a stack is down, ask the orchestrator for Harness to start it. Do not run
`supabase start/stop`, `docker run` or any Docker cleanup yourself.

## 3. Fixture world

`reset` (and `up`) loads one deterministic world, defined in
`tests/support/journey-world.ts` and loaded by `scripts/ci/fixtures.ts`. Ids,
emails and names are constants; the `.test` domain is reserved and nothing is a
real person, venue or menu. There are no passwords: sign in with a magic link
(Mailpit) or `signedInPage()` from `tests/e2e/helpers/world.ts`.

| What     | Value                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Venues   | `JOURNEY_VENUES.one` "JOURNEY Venue One", `.two` "JOURNEY Venue Two"                                                                                           |
| People   | `JOURNEY_PEOPLE`: `admin`, `staffA` and `staffB` (venue one), `staffC` (venue two), `staffInactive` (venue two, deactivated), emails `journey-*@nabalens.test` |
| Menus    | venue one: `tests/fixtures/menus/the-railway.food.json`, venue two: `the-prince-of-wales.food.json`, both imported through the real RPCs and **active**        |
| Media    | ready, with stored objects: staff A photo and video, staff B photo, staff C photo (files `JOURNEY <key>.jpg                                                    | mp4`, e.g. `JOURNEY staffA-photo.jpg`) |
| Manifest | `/tmp/nabalens-ws/<name>/fixtures.json`: menu version ids, media asset ids and original SHA-256 (no keys)                                                      |

`reset` deletes the manifest first and `fixtures.ts` writes it only after the whole
world has loaded, so a manifest exists only for a world that loaded (it is absent
after `--no-fixtures` or a failed load, and journeys then report `unavailable`).

The menu and media fixture files are read from the `--from` worktree, falling
back to the Harness checkout. The seed world of `supabase/seed.sql` (`dev-*`
accounts) is still loaded for the app's own suites.

Journeys that change data (importing a menu, uploading, deactivating) should
create their own unique world with `provisionWorld()` (as the existing specs do)
or restore what they change, so journeys can run in any order on a shared stack.

## 4. Declaring and running journeys

Each journey is one declaration plus a Playwright spec that holds its
deterministic assertions.

- Declaration: `tests/journeys/<area>.<slug>.journey.json` (subfolders allowed).
- Spec: any `*.spec.ts` under `tests/` (new ones in `tests/journeys/`, or an
  existing spec such as `tests/e2e/menus-admin.spec.ts`). Use `--grep` in the
  declaration to pick tests inside a larger file. Do not tag with `@core`: the
  journey config does not filter by tag.
- Owners write their own declarations: Menus `menus.*`, Media `media.*`,
  Evidence `evidence.*`/`auth.*`; Harness owns the runner and `auth.login-smoke`.

```jsonc
{
  "id": "menus.activation", // <area>.<slug>, lowercase kebab-case, unique
  "title": "Admin activates a reviewed draft menu",
  "spec": "tests/e2e/menus-admin.spec.ts",
  "grep": "rows 1\\+3", // optional, regular expression for --grep
  "projects": ["chromium"], // optional: chromium (default), firefox, webkit, mobile-chromium
  "scenarios": ["MENUS-QA-03"], // acceptance ids (contracts section 2.2)
  "historical": {
    // optional: a previously reported failure
    "source": "docs/qa/menus-qa-report.md#4-defects-for-the-lead",
    "id": "MENUS-D2",
  },
  "needs": ["psql"], // optional: host psql is on PATH (implied when the spec imports a psql helper)
  "agentic": { "file": "tests/journeys/x.e2e.ts" }, // optional, see below
  "timeoutSeconds": 600, // optional
}
```

A **historical** journey asserts the _correct_ behaviour. While the defect
exists it is `fail` with `historical.reproducedOnHead: true`; once fixed it is
`pass` with `false` (`null` when unavailable). A historical failure counts as
resolved only when a run on the current HEAD passed.

Specs can read the world from `tests/support/journey-world.ts`, use the existing
helpers (`tests/e2e/helpers/*`), and attach evidence with
`testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" })`
(PNG images and `text/plain` attachments are kept; traces and videos are off).

Run from the worktree under test (the runner builds that worktree for the
chosen stack, so reset the stack from the same worktree first when migrations
changed):

```sh
pnpm journeys list
pnpm journeys run auth.login-smoke                  # one journey on ws1
pnpm journeys run "menus.*" --stack ws1             # a glob
pnpm journeys run --all --stack ws1 --allow-unavailable
pnpm journeys run menus.activation --skip-build     # reuse .next if built for this stack and tree
pnpm journeys validate .artifacts/journeys/<run-id> # check a results directory
```

Flags: `--stack <name>` (default `ws1`, or `NABALENS_STACK`), `--app-port <port>`,
`--allow-unavailable`, `--skip-build`, `--ignore-migration-drift`,
`--no-stack-lock`, `--lock-timeout <seconds>`, `--agentic`, `--run-id`,
`--results-dir`. Until the harness branch merges into yours, merge the
orchestrator's integration branch to get `scripts/ci/journeys/` and
`tests/journeys/`; the stack command can be run from the Harness worktree.

### Concurrent runs on one stack

Several worktrees may run journeys on the same stack at the same time. Each run
builds and serves its own worktree, so give each its own app port:

```sh
pnpm journeys run "menus.*" --stack ws1 --app-port 3645   # Menus
pnpm journeys run "media.*" --stack ws1 --app-port 3646   # Media
pnpm journeys run "evidence.*" --stack ws1 --app-port 3647 # Evidence
```

Without `--app-port` the app uses the stack's port (`ws1`: 3641), so only one
such run fits at a time; a busy port makes the journeys `unavailable` with that
reason. The port is part of the build stamp, so changing it rebuilds (`next build`
bakes in `NEXT_PUBLIC_SITE_URL`). Two runs from the _same_ worktree share its
`.next` and results, so run them one after the other.

The fixture people are shared state: a sign-in link and token exist per address,
so two runs signing in as `journey-staff-a@nabalens.test` would take each
other's emails and invalidate each other's links, and any journey that mutates
fixture data would affect the others. The runner therefore takes the stack's
lock (`/tmp/nabalens-ws/<name>.lock`, the same one `reset`, `up` and `down`
use) around the Playwright phase:

- Builds overlap; test execution on one stack takes turns, and a `reset` waits
  for a running journey (and the reverse). It prints `Waiting for stack ws1: ...`
  while queued.
- The wait is up to 30 minutes (`--lock-timeout <seconds>`). If it expires the
  journeys are `unavailable` with the lock owner as the reason, never a pass.
- The stack's state is re-checked once the lock is held, so a reset that happened
  while waiting is noticed (migration drift gives `unavailable`).
- `--no-stack-lock` skips the lock. Use it only when every selected journey
  signs in as identities it provisions itself (`provisionWorld()`) and restores
  anything it changes.

## 5. Results

Output goes to `.artifacts/journeys/<run-id>/` (gitignored, run id is the UTC
time plus the short commit, with `-2`, `-3` added if that id is taken). An explicit
`--run-id` or `--results-dir` that already holds files is refused before anything
is written, so collected evidence is never overwritten or mixed with a new run:

```
journeys/<id>.json   one result per journey (schema: scripts/ci/journeys/result.schema.json)
summary.json         run totals, revision, stack and the list of journeys
summary.md           the same as a table, including reasons and evidence paths
logs/<id>.log        runner output with credentials redacted
shots/<id>/*.png     screenshots attached by the spec or taken on failure
```

Every result records the full HEAD commit, branch, a `dirty` flag, the stack name
and API port, the latest applied migration with a digest prefix, the runner and
its version, timestamps, scenario ids and evidence paths relative to the results
directory. The runner validates its own output with
`scripts/ci/journeys/validate.mjs`, which also rejects missing evidence files,
traces, cookies and anything that looks like a key or token.

| Result        | Meaning                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pass`        | at least one deterministic test ran, every test held, none was skipped (`checks` records counts)                                                                                                                                                                        |
| `fail`        | a test ran and did not hold; `reason` names the first failing assertion                                                                                                                                                                                                 |
| `unavailable` | the journey could not run: stack stopped, no fixture world, migrations differ from this worktree, browser or `psql` missing, build failed, no test matched, test skipped, timeout before the first assertion, or a requested `--agentic` run not possible. Never a pass |

Exit codes of `pnpm journeys run`: `0` all passed (or the only non-passes were
unavailable and `--allow-unavailable` was given), `1` at least one failure or
invalid harness output, `2` usage or declaration error, `3` nothing failed but
something was unavailable. The summary always lists unavailable journeys.

### Agentic runs

`agentic` journeys can also run the `e2e` agentic runner (`--agentic`) when
`node_modules/.bin/e2e` exists or `E2E_BIN` points at an install, and a model
login or API key is usable. It is **evidence only**: a model judgement never
makes a pass, and a requested agentic run that cannot happen makes the journey
`unavailable` (never silently skipped). No credentials belong in the repository
or a declaration; the runner's own session folder (it holds cookies) is not kept.
This path has been exercised only as far as the "runner not installed" case here:
there are no model credentials in this environment.

## 6. Checks for the harness itself

```sh
pnpm lint && pnpm typecheck && pnpm test      # includes tests/unit/journey-harness.test.ts
pnpm journeys run auth.login-smoke --stack ws1
```
