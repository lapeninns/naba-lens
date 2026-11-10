# B01 agentic acceptance (candidate a41cc6b4)

A standalone e2e-runner harness for the B01-07 knowledge path. It covers exact
candidate `a41cc6b41562be4ff3717102d1dd0c35a117d2eb` on the coordinator-owned
`spare6` stack only. It lives outside the application. Nothing here changes
app code, tests or manifests, and it is not meant to be merged.

## Files

| File | Role |
| --- | --- |
| `run.mjs` | Entry point: guards, `spare6` lock, seed, bounded app start and stop, e2e invocation, summary |
| `seed.ts` | Creates one disposable world with the repository's own helpers (`tests/e2e/helpers/amenities-world.ts`, `stack.ts`) |
| `fixture.ts` | Target guards, world loading, fixture sign-in, read-only DB read-back and copy helpers |
| `e2e.config.ts` | Runner config. `B01_SUITE` selects one suite, which writes to `.results/<B01_RUN_ID>/<suite>/` |
| `journey.e2e.ts` | Desktop 1280x800: eight serial tests, one `agent.act` with assertions right after it |
| `narrow.e2e.ts` | Phone 390x844: home list and sticky-dock send, overflow checks, one vision `agent.assert` |
| `reader.e2e.ts` | Internal reader over real HTTP (`GET /api/knowledge/v1/venues/{id}/answers`) |

## Coverage

| B01-07 path | Where |
| --- | --- |
| Enabled four-key working list, unassigned contribution | journey 1, narrow |
| Couldn't establish, with no scored credit (no `amenity_submissions` row) | journey 2 |
| Saved versus sent (draft on Home and Me, finish, send) | journey 2 |
| Straightforward answer becomes the current state (`agent.act`) | journey 3 |
| Sensitive claim waits for manager confirmation, then is confirmed | journey 4, 5 |
| Conflicting change report, then resolved by "keep the answer in use" | journey 6 |
| Own history for each staff member | journey 7 |
| Explicit manager self-confirmation | journey 8 |
| Narrow viewport | narrow |
| Reader HTTP outcomes, plus 401 without a credential | reader |

Uploads, public providers, the Wi-Fi question content and staff contact are
out of scope.

## Prerequisites (coordinator)

1. Use a clean checkout at the candidate with installed `node_modules`
   (`next`, `tsx`). `run.mjs` refuses any other HEAD and any tracked change.
2. Bring `spare6` up and reset it from that checkout:
   `node <checkout>/scripts/ci/stack.mjs reset spare6 --from <checkout>`.
   `run.mjs` refuses a stopped stack, a project other than
   `nabalens-ws-spare6`, or a `revision.json` that does not show the clean
   candidate.
3. Port 3646 (or `B01_APP_PORT`) must be free. The harness starts its own
   app and never reuses one already running.
4. The standalone e2e installation must be at `$HOME` (`~/node_modules/.bin/e2e`),
   with its saved ChatGPT subscription login (`chatgpt('gpt-6-luna')`, as in
   `~/e2e.config.ts`). Do not add packages or change authentication.
5. No other job may need `spare6` for the length of the run.

## Environment (names only)

- Set by you: `B01_CHECKOUT` (required, absolute), and optionally
  `B01_RUN_ID`, `B01_APP_PORT` and `B01_E2E_HOME`. `NABALENS_WS_ROOT` must be
  unset; `run.mjs` refuses to start if it is inherited, so the lock and workdir
  are always spare6's canonical `/tmp/nabalens-ws/spare6`.
- Derived by `run.mjs` from `stack.mjs stackEnv(spare6)`, held in memory and
  passed only to child processes: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `E2E_DB_URL`, `SUPABASE_DB_URL`, `SUPABASE_JWT_SECRET`, `MAILPIT_URL`,
  `E2E_SUPABASE_WORKDIR`, `NEXT_PUBLIC_SITE_URL`.
- Also set by `run.mjs`: `E2E_ISOLATED_STACK=1`, `B01_STACK=spare6`,
  `APP_URL=http://127.0.0.1:3646`, `B01_RUN_DIR`, `B01_SUITE`,
  `B01_VIA_RUNNER` (seed only), `B01_READER_APP=1`, and on the app process
  only, `KNOWLEDGE_READER_ENABLED=true` and `KNOWLEDGE_READER_CONSUMERS`
  (digests only).

The config passes the service key and reader credential to the runner as
redacted `secrets`. Neither is ever filled into the page or shown to the model.

## Commands

Run all commands from this directory.

```bash
# Collection only: fixed loopback values and a placeholder key, starts nothing
node run.mjs list

# Guards only: candidate, stack, project, revision, migrations, loopback env, free port
B01_CHECKOUT=<checkout> node run.mjs check

# Full run: lock, recheck, seed, build with spare6 env, start app, journey -> narrow -> reader, stop
B01_CHECKOUT=<checkout> B01_RUN_ID=b01-acc-1 node run.mjs run --build

# Offline guard tests (no stack, app, browser or network)
node --test run.test.mjs
```

`NEXT_PUBLIC_*` values are baked into the client bundle at build time, so
`run` requires `--build` and always builds the candidate with spare6's env.
There is no reuse-build path.

The guards require the checkout at the candidate with no tracked changes, and
spare6 running as `nabalens-ws-spare6` in its canonical workdir. Its last
`stack.mjs` reset must come from this checkout at the clean candidate,
`status.migrations.matchesRecordedFiles` must be `true`, and the recorded
migrations digest must equal the digest of the candidate commit's
`supabase/migrations` (and of the checkout's copy). `run` and `seed` repeat
every guard and the free-port check inside the held lock, immediately before
seeding.

## Lock and bounds

`run` and `seed` hold `spare6`'s own lock (`/tmp/nabalens-ws/spare6.lock`) through
`stack.mjs withLock`, the same lock `stack.mjs reset`/`up`/`down` take. They
wait 60 s and then fail rather than queue. They never remove a live owner's
lock. The seed is limited to 180 s, the build to 900 s, app readiness
(`/login`) to 180 s and each suite to 30 min. Every child runs in its own
process group. Timeout, SIGINT and SIGTERM stop the children (the app last),
and then the lock is released. A step returns only after any stop of its own
group has finished, and nothing is signalled when a spawn fails. The app is
always stopped in a `finally`.

## Output

Results go under `.results/<B01_RUN_ID>/` (gitignored):

- `world/world.json` and `world/world.partial.json`: ids, names and emails of
  the created fixtures (mode 600).
- `world/reader-consumers.json`: the digest registry. `world/reader-credential`
  holds the bearer for this world only (mode 600; do not copy it into reports).
- `world/app.log` and `world/summary.json` (exit code per suite).
- `<suite>/`: the e2e `list` and `markdown` reports and screenshots. Read
  `<suite>/report.json` for per-test status. The reader suite **skips** (pending,
  never a pass) when the app lacked the seeded registry.

## Cleanup (owned rows only)

Each run creates exactly one world, tagged with the 6-character `tag` in
`world.json`. It contains the two venues and six accounts that
`provisionAmenitiesWorld()` creates (ids and names in `world.json`), their checks, contributions, drafts and submissions, a
venue A completion target for the current London month, and a reader consumer
that exists only in the run's files and the app process's env.

- The repository has no row-level fixture teardown, and knowledge history is
  append-only. This harness therefore issues **no DELETE**. Leaving the
  tag-scoped rows on the disposable stack is the supported state.
- To remove them, the coordinator resets the whole stack, which is
  coordinator-owned:
  `node <checkout>/scripts/ci/stack.mjs reset spare6 --from <checkout>`.
  This removes every fixture row on `spare6` and touches no other stack.
  Run it only when no other job is using `spare6`.
- Local files: delete `.results/<B01_RUN_ID>/` once the evidence is archived.
  The reader credential is unusable after the app stops, because the registry
  only ever existed in that process's env, and it expires 24 h after seeding.

## Limitations

- Prepared only. **Zero browser journeys have been executed.** Only
  `node run.mjs list` collection and static checks have run.
- Copy, roles and resolver fields asserted by the tests were taken from the
  candidate's source and have not been observed on a running app. Treat the
  first run's failures as possible harness errors until they are triaged.
- Journey tests are serial and share one world, so a failure early in the run
  cascades. Reader expectations depend on the journey having passed.
- `agent.act` and `agent.assert` need the standalone installation's saved
  ChatGPT login. Model listing does not prove that login. Only an executed
  agent step does.
- Sign-in uses GoTrue `admin/generate_link` with the stack's service key, and
  the app's own `/auth/confirm/verify`, as `tests/e2e/helpers/world.ts` does.
  It is not the emailed-link UI.
- The completion target row is inserted through the repository's `psql`
  helper, as `tests/security/knowledge-credit.test.ts` does.
- `list` validates selection and config only. It does not run `world()`, the
  database or the app.
