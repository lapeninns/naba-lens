#!/usr/bin/env node
// Journey command line (pnpm journeys ...). Run it from the worktree under test.
//
//   pnpm journeys list
//   pnpm journeys run <id|glob>... [--all] [--stack ws1] [--allow-unavailable]
//                     [--skip-build] [--ignore-migration-drift]
//                     [--run-id <id>] [--results-dir <dir>]
//   pnpm journeys validate <results-dir>
//
// Exit codes: 0 every selected journey passed (or the only non-passes are
// unavailable and --allow-unavailable was given); 1 at least one journey failed
// or the harness output was invalid; 2 usage or declaration error; 3 no journey
// failed but some were unavailable.
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

import { loadJourneys, selectJourneys } from "./registry.mjs"
import { runJourneys } from "./run.mjs"
import { validateRunDir } from "./validate.mjs"

const USAGE = `usage: pnpm journeys <list|run|validate> ...
  list                                       declared journeys (tests/journeys/**/*.journey.json)
  run <id|glob>... | --all                   run journeys against a stack; writes .artifacts/journeys/<run-id>/
      --stack <name>                         ws1 (default), ws2, gate, spare4..9; or NABALENS_STACK
      --allow-unavailable                    exit 0 when the only non-passes are unavailable
      --agentic                              also run declared agentic (e2e) steps; evidence only, unavailable without model credentials
      --app-port <port>                      port the app is served on (default: the stack's, e.g. 3641 for ws1); give each concurrent run its own
      --no-stack-lock                        do not serialize with other runs/resets on the stack (only for journeys that provision their own identities)
      --lock-timeout <seconds>               how long to wait for the stack lock (default 1800)
      --skip-build                           reuse .next when it was built for this stack and tree
      --ignore-migration-drift               run even if the stack's migrations differ from this worktree
      --run-id <id> / --results-dir <dir>
  validate <results-dir>                     check a run directory against the result schema`

function parseArgs(argv) {
  const positional = []
  const flags = {}
  const valued = new Set([
    "stack",
    "app-port",
    "lock-timeout",
    "run-id",
    "results-dir",
  ])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) positional.push(arg)
    else {
      const [key, inline] = arg.slice(2).split("=", 2)
      flags[key] = inline ?? (valued.has(key) ? argv[++i] : true)
    }
  }
  return { positional, flags }
}

function fail(message, code = 2) {
  console.error(message)
  process.exit(code)
}

const { positional, flags } = parseArgs(process.argv.slice(2))
const [command, ...rest] = positional
const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
})
const root = top.status === 0 ? top.stdout.trim() : process.cwd()

if (command === "validate") {
  const dir = rest[0] ?? fail(USAGE)
  const { errors, results } = validateRunDir(resolve(dir))
  if (errors.length) fail(errors.map((e) => `invalid: ${e}`).join("\n"), 1)
  console.log(`valid: ${results.length} journey result(s) in ${resolve(dir)}`)
} else if (command === "list" || command === "run") {
  const { journeys, problems } = loadJourneys(root)
  if (problems.length)
    fail(
      `Journey declarations are invalid:\n${problems.map((p) => `  ${p}`).join("\n")}`
    )
  if (command === "list") {
    for (const j of journeys) {
      console.log(
        `${j.id.padEnd(34)} ${j.projects.join(",").padEnd(16)} ${j.scenarios.join(",").padEnd(18)}${j.historical ? " [historical " + j.historical.id + "]" : ""} ${j.title}`
      )
    }
    console.log(`${journeys.length} journey(ies)`)
  } else {
    if (!rest.length && !flags.all)
      fail(
        `run needs journey ids, a glob such as "menus.*", or --all.\n${USAGE}`
      )
    const { selected, unknown } = selectJourneys(
      journeys,
      rest,
      Boolean(flags.all)
    )
    if (unknown.length)
      fail(
        `No declared journey matches: ${unknown.join(", ")}. Try: pnpm journeys list`
      )
    const stack = flags.stack ?? process.env.NABALENS_STACK ?? "ws1"
    const appPort =
      flags["app-port"] === undefined ? null : Number(flags["app-port"])
    if (
      appPort !== null &&
      !(Number.isInteger(appPort) && appPort >= 1024 && appPort <= 65535)
    )
      fail(
        `--app-port must be an integer from 1024 to 65535, got "${flags["app-port"]}".`
      )
    const run = await runJourneys({
      root,
      journeys: selected,
      stack,
      flags: {
        allowUnavailable: Boolean(flags["allow-unavailable"]),
        skipBuild: Boolean(flags["skip-build"]),
        appPort: appPort ?? undefined,
        noStackLock: Boolean(flags["no-stack-lock"]),
        lockTimeout: Number(flags["lock-timeout"] ?? 1800),
        agentic: Boolean(flags.agentic),
        ignoreMigrationDrift: Boolean(flags["ignore-migration-drift"]),
      },
      runId: flags["run-id"],
      resultsDir: flags["results-dir"],
    }).catch((error) =>
      error.code === "RUN_DIR_EXISTS"
        ? fail(error.message, 2)
        : Promise.reject(error)
    )
    const { summary, resultsDir, exitCode } = run
    console.log(
      `\nJourney run ${summary.runId} on stack ${stack} at ${summary.revision.commit.slice(0, 7)}${summary.revision.dirty ? " (dirty)" : ""}`
    )
    for (const j of summary.journeys) {
      console.log(
        `  ${j.result.toUpperCase().padEnd(12)} ${j.journey}${j.reason ? `  - ${j.reason}` : ""}`
      )
    }
    console.log(
      `Totals: ${summary.totals.pass} pass, ${summary.totals.fail} fail, ${summary.totals.unavailable} unavailable`
    )
    console.log(`Results: ${resultsDir}`)
    if (exitCode === 3)
      console.log(
        "Exit 3: unavailable journeys are not passes (use --allow-unavailable to accept them)."
      )
    process.exit(exitCode)
  }
} else {
  fail(USAGE)
}
