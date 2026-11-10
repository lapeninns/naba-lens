#!/usr/bin/env node
// B01 agentic acceptance runner (README.md). Node only, no dependencies of its
// own: the stack lock, env and process-group helpers come from the candidate
// checkout's scripts/ci/stack.mjs, the seed runs with the checkout's tsx, the
// app is the checkout's `next start`, and the tests run on the standalone e2e
// installation in $HOME.
//
//   node run.mjs list                       collect all suites (starts nothing)
//   node run.mjs check                      guards only, no lock, no writes
//   node run.mjs seed                       lock, guards, seed one world
//   node run.mjs run --build [--suites a,b] lock, guards, seed, build, app, e2e, stop
//
// `run` always builds: the bundle must come from the candidate with spare6's
// NEXT_PUBLIC_* env, and nothing here can prove an existing .next did.
// Env: B01_CHECKOUT (the candidate checkout, required except for list),
// B01_RUN_ID (optional), B01_APP_PORT (optional, default 3646),
// B01_E2E_HOME (optional, default $HOME). NABALENS_WS_ROOT must be unset: the
// lock and workdir are spare6's canonical ones. Nothing here prints a key,
// token, cookie or the reader credential.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Mirrors fixture.ts CANDIDATE and STACK; check() cross-checks both.
const CANDIDATE = "a41cc6b41562be4ff3717102d1dd0c35a117d2eb"
const STACK = {
  name: "spare6",
  project: "nabalens-ws-spare6",
  workdir: "/tmp/nabalens-ws/spare6",
  apiPort: 64621,
  dbPort: 64622,
  appPort: 3646,
}
const SUITES = ["journey", "narrow", "reader"]
const HARNESS = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(HARNESS, "e2e.config.ts")
const E2E = join(process.env.B01_E2E_HOME ?? homedir(), "node_modules", ".bin", "e2e")
const LOCK_SECONDS = 60
const SEED_MS = 180_000
const BUILD_MS = 900_000
const READY_MS = 180_000
const SUITE_MS = 1_800_000

export const fail = (message) => {
  throw new Error(message)
}
const say = (message) => console.log(`b01: ${message}`)

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
    flags[key] = key === "suites" ? rest[++i] ?? fail("--suites needs a value.") : true
  }
  if (command === "run" && (flags["reuse-build"] || !flags.build)) {
    fail("run needs --build: the bundle is built for the candidate with spare6's env on every run.")
  }
  return { command, flags }
}

function appPort() {
  const raw = process.env.B01_APP_PORT ?? String(STACK.appPort)
  if (!/^\d{4,5}$/.test(raw)) fail("B01_APP_PORT must be a port.")
  return Number(raw)
}

function runId() {
  const id = process.env.B01_RUN_ID ?? `b01-${new Date().toISOString().replace(/[:.]/g, "-")}`
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) fail("B01_RUN_ID must match [A-Za-z0-9._-]{1,64}.")
  return id
}

const git = (checkout, args) => {
  const r = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" })
  if (r.status !== 0) fail(`git ${args[0]} failed in B01_CHECKOUT.`)
  return r.stdout.trim()
}

function requireLoopback(raw, port, name) {
  const url = new URL(raw ?? "missing://")
  if (!["http:", "postgresql:", "postgres:"].includes(url.protocol)) fail(`${name} has an unexpected scheme.`)
  if (url.hostname !== "127.0.0.1" || url.port !== String(port)) {
    fail(`${name} must be 127.0.0.1:${port} (${STACK.name}).`)
  }
}

/**
 * stack.mjs migrationsDigest, computed from the candidate commit's tree rather
 * than the working tree, so untracked files cannot stand in for the candidate.
 */
export function candidateMigrationsDigest(checkout, commit = CANDIDATE) {
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
  return hash.digest("hex")
}

const real = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** Exact candidate checkout: HEAD, no tracked changes, fixture.ts agrees. */
function verifyCheckout(checkout) {
  const head = git(checkout, ["rev-parse", "HEAD"])
  if (head !== CANDIDATE) fail(`B01_CHECKOUT is at ${head}, not candidate ${CANDIDATE}.`)
  if (git(checkout, ["status", "--porcelain", "--untracked-files=no"])) {
    fail("B01_CHECKOUT has tracked changes; the candidate must be clean.")
  }
  const fixture = readFileSync(join(HARNESS, "fixture.ts"), "utf8")
  if (!fixture.includes(`CANDIDATE = "${CANDIDATE}"`)) fail("fixture.ts names another candidate.")
}

/**
 * spare6 as stack.mjs reports it: canonical spec, running as its project, last
 * reset from this clean checkout at the candidate, applied migrations equal to
 * the recorded files, and the recorded digest equal to the candidate's.
 */
export function verifyStack(stack, spec, checkout, expectedDigest) {
  for (const key of ["project", "workdir", "apiPort", "dbPort", "appPort"]) {
    if (spec[key] !== STACK[key]) fail(`stack.mjs ${key} for ${STACK.name} is ${spec[key]}, expected ${STACK[key]}.`)
  }
  const status = stack.statusOf(spec)
  if (status.state !== "running" || status.project !== STACK.project || status.workdir !== STACK.workdir) {
    fail(`${STACK.name} is not running as ${STACK.project} in ${STACK.workdir}; the coordinator must bring it up.`)
  }
  const last = status.lastReset
  if (!last) fail(`${STACK.name} has no revision.json; it was not reset by stack.mjs.`)
  if (last.commit !== CANDIDATE || last.dirty !== false) {
    fail(`${STACK.name} was reset from ${last.commit ?? "unknown"}${last.dirty ? " (dirty)" : ""}, not the clean candidate.`)
  }
  if (!last.from || real(last.from) !== real(checkout)) {
    fail(`${STACK.name} was reset from another checkout, not B01_CHECKOUT.`)
  }
  if (status.migrations?.matchesRecordedFiles !== true) {
    fail(`${STACK.name}'s applied migrations do not match the files recorded at its last reset.`)
  }
  if (!expectedDigest || last.migrationsDigest !== expectedDigest) {
    fail(`${STACK.name}'s recorded migrations digest is not the candidate's.`)
  }
}

async function portAnswers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" })
    return true
  } catch {
    return false
  }
}

/**
 * Every guard, read-only: exact candidate checkout, the spare6 stack spec,
 * running state, project and applied revision, loopback env and a free app
 * port. Returns what later steps need; secrets stay in `env`, never printed.
 */
async function check() {
  requireCanonicalRoot()
  const checkout = process.env.B01_CHECKOUT
  if (!checkout || !isAbsolute(checkout)) fail("B01_CHECKOUT must be the candidate checkout's absolute path.")
  verifyCheckout(checkout)
  const digest = candidateMigrationsDigest(checkout)
  const stack = await import(pathToFileURL(join(checkout, "scripts", "ci", "stack.mjs")).href)
  if (stack.migrationsDigest(join(checkout, "supabase", "migrations")) !== digest) {
    fail("B01_CHECKOUT's supabase/migrations differ from the candidate commit's.")
  }
  const spec = stack.stackSpec(STACK.name)
  verifyStack(stack, spec, checkout, digest)

  const stackEnv = validatedStackEnvironment(stack, spec)
  const port = appPort()
  const app = `http://127.0.0.1:${port}`
  if (await portAnswers(`${app}/login`)) fail(`Something already answers on ${app}; it is not this run's app.`)
  if (!existsSync(E2E)) fail(`No standalone e2e at ${E2E}.`)

  const env = {
    ...process.env,
    ...stackEnv,
    NEXT_PUBLIC_SITE_URL: app,
    E2E_ISOLATED_STACK: "1",
    B01_STACK: STACK.name,
    B01_APP_PORT: String(port),
    APP_URL: app,
    B01_CHECKOUT: checkout,
  }
  say(`checkout ${CANDIDATE} clean; ${STACK.name} running as ${STACK.project} at the candidate; app ${app} free`)
  return { checkout, stack, spec, env, app, port, digest }
}

export function validatedStackEnvironment(stack, spec) {
  const stackEnv = stack.stackEnv(spec)
  requireLoopback(stackEnv.NEXT_PUBLIC_SUPABASE_URL, STACK.apiPort, "NEXT_PUBLIC_SUPABASE_URL")
  requireLoopback(stackEnv.E2E_DB_URL, STACK.dbPort, "E2E_DB_URL")
  if (!stackEnv.SUPABASE_SERVICE_ROLE_KEY || !stackEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    fail(`${STACK.name} status has no keys.`)
  }
  return stackEnv
}

/** The same guards again, inside the held lock and immediately before seed. */
async function recheck(ctx) {
  requireCanonicalRoot()
  verifyCheckout(ctx.checkout)
  if (ctx.stack.migrationsDigest(join(ctx.checkout, "supabase", "migrations")) !== ctx.digest) {
    fail("B01_CHECKOUT's supabase/migrations differ from the candidate commit's.")
  }
  verifyStack(ctx.stack, ctx.stack.stackSpec(STACK.name), ctx.checkout, candidateMigrationsDigest(ctx.checkout))
  ctx.env = { ...ctx.env, ...validatedStackEnvironment(ctx.stack, ctx.spec), NEXT_PUBLIC_SITE_URL: ctx.app }
  if (await portAnswers(`${ctx.app}/login`)) fail(`Something already answers on ${ctx.app}; it is not this run's app.`)
  say("guards rechecked under the lock")
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

async function seed(ctx, id) {
  const runDir = join(HARNESS, ".results", id, "world")
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  ctx.env.B01_RUN_ID = id
  ctx.env.B01_RUN_DIR = runDir
  const tsx = join(ctx.checkout, "node_modules", ".bin", "tsx")
  if (!existsSync(tsx)) fail("The candidate checkout has no installed tsx (node_modules).")
  const code = await bounded(
    ctx.stack,
    "seed",
    tsx,
    [join(HARNESS, "seed.ts")],
    { cwd: ctx.checkout, env: { ...ctx.env, B01_VIA_RUNNER: "1" }, stdio: "inherit" },
    SEED_MS
  )
  if (code !== 0) fail(`Seed exited ${code}; world.partial.json in ${runDir} lists what was created.`)
  return runDir
}

async function startApp(ctx, runDir) {
  const next = join(ctx.checkout, "node_modules", ".bin", "next")
  if (!existsSync(next)) fail("The candidate checkout has no installed next (node_modules).")
  // NEXT_PUBLIC_* are baked into the client bundle, so build with spare6's env.
  const code = await bounded(ctx.stack, "next build", next, ["build"], { cwd: ctx.checkout, env: ctx.env, stdio: "inherit" }, BUILD_MS)
  if (code !== 0) fail(`next build exited ${code}.`)
  const consumers = join(runDir, "reader-consumers.json")
  const appEnv = {
    ...ctx.env,
    KNOWLEDGE_READER_ENABLED: "true",
    KNOWLEDGE_READER_CONSUMERS: readFileSync(consumers, "utf8"),
  }
  const log = openSync(join(runDir, "app.log"), "a", 0o600)
  const child = spawn(next, ["start", "--hostname", "127.0.0.1", "--port", String(ctx.port)], {
    cwd: ctx.checkout,
    env: appEnv,
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
      if (exited !== null) fail(`next start exited ${exited} before it was ready (app.log in ${runDir}).`)
      try {
        const res = await fetch(`${ctx.app}/login`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) break
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) fail(`${ctx.app}/login was not ready within ${READY_MS / 1000}s.`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  } catch (error) {
    await stop()
    unhook()
    throw error
  }
  say(`app ready on ${ctx.app} (pid ${child.pid}, reader registry for this world only)`)
  return async () => {
    await stop()
    unhook()
    say("app stopped")
  }
}

function suitesFrom(flags) {
  const list = flags.suites ? String(flags.suites).split(",") : SUITES
  for (const s of list) if (!SUITES.includes(s)) fail(`Unknown suite ${s}; use ${SUITES.join(",")}.`)
  // The reader reads what the journey wrote; keep the documented order.
  return SUITES.filter((s) => list.includes(s))
}

async function runCommand(flags) {
  const suites = suitesFrom(flags)
  const id = runId()
  const ctx = await check()
  const results = {}
  await ctx.stack.withLock(ctx.spec, `b01 agentic acceptance ${id}`, LOCK_SECONDS, async () => {
    await recheck(ctx)
    const runDir = await seed(ctx, id)
    const stopApp = await startApp(ctx, runDir)
    try {
      for (const suite of suites) {
        say(`e2e run ${suite}`)
        results[suite] = await bounded(
          ctx.stack,
          `e2e ${suite}`,
          E2E,
          ["run", "--config", CONFIG],
          { cwd: HARNESS, env: { ...ctx.env, B01_SUITE: suite, B01_READER_APP: "1" }, stdio: "inherit" },
          SUITE_MS
        )
      }
    } finally {
      await stopApp()
    }
    writeFileSync(
      join(runDir, "summary.json"),
      JSON.stringify({ runId: id, candidate: CANDIDATE, stack: STACK.name, app: ctx.app, exitCodes: results }, null, 2) + "\n",
      { mode: 0o600 }
    )
  })
  say(`exit codes ${JSON.stringify(results)}; reports in .results/${id}/<suite>/`)
  return Object.values(results).some((c) => c !== 0) ? 1 : 0
}

/** Collection only: fixed spare6 loopback values and a placeholder key; nothing is contacted. */
function listCommand() {
  if (!existsSync(E2E)) fail(`No standalone e2e at ${E2E}.`)
  let worst = 0
  for (const suite of SUITES) {
    const r = spawnSync(E2E, ["list", "--config", CONFIG], {
      cwd: HARNESS,
      stdio: "inherit",
      env: {
        ...process.env,
        B01_SUITE: suite,
        B01_RUN_ID: "list-only",
        B01_STACK: STACK.name,
        APP_URL: `http://127.0.0.1:${appPort()}`,
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STACK.apiPort}`,
        E2E_DB_URL: `postgresql://postgres@127.0.0.1:${STACK.dbPort}/postgres`,
        SUPABASE_SERVICE_ROLE_KEY: "list-only-placeholder",
        B01_RUN_DIR: "",
      },
    })
    say(`list ${suite} exited ${r.status}`)
    worst = Math.max(worst, r.status ?? 1)
  }
  return worst
}

async function main() {
  requireCanonicalRoot()
  const { command, flags } = parse(process.argv.slice(2))
  if (command === "list") return listCommand()
  if (command === "check") {
    await check()
    return 0
  }
  if (command === "seed") {
    const id = runId()
    const ctx = await check()
    await ctx.stack.withLock(ctx.spec, `b01 seed ${id}`, LOCK_SECONDS, async () => {
      await recheck(ctx)
      await seed(ctx, id)
    })
    say(`seeded .results/${id}/world`)
    return 0
  }
  if (command === "run") return runCommand(flags)
  console.log("usage: node run.mjs <list|check|seed|run --build [--suites journey,narrow,reader]>")
  return 2
}

// Imported by run.test.mjs for the offline guard tests; runs only as a script.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`b01: ${error.message}`)
      process.exit(1)
    }
  )
}
