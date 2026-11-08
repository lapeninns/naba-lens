#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { isAbsolute, join, relative, resolve } from "node:path"
import { homedir } from "node:os"
import { transition } from "./policy.mjs"

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim()
const root = git("rev-parse", "--show-toplevel")
process.chdir(root)
const branch = git("branch", "--show-current")
const key = createHash("sha256")
  .update(branch || "detached:" + git("rev-parse", "HEAD"))
  .digest("hex")
  .slice(0, 24)
const directory = join(
  resolve(root, git("rev-parse", "--git-common-dir")),
  "verification",
  key
)
mkdirSync(directory, { recursive: true, mode: 0o700 })
const stateFile = join(directory, "batch.json"),
  ledger = join(directory, "events.jsonl")
function context() {
  const head = git("rev-parse", "HEAD"),
    tree = git("rev-parse", "HEAD^{tree}")
  const status = git("status", "--porcelain", "--untracked-files=normal")
  const digest = createHash("sha256")
    .update(head)
    .update(git("diff", "--binary", "HEAD"))
  for (const path of git("ls-files", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(Boolean)) {
    const info = lstatSync(path)
    if (!info.isFile() && !info.isSymbolicLink())
      throw Error("Cannot fingerprint non-file source")
    if (info.size > 16 * 1024 * 1024)
      throw Error(
        "Move large private artifacts outside source before verification"
      )
    digest
      .update(path)
      .update(info.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))
  }
  return {
    head,
    tree,
    clean: !status,
    workingDigest: digest.digest("hex"),
    node: process.version,
    environmentDigest: createHash("sha256")
      .update(JSON.stringify(Object.entries(process.env).sort()))
      .digest("hex"),
  }
}
function save(path, value) {
  const temporary = path + ".writing-" + randomUUID()
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  })
  renameSync(temporary, path)
}
function record(event) {
  appendFileSync(
    ledger,
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    { mode: 0o600 }
  )
}
function load() {
  if (!existsSync(stateFile)) throw Error("Start a finite batch first")
  return JSON.parse(readFileSync(stateFile, "utf8"))
}
function positionalPath(path, prefix) {
  if (!path || isAbsolute(path) || path.startsWith("-") || !existsSync(path))
    throw Error("Use existing explicit relative file paths")
  const canonical = realpathSync(path),
    local = relative(root, canonical)
  if (
    local.startsWith("..") ||
    isAbsolute(local) ||
    (prefix && !prefix.test(local))
  )
    throw Error("File is outside the allowed check scope")
  return local
}
function focused(args) {
  const before = context(),
    kind = args.shift()
  let command = "pnpm",
    commandArgs
  if (kind === "unit") {
    if (!args.length)
      throw Error(
        "Select test files; full-suite iteration is not a focused check"
      )
    commandArgs = [
      "exec",
      "vitest",
      "run",
      "--project",
      "unit",
      ...args.map((p) =>
        positionalPath(
          p,
          /^tests\/(unit|ui|media|upload)\/.+\.test\.[cm]?[jt]sx?$/
        )
      ),
    ]
  } else if (kind === "lint") {
    if (!args.length) throw Error("Select changed source files")
    commandArgs = [
      "exec",
      "eslint",
      ...args.map((p) => positionalPath(p, /\.[cm]?[jt]sx?$/)),
    ]
  } else if (kind === "types" && !args.length) commandArgs = ["typecheck"]
  else if (kind === "tooling" && !args.length) {
    command = process.execPath
    commandArgs = [
      "--test",
      ...readdirSync("scripts/verification")
        .filter((p) => p.endsWith(".test.mjs"))
        .map((p) => "scripts/verification/" + p),
      "scripts/ci/common-receipt.test.mjs",
    ]
  } else if (kind === "browser") {
    const project = args.shift()
    if (
      !["chromium", "mobile-chromium", "firefox", "webkit"].includes(project) ||
      !args.length
    )
      throw Error("Select one browser project and explicit spec files")
    commandArgs = [
      "exec",
      "playwright",
      "test",
      "--project",
      project,
      ...args.map((p) => positionalPath(p, /^tests\/e2e\/.+\.spec\.[jt]s$/)),
    ]
  } else
    throw Error(
      "Use unit <files>, lint <files>, types, tooling, or browser <project> <spec files>"
    )
  const childEnv = { ...process.env }
  // Node deliberately suppresses nested node --test execution when this internal
  // harness marker leaks into a child. An invoked check must actually execute.
  delete childEnv.NODE_TEST_CONTEXT
  const started = Date.now(),
    result = spawnSync(command, commandArgs, {
      stdio: "inherit",
      env: childEnv,
    }),
    after = context()
  const passed =
    result.status === 0 && before.workingDigest === after.workingDigest
  record({
    type: "focused",
    kind,
    command: [command, ...commandArgs],
    context: before,
    durationMs: Date.now() - started,
    passed,
    sourceChangedDuringCheck: before.workingDigest !== after.workingDigest,
  })
  process.exitCode = passed ? 0 : 1
}
function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }))
}
function release() {
  const started = Date.now()
  let s = load()
  const before = context()
  const remote = gh([
    "pr",
    "view",
    String(s.pr),
    "--repo",
    "lapeninns/naba-lens",
    "--json",
    "headRefOid",
  ])
  if (remote.headRefOid !== before.head)
    throw Error(
      "PR head is not the frozen local candidate; push the completed batch once before qualification"
    )
  s = transition(s, { type: "qualify" }, before)
  save(stateFile, s)
  record({ type: "qualification-start", head: before.head, pr: s.pr })
  // No shell, alternate runner, --force, --only, profile rewrite, merge or gate bypass.
  const result = spawnSync(
    join(homedir(), ".local/bin/lci"),
    ["run", "naba-lens", "--pr", String(s.pr), "--post", "--comment"],
    { stdio: "inherit" }
  )
  let passed = false
  try {
    const pr = gh([
      "pr",
      "view",
      String(s.pr),
      "--repo",
      "lapeninns/naba-lens",
      "--json",
      "headRefOid,statusCheckRollup",
    ])
    passed =
      result.status === 0 &&
      pr.headRefOid === before.head &&
      pr.statusCheckRollup.some(
        (c) => c.context === "local-ci/result" && c.state === "SUCCESS"
      )
  } catch {
    /* Unknown result is blocked, never automatically retried. */
  }
  s = transition(
    s,
    {
      type: "result",
      passed,
      at: new Date().toISOString(),
      evidence: `https://github.com/lapeninns/naba-lens/pull/${s.pr}`,
    },
    context()
  )
  save(stateFile, s)
  record({
    type: "qualification-result",
    phase: s.phase,
    head: before.head,
    durationMs: Date.now() - started,
  })
  console.log(JSON.stringify(s, null, 2))
  process.exitCode = s.phase === "qualified" ? 0 : 1
}
function main(args) {
  const command = args.shift()
  if (command === "focused") return focused(args)
  if (command === "status") {
    const events = existsSync(ledger)
      ? readFileSync(ledger, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : []
    const summary = events.reduce(
      (sum, e) => {
        if (e.type === "focused") {
          sum.focusedRuns++
          sum.focusedMs += e.durationMs
          if (!e.passed) sum.failedOrStaleFocusedRuns++
        }
        if (e.type === "qualification-result") {
          sum.qualifications++
          sum.qualificationMs += e.durationMs ?? 0
        }
        return sum
      },
      {
        scope: "all recorded events on this branch",
        focusedRuns: 0,
        focusedMs: 0,
        failedOrStaleFocusedRuns: 0,
        qualifications: 0,
        qualificationMs: 0,
      }
    )
    console.log(
      JSON.stringify(
        {
          branch,
          batch: existsSync(stateFile) ? load() : null,
          summary,
          ledger,
          context: context(),
        },
        null,
        2
      )
    )
    return
  }
  if (!branch || branch === "main")
    throw Error(
      "Batch control belongs on the named delivery branch, not main or a detached worker checkout"
    )
  if (command === "start") {
    const [name, pr, ...tasks] = args
    if (
      !name ||
      !/^\d+$/.test(pr ?? "") ||
      Number(pr) < 1 ||
      !tasks.length ||
      tasks.some((t) => !/^[a-z0-9][a-z0-9-]{1,70}$/.test(t))
    )
      throw Error("Use start <batch-name> <PR-number> <task-id>...")
    if (existsSync(stateFile)) {
      const old = load()
      if (old.phase !== "closed")
        throw Error(
          "A batch is already open; finish it or document a blocking repair"
        )
      save(join(directory, `closed-${Date.now()}.json`), old)
    }
    save(stateFile, {
      version: 1,
      name,
      pr: Number(pr),
      phase: "implementation",
      tasks: [...new Set(tasks)],
      completed: [],
      repairs: [],
      attempts: [],
    })
    record({ type: "batch-start", name, tasks })
    return
  }
  if (command === "release" && !args.length) return release()
  if (command === "reconcile" && !args.length) {
    const s = load()
    if (s.phase !== "qualifying")
      throw Error("Only an unresolved qualification can be reconciled")
    const pr = gh([
      "pr",
      "view",
      String(s.pr),
      "--repo",
      "lapeninns/naba-lens",
      "--json",
      "headRefOid,statusCheckRollup",
    ])
    const gate = pr.statusCheckRollup.find(
      (c) => c.context === "local-ci/result"
    )
    if (!gate || !["SUCCESS", "FAILURE", "ERROR"].includes(gate.state))
      throw Error(
        "The real gate is still pending or unknown; no retry is authorized"
      )
    const next = transition(
      s,
      {
        type: "result",
        passed: gate.state === "SUCCESS" && pr.headRefOid === s.candidate.head,
        at: new Date().toISOString(),
        evidence: `https://github.com/lapeninns/naba-lens/pull/${s.pr}`,
      },
      context()
    )
    save(stateFile, next)
    record({ type: "qualification-reconciled", phase: next.phase })
    console.log(JSON.stringify({ phase: next.phase }))
    return
  }
  const allowed = { complete: 1, integrate: 0, freeze: 2, repair: 2, close: 0 }
  if (!(command in allowed) || args.length !== allowed[command])
    throw Error(
      "Use complete <task>, integrate, freeze <reviewed-head> <review-evidence-ref>, repair <task> <blocking-reason>, close, release, status, or focused"
    )
  const action = {
    type: command,
    task: args[0],
    reason: args[1],
    reviewHead: args[0],
    review: args[1],
  }
  const s = transition(load(), action, context())
  save(stateFile, s)
  record({ type: "batch-transition", action, phase: s.phase })
  console.log(JSON.stringify({ phase: s.phase, candidate: s.candidate }))
}
let locked = false
try {
  if (process.argv[2] !== "status") {
    const lock = join(directory, "lock")
    if (process.argv[2] === "reconcile" && existsSync(lock)) {
      const pid = Number(readFileSync(join(lock, "pid"), "utf8"))
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw Error(
          "Invalid lock owner; inspect the private lock before recovery"
        )
      try {
        process.kill(pid, 0)
        throw Error("The qualification owner is still running")
      } catch (error) {
        if (error.code !== "ESRCH") throw error
      }
      rmSync(lock, { recursive: true })
    }
    mkdirSync(lock)
    writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 })
    locked = true
  }
  main(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (locked) rmSync(join(directory, "lock"), { recursive: true })
}
