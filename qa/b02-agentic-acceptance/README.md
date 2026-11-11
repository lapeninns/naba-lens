# B02 agentic acceptance (candidate c4671823)

This is a standalone acceptance harness for B02-01 through B02-06. It runs
against exact application candidate
`c467182323b9db4cbeb330db8248b3dd26042400` (tree
`e2594b345e920f0e8baef81553d23fffe29ac697`, 49 migrations to
`20261110095911`, digest
`22f8296906983c88bc214c08c28b8c669914f41a321e16f7af0360bfe8359caf`) on the
coordinator-owned `spare6` stack only. It never accepts the harness snapshot
(`2bfd50909d7773c5631c677910f94ad6e09ca63e`) or any harness commit as the
candidate.

All harness code lives in `qa/b02-agentic-acceptance/`. Nothing here changes
application code, tests, migrations or manifests. The coordinator owns real
execution, the database lifecycle, receipt clearance and delivery.

## Files and owners

| File | Owner | Role |
| --- | --- | --- |
| `budget.mjs`, `budget.test.mjs` | budget gate | The separate owner-budget gate (E1, E2 at 360/412; J5) on the same pin and lane, using `run.mjs`'s guards ("Budget gate"). |
| `run.mjs` | foundation | Entry point. It runs the guards, takes the `spare6` lock and the blocking receipt, seeds, builds, scans the bundle, starts and stops the app, collects and runs the four e2e suites and the Playwright charters, validates every report, settles every process group and writes the summary. |
| `run.test.mjs` | foundation | Offline guard tests. They use no DB, app, browser, model, real stack or real lock. |
| `fixture.ts` | foundation | Target guards, run binding, the world, fixture sign-in, read-only DB read-back, copy helpers and page-geometry sources |
| `seed.ts` | foundation | Creates one disposable world with the candidate's own helpers, writing a durable journal as it goes |
| `e2e.config.ts` | foundation | Runner config. `B02_SUITE` picks one e2e suite, which writes to `.results/<B02_RUN_ID>/<suite>/`. |
| `candidate.json` | foundation | The one accepted head, tree and migration set |
| `staff.e2e.ts`, `manager.e2e.ts` | journeys worker | 4 staff and 8 manager cases |
| `recovery.e2e.ts`, `layout.e2e.ts` | recovery/layout worker | 2 recovery cases, and 1 layout case at each of 4 targets |
| `charters.playwright.ts`, `charters.config.ts` | recovery/layout worker | The two B02-06 interruption charters on the candidate's Playwright |

## Finite selection: 20 instances

`run.mjs` holds this plan (`PLAN`). It checks each suite's collection and
report against it. A missing, extra, substituted or misplaced instance fails
the suite.

| Suite | Runner | Instances | Live agent work the report must show |
| --- | --- | --- | --- |
| `staff` | e2e, desktop 1280×800 | 4 | At least 1 live `agent.act` in a counted attempt or member |
| `manager` | e2e, desktop | 8 (7 corrected cases plus 1 short-video case) | None required |
| `recovery` | e2e, desktop | 2 | None required |
| `layout` | e2e: `phone-320` 320×568, `phone-375` 375×667, `phone-390` 390×844 and `desktop` 1280×800 | 1 case × 4 targets | A live `agent.assert` at **each** target |
| `charters` | candidate Playwright, project `chromium-desktop`, no webServer | 2 | Not applicable |

The two charter titles are fixed (`CHARTER_TITLES`, the same strings as
`CHARTERS` in `charters.config.ts`):

- `B02-06-A: an upload interrupted by closing its page is offered again on Me and finishes as one asset`
- `B02-06-B: a reason typed offline stays on this device only, survives leaving, and is saved and sent once back online`

### Live model work

A step counts as live model work only when all of these hold:

- it passed;
- `metrics.modelCalls` and `model.calls` are positive integers;
- `model.inputTokens` and `model.outputTokens` are integers whose sum is
  above zero;
- `model.model` is `gpt-6-luna` from a `chatgpt` provider (the saved route);
- nothing was replayed from a cache.

Steps count only from the exact selected, passing attempt of a planned
result, or from that result's one linked, passing serial member. The run's
`usage.modelTokens` must also be a positive integer.

### When a suite passes

A suite passes only when its child exited 0, its process group settled and
its report is valid. A nonzero exit fails the suite even when a fresh,
otherwise valid report says it passed. A failed suite contributes 0 passed
instances.

**e2e:** before the run, `e2e list` must collect exactly the planned
instances: one per target, all to run, from the suite's own file, none twice.
The `report.json` must then show all of these:

- **Document:** it exists and is a regular file, not a link. It parses. It is
  `schemaVersion: "report-1"` for project `nabalens-b02-agentic-<suite>`,
  written by `e2e 0.16.0`, and it started after the suite was launched.
- **Run:** `run.status` is `"passed"`, `exitCode` is 0 and there are no run
  errors.
- **Summary:** `discovered`, `selected`, `executed` and `passed` all equal the
  planned count. `failed`, `flaky` and `skipped` are 0.
- **Targets:** exactly the planned targets, each with
  `baseOrigin=http://127.0.0.1:3646`.
- **Results:** each result is a selected `test` from the suite's file, on a
  planned target, with repeat 0 and no skip. Its `id` is a sha256. Its
  `testId` decodes to the file plus its title path. Its target and title path
  are one collected instance, and none appears twice. Every collected
  instance has a result.
- **Attempts:** each plain result passed on its single attempt (index 0).
- **Serial members:** a serial member passes only through its group's single
  passing attempt. That group must be on the same target and file, the member
  must appear exactly once, and the member must have passed. Each group is
  linked from selected results, and its declared and attempted members are
  exactly those results. An orphan or unrelated group, a duplicate member or
  a group on another target fails the suite. Its model metrics never count.
- **Agent steps:** a cache replay fails the suite. A live step's measured
  `viewport`, when the report gives one, must be its target's.

**charters:** the config's exact bytes must first match the reviewed pin, before
Playwright loads it (see "Charters"). `playwright test --list` must then collect
exactly the two titles. The JSON `report.json` must show all of these:

- **Version and config:** it was written by the candidate's installed
  `@playwright/test` version. It has no `webServer` and no top-level errors.
- **Project:** the only project is `chromium-desktop`, and it has
  `retries: 0`.
- **Tests:** it holds exactly the two titles from `charters.playwright.ts`,
  in project `chromium-desktop`. Each is expected to pass and passed on its
  one attempt, with no skip, fixme or fail annotation.
- **Stats:** `expected 2, unexpected 0, flaky 0, skipped 0`, and it started
  after launch.

Every suite writes into a new private directory. A report left by an earlier
run can never be read as this run's.

`run --build --suites staff,layout` runs a subset. Its summary says
`complete: false` and `qualification: "partial (never completion)"`. It
never counts as completion, even when it exits 0. Only a full selection that
passes reads `qualification: "full"`.

## Shared fixture API (fixture.ts)

Existing exports and signatures are unchanged. They include `World`,
`Person`, `Venue`, `MenuItems`, `PilotKey`, `QUESTION`, `DISH`, `VIEWPORT`,
`LAYOUT_TARGETS`, `target()`, `runDir()`, `world()`, `sessionCookies(email)`,
`signInAs(app, browser, person)`, `readOnly(sql)`, `asUser(userId, sql)`,
`uuid`, `text`, `json`, `db.*`, `acceptedFor`, `setSaved`, `SELF_REVIEW` and
the geometry sources.

These additions from the earlier split remain:

- `World.runId`, and the binding that `world()` refuses a world in any of
  these cases:
  - it is not complete;
  - it belongs to another run;
  - it was seeded for another candidate, stack or app URL;
  - it has no tag or no scopes;
  - it has no replacement request (below).
- `runDir()`: `.results/<B02_RUN_ID>/world`, created, with no symlinks.
- `World.scopes.staff`, `.layout` and `.recovery`, the persona binding and
  `World.layoutTodoCount` (12).
- `World.media.managerVideo`, and `candidatePlaywrightTest()`.
- `RUN_ID`, `runId()`, `expectedRunDir(id)`, `JOURNAL`, `appendJournal`,
  `readJournal`, `writeDurable` and `pgEnv()`.

### Additions in this repair (for B+C)

- **`World.staffReplacement: Person`.** A distinct BOH Curry Chef in
  `World.scopes.staff.venue`. Their only To do is one open replacement
  request, assigned to them alone.
- **`World.seeded.replacement`.** Its type is
  `{ requirementId: string; itemId: string; title: string; reason: string; revision: number }`.
  It is seeded on the path of the candidate's `tests/e2e/home-todo.spec.ts`:
  - `save_coverage_requirement` creates a venue-specific requirement with
    photo target 2 and no due date;
  - `set_coverage_requirement_assignees` assigns it to `staffReplacement`
    only;
  - `staffReplacement` makes one `submit_coverage_photos` submission;
  - the reviewer's `review_coverage_item` decides `needs_another_photo` with
    `reason`.

  Every write is journalled (intent first). `itemId`, `reason`, `title` and
  `revision` are read back read-only after the review; the revision is 2 for
  a fresh item.
- **`World.media.replacement: string`.** A unique run-tagged synthetic JPEG
  (`b02-replacement-<tag>.jpg`) in the private world directory, for the
  replacement photo.
- **Reviewer and side effects.** The reviewer is the world's admin.
  `can_manage_venue` accepts an active admin at any venue, and manager
  accounts cannot write coverage rows. So no persona at the staff venue gains
  a grant, a Manage link or a review badge. The effects are:
  - **Other staff's To do.** An assignment counts only for its assignee
    (`lib/server/coverage/staff.ts`), so `staffSet`, `staffFoh` and
    `staffBar` keep their To do. `staffSet`'s 2→1→0 badge proof is
    unchanged.
  - **`staffReplacement`'s To do.** The submitted photo is amenity evidence,
    which is never labelled, so the replacement card is
    `staffReplacement`'s only To do item.
  - **Community photos.** The submitted photo is community-readable at the
    staff venue (`community_readable_assets` includes coverage-submitted
    assets), so that venue's community photo count is one higher.
  - **Staff list.** The staff venue now has four staff.
- **`Asset.mediaType: "image" | "video"`.** `db.assets()` rows now carry
  `media_assets.media_type`.
- **`db.groupFor(viewerId: string, groupId: string): GroupRead | null`.** It
  calls the candidate's real `public.contribution_group(uuid)` under
  `asUser(viewerId)`: role `authenticated`, the viewer's JWT `sub`, and a
  read-only transaction. It returns `null` only for that function's exact
  not-found answer (`P0002 contribution_group_not_found`: no such group, or
  none of it visible to the viewer). Any other error throws and fails the
  assertion, including `not_active_user`, permission errors and an invalid
  uuid. `mine` must be an actual boolean on the group and on every member,
  and is returned exactly as the function gave it. A missing or malformed
  `mine` (absent, `null`, a string or a number) throws, so an absent flag can
  never pass an assertion that it is `false`. `GroupRead` exposes only these
  safe fields:

  ```ts
  type GroupRead = {
    groupId: string
    venueId: string
    mine: boolean
    subject: { kind: "menu_item" | "task" | "question" | "none"; id: string | null; name: string | null }
    members: { assetId: string; position: number; mediaType: "image" | "video"; uploadState: string; mine: boolean }[]
  }
  ```

  Members are only those the viewer may see, by position. A task the viewer
  may not read is `{ kind: "none", id: null, name: null }`. `groupsOf()` stays
  the privileged persistence read-back. B+C supply the owner, reviewer and
  unauthorized-viewer assertions.
- **`ReadOnlyError` and `GROUP_NOT_FOUND`.** `readOnly` failures now throw
  `ReadOnlyError`, whose message is unchanged. It carries psql's first
  stderr line as `pgError`, with no SQL and no URL.
- **Departments and titles.** Each account has a supported department
  (`profiles_department_check`: `boh` or `foh`) and its own job title:
  - **`boh`:** the kitchen personas, which are `staffSet` (Tandoor Chef),
    `staffB` (Line Chef) and `staffReplacement` (Curry Chef);
  - **`foh`:** every front-of-house, bar and manager persona.

  Job titles are distinct, and seed refuses a duplicate.

The fixture and reader exports, separate suite venues, the `staffSet`
guest-toilets assignment and unlabelled asset, the manager cohorts and
waiting-photo counts, and the twelve unlabelled photos per layout persona are
unchanged.

### DB read-back (`db.*`)

These are read-only (`default_transaction_read_only=on`). The connection goes
through libpq variables, so the DB URL is never on a command line. Rows are
ids, states, names and counts only.

| Method | Arguments | Returns |
| --- | --- | --- |
| `assets` | `(uploaderId, filenamePrefix)` | `{ id, filename, state, role, venue, deleted, mediaType }[]`, oldest first |
| `groupsOf` | `(assetIds)` | Every group holding any of them: `{ id, createdBy, venue, subjectKind, subjectId, members: { asset, position, state, deleted }[] }[]` (privileged read-back) |
| `groupFor` | `(viewerId, groupId)` | `GroupRead` as the viewer reads it through `contribution_group`, or `null` for its exact not-found answer |
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

## Guards (run.mjs)

`list` and `check` take no lock and write nothing. `seed` and `run` apply
every guard below before the lock, and again under it before the seed.

**Lane.** `spare6` is shared with other qualifications, so two guard files
sit beside its canonical lock in `/tmp/nabalens-ws`:

- `spare6.qualification.blocker.json` belongs to the other qualification
  runners (B10 writes it while a child of its own may still use the stack and
  leaves it when that child's settlement is unproven). This harness only reads
  it. Any entry at that path (a file, link or directory) refuses `spare6`,
  and the refusal names its state, phase and runner pid when it is readable.
  It is never followed, changed or removed here.
- `spare6.b02-acceptance.receipt.json` is this harness's own receipt
  ("Settlement and the blocking receipt"). The other runners check it.

`check`, and `seed` or `run` under the lock before the receipt is created,
require the lane root to be a real directory this user owns that nobody else
may write, resolving to its own physical path, and both guard paths to be
absent. Under the lock the blocker is checked again before the seed, the build,
the scan, the app and every suite, so a blocker that appears mid-run stops the
next phase. The run then settles as usual and clears only its own receipt.

**Pin.** `candidate.json` has exactly its five keys. The candidate commit's
own git tree has the pinned migration digest (the same algorithm as
`stack.mjs`), 49 files and latest `20261110095911`.

**Git.** Every identity and cleanliness check runs git with a sanitized
environment (`gitEnv`). Only `PATH`, `HOME`, `LANG`, `LC_ALL` and `TMPDIR`
are kept, and `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` and
`GIT_NO_REPLACE_OBJECTS=1` are set. No inherited variable can select another
repository, index, object store, replacement refs or config. That covers
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_CONFIG_*`, `GIT_CEILING_DIRECTORIES` and `XDG_CONFIG_HOME`. fsmonitor and
the untracked cache are off.

**Checkout.** `B02_CHECKOUT` is an absolute path to a worktree root at the
pinned HEAD and tree. `git status --porcelain --untracked-files=all` is
empty, so there is no tracked change and no untracked file. There is no
`.env*` file other than `.env.example`, which `next` would otherwise read.
Repository state that `status` trusts is refused too:

- skip-worktree or assume-unchanged index bits (`git ls-files -v`);
- clean or smudge filters, `core.attributesFile`, `core.hooksPath` or
  `core.worktree` in the local config;
- any ignored path that no tracked `.gitignore` ignores. That covers
  `info/exclude` rules and an untracked `.gitignore` hiding its own
  directory. Claude tooling state under `.claude/` is the only exception.
`tsx`, `next`, `scripts/ci/scan-bundle.mjs` and, for the charters, the
candidate's own Playwright CLI and `@playwright/test` must be installed in
it.

**Harness.** The harness directory must be committed and clean for `seed` and
`run`. The harness commit and tree are recorded separately from the
candidate's in the journal, receipt and summary. The harness commit or tree
may never be the pin, and the harness checkout may never be `B02_CHECKOUT`. A
change during the run fails it.

**Exact product inputs.** These are checked under the lock before the seed,
immediately before the build and immediately before the app starts:

- the clean checkout at the pin;
- the pinned tree's exact ordered migration file names and digest;
- the checkout's working migrations: the same names, and the digest of their
  actual bytes;
- `stack.mjs` status: running as `nabalens-ws-spare6`, last reset clean from
  this checkout at the pin, and applied count and latest equal to the pin;
- spare6's physical path, before anything in it is read or hashed. Below
  `/tmp` (a system link to `/private/tmp`), each of `nabalens-ws`, `spare6`,
  `supabase` and `migrations` must be a real directory (never a link) owned by
  this user and not writable by others. The workdir and its migrations must
  resolve to exactly that physical chain;
- spare6's actual workdir migrations (`/tmp/nabalens-ws/spare6/supabase/migrations`):
  exactly the pinned ordered file names, every one a regular file (no link),
  and the digest of their actual SQL bytes equal to the pin;
- spare6's `revision.json`: a regular file recording the pin's commit,
  `dirty: false`, `from` equal to `B02_CHECKOUT`, exactly the pinned ordered
  `migrationFiles` and the pinned digest;
- the database's applied ordered version ledger
  (`supabase_migrations.schema_migrations`), read read-only through libpq
  variables: exactly the pinned versions, in order.

Same-version filename drift, workdir byte drift, a manifest mismatch, a
ledger mismatch, a linked or replaced workdir component and a product source
change after the seed each fail before the next phase.

**Build and scan.** `run` makes one fresh production `next build` of the
clean pin. It uses spare6's public env, `NEXT_PUBLIC_SITE_URL` and the four
`NABALENS_*=b02` switches, and no server secret. The build's
`.next/BUILD_ID` must be written by this build, and the checkout must still
be the clean pin afterwards. The candidate's own
`scripts/ci/scan-bundle.mjs --json` then scans that same output. The scanner
gets the service key only so that its secret-value rule looks for spare6's
actual key. It must exit 0, scan files, report no findings and include the
`secret-value:SUPABASE_SERVICE_ROLE_KEY` rule. The build id is checked again
before the app starts. A failed build or scan stops the run before any
browser work. The summary keeps the build evidence (id, times, switches) and
the scan evidence (build id, files, bytes, rules, 0 findings).

**e2e installation.** Live suites run only the reviewed standalone
installation (`E2E_INSTALL`). Its path is `/Users/amankumarshrestha/node_modules/.bin/e2e`,
and it must resolve to `/Users/amankumarshrestha/node_modules/e2e/dist/cli/bin.js`
of package `e2e@0.16.0`. Both that entry and the manifest must be owned here
and not writable by others. It is validated before `list`, at the guards and
again before every suite, and its entry path, version and hashes are recorded
in the receipt and summary. The child runs the validated entry, never the
link. `B02_E2E_HOME` is refused, and no other environment variable selects
an executable. `e2e.config.ts` keeps the saved model route
`chatgpt('gpt-6-luna')`.

**Stack.** `NABALENS_WS_ROOT` must be unset. The `stack.mjs` spec for spare6
must be canonical (`/tmp/nabalens-ws/spare6` and its ports), so the lock is
`/tmp/nabalens-ws/spare6.lock`.

**Environment.** The stack env is read fresh under the lock, and only after
the workdir's physical path is proven. URLs must be loopback on spare6's
ports, the keys must be present, and the service and publishable keys must
differ. `stack.mjs` reads these values from the workdir's cached
`status.json`. So the API URL, DB URL, publishable key, service key, JWT secret
and Mailpit URL must also equal a fresh
`supabase --workdir <physical workdir> status -o json`. A mismatch, or a
status that cannot be read, fails the guard. The message names the field,
never a value.

**Lock.** Inside `withLock`, `owner.json` must show this process's pid and
this run's label. This is checked before the seed, the build, the scan, the
app start and every suite.

**App port.** Before the app starts, nothing listens on 3646 (checked with
`lsof` and a TCP probe). After readiness and before every suite, every
listener on 3646 must belong to the process group `run.mjs` started (`lsof`
and `ps -o pgid`). If `lsof` is missing, the check fails closed.

**Selection.** `--suites` uses exact membership in `PLAN`'s own names, so
`toString`, `__proto__` and `constructor` are refused. The same holds for
`B02_SUITE` in `e2e.config.ts`. A suite cannot be named twice.

**Paths.** `B02_RUN_ID` is one segment matching
`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`, so it cannot contain dots or separators.
`.results` must be a real directory owned by this user, and it is made
private. `.results/<id>` is created exclusively and privately (0700), so a
run id is never reused. Each suite directory must be new, and a link there
counts as existing. A leaf `O_NOFOLLOW` cannot see a replaced parent
directory. So before every read or write in a run's output, the whole chain is
checked with `lstat`: `.results`, `.results/<id>` and down to the directory
holding the file. That covers the journal, `world.json`, `app.log`, each
report, the summary and the scrub. Every link in it must be a real private
directory of this user's, and the physical path must be exactly that chain. A
report is read only up to 64 MiB, and only if the chain still holds after the
read with the same file in place. A replaced parent fails the suite, and
nothing is read, written or scrubbed through it.

**Launch output.** Each suite is collected first and launched second. After
the collection and immediately before the launch (`requireLaunchOutput`), the
private chain is checked again and the suite's output must still be exactly
what collection may leave: absent for an e2e suite, whose runner creates it,
and the empty private directory the harness made for the charters. A
directory a collection child created, a file it left or a link in its place
refuses the launch, so no earlier or foreign file can be read as this run's.

**Charters.** `charters.config.ts` must be the independently reviewed config,
by its exact bytes. Its sha256 must be `CHARTERS_CONFIG_SHA256`
(`3721d32a79310184caecf5f1ccf2974412eb8655aaf58f15387a673a2c1b50e6`, the
reviewed journey checkpoint `e2a1e48d`'s config, as integrated). It must also be a regular file of this user's that
nobody else may write, read without following a link. This is checked at the
guards, before `list`, before the collection and again before the run. On any
other bytes, Playwright is never started, so it never loads the config. A
source reading cannot prove there is no server: one can arrive through a
spread, a helper or a plugin, and the installed JSON reporter does not
serialise plugin servers. Collection (`--list`) and the report must still show
no `webServer`, and there is never a second server. The coordinator updates
the pin when it integrates a reviewed journey candidate.

### Settlement and the blocking receipt

**Process groups.** One supervisor owns every process group the run starts:
seed, build, scan, the app, each collection, each e2e runner and Playwright.
Each child is its own group and gets its own private `TMPDIR`
(`/tmp/nb02-XXXXXX`, 0700), which every descendant inherits. This follows
the coordinator's private-profile pattern: Playwright puts each browser
profile under it, and it stays short for Chromium's socket paths. The process
table is read with `ps -axwwE -o pid,ppid,pgid,command`. `-E` adds each of
this user's processes' environment, so a detached descendant still shows the
private path after its parent has gone. That text holds credentials. It never
leaves the table reader: only two flags are kept, "carries this child's
private path" and "is the app command on port 3646". A group counts as settled
only when all of these hold:

- the stop has returned. `run.mjs` sends the signals itself
  (`terminateProvenGroup`): SIGTERM, then SIGKILL after 5 s. Each signal,
  the SIGKILL escalation included, is sent only after a process table read
  immediately before it shows the group's every member proven this child's
  (`groupProof`). Otherwise the signal is withheld and the group is
  uncertain. `stack.mjs`'s `terminateGroup` is never used, because it
  escalates without looking again, and a group id that emptied after SIGTERM
  could be reused before its SIGKILL;
- the kernel then shows the group empty: `kill(-pgid, 0)` fails with ESRCH,
  checked by `run.mjs` itself;
- every escaped group this child owns is gone. Playwright starts each browser
  detached, in its own group. The table is read every second while the group
  lives and again at stop. It finds owned processes outside the group by
  current ancestry, or by the private path. The second catches a child that
  detached with its own stdio and lost its parent before any poll. Each such
  group is recorded in the receipt;
- any group, the child's own or an escaped one, is signalled only after a
  fresh table, read just before each signal, shows every one of its members
  proven owned. Proven owned means the child's leader while it is still this
  runner's own child (a live child's pid cannot be anyone else's), a process
  whose own environment holds the exact entry `TMPDIR=<its private path>`, or
  a current child of a proven process. The environment is separated from the
  arguments by comparing a plain `ps` read with the `ps -E` read, so a
  command that merely names a scratch path in its arguments (`tail`, `du`,
  `lsof`) is never proof. The broader match (the path anywhere in the text)
  is used only to find lingering processes, never to signal.
  Process groups 0 and 1 are never signalled. Sharing
  the child's group id proves nothing on its own, and a pid recorded earlier
  proves nothing by itself. Once the child's own group is proven empty, its id
  may be reused, so it is never signalled again.
  A group with any other member is "not proven this run's (mixed
  membership)". A group with no visible member is "not proven this run's".
  Both are left alone and uncertain, never killed;
- afterwards no process carries the child's private path. For the app, no
  `next start … --port 3646` command remains and nothing listens on 3646
  (`lsof`);
- its output has closed.

From a timeout or interrupt on, nothing more of the child is echoed while its
bounded stop decides. A report is accepted only if the file descriptor read is
the file at the verified path both before and after the read.

A group is uncertain, and the run fails, when the stop helper returns, throws
or hangs while members remain. Missing evidence (an unreadable process table
or `lsof`), ambiguous evidence (EPERM) and output that never closes are
uncertain too. Output that arrives after `app.log` has closed is dropped,
never a crash. A normal exit with a lingering descendant still stops and
checks the whole group before the result counts.

**Bounded settlement.** A child is never awaited past its timeout or an
interrupt. Its result is the bounded stop's verdict (stop helper, absence
probe, escaped groups, output), even when the helper refuses and the leader
never exits. Exit codes are 124 after a timeout and 130 after an interrupt.

When settlement is uncertain:

- the child's output is withheld: never returned, kept or shown;
- its streams are released, so the runner can still finish;
- nothing it wrote (collection, report) is read;
- no further phase, suite or child starts. `ensureActive` refuses once any
  group is uncertain, and the suite loop stops after an unsettled suite, so
  an unsettled journey never leads into the charters.

The run then writes only its own redacted `summary.json` and blocks the
receipt. Raw output stays unscrubbed in the private run directory, and the
uncertain children's private `TMPDIR`s stay for the coordinator. A settled
ordinary failure still writes its real failure summary and clears the
receipt.

**The one teardown.** `settle()` is the only teardown. It stops whatever
still runs and checks every group and its output. Then it makes a final sweep
of the process table, covering every private path of the run and the app
command, and of the app port's listeners. It removes the private `TMPDIR`s
only when the whole run settled.

**Interrupts.** On SIGINT or SIGTERM (`stack.onTerminate`), no phase, suite
or child starts again, and every owned group is stopped and checked within
the same bounds. The signal hook returns only after the run has settled and
finalised, or after its own deadline with the receipt blocked, so the lock
is released last. An interrupted run exits 130 and never qualifies.

**The receipt.** It lives at
`/tmp/nabalens-ws/spare6.b02-acceptance.receipt.json`, beside the canonical
lock.

- **Creation.** Under the lock, once the lane is clear (no blocker, no
  receipt, a proven lane root) and before any child starts, the run creates
  it exclusively (`O_EXCL`), privately (0600) and durably (file and directory
  fsync), without following links. It records:
  - the run id, lock label, runner pid, ppid, pgid, uid, host and node
    version;
  - the harness and candidate identities, the e2e identity and the run
    directory;
  - every owned group: role, pgid, command name, private `TMPDIR`, port
    (app), times, state, escaped groups and evidence.
- **Updates.** It is rewritten atomically as groups start and settle.
- **A settled run.** It removes its own receipt only when every group is
  proven gone.
- **Any uncertainty.** The receipt stays with `state: "blocked"` and its
  reasons. The artifacts are left unscrubbed for the coordinator, and the
  summary says why.
- **A dead runner.** If the runner dies first, the `in-progress` receipt
  stays.
- **Later runs.** Every later `check`, `seed` or `run` refuses `spare6` while
  any receipt (or link) is at that path, whatever its run id. Inspection,
  cleanup and clearance belong to the coordinator.

## Environment by child (names only)

You set `B02_CHECKOUT` (required, absolute) and, optionally, `B02_RUN_ID`.
Every child inherits only these: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`,
`LANG`, `LC_*`, `TERM` and the proxy variables. `TMPDIR` is always the child's
own private directory (see "Settlement"). The browser runners
also inherit `PLAYWRIGHT_BROWSERS_PATH`. Anything else is dropped, including
`DATABASE_URL`, Vercel tokens, the B01 per-venue lists, `CI`, `GIT_*` and
`B02_E2E_HOME`.

| Child | Gets |
| --- | --- |
| seed (`tsx seed.ts`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all three are needed, or the repository helper falls back to `supabase status` in the checkout), `E2E_DB_URL`, `E2E_ISOLATED_STACK=1`, `B02_CHECKOUT`, `B02_VIA_RUNNER=1`, `B02_STACK`, `APP_URL`, `B02_RUN_ID`, `B02_RUN_DIR` |
| `next build` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3646`, `NEXT_TELEMETRY_DISABLED=1`, the four `NABALENS_*=b02` switches. No server secret. |
| `scan-bundle.mjs` | `SUPABASE_SERVICE_ROLE_KEY` only (the value it searches the bundle for) |
| `next start` | the build's values plus `SUPABASE_SERVICE_ROLE_KEY` (admin and media routes) |
| e2e and Playwright collection (`list`, `--list`, locked or not) | `listEnv` only: fixed spare6 loopback `NEXT_PUBLIC_SUPABASE_URL` and a password-less `E2E_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY=list-only-placeholder`, `B02_LIST_ONLY=1`, `B02_RUN_ID=list-only`, `B02_SUITE`, `B02_STACK`, `APP_URL` and, for the charters, `B02_CHECKOUT`. No live credential and no run directory. |
| e2e run | `NEXT_PUBLIC_SUPABASE_URL` (target guard), `SUPABASE_SERVICE_ROLE_KEY` (fixture sign-in links), `E2E_DB_URL` (read-only read-back), `B02_SUITE`, `B02_STACK`, `APP_URL`, `B02_RUN_ID`, `B02_RUN_DIR`. No publishable key, JWT secret, `SUPABASE_DB_URL`, Mailpit or checkout path. |
| Playwright charters run | the e2e run values with `B02_SUITE=charters`, plus `B02_CHECKOUT` (the candidate's Playwright) and `PLAYWRIGHT_JSON_OUTPUT_FILE` |

The e2e config registers the service key and the DB URL as runner `secrets`,
so the runner redacts them wherever it writes. The model never sees them,
and no test fills them.

## Redaction and output

Every value `stack.mjs` holds is treated as a credential. That includes the
service key, the publishable key, the JWT secret, both DB URLs and a DB
password of 12 or more characters. A local default such as `postgres` is not
treated as a secret, but the whole URL is.

**Outgoing strings.** Every outgoing string is redacted against every
credential value this process has read, and only then cut to its bound, so
no cut can leave part of a secret. That covers console lines, validator
diagnostics, the summary's serialization, the receipt and the outer failure
message. Diagnostics are capped at 40 per suite, 400 characters each.

**Child output.** Child stdout and stderr, and `app.log`, are redacted line by
line as they stream. Output with no line breaks is cut so that no secret
spans a cut. Captured outputs (collection, scan) are bounded at 16 MiB.

**The scrub.** Only after every group has settled is every file under
`.results/<id>/` made private (dirs 0700, files 0600). Credential values in
text files are then replaced in place with `[redacted:<NAME>]`. The scrub
never follows a link. Each of these fails qualification, is listed in
`summary.json`, and is never rewritten:

- a value in a binary or non-UTF-8 file;
- any symlink;
- a file owned by another user;
- a file with other hard links;
- a special file.

If settlement is uncertain, the scrub is skipped and the run fails.

**The summary.** `summary.json` is created exclusively (`O_EXCL|O_NOFOLLOW`)
in the private run directory. A preexisting file or link there is never
followed or replaced: the run fails, and the link's target stays unchanged.

**Other output.** The seed journal scrubs helper error messages before
writing them. e2e and Playwright traces and videos are off, so browser cookies
and network headers are never recorded.

## Seed, journal and world

`run.mjs` creates `.results/<id>/world/world.journal.jsonl` exclusively. It
writes and fsyncs a header (run id, candidate, tree, digest, stack, app,
harness commit and tree, pid) and fsyncs the directory before the seed
process starts. `seed.ts` refuses to run unless that header is the only line
and names this run and candidate. Every step then appends these lines:

- an fsynced `intent` line before its first write, naming the tag, planned
  venue names, planned fixture emails, prefixes and ids it is about to
  change;
- `done` with the ids it created, or `failed` with a scrubbed message.

The step is `fixture.ts`'s `journalStep`. Anything a step begins happens
inside its callback, after the intent is on disk. That includes the
replacement identity's real sign-in, which runs inside the
"replacement submission" step, before `submit_coverage_photos`. Its intent
names the actor's id, and no credential is journalled.

`world.json` is written last, atomically (temp file, fsync, rename, directory
fsync), and a final `complete` line follows. If the seed fails or is
interrupted, the journal lists every tagged row that may exist.

The world contains:

- six venues: A, B, Solo, Staff, Layout and Recovery;
- 18 accounts: admin, 3 managers, 1 revoked manager, 9 staff and 4 layout
  personas;
- six active menus;
- five working lists: A, Solo, Staff, Layout and Recovery;
- the staff-era, revoked, waiting and unlabelled photos, plus 12 unlabelled
  photos per layout persona;
- `staffReplacement`'s open replacement request;
- the generated JPEGs (including the replacement photo) and the candidate's
  MP4.

The harness deletes nothing, and tagged DEV FIXTURE rows stay on the
disposable stack. The coordinator resets the whole stack later with
`node <checkout>/scripts/ci/stack.mjs reset spare6 --from <checkout>`. There
is no row deletion or shared reset here.

## Commands

Run these from this directory, using the project's Node. Node 24.18.0 was
used for the offline checks.

```sh
# Offline: guard tests and collection (no stack needed; nothing is contacted).
node --test run.test.mjs
B02_CHECKOUT=<checkout> node run.mjs list --require-all   # all 20, charters included

# Coordinator only, when it authorises the live run. The full preflight
# (owner, lane, verified DB + Storage backup, reset) is in the programme's
# B02 harness-ready evidence; in short, on a clean candidate checkout:
#   node <checkout>/scripts/ci/stack.mjs reset spare6 --from <checkout>
env -u NABALENS_WS_ROOT B02_CHECKOUT=<checkout> node run.mjs check
env -u NABALENS_WS_ROOT B02_CHECKOUT=<checkout> B02_RUN_ID=b02-c467-<yyyymmdd-hhmm> \
  node run.mjs run --build > <private-log> 2>&1
```
The exit code is 0 only when every selected suite passed, every group
settled, the artifact scrub is clean, the summary was written and no error
occurred. It is 130 after an interrupt and 1 otherwise. A blocked receipt is
printed with its path.

Outputs, all private, are under `.results/<id>/`:

- `world/` (journal, `world.json`, media)
- `app.log`
- `<suite>/` (e2e `report.json`, `summary.md`, artifacts)
- `charters/report.json` and `charters/test-results/`
- `summary.json`, which records these:
  - the candidate, the harness commit and tree, and the e2e identity;
  - `complete` and `qualification`;
  - each suite's verdict: exit, settlement, problems, reported and counted
    passes, agent-step counts, model calls and step tokens;
  - the build and scan evidence;
  - the settlement record;
  - the instance totals and the scrub.

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

## Budget gate (budget.mjs)

The 20 agentic cases do not measure the owner-approved phone budgets. `budget.mjs` is a separate gate on
the same pin and lane:

| Group | Case ID | Title (candidate `tests/e2e/upload-label-flow.spec.ts`) | Budget |
|---|---|---|---|
| e1-360 | `6ba767f6c311117e4d57-513ca76ffea133db7fb8` | `e1 @360: Add with one dish in at most 6 taps and 3 modals` | 6 taps, 3 modals (measured) |
| e1-412 | `6ba767f6c311117e4d57-849ee240b53576c8d092` | `e1 @412: …` | 6 taps, 3 modals (measured) |
| e2-360 | `6ba767f6c311117e4d57-f2e5dae724f391c4b5e1` | `e2 @360: batch of 3 with one exception in at most 9 taps and 3 modals` | 9 taps, 3 modals (measured) |
| e2-412 | `6ba767f6c311117e4d57-57ceccb41c1d3bd75143` | `e2 @412: …` | 9 taps, 3 modals (measured) |
| j5 | `6ba767f6c311117e4d57-02e1abfec4ac2e26ec31`, `6ba767f6c311117e4d57-03317c923f5c1c8517d2` | `d @360` and `d @412: known dish from Our menu in at most 2 taps and 1 modal (J5)` | 2 taps, 1 modal (asserted in the test) |

- It was derived from the coordinator's focused retest runner (sha256 `82673455…`). That runner was
  pinned to `abdb77f9`, to an older reset's `revision.json` hash and to a fixed output directory. This gate
  instead pins `candidate.json`, verifies spare6's current reset with `verifyProductInputs`, and records
  that reset's `revision.json` sha256. Each run writes to its own `.results/budget-…` directory.
- It reuses `run.mjs`'s guards rather than copying them: the lane, blocker and receipt checks, the lock
  owner check before every phase, `buildPhase` and `scanPhase`, the supervisor (proven-ownership signals
  only), the private output chain and the artifact scrub. Each group runs as one supervised child: the
  candidate's own Playwright with `playwright.config.ts`, project `chromium`, `--retries=0 --workers=1
  --forbid-only`. The candidate's web server serves the scanned build on 3646. The port must be free
  before and after each group.
- Measured groups must attach exactly one `<group>-taps-and-modals.json` from the candidate's
  `recordBudget`, read inside the group's private output, with the approved limits and within them.
- J5's `d` cases write no measurement (the spec does not call `recordBudget` for them). Their limits are
  `expect`s inside the test, so J5 evidence is that both cases ran once and passed. `d` sits in a serial
  file, but it depends only on the file's `beforeAll`: `provisionCoverageWorld()`, `world.staffA` and The
  Railway menu imported for venue 1. Each `d` uploads and checks its own new photo. Cases `a1` to `c`
  create nothing `d` reads, so no predecessor runs as setup.
- `node budget.mjs list` collects the six IDs with placeholder values; it contacts no stack. `check` runs
  the guards only. `run` takes the lock and needs the coordinator's authorisation and a fresh reset.
## Offline checks run for this commit

- `node --test run.test.mjs`: 87 of 87 passed, none skipped (Node 24.16.0).
  They used temporary git repos, fake `psql`, fake `supabase status`
  answers, fake e2e, Playwright, `next` and scanner executables, a fake stack
  object, injected process tables and listeners, and short-lived local
  process groups. One test uses the real `ps -E` reader and real signals on
  its own short-lived group (it is skipped where `ps -E` is unavailable).
  `check`'s refusal test reads the real lane root and guard paths with
  `lstat` only.
- `B02_CHECKOUT=<clean c4671823 checkout> node run.mjs list --require-all`:
  exit 0, 20 of 20 collected (4 + 8 + 2 + 1x4 + 2), e2e 0.16.0, the
  candidate's Playwright 1.64.1, with listEnv's placeholders only.
- Not run: `tsc` and `eslint`, and Prettier (this worktree has no
  `node_modules`, and the repository's Prettier config needs its Tailwind
  plugin). Only `.mjs` and JSON files changed.
## Limitations

- Nothing was executed against a DB, app, browser, model or the real
  `spare6` lock. These all remain for the coordinator's run:
  - the seed helper calls, including the replacement request and the
    department updates;
  - the build and the real bundle scan;
  - the app;
  - all 20 instances;
  - `db.groupFor` against the real function;
  - the scrub's behaviour on real artifacts.
- A descendant that detaches and loses its parent is found by its private
  `TMPDIR` in `ps -E`, or by a Chromium profile under it. A process that clears
  its whole environment and carries no such path in its arguments is not
  found that way. It is still caught as output that never closes, if it kept
  the pipe, but not if it closed its stdio as well. Most offline tests inject
  the process table and listeners, because the machine's real ports are not
  this run's. The fresh `supabase status` and the physical `/tmp` chain run
  only in the coordinator's environment.
- A process that clears its environment and leaves this child's group is not
  proven this run's, so a signal to its group is withheld and the run is
  uncertain (receipt blocked) rather than killing something unproven. macOS
  hides the environment of platform binaries (`/bin/sh`, `sleep`) from
  `ps -E`, so such a process is provable only through ancestry. Playwright's
  Chromium (build 1248, ad-hoc signed) and Node do show it: a real headless
  Chromium launched with a marker `TMPDIR` had all four browser processes
  proven.
- Accepted residual risks: the lane blocker is checked before each phase,
  not during a suite (up to 30 minutes later). A process group could empty and
  its id be reused in the instant between the `ps` proof and the signal. The
  receipt identity check (inode) cannot stop the same user deliberately
  replacing it. Only the same user can race the lane directory.
- Fixture sign-in mints a local magic-link token with the service key and
  posts it to the app's real `/auth/confirm/verify`. Inbox delivery and
  interactive sign-in are outside the run.
- The viewports are Chromium emulation. Physical handset, camera handoff,
  VoiceOver and TalkBack are separate device gates.
- The charters must import Playwright through `candidatePlaywrightTest()` (or
  an equivalent absolute import from `B02_CHECKOUT`). Collecting them needs
  `B02_CHECKOUT` set.
