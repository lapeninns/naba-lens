#!/usr/bin/env node
// B02 agentic acceptance runner (README.md). Node only, no dependencies of its
// own: the stack lock, env and process-group helpers come from the candidate
// checkout's scripts/ci/stack.mjs, the seed runs with the checkout's tsx, the
// app is the checkout's `next start`, the four e2e suites run on the
// standalone e2e installation in $HOME, and the two interruption charters run
// on the checkout's own Playwright against the same app (no second server).
// The design is the reviewed B01 harness's (qa/b01-agentic-acceptance at
// 9926d0f9): the same guards, canonical spare6 lock, per-run world,
// child-group settlement and locked environment refresh.
//
//   node run.mjs list [--require-all]           collect what exists (starts nothing)
//   node run.mjs check                          guards only, no lock, no writes
//   node run.mjs seed                           lock, guards, seed one world
//   node run.mjs run --build [--suites a,b]     lock, guards, seed, build, app, suites, stop
//
// `run` always builds: the bundle must come from the pinned candidate with
// spare6's NEXT_PUBLIC_* env, and nothing here can prove an existing .next did.
// The only accepted head is candidate.json; the caller cannot choose another.
// Env: B02_CHECKOUT (the candidate checkout, required except for list),
// B02_RUN_ID (optional), B02_E2E_HOME (optional, default $HOME).
// NABALENS_WS_ROOT must be unset. Nothing here prints a key, token or cookie:
// child output is redacted line by line and every artifact is scrubbed.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  closeSync,
  createWriteStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { connect } from "node:net"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const HARNESS = realpathSync(dirname(fileURLToPath(import.meta.url)))
const RESULTS = join(HARNESS, ".results")
const CONFIG = join(HARNESS, "e2e.config.ts")

export function fail(message) {
  throw new Error(message)
}
const say = (message) => console.log(`b02: ${message}`)
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

// ---- The pinned candidate ------------------------------------------------------

const PIN_KEYS = ["comment", "commit", "tree", "migrationsDigest", "migrationCount", "latestMigration"]

/** candidate.json, validated: the one head, tree and migration set accepted. */
export function loadPin(file = join(HARNESS, "candidate.json")) {
  const pin = JSON.parse(readFileSync(file, "utf8"))
  if (!isRecord(pin)) fail("candidate.json must be an object.")
  for (const key of Object.keys(pin)) if (!PIN_KEYS.includes(key)) fail(`candidate.json has an unknown key ${key}.`)
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? "")) fail("candidate.json commit must be a full SHA.")
  if (!/^[0-9a-f]{40}$/.test(pin.tree ?? "")) fail("candidate.json tree must be a full SHA.")
  if (!/^[0-9a-f]{64}$/.test(pin.migrationsDigest ?? "")) fail("candidate.json migrationsDigest must be sha256 hex.")
  if (!Number.isInteger(pin.migrationCount) || pin.migrationCount < 1) fail("candidate.json migrationCount must be a count.")
  if (!/^\d{14}$/.test(pin.latestMigration ?? "")) fail("candidate.json latestMigration must be a migration version.")
  const { commit, tree, migrationsDigest, migrationCount, latestMigration } = pin
  return Object.freeze({ commit, tree, migrationsDigest, migrationCount, latestMigration })
}

// ---- The stack, the plan and the switches ----------------------------------------

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
/** stack.mjs withLock's directory for spare6 under the canonical root. */
export const LOCK_DIR = "/tmp/nabalens-ws/spare6.lock"
const APP = `http://127.0.0.1:${STACK.appPort}`

const frozen = (value) => Object.freeze(Object.assign(Object.create(null), value))
/**
 * The finite selection, by suite: the file each runs, its exact instances per
 * target, and the live agent work its report must show. 4 + 8 + 2 + 1x4 + 2 = 20.
 * Serial order: each suite has its own personas and venue in the one world.
 */
export const PLAN = frozen({
  staff: frozen({ kind: "e2e", file: "staff.e2e.ts", targets: frozen({ desktop: 4 }), agent: frozen({ api: "agent.act", perTarget: false }) }),
  manager: frozen({ kind: "e2e", file: "manager.e2e.ts", targets: frozen({ desktop: 8 }), agent: null }),
  recovery: frozen({ kind: "e2e", file: "recovery.e2e.ts", targets: frozen({ desktop: 2 }), agent: null }),
  layout: frozen({
    kind: "e2e",
    file: "layout.e2e.ts",
    targets: frozen({ "phone-320": 1, "phone-375": 1, "phone-390": 1, desktop: 1 }),
    agent: frozen({ api: "agent.assert", perTarget: true }),
  }),
  charters: frozen({ kind: "playwright", file: "charters.playwright.ts", config: "charters.config.ts", tests: 2 }),
})
export const SUITES = Object.freeze(Object.keys(PLAN))
export const expectedInstances = (suite) =>
  PLAN[suite].kind === "playwright" ? PLAN[suite].tests : Object.values(PLAN[suite].targets).reduce((a, b) => a + b, 0)
export const TOTAL_INSTANCES = SUITES.reduce((n, s) => n + expectedInstances(s), 0)

/** Exact membership: own names of PLAN only, never an inherited property such as "toString". */
export const isSuite = (name) => typeof name === "string" && SUITES.includes(name) && Object.hasOwn(PLAN, name)

/** The four B02 UI switches (lib/config/*), server-side, on for build and app. */
export const B02_SWITCHES = Object.freeze({
  NABALENS_HOME_LAYOUT: "b02",
  NABALENS_CONTRIBUTION_ENTRY: "b02",
  NABALENS_MY_CONTRIBUTIONS: "b02",
  NABALENS_MANAGER_TRIAGE: "b02",
})

// ---- Environment, by what each child actually needs ---------------------------------

/**
 * Inherited variables a child may see. Everything else (another stack's
 * Supabase URL or keys, a production DATABASE_URL, Vercel tokens, the B01
 * per-venue rollback lists, CI) is dropped rather than overridden.
 */
export const INHERITED = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]
/** Browser runners also keep a relocated Playwright browser cache. */
const BROWSER_INHERITED = [...INHERITED, "PLAYWRIGHT_BROWSERS_PATH"]

function inherit(base, names) {
  const env = {}
  for (const name of names) if (base[name] !== undefined) env[name] = base[name]
  return env
}
/** The inherited allowlist only, then the given values on top. */
export function childEnv(base, extra, names = INHERITED) {
  return { ...inherit(base, names), ...extra }
}

const runIdentity = (ctx) => ({ B02_STACK: STACK.name, APP_URL: APP, B02_RUN_ID: ctx.id, B02_RUN_DIR: ctx.runDir })

/** Seed: the repository helpers' three Supabase values, the DB URL and the run's identity. */
export function seedEnv(base, ctx) {
  const s = ctx.stackEnv
  return childEnv(base, {
    NEXT_PUBLIC_SUPABASE_URL: s.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY,
    E2E_DB_URL: s.E2E_DB_URL,
    E2E_ISOLATED_STACK: "1",
    B02_CHECKOUT: ctx.checkout,
    B02_VIA_RUNNER: "1",
    ...runIdentity(ctx),
  })
}

/** next build: only what the bundle inlines (public values) and the switches. */
export function buildEnv(base, ctx) {
  const s = ctx.stackEnv
  return childEnv(base, {
    NEXT_PUBLIC_SUPABASE_URL: s.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: APP,
    NEXT_TELEMETRY_DISABLED: "1",
    ...B02_SWITCHES,
  })
}

/** next start: the build's values plus the service key its admin and media routes read. */
export function serverEnv(base, ctx) {
  return { ...buildEnv(base, ctx), SUPABASE_SERVICE_ROLE_KEY: ctx.stackEnv.SUPABASE_SERVICE_ROLE_KEY }
}

/**
 * One e2e suite: target guards, fixture sign-in (service key for GoTrue's
 * generate_link), read-only psql (DB URL) and the run's world. No publishable
 * key, JWT secret, SUPABASE_DB_URL, Mailpit or checkout path.
 */
export function e2eEnv(base, ctx, suite) {
  if (!isSuite(suite) || PLAN[suite].kind !== "e2e") fail(`${String(suite)} is not an e2e suite.`)
  const s = ctx.stackEnv
  return childEnv(
    base,
    {
      NEXT_PUBLIC_SUPABASE_URL: s.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY,
      E2E_DB_URL: s.E2E_DB_URL,
      B02_SUITE: suite,
      ...runIdentity(ctx),
    },
    BROWSER_INHERITED
  )
}

/** The two Playwright charters: the e2e values, plus the checkout (its Playwright) and the JSON report path. */
export function playwrightEnv(base, ctx, reportFile) {
  const s = ctx.stackEnv
  return childEnv(
    base,
    {
      NEXT_PUBLIC_SUPABASE_URL: s.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY,
      E2E_DB_URL: s.E2E_DB_URL,
      B02_SUITE: "charters",
      B02_CHECKOUT: ctx.checkout,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      ...runIdentity(ctx),
    },
    BROWSER_INHERITED
  )
}

/** Collection only: fixed spare6 loopback values and placeholder keys; nothing is contacted. */
export function listEnv(suite, base = process.env, checkout = undefined) {
  return childEnv(
    base,
    {
      B02_SUITE: suite,
      B02_RUN_ID: "list-only",
      B02_STACK: STACK.name,
      B02_LIST_ONLY: "1",
      APP_URL: APP,
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STACK.apiPort}`,
      E2E_DB_URL: `postgresql://postgres@127.0.0.1:${STACK.dbPort}/postgres`,
      SUPABASE_SERVICE_ROLE_KEY: "list-only-placeholder",
      ...(checkout ? { B02_CHECKOUT: checkout } : {}),
    },
    BROWSER_INHERITED
  )
}

// ---- Redaction --------------------------------------------------------------------

/**
 * Values shorter than this are not treated as secrets: a local default such
 * as the "postgres" password is not one (the whole DB URL still is).
 */
const SECRET_MIN = 12

/** Credential values to redact, with their names, longest first. */
export function secretsOf(named) {
  return Object.entries(named)
    .filter(([, value]) => typeof value === "string" && value.length >= SECRET_MIN)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value.length - a.value.length)
}

export function redact(text, secrets) {
  let out = text
  for (const { name, value } of secrets) out = out.split(value).join(`[redacted:${name}]`)
  return out
}

/**
 * Redacts a stream of text chunks: whole lines as they complete, and long
 * unterminated output in pieces cut so no secret occurrence spans a cut.
 */
export function lineRedactor(secrets, write, limit = 65536) {
  const longest = secrets.reduce((n, s) => Math.max(n, s.value.length), 1)
  let buffer = ""
  return {
    push(chunk) {
      buffer += String(chunk)
      const newline = buffer.lastIndexOf("\n")
      if (newline >= 0) {
        write(redact(buffer.slice(0, newline + 1), secrets))
        buffer = buffer.slice(newline + 1)
      }
      if (buffer.length > limit) {
        let cut = buffer.length - longest
        for (const { value } of secrets) {
          for (let at = buffer.indexOf(value); at >= 0; at = buffer.indexOf(value, at + 1)) {
            if (at < cut && at + value.length > cut) cut = at
          }
        }
        write(redact(buffer.slice(0, cut), secrets))
        buffer = buffer.slice(cut)
      }
    },
    end() {
      if (buffer) write(redact(buffer, secrets))
      buffer = ""
    },
  }
}

/**
 * Walks a run's output: every directory private (0700) and file private
 * (0600); credential values in text files replaced in place; a value in a
 * binary file, or any symlink, reported (they cannot be redacted safely).
 */
export function scrubArtifacts(root, secrets) {
  const found = { redacted: [], binary: [], symlinks: [] }
  if (!existsSync(root)) return found
  const walk = (dir) => {
    chmodSync(dir, 0o700)
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const rel = relative(root, path)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        found.symlinks.push(rel)
        continue
      }
      if (stat.isDirectory()) {
        walk(path)
        continue
      }
      if (!stat.isFile()) continue
      chmodSync(path, 0o600)
      const bytes = readFileSync(path)
      const hits = secrets.filter(({ value }) => bytes.includes(value))
      if (hits.length === 0) continue
      if (bytes.includes(0)) {
        for (const { name: secret } of hits) found.binary.push({ file: rel, secret })
        continue
      }
      writeFileSync(path, redact(bytes.toString("utf8"), secrets), { mode: 0o600 })
      for (const { name: secret } of hits) found.redacted.push({ file: rel, secret })
    }
  }
  walk(root)
  return found
}

// ---- Arguments, run id and paths ------------------------------------------------------

/** stack.mjs reads NABALENS_WS_ROOT at import; an inherited one would move the lock and workdir. */
export function requireCanonicalRoot(env = process.env) {
  if (env.NABALENS_WS_ROOT !== undefined) {
    fail("NABALENS_WS_ROOT is set; unset it so spare6's canonical lock and workdir are used.")
  }
}

const FLAGS = { list: ["require-all"], check: [], seed: [], run: ["build", "suites"] }

export function parse(argv) {
  const [command, ...rest] = argv
  if (!Object.hasOwn(FLAGS, command ?? "")) return { command: "help", flags: {} }
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith("--")) fail(`Unexpected argument ${arg}.`)
    const key = arg.slice(2)
    if (key === "reuse-build") fail("run needs --build: the bundle is built for the candidate with spare6's env on every run.")
    if (!FLAGS[command].includes(key)) fail(`Unknown flag --${key} for ${command}.`)
    if (Object.hasOwn(flags, key)) fail(`--${key} was given twice.`)
    flags[key] = key === "suites" ? rest[++i] ?? fail("--suites needs a value.") : true
  }
  if (command === "run" && !flags.build) {
    fail("run needs --build: the bundle is built for the candidate with spare6's env on every run.")
  }
  return { command, flags }
}

export function suitesFrom(flags) {
  if (flags.suites === undefined) return [...SUITES]
  const list = String(flags.suites).split(",")
  if (list.length === 0 || list.some((s) => s === "")) fail("--suites needs suite names separated by commas.")
  for (const s of list) if (!isSuite(s)) fail(`Unknown suite ${s}; use ${SUITES.join(",")}.`)
  if (new Set(list).size !== list.length) fail("--suites names a suite twice.")
  return SUITES.filter((s) => list.includes(s))
}

/** One plain path segment: no dots (never "." or ".."), no separators. fixture.ts uses the same rule. */
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function runId(env = process.env, now = new Date()) {
  const id = env.B02_RUN_ID ?? `b02-${now.toISOString().replace(/[:.]/g, "-")}`
  if (!RUN_ID.test(id)) fail("B02_RUN_ID must be one plain segment matching [A-Za-z0-9][A-Za-z0-9_-]{0,63}.")
  return id
}

function realDirectory(path, name) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${name} must be a real directory, not a symlink.`)
}

/**
 * The run's private output: .results/<id>/ is created exclusively (an id is
 * never reused), with world/ inside it. .results must be a real directory of
 * this harness, so no symlink can move a run's evidence elsewhere.
 */
export function prepareRunRoot(id, results = RESULTS) {
  if (!RUN_ID.test(id)) fail("not a run id")
  mkdirSync(results, { recursive: true, mode: 0o700 })
  realDirectory(results, ".results")
  if (dirname(realpathSync(results)) !== realpathSync(dirname(results))) fail(".results must sit directly in the harness.")
  const runRoot = join(results, id)
  try {
    mkdirSync(runRoot, { mode: 0o700 })
  } catch (error) {
    if (error.code === "EEXIST") fail(`.results/${id} already exists: use a new B02_RUN_ID.`)
    throw error
  }
  const world = join(runRoot, "world")
  mkdirSync(world, { mode: 0o700 })
  return { runRoot, world }
}

/** A suite's output directory: inside the run, and new (no earlier report can be read as this run's). */
export function freshOutput(runRoot, suite) {
  if (!isSuite(suite)) fail(`${String(suite)} is not a suite.`)
  realDirectory(runRoot, "the run directory")
  const dir = join(runRoot, suite)
  if (existsSync(dir)) fail(`${relative(HARNESS, dir)} already exists; a suite writes into a new directory.`)
  return dir
}

export const JOURNAL = "world.journal.jsonl"

/** The seed journal's first line, fsynced with its directory before any seed write. */
export function startJournal(worldDir, header) {
  const fd = openSync(join(worldDir, JOURNAL), "wx", 0o600)
  try {
    writeSync(fd, JSON.stringify({ at: new Date().toISOString(), kind: "header", ...header }) + "\n")
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const dirFd = openSync(worldDir, "r")
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
}

// ---- Checkout, harness and stack guards ----------------------------------------------

const git = (dir, args, name = "B02_CHECKOUT") => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" })
  if (r.status !== 0) fail(`git ${args[0]} failed in ${name}.`)
  return r.stdout.trim()
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

/**
 * Exact candidate checkout: its own worktree root at the pinned HEAD and
 * tree, no tracked change and no untracked file (ignored build output aside),
 * and no local .env file that next build or start would read.
 */
export function verifyCheckout(checkout, pin) {
  if (!checkout || !isAbsolute(checkout)) fail("B02_CHECKOUT must be the candidate checkout's absolute path.")
  const root = real(checkout)
  if (!root) fail("B02_CHECKOUT does not exist.")
  if (real(git(checkout, ["rev-parse", "--show-toplevel"])) !== root) fail("B02_CHECKOUT must be the root of its worktree.")
  const head = git(checkout, ["rev-parse", "HEAD"])
  if (head !== pin.commit) fail(`B02_CHECKOUT is at ${head}, not the pinned candidate ${pin.commit}.`)
  const tree = git(checkout, ["rev-parse", "HEAD^{tree}"])
  if (tree !== pin.tree) fail(`B02_CHECKOUT's tree is ${tree}, not the pinned ${pin.tree}.`)
  if (git(checkout, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("B02_CHECKOUT has tracked changes or untracked files; the candidate must be clean.")
  }
  const envFiles = readdirSync(root).filter((name) => name.startsWith(".env") && name !== ".env.example")
  if (envFiles.length) fail(`B02_CHECKOUT has local env files (${envFiles.join(", ")}) that next would read; remove them.`)
}

/** The harness itself: its commit, tree and whether its directory is clean, for the summary and the run guard. */
export function harnessState(dir = HARNESS) {
  const head = git(dir, ["rev-parse", "HEAD"], "the harness")
  const tree = git(dir, ["rev-parse", "HEAD^{tree}"], "the harness")
  const changes = git(dir, ["status", "--porcelain=v1", "--untracked-files=all", "--", "."], "the harness")
  return { commit: head, tree, clean: changes === "" }
}

/**
 * spare6 as stack.mjs reports it: canonical spec (so its lock and workdir
 * are under /tmp/nabalens-ws), running as its project, last reset from this
 * clean checkout at the candidate, applied migrations equal to the recorded
 * files and to the pinned count and latest version, and the recorded digest
 * equal to the pinned one.
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
 * spare6's env from stack.mjs, read fresh: the four values children need,
 * each validated, and every credential value it holds (needed or not) for
 * redaction. Values stay in memory.
 */
export function validatedStackEnvironment(stack, spec) {
  const all = stack.stackEnv(spec)
  requireLoopback(all.NEXT_PUBLIC_SUPABASE_URL, STACK.apiPort, "NEXT_PUBLIC_SUPABASE_URL")
  requireLoopback(all.E2E_DB_URL, STACK.dbPort, "E2E_DB_URL", ["postgresql:", "postgres:"])
  if (all.SUPABASE_DB_URL !== undefined) requireLoopback(all.SUPABASE_DB_URL, STACK.dbPort, "SUPABASE_DB_URL", ["postgresql:", "postgres:"])
  if (all.MAILPIT_URL) requireLoopback(all.MAILPIT_URL, STACK.mailpitPort, "MAILPIT_URL")
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
    if (typeof all[name] !== "string" || all[name].length < SECRET_MIN) fail(`${STACK.name} status has no ${name}.`)
  }
  if (all.SUPABASE_SERVICE_ROLE_KEY === all.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) fail(`${STACK.name}'s service and publishable keys are the same.`)
  const env = Object.freeze({
    NEXT_PUBLIC_SUPABASE_URL: all.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: all.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: all.SUPABASE_SERVICE_ROLE_KEY,
    E2E_DB_URL: all.E2E_DB_URL,
  })
  const dbPassword = (raw) => {
    try {
      return decodeURIComponent(new URL(raw).password)
    } catch {
      return undefined
    }
  }
  const secrets = secretsOf({
    SUPABASE_SERVICE_ROLE_KEY: all.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: all.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_JWT_SECRET: all.SUPABASE_JWT_SECRET,
    E2E_DB_URL: all.E2E_DB_URL,
    SUPABASE_DB_URL: all.SUPABASE_DB_URL,
    DB_PASSWORD: dbPassword(all.E2E_DB_URL),
  })
  return { env, secrets }
}

/** The canonical spare6 lock is held by this process under `label` (stack.mjs owner.json). */
export function verifyLockOwner(label, lockDir = LOCK_DIR, pid = process.pid) {
  let owner
  try {
    realDirectory(lockDir, "The spare6 lock")
    owner = JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"))
  } catch (error) {
    fail(`The canonical spare6 lock is not held (${error.message}).`)
  }
  if (owner?.pid !== pid || owner?.what !== label) fail("The canonical spare6 lock is held by another command.")
}

// ---- The app port and its listener ------------------------------------------------------

/** Whether anything accepts a TCP connection on the app port. */
export function portInUse(port = STACK.appPort, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    socket.setTimeout(2000)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("timeout", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

/** PIDs listening on TCP `port` (lsof). Fails closed when lsof cannot answer. */
export function listeners(port) {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" })
  if (r.error || r.status === null) fail("lsof is unavailable; the app port's owner cannot be verified.")
  if (r.status !== 0 && r.stdout.trim() !== "") fail("lsof failed on the app port.")
  return r.stdout.split("\n").filter(Boolean).map(Number)
}

export function processGroupOf(pid) {
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" })
  const group = Number(r.stdout.trim())
  return r.status === 0 && Number.isInteger(group) && group > 0 ? group : null
}

/** Every listener on the app port belongs to the process group this run started. */
export function verifyServerOwner(port, groupPid, list = listeners, groupOf = processGroupOf) {
  const pids = list(port)
  if (pids.length === 0) fail(`Nothing listens on ${port}; the app is not running.`)
  for (const pid of pids) {
    if (groupOf(pid) !== groupPid) fail(`Port ${port} is served by pid ${pid}, outside this run's app process group.`)
  }
}

/** The app port is free: no connection, no listener. */
export async function requireFreePort(port = STACK.appPort, list = listeners, probe = portInUse) {
  if (list(port).length > 0 || (await probe(port))) fail(`Something already listens on ${port}; it is not this run's app.`)
}

// ---- Children ------------------------------------------------------------------------------

/**
 * Runs a command in its own process group, stopped after `ms` or on
 * SIGINT/SIGTERM. Resolves only after any stop of that group has finished and
 * its output has drained, so the caller (and the lock) never outlive a child
 * group this run started. Output is redacted line by line. A spawn failure
 * resolves 127 without signalling anything.
 */
export function bounded(stack, label, cmd, args, opts, ms, secrets = [], out = process.stdout, err = process.stderr) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts, detached: true })
    } catch {
      resolve(127)
      return
    }
    const drains = []
    for (const [stream, sink] of [
      [child.stdout, out],
      [child.stderr, err],
    ]) {
      if (!stream) continue
      const redactor = lineRedactor(secrets, (text) => sink.write(text))
      stream.setEncoding("utf8")
      stream.on("data", (chunk) => redactor.push(chunk))
      drains.push(
        new Promise((done) => {
          stream.once("close", () => {
            redactor.end()
            done()
          })
        })
      )
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
        await Promise.race([Promise.all(drains), new Promise((r) => setTimeout(r, 5000))])
      } finally {
        unhook()
        resolve(code)
      }
    }
    child.on("error", () => finish(127))
    child.on("exit", (code, signal) => finish(stopping ? 124 : code ?? (signal ? 124 : 1)))
  })
}

// ---- Report validation ------------------------------------------------------------------------

export function readJson(file) {
  if (!existsSync(file)) return { problem: "missing" }
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) }
  } catch {
    return { problem: "malformed" }
  }
}

const TIME_SLACK_MS = 2000

/**
 * One e2e suite's report.json against the plan: a fresh report-1 document of
 * this suite's project that passed with exit 0 and no run errors; exactly the
 * planned instances per target, each selected, from the suite's file, passing
 * on its one attempt (serial members through their group); no skip, flake,
 * failure or extra result; and, where the plan asks, a passed agent step of
 * the required kind that made model calls live (never replayed from cache).
 */
export function validateE2EReport(report, suite, { startedAtMs = 0 } = {}) {
  if (!isSuite(suite) || PLAN[suite].kind !== "e2e") fail(`${String(suite)} is not an e2e suite.`)
  const plan = PLAN[suite]
  const expected = expectedInstances(suite)
  const problems = []
  const problem = (message) => problems.push(message)
  const counts = { expected, results: 0, passed: 0, agentSteps: {}, modelCalls: 0, modelTokens: 0 }
  const done = () => ({ ok: problems.length === 0, problems, counts })
  if (!isRecord(report) || report.schemaVersion !== "report-1" || !isRecord(report.run)) {
    problem("not an e2e report-1 document")
    return done()
  }
  const run = report.run
  if (run.status !== "passed") problem(`run status is ${run.status}`)
  if (run.exitCode !== 0) problem(`run exit code is ${run.exitCode}`)
  if (!Array.isArray(run.errors)) problem("run errors are missing")
  else if (run.errors.length) problem(`run errors: ${run.errors.map((e) => e?.code ?? "error").join(", ")}`)
  if (run.project?.id !== `nabalens-b02-agentic-${suite}`) problem(`report belongs to project ${run.project?.id}`)
  if (!(Date.parse(run.startedAt) >= startedAtMs - TIME_SLACK_MS)) problem("report predates this suite's start")
  const summary = isRecord(run.summary) ? run.summary : (problem("summary is missing"), {})
  for (const [key, value] of [
    ["discovered", expected],
    ["selected", expected],
    ["executed", expected],
    ["passed", expected],
    ["failed", 0],
    ["flaky", 0],
    ["skipped", 0],
  ]) {
    if (summary[key] !== value) problem(`summary ${key} is ${summary[key]}, expected ${value}`)
  }
  const results = Array.isArray(run.results) ? run.results : (problem("results are missing"), [])
  const groupList = Array.isArray(run.serialGroups) ? run.serialGroups : (problem("serial groups are missing"), [])
  const groups = new Map(groupList.filter(isRecord).map((g) => [g.id, g]))
  counts.results = results.length
  if (results.length !== expected) problem(`${results.length} results, expected ${expected}`)
  const perTarget = Object.create(null)
  const seen = new Set()
  const steps = []
  for (const r of results) {
    if (!isRecord(r)) {
      problem("a result is not an object")
      continue
    }
    const where = `${Array.isArray(r.titlePath) ? r.titlePath.join(" › ") : "?"} [${r.targetId}]`
    if (r.kind !== "test") problem(`${where} is a ${r.kind} result`)
    if (r.selected !== true) problem(`${where} was not selected`)
    if (r.status !== "passed") problem(`${where} is ${r.status}`)
    if (r.repeat !== 0) problem(`${where} is repeat ${r.repeat}`)
    if (typeof r.file !== "string" || basename(r.file) !== plan.file) problem(`${where} comes from ${r.file}, not ${plan.file}`)
    if (typeof r.targetId !== "string" || !Object.hasOwn(plan.targets, r.targetId)) problem(`${where} ran on an unplanned target`)
    else perTarget[r.targetId] = (perTarget[r.targetId] ?? 0) + 1
    const key = JSON.stringify([r.titlePath, r.targetId])
    if (seen.has(key)) problem(`${where} appears twice`)
    seen.add(key)
    if (r.serialGroupId !== undefined) {
      const group = groups.get(r.serialGroupId)
      const attempts = Array.isArray(group?.attempts) ? group.attempts : []
      const member = attempts.at(-1)?.members?.find?.((m) => m?.testId === r.testId)
      if (!group) problem(`${where} names a missing serial group`)
      else if (group.status !== "passed" || attempts.length !== 1) problem(`${where}'s serial group is ${group.status} after ${attempts.length} attempts`)
      if (!member || member.status !== "passed") problem(`${where} did not pass as a serial member`)
    } else {
      const attempts = Array.isArray(r.attempts) ? r.attempts : []
      if (attempts.length !== 1 || attempts[0]?.status !== "passed") problem(`${where} did not pass on its one attempt`)
      for (const attempt of attempts) for (const step of attempt?.steps ?? []) steps.push({ target: r.targetId, step })
    }
    if (r.status === "passed") counts.passed++
  }
  for (const [targetId, n] of Object.entries(plan.targets)) {
    if ((perTarget[targetId] ?? 0) !== n) problem(`${targetId} has ${perTarget[targetId] ?? 0} results, expected ${n}`)
  }
  for (const group of groups.values()) {
    for (const attempt of group.attempts ?? []) {
      for (const member of attempt?.members ?? []) for (const step of member?.steps ?? []) steps.push({ target: group.targetId, step })
    }
  }
  const live = Object.create(null)
  for (const { target, step } of steps) {
    if (!isRecord(step) || step.kind !== "agent") continue
    const key = `${step.api}:${step.status}`
    counts.agentSteps[key] = (counts.agentSteps[key] ?? 0) + 1
    const calls = Number(step.metrics?.modelCalls ?? 0)
    counts.modelCalls += Number.isFinite(calls) ? calls : 0
    if (step.cache?.mode === "self-finalized") problem(`${step.api} at ${target} was replayed from the cache`)
    else if (step.status === "passed" && calls > 0) {
      live[target] ??= Object.create(null)
      live[target][step.api] = (live[target][step.api] ?? 0) + 1
    }
  }
  counts.modelTokens = Number(run.usage?.modelTokens ?? 0) || 0
  if (plan.agent) {
    const { api, perTarget: each } = plan.agent
    const liveAt = (t) => live[t]?.[api] ?? 0
    if (each) {
      for (const t of Object.keys(plan.targets)) if (liveAt(t) < 1) problem(`no passed live ${api} with model calls at ${t}`)
    } else if (Object.keys(live).reduce((n, t) => n + liveAt(t), 0) < 1) {
      problem(`no passed live ${api} with model calls`)
    }
    if (!(counts.modelTokens > 0)) problem("the run used no model tokens")
  }
  return done()
}

/** Every test in a Playwright JSON report, with the file of the spec it belongs to. */
function playwrightTests(suites, out = []) {
  for (const suite of Array.isArray(suites) ? suites : []) {
    for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
      for (const test of Array.isArray(spec?.tests) ? spec.tests : []) out.push({ spec, test })
    }
    playwrightTests(suite?.suites, out)
  }
  return out
}

/**
 * The charters' Playwright JSON report: no webServer, no top-level errors,
 * exactly the planned tests from charters.playwright.ts, each expected to
 * pass and passing on its single attempt, with no skip, flake or failure,
 * started after this suite began. `listing` checks a --list report instead
 * (collected tests and config only).
 */
export function validatePlaywrightReport(report, { startedAtMs = 0, listing = false } = {}) {
  const plan = PLAN.charters
  const problems = []
  const problem = (message) => problems.push(message)
  const counts = { expected: plan.tests, tests: 0, passed: 0 }
  const done = () => ({ ok: problems.length === 0, problems, counts })
  if (!isRecord(report) || !isRecord(report.config) || !Array.isArray(report.suites)) {
    problem("not a Playwright JSON report")
    return done()
  }
  if (report.config.webServer) problem("the charters config declares a webServer")
  for (const project of Array.isArray(report.config.projects) ? report.config.projects : []) {
    if (!listing && project?.retries !== 0) problem(`project ${project?.name} allows ${project?.retries} retries`)
  }
  if (!Array.isArray(report.errors)) problem("errors are missing")
  else if (report.errors.length) problem(`${report.errors.length} top-level errors`)
  const tests = playwrightTests(report.suites)
  counts.tests = tests.length
  if (tests.length !== plan.tests) problem(`${tests.length} tests, expected ${plan.tests}`)
  if (new Set(tests.map(({ spec }) => spec?.title)).size !== tests.length) problem("charter titles are not distinct")
  for (const { spec, test } of tests) {
    const where = String(spec?.title)
    if (typeof spec?.file !== "string" || basename(spec.file) !== plan.file) problem(`${where} comes from ${spec?.file}, not ${plan.file}`)
    if (test?.expectedStatus !== "passed") problem(`${where} is expected to ${test?.expectedStatus}`)
    const marks = (Array.isArray(test?.annotations) ? test.annotations : []).map((a) => a?.type).filter((t) => ["skip", "fixme", "fail"].includes(t))
    if (marks.length) problem(`${where} is annotated ${marks.join(",")}`)
    if (listing) continue
    const results = Array.isArray(test?.results) ? test.results : []
    if (test?.status !== "expected") problem(`${where} is ${test?.status}`)
    if (results.length !== 1 || results[0]?.status !== "passed" || results[0]?.retry !== 0) problem(`${where} did not pass on its one attempt`)
    else counts.passed++
  }
  if (!listing) {
    const stats = isRecord(report.stats) ? report.stats : (problem("stats are missing"), {})
    for (const [key, value] of [
      ["expected", plan.tests],
      ["unexpected", 0],
      ["flaky", 0],
      ["skipped", 0],
    ]) {
      if (stats[key] !== value) problem(`stats ${key} is ${stats[key]}, expected ${value}`)
    }
    if (!(Date.parse(stats.startTime) >= startedAtMs - TIME_SLACK_MS)) problem("report predates this suite's start")
  }
  return done()
}

/** `e2e list --reporter json` pairs against the plan: exact count per target, all to run, no setup. */
export function validateListedPairs(pairs, suite) {
  const plan = PLAN[suite]
  const problems = []
  if (!Array.isArray(pairs)) return { ok: false, problems: ["no pairs"], count: 0 }
  const perTarget = Object.create(null)
  for (const p of pairs) {
    if (p?.kind !== "test") problems.push(`${p?.title} is a ${p?.kind}`)
    if (p?.disposition !== "run") problems.push(`${p?.title} [${p?.target}] would be skipped (${p?.skipReason ?? "no reason"})`)
    if (typeof p?.file !== "string" || basename(p.file) !== plan.file) problems.push(`${p?.title} comes from ${p?.file}`)
    if (!Object.hasOwn(plan.targets, p?.target ?? "")) problems.push(`${p?.title} is on unplanned target ${p?.target}`)
    else perTarget[p.target] = (perTarget[p.target] ?? 0) + 1
  }
  for (const [t, n] of Object.entries(plan.targets)) {
    if ((perTarget[t] ?? 0) !== n) problems.push(`${t}: ${perTarget[t] ?? 0} collected, expected ${n}`)
  }
  return { ok: problems.length === 0, problems, count: pairs.length }
}

// ---- Partner files -------------------------------------------------------------------------------

/** The files a suite needs, and which are not in the harness yet. */
export function suiteFiles(suite, dir = HARNESS) {
  const plan = PLAN[suite]
  const files = plan.kind === "playwright" ? [plan.file, plan.config] : [plan.file]
  return { files, missing: files.filter((f) => !existsSync(join(dir, f))) }
}

/** The charters run against this run's app only: their config may not start a server of its own. */
export function requireNoWebServer(dir = HARNESS) {
  const source = readFileSync(join(dir, PLAN.charters.config), "utf8")
  if (/\bwebServer\b/.test(source)) fail(`${PLAN.charters.config} mentions webServer; the charters use run.mjs's app only.`)
}

// ---- The commands ---------------------------------------------------------------------------------

const E2E_HOME = process.env.B02_E2E_HOME ?? homedir()
const E2E = join(E2E_HOME, "node_modules", ".bin", "e2e")
const LOCK_SECONDS = 60
const SEED_MS = 600_000
const BUILD_MS = 900_000
const READY_MS = 180_000
const SUITE_MS = 1_800_000
const CHARTERS_MS = 900_000

const playwrightBin = (checkout) => join(checkout, "node_modules", ".bin", "playwright")

/**
 * Every guard, read-only: the pin, the exact candidate checkout and its
 * migrations, the harness state, the spare6 spec, running state, project and
 * applied revision, loopback env, a free app port with no listener, the
 * runners and (when asked) every selected suite's files.
 */
async function check({ suites = [...SUITES], requireFiles = false, requireCleanHarness = false } = {}) {
  requireCanonicalRoot()
  const pin = loadPin()
  const checkout = process.env.B02_CHECKOUT
  verifyCheckout(checkout, pin)
  verifyPinnedMigrations(checkout, pin)
  const harness = harnessState()
  if (requireCleanHarness && !harness.clean) fail("The harness directory has uncommitted changes; run a committed harness.")
  const stack = await import(pathToFileURL(join(checkout, "scripts", "ci", "stack.mjs")).href)
  if (stack.migrationsDigest(join(checkout, "supabase", "migrations")) !== pin.migrationsDigest) {
    fail("B02_CHECKOUT's supabase/migrations differ from the candidate commit's.")
  }
  const spec = stack.stackSpec(STACK.name)
  verifyStack(stack, spec, checkout, pin)
  const { env: stackEnv, secrets } = validatedStackEnvironment(stack, spec)
  await requireFreePort()
  if (!existsSync(E2E)) fail(`No standalone e2e at ${E2E}.`)
  for (const tool of ["tsx", "next", "playwright"]) {
    if (!existsSync(join(checkout, "node_modules", ".bin", tool))) fail(`The candidate checkout has no installed ${tool} (node_modules).`)
  }
  const awaiting = suites.flatMap((s) => suiteFiles(s).missing)
  if (requireFiles && awaiting.length) fail(`Selected suites are awaiting integration: ${awaiting.join(", ")}.`)
  if (suites.includes("charters") && suiteFiles("charters").missing.length === 0) requireNoWebServer()
  say(`checkout ${pin.commit} (tree ${pin.tree}) clean; ${STACK.name} running as ${STACK.project} with ${pin.migrationCount} pinned migrations; app port ${STACK.appPort} free`)
  say(`harness ${harness.commit} ${harness.clean ? "clean" : "with uncommitted changes"}${awaiting.length ? `; awaiting integration: ${awaiting.join(", ")}` : ""}`)
  return { pin, checkout, stack, spec, stackEnv, secrets, harness, id: null, runRoot: null, runDir: null }
}

/** The same guards again, and the env read again, inside the held lock immediately before seed. */
async function recheck(ctx, label) {
  requireCanonicalRoot()
  verifyLockOwner(label)
  const pin = loadPin()
  if (JSON.stringify(pin) !== JSON.stringify(ctx.pin)) fail("candidate.json changed during the run.")
  verifyCheckout(ctx.checkout, pin)
  verifyPinnedMigrations(ctx.checkout, pin)
  if (ctx.stack.migrationsDigest(join(ctx.checkout, "supabase", "migrations")) !== pin.migrationsDigest) {
    fail("B02_CHECKOUT's supabase/migrations differ from the candidate commit's.")
  }
  const harness = harnessState()
  if (harness.commit !== ctx.harness.commit || harness.clean !== ctx.harness.clean) fail("The harness changed during the run.")
  const spec = ctx.stack.stackSpec(STACK.name)
  verifyStack(ctx.stack, spec, ctx.checkout, pin)
  ;({ env: ctx.stackEnv, secrets: ctx.secrets } = validatedStackEnvironment(ctx.stack, spec))
  await requireFreePort()
  say("guards and stack env rechecked under the lock")
}

async function seed(ctx, label) {
  const { runRoot, world } = prepareRunRoot(ctx.id)
  ctx.runRoot = runRoot
  ctx.runDir = world
  startJournal(world, {
    runId: ctx.id,
    candidate: ctx.pin.commit,
    tree: ctx.pin.tree,
    migrationsDigest: ctx.pin.migrationsDigest,
    stack: STACK.name,
    app: APP,
    harness: ctx.harness.commit,
    pid: process.pid,
  })
  verifyLockOwner(label)
  const code = await bounded(
    ctx.stack,
    "seed",
    join(ctx.checkout, "node_modules", ".bin", "tsx"),
    [join(HARNESS, "seed.ts")],
    { cwd: ctx.checkout, env: seedEnv(process.env, ctx) },
    SEED_MS,
    ctx.secrets
  )
  if (code !== 0) fail(`Seed exited ${code}; ${JOURNAL} in ${world} lists what was created.`)
  if (!existsSync(join(world, "world.json"))) fail("Seed exited 0 without writing world.json.")
}

async function startApp(ctx, label) {
  const next = join(ctx.checkout, "node_modules", ".bin", "next")
  verifyLockOwner(label)
  // NEXT_PUBLIC_* are baked into the client bundle, so build with spare6's public env.
  const code = await bounded(ctx.stack, "next build", next, ["build"], { cwd: ctx.checkout, env: buildEnv(process.env, ctx) }, BUILD_MS, ctx.secrets)
  if (code !== 0) fail(`next build exited ${code}.`)
  // The build must not have moved the checkout off the candidate.
  verifyCheckout(ctx.checkout, ctx.pin)
  verifyLockOwner(label)
  await requireFreePort()
  const log = createWriteStream(join(ctx.runRoot, "app.log"), { flags: "wx", mode: 0o600 })
  const child = spawn(next, ["start", "--hostname", "127.0.0.1", "--port", String(STACK.appPort)], {
    cwd: ctx.checkout,
    env: serverEnv(process.env, ctx),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  for (const stream of [child.stdout, child.stderr]) {
    const redactor = lineRedactor(ctx.secrets, (text) => log.write(text))
    stream.setEncoding("utf8")
    stream.on("data", (chunk) => redactor.push(chunk))
    stream.once("close", () => redactor.end())
  }
  let exited = null
  child.on("error", () => (exited ??= 127))
  child.on("exit", (code) => (exited ??= code ?? 1))
  // The group outlives its leader if next forked workers, so stop it even
  // after the leader exited; without a pid nothing was started.
  let stopping = null
  const stop = () => (stopping ??= child.pid ? ctx.stack.terminateGroup(child.pid) : Promise.resolve())
  const unhook = ctx.stack.onTerminate(stop)
  const close = async () => {
    await stop()
    unhook()
    await new Promise((resolve) => log.end(resolve))
  }
  const deadline = Date.now() + READY_MS
  try {
    for (;;) {
      if (exited !== null) fail(`next start exited ${exited} before it was ready (app.log in ${ctx.runRoot}).`)
      try {
        const res = await fetch(`${APP}/login`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) break
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) fail(`${APP}/login was not ready within ${READY_MS / 1000}s.`)
      await new Promise((r) => setTimeout(r, 1000))
    }
    verifyServerOwner(STACK.appPort, child.pid)
  } catch (error) {
    await close()
    throw error
  }
  say(`app ready on ${APP} (pid ${child.pid}, its own process group serves the port, B02 switches on)`)
  return {
    pid: child.pid,
    async stop() {
      await close()
      say("app stopped")
    },
  }
}

async function runE2E(ctx, suite) {
  const out = freshOutput(ctx.runRoot, suite)
  const startedAtMs = Date.now()
  const code = await bounded(
    ctx.stack,
    `e2e ${suite}`,
    E2E,
    ["run", "--config", CONFIG, "--no-cache", "--retries", "0", "--workers", "1", "--trace=off", "--video=off"],
    { cwd: HARNESS, env: e2eEnv(process.env, ctx, suite) },
    SUITE_MS,
    ctx.secrets
  )
  const read = readJson(join(out, "report.json"))
  const verdict = read.problem ? { ok: false, problems: [`report.json is ${read.problem}`], counts: { expected: expectedInstances(suite) } } : validateE2EReport(read.value, suite, { startedAtMs })
  if (code !== 0) verdict.problems.unshift(`e2e exited ${code}`)
  return { exit: code, ok: code === 0 && verdict.ok && verdict.problems.length === 0, ...verdict }
}

async function runCharters(ctx) {
  const out = freshOutput(ctx.runRoot, "charters")
  mkdirSync(out, { mode: 0o700 })
  const reportFile = join(out, "report.json")
  requireNoWebServer()
  const startedAtMs = Date.now()
  const code = await bounded(
    ctx.stack,
    "playwright charters",
    playwrightBin(ctx.checkout),
    [
      "test",
      "--config",
      join(HARNESS, PLAN.charters.config),
      "--reporter=list,json",
      "--retries=0",
      "--workers=1",
      "--trace=off",
      "--forbid-only",
      "--fail-on-flaky-tests",
      `--output=${join(out, "test-results")}`,
    ],
    { cwd: HARNESS, env: playwrightEnv(process.env, ctx, reportFile) },
    CHARTERS_MS,
    ctx.secrets
  )
  const read = readJson(reportFile)
  const verdict = read.problem ? { ok: false, problems: [`report.json is ${read.problem}`], counts: { expected: PLAN.charters.tests } } : validatePlaywrightReport(read.value, { startedAtMs })
  if (code !== 0) verdict.problems.unshift(`playwright exited ${code}`)
  return { exit: code, ok: code === 0 && verdict.ok && verdict.problems.length === 0, ...verdict }
}

/** The run's account: candidate, harness, world, every suite's verdict and the artifact scrub. */
export function summarise({ id, pin, harness, suites, results, scrub, error }) {
  const passedInstances = suites.reduce((n, s) => n + (results[s]?.ok ? expectedInstances(s) : 0), 0)
  const complete = suites.length === SUITES.length
  const scrubProblems = [...(scrub?.binary ?? []).map((b) => `credential value in binary ${b.file}`), ...(scrub?.symlinks ?? []).map((s) => `symlink ${s}`)]
  const ok = !error && scrubProblems.length === 0 && suites.every((s) => results[s]?.ok === true)
  return {
    runId: id,
    candidate: pin,
    harness,
    stack: STACK.name,
    app: APP,
    selected: suites,
    complete,
    instances: { planned: TOTAL_INSTANCES, selected: suites.reduce((n, s) => n + expectedInstances(s), 0), passed: passedInstances },
    suites: Object.fromEntries(SUITES.map((s) => [s, results[s] ?? { status: suites.includes(s) ? "not run" : "not selected" }])),
    scrub: { redacted: scrub?.redacted ?? [], problems: scrubProblems },
    error: error ?? null,
    ok,
  }
}

async function lockedRun(flags, seedOnly) {
  const suites = seedOnly ? [] : suitesFrom(flags)
  const ctx = await check({ suites, requireFiles: !seedOnly, requireCleanHarness: true })
  ctx.id = runId()
  const label = `b02 agentic acceptance ${ctx.id}`
  const results = {}
  let error = null
  let summary = null
  await ctx.stack.withLock(ctx.spec, label, LOCK_SECONDS, async () => {
    try {
      await recheck(ctx, label)
      await seed(ctx, label)
      if (seedOnly) return
      const app = await startApp(ctx, label)
      try {
        for (const suite of suites) {
          verifyLockOwner(label)
          verifyServerOwner(STACK.appPort, app.pid)
          say(`${PLAN[suite].kind} ${suite}`)
          results[suite] = PLAN[suite].kind === "playwright" ? await runCharters(ctx) : await runE2E(ctx, suite)
        }
      } finally {
        await app.stop()
      }
    } catch (caught) {
      error = caught.message
      throw caught
    } finally {
      if (ctx.runRoot) {
        const scrub = scrubArtifacts(ctx.runRoot, ctx.secrets)
        summary = summarise({ id: ctx.id, pin: ctx.pin, harness: ctx.harness, suites, results, scrub, error: error && redact(error, ctx.secrets) })
        writeFileSync(join(ctx.runRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 })
      }
    }
  })
  if (seedOnly) {
    say(`seeded .results/${ctx.id}/world (${JOURNAL}, world.json)`)
    return summary.scrub.problems.length ? 1 : 0
  }
  for (const suite of suites) {
    const r = results[suite]
    say(`${suite}: ${r.ok ? "PASS" : "FAIL"} exit ${r.exit}; ${r.counts?.passed ?? 0}/${expectedInstances(suite)} passed; agent ${JSON.stringify(r.counts?.agentSteps ?? {})}, ${r.counts?.modelCalls ?? 0} model calls`)
    for (const p of r.problems ?? []) say(`  ${suite}: ${p}`)
  }
  for (const p of summary.scrub.problems) say(`  artifacts: ${p}`)
  say(`${summary.instances.passed}/${summary.instances.selected} selected instances passed (${TOTAL_INSTANCES} planned${summary.complete ? "" : "; partial run, not completion"})`)
  say(`summary .results/${ctx.id}/summary.json; reports .results/${ctx.id}/<suite>/`)
  return summary.ok ? 0 : 1
}

function listCommand(flags) {
  requireCanonicalRoot()
  if (!existsSync(E2E)) fail(`No standalone e2e at ${E2E}.`)
  const checkout = process.env.B02_CHECKOUT
  let failed = false
  let collected = 0
  const awaiting = []
  for (const suite of SUITES) {
    const { missing } = suiteFiles(suite)
    if (missing.length) {
      awaiting.push(...missing)
      say(`list ${suite}: awaiting integration (${missing.join(", ")})`)
      continue
    }
    let verdict
    if (PLAN[suite].kind === "e2e") {
      const r = spawnSync(E2E, ["list", "--config", CONFIG, "--reporter", "json"], { cwd: HARNESS, encoding: "utf8", env: listEnv(suite) })
      let pairs
      try {
        pairs = JSON.parse(r.stdout).pairs
      } catch {
        pairs = undefined
      }
      verdict = r.status === 0 ? validateListedPairs(pairs, suite) : { ok: false, problems: [`e2e list exited ${r.status}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`], count: 0 }
    } else {
      try {
        requireNoWebServer()
        if (!checkout || !existsSync(playwrightBin(checkout))) fail("set B02_CHECKOUT to the candidate checkout to collect the charters with its Playwright")
        const r = spawnSync(playwrightBin(checkout), ["test", "--list", "--reporter=json", "--config", join(HARNESS, PLAN.charters.config)], {
          cwd: HARNESS,
          encoding: "utf8",
          env: listEnv(suite, process.env, checkout),
        })
        let report
        try {
          report = JSON.parse(r.stdout)
        } catch {
          report = undefined
        }
        const v = validatePlaywrightReport(report, { listing: true })
        verdict = r.status === 0 ? { ...v, count: v.counts.tests } : { ok: false, problems: [`playwright --list exited ${r.status}`, ...v.problems], count: 0 }
      } catch (error) {
        verdict = { ok: false, problems: [error.message], count: 0 }
      }
    }
    collected += verdict.ok ? verdict.count : 0
    failed ||= !verdict.ok
    say(`list ${suite}: ${verdict.ok ? "ok" : "FAIL"}, ${verdict.count} collected of ${expectedInstances(suite)}`)
    for (const p of verdict.problems) say(`  ${suite}: ${p}`)
  }
  say(`collected ${collected} of ${TOTAL_INSTANCES} planned instances${awaiting.length ? `; awaiting integration: ${awaiting.join(", ")}` : ""}`)
  if (flags["require-all"] && awaiting.length) return 1
  return failed ? 1 : 0
}

async function main() {
  requireCanonicalRoot()
  // Everything this run writes (world, reports, screenshots, app log) is private.
  process.umask(0o077)
  const { command, flags } = parse(process.argv.slice(2))
  if (command === "list") return listCommand(flags)
  if (command === "check") {
    await check()
    return 0
  }
  if (command === "seed") return lockedRun(flags, true)
  if (command === "run") return lockedRun(flags, false)
  console.log(`usage: node run.mjs <list [--require-all]|check|seed|run --build [--suites ${SUITES.join(",")}]>`)
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
