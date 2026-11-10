#!/usr/bin/env node
// B02 agentic acceptance runner (README.md). Node only, no dependencies of its
// own: the stack lock, env and process-group helpers come from the candidate
// checkout's scripts/ci/stack.mjs, the seed runs with the checkout's tsx, the
// app is the checkout's `next start` after one fresh `next build` that the
// checkout's own scripts/ci/scan-bundle.mjs has scanned, the four e2e suites
// run on the reviewed standalone e2e installation, and the two interruption
// charters run on the checkout's own Playwright against the same app (no
// second server). The design is the reviewed B01 harness's
// (qa/b01-agentic-acceptance at 9926d0f9): the same guards, canonical spare6
// lock, per-run world, child-group settlement and locked environment refresh.
//
//   node run.mjs list [--require-all]           collect what exists (starts nothing)
//   node run.mjs check                          guards only, no lock, no writes
//   node run.mjs seed                           lock, guards, seed one world
//   node run.mjs run --build [--suites a,b]     lock, guards, seed, build, scan, app, suites, stop
//
// `run` always builds: the bundle must come from the pinned candidate with
// spare6's NEXT_PUBLIC_* env, and nothing here can prove an existing .next did.
// The only accepted head is candidate.json; the caller cannot choose another.
// Env: B02_CHECKOUT (the candidate checkout, required except for list) and
// B02_RUN_ID (optional). The e2e executable is fixed (E2E_INSTALL); nothing in
// the environment selects another. NABALENS_WS_ROOT must be unset. Nothing
// here prints a key, token or cookie: every outgoing string is redacted, child
// output is redacted line by line and every artifact is scrubbed once every
// process group this run started is proven gone.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants as FS,
  createWriteStream,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { connect } from "node:net"
import { hostname } from "node:os"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const HARNESS = realpathSync(dirname(fileURLToPath(import.meta.url)))
const RESULTS = join(HARNESS, ".results")
const CONFIG = join(HARNESS, "e2e.config.ts")

export function fail(message) {
  throw new Error(message)
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
const sameSet = (a, b) => {
  const x = new Set(a)
  const y = new Set(b)
  return x.size === y.size && [...x].every((v) => y.has(v))
}
const iso = () => new Date().toISOString()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Resolves DEADLINE instead of the promise's value once `ms` pass; a rejection still propagates. */
const DEADLINE = Symbol("deadline")
function within(promise, ms) {
  let timer
  return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(() => resolve(DEADLINE), ms)))]).finally(() => clearTimeout(timer))
}

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
/**
 * The durable blocking receipt beside the canonical lock (README.md,
 * "Settlement and the blocking receipt"). It exists from the moment a run holds
 * the lock until every process group it started is proven gone; on any
 * uncertainty, or if the runner dies first, it stays and every later run
 * refuses spare6 until the coordinator inspects it, cleans up and removes it.
 */
export const RECEIPT = "/tmp/nabalens-ws/spare6.b02-acceptance.receipt.json"
export const APP = `http://127.0.0.1:${STACK.appPort}`

const frozen = (value) => Object.freeze(Object.assign(Object.create(null), value))
/** The two B02-06 charter titles, exactly (charters.config.ts CHARTERS). */
export const CHARTER_TITLES = Object.freeze([
  "B02-06-A: an upload interrupted by closing its page is offered again on Me and finishes as one asset",
  "B02-06-B: a reason typed offline stays on this device only, survives leaving, and is saved and sent once back online",
])
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
  charters: frozen({
    kind: "playwright",
    file: "charters.playwright.ts",
    config: "charters.config.ts",
    tests: 2,
    project: "chromium-desktop",
    titles: CHARTER_TITLES,
  }),
})
export const SUITES = Object.freeze(Object.keys(PLAN))
export const expectedInstances = (suite) =>
  PLAN[suite].kind === "playwright" ? PLAN[suite].tests : Object.values(PLAN[suite].targets).reduce((a, b) => a + b, 0)
export const TOTAL_INSTANCES = SUITES.reduce((n, s) => n + expectedInstances(s), 0)
/** The planned viewports (fixture.ts VIEWPORT): an agent step that reports one must be on its own. */
export const VIEWPORTS = frozen({
  "phone-320": frozen({ width: 320, height: 568 }),
  "phone-375": frozen({ width: 375, height: 667 }),
  "phone-390": frozen({ width: 390, height: 844 }),
  desktop: frozen({ width: 1280, height: 800 }),
})

/** Exact membership: own names of PLAN only, never an inherited property such as "toString". */
export const isSuite = (name) => typeof name === "string" && SUITES.includes(name) && Object.hasOwn(PLAN, name)

/** The four B02 UI switches (lib/config/*), server-side, on for build and app. */
export const B02_SWITCHES = Object.freeze({
  NABALENS_HOME_LAYOUT: "b02",
  NABALENS_CONTRIBUTION_ENTRY: "b02",
  NABALENS_MY_CONTRIBUTIONS: "b02",
  NABALENS_MANAGER_TRIAGE: "b02",
})

// ---- The reviewed standalone e2e installation -----------------------------------------

/**
 * The one e2e executable live suites run: the reviewed standalone
 * installation and its saved model route (~/e2e.config.ts, e2e.config.ts:
 * chatgpt('gpt-6-luna')). Fixed here; no environment variable selects another.
 */
export const E2E_INSTALL = Object.freeze({
  bin: "/Users/amankumarshrestha/node_modules/.bin/e2e",
  root: "/Users/amankumarshrestha/node_modules/e2e",
  entry: "dist/cli/bin.js",
  name: "e2e",
  version: "0.16.0",
})
/** The saved route every live agent step must report (report-1 step.model). */
export const MODEL_ROUTE = Object.freeze({ provider: /^chatgpt(\.|$)/, model: "gpt-6-luna" })

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** A regular file this user (or root) owns that nobody else may write. */
function trustedFile(path, name) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    fail(`${name} is missing.`)
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${name} must be a regular file, not a link.`)
  const uid = process.getuid?.()
  if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) fail(`${name} belongs to another user.`)
  if (stat.mode & 0o022) fail(`${name} is writable by others.`)
}

/**
 * The reviewed e2e installation, validated before every use: the fixed bin
 * resolves to the installation's own CLI entry, whose package is e2e at the
 * reviewed version, both files owned here and not writable by others. Returns
 * the identity recorded in the receipt and summary (paths, version, hashes;
 * nothing secret). `install` is an offline test seam only; B02_E2E_HOME and any
 * other environment override are refused.
 */
export function resolveE2E(install = E2E_INSTALL, env = process.env) {
  if (env.B02_E2E_HOME !== undefined) {
    fail(`B02_E2E_HOME is not accepted: live suites run only the reviewed installation at ${E2E_INSTALL.bin}.`)
  }
  const entry = join(install.root, install.entry)
  let resolved
  try {
    resolved = realpathSync(install.bin)
  } catch {
    fail(`No standalone e2e at ${install.bin}.`)
  }
  if (resolved !== entry) fail(`${install.bin} resolves to ${resolved}, not the reviewed installation's ${entry}.`)
  if (realpathSync(install.root) !== install.root) fail(`${install.root} must be the installation's own directory, not a link.`)
  const manifest = join(install.root, "package.json")
  trustedFile(entry, "The e2e CLI entry")
  trustedFile(manifest, "The e2e package manifest")
  const pkg = JSON.parse(readFileSync(manifest, "utf8"))
  if (pkg.name !== install.name || pkg.version !== install.version) {
    fail(`The e2e installation is ${pkg.name}@${pkg.version}, not the reviewed ${install.name}@${install.version}.`)
  }
  return Object.freeze({ bin: install.bin, entry, name: pkg.name, version: pkg.version, entrySha256: sha256File(entry), manifestSha256: sha256File(manifest) })
}

/** The installation is still exactly the one recorded at the guards. */
function requireSameE2E(ctx) {
  const now = resolveE2E(ctx.e2eInstall ?? E2E_INSTALL)
  for (const key of ["entry", "version", "entrySha256", "manifestSha256"]) {
    if (now[key] !== ctx.e2e[key]) fail(`The e2e installation changed during the run (${key}).`)
  }
  return now
}

/** The candidate's own installed Playwright: its CLI and @playwright/test, both inside B02_CHECKOUT's node_modules. */
export function requirePlaywright(checkout) {
  const root = realpathSync(checkout)
  const modules = join(root, "node_modules") + sep
  const inside = (path) => {
    try {
      const resolved = realpathSync(path)
      return resolved.startsWith(modules) ? resolved : null
    } catch {
      return null
    }
  }
  const bin = inside(join(checkout, "node_modules", ".bin", "playwright"))
  if (!bin) fail("The candidate checkout has no installed playwright CLI inside its own node_modules.")
  const manifest = inside(join(checkout, "node_modules", "@playwright", "test", "package.json"))
  if (!manifest) fail("The candidate checkout has no installed @playwright/test inside its own node_modules.")
  const pkg = JSON.parse(readFileSync(manifest, "utf8"))
  if (pkg.name !== "@playwright/test" || typeof pkg.version !== "string") fail("The candidate's @playwright/test manifest is not Playwright's.")
  return Object.freeze({ bin, version: pkg.version })
}

// ---- Environment, by what each child actually needs ---------------------------------

/**
 * Inherited variables a child may see. Everything else (another stack's
 * Supabase URL or keys, a production DATABASE_URL, Vercel tokens, the B01
 * per-venue rollback lists, CI, GIT_*) is dropped rather than overridden.
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

/**
 * The bundle scan: the service key only, so scan-bundle.mjs's
 * secret-value rule looks for spare6's actual value in what browsers receive.
 */
export function scanEnv(base, ctx) {
  return childEnv(base, { SUPABASE_SERVICE_ROLE_KEY: ctx.stackEnv.SUPABASE_SERVICE_ROLE_KEY })
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

/** The two Playwright charters: the e2e values, plus the checkout (its Playwright) and, for the run, the JSON report path. */
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
      ...(reportFile ? { PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile } : {}),
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

/** Every credential value this process has read, for every outgoing string (kept for the process lifetime). */
const OUTGOING = []
export function registerSecrets(secrets) {
  for (const s of secrets) if (!OUTGOING.some((o) => o.value === s.value)) OUTGOING.push(s)
  OUTGOING.sort((a, b) => b.value.length - a.value.length)
}
/**
 * One outgoing string (console, diagnostics, summary, receipt): every known
 * credential redacted first, then cut to `limit` characters, so no cut can
 * leave part of a secret behind.
 */
export function outgoing(text, limit = 2000) {
  const s = redact(String(text), OUTGOING)
  return s.length > limit ? `${s.slice(0, limit)}… (${s.length - limit} more characters)` : s
}
const say = (message) => console.log(`b02: ${outgoing(message)}`)
/** What an outer failure prints: redacted and bounded. */
export const outwardFailure = (error) => `b02: ${outgoing(error?.message ?? error)}`

/** Diagnostics are bounded: at most MAX_PROBLEMS, each redacted and cut. */
const MAX_PROBLEMS = 40
function problemSink() {
  const problems = []
  let dropped = 0
  return {
    problems,
    problem(message) {
      if (problems.length < MAX_PROBLEMS) problems.push(outgoing(message, 400))
      else dropped++
    },
    list: () => (dropped ? [...problems, `…and ${dropped} more problems`] : [...problems]),
  }
}
const boundProblems = (list) => {
  const sink = problemSink()
  for (const p of list) sink.problem(p)
  return sink.list()
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

// ---- Private paths ------------------------------------------------------------------

const NOFOLLOW = FS.O_NOFOLLOW ?? 0
const ownUid = () => process.getuid?.()

function fsyncDir(dir) {
  const fd = openSync(dir, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** A real directory (never followed through a link) this user owns and nobody else can enter. */
export function requirePrivateDir(path, name) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    fail(`${name} is missing.`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${name} must be a real directory, not a link.`)
  const uid = ownUid()
  if (uid !== undefined && stat.uid !== uid) fail(`${name} belongs to another user.`)
  if (stat.mode & 0o077) fail(`${name} is not private (mode ${(stat.mode & 0o777).toString(8)}).`)
}

/** Creates `path` exclusively (an existing file or link is refused, never followed), private and durable. */
export function createPrivateFile(path, text) {
  const fd = openSync(path, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | NOFOLLOW, 0o600)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  fsyncDir(dirname(path))
}

/** A private append stream created exclusively (app.log). */
export function privateStream(path) {
  const fd = openSync(path, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | NOFOLLOW, 0o600)
  const stream = createWriteStream(null, { fd })
  // Late output (from a group that never settled) after close is dropped, never a crash.
  stream.on("error", () => {})
  let closed = false
  return {
    write: (text) => (closed ? undefined : stream.write(text)),
    close: () => {
      closed = true
      return new Promise((resolve) => stream.end(resolve))
    },
  }
}

const REPORT_MAX = 64 * 1024 * 1024
/**
 * A JSON file, read without following a link and bounded in size. Never
 * throws: { value } or { problem } ("missing", "a link", "malformed", ...).
 */
export function readJson(file, max = REPORT_MAX) {
  let stat
  try {
    stat = lstatSync(file)
  } catch (error) {
    return { problem: error.code === "ENOENT" ? "missing" : "unreadable" }
  }
  if (stat.isSymbolicLink()) return { problem: "a link" }
  if (!stat.isFile()) return { problem: "not a regular file" }
  if (stat.size > max) return { problem: `larger than ${max} bytes` }
  let fd
  try {
    fd = openSync(file, FS.O_RDONLY | NOFOLLOW)
  } catch {
    return { problem: "unreadable" }
  }
  try {
    const size = Math.min(fstatSync(fd).size, max)
    const bytes = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const n = readSync(fd, bytes, read, size - read, read)
      if (n === 0) break
      read += n
    }
    return { value: JSON.parse(bytes.subarray(0, read).toString("utf8")) }
  } catch {
    return { problem: "malformed" }
  } finally {
    closeSync(fd)
  }
}

/** True when `bytes` is not exactly representable as UTF-8 text (so it cannot be rewritten safely). */
const notText = (bytes) => bytes.includes(0) || !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)

/**
 * Walks a run's output after every process group has settled: every
 * directory private (0700) and file private (0600); credential values in text
 * files replaced in place. A link (never followed), a value in a binary file,
 * a file another user owns, a file with other hard links or any special file
 * is reported, never rewritten: each fails qualification.
 */
export function scrubArtifacts(root, secrets) {
  const found = { redacted: [], binary: [], symlinks: [], unsafe: [] }
  let rootStat
  try {
    rootStat = lstatSync(root)
  } catch (error) {
    if (error.code !== "ENOENT") found.unsafe.push(`the run directory cannot be inspected (${error.code})`)
    return found
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    found.unsafe.push("the run directory is not a real directory")
    return found
  }
  const uid = ownUid()
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
      if (uid !== undefined && stat.uid !== uid) {
        found.unsafe.push(`${rel} belongs to another user`)
        continue
      }
      if (stat.isDirectory()) {
        walk(path)
        continue
      }
      if (!stat.isFile()) {
        found.unsafe.push(`${rel} is not a regular file`)
        continue
      }
      if (stat.nlink > 1) {
        found.unsafe.push(`${rel} has other hard links`)
        continue
      }
      const fd = openSync(path, FS.O_RDONLY | NOFOLLOW)
      let bytes
      try {
        fchmodSync(fd, 0o600)
        bytes = readFileSync(fd)
      } finally {
        closeSync(fd)
      }
      const hits = secrets.filter(({ value }) => bytes.includes(value))
      if (hits.length === 0) continue
      if (notText(bytes)) {
        for (const { name: secret } of hits) found.binary.push({ file: rel, secret })
        continue
      }
      const out = openSync(path, FS.O_WRONLY | FS.O_TRUNC | NOFOLLOW)
      try {
        writeSync(out, redact(bytes.toString("utf8"), secrets))
        fsyncSync(out)
      } finally {
        closeSync(out)
      }
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
  return stat
}

/**
 * The run's private output: .results/<id>/ is created exclusively (an id is
 * never reused), with world/ inside it. .results must be a real directory of
 * this harness that this user owns, so no link can move a run's evidence
 * elsewhere; it is made private if an offline check left it readable.
 */
export function prepareRunRoot(id, results = RESULTS) {
  if (!RUN_ID.test(id)) fail("not a run id")
  mkdirSync(results, { recursive: true, mode: 0o700 })
  const stat = realDirectory(results, ".results")
  const uid = ownUid()
  if (uid !== undefined && stat.uid !== uid) fail(".results belongs to another user.")
  if (stat.mode & 0o077) chmodSync(results, 0o700)
  if (dirname(realpathSync(results)) !== realpathSync(dirname(results))) fail(".results must sit directly in the harness.")
  const runRoot = join(results, id)
  try {
    mkdirSync(runRoot, { mode: 0o700 })
  } catch (error) {
    if (error.code === "EEXIST") fail(`.results/${id} already exists: use a new B02_RUN_ID.`)
    throw error
  }
  requirePrivateDir(runRoot, "The run directory")
  const world = join(runRoot, "world")
  mkdirSync(world, { mode: 0o700 })
  return { runRoot, world }
}

/** A suite's output directory: inside the private run, and new (no earlier report can be read as this run's). */
export function freshOutput(runRoot, suite) {
  if (!isSuite(suite)) fail(`${String(suite)} is not a suite.`)
  requirePrivateDir(runRoot, "The run directory")
  const dir = join(runRoot, suite)
  let exists = true
  try {
    lstatSync(dir)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    exists = false
  }
  if (exists) fail(`${relative(HARNESS, dir)} already exists; a suite writes into a new directory.`)
  return dir
}

export const JOURNAL = "world.journal.jsonl"

/** The seed journal's first line, fsynced with its directory before any seed write. */
export function startJournal(worldDir, header) {
  createPrivateFile(join(worldDir, JOURNAL), JSON.stringify({ at: iso(), kind: "header", ...header }) + "\n")
}

/** The summary, created exclusively in the private run directory and redacted as it is serialised. */
export function writeSummary(runRoot, summary, secrets = []) {
  try {
    requirePrivateDir(runRoot, "The run directory")
    const text = redact(redact(JSON.stringify(summary, null, 2), secrets), OUTGOING) + "\n"
    createPrivateFile(join(runRoot, "summary.json"), text)
    return { ok: true }
  } catch (error) {
    return { ok: false, problem: outgoing(`summary.json was not written (${error.code ?? error.message})`, 400) }
  }
}

// ---- The blocking receipt -----------------------------------------------------------------

const RECEIPT_SCHEMA = "b02-acceptance-receipt-1"

/** Refuses while any receipt (or anything else, a link included) is at the receipt path. */
export function requireNoReceipt(path = RECEIPT) {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error.code === "ENOENT") return
    fail(`The B02 receipt path ${path} cannot be inspected (${error.code}); the coordinator must check it.`)
  }
  let detail = stat.isSymbolicLink() ? "a link" : stat.isFile() ? "unreadable" : "not a file"
  if (stat.isFile()) {
    const read = readJson(path, 1024 * 1024)
    if (read.value) detail = `${read.value.state ?? "unknown"} receipt of run ${read.value.runId ?? "unknown"}, runner pid ${read.value.runner?.pid ?? "unknown"}`
  }
  fail(
    `${STACK.name} is blocked by an earlier B02 run's receipt at ${path} (${detail}). The coordinator inspects its recorded process groups, ` +
      "cleans up and removes it; no run starts while it remains."
  )
}

/**
 * Creates the receipt exclusively (an existing file or link is refused) in
 * the canonical root's own real directory, private and durable, and returns
 * its writer. Updates replace it atomically (private temp file, fsync,
 * rename, directory fsync). clear() is only for a run whose every group was
 * proven gone; block() records why the coordinator must look.
 */
export function createReceipt(path, identity) {
  const dir = dirname(path)
  realDirectory(dir, `${dir} (the receipt's directory)`)
  let data = { schema: RECEIPT_SCHEMA, state: "in-progress", ...identity, groups: [], reasons: [], createdAt: iso(), updatedAt: iso() }
  const text = () => outgoing(JSON.stringify(data, null, 2), 1024 * 1024) + "\n"
  createPrivateFile(path, text())
  let n = 0
  const replace = () => {
    const temp = join(dir, `.${basename(path)}.${process.pid}.${++n}.tmp`)
    createPrivateFile(temp, text())
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      unlinkSync(temp)
      fail(`The receipt at ${path} was replaced by something else.`)
    }
    renameSync(temp, path)
    fsyncDir(dir)
  }
  return {
    path,
    get data() {
      return data
    },
    update(patch) {
      data = { ...data, ...patch, updatedAt: iso() }
      replace()
    },
    block(reasons) {
      data = { ...data, state: "blocked", reasons: boundProblems(reasons), updatedAt: iso() }
      replace()
    },
    clear() {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isFile()) fail(`The receipt at ${path} was replaced by something else.`)
      unlinkSync(path)
      fsyncDir(dir)
    },
  }
}

// ---- Process groups --------------------------------------------------------------------------

export class Interrupted extends Error {}

/**
 * Kernel evidence for a process group, independent of any stop helper:
 * kill(-pgid, 0) fails with ESRCH only when no process is in the group.
 * "alive" when it succeeds, "ambiguous" on EPERM (a process exists that this
 * user may not signal), "unknown" on anything else.
 */
export function probeGroup(pgid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pgid) || pgid <= 1) return "unknown"
  try {
    kill(-pgid, 0)
    return "alive"
  } catch (error) {
    if (error.code === "ESRCH") return "absent"
    if (error.code === "EPERM") return "ambiguous"
    return "unknown"
  }
}

/**
 * The process table as { pid, ppid, pgid } rows (ps), or null when it cannot
 * be read: missing evidence, which the supervisor treats as uncertain.
 */
export function processTable() {
  const r = spawnSync("ps", ["-axo", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  if (r.error || r.status !== 0) return null
  const rows = []
  for (const line of r.stdout.split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
    if ([pid, ppid, pgid].every((n) => Number.isInteger(n) && n >= 0)) rows.push({ pid, ppid, pgid })
  }
  return rows
}

/** Every process descending from group `pgid` (its members and their children, any depth) that has left it, pid -> pgid. */
export function escapedDescendants(rows, pgid) {
  const children = new Map()
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, [])
    children.get(row.ppid).push(row)
  }
  const out = new Map()
  const queue = rows.filter((row) => row.pgid === pgid)
  const seen = new Set(queue.map((row) => row.pid))
  while (queue.length) {
    const row = queue.shift()
    if (row.pgid !== pgid) out.set(row.pid, row.pgid)
    for (const child of children.get(row.pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      queue.push(child)
    }
  }
  return out
}

async function absence(pgid, probe, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    const state = probe(pgid)
    if (state === "absent" || Date.now() >= deadline) return state
    await sleep(50)
  }
}

export const STOP_HELPER_MS = 30_000
export const ABSENCE_MS = 5_000
export const OUTPUT_MS = 10_000
export const WATCH_MS = 1_000
const CAPTURE_LIMIT = 16 * 1024 * 1024

/**
 * Owns every process group a run starts: seed, build, scan, app, collection,
 * e2e runners and Playwright. Each child is its own group. A group counts as
 * settled only when the stop helper has returned and the kernel then shows
 * no member (probeGroup), and its output has closed; anything else (a helper
 * that returns or throws while members remain, missing or ambiguous
 * evidence, output that never closes) is uncertain and recorded with the
 * group's identity in the receipt. Once interrupted, no phase or child starts
 * again (ensureActive), and interrupt() resolves only when every group has
 * been stopped and checked.
 */
export function createSupervisor({
  stack,
  receipt = null,
  probe = probeGroup,
  table = processTable,
  log = say,
  stopHelperMs = STOP_HELPER_MS,
  absenceMs = ABSENCE_MS,
  outputMs = OUTPUT_MS,
  watchMs = WATCH_MS,
} = {}) {
  const groups = []
  const reasons = []
  let interrupted = null
  let interrupting = null

  const view = (e) => ({
    role: e.role,
    pgid: e.pgid,
    command: e.command,
    startedAt: e.startedAt,
    state: e.state,
    stoppedAt: e.stoppedAt ?? null,
    escaped: [...new Set(e.escaped.values())],
    evidence: e.evidence ?? null,
  })
  /**
   * Descendants that leave the group (Playwright launches each browser
   * detached, in its own group) are recorded from the process table while
   * the group lives, so they can be stopped and checked too.
   */
  const watch = (entry) => {
    const rows = table()
    if (!rows) {
      entry.tableMissing = true
      return
    }
    let added = false
    for (const [pid, pgid] of escapedDescendants(rows, entry.pgid)) {
      if (!entry.escaped.has(pid)) added = true
      entry.escaped.set(pid, pgid)
    }
    if (added) persist()
  }
  /** Stops each recorded escaped group whose live members are pids this run recorded; anything else is uncertain. */
  const stopEscaped = async (entry) => {
    const states = []
    for (const pgid of new Set(entry.escaped.values())) {
      if (probe(pgid) === "absent") {
        states.push([pgid, "absent"])
        continue
      }
      const rows = table()
      const members = rows ? rows.filter((row) => row.pgid === pgid) : null
      if (!members || (members.length && !members.some((row) => entry.escaped.has(row.pid)))) {
        states.push([pgid, members ? "not proven this run's" : "unknown"])
        continue
      }
      try {
        if ((await within(Promise.resolve().then(() => stack.terminateGroup(pgid)), stopHelperMs)) === DEADLINE) states.push([pgid, "stop helper did not return"])
      } catch {
        // The probe below decides.
      }
      states.push([pgid, await absence(pgid, probe, absenceMs)])
    }
    return states
  }
  const persist = () => {
    if (!receipt) return
    try {
      receipt.update({ groups: groups.map(view), reasons: boundProblems(reasons), interrupted })
    } catch (error) {
      reasons.push(`the receipt could not be updated (${error.code ?? error.message})`)
    }
  }
  const doubt = (entry, why) => {
    if (entry) entry.state = "uncertain"
    reasons.push(entry ? `${entry.role} (process group ${entry.pgid}): ${why}` : why)
    persist()
  }
  const track = (role, pid, cmd) => {
    const entry = { role, pgid: pid, command: basename(String(cmd)), startedAt: iso(), state: "running", escaped: new Map() }
    groups.push(entry)
    persist()
    entry.watcher = setInterval(() => watch(entry), watchMs)
    entry.watcher.unref?.()
    return entry
  }

  function stop(entry) {
    entry.stopping ??= (async () => {
      clearInterval(entry.watcher)
      watch(entry)
      let helper = "returned"
      try {
        if ((await within(Promise.resolve().then(() => stack.terminateGroup(entry.pgid)), stopHelperMs)) === DEADLINE) helper = "did not return"
      } catch {
        helper = "threw"
      }
      const group = await absence(entry.pgid, probe, absenceMs)
      const escaped = await stopEscaped(entry)
      entry.stoppedAt = iso()
      entry.evidence = { stopHelper: helper, group, escaped: Object.fromEntries(escaped), processTable: entry.tableMissing ? "unavailable" : "read" }
      const left = escaped.filter(([, state]) => state !== "absent")
      if (group !== "absent") doubt(entry, `the group is ${group} after the stop helper ${helper}`)
      else if (left.length) doubt(entry, `escaped descendant groups remain: ${left.map(([pgid, state]) => `${pgid} ${state}`).join(", ")}`)
      else if (entry.tableMissing) doubt(entry, "the process table could not be read, so escaped descendants are unknown")
      else {
        entry.state = "settled"
        persist()
      }
      return entry.state === "settled"
    })()
    return entry.stopping
  }

  function attach(child, { secrets = [], out = process.stdout, err = process.stderr, capture = false } = {}) {
    const drains = []
    let captured = ""
    let overflow = false
    const keep = (text) => {
      if (captured.length + text.length > CAPTURE_LIMIT) overflow = true
      else captured += text
    }
    for (const [stream, write] of [
      [child.stdout, capture ? keep : (text) => out.write(text)],
      [child.stderr, (text) => err.write(text)],
    ]) {
      if (!stream) continue
      const redactor = lineRedactor(secrets, write)
      stream.setEncoding("utf8")
      stream.on("data", (chunk) => redactor.push(chunk))
      drains.push(new Promise((done) => stream.once("close", () => (redactor.end(), done()))))
    }
    return { drained: () => Promise.all(drains), captured: () => ({ text: captured, overflow }) }
  }

  function outputSettled(entry, output) {
    const check = async () => {
      if ((await within(output.drained(), outputMs)) !== DEADLINE) return true
      doubt(entry, "its output did not close after the group stopped")
      return false
    }
    if (!entry) return check()
    entry.outputCheck ??= check()
    return entry.outputCheck
  }

  function ensureActive(phase) {
    if (interrupted) throw new Interrupted(`Interrupted (${interrupted}); ${phase} was not started.`)
  }

  /**
   * One bounded child in its own group: resolves { code, settled, output }
   * only after the group is stopped and checked and its output has closed.
   * 124 after the timeout, 130 after an interrupt, 127 when it cannot start.
   */
  function run(role, cmd, args, opts, ms, io = {}) {
    ensureActive(role)
    return new Promise((resolve) => {
      let child
      try {
        child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true })
      } catch {
        resolve({ code: 127, settled: true, output: "", overflow: false })
        return
      }
      const entry = child.pid ? track(role, child.pid, cmd) : null
      const output = attach(child, io)
      let cause = null
      if (entry) {
        entry.output = output
        entry.cause = (why) => (cause ??= why)
      }
      const timer = setTimeout(() => {
        if (!entry) return
        cause ??= "timeout"
        log(`${role} exceeded ${Math.round(ms / 1000)}s; stopping its process group`)
        stop(entry)
      }, ms)
      let finished = false
      const finish = async (code, spawnFailed) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        let settled = true
        if (entry) settled = await stop(entry)
        else if (!spawnFailed) {
          settled = false
          doubt(null, `${role} started without a process id`)
        }
        if (!(await outputSettled(entry, output))) settled = false
        const { text, overflow } = output.captured()
        resolve({ code: cause === "timeout" ? 124 : cause === "interrupt" ? 130 : code, settled, output: text, overflow })
      }
      child.on("error", () => finish(127, !child.pid))
      child.on("exit", (code, signal) => finish(code ?? (signal ? 124 : 1), false))
    })
  }

  /** A long-lived group (the app). Its stop() resolves true only when it is proven gone and its output closed. */
  function service(role, cmd, args, opts, io = {}) {
    ensureActive(role)
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true })
    const entry = child.pid ? track(role, child.pid, cmd) : null
    const output = attach(child, io)
    if (entry) entry.output = output
    let exited = null
    child.on("error", () => (exited ??= 127))
    child.on("exit", (code) => (exited ??= code ?? 1))
    return {
      pid: child.pid,
      exited: () => exited,
      stop: async () => (entry ? (await stop(entry)) && (await outputSettled(entry, output)) : outputSettled(null, output)),
    }
  }

  function interrupt(reason = "signal") {
    interrupted ??= reason
    if (!interrupting) {
      log(`interrupted (${reason}): no further phase or suite starts; stopping every process group this run owns`)
      for (const entry of groups) entry.cause?.("interrupt")
      persist()
      interrupting = Promise.all(groups.filter((e) => e.state === "running").map(stop))
    }
    return interrupting
  }

  /** Stops whatever still runs and checks every group and its output; the run is settled only if all of it is. */
  async function settle() {
    if (interrupting) await interrupting
    for (const entry of groups) {
      await stop(entry)
      if (entry.output) await outputSettled(entry, entry.output)
    }
    return report()
  }

  const report = () => ({
    settled: reasons.length === 0 && groups.every((e) => e.state === "settled"),
    interrupted,
    groups: groups.map(view),
    reasons: boundProblems(reasons),
  })

  return {
    run,
    service,
    stop,
    interrupt,
    ensureActive,
    settle,
    report,
    get interrupted() {
      return interrupted
    },
  }
}

// ---- Checkout, harness and stack guards ----------------------------------------------

/**
 * Git's environment for every identity and cleanliness check: nothing
 * inherited can select another repository, index, object store, replacement
 * refs or configuration (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
 * GIT_OBJECT_DIRECTORY, GIT_CONFIG_*, GIT_CEILING_DIRECTORIES, XDG_CONFIG_HOME
 * and the rest are dropped), and no global or system config applies.
 */
export function gitEnv(base = process.env) {
  return {
    ...inherit(base, ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"]),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  }
}
const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.excludesFile=/dev/null"]

const gitRaw = (dir, args, opts = {}) => spawnSync("git", [...GIT_SAFE, "-C", dir, ...args], { env: gitEnv(), ...opts })
const git = (dir, args, name = "B02_CHECKOUT") => {
  const r = gitRaw(dir, args, { encoding: "utf8" })
  if (r.status !== 0) fail(`git ${args[0]} failed in ${name}.`)
  return r.stdout.trim()
}

const MIGRATION = /^\d+_.+\.sql$/
const migrationHash = () => {
  const hash = createHash("sha256")
  return {
    add(file, bytes) {
      hash.update(file + "\0")
      hash.update(createHash("sha256").update(bytes).digest())
    },
    digest: () => hash.digest("hex"),
  }
}

/**
 * stack.mjs migrationsDigest, computed from the commit's tree rather than the
 * working tree, so untracked files cannot stand in for the candidate. Also
 * returns the exact ordered file names and their versions.
 */
export function commitMigrations(checkout, commit) {
  const files = git(checkout, ["ls-tree", "--name-only", `${commit}:supabase/migrations`])
    .split("\n")
    .filter((f) => MIGRATION.test(f))
    .sort()
  const hash = migrationHash()
  for (const file of files) {
    const blob = gitRaw(checkout, ["cat-file", "blob", `${commit}:supabase/migrations/${file}`], { maxBuffer: 256 * 1024 * 1024 })
    if (blob.status !== 0) fail(`git cat-file failed for migration ${file}.`)
    hash.add(file, blob.stdout)
  }
  return { digest: hash.digest(), count: files.length, latest: files.at(-1)?.split("_")[0] ?? null, files, versions: files.map((f) => f.split("_")[0]) }
}

/** The pinned commit's migrations are exactly the ones candidate.json records. */
export function verifyPinnedMigrations(checkout, pin) {
  return pinnedMigrations(checkout, pin).digest
}
export function pinnedMigrations(checkout, pin) {
  const m = commitMigrations(checkout, pin.commit)
  if (m.digest !== pin.migrationsDigest) fail("The candidate commit's migrations digest is not candidate.json's.")
  if (m.count !== pin.migrationCount || m.latest !== pin.latestMigration) {
    fail(`The candidate commit has ${m.count} migrations to ${m.latest}, not candidate.json's ${pin.migrationCount} to ${pin.latestMigration}.`)
  }
  return Object.freeze(m)
}

/**
 * A migration directory as it is on disk: the ordered migration file names
 * and the digest of their actual bytes (stack.mjs's algorithm), read without
 * following any link; a linked or non-regular migration is refused.
 */
export function migrationDirectory(dir, name) {
  realDirectory(dir, name)
  const files = readdirSync(dir)
    .filter((f) => MIGRATION.test(f))
    .sort()
  const hash = migrationHash()
  for (const file of files) {
    const path = join(dir, file)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) fail(`${name} has ${file} as a link or special file.`)
    const fd = openSync(path, FS.O_RDONLY | NOFOLLOW)
    try {
      hash.add(file, readFileSync(fd))
    } finally {
      closeSync(fd)
    }
  }
  return { files, digest: hash.digest() }
}

const firstDifference = (a, b) => {
  const i = a.findIndex((v, k) => v !== b[k])
  const at = i < 0 ? Math.min(a.length, b.length) : i
  return `at ${at}: ${a[at] ?? "nothing"} where the pin has ${b[at] ?? "nothing"}`
}

/** Exact ordered file names, then the digest of the actual bytes. */
export function compareMigrations(actual, pinned, name) {
  if (!sameList(actual.files, pinned.files)) {
    fail(`${name} are not the pinned ${pinned.files.length} migration files (${actual.files.length} found; first difference ${firstDifference(actual.files, pinned.files)}).`)
  }
  if (actual.digest !== pinned.digest) fail(`${name} differ in content from the pinned tree's migrations (digest).`)
}

/**
 * spare6's revision.json as stack.mjs's reset wrote it: a clean reset of
 * B02_CHECKOUT at the pin, recording exactly the pinned ordered migration
 * files and the pinned digest.
 */
export function verifyRevisionRecord(workdir, checkout, pin, pinned) {
  const read = readJson(join(workdir, "revision.json"), 1024 * 1024)
  if (read.problem) fail(`${STACK.name}'s revision.json is ${read.problem}; it was not reset by stack.mjs.`)
  const record = read.value
  if (!isRecord(record)) fail(`${STACK.name}'s revision.json is not a record.`)
  if (record.commit !== pin.commit || record.dirty !== false) fail(`${STACK.name}'s revision.json records ${record.commit}${record.dirty ? " (dirty)" : ""}, not the clean pin.`)
  if (!record.from || real(record.from) !== real(checkout)) fail(`${STACK.name}'s revision.json records another checkout, not B02_CHECKOUT.`)
  if (!Array.isArray(record.migrationFiles) || !sameList(record.migrationFiles, pinned.files)) {
    fail(`${STACK.name}'s revision.json migration files are not the pinned files (first difference ${firstDifference(record.migrationFiles ?? [], pinned.files)}).`)
  }
  if (record.migrationsDigest !== pin.migrationsDigest) fail(`${STACK.name}'s revision.json migrations digest is not the pinned one.`)
}

/** The database's applied ledger is exactly the pinned ordered versions. */
export function verifyLedger(versions, pinned) {
  if (!Array.isArray(versions)) fail(`${STACK.name}'s applied migration ledger could not be read.`)
  if (!sameList(versions, pinned.versions)) {
    fail(`${STACK.name}'s applied ledger has ${versions.length} versions, not the pinned ${pinned.versions.length} (first difference ${firstDifference(versions, pinned.versions)}).`)
  }
}

/**
 * The applied ordered version ledger (supabase_migrations.schema_migrations),
 * read only, with the database URL passed through libpq variables, never a
 * command line.
 */
export function psqlLedger(ctx) {
  const db = new URL(ctx.stackEnv.E2E_DB_URL)
  const env = {
    ...inherit(process.env, ["PATH", "HOME"]),
    PGHOST: db.hostname,
    PGPORT: db.port,
    PGUSER: decodeURIComponent(db.username) || "postgres",
    PGDATABASE: decodeURIComponent(db.pathname.slice(1)) || "postgres",
    ...(db.password ? { PGPASSWORD: decodeURIComponent(db.password) } : {}),
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c default_transaction_read_only=on",
  }
  const r = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: "select version from supabase_migrations.schema_migrations order by version;\n",
    encoding: "utf8",
    env,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  if (r.status !== 0) return null
  return r.stdout.split("\n").filter(Boolean)
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
 * and no local .env file that next build or start would read. Git runs with
 * gitEnv(), so no inherited GIT_* variable can point it elsewhere.
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
  // State inside the repository that status trusts and that could hide a
  // change: skip-worktree or assume-unchanged index bits, local exclude
  // rules and clean/smudge filters in the local config.
  const hidden = git(checkout, ["ls-files", "-v"])
    .split("\n")
    .filter((line) => /^([a-z]|S) /.test(line))
  if (hidden.length) fail(`B02_CHECKOUT marks ${hidden.length} tracked file(s) skip-worktree or assume-unchanged; status cannot see their changes.`)
  // Every ignored path must be ignored by a tracked .gitignore (so an
  // untracked .gitignore cannot hide its own directory, and local exclude
  // rules cannot hide source); only Claude tooling state may be ignored by
  // anything else.
  const ignoredRaw = gitRaw(checkout, ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=normal"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (ignoredRaw.status !== 0) fail("git status failed in B02_CHECKOUT.")
  const ignored = ignoredRaw.stdout.split("\0").filter((e) => e.startsWith("!! ")).map((e) => e.slice(3))
  if (ignored.length) {
    const why = gitRaw(checkout, ["check-ignore", "-v", "-z", "--no-index", "--stdin"], { encoding: "utf8", input: ignored.join("\0") + "\0", maxBuffer: 64 * 1024 * 1024 })
    if (why.status !== 0) fail("git check-ignore failed in B02_CHECKOUT.")
    const fields = why.stdout.split("\0")
    const sources = new Map()
    for (let i = 0; i + 3 < fields.length; i += 4) sources.set(fields[i + 3], fields[i])
    const tracked = new Set(
      git(checkout, ["ls-files", "-z", "--", ":(glob)**/.gitignore", ".gitignore"])
        .split("\0")
        .filter(Boolean)
    )
    const tooling = (path) => path === ".claude/" || path.startsWith(".claude/") || path.includes("/.claude/")
    const hiding = ignored.filter((path) => !tracked.has(sources.get(path) ?? "") && !tooling(path))
    if (hiding.length) fail(`B02_CHECKOUT has ignored paths that no tracked .gitignore ignores (${hiding.slice(0, 5).join(", ")}); local exclude rules or an untracked .gitignore could hide source.`)
  }
  const local = gitRaw(checkout, ["config", "--local", "--name-only", "--get-regexp", "^(filter\\.|core\\.(excludesfile|attributesfile|hookspath|worktree)$)"], { encoding: "utf8" })
  if (local.status === 0 && local.stdout.trim()) fail(`B02_CHECKOUT's local git config sets ${local.stdout.trim().split("\n").join(", ")}, which could hide or rewrite source.`)
  const envFiles = readdirSync(root).filter((name) => name.startsWith(".env") && name !== ".env.example")
  if (envFiles.length) fail(`B02_CHECKOUT has local env files (${envFiles.join(", ")}) that next would read; remove them.`)
}

/** The harness itself: its commit, tree and whether its directory is clean, for the summary and the run guard. */
export function harnessState(dir = HARNESS) {
  const head = git(dir, ["rev-parse", "HEAD"], "the harness")
  const tree = git(dir, ["rev-parse", "HEAD^{tree}"], "the harness")
  const top = git(dir, ["rev-parse", "--show-toplevel"], "the harness")
  const changes = git(dir, ["status", "--porcelain=v1", "--untracked-files=all", "--", "."], "the harness")
  return { commit: head, tree, root: real(top), clean: changes === "" }
}

/** The harness and the product under test are different identities: never the same commit or checkout. */
export function requireDistinctIdentities(harness, checkout, pin) {
  if (harness.commit === pin.commit || harness.tree === pin.tree) fail("The harness commit is the pinned candidate; the harness never qualifies itself.")
  if (harness.root && harness.root === real(checkout)) fail("B02_CHECKOUT is the harness checkout; point it at the candidate's own checkout.")
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

/**
 * The exact product inputs, checked under the lock before the seed, again
 * immediately before the build and again immediately before the app starts:
 * the clean checkout at the pin; the pinned tree's ordered migration files
 * and digest; the checkout's working migrations; spare6's spec and status;
 * the actual files and bytes in spare6's workdir migrations; its
 * revision.json; and the database's applied ordered version ledger.
 */
export function verifyProductInputs(ctx) {
  verifyCheckout(ctx.checkout, ctx.pin)
  const pinned = pinnedMigrations(ctx.checkout, ctx.pin)
  if (ctx.pinned && !sameList(pinned.files, ctx.pinned.files)) fail("The pinned tree's migration files changed during the run.")
  compareMigrations(migrationDirectory(join(ctx.checkout, "supabase", "migrations"), "B02_CHECKOUT's supabase/migrations"), pinned, "B02_CHECKOUT's supabase/migrations")
  const spec = ctx.stack.stackSpec(STACK.name)
  verifyStack(ctx.stack, spec, ctx.checkout, ctx.pin)
  const workdirMigrations = join(ctx.stackWorkdir, "supabase", "migrations")
  compareMigrations(migrationDirectory(workdirMigrations, `${STACK.name}'s workdir migrations`), pinned, `${STACK.name}'s workdir migrations`)
  verifyRevisionRecord(ctx.stackWorkdir, ctx.checkout, ctx.pin, pinned)
  verifyLedger(ctx.ledger(ctx), pinned)
  return pinned
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
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 30_000 })
  if (r.error || r.status === null) fail("lsof is unavailable; the app port's owner cannot be verified.")
  if (r.status !== 0 && r.stdout.trim() !== "") fail("lsof failed on the app port.")
  return r.stdout.split("\n").filter(Boolean).map(Number)
}

export function processGroupOf(pid) {
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 30_000 })
  const group = Number(r.stdout?.trim())
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

// ---- Report validation ------------------------------------------------------------------------

const TIME_SLACK_MS = 2000
const SHA256 = /^[0-9a-f]{64}$/
const isCount = (v) => Number.isInteger(v) && v >= 0
const isPositive = (v) => Number.isInteger(v) && v > 0
const pairKey = (target, titlePath) => JSON.stringify([target, titlePath])
const decodeTestId = (testId) => {
  try {
    return testId.split("::").map(decodeURIComponent)
  } catch {
    return null
  }
}

/**
 * Why an agent step is not live model work on the saved route, or null when
 * it is: passed; a positive integer count of model calls in its metrics and
 * in its model record; integer input and output token counts adding up to
 * more than zero; the saved provider and model; and nothing replayed from a
 * cache.
 */
export function liveModelWork(step) {
  if (step.status !== "passed") return `is ${step.status}`
  if (!isPositive(step.metrics?.modelCalls)) return "made no model calls"
  const model = step.model
  if (!isRecord(model) || !isPositive(model.calls)) return "has no model call record"
  if (!isCount(model.inputTokens) || !isCount(model.outputTokens) || model.inputTokens + model.outputTokens <= 0) return "has no token evidence"
  if (model.model !== MODEL_ROUTE.model || typeof model.provider !== "string" || !MODEL_ROUTE.provider.test(model.provider)) {
    return `used ${model.provider}/${model.model}, not the saved route`
  }
  if (isRecord(step.cache) && (step.cache.mode === "self-finalized" || (Number(step.cache.replayedActions) || 0) > 0)) return "was replayed from the cache"
  return null
}

/**
 * One e2e suite's report.json against the plan: a fresh report-1 document of
 * this suite's project, written by the reviewed e2e version, that passed with
 * exit 0 and no run errors; exactly the planned targets, each on the
 * runner-owned app origin; exactly the planned instances per target, each
 * selected, from the suite's file, with an identity that matches its title
 * path and (when given) one collected instance, passing on its one attempt;
 * serial members only through their group's one passing attempt on the same
 * target, every group linked to its selected results and nothing else; no
 * skip, flake, failure, replay or extra result. Model work counts only from
 * the exact selected passing attempt or linked passing member; where the plan
 * asks, a live step of the required kind with positive call and token
 * evidence (at each target when perTarget).
 */
export function validateE2EReport(report, suite, { startedAtMs = 0, collected = null, runner = null } = {}) {
  if (!isSuite(suite) || PLAN[suite].kind !== "e2e") fail(`${String(suite)} is not an e2e suite.`)
  const plan = PLAN[suite]
  const expected = expectedInstances(suite)
  const { problem, list } = problemSink()
  const counts = { expected, results: 0, reportedPassed: 0, agentSteps: {}, modelCalls: 0, stepTokens: 0, modelTokens: 0, live: {} }
  const done = () => {
    const problems = list()
    return { ok: problems.length === 0, problems, counts }
  }
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
  if (runner && (run.runner?.name !== runner.name || run.runner?.version !== runner.version)) {
    problem(`report was written by ${run.runner?.name} ${run.runner?.version}, not the reviewed ${runner.name} ${runner.version}`)
  }
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

  // Targets: exactly the planned ones, each on the runner-owned loopback app.
  const targets = Array.isArray(run.targets) ? run.targets : (problem("targets are missing"), [])
  const targetIds = new Set()
  for (const t of targets) {
    if (!isRecord(t) || typeof t.id !== "string") {
      problem("a target has no id")
      continue
    }
    if (targetIds.has(t.id)) problem(`target ${t.id} appears twice`)
    targetIds.add(t.id)
    if (!Object.hasOwn(plan.targets, t.id)) problem(`target ${t.id} is not planned`)
    if (t.baseOrigin !== APP) problem(`target ${t.id} has baseOrigin ${t.baseOrigin}, not ${APP}`)
  }
  for (const t of Object.keys(plan.targets)) if (!targetIds.has(t)) problem(`planned target ${t} is not in the report`)

  const results = Array.isArray(run.results) ? run.results : (problem("results are missing"), [])
  const groups = new Map()
  for (const g of Array.isArray(run.serialGroups) ? run.serialGroups : (problem("serial groups are missing"), [])) {
    if (!isRecord(g) || typeof g.id !== "string") problem("a serial group has no id")
    else if (groups.has(g.id)) problem(`serial group ${g.id} appears twice`)
    else groups.set(g.id, g)
  }
  counts.results = results.length
  if (results.length !== expected) problem(`${results.length} results, expected ${expected}`)
  const want = collected ? new Map(collected.map((p) => [pairKey(p.target, p.titlePath), false])) : null
  const linked = new Map()
  const perTarget = Object.create(null)
  const seen = new Set()
  const steps = []
  for (const r of results) {
    if (!isRecord(r)) {
      problem("a result is not an object")
      continue
    }
    const where = `${Array.isArray(r.titlePath) ? r.titlePath.join(" › ") : "?"} [${r.targetId}]`
    let countable = true
    const bad = (message) => {
      countable = false
      problem(message)
    }
    if (r.kind !== "test") bad(`${where} is a ${r.kind} result`)
    if (r.selected !== true) bad(`${where} was not selected`)
    if (r.status !== "passed") bad(`${where} is ${r.status}`)
    if (r.skip !== undefined) bad(`${where} carries a skip`)
    if (r.repeat !== 0) bad(`${where} is repeat ${r.repeat}`)
    if (r.file !== plan.file) bad(`${where} comes from ${r.file}, not ${plan.file}`)
    if (typeof r.targetId !== "string" || !Object.hasOwn(plan.targets, r.targetId)) bad(`${where} ran on an unplanned target`)
    else perTarget[r.targetId] = (perTarget[r.targetId] ?? 0) + 1
    const titled = Array.isArray(r.titlePath) && r.titlePath.length > 0 && r.titlePath.every((t) => typeof t === "string" && t.length > 0)
    const decoded = typeof r.testId === "string" ? decodeTestId(r.testId) : null
    if (typeof r.id !== "string" || !SHA256.test(r.id) || !titled || !decoded || !sameList(decoded, [plan.file, ...r.titlePath])) {
      bad(`${where} has an unsupported result identity`)
    }
    const key = pairKey(r.targetId, r.titlePath)
    if (seen.has(key)) bad(`${where} appears twice`)
    seen.add(key)
    if (want) {
      if (!want.has(key)) bad(`${where} was not collected for this suite`)
      else want.set(key, true)
    }
    let own = []
    if (r.serialGroupId !== undefined) {
      const g = groups.get(r.serialGroupId)
      if (Array.isArray(r.attempts) && r.attempts.length) bad(`${where} has attempts of its own besides its serial group`)
      if (!g) {
        bad(`${where} names a missing serial group`)
      } else {
        if (!linked.has(g.id)) linked.set(g.id, [])
        linked.get(g.id).push(r)
        const attempts = Array.isArray(g.attempts) ? g.attempts : []
        if (g.targetId !== r.targetId) bad(`${where} names serial group ${g.id} on target ${g.targetId}`)
        if (g.file !== plan.file) bad(`${where}'s serial group comes from ${g.file}`)
        if ((g.repeat ?? 0) !== 0) bad(`${where}'s serial group is repeat ${g.repeat}`)
        if (g.status !== "passed" || attempts.length !== 1 || attempts[0]?.status !== "passed" || attempts[0]?.index !== 0) {
          bad(`${where}'s serial group is ${g.status} after ${attempts.length} attempts`)
        }
        if (!Array.isArray(g.memberTestIds) || !g.memberTestIds.includes(r.testId)) bad(`${where} is not a declared member of its serial group`)
        const members = (Array.isArray(attempts[0]?.members) ? attempts[0].members : []).filter((m) => m?.testId === r.testId)
        if (members.length !== 1) bad(`${where} appears ${members.length} times in its serial group's attempt`)
        else if (members[0].status !== "passed" || members[0].skip !== undefined) bad(`${where} did not pass as a serial member`)
        else own = Array.isArray(members[0].steps) ? members[0].steps : []
      }
    } else {
      const attempts = Array.isArray(r.attempts) ? r.attempts : []
      if (attempts.length !== 1 || attempts[0]?.status !== "passed" || attempts[0]?.index !== 0) bad(`${where} did not pass on its one attempt`)
      else own = Array.isArray(attempts[0].steps) ? attempts[0].steps : []
    }
    if (r.status === "passed") counts.reportedPassed++
    // Model work counts only from the exact selected, passing attempt or linked member.
    if (countable) for (const step of own) steps.push({ target: r.targetId, step })
  }
  if (want) for (const [key, found] of want) if (!found) problem(`collected ${key} has no result`)
  // Every group is linked from selected results on its own target, and its members are exactly those results.
  for (const g of groups.values()) {
    const by = linked.get(g.id)
    if (!by) {
      problem(`serial group ${g.id} is not linked to any selected result`)
      continue
    }
    const declared = Array.isArray(g.memberTestIds) ? g.memberTestIds : []
    if (new Set(declared).size !== declared.length) problem(`serial group ${g.id} declares a member twice`)
    if (!sameSet(declared, by.map((r) => r.testId)) || declared.length !== by.length) problem(`serial group ${g.id}'s members are not exactly its linked results`)
    for (const attempt of Array.isArray(g.attempts) ? g.attempts : []) {
      const ids = (Array.isArray(attempt?.members) ? attempt.members : []).map((m) => m?.testId)
      if (new Set(ids).size !== ids.length) problem(`serial group ${g.id} repeats a member in one attempt`)
      if (!sameSet(ids, declared)) problem(`serial group ${g.id}'s attempt members are not its declared members`)
    }
  }
  for (const [targetId, n] of Object.entries(plan.targets)) {
    if ((perTarget[targetId] ?? 0) !== n) problem(`${targetId} has ${perTarget[targetId] ?? 0} results, expected ${n}`)
  }
  const live = counts.live
  for (const { target, step } of steps) {
    if (!isRecord(step) || step.kind !== "agent") continue
    const key = `${step.api}:${step.status}`
    counts.agentSteps[key] = (counts.agentSteps[key] ?? 0) + 1
    if (isCount(step.metrics?.modelCalls)) counts.modelCalls += step.metrics.modelCalls
    if (isRecord(step.model) && isCount(step.model.inputTokens) && isCount(step.model.outputTokens)) counts.stepTokens += step.model.inputTokens + step.model.outputTokens
    if (isRecord(step.cache) && (step.cache.mode === "self-finalized" || (Number(step.cache.replayedActions) || 0) > 0)) problem(`${step.api} at ${target} was replayed from the cache`)
    const viewport = VIEWPORTS[target]
    if (isRecord(step.viewport) && viewport && (step.viewport.width !== viewport.width || step.viewport.height !== viewport.height)) {
      problem(`${step.api} at ${target} measured ${step.viewport.width}x${step.viewport.height}, not ${viewport.width}x${viewport.height}`)
    }
    if (liveModelWork(step) === null) {
      live[target] ??= {}
      live[target][step.api] = (live[target][step.api] ?? 0) + 1
    }
  }
  counts.modelTokens = isCount(run.usage?.modelTokens) ? run.usage.modelTokens : 0
  if (plan.agent) {
    const { api, perTarget: each } = plan.agent
    const liveAt = (t) => live[t]?.[api] ?? 0
    if (each) {
      for (const t of Object.keys(plan.targets)) if (liveAt(t) < 1) problem(`no passed live ${api} with model calls and tokens at ${t}`)
    } else if (Object.keys(plan.targets).reduce((n, t) => n + liveAt(t), 0) < 1) {
      problem(`no passed live ${api} with model calls and tokens`)
    }
    if (!isPositive(run.usage?.modelTokens)) problem("the run used no model tokens")
  }
  return done()
}

/** Every test in a Playwright JSON report, with the spec it belongs to. */
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
 * the candidate's own Playwright version (when given), only the
 * chromium-desktop project with no retries, and exactly the two B02-06
 * charter titles from charters.playwright.ts in that project, each expected
 * to pass and passing on its single attempt, with no skip, flake or failure,
 * started after this suite began. `listing` checks a --list report instead
 * (collected tests and config only).
 */
export function validatePlaywrightReport(report, { startedAtMs = 0, listing = false, version = null } = {}) {
  const plan = PLAN.charters
  const { problem, list } = problemSink()
  const counts = { expected: plan.tests, tests: 0, reportedPassed: 0 }
  const done = () => {
    const problems = list()
    return { ok: problems.length === 0, problems, counts }
  }
  if (!isRecord(report) || !isRecord(report.config) || !Array.isArray(report.suites)) {
    problem("not a Playwright JSON report")
    return done()
  }
  if (report.config.webServer) problem("the charters config declares a webServer")
  if (version && report.config.version !== version) problem(`the report is from Playwright ${report.config.version}, not the candidate's ${version}`)
  const projects = Array.isArray(report.config.projects) ? report.config.projects : []
  if (projects.length !== 1 || projects[0]?.name !== plan.project) problem(`projects are ${projects.map((p) => p?.name).join(", ") || "none"}, expected only ${plan.project}`)
  for (const project of projects) {
    if (!listing && project?.retries !== 0) problem(`project ${project?.name} allows ${project?.retries} retries`)
  }
  if (!Array.isArray(report.errors)) problem("errors are missing")
  else if (report.errors.length) problem(`${report.errors.length} top-level errors`)
  const tests = playwrightTests(report.suites)
  counts.tests = tests.length
  if (tests.length !== plan.tests) problem(`${tests.length} tests, expected ${plan.tests}`)
  const titles = tests.map(({ spec }) => spec?.title)
  if (new Set(titles).size !== titles.length) problem("charter titles are not distinct")
  for (const title of titles) if (!plan.titles.includes(title)) problem(`"${title}" is not a planned charter title`)
  for (const title of plan.titles) if (!titles.includes(title)) problem(`charter "${title}" is missing`)
  for (const { spec, test } of tests) {
    const where = String(spec?.title)
    if (spec?.file !== plan.file) problem(`${where} comes from ${spec?.file}, not ${plan.file}`)
    if (test?.projectName !== plan.project) problem(`${where} ran in project ${test?.projectName}, not ${plan.project}`)
    if (test?.expectedStatus !== "passed") problem(`${where} is expected to ${test?.expectedStatus}`)
    const marks = (Array.isArray(test?.annotations) ? test.annotations : []).map((a) => a?.type).filter((t) => ["skip", "fixme", "fail"].includes(t))
    if (marks.length) problem(`${where} is annotated ${marks.join(",")}`)
    if (listing) continue
    const results = Array.isArray(test?.results) ? test.results : []
    if (test?.status !== "expected") problem(`${where} is ${test?.status}`)
    if (results.length !== 1 || results[0]?.status !== "passed" || results[0]?.retry !== 0) problem(`${where} did not pass on its one attempt`)
    else counts.reportedPassed++
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

/** `e2e list --reporter json` pairs against the plan: exact count per target, all to run, no setup, no duplicate. */
export function validateListedPairs(pairs, suite) {
  const plan = PLAN[suite]
  const { problem, list } = problemSink()
  if (!Array.isArray(pairs)) return { ok: false, problems: ["no pairs"], count: 0, pairs: [] }
  const perTarget = Object.create(null)
  const seen = new Set()
  for (const p of pairs) {
    if (p?.kind !== "test") problem(`${p?.title} is a ${p?.kind}`)
    if (p?.disposition !== "run") problem(`${p?.title} [${p?.target}] would be skipped (${p?.skipReason ?? "no reason"})`)
    if (p?.file !== plan.file) problem(`${p?.title} comes from ${p?.file}`)
    if (!Array.isArray(p?.titlePath) || p.titlePath.length === 0 || !p.titlePath.every((t) => typeof t === "string" && t)) problem(`${p?.title} has no title path`)
    if (!Object.hasOwn(plan.targets, p?.target ?? "")) problem(`${p?.title} is on unplanned target ${p?.target}`)
    else perTarget[p.target] = (perTarget[p.target] ?? 0) + 1
    const key = pairKey(p?.target, p?.titlePath)
    if (seen.has(key)) problem(`${p?.title} [${p?.target}] is collected twice`)
    seen.add(key)
  }
  for (const [t, n] of Object.entries(plan.targets)) {
    if ((perTarget[t] ?? 0) !== n) problem(`${t}: ${perTarget[t] ?? 0} collected, expected ${n}`)
  }
  const problems = list()
  return { ok: problems.length === 0, problems, count: pairs.length, pairs }
}

// ---- Partner files and the charters' config -----------------------------------------------------

/** The files a suite needs, and which are not in the harness yet. */
export function suiteFiles(suite, dir = HARNESS) {
  const plan = PLAN[suite]
  const files = plan.kind === "playwright" ? [plan.file, plan.config] : [plan.file]
  return { files, missing: files.filter((f) => !existsSync(join(dir, f))) }
}

const REGEX_MAY_FOLLOW = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"])
/**
 * A TypeScript source split into code (comments removed, string and
 * template text replaced by "") and the text of its string literals, without
 * executing anything.
 */
export function lexSource(source) {
  let code = ""
  const strings = []
  const resume = []
  let depth = 0
  let last = ""
  let i = 0
  const template = () => {
    let text = ""
    while (i < source.length) {
      const c = source[i]
      if (c === "\\") {
        text += source[i + 1] ?? ""
        i += 2
      } else if (c === "`") {
        i++
        strings.push(text)
        code += '""'
        last = '"'
        return
      } else if (c === "$" && source[i + 1] === "{") {
        i += 2
        strings.push(text)
        code += '"" + ('
        resume.push(depth)
        depth++
        last = "("
        return
      } else {
        text += c
        i++
      }
    }
    strings.push(text)
  }
  while (i < source.length) {
    const c = source[i]
    const d = source[i + 1]
    if (c === "/" && d === "/") {
      const end = source.indexOf("\n", i)
      i = end < 0 ? source.length : end
      code += " "
    } else if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2)
      i = end < 0 ? source.length : end + 2
      code += " "
    } else if (c === "'" || c === '"') {
      let text = ""
      i++
      while (i < source.length && source[i] !== c && source[i] !== "\n") {
        if (source[i] === "\\") {
          text += source[i + 1] ?? ""
          i += 2
        } else text += source[i++]
      }
      i++
      strings.push(text)
      code += '""'
      last = '"'
    } else if (c === "`") {
      i++
      template()
    } else if (c === "}" && resume.length && depth - 1 === resume.at(-1)) {
      depth--
      resume.pop()
      code += ") + "
      i++
      template()
    } else if (c === "/" && REGEX_MAY_FOLLOW.has(last)) {
      let inClass = false
      i++
      while (i < source.length && source[i] !== "\n") {
        const r = source[i]
        if (r === "\\") i += 2
        else {
          i++
          if (r === "[") inClass = true
          else if (r === "]") inClass = false
          else if (r === "/" && !inClass) break
        }
      }
      while (i < source.length && /[a-z]/i.test(source[i])) i++
      code += " /re/ "
      last = "/"
    } else {
      if (c === "{") depth++
      else if (c === "}") depth--
      code += c
      if (!/\s/.test(c)) last = c
      i++
    }
  }
  return { code, strings }
}

/**
 * Whether a config source actually declares a webServer, read statically
 * (never executed): the identifier in code, or a string (or template part)
 * that is exactly "webServer", as a quoted or computed key would be. A
 * mention in a comment or inside other string text is not one.
 */
export function declaresWebServer(source) {
  const { code, strings } = lexSource(source)
  return /\bwebServer\b/.test(code) || strings.includes("webServer")
}

/** The charters run against this run's app only: their config may not start a server of its own. */
export function requireNoWebServer(dir = HARNESS) {
  const source = readFileSync(join(dir, PLAN.charters.config), "utf8")
  if (declaresWebServer(source)) fail(`${PLAN.charters.config} declares a webServer; the charters use run.mjs's app only.`)
}

// ---- The phases ---------------------------------------------------------------------------------

const LOCK_SECONDS = 60
const SEED_MS = 600_000
const BUILD_MS = 900_000
const SCAN_MS = 300_000
const READY_MS = 180_000
const LIST_MS = 180_000
const SUITE_MS = 1_800_000
const CHARTERS_MS = 900_000
const FINALIZE_MS = 120_000

const tool = (checkout, name) => join(checkout, "node_modules", ".bin", name)

/**
 * Every guard, read-only: no receipt; the pin; the exact candidate checkout
 * and its pinned migrations; the harness state and its distinct identity; the
 * reviewed e2e installation; the spare6 spec, environment and every exact
 * product input (verifyProductInputs); a free app port with no listener; the
 * candidate's tools and (when asked) every selected suite's files.
 */
async function check({ suites = [...SUITES], requireFiles = false, requireCleanHarness = false } = {}) {
  requireCanonicalRoot()
  requireNoReceipt()
  const pin = loadPin()
  const checkout = process.env.B02_CHECKOUT
  verifyCheckout(checkout, pin)
  const pinned = pinnedMigrations(checkout, pin)
  const harness = harnessState()
  if (requireCleanHarness && !harness.clean) fail("The harness directory has uncommitted changes; run a committed harness.")
  requireDistinctIdentities(harness, checkout, pin)
  const e2e = resolveE2E()
  const stack = await import(pathToFileURL(join(checkout, "scripts", "ci", "stack.mjs")).href)
  const spec = stack.stackSpec(STACK.name)
  const ctx = { pin, pinned, checkout, stack, spec, stackWorkdir: spec.workdir, ledger: psqlLedger, harness, e2e, id: null, runRoot: null, runDir: null }
  ;({ env: ctx.stackEnv, secrets: ctx.secrets } = validatedStackEnvironment(stack, spec))
  registerSecrets(ctx.secrets)
  verifyProductInputs(ctx)
  await requireFreePort()
  for (const name of ["tsx", "next"]) if (!existsSync(tool(checkout, name))) fail(`The candidate checkout has no installed ${name} (node_modules).`)
  if (!existsSync(join(checkout, "scripts", "ci", "scan-bundle.mjs"))) fail("The candidate checkout has no scripts/ci/scan-bundle.mjs.")
  if (suites.includes("charters")) ctx.playwright = requirePlaywright(checkout)
  const awaiting = suites.flatMap((s) => suiteFiles(s).missing)
  if (requireFiles && awaiting.length) fail(`Selected suites are awaiting integration: ${awaiting.join(", ")}.`)
  if (suites.includes("charters") && suiteFiles("charters").missing.length === 0) requireNoWebServer()
  say(`checkout ${pin.commit} (tree ${pin.tree}) clean; ${STACK.name} running as ${STACK.project} with the pinned ${pin.migrationCount} migrations on disk, in revision.json and in its ledger; app port ${STACK.appPort} free`)
  say(`harness ${harness.commit} (tree ${harness.tree}) ${harness.clean ? "clean" : "with uncommitted changes"}; e2e ${e2e.version} at ${e2e.entry}${awaiting.length ? `; awaiting integration: ${awaiting.join(", ")}` : ""}`)
  return ctx
}

/** The same guards again, and the env read again, inside the held lock immediately before the seed. */
async function recheck(ctx, label, d) {
  requireCanonicalRoot()
  d.verifyLockOwner(label, d.lockDir)
  const pin = loadPin()
  if (JSON.stringify(pin) !== JSON.stringify(ctx.pin)) fail("candidate.json changed during the run.")
  const harness = harnessState()
  if (harness.commit !== ctx.harness.commit || harness.tree !== ctx.harness.tree || harness.clean !== ctx.harness.clean) fail("The harness changed during the run.")
  ;({ env: ctx.stackEnv, secrets: ctx.secrets } = validatedStackEnvironment(ctx.stack, ctx.stack.stackSpec(STACK.name)))
  registerSecrets(ctx.secrets)
  verifyProductInputs(ctx)
  requireSameE2E(ctx)
  await requireFreePort()
  say("guards, exact product inputs and stack env rechecked under the lock")
}

async function seedPhase(ctx, sup) {
  const r = await sup.run("seed", tool(ctx.checkout, "tsx"), [join(HARNESS, "seed.ts")], { cwd: ctx.checkout, env: seedEnv(process.env, ctx) }, SEED_MS, { secrets: ctx.secrets })
  if (r.code !== 0 || !r.settled) fail(`Seed exited ${r.code}${r.settled ? "" : " and its process group did not settle"}; ${JOURNAL} in ${ctx.runDir} lists what was created.`)
  const world = lstatSync(join(ctx.runDir, "world.json"), { throwIfNoEntry: false })
  if (!world || world.isSymbolicLink() || !world.isFile()) fail("Seed exited 0 without writing world.json.")
}

/** .next/BUILD_ID as it is now: the build's id and when it was written (no link followed). */
export function buildIdOf(checkout) {
  const dir = join(checkout, ".next")
  const stat = lstatSync(dir, { throwIfNoEntry: false })
  if (!stat) return null
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("The candidate's .next is not a real directory.")
  const file = join(dir, "BUILD_ID")
  const id = lstatSync(file, { throwIfNoEntry: false })
  if (!id) return null
  if (id.isSymbolicLink() || !id.isFile() || id.size > 4096) fail("The candidate's .next/BUILD_ID is not a small regular file.")
  return { id: readFileSync(file, "utf8").trim(), mtimeMs: id.mtimeMs }
}

/** The build the scan saw is the build the app will serve. */
function requireSameBuild(ctx) {
  const now = buildIdOf(ctx.checkout)
  if (!now || now.id !== ctx.build?.buildId || now.mtimeMs !== ctx.build?.mtimeMs) fail("The .next build changed after it was built and scanned.")
}

/**
 * One fresh production build of the clean pinned checkout with spare6's
 * public env and the four B02 switches. Its .next/BUILD_ID must be written by
 * this build, and the checkout must still be the clean pin afterwards.
 */
async function buildPhase(ctx, sup) {
  const startedAt = Date.now()
  const r = await sup.run("build", tool(ctx.checkout, "next"), ["build"], { cwd: ctx.checkout, env: buildEnv(process.env, ctx) }, BUILD_MS, { secrets: ctx.secrets })
  if (r.code !== 0 || !r.settled) fail(`next build exited ${r.code}${r.settled ? "" : " and its process group did not settle"}.`)
  verifyCheckout(ctx.checkout, ctx.pin)
  const built = buildIdOf(ctx.checkout)
  if (!built || !built.id || built.mtimeMs < startedAt - TIME_SLACK_MS) fail("next build did not write a fresh .next/BUILD_ID.")
  ctx.build = { buildId: built.id, mtimeMs: built.mtimeMs }
  const evidence = { buildId: built.id, startedAt: new Date(startedAt).toISOString(), finishedAt: iso(), switches: { ...B02_SWITCHES }, siteUrl: APP }
  say(`built ${built.id} with ${Object.keys(B02_SWITCHES).join(", ")}=b02`)
  return evidence
}

/** What scan-bundle.mjs --json said about the build, as summary evidence, or why it is not a clean scan. */
export function scanOutcome(child, buildId) {
  const problems = []
  let parsed = null
  if (child.overflow) problems.push("its output was larger than the capture limit")
  try {
    parsed = JSON.parse(child.output)
  } catch {
    problems.push("its output is not scan-bundle JSON")
  }
  if (child.code !== 0) problems.push(`it exited ${child.code}`)
  if (!child.settled) problems.push("its process group did not settle")
  if (parsed) {
    if (!isPositive(parsed.files)) problems.push("it scanned no files")
    if (!Array.isArray(parsed.findings) || parsed.findings.length !== 0) {
      problems.push(`it reported ${Array.isArray(parsed.findings) ? parsed.findings.length : "unreadable"} finding(s)`)
    }
    if (!Array.isArray(parsed.rules) || !parsed.rules.includes("secret-value:SUPABASE_SERVICE_ROLE_KEY")) problems.push("it did not look for spare6's service key value")
  }
  return {
    ok: problems.length === 0,
    problems: boundProblems(problems),
    evidence: parsed ? { buildId, files: parsed.files, bytesScanned: parsed.bytesScanned, rules: Array.isArray(parsed.rules) ? parsed.rules.length : null, findings: Array.isArray(parsed.findings) ? parsed.findings.length : null } : null,
  }
}

/** The candidate's own scripts/ci/scan-bundle.mjs on that same build; a finding or failure stops the run before the app starts. */
async function scanPhase(ctx, sup) {
  requireSameBuild(ctx)
  const scanner = join(ctx.checkout, "scripts", "ci", "scan-bundle.mjs")
  const r = await sup.run("scan", process.execPath, [scanner, "--root", ctx.checkout, "--dir", ".next", "--json"], { cwd: ctx.checkout, env: scanEnv(process.env, ctx) }, SCAN_MS, {
    secrets: ctx.secrets,
    capture: true,
  })
  const outcome = scanOutcome(r, ctx.build.buildId)
  if (!outcome.ok) fail(`The bundle scan of build ${ctx.build.buildId} failed: ${outcome.problems.join("; ")}.`)
  requireSameBuild(ctx)
  say(`bundle scan of ${ctx.build.buildId}: ${outcome.evidence.files} files, no findings`)
  return outcome.evidence
}

async function startApp(ctx, sup) {
  requireSameBuild(ctx)
  await requireFreePort()
  const log = privateStream(join(ctx.runRoot, "app.log"))
  ctx.appLog = log
  const app = sup.service("app", tool(ctx.checkout, "next"), ["start", "--hostname", "127.0.0.1", "--port", String(STACK.appPort)], { cwd: ctx.checkout, env: serverEnv(process.env, ctx) }, {
    secrets: ctx.secrets,
    out: log,
    err: log,
  })
  const deadline = Date.now() + READY_MS
  for (;;) {
    sup.ensureActive("app readiness")
    if (app.exited() !== null) fail(`next start exited ${app.exited()} before it was ready (app.log in ${ctx.runRoot}).`)
    try {
      const res = await fetch(`${APP}/login`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) break
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) fail(`${APP}/login was not ready within ${READY_MS / 1000}s.`)
    await sleep(1000)
  }
  verifyServerOwner(STACK.appPort, app.pid)
  say(`app ready on ${APP} (pid ${app.pid}, its own process group serves the port, B02 switches on)`)
  return app
}

/**
 * The suite's verdict from both the child's actual exit and its report: a
 * nonzero exit, an unsettled group or any report problem fails it, and only a
 * passing suite contributes its planned instances.
 */
export function combine(suite, child, verdict, label) {
  const problems = [...(child.code !== 0 ? [`${label} exited ${child.code}`] : []), ...(child.settled === true ? [] : [`${label}'s process group did not settle`]), ...verdict.problems]
  const ok = child.code === 0 && child.settled === true && verdict.ok === true && problems.length === 0
  return { ok, exit: child.code, settled: child.settled === true, problems: boundProblems(problems), counts: { ...verdict.counts, passed: ok ? expectedInstances(suite) : 0 } }
}
const failedVerdict = (suite, problem) => ({ ok: false, problems: [problem], counts: { expected: expectedInstances(suite) } })

const E2E_RUN_ARGS = ["--no-cache", "--retries", "0", "--workers", "1", "--trace=off", "--video=off"]

/** One e2e suite: collect it, check the collection, run it, then judge the exit and the report together. */
export async function runE2E(ctx, suite, sup) {
  const e2e = requireSameE2E(ctx)
  const env = e2eEnv(process.env, ctx, suite)
  const out = freshOutput(ctx.runRoot, suite)
  const listed = await sup.run(`e2e list ${suite}`, e2e.entry, ["list", "--config", CONFIG, "--reporter", "json"], { cwd: HARNESS, env }, LIST_MS, { secrets: ctx.secrets, capture: true })
  let pairs
  try {
    pairs = listed.overflow ? undefined : JSON.parse(listed.output).pairs
  } catch {
    pairs = undefined
  }
  const collection = validateListedPairs(pairs, suite)
  if (listed.code !== 0 || !listed.settled || !collection.ok) {
    return combine(suite, listed, { ok: false, problems: collection.problems.map((p) => `collection: ${p}`), counts: { expected: expectedInstances(suite) } }, `e2e list ${suite}`)
  }
  sup.ensureActive(`e2e ${suite}`)
  const startedAtMs = Date.now()
  const r = await sup.run(`e2e ${suite}`, e2e.entry, ["run", "--config", CONFIG, ...E2E_RUN_ARGS], { cwd: HARNESS, env }, SUITE_MS, { secrets: ctx.secrets })
  const outStat = lstatSync(out, { throwIfNoEntry: false })
  const read = outStat?.isSymbolicLink() ? { problem: "in a linked directory" } : readJson(join(out, "report.json"))
  const verdict = read.problem ? failedVerdict(suite, `report.json is ${read.problem}`) : validateE2EReport(read.value, suite, { startedAtMs, collected: collection.pairs, runner: e2e })
  return combine(suite, r, verdict, "e2e")
}

const CHARTER_ARGS = (out) => ["--reporter=list,json", "--retries=0", "--workers=1", "--trace=off", "--forbid-only", "--fail-on-flaky-tests", `--output=${join(out, "test-results")}`]

/**
 * The two charters on the candidate's own Playwright, on this run's app and
 * world: the config is checked statically (never executed) for a server,
 * then collected (exact titles, project and version, no webServer), then run;
 * the exit and the report decide together.
 */
export async function runCharters(ctx, sup) {
  const pw = requirePlaywright(ctx.checkout)
  const config = join(HARNESS, PLAN.charters.config)
  requireNoWebServer()
  const out = freshOutput(ctx.runRoot, "charters")
  mkdirSync(out, { mode: 0o700 })
  const listed = await sup.run("playwright list charters", pw.bin, ["test", "--list", "--reporter=json", "--config", config], { cwd: HARNESS, env: playwrightEnv(process.env, ctx, null) }, LIST_MS, {
    secrets: ctx.secrets,
    capture: true,
  })
  let listing
  try {
    listing = listed.overflow ? undefined : JSON.parse(listed.output)
  } catch {
    listing = undefined
  }
  const collection = validatePlaywrightReport(listing, { listing: true, version: pw.version })
  if (listed.code !== 0 || !listed.settled || !collection.ok) {
    return combine("charters", listed, { ok: false, problems: collection.problems.map((p) => `collection: ${p}`), counts: { expected: PLAN.charters.tests } }, "playwright --list")
  }
  sup.ensureActive("charters")
  const reportFile = join(out, "report.json")
  const startedAtMs = Date.now()
  const r = await sup.run("playwright charters", pw.bin, ["test", "--config", config, ...CHARTER_ARGS(out)], { cwd: HARNESS, env: playwrightEnv(process.env, ctx, reportFile) }, CHARTERS_MS, {
    secrets: ctx.secrets,
  })
  const read = readJson(reportFile)
  const verdict = read.problem ? failedVerdict("charters", `report.json is ${read.problem}`) : validatePlaywrightReport(read.value, { startedAtMs, version: pw.version })
  return combine("charters", r, verdict, "playwright")
}

const runSuite = (ctx, suite, sup) => (PLAN[suite].kind === "playwright" ? runCharters(ctx, sup) : runE2E(ctx, suite, sup))

/** The run's account: candidate, harness, e2e, world, build and scan evidence, every suite's verdict, settlement and the artifact scrub. */
export function summarise({ id, pin, harness, e2e = null, suites, results, scrub = {}, settlement, evidence = {}, error = null, interrupted = null, seedOnly = false }) {
  const passedInstances = suites.reduce((n, s) => n + (results[s]?.ok === true ? expectedInstances(s) : 0), 0)
  const complete = !seedOnly && suites.length === SUITES.length && SUITES.every((s) => suites.includes(s))
  const scrubProblems = [
    ...(scrub.skipped ? [`artifacts were not scrubbed: ${scrub.skipped}`] : []),
    ...(scrub.binary ?? []).map((b) => `credential value in binary ${b.file}`),
    ...(scrub.symlinks ?? []).map((s) => `symlink ${s}`),
    ...(scrub.unsafe ?? []).map((u) => `unsafe output: ${u}`),
  ]
  const settled = settlement?.settled === true
  const ok = !error && !interrupted && settled && scrubProblems.length === 0 && suites.every((s) => results[s]?.ok === true)
  return {
    schema: "b02-acceptance-summary-1",
    runId: id,
    candidate: pin,
    harness,
    e2e,
    stack: STACK.name,
    app: APP,
    selected: suites,
    complete,
    qualification: !ok ? "failed" : seedOnly ? "seed only" : complete ? "full" : "partial (never completion)",
    instances: { planned: TOTAL_INSTANCES, selected: suites.reduce((n, s) => n + expectedInstances(s), 0), passed: passedInstances },
    suites: Object.fromEntries(SUITES.map((s) => [s, results[s] ?? { status: suites.includes(s) ? "not run" : "not selected" }])),
    evidence,
    settlement: settlement ?? { settled: false, reasons: ["no settlement record"] },
    scrub: { redacted: scrub.redacted ?? [], problems: boundProblems(scrubProblems) },
    interrupted,
    error: error ? outgoing(error, 1000) : null,
    ok,
  }
}

/** What the receipt records about this run and process, for the coordinator (nothing secret). */
function receiptIdentity(ctx, label) {
  return {
    stack: STACK.name,
    lock: LOCK_DIR,
    runId: ctx.id,
    label,
    runner: { pid: process.pid, ppid: process.ppid, pgid: processGroupOf(process.pid), uid: ownUid() ?? null, host: hostname(), node: process.version, harness: HARNESS },
    harness: { commit: ctx.harness?.commit ?? null, tree: ctx.harness?.tree ?? null },
    candidate: { commit: ctx.pin?.commit ?? null, tree: ctx.pin?.tree ?? null },
    e2e: ctx.e2e ? { entry: ctx.e2e.entry, version: ctx.e2e.version, entrySha256: ctx.e2e.entrySha256 } : null,
    runRoot: null,
  }
}

/** The live phases; lockedRun's `overrides` replace them only in the offline tests. */
const LIVE = Object.freeze({
  check,
  recheck,
  seed: seedPhase,
  verifyInputs: verifyProductInputs,
  build: buildPhase,
  scan: scanPhase,
  startApp,
  runSuite,
  verifyLockOwner,
  verifyServerOwner,
  lockDir: LOCK_DIR,
  receiptPath: RECEIPT,
  results: RESULTS,
  probe: probeGroup,
  table: processTable,
  stopHelperMs: STOP_HELPER_MS,
  absenceMs: ABSENCE_MS,
  outputMs: OUTPUT_MS,
  finalizeMs: FINALIZE_MS,
})

/**
 * Under the held lock: refuse an earlier run's receipt, create this run's,
 * and run the phases through one supervisor. A signal (stack.onTerminate)
 * interrupts: no phase or suite starts again, and the hook returns, so the
 * lock is released, only after this function has settled every group and
 * finalised. Every group is stopped and proven gone (or recorded uncertain)
 * before the artifacts are scrubbed, the summary is written or the receipt
 * is cleared; on any uncertainty the receipt stays, blocked.
 */
async function underLock(ctx, label, suites, seedOnly, d) {
  d.verifyLockOwner(label, d.lockDir)
  requireNoReceipt(d.receiptPath)
  const receipt = createReceipt(d.receiptPath, receiptIdentity(ctx, label))
  const sup = createSupervisor({ stack: ctx.stack, receipt, probe: d.probe, table: d.table, stopHelperMs: d.stopHelperMs, absenceMs: d.absenceMs, outputMs: d.outputMs })
  let finalised
  const final = new Promise((resolve) => (finalised = resolve))
  const unhook = ctx.stack.onTerminate(async () => {
    await sup.interrupt("signal")
    if ((await within(final, d.finalizeMs)) === DEADLINE) {
      try {
        receipt.block([...sup.report().reasons, "the run did not finish settling and finalising before the signal handler's deadline"])
      } catch {
        // The in-progress receipt already blocks later runs.
      }
    }
  })
  const results = {}
  const evidence = {}
  let error = null
  try {
    await d.recheck(ctx, label, d)
    const { runRoot, world } = prepareRunRoot(ctx.id, d.results)
    ctx.runRoot = runRoot
    ctx.runDir = world
    receipt.update({ runRoot })
    startJournal(world, {
      runId: ctx.id,
      candidate: ctx.pin.commit,
      tree: ctx.pin.tree,
      migrationsDigest: ctx.pin.migrationsDigest,
      stack: STACK.name,
      app: APP,
      harness: ctx.harness.commit,
      harnessTree: ctx.harness.tree,
      pid: process.pid,
    })
    sup.ensureActive("seed")
    d.verifyLockOwner(label, d.lockDir)
    await d.seed(ctx, sup)
    if (!seedOnly) {
      sup.ensureActive("build")
      d.verifyLockOwner(label, d.lockDir)
      d.verifyInputs(ctx)
      evidence.build = await d.build(ctx, sup)
      sup.ensureActive("scan")
      d.verifyLockOwner(label, d.lockDir)
      evidence.scan = await d.scan(ctx, sup)
      sup.ensureActive("app")
      d.verifyLockOwner(label, d.lockDir)
      d.verifyInputs(ctx)
      const app = await d.startApp(ctx, sup)
      for (const suite of suites) {
        sup.ensureActive(suite)
        d.verifyLockOwner(label, d.lockDir)
        d.verifyServerOwner(STACK.appPort, app.pid)
        say(`${PLAN[suite].kind} ${suite}`)
        results[suite] = await d.runSuite(ctx, suite, sup)
      }
    }
    sup.ensureActive("the summary")
  } catch (caught) {
    error = caught
  }
  const settlement = await sup.settle()
  await ctx.appLog?.close()
  let summary = null
  let written = { ok: false, problem: "no run directory was created" }
  if (ctx.runRoot) {
    let scrub
    try {
      scrub = settlement.settled ? scrubArtifacts(ctx.runRoot, ctx.secrets ?? []) : { skipped: "process settlement is uncertain; the coordinator inspects the run directory" }
    } catch (caught) {
      scrub = { unsafe: [`the scrub stopped (${caught.code ?? caught.message})`] }
    }
    summary = summarise({
      id: ctx.id,
      pin: ctx.pin,
      harness: ctx.harness,
      e2e: ctx.e2e ?? null,
      suites,
      results,
      scrub,
      settlement,
      evidence,
      error: error?.message ?? null,
      interrupted: sup.interrupted,
      seedOnly,
    })
    written = writeSummary(ctx.runRoot, summary, ctx.secrets ?? [])
  }
  let receiptState = "cleared"
  try {
    if (settlement.settled) receipt.clear()
    else {
      receipt.block(settlement.reasons)
      receiptState = "blocked"
    }
  } catch (caught) {
    receiptState = `left in place (${caught.code ?? caught.message})`
  }
  finalised()
  unhook()
  return { summary, written, error, settlement, receiptState, interrupted: sup.interrupted }
}

/**
 * check, then the canonical lock, then everything under it. Exit 0 only when
 * every selected suite passed, every group settled, the artifacts are clean
 * and the summary was written; 130 after an interrupt; 1 otherwise.
 */
export async function lockedRun(flags, seedOnly, overrides = {}) {
  const d = { ...LIVE, ...overrides }
  const suites = seedOnly ? [] : suitesFrom(flags)
  const ctx = await d.check({ suites, requireFiles: !seedOnly, requireCleanHarness: true })
  ctx.id = runId(d.env ?? process.env)
  const label = `b02 agentic acceptance ${ctx.id}`
  const outcome = await ctx.stack.withLock(ctx.spec, label, LOCK_SECONDS, () => underLock(ctx, label, suites, seedOnly, d))
  const { summary, written, settlement } = outcome
  if (!settlement.settled) {
    say(`process settlement is uncertain; ${d.receiptPath} is ${outcome.receiptState} and blocks ${STACK.name} until the coordinator clears it`)
    for (const reason of settlement.reasons) say(`  settlement: ${reason}`)
  }
  if (!summary) throw outcome.error ?? new Error("The run stopped before it created its run directory.")
  for (const suite of suites) {
    const r = summary.suites[suite]
    say(`${suite}: ${r.ok ? "PASS" : "FAIL"} exit ${r.exit ?? "-"}; ${r.counts?.passed ?? 0}/${expectedInstances(suite)} passed; agent ${JSON.stringify(r.counts?.agentSteps ?? {})}, ${r.counts?.modelCalls ?? 0} model calls`)
    for (const p of r.problems ?? []) say(`  ${suite}: ${p}`)
  }
  for (const p of summary.scrub.problems) say(`  artifacts: ${p}`)
  if (summary.error) say(`error: ${summary.error}`)
  if (!written.ok) say(written.problem)
  say(`${summary.instances.passed}/${summary.instances.selected} selected instances passed (${TOTAL_INSTANCES} planned; ${summary.qualification})`)
  say(`summary .results/${ctx.id}/summary.json; reports .results/${ctx.id}/<suite>/`)
  if (outcome.interrupted) return 130
  return summary.ok && written.ok ? 0 : 1
}

function listCommand(flags) {
  requireCanonicalRoot()
  const e2e = resolveE2E()
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
    const bounded = { cwd: HARNESS, encoding: "utf8", timeout: LIST_MS, maxBuffer: CAPTURE_LIMIT, killSignal: "SIGKILL" }
    if (PLAN[suite].kind === "e2e") {
      const r = spawnSync(e2e.entry, ["list", "--config", CONFIG, "--reporter", "json"], { ...bounded, env: listEnv(suite) })
      let pairs
      try {
        pairs = JSON.parse(r.stdout).pairs
      } catch {
        pairs = undefined
      }
      verdict = r.status === 0 ? validateListedPairs(pairs, suite) : { ok: false, problems: [`e2e list exited ${r.status}: ${String(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`], count: 0 }
    } else {
      try {
        requireNoWebServer()
        if (!checkout || !isAbsolute(checkout)) fail("set B02_CHECKOUT to the candidate checkout to collect the charters with its Playwright")
        const pw = requirePlaywright(checkout)
        const r = spawnSync(pw.bin, ["test", "--list", "--reporter=json", "--config", join(HARNESS, PLAN.charters.config)], { ...bounded, env: listEnv(suite, process.env, checkout) })
        let report
        try {
          report = JSON.parse(r.stdout)
        } catch {
          report = undefined
        }
        const v = validatePlaywrightReport(report, { listing: true, version: pw.version })
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
  say(`collected ${collected} of ${TOTAL_INSTANCES} planned instances with e2e ${e2e.version}${awaiting.length ? `; awaiting integration: ${awaiting.join(", ")}` : ""}`)
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
      console.error(outwardFailure(error))
      process.exit(1)
    }
  )
}
