# Journey evidence records

One folder per journey run that counts, named
`<UTC date>-<short commit>-<label>/`. A record says what a run on one commit
showed. It is not carried forward: a historical failure is resolved only by a
passing run on the current HEAD, so a new HEAD needs a new record.

```
<date>-<commit>-<label>/
  record.md           generated: commit, branch, dirty flag, stack and migrations
                      digest, runner versions, journeys, per-id results, historical
                      verdicts
  summary.json        copied unchanged from the run
  summary.md          copied unchanged from the run
  journeys/<id>.json  copied unchanged, one per journey
```

## What counts

- The run used a clean tree (`dirty: false`) on one commit. The writer refuses a
  dirty run.
- The run directory passes `pnpm journeys validate <dir>`.
- `pass` needs a deterministic assertion. `unavailable` is never a pass and is
  listed with its reason. A model judgement is evidence only.
- A historical journey asserts the correct behaviour. `fail` with
  `reproducedOnHead: true` means the finding reproduces on that commit. For an
  observation (O1 to O5) it means **the observation reproduced**, not that a bug
  was found.

## What is not kept

Logs, screenshots, traces, videos and runner session files stay in the gitignored
`.artifacts/` folder. The `evidence` paths inside the copied JSON point there, so
`pnpm journeys validate` on a record folder reports them missing. That is
expected. The writer also refuses any file that looks like a key or token.

## Writing a record

```sh
pnpm journeys run --all --stack ws1 --app-port 3647 --allow-unavailable
node tests/journeys/evidence-record.mjs .artifacts/journeys/<run-id> --label <slug>
```

`--label` is lowercase kebab-case (for example `final-all-journeys`).
`--note "<text>"` adds a paragraph under the header table, for context the result
files do not hold. The per-id table comes from `docs/qa/acceptance-ids.md`, so
update the catalogue first (the coverage test in `tests/unit/` checks that the
catalogue and the declarations agree).

Commit the record on its own, after the code under test, so the record's commit
is the code that ran. Application code is unchanged by the record commit itself.
