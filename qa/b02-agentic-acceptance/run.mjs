#!/usr/bin/env node
// B02 agentic acceptance runner (README.md). Node only, no dependencies of its
// own: the stack lock, env and process-group helpers come from the candidate
// checkout's scripts/ci/stack.mjs, the seed runs with the checkout's tsx, the
// app is the checkout's `next start`, and the tests run on the standalone e2e
// installation in $HOME. The design is the B01 harness's
// (qa/b01-agentic-acceptance): the same guards, canonical spare6 lock,
// per-run world, child-group settlement and locked environment refresh.
//
//   node run.mjs list                        collect every suite (starts nothing)
//   node run.mjs check                       guards only, no lock, no writes
//   node run.mjs seed                        lock, guards, seed one world
//   node run.mjs run --build [--suites a,b]  lock, guards, seed, build, app, e2e, stop
//
// `run` always builds: the bundle must come from the pinned candidate with
// spare6's NEXT_PUBLIC_* env, and nothing here can prove an existing .next did.
// The only accepted head is candidate.json; the caller cannot choose another.
// Env: B02_CHECKOUT (the candidate checkout, required except for list),
// B02_RUN_ID (optional), B02_E2E_HOME (optional, default $HOME).
// NABALENS_WS_ROOT must be unset. Nothing here prints a key, token or cookie.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HARNESS = dirname(fileURLToPath(import.meta.url))

/** candidate.json, validated: the one head, tree and migration set accepted. */
export function loadPin(file = join(HARNESS, "candidate.json")) {
  const pin = JSON.parse(readFileSync(file, "utf8"))
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? "")) fail("candidate.json commit must be a full SHA.")
  if (!/^[0-9a-f]{40}$/.test(pin.tree ?? "")) fail("candidate.json tree must be a full SHA.")
  if (!/^[0-9a-f]{64}$/.test(pin.migrationsDigest ?? "")) fail("candidate.json migrationsDigest must be sha256 hex.")
  if (!Number.isInteger(pin.migrationCount) || pin.migrationCount < 1) fail("candidate.json migrationCount must be a count.")
  if (!/^\d{14}$/.test(pin.latestMigration ?? "")) fail("candidate.json latestMigration must be a migration version.")
  return Object.freeze({ ...pin })
}

/** spare6 as scripts/ci/stack.mjs names it (block 646). Nothing else is accepted. */
export const STACK = Object.freeze({
  name: "spare6",
  project: "nabalens-ws-spare6",
  workdir: "/tmp/nabalens-ws/spare6",
  apiPort: 64621,
  dbPort: 64622,
  mailpitPort: 64624,
  appPort: 3646,
})
// Serial order: each suite has its own personas in the one world, so a
// failure in one does not cascade into another.
export const SUITES = ["staff", "manager", "recovery", "layout"]
// The four B02 UI switches (lib/config/*), server-side, on for build and app.
export const B02_SWITCHES = Object.freeze({
  NABALENS_HOME_LAYOUT: "b02",
  NABALENS_CONTRIBUTION_ENTRY: "b02",
  NABALENS_MY_CONTRIBUTIONS: "b02",
  NABALENS_MANAGER_TRIAGE: "b02",
})
// Inherited variables a child may see. Everything else (another stack's
// Supabase URL or keys, a production DATABASE_URL, Vercel tokens, the B01
// per-venue rollback lists) is dropped rather than overridden.
export const INHERITED = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]
const CONFIG = join(HARNESS, "e2e.config.ts")
const E2E = join(process.env.B02_E2E_HOME ?? homedir(), "node_modules", ".bin", "e2e")
const APP = `http://127.0.0.1:${STACK.appPort}`
const LOCK_SECONDS = 60
const SEED_MS = 300_000
const BUILD_MS = 900_000
const READY_MS = 180_000
const SUITE_MS = 1_800_000

export function fail(message) {
  throw new Error(message)
}
const say = (message) => console.log(`b02: ${message}`)

/** stack.mjs reads NABALENS_WS_ROOT at import; an inherited one would move the lock and workdir. */
export function requireCanonicalRoot(env = process.env) {
  if (env.NABALENS_WS_ROOT !== undefined) {
    fail("NABALENS_WS_ROOT is set; unset it so spare6's canonical lock and workdir are used.")
  }
}

export function parse(argv) {
  const [command, ...rest] = argv
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith("--")) fail(`Unexpected argument ${arg}.`)
    const key = arg.slice(2)
    if (!["build", "suites", "reuse-build"].includes(key)) fail(`Unknown flag --${key}.`)
    flags[key] = key === "suites" ? rest[++i] ?? fail("--suites needs a value.") : true
  }
  if (command === "run" && (flags["reuse-build"] || !flags.build)) {
    fail("run needs --build: the bundle is built for the candidate with spare6's env on every run.")
  }
  return { command, flags }
}

export function runId(env = process.env) {
  const id = env.B02_RUN_ID ?? `b02-${new Date().toISOString().replace(/[:.]/g, "-")}`
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || id.startsWith(".")) fail("B02_RUN_ID must match [A-Za-z0-9._-]{1,64}.")
  return id
}

/** The inherited allowlist only, then the given values on top. */
export function childEnv(base, extra) {
  const env = {}
  for (const name of INHERITED) if (base[name] !== undefined) env[name] = base[name]
  return { ...env, ...extra }
}

const git = (checkout, args) => {
  const r = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" })
  if (r.status !== 0) fail(`git ${args[0]} failed in B02_CHECKOUT.`)
  return r.stdout.trim()
}

function requireLoopback(raw, port, name, protocols = ["http:"]) {
  let url
  try {
    url = new URL(raw ?? "missing://")
  } catch {
    fail(`${name} is not a URL.`)
  }
  if (!protocols.includes(url.protocol)) fail(`${name} has an unexpected scheme.`)
  if (url.hostname !== "127.0.0.1" || url.port !== String(port)) {
    fail(`${name} must be 127.0.0.1:${port} (${STACK.name}).`)
  }
}

/**
 * stack.mjs migrationsDigest, computed from the commit's tree rather than the
 * working tree, so untracked files cannot stand in for the candidate.
 */
export function commitMigrations(checkout, commit) {
  const files = git(checkout, ["ls-tree", "--name-only", `${commit}:supabase/migrations`])
    .split("\n")
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
  const hash = createHash("sha256")
  for (const file of files) {
    const blob = spawnSync("git", ["-C", checkout, "cat-file", "blob", `${commit}:supabase/migrations/${file}`])
    if (blob.status !== 0) fail(`git cat-file failed for migration ${file}.`)
    hash.update(file + "\0")
    hash.update(createHash("sha256").update(blob.stdout).digest())
  }
  return { digest: hash.digest("hex"), count: files.length, latest: files.at(-1)?.split("_")[0] ?? null }
}

/** The pinned commit's migrations are exactly the ones candidate.json records. */
export function verifyPinnedMigrations(checkout, pin) {
  const m = commitMigrations(checkout, pin.commit)
  if (m.digest !== pin.migrationsDigest) fail("The candidate commit's migrations digest is not candidate.json's.")
  if (m.count !== pin.migrationCount || m.latest !== pin.latestMigration) {
    fail(`The candidate commit has ${m.count} migrations to ${m.latest}, not candidate.json's ${pin.migrationCount} to ${pin.latestMigration}.`)
  }
  return m.digest
}

const real = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** Exact candidate checkout: HEAD, tree, no tracked changes, fixture.ts reads the same pin. */
export function verifyCheckout(checkout, pin) {
  const head = git(checkout, ["rev-parse", "HEAD"])
  if (head !== pin.commit) fail(`B02_CHECKOUT is at ${head}, not the pinned candidate ${pin.commit}.`)
  const tree = git(checkout, ["rev-parse", "HEAD^{tree}"])
  if (tree !== pin.tree) fail(`B02_CHECKOUT's tree is ${tree}, not the pinned ${pin.tree}.`)
  if (git(checkout, ["status", "--porcelain", "--untracked-files=no"])) {
    fail("B02_CHECKOUT has tracked changes; the candidate must be clean.")
  }
}

/**
 * spare6 as stack.mjs reports it: canonical spec, running as its project, last
 * reset from this clean checkout at the candidate, applied migrations equal to
 * the recorded files and to the pinned count and latest version, and the
 * recorded digest equal to the pinned one.
 */
export function verifyStack(stack, spec, checkout, pin) {
  for (const key of ["project", "workdir", "apiPort", "dbPort", "mailpitPort", "appPort"]) {
    if (spec[key] !== STACK[key]) fail(`stack.mjs ${key} for ${STACK.name} is ${spec[key]}, expected ${STACK[key]}.`)
  }
  const status = stack.statusOf(spec)
  if (status.state !== "running" || status.project !== STACK.project || status.workdir !== STACK.workdir) {
    fail(`${STACK.name} is not running as ${STACK.project} in ${STACK.workdir}; the coordinator must bring it up.`)
  }
  const last = status.lastReset
  if (!last) fail(`${STACK.name} has no revision.json; it was not reset by stack.mjs.`)
  if (last.commit !== pin.commit || last.dirty !== false) {
    fail(`${STACK.name} was reset from ${last.commit ?? "unknown"}${last.dirty ? " (dirty)" : ""}, not the clean candidate.`)
  }
  if (!last.from || real(last.from) !== real(checkout)) {
    fail(`${STACK.name} was reset from another checkout, not B02_CHECKOUT.`)
  }
  if (status.migrations?.matchesRecordedFiles !== true) {
    fail(`${STACK.name}'s applied migrations do not match the files recorded at its last reset.`)
  }
  if (status.migrations.applied !== pin.migrationCount || status.migrations.latest !== pin.latestMigration) {
    fail(`${STACK.name} has ${status.migrations.applied} migrations to ${status.migrations.latest}, not the pinned ${pin.migrationCount} to ${pin.latestMigration}.`)
  }
  if (last.migrationsDigest !== pin.migrationsDigest) {
    fail(`${STACK.name}'s recorded migrations digest is not the pinned candidate's.`)
  }
}

export function validatedStackEnvironment(stack, spec) {
  const stackEnv = stack.stackEnv(spec)
  requireLoopback(stackEnv.NEXT_PUBLIC_SUPABASE_URL, STACK.apiPort, "NEXT_PUBLIC_SUPABASE_URL")
  requireLoopback(stackEnv.E2E_DB_URL, STACK.dbPort, "E2E_DB_URL", ["postgresql:", "postgres:"])
  requireLoopback(stackEnv.SUPABASE_DB_URL, STACK.dbPort, "SUPABASE_DB_URL", ["postgresql:", "postgres:"])
  if (stackEnv.MAILPIT_URL) requireLoopback(stackEnv.MAILPIT_URL, STACK.mailpitPort, "MAILPIT_URL")
  if (!stackEnv.SUPABASE_SERVICE_ROLE_KEY || !stackEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    fail(`${STACK.name} status has no keys.`)
  }
  return { ...stackEnv, NEXT_PUBLIC_SITE_URL: APP, E2E_PORT: String(STACK.appPort) }
}

async function portAnswers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" })
    return true
  } catch {
    return false
  }
}

/** Every value a child gets: the allowlisted inheritance, spare6's env, the switches and the run's own. */
function buildEnv(ctx) {
  return childEnv(process.env, {
    ...ctx.stackEnv,
    ...B02_SWITCHES,
    NEXT_TELEMETRY_DISABLED: "1",
    E2E_ISOLATED_STACK: "1",
    B02_STACK: STACK.name,
    APP_URL: APP,
    B02_CHECKOUT: ctx.checkout,
    ...(ctx.id ? { B02_RUN_ID: ctx.id } : {}),
    ...(ctx.runDir ? { B02_RUN_DIR: ctx.runDir } : {}),
  })
}

/**
 * Every guard, read-only: the pin, the exact candidate checkout and its
 * migrations, the spare6 spec, running state, project and applied revision,
 * loopback env and a free app port. Secrets stay in memory, never printed.
 */
async function check() {
  requireCanonicalRoot()
  const pin = loadPin()
  const checkout = process.env.B02_CHECKOUT
  if (!checkout || !isAbsolute(checkout)) fail("B02_CHECKOUT must be the candidate checkout's absolute path.")
  verifyCheckout(checkout, pin)
  verifyPinnedMigrations(checkout, pin)
  const stack = await import(pathToFileURL(join(checkout, "scripts", "ci", "stack.mjs")).href)
  if (stack.migrationsDigest(join(checkout, "supabase", "migrations")) !== pin.migrationsDigest) {
    fail("B02_CHECKOUT's supabase/migrations differ from the candidate commit's.")
  }
  const spec = stack.stackSpec(STACK.name)
  verifyStack(stack, spec, checkout, pin)
  const stackEnv = validatedStackEnvironment(stack, spec)
  if (await portAnswers(`${APP}/login`)) fail(`Something already answers on ${APP}; it is not this run's app.`)
  if (!existsSync(E2E)) fail(`No standalone e2e at ${E2E}.`)
  say(`checkout ${pin.commit} (tree ${pin.tree}) clean; ${STACK.name} running as ${STACK.project} with ${pin.migrationCount} pinned migrations; app ${APP} free`)
  return { pin, checkout, stack, spec, stackEnv, id: null, runDir: null }
}

/** The same guards again, and the env read again, inside the held lock immediately before seed. */
async function recheck(ctx) {
  requireCanonicalRoot()
  const pin = loadPin()
  if (JSON.stringify(pin) !== JSON.stringify(ctx.pin)) fail("candidate.json changed during the run.")
  verifyCheckout(ctx.checkout, pin)
  verifyPinnedMigrations(ctx.checkout, pin)
  if (ctx.stack.migrationsDigest(join(ctx.checkout, "supabase", "migrations")) !== pin.migrationsDigest) {
    fail("B02_CHECKOUT's supabase/migrations differ from the candidate commit's.")
  }
  const spec = ctx.stack.stackSpec(STACK.name)
  verifyStack(ctx.stack, spec, ctx.checkout, pin)
  ctx.stackEnv = validatedStackEnvironment(ctx.stack, spec)
  if (await portAnswers(`${APP}/login`)) fail(`Something already answers on ${APP}; it is not this run's app.`)
  say("guards and stack env rechecked under the lock")
}

/**
 * Runs a command in its own process group, stopped after `ms` or on
 * SIGINT/SIGTERM. Resolves only after any stop of that group has finished, so
 * the caller (and the lock) never outlive a child group this run started. A
 * spawn failure resolves 127 without signalling anything.
 */
export function bounded(stack, label, cmd, args, opts, ms) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { ...opts, detached: true })
    } catch {
      resolve(127)
      return
    }
    let stopping = null
    let settled = false
    const stop = () => {
      if (!stopping) stopping = child.pid ? stack.terminateGroup(child.pid) : Promise.resolve()
      return stopping
    }
    const unhook = stack.onTerminate(stop)
    const timer = setTimeout(() => {
      say(`${label} exceeded ${Math.round(ms / 1000)}s; stopping it`)
      stop()
    }, ms)
    const finish = async (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        if (child.pid) await stop()
      } finally {
        unhook()
        resolve(code)
      }
    }
    child.on("error", () => finish(127))
    child.on("exit", (code, signal) => finish(stopping ? 124 : code ?? (signal ? 124 : 1)))
  })
}

async function seed(ctx) {
  const runDir = join(HARNESS, ".results", ctx.id, "world")
  if (existsSync(runDir)) fail(`.results/${ctx.id}/world already exists: one world per run id.`)
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  ctx.runDir = runDir
  const tsx = join(ctx.checkout, "node_modules", ".bin", "tsx")
  if (!existsSync(tsx)) fail("The candidate checkout has no installed tsx (node_modules).")
  const code = await bounded(
    ctx.stack,
    "seed",
    tsx,
    [join(HARNESS, "seed.ts")],
    { cwd: ctx.checkout, env: { ...buildEnv(ctx), B02_VIA_RUNNER: "1" }, stdio: "inherit" },
    SEED_MS
  )
  if (code !== 0) fail(`Seed exited ${code}; world.partial.json in ${runDir} lists what was created.`)
  return runDir
}

async function startApp(ctx) {
  const next = join(ctx.checkout, "node_modules", ".bin", "next")
  if (!existsSync(next)) fail("The candidate checkout has no installed next (node_modules).")
  // NEXT_PUBLIC_* are baked into the client bundle, so build with spare6's env.
  const env = buildEnv(ctx)
  const code = await bounded(ctx.stack, "next build", next, ["build"], { cwd: ctx.checkout, env, stdio: "inherit" }, BUILD_MS)
  if (code !== 0) fail(`next build exited ${code}.`)
  // The build must not have moved the checkout off the candidate.
  verifyCheckout(ctx.checkout, ctx.pin)
  const log = openSync(join(ctx.runDir, "app.log"), "a", 0o600)
  const child = spawn(next, ["start", "--hostname", "127.0.0.1", "--port", String(STACK.appPort)], {
    cwd: ctx.checkout,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  })
  let exited = null
  child.on("error", () => (exited ??= 127))
  child.on("exit", (code) => (exited ??= code ?? 1))
  // The group outlives its leader if next forked workers, so stop it even
  // after the leader exited; without a pid nothing was started.
  let stopping = null
  const stop = () => (stopping ??= child.pid ? ctx.stack.terminateGroup(child.pid) : Promise.resolve())
  const unhook = ctx.stack.onTerminate(stop)
  const deadline = Date.now() + READY_MS
  try {
    for (;;) {
      if (exited !== null) fail(`next start exited ${exited} before it was ready (app.log in ${ctx.runDir}).`)
      try {
        const res = await fetch(`${APP}/login`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) break
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) fail(`${APP}/login was not ready within ${READY_MS / 1000}s.`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  } catch (error) {
    await stop()
    unhook()
    throw error
  }
  say(`app ready on ${APP} (pid ${child.pid}, B02 switches on)`)
  return async () => {
    await stop()
    unhook()
    say("app stopped")
  }
}

export function suitesFrom(flags) {
  const list = flags.suites ? String(flags.suites).split(",") : SUITES
  for (const s of list) if (!SUITES.includes(s)) fail(`Unknown suite ${s}; use ${SUITES.join(",")}.`)
  return SUITES.filter((s) => list.includes(s))
}

/**
 * One suite's report.json as counts: run status and exit, the runner's
 * summary (passed, failed, skipped...), and the agent steps that actually ran
 * (agent.act and agent.assert, with model calls), across tests and serial groups.
 */
export function summariseReport(report) {
  const run = report?.run
  if (!run) return { status: "missing", exitCode: null }
  const attempts = [...(run.results ?? []), ...(run.serialGroups ?? [])].flatMap((r) => r.attempts ?? [])
  const agentSteps = attempts.flatMap((a) => a.steps ?? []).filter((s) => s.kind === "agent")
  const byApi = {}
  for (const s of agentSteps) {
    const key = `${s.api}:${s.status}`
    byApi[key] = (byApi[key] ?? 0) + 1
  }
  return {
    status: run.status,
    exitCode: run.exitCode,
    summary: run.summary,
    notPassed: (run.results ?? [])
      .filter((r) => r.status !== "passed")
      .map((r) => ({ title: (r.titlePath ?? []).join(" › "), target: r.targetId, status: r.status })),
    agentSteps: byApi,
    modelCalls: agentSteps.reduce((n, s) => n + (s.metrics?.modelCalls ?? 0), 0),
    modelTokens: run.usage?.modelTokens ?? 0,
    runErrors: (run.errors ?? []).map((e) => e.code ?? "error"),
  }
}

function readReport(id, suite) {
  const file = join(HARNESS, ".results", id, suite, "report.json")
  if (!existsSync(file)) return { status: "missing", exitCode: null }
  try {
    return summariseReport(JSON.parse(readFileSync(file, "utf8")))
  } catch {
    return { status: "unreadable", exitCode: null }
  }
}

async function runCommand(flags) {
  const suites = suitesFrom(flags)
  const ctx = await check()
  ctx.id = runId()
  const results = {}
  await ctx.stack.withLock(ctx.spec, `b02 agentic acceptance ${ctx.id}`, LOCK_SECONDS, async () => {
    await recheck(ctx)
    await seed(ctx)
    const stopApp = await startApp(ctx)
    try {
      for (const suite of suites) {
        say(`e2e run ${suite}`)
        const code = await bounded(
          ctx.stack,
          `e2e ${suite}`,
          E2E,
          ["run", "--config", CONFIG, "--no-cache", "--retries", "0", "--workers", "1"],
          { cwd: HARNESS, env: { ...buildEnv(ctx), B02_SUITE: suite }, stdio: "inherit" },
          SUITE_MS
        )
        results[suite] = { exit: code, ...readReport(ctx.id, suite) }
      }
    } finally {
      await stopApp()
    }
    for (const suite of SUITES) if (!results[suite]) results[suite] = { exit: null, status: "not selected" }
    writeFileSync(
      join(ctx.runDir, "summary.json"),
      JSON.stringify({ runId: ctx.id, candidate: ctx.pin, stack: STACK.name, app: APP, suites: results }, null, 2) + "\n",
      { mode: 0o600 }
    )
  })
  for (const [suite, r] of Object.entries(results)) {
    const s = r.summary ?? {}
    say(
      `${suite}: exit ${r.exit} ${r.status}; passed ${s.passed ?? 0}, failed ${s.failed ?? 0}, skipped ${s.skipped ?? 0}, flaky ${s.flaky ?? 0}; agent ${JSON.stringify(r.agentSteps ?? {})}, ${r.modelCalls ?? 0} model calls`
    )
  }
  say(`summary .results/${ctx.id}/world/summary.json; reports .results/${ctx.id}/<suite>/`)
  return Object.entries(results).some(([s, r]) => suites.includes(s) && r.exit !== 0) ? 1 : 0
}

/** Collection only: fixed spare6 loopback values and placeholder keys; nothing is contacted. */
export function listEnv(suite, base = process.env) {
  return childEnv(base, {
    B02_SUITE: suite,
    B02_RUN_ID: "list-only",
    B02_STACK: STACK.name,
    B02_LIST_ONLY: "1",
    APP_URL: APP,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STACK.apiPort}`,
    E2E_DB_URL: `postgresql://postgres@127.0.0.1:${STACK.dbPort}/postgres`,
    SUPABASE_SERVICE_ROLE_KEY: "list-only-placeholder",
  })
}

function listCommand() {
  if (!existsSync(E2E)) fail(`No standalone e2e at ${E2E}.`)
  let worst = 0
  for (const suite of SUITES) {
    const r = spawnSync(E2E, ["list", "--config", CONFIG], { cwd: HARNESS, stdio: "inherit", env: listEnv(suite) })
    say(`list ${suite} exited ${r.status}`)
    worst = Math.max(worst, r.status ?? 1)
  }
  return worst
}

async function main() {
  requireCanonicalRoot()
  // Everything this run writes (world, reports, screenshots, app log) is private.
  process.umask(0o077)
  const { command, flags } = parse(process.argv.slice(2))
  if (command === "list") return listCommand()
  if (command === "check") {
    await check()
    return 0
  }
  if (command === "seed") {
    const ctx = await check()
    ctx.id = runId()
    await ctx.stack.withLock(ctx.spec, `b02 seed ${ctx.id}`, LOCK_SECONDS, async () => {
      await recheck(ctx)
      await seed(ctx)
    })
    say(`seeded .results/${ctx.id}/world`)
    return 0
  }
  if (command === "run") return runCommand(flags)
  console.log("usage: node run.mjs <list|check|seed|run --build [--suites staff,manager,recovery,layout]>")
  return 2
}

// Imported by run.test.mjs for the offline guard tests; runs only as a script.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`b02: ${error.message}`)
      process.exit(1)
    }
  )
}
