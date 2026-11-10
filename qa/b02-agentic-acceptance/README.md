# B02 agentic acceptance (candidate 1c538949)

This is a standalone acceptance harness for B02-01 through B02-06. It runs
against exact application candidate
`1c5389497f15d4aec04bad77568223ec82537cd1` (tree
`bb009c741c3269dc367e8788b4e2eba64968a316`, 49 migrations to
`20261110095911`) on the coordinator-owned `spare6` stack only. It never
accepts the harness snapshot
(`2bfd50909d7773c5631c677910f94ad6e09ca63e`) as the candidate.

All harness code lives in `qa/b02-agentic-acceptance/`. Nothing here changes
application code, tests, migrations or manifests. The coordinator owns real
execution, the database lifecycle and delivery.

## Files and owners

| File | Owner | Role |
| --- | --- | --- |
| `run.mjs` | foundation | Entry point. It runs the guards, takes the `spare6` lock, seeds, builds, starts and stops the app, runs the four e2e suites and the Playwright charters, validates every report and writes the summary. |
| `run.test.mjs` | foundation | Offline guard tests, with no DB, app, browser, model or lock |
| `fixture.ts` | foundation | Target guards, run binding, the world, fixture sign-in, read-only DB read-back, copy helpers and page-geometry sources |
| `seed.ts` | foundation | Creates one disposable world with the candidate's own helpers, writing a durable journal as it goes |
| `e2e.config.ts` | foundation | Runner config. `B02_SUITE` picks one e2e suite, which writes to `.results/<B02_RUN_ID>/<suite>/`. |
| `candidate.json` | foundation | The one accepted head, tree and migration set |
| `staff.e2e.ts`, `manager.e2e.ts` | journeys worker | 4 staff and 8 manager cases |
| `recovery.e2e.ts`, `layout.e2e.ts` | recovery/layout worker | 2 recovery cases, and 1 layout case at each of 4 targets |
| `charters.playwright.ts`, `charters.config.ts` | recovery/layout worker | The two B02-06 interruption charters on the candidate's Playwright |

## Finite selection: 20 instances

`run.mjs` holds this plan (`PLAN`). It checks collection and every report
against it. A missing or extra instance, or one on the wrong target, fails the
suite.

| Suite | Runner | Instances | Live agent work the report must show |
| --- | --- | --- | --- |
| `staff` | e2e, desktop 1280×800 | 4 | At least 1 passed `agent.act` that made model calls and was not replayed from cache |
| `manager` | e2e, desktop | 8 (7 corrected cases plus 1 short-video case) | None required |
| `recovery` | e2e, desktop | 2 | None required |
| `layout` | e2e, `phone-320` 320×568, `phone-375` 375×667, `phone-390` 390×844, `desktop` 1280×800 | 1 case × 4 targets | A passed live `agent.assert` with model calls at **each** target |
| `charters` | candidate Playwright 1.64.1, no webServer | 2 | Not applicable |

A suite **passes** only when all of the following hold. A child's exit code of
0 is not enough on its own.

- **e2e:** `report.json` exists, parses, is `schemaVersion: "report-1"` for
  project `nabalens-b02-agentic-<suite>`, and started after the suite was
  launched. It shows `run.status: "passed"`, `exitCode: 0` and no run errors.
  The summary reads `discovered = selected = executed = passed = planned` with
  `failed = flaky = skipped = 0`. Every result is a selected `test` from the
  suite's file on a planned target, with repeat 0 and no duplicate title.
  Each result passed on its single attempt; a serial member passes through
  its group's single passing attempt. The planned count per target matches
  exactly. Any agent step replayed from the cache (`self-finalized`) fails
  the suite. Where the plan asks for agent work, the run used model tokens.
- **charters:** the Playwright JSON report has no `webServer`, no top-level
  errors and projects with `retries: 0`. It holds exactly two distinctly
  titled tests from `charters.playwright.ts`. Each is expected to pass and
  passed on its one attempt, with no skip, fixme or fail annotation. The stats
  read `expected 2, unexpected 0, flaky 0, skipped 0`, and the run started
  after launch.

Every suite writes into a new directory. A report left by an earlier run can
never be read as this run's.

## Shared fixture API (fixture.ts)

Existing exports and signatures are unchanged. They include `World`,
`Person`, `Venue`, `MenuItems`, `PilotKey`, `QUESTION`, `DISH`, `VIEWPORT`,
`LAYOUT_TARGETS`, `target()`, `runDir()`, `world()`, `sessionCookies(email)`,
`signInAs(app, browser, person)`, `readOnly(sql)`, `asUser(userId, sql)`,
`uuid`, `text`, `json`, `db.*`, `acceptedFor`, `setSaved`, `SELF_REVIEW` and
the geometry sources. The additions are below.

- `World.runId`: the run's validated `B02_RUN_ID`. `world()` refuses a world
  in any of these cases:
  - it is not complete;
  - it belongs to another run, or its journal header names another run;
  - it was seeded for another candidate commit, tree or migration digest;
  - it was seeded for another stack or app URL;
  - it has no tag or no scopes.
- `runDir()` requires `B02_RUN_DIR` to be exactly
  `<harness>/.results/<B02_RUN_ID>/world`, already created and free of
  symlinks.
- `World.scopes.staff`, `.layout` and `.recovery`, each typed
  `Scope = { venue: Venue; items: MenuItems; checks: Record<PilotKey, string> }`.
  Each is a separate venue with its own active four-dish menu and an enabled
  four-question working list. Manager cases keep using `venueA`, `items.A`
  and `checks.A` at venue A, plus `venueB` and `venueSolo`.
- Persona binding: `staffSet`, `staffFoh` and `staffBar` belong to
  `scopes.staff`. All four `staffLayout[target]` personas belong to
  `scopes.layout`. `staffRecover` and the new `recoveryDraft: Person` belong
  to `scopes.recovery`. `staffTriage`, `staffGrant`, `managerA` and the other
  manager personas stay where they were.
- `seeded.unlabelledAsset` (labels card) and the `guest_toilets` assignment
  to `staffSet` are at `scopes.staff`. Use `scopes.staff.checks.guest_toilets`.
- `World.layoutTodoCount: number` (12). Each layout persona owns that many
  ready, unlabelled photos and nothing else is assigned to it, so its server
  To do badge reads 12 before the browser adds anything. The candidate's
  `nextActions` labels card counts `needs_labels + needs_attention`; an
  unassigned working-list row does not count, and a failed upload on the
  device adds one in the browser.
- `World.media.managerVideo`: the candidate's own
  `tests/fixtures/media/synthetic.mp4`, copied under a name tagged for this
  run into the private run directory. The other `media.*` files are
  unchanged.
- `candidatePlaywrightTest()` returns the file URL of the candidate's
  installed `@playwright/test` entry, taken from `B02_CHECKOUT`. The charters
  import it, for example
  `const { test, expect } = await import(candidatePlaywrightTest())`. A bare
  `'@playwright/test'` specifier would resolve upward from the harness
  directory, not from the candidate.
- `RUN_ID`, `runId()`, `expectedRunDir(id)`, `JOURNAL`, `appendJournal`,
  `readJournal`, `writeDurable` and `pgEnv()` support the binding and the
  seed.

### DB read-back (`db.*`)

These are read-only (`default_transaction_read_only=on`). The connection goes
through libpq variables, so the DB URL is never on a command line. Rows are
ids, states, names and counts only.

| Method | Arguments | Returns |
| --- | --- | --- |
| `assets` | `(uploaderId, filenamePrefix)` | `{ id, filename, state, role, venue, deleted }[]`, oldest first |
| `groupsOf` | `(assetIds)` | Every group holding any of them: `{ id, createdBy, venue, subjectKind, subjectId, members: { asset, position, state, deleted }[] }[]` |
| `labelItems` | `(assetId)` | Labelled dish names (snapshot at save), sorted |
| `photoRows` | `(assetId)` | `menu_item_photos` rows: `{ item, state, decidedBy, author }[]` |
| `acceptedEvents` | `(venueId, authorId)` | Count of accepted-photo events |
| `credit` | `(venueId, staffId)` | `{ menu, checks }` for the London month (`private.monthly_venue_completion_counts`) |
| `communityReadable` | `(viewerId, assetIds)` | Sorted ids the viewer may see in Photos (`community_readable_assets`, as the viewer under RLS) |
| `rlsVisible` | `(viewerId, assetIds)` | Sorted ids the viewer can select from `media_assets` under RLS |
| `contributions` | `(checkId)` | `{ by, kind, answer, outcome }[]`, oldest first |
| `drafts` | `(checkId, userId?)` | Count of account drafts on the check: anyone's, or only `userId`'s |
| `slot` | `(venueId, key)` | The resolver's row (`private.knowledge_slot_state`) |
| `submissions` | `(checkId)` | `amenity_submissions` rows `{ answer, by }[]` (the only rows that earn check credit) |

Two changes from the snapshot:

- `communityReadable` now returns ids. The function returns a table, and the
  snapshot aggregated whole rows.
- `groupsOf` members now carry each asset's own state. A group adds no state
  of its own.

## Guards (run.mjs)

`list` and `check` take no lock and write nothing. `seed` and `run` apply
every guard below before the lock, then again inside it immediately before
the seed.

**Pin.** `candidate.json` has exactly its five keys. The candidate commit's
own git tree has the pinned migration digest (the same algorithm as
`stack.mjs`), 49 files and latest `20261110095911`. The working-tree
migration digest matches it.

**Checkout.** `B02_CHECKOUT` is an absolute path to a worktree root at the
pinned HEAD and tree. `git status --porcelain --untracked-files=all` is
empty, so there is no tracked change and no untracked file. There is no
`.env*` file other than `.env.example`, which `next` would otherwise read.
The checkout is verified again after `next build`. `tsx`, `next` and
`playwright` must be installed in it.

**Harness.** The harness directory must be committed and clean for `seed` and
`run`. Its commit and tree go into the journal and summary, and a change
during the run fails it.

**Stack.** `NABALENS_WS_ROOT` must be unset. The `stack.mjs` spec for spare6
must be canonical (`/tmp/nabalens-ws/spare6` and its ports), so the lock is
`/tmp/nabalens-ws/spare6.lock`. The stack must be running as
`nabalens-ws-spare6`. Its `revision.json` must show a clean reset from this
checkout at the candidate, with applied migrations matching the recorded
files, 49 to `20261110095911`, and the recorded digest equal to the pin.

**Environment.** The stack env is read fresh under the lock. URLs must be
loopback on spare6's ports, the keys must be present, and the service and
publishable keys must differ.

**Lock.** Inside `withLock`, `owner.json` must show this process's pid and
this run's label. This is checked before the seed, the build, the app start
and every suite. The lock is released only after every child group has
settled.

**App port.** Before the app starts, nothing listens on 3646 (checked with
`lsof` and a TCP probe). After readiness and before every suite, every
listener on 3646 must belong to the process group `run.mjs` started (`lsof`
and `ps -o pgid`). If `lsof` is missing, the check fails closed.

**Selection.** `--suites` uses exact membership in `PLAN`'s own names, so
`toString`, `__proto__` and `constructor` are refused. The same holds for
`B02_SUITE` in `e2e.config.ts`. A suite cannot be named twice.

**Paths.** `B02_RUN_ID` is one segment matching
`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`, so it cannot contain dots or separators.
`.results` must be a real directory, not a symlink. `.results/<id>` is
created exclusively, so a run id is never reused. Each suite directory must
be new.

**Children.** Each child runs in its own process group, bounded by a timeout
and SIGINT/SIGTERM. The child's result counts only after its group is
stopped and its output has drained, including when the leader exits early or
fails to spawn.

**Charters.** Their config may not mention `webServer`, and the report must
show none. There is never a second server.

## Environment by child (names only)

You set: `B02_CHECKOUT` (required, absolute) and, optionally, `B02_RUN_ID`
and `B02_E2E_HOME` (default `$HOME`). Every child inherits only `PATH`,
`HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM`, `TMPDIR` and the
proxy variables. The browser runners also inherit `PLAYWRIGHT_BROWSERS_PATH`.
Anything else (`DATABASE_URL`, Vercel tokens, the B01 per-venue lists, `CI`
and so on) is dropped.

| Child | Gets |
| --- | --- |
| seed (`tsx seed.ts`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all three are needed, or the repository helper falls back to `supabase status` in the checkout), `E2E_DB_URL`, `E2E_ISOLATED_STACK=1`, `B02_CHECKOUT`, `B02_VIA_RUNNER=1`, `B02_STACK`, `APP_URL`, `B02_RUN_ID`, `B02_RUN_DIR` |
| `next build` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3646`, `NEXT_TELEMETRY_DISABLED=1`, the four `NABALENS_*=b02` switches. No server secret. |
| `next start` | the build's values plus `SUPABASE_SERVICE_ROLE_KEY` (admin and media routes) |
| e2e suite | `NEXT_PUBLIC_SUPABASE_URL` (target guard), `SUPABASE_SERVICE_ROLE_KEY` (fixture sign-in links), `E2E_DB_URL` (read-only read-back), `B02_SUITE`, `B02_STACK`, `APP_URL`, `B02_RUN_ID`, `B02_RUN_DIR`. No publishable key, JWT secret, `SUPABASE_DB_URL`, Mailpit or checkout path. |
| Playwright charters | the e2e values with `B02_SUITE=charters`, plus `B02_CHECKOUT` (the candidate's Playwright) and `PLAYWRIGHT_JSON_OUTPUT_FILE` |

The e2e config registers the service key and the DB URL as runner `secrets`,
so the runner redacts them wherever it writes. The model never sees them,
and no test fills them.

## Redaction

Every value `stack.mjs` holds is treated as a credential: the service key,
publishable key, JWT secret, both DB URLs and a DB password of 12 or more
characters. A local default such as `postgres` is not treated as a secret,
but the whole URL is.

- Child stdout and stderr, and `app.log`, are redacted line by line as they
  stream. Output with no line breaks is cut so that no secret spans a cut.
- After the run, every file under `.results/<id>/` is made private (dirs
  0700, files 0600). Credential values in text files are replaced in place
  with `[redacted:<NAME>]`. A value found in a binary file, or any symlink,
  fails the run and is listed in `summary.json`.
- The seed journal scrubs helper error messages before writing them.
- e2e and Playwright traces and videos are off, so browser cookies and
  network headers are never recorded.

## Seed, journal and world

`run.mjs` creates `.results/<id>/world/world.journal.jsonl` exclusively. It
writes and fsyncs a header (run id, candidate, tree, digest, stack, app,
harness commit, pid) and fsyncs the directory before the seed process
starts. `seed.ts` refuses to run unless that header is the only line and
names this run and candidate. Every step then appends:

- an fsynced `intent` line (tag, planned venue names, planned fixture emails,
  prefixes, ids it is about to change) before its first write;
- `done` with the ids it created, or `failed` with a scrubbed message.

`world.json` is written last, atomically (temp file, fsync, rename, directory
fsync), and a final `complete` line follows. If the seed fails or is
interrupted, the journal lists every tagged row that may exist.

The world contains:

- six venues: A, B, Solo, Staff, Layout and Recovery;
- 17 accounts: admin, 3 managers, 1 revoked manager, staff and 4 layout
  personas;
- six active menus;
- five working lists: A, Solo, Staff, Layout and Recovery;
- the staff-era, revoked, waiting and unlabelled photos, plus 12 unlabelled
  photos per layout persona;
- the generated JPEGs and the candidate's MP4.

The harness deletes nothing, and tagged DEV FIXTURE rows stay on the
disposable stack. The coordinator resets the whole stack later with
`node <checkout>/scripts/ci/stack.mjs reset spare6 --from <checkout>`. There
is no row deletion or shared reset here.

## Commands

From this directory, using the project's Node (24.x was used for the offline
checks):

```sh
# Offline: guard tests and collection of the files present (no stack needed).
node --test run.test.mjs
node run.mjs list                    # awaiting partner files are listed, not failures
B02_CHECKOUT=<checkout> node run.mjs list --require-all   # after integration: all 20, charters included

# Coordinator, on the clean candidate checkout after
#   node <checkout>/scripts/ci/stack.mjs reset spare6 --from <checkout>
env -u NABALENS_WS_ROOT B02_CHECKOUT=<checkout> node run.mjs check
env -u NABALENS_WS_ROOT B02_CHECKOUT=<checkout> B02_RUN_ID=b02-1c53-<yyyymmdd-hhmm> \
  node run.mjs run --build > <private-log> 2>&1
```

`run --build --suites staff,layout` runs a subset. Its summary says `partial`
and `complete: false`, and it never counts as completion. The exit code is 0
only when every selected suite passed, the artifact scrub is clean and no
error occurred.

Outputs, all private, are under `.results/<id>/`:

- `world/` (journal, `world.json`, media)
- `app.log`
- `<suite>/` (e2e `report.json`, `summary.md`, artifacts)
- `charters/report.json` and `charters/test-results/`
- `summary.json`, which records the candidate, the harness commit and tree,
  each suite's verdict, its problems, its agent-step counts and model calls,
  the instance totals and the scrub.

## Updating the pinned head

If the coordinator integrates a new application head, compute all five values
from that head's git objects in the candidate checkout and replace them
together in `candidate.json`:

```sh
git -C <checkout> rev-parse <head> <head>^{tree}
node -e 'import("./run.mjs").then(r => console.log(r.commitMigrations(process.argv[1], process.argv[2])))' <checkout> <head>
```

Then update `PINNED` in `run.test.mjs` to the same values and rerun
`node --test run.test.mjs`. The test computes the digest from git and refuses
any mismatch.

## Offline checks run for this commit

- `node --test run.test.mjs`: 38 of 38 passed, using temporary git repos, a
  fake `psql` and local processes only.
- `node run.mjs list`:
  - `manager`: 7 of 8 collected, so it fails until the journeys worker adds
    the short-video case;
  - `staff`, `recovery`, `layout` and `charters`: awaiting integration.
- The candidate's own `tsc` 5.9.3 (`--strict --noUncheckedIndexedAccess`) on
  `fixture.ts`, `seed.ts`, `e2e.config.ts` and `manager.e2e.ts` exited 0.

## Limitations

- Nothing was executed against a DB, app, browser or model. Seed helper
  calls, the build, the app, all 20 instances and the scrub's behaviour on
  real artifacts remain for the coordinator's run.
- Fixture sign-in mints a local magic-link token with the service key and
  posts it to the app's real `/auth/confirm/verify`. Inbox delivery and
  interactive sign-in are outside the run.
- The viewports are Chromium emulation. Physical handset, camera handoff,
  VoiceOver and TalkBack are separate device gates.
- The charters must import Playwright through `candidatePlaywrightTest()` (or
  an equivalent absolute import from `B02_CHECKOUT`). Collecting them needs
  `B02_CHECKOUT` set.
