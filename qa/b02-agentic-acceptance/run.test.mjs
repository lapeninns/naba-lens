// Offline guard tests for run.mjs and fixture.ts: no database, app, browser,
// model, network, real stack or real lock. Temporary git repositories, fake
// psql, fake e2e, Playwright, next and bundle-scanner executables, a fake
// stack object and short-lived local process groups only.
//   node --test qa/b02-agentic-acceptance/run.test.mjs
// Uses this repository as a stand-in checkout where only git objects are
// needed (it contains the pinned candidate commit) and its
// scripts/ci/stack.mjs for the real process-group helpers.
import { forgetLiveLaneTouches, GUARD_IMPORT, liveLaneTouches } from "./offline-guard.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as realStack from "../../scripts/ci/stack.mjs"
import {
  APP,
  buildEnv,
  carriesMarker,
  CHARTER_TITLES,
  CHARTERS_CONFIG_SHA256,
  combine,
  commitMigrations,
  createReceipt,
  createSupervisor,
  escapedDescendants,
  privateStream,
  e2eEnv,
  E2E_INSTALL,
  expectedInstances,
  freshOutput,
  gitEnv,
  harnessState,
  HARNESS,
  isSuite,
  JOURNAL,
  lineRedactor,
  listEnv,
  liveModelWork,
  loadPin,
  lockedRun,
  outgoing,
  outwardFailure,
  groupProof,
  hasTmpdirEntry,
  ownedProcesses,
  parse,
  pinnedMigrations,
  PLAN,
  playwrightEnv,
  prepareRunRoot,
  probeGroup,
  processTable,
  provenOwned,
  psqlLedger,
  readJson,
  readPrivateJson,
  redact,
  registerSecrets,
  requireCanonicalRoot,
  requireDistinctIdentities,
  requireFreePort,
  requireLaneClear,
  requireLaunchOutput,
  requireNoQualificationBlocker,
  requireNoReceipt,
  requirePlaywright,
  requirePrivateChain,
  requireReviewedChartersConfig,
  REVIEWED_CHARTERS_CONFIG,
  resolveE2E,
  runCharters,
  runE2E,
  runId,
  scanEnv,
  scanOutcome,
  scrubArtifacts,
  secretsOf,
  seedEnv,
  serverEnv,
  startJournal,
  suiteFiles,
  suitesFrom,
  summarise,
  terminateProvenGroup,
  SUITES,
  TOTAL_INSTANCES,
  Uncertain,
  validatedStackEnvironment,
  validateE2EReport,
  validateListedPairs,
  validatePlaywrightReport,
  verifyCheckout,
  verifyFixtureManifest,
  verifyLockOwner,
  verifyPhysicalWorkdir,
  verifyPinnedMigrations,
  verifyProductInputs,
  verifyServerOwner,
  verifyStack,
  VIEWPORTS,
  writeSummary,
} from "./run.mjs"
import { recheckUnderLock, resetManifest as budgetResetManifest } from "./budget.mjs"

const RUNNER = fileURLToPath(new URL("./run.mjs", import.meta.url))
const FIXTURE = pathToFileURL(fileURLToPath(new URL("./fixture.ts", import.meta.url))).href
const REPO = fileURLToPath(new URL("../..", import.meta.url))

/** The exact application candidate this harness must accept (split contract), never the harness snapshot. */
const PINNED = {
  commit: "c467182323b9db4cbeb330db8248b3dd26042400",
  tree: "e2594b345e920f0e8baef81553d23fffe29ac697",
  migrationsDigest: "22f8296906983c88bc214c08c28b8c669914f41a321e16f7af0360bfe8359caf",
  migrationCount: 49,
  latestMigration: "20261110095911",
}
const HARNESS_SNAPSHOT = "2bfd50909d7773c5631c677910f94ad6e09ca63e"

const temp = (prefix = "b02-guard-") => realpathSync(mkdtempSync(join(tmpdir(), prefix)))
let fixtureImports = 0
const freshFixture = () => import(`${FIXTURE}?case=${++fixtureImports}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, ms = 20_000) {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting")
    await sleep(5)
  }
}
const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}
const sink = () => {
  let text = ""
  return { write: (t) => (text += t), text: () => text }
}

// ---- The pin ------------------------------------------------------------------------

test("candidate.json pins exactly the c4671823 application, its tree and its 49-migration digest", () => {
  assert.deepEqual({ ...loadPin() }, PINNED)
  assert.notEqual(loadPin().commit, HARNESS_SNAPSHOT)
  const fromGit = commitMigrations(REPO, PINNED.commit)
  assert.deepEqual({ digest: fromGit.digest, count: fromGit.count, latest: fromGit.latest }, { digest: PINNED.migrationsDigest, count: 49, latest: PINNED.latestMigration })
  assert.equal(fromGit.files.length, 49)
  assert.equal(fromGit.files.at(-1), "20261110095911_knowledge_b02c_manager_reservation_replay_scope.sql")
  assert.deepEqual(fromGit.versions, fromGit.files.map((f) => f.split("_")[0]))
  const tree = spawnSync("git", ["-C", REPO, "rev-parse", `${PINNED.commit}^{tree}`], { encoding: "utf8" }).stdout.trim()
  assert.equal(tree, PINNED.tree)
  assert.equal(verifyPinnedMigrations(REPO, loadPin()), PINNED.migrationsDigest)
})

test("a changed digest, count or latest migration in the pin is refused", () => {
  const pin = loadPin()
  assert.throws(() => verifyPinnedMigrations(REPO, { ...pin, migrationsDigest: "e".repeat(64) }), /digest is not candidate\.json's/)
  assert.throws(() => verifyPinnedMigrations(REPO, { ...pin, migrationCount: 48 }), /49 migrations/)
  assert.throws(() => verifyPinnedMigrations(REPO, { ...pin, latestMigration: "20261110095910" }), /49 migrations/)
  // The harness snapshot's own head has 48 migrations: never the candidate.
  assert.throws(() => verifyPinnedMigrations(REPO, { ...pin, commit: HARNESS_SNAPSHOT }), /digest/)
})

test("loadPin refuses malformed pins and unknown keys; fixture.pin() agrees", async () => {
  const dir = temp()
  const write = (value) => {
    const file = join(dir, `pin-${Math.random()}.json`)
    writeFileSync(file, JSON.stringify(value))
    return file
  }
  assert.throws(() => loadPin(write({ ...PINNED, head: PINNED.commit })), /unknown key head/)
  assert.throws(() => loadPin(write({ ...PINNED, commit: PINNED.commit.slice(0, 12) })), /full SHA/)
  assert.throws(() => loadPin(write({ ...PINNED, tree: undefined })), /tree/)
  assert.throws(() => loadPin(write({ ...PINNED, migrationsDigest: "abc" })), /sha256/)
  assert.throws(() => loadPin(write({ ...PINNED, migrationCount: "49" })), /count/)
  assert.throws(() => loadPin(write({ ...PINNED, latestMigration: "2026" })), /version/)
  assert.throws(() => loadPin(write([PINNED])), /object/)
  const fixture = await freshFixture()
  assert.deepEqual(fixture.pin(), PINNED)
  rmSync(dir, { recursive: true, force: true })
})

// ---- The candidate checkout -------------------------------------------------------------

const GITIGNORE = ".env*\n!.env.example\n.next/\nnode_modules/\n"
/** A clean temporary candidate at its own pin: two migrations, plus `files`. */
function gitRepo(files = {}) {
  const dir = temp("b02-checkout-")
  const g = (...args) => {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=guard", "-c", "user.email=guard@example.invalid", ...args], { encoding: "utf8", env: gitEnv() })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  g("init", "-q")
  const all = {
    "supabase/migrations/20260101000000_one.sql": "select 1;\n",
    "supabase/migrations/20260102000000_two.sql": "select 2;\n",
    ".gitignore": GITIGNORE,
    ".env.example": "EXAMPLE=1\n",
    ...files,
  }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  g("add", "-A")
  g("commit", "-q", "-m", "candidate")
  const commit = g("rev-parse", "HEAD")
  const m = commitMigrations(dir, commit)
  const pin = { commit, tree: g("rev-parse", "HEAD^{tree}"), migrationsDigest: m.digest, migrationCount: m.count, latestMigration: m.latest }
  return { dir, g, pin }
}

test("verifyCheckout accepts only the clean pinned worktree root", () => {
  const { dir, g, pin } = gitRepo()
  verifyCheckout(dir, pin)
  assert.equal(verifyPinnedMigrations(dir, pin), realStack.migrationsDigest(join(dir, "supabase", "migrations")))
  // Ignored build output is allowed.
  mkdirSync(join(dir, ".next"))
  writeFileSync(join(dir, ".next", "BUILD_ID"), "x")
  verifyCheckout(dir, pin)
  assert.throws(() => verifyCheckout("relative/path", pin), /absolute/)
  assert.throws(() => verifyCheckout(join(dir, "supabase"), pin), /root of its worktree/)
  assert.throws(() => verifyCheckout(dir, { ...pin, commit: "0".repeat(40) }), /not the pinned candidate/)
  assert.throws(() => verifyCheckout(dir, { ...pin, tree: "0".repeat(40) }), /tree/)
  // Untracked, tracked and ignored-env changes are each refused.
  writeFileSync(join(dir, "stray.txt"), "x")
  assert.throws(() => verifyCheckout(dir, pin), /untracked/)
  rmSync(join(dir, "stray.txt"))
  writeFileSync(join(dir, "supabase", "migrations", "20260101000000_one.sql"), "select 11;\n")
  assert.throws(() => verifyCheckout(dir, pin), /tracked changes/)
  g("checkout", "-q", "--", ".")
  writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=https://example.invalid\n")
  assert.throws(() => verifyCheckout(dir, pin), /local env files \(\.env\.local\)/)
  rmSync(join(dir, ".env.local"))
  // A new commit moves HEAD off the pin.
  writeFileSync(join(dir, "README"), "x")
  g("add", "README")
  g("commit", "-q", "-m", "moved")
  assert.throws(() => verifyCheckout(dir, pin), /not the pinned candidate/)
  rmSync(dir, { recursive: true, force: true })
})

function withEnv(values, fn) {
  const saved = {}
  for (const k of Object.keys(values)) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(restore)
}

test("git identity checks ignore an inherited repository, work tree, index and configuration", async () => {
  const pinned = gitRepo()
  const other = gitRepo({ "other.txt": "not the candidate\n" })
  assert.notEqual(other.pin.commit, pinned.pin.commit)
  const selectPinned = { GIT_DIR: join(pinned.dir, ".git"), GIT_WORK_TREE: pinned.dir, GIT_INDEX_FILE: join(pinned.dir, ".git", "index") }
  // The hazard: an inherited selection makes another checkout answer as the pin.
  const naive = spawnSync("git", ["-C", other.dir, "rev-parse", "HEAD"], { encoding: "utf8", env: { ...process.env, ...selectPinned } })
  assert.equal(naive.stdout.trim(), pinned.pin.commit)
  await withEnv(selectPinned, () => {
    assert.throws(() => verifyCheckout(other.dir, pinned.pin), /not the pinned candidate/)
    assert.throws(() => pinnedMigrations(other.dir, pinned.pin), /fatal|failed|digest/)
    verifyCheckout(pinned.dir, pinned.pin)
  })
  // A global or injected excludesFile would hide an untracked file from status.
  const dir = temp()
  writeFileSync(join(dir, "ignore"), "stray.txt\n")
  writeFileSync(join(dir, "gitconfig"), `[core]\n\texcludesFile = ${join(dir, "ignore")}\n`)
  writeFileSync(join(pinned.dir, "stray.txt"), "x")
  const hidden = spawnSync("git", ["-C", pinned.dir, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig") },
  })
  assert.equal(hidden.stdout.trim(), "")
  const injected = { GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesFile", GIT_CONFIG_VALUE_0: join(dir, "ignore"), XDG_CONFIG_HOME: dir }
  await withEnv(injected, () => assert.throws(() => verifyCheckout(pinned.dir, pinned.pin), /untracked/))
  const env = gitEnv({ ...process.env, ...selectPinned, ...injected, GIT_OBJECT_DIRECTORY: "/x", GIT_CEILING_DIRECTORIES: "/" })
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("GIT_")).sort(), ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_NO_REPLACE_OBJECTS", "GIT_OPTIONAL_LOCKS", "GIT_TERMINAL_PROMPT"])
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null")
  assert.equal(env.XDG_CONFIG_HOME, undefined)
  for (const r of [pinned, other]) rmSync(r.dir, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

test("the product and harness identities stay distinct", () => {
  const { dir, pin } = gitRepo()
  requireDistinctIdentities({ commit: "a".repeat(40), tree: "b".repeat(40), root: REPO }, dir, pin)
  assert.throws(() => requireDistinctIdentities({ commit: pin.commit, tree: "b".repeat(40), root: REPO }, dir, pin), /never qualifies itself/)
  assert.throws(() => requireDistinctIdentities({ commit: "a".repeat(40), tree: "b".repeat(40), root: dir }, dir, pin), /is the harness checkout/)
  rmSync(dir, { recursive: true, force: true })
})

test("the runner refuses a non-candidate checkout before any lock or write", () => {
  const id = `guard-${process.pid}-head`
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, B02_CHECKOUT: REPO, B02_RUN_ID: id, NODE_OPTIONS: GUARD_IMPORT }
  const r = spawnSync(process.execPath, [RUNNER, "run", "--build"], { env, encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /not the pinned candidate c467182323b9db4cbeb330db8248b3dd26042400/)
  assert.equal(existsSync(join(HARNESS, ".results", id)), false)
  const missing = spawnSync(process.execPath, [RUNNER, "seed"], { env: { ...env, B02_CHECKOUT: "" }, encoding: "utf8" })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /absolute path/)
})

// ---- The stack ---------------------------------------------------------------------------

const SPEC = {
  name: "spare6",
  block: 646,
  project: "nabalens-ws-spare6",
  workdir: "/tmp/nabalens-ws/spare6",
  apiPort: 64621,
  dbPort: 64622,
  mailpitPort: 64624,
  appPort: 3646,
}
const goodStatus = (pin = PINNED, from = REPO) => ({
  state: "running",
  project: SPEC.project,
  workdir: SPEC.workdir,
  migrations: { applied: pin.migrationCount, latest: pin.latestMigration, matchesRecordedFiles: true },
  lastReset: { from, commit: pin.commit, dirty: false, migrationsDigest: pin.migrationsDigest },
})
const checkStack = (status, spec = SPEC, pin = PINNED) => verifyStack({ statusOf: () => status }, spec, REPO, pin)

test("verifyStack accepts the clean candidate stack and rejects each mismatch", () => {
  checkStack(goodStatus())
  const cases = [
    [(s) => (s.state = "stopped"), /not running/],
    [(s) => (s.project = "nabalens-ws-spare5"), /not running/],
    [(s) => (s.workdir = "/tmp/elsewhere/spare6"), /not running/],
    [(s) => (s.lastReset = null), /no revision\.json/],
    [(s) => (s.lastReset.commit = HARNESS_SNAPSHOT), /not the clean candidate/],
    [(s) => (s.lastReset.dirty = true), /not the clean candidate/],
    [(s) => delete s.lastReset.dirty, /not the clean candidate/],
    [(s) => (s.lastReset.from = "/tmp"), /another checkout/],
    [(s) => (s.migrations = null), /applied migrations/],
    [(s) => (s.migrations.matchesRecordedFiles = false), /applied migrations/],
    [(s) => (s.migrations.applied = 48), /not the pinned 49/],
    [(s) => (s.migrations.latest = "20261110095910"), /not the pinned 49/],
    [(s) => (s.lastReset.migrationsDigest = "e".repeat(64)), /digest/],
  ]
  for (const [mutate, message] of cases) {
    const status = goodStatus()
    mutate(status)
    assert.throws(() => checkStack(status), message)
  }
  assert.throws(() => checkStack(goodStatus(), { ...SPEC, workdir: "/tmp/elsewhere/spare6" }), /workdir/)
  assert.throws(() => checkStack(goodStatus(), { ...SPEC, appPort: 3645 }), /appPort/)
})

const stackEnvOf = (overrides = {}) => ({
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:64621",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dummy-publishable-value",
  SUPABASE_SERVICE_ROLE_KEY: "dummy-service-role-value",
  SUPABASE_DB_URL: "postgresql://postgres:dummy-db-password@127.0.0.1:64622/postgres",
  E2E_DB_URL: "postgresql://postgres:dummy-db-password@127.0.0.1:64622/postgres",
  SUPABASE_JWT_SECRET: "dummy-jwt-secret-value",
  MAILPIT_URL: "http://127.0.0.1:64624",
  E2E_SUPABASE_WORKDIR: "/tmp/nabalens-ws/spare6",
  ...overrides,
})

/** `supabase status -o json` as it would answer for the workdir stack.mjs cached `env` from. */
const freshOf = (env, overrides = {}) => ({
  API_URL: env.NEXT_PUBLIC_SUPABASE_URL,
  DB_URL: env.E2E_DB_URL,
  PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET: env.SUPABASE_JWT_SECRET,
  MAILPIT_URL: env.MAILPIT_URL,
  ...overrides,
})
/** A fresh status that agrees with whatever the stack's cached env says now. */
const agreeing = (stack) => () => freshOf(stack.stackEnv())

test("the stack environment is read fresh, validated, narrowed to four values and its credentials collected", () => {
  let generation = 1
  const stack = { stackEnv: () => stackEnvOf({ SUPABASE_SERVICE_ROLE_KEY: `dummy-service-role-${generation}` }) }
  const before = validatedStackEnvironment(stack, SPEC, agreeing(stack))
  generation++
  const after = validatedStackEnvironment(stack, SPEC, agreeing(stack))
  assert.notEqual(after.env.SUPABASE_SERVICE_ROLE_KEY, before.env.SUPABASE_SERVICE_ROLE_KEY)
  assert.deepEqual(Object.keys(after.env).sort(), ["E2E_DB_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  const names = after.secrets.map((s) => s.name).sort()
  assert.deepEqual(names, ["DB_PASSWORD", "E2E_DB_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_DB_URL", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"])
  const bad = (overrides, message) => {
    const s = { stackEnv: () => stackEnvOf(overrides) }
    assert.throws(() => validatedStackEnvironment(s, SPEC, agreeing(s)), message)
  }
  bad({ E2E_DB_URL: "postgresql://postgres@db.example.invalid:64622/postgres" }, /127\.0\.0\.1/)
  bad({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, /64621/)
  bad({ SUPABASE_DB_URL: "postgresql://postgres@127.0.0.1:54322/postgres" }, /SUPABASE_DB_URL/)
  bad({ MAILPIT_URL: "http://127.0.0.1:54324" }, /MAILPIT_URL/)
  bad({ SUPABASE_SERVICE_ROLE_KEY: "" }, /SUPABASE_SERVICE_ROLE_KEY/)
  bad({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, /PUBLISHABLE_KEY/)
  bad({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dummy-service-role-value" }, /same/)
  bad({ E2E_DB_URL: "not a url" }, /not a URL/)
  bad({ E2E_SUPABASE_WORKDIR: "/tmp/nabalens-ws/spare5" }, /names another workdir/)
})

test("the cached stack env must equal a fresh supabase status for that exact workdir, naming only the field that differs", () => {
  const stack = { stackEnv: () => stackEnvOf() }
  const cached = stackEnvOf()
  const asked = []
  validatedStackEnvironment(stack, SPEC, (workdir) => (asked.push(workdir), freshOf(cached)), "/private/tmp/nabalens-ws/spare6")
  assert.deepEqual(asked, ["/private/tmp/nabalens-ws/spare6"], "the fresh status is read for the physically verified workdir")
  // Some CLI versions name the keys ANON_KEY / SECRET_KEY / INBUCKET_URL.
  const legacy = freshOf(cached, { PUBLISHABLE_KEY: undefined, ANON_KEY: cached.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SERVICE_ROLE_KEY: undefined, SECRET_KEY: cached.SUPABASE_SERVICE_ROLE_KEY, MAILPIT_URL: undefined, INBUCKET_URL: cached.MAILPIT_URL })
  validatedStackEnvironment(stack, SPEC, () => legacy)
  for (const [overrides, field] of [
    [{ API_URL: "http://127.0.0.1:64631" }, "API_URL"],
    [{ DB_URL: "postgresql://postgres:other-db-password@127.0.0.1:64622/postgres" }, "DB_URL"],
    [{ PUBLISHABLE_KEY: "rotated-publishable-value" }, "PUBLISHABLE_KEY"],
    [{ SERVICE_ROLE_KEY: "rotated-service-role-value" }, "SERVICE_ROLE_KEY"],
    [{ SERVICE_ROLE_KEY: undefined }, "SERVICE_ROLE_KEY"],
    [{ JWT_SECRET: "rotated-jwt-secret-value" }, "JWT_SECRET"],
    [{ MAILPIT_URL: "http://127.0.0.1:64634" }, "MAILPIT_URL"],
  ]) {
    let message = ""
    assert.throws(() => validatedStackEnvironment(stack, SPEC, () => freshOf(cached, overrides)), (error) => ((message = error.message), true))
    assert.match(message, new RegExp(`cached status does not match a fresh supabase status for its workdir \\(${field}\\)`), field)
    for (const value of [...Object.values(overrides), ...Object.values(cached)]) if (typeof value === "string" && value.length >= 12) assert.ok(!message.includes(value), `${field}: no value is named`)
  }
  assert.throws(() => validatedStackEnvironment(stack, SPEC, () => null), /fresh supabase status for spare6's workdir could not be read/)
  assert.throws(() => validatedStackEnvironment(stack, SPEC, () => []), /could not be read/)
})

// ---- Child environments ------------------------------------------------------------------

const STACK_VALUES = validatedStackEnvironment({ stackEnv: () => stackEnvOf() }, SPEC, () => freshOf(stackEnvOf()))
const ctx = {
  stackEnv: STACK_VALUES.env,
  checkout: "/abs/candidate",
  id: "guard-run",
  runDir: "/abs/harness/.results/guard-run/world",
}
const BASE = {
  PATH: "/usr/bin",
  HOME: "/home/x",
  DATABASE_URL: "postgresql://prod.example.invalid/db",
  VERCEL_TOKEN: "vercel-token-value",
  SUPABASE_JWT_SECRET: "inherited-jwt-secret",
  NABALENS_HOME_LAYOUT_B01_VENUES: "venue-1",
  NEXT_PUBLIC_SUPABASE_URL: "https://prod.example.invalid",
  CI: "1",
  GIT_DIR: "/elsewhere/.git",
  B02_E2E_HOME: "/elsewhere",
  PLAYWRIGHT_BROWSERS_PATH: "/browsers",
}
const keys = (env) => Object.keys(env).sort()
const RUN = ["APP_URL", "B02_RUN_DIR", "B02_RUN_ID", "B02_STACK"]

test("each child gets only what it needs: seed, build, scan, server, e2e and Playwright", () => {
  assert.deepEqual(keys(seedEnv(BASE, ctx)), [...RUN, "B02_CHECKOUT", "B02_VIA_RUNNER", "E2E_DB_URL", "E2E_ISOLATED_STACK", "HOME", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "PATH", "SUPABASE_SERVICE_ROLE_KEY"].sort())
  const build = buildEnv(BASE, ctx)
  assert.deepEqual(keys(build), ["HOME", "NABALENS_CONTRIBUTION_ENTRY", "NABALENS_HOME_LAYOUT", "NABALENS_MANAGER_TRIAGE", "NABALENS_MY_CONTRIBUTIONS", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_TELEMETRY_DISABLED", "PATH"])
  assert.equal(build.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:64621")
  assert.equal(build.NEXT_PUBLIC_SITE_URL, "http://127.0.0.1:3646")
  for (const name of ["NABALENS_CONTRIBUTION_ENTRY", "NABALENS_HOME_LAYOUT", "NABALENS_MANAGER_TRIAGE", "NABALENS_MY_CONTRIBUTIONS"]) assert.equal(build[name], "b02")
  assert.equal(build.SUPABASE_SERVICE_ROLE_KEY, undefined, "the build never sees the service key")
  assert.deepEqual(keys(scanEnv(BASE, ctx)), ["HOME", "PATH", "SUPABASE_SERVICE_ROLE_KEY"])
  assert.deepEqual(keys(serverEnv(BASE, ctx)), [...keys(build), "SUPABASE_SERVICE_ROLE_KEY"].sort())
  const e2e = e2eEnv(BASE, ctx, "staff")
  assert.deepEqual(keys(e2e), [...RUN, "B02_SUITE", "E2E_DB_URL", "HOME", "NEXT_PUBLIC_SUPABASE_URL", "PATH", "PLAYWRIGHT_BROWSERS_PATH", "SUPABASE_SERVICE_ROLE_KEY"].sort())
  const pw = playwrightEnv(BASE, ctx, "/abs/report.json")
  assert.deepEqual(keys(pw), [...keys(e2e), "B02_CHECKOUT", "PLAYWRIGHT_JSON_OUTPUT_FILE"].sort())
  assert.equal(pw.B02_SUITE, "charters")
  assert.deepEqual(keys(playwrightEnv(BASE, ctx, null)), [...keys(e2e), "B02_CHECKOUT"].sort())
  for (const env of [seedEnv(BASE, ctx), build, scanEnv(BASE, ctx), serverEnv(BASE, ctx), e2e, pw, listEnv("staff", BASE)]) {
    for (const leaked of ["DATABASE_URL", "VERCEL_TOKEN", "SUPABASE_JWT_SECRET", "NABALENS_HOME_LAYOUT_B01_VENUES", "CI", "SUPABASE_DB_URL", "MAILPIT_URL", "E2E_SUPABASE_WORKDIR", "GIT_DIR", "B02_E2E_HOME"]) {
      assert.equal(env[leaked], undefined, leaked)
    }
    assert.ok(!Object.values(env).includes("https://prod.example.invalid"))
  }
  for (const env of [e2e, pw]) assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, undefined)
  assert.throws(() => e2eEnv(BASE, ctx, "charters"), /not an e2e suite/)
  assert.throws(() => e2eEnv(BASE, ctx, "toString"), /not an e2e suite/)
})

// ---- Arguments, suites and run ids ----------------------------------------------------------

test("arguments: run needs --build, flags are per command and given once", () => {
  assert.throws(() => parse(["run"]), /needs --build/)
  assert.throws(() => parse(["run", "--reuse-build"]), /needs --build/)
  assert.throws(() => parse(["run", "--build", "--reuse-build"]), /needs --build/)
  assert.throws(() => parse(["run", "--build", "--build"]), /twice/)
  assert.throws(() => parse(["run", "--build", "--suites"]), /needs a value/)
  assert.throws(() => parse(["seed", "--build"]), /Unknown flag/)
  assert.throws(() => parse(["list", "--suites", "staff"]), /Unknown flag/)
  assert.throws(() => parse(["run", "--build", "extra"]), /Unexpected argument/)
  assert.deepEqual(parse(["run", "--build", "--suites", "staff"]).flags, { build: true, suites: "staff" })
  assert.deepEqual(parse(["list", "--require-all"]).flags, { "require-all": true })
  assert.equal(parse(["toString"]).command, "help")
  assert.equal(parse(["__proto__"]).command, "help")
})

test("suite selection is exact own-name membership, never an inherited property", () => {
  for (const name of ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf", "STAFF", "staff ", "", "charter"]) {
    assert.equal(isSuite(name), false, name)
    assert.throws(() => suitesFrom({ suites: name }), /Unknown suite|suite names/, name)
  }
  assert.throws(() => suitesFrom({ suites: "staff,,layout" }), /suite names/)
  assert.throws(() => suitesFrom({ suites: "staff,staff" }), /twice/)
  assert.deepEqual(suitesFrom({ suites: "charters,staff" }), ["staff", "charters"])
  assert.deepEqual(suitesFrom({}), ["staff", "manager", "recovery", "layout", "charters"])
})

const realE2E = existsSync(E2E_INSTALL.bin)

test("the e2e config refuses inherited suite names before collecting anything", { skip: !realE2E && "no standalone e2e" }, () => {
  for (const name of ["toString", "__proto__", "constructor"]) {
    const r = spawnSync(E2E_INSTALL.bin, ["list", "--config", join(HARNESS, "e2e.config.ts"), "--reporter", "json"], { cwd: HARNESS, encoding: "utf8", env: listEnv(name) })
    assert.notEqual(r.status, 0, name)
    assert.match(r.stdout + r.stderr, /B02_SUITE must be staff, manager, recovery or layout/, name)
  }
})

test("the plan is the fixed 4 + 8 + 2 + 1x4 + 2 = 20 instances, matching the e2e config, fixture and charters config", async () => {
  assert.deepEqual(SUITES, ["staff", "manager", "recovery", "layout", "charters"])
  assert.deepEqual(SUITES.map(expectedInstances), [4, 8, 2, 4, 2])
  assert.equal(TOTAL_INSTANCES, 20)
  assert.deepEqual(Object.keys(PLAN.layout.targets), ["phone-320", "phone-375", "phone-390", "desktop"])
  assert.equal(PLAN.staff.agent.api, "agent.act")
  assert.deepEqual({ ...PLAN.layout.agent }, { api: "agent.assert", perTarget: true })
  const config = readFileSync(join(HARNESS, "e2e.config.ts"), "utf8")
  for (const s of SUITES.filter((name) => PLAN[name].kind === "e2e")) assert.ok(config.includes(`${s}: { tests: '${PLAN[s].file}'`), s)
  assert.ok(!/charters:\s*\{/.test(config), "the charters are not an e2e suite")
  assert.match(config, /model: chatgpt\('gpt-6-luna'\)/)
  assert.match(config, /trace: 'off'/)
  assert.match(config, /video: 'off'/)
  assert.match(config, /cache: 'off'/)
  const fixture = await freshFixture()
  assert.deepEqual(Object.fromEntries(Object.entries(VIEWPORTS).map(([k, v]) => [k, { ...v }])), fixture.VIEWPORT)
  // The two charter titles and the project, exactly as the partner config declares them.
  const charters = readFileSync(join(HARNESS, "charters.config.ts"), "utf8")
  for (const title of CHARTER_TITLES) assert.ok(charters.includes(JSON.stringify(title)), title)
  assert.match(charters, /projects: \[\{ name: "chromium-desktop" \}\]/)
  assert.equal(PLAN.charters.project, "chromium-desktop")
})

test("run ids are one plain segment; the default is generated in that form", () => {
  for (const bad of [".", "..", "a/b", ".hidden", "a.b", "-x", "_x", "x".repeat(65), "", "a b", "../x"]) {
    assert.throws(() => runId({ B02_RUN_ID: bad }), /plain segment/, bad)
  }
  assert.equal(runId({ B02_RUN_ID: "b02-1c53-20261110" }), "b02-1c53-20261110")
  assert.match(runId({}, new Date("2026-11-10T18:00:00.000Z")), /^b02-2026-11-10T18-00-00-000Z$/)
})

// ---- The reviewed e2e installation -------------------------------------------------------------

/** A fake installation shaped like the reviewed one: root/package.json, root/dist/cli/bin.js, a bin link. */
function fakeInstall({ version = "0.16.0", script = "#!/usr/bin/env node\nprocess.exit(0)\n" } = {}) {
  const dir = temp("b02-e2e-")
  const root = join(dir, "e2e")
  mkdirSync(join(root, "dist", "cli"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "e2e", version }))
  writeFileSync(join(root, "dist", "cli", "bin.js"), script, { mode: 0o755 })
  mkdirSync(join(dir, "bin"))
  symlinkSync(join(root, "dist", "cli", "bin.js"), join(dir, "bin", "e2e"))
  return { dir, install: { ...E2E_INSTALL, bin: join(dir, "bin", "e2e"), root } }
}

test("the live e2e command is the reviewed standalone installation, never one chosen by the environment", () => {
  if (realE2E) {
    const identity = resolveE2E(E2E_INSTALL, {})
    assert.equal(identity.entry, join(E2E_INSTALL.root, "dist", "cli", "bin.js"))
    assert.equal(identity.version, "0.16.0")
    assert.match(identity.entrySha256, /^[0-9a-f]{64}$/)
    assert.ok(!JSON.stringify(identity).includes("token"))
  }
  assert.throws(() => resolveE2E(E2E_INSTALL, { B02_E2E_HOME: "/elsewhere" }), /B02_E2E_HOME is not accepted/)
  assert.throws(() => resolveE2E(E2E_INSTALL, { B02_E2E_HOME: "" }), /B02_E2E_HOME is not accepted/)
  const good = fakeInstall()
  assert.equal(resolveE2E(good.install, {}).version, "0.16.0")
  // A substituted executable behind the reviewed bin path is refused without being run.
  const marker = join(good.dir, "ran")
  writeFileSync(join(good.dir, "impostor.js"), `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(marker)}, "x")\n`, { mode: 0o755 })
  rmSync(good.install.bin)
  symlinkSync(join(good.dir, "impostor.js"), good.install.bin)
  assert.throws(() => resolveE2E(good.install, {}), /resolves to .*impostor\.js, not the reviewed installation's/)
  assert.equal(existsSync(marker), false, "the substituted executable must never run")
  // Another version, a missing bin, a writable entry and a linked root are refused.
  assert.throws(() => resolveE2E(fakeInstall({ version: "0.17.0" }).install, {}), /not the reviewed e2e@0\.16\.0/)
  assert.throws(() => resolveE2E({ ...good.install, bin: join(good.dir, "missing") }, {}), /No standalone e2e/)
  const writable = fakeInstall()
  chmodSync(join(writable.install.root, "dist", "cli", "bin.js"), 0o777)
  assert.throws(() => resolveE2E(writable.install, {}), /writable by others/)
  const linked = fakeInstall()
  symlinkSync(linked.install.root, join(linked.dir, "linked-root"))
  assert.throws(() => resolveE2E({ ...linked.install, root: join(linked.dir, "linked-root") }, {}), /resolves to|not a link/)
})

// ---- Paths, journal and world binding -------------------------------------------------------

test("a run's output directory is created exclusively and privately in a real .results; suite output must be new", () => {
  const root = temp()
  const results = join(root, ".results")
  mkdirSync(results, { mode: 0o755 })
  chmodSync(results, 0o755)
  const { runRoot, world } = prepareRunRoot("guard-a", results)
  assert.equal(statSync(results).mode & 0o777, 0o700, ".results is made private")
  assert.equal(statSync(runRoot).mode & 0o777, 0o700)
  assert.ok(existsSync(world))
  assert.throws(() => prepareRunRoot("guard-a", results), /already exists/)
  assert.throws(() => prepareRunRoot("..", results), /not a run id/)
  mkdirSync(join(runRoot, "staff"))
  assert.throws(() => freshOutput(runRoot, "staff"), /already exists/)
  symlinkSync(root, join(runRoot, "manager"))
  assert.throws(() => freshOutput(runRoot, "manager"), /already exists/, "a dangling or real link is never reused as output")
  assert.equal(freshOutput(runRoot, "layout"), join(runRoot, "layout"))
  assert.throws(() => freshOutput(runRoot, "toString"), /not a suite/)
  chmodSync(runRoot, 0o755)
  assert.throws(() => freshOutput(runRoot, "layout"), /not private/)
  const elsewhere = join(root, "elsewhere")
  mkdirSync(elsewhere)
  const linked = join(root, "linked")
  mkdirSync(linked)
  symlinkSync(elsewhere, join(linked, ".results"))
  assert.throws(() => prepareRunRoot("guard-b", join(linked, ".results")), /not a symlink/)
  rmSync(root, { recursive: true, force: true })
})

test("the journal header is written once, durably, and seed lines append to it", async () => {
  const dir = temp()
  startJournal(dir, { runId: "guard-j", candidate: PINNED.commit })
  assert.throws(() => startJournal(dir, { runId: "guard-j" }), /EEXIST/)
  assert.equal(statSync(join(dir, JOURNAL)).mode & 0o777, 0o600)
  const fixture = await freshFixture()
  assert.equal(fixture.JOURNAL, JOURNAL)
  fixture.appendJournal(dir, { kind: "intent", step: "venues", planned: ["DEV FIXTURE B02 One abc123"] })
  fixture.appendJournal(dir, { kind: "done", step: "venues", created: [{ id: "v" }] })
  const lines = fixture.readJournal(dir)
  assert.deepEqual(lines.map((l) => l.kind), ["header", "intent", "done"])
  assert.equal(lines[0].runId, "guard-j")
  fixture.writeDurable(dir, "world.json", { ok: true })
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "world.json"), "utf8")), { ok: true })
  assert.equal(readdirSync(dir).some((name) => name.endsWith(".tmp")), false)
  rmSync(dir, { recursive: true, force: true })
})

const TARGET_ENV = {
  B02_STACK: "spare6",
  APP_URL: "http://127.0.0.1:3646",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:64621",
  E2E_DB_URL: "postgresql://postgres:dummy-db-password@127.0.0.1:64622/postgres",
}
/** A world directory of this harness for run `id`, removed afterwards. */
function worldOf(id, world, header = { runId: id, candidate: PINNED.commit }) {
  const dir = join(HARNESS, ".results", id, "world")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  startJournal(dir, header)
  if (world) writeFileSync(join(dir, "world.json"), JSON.stringify(world))
  return dir
}
const UUID1 = "00000000-0000-4000-8000-000000000001"
const UUID2 = "00000000-0000-4000-8000-000000000002"
const goodWorld = (id) => ({
  runId: id,
  tag: "a1b2c3",
  candidate: PINNED.commit,
  tree: PINNED.tree,
  migrationsDigest: PINNED.migrationsDigest,
  stack: "spare6",
  appUrl: "http://127.0.0.1:3646",
  complete: true,
  scopes: { staff: { venue: { id: "s" } }, layout: { venue: { id: "l" } }, recovery: { venue: { id: "r" } } },
  staffReplacement: { id: UUID1, email: "e2e-b02-curry-chef-a1b2c3@nabalens.test", name: "DEV FIXTURE B02 Curry Chef a1b2c3" },
  seeded: { replacement: { requirementId: UUID2, itemId: UUID1, title: "DEV FIXTURE B02 replacement shelf a1b2c3", reason: "out of focus", revision: 2 } },
  media: { replacement: "/abs/b02-replacement-a1b2c3.jpg" },
})

test("world() loads only this run's complete world for the pinned candidate, with the shared replacement request", async () => {
  const id = `guard-${process.pid}-w`
  const other = `guard-${process.pid}-o`
  const dir = worldOf(id, goodWorld(id))
  const otherDir = worldOf(other, goodWorld(other))
  const cases = [
    [{}, null],
    [{ B02_RUN_ID: other }, /not this run's world directory/],
    [{ B02_RUN_DIR: join(HARNESS, ".results", id) }, /not this run's world directory/],
    [{ B02_RUN_DIR: "relative/world" }, /absolute/],
    [{ B02_RUN_ID: "../x" }, /plain segment/],
  ]
  try {
    for (const [overrides, message] of cases) {
      await withEnv({ ...TARGET_ENV, B02_RUN_ID: id, B02_RUN_DIR: dir, ...overrides }, async () => {
        const fixture = await freshFixture()
        if (message) assert.throws(() => fixture.world(), message)
        else {
          const w = fixture.world()
          assert.equal(w.runId, id)
          assert.equal(w.seeded.replacement.revision, 2)
          assert.equal(w.staffReplacement.id, UUID1)
        }
      })
    }
    const mutated = [
      [(w) => (w.runId = other), /another run/],
      [(w) => (w.candidate = HARNESS_SNAPSHOT), /another candidate/],
      [(w) => (w.migrationsDigest = "e".repeat(64)), /another candidate/],
      [(w) => (w.tree = "0".repeat(40)), /another candidate/],
      [(w) => delete w.complete, /not complete/],
      [(w) => (w.appUrl = "http://127.0.0.1:3645"), /another app URL/],
      [(w) => (w.stack = "spare5"), /another stack/],
      [(w) => delete w.scopes.recovery, /no recovery scope/],
      [(w) => (w.tag = "x"), /fixture tag/],
      [(w) => delete w.staffReplacement, /no replacement request/],
      [(w) => (w.seeded.replacement.revision = "2"), /no replacement request/],
      [(w) => delete w.media.replacement, /no replacement request/],
    ]
    for (const [mutate, message] of mutated) {
      const w = goodWorld(id)
      mutate(w)
      writeFileSync(join(dir, "world.json"), JSON.stringify(w))
      await withEnv({ ...TARGET_ENV, B02_RUN_ID: id, B02_RUN_DIR: dir }, async () => {
        const fixture = await freshFixture()
        assert.throws(() => fixture.world(), message)
      })
    }
    // A world whose journal belongs to another run is refused too.
    writeFileSync(join(dir, "world.json"), JSON.stringify(goodWorld(id)))
    rmSync(join(dir, JOURNAL))
    startJournal(dir, { runId: other, candidate: PINNED.commit })
    await withEnv({ ...TARGET_ENV, B02_RUN_ID: id, B02_RUN_DIR: dir }, async () => {
      const fixture = await freshFixture()
      assert.throws(() => fixture.world(), /journal/)
    })
    assert.ok(existsSync(otherDir))
  } finally {
    rmSync(join(HARNESS, ".results", id), { recursive: true, force: true })
    rmSync(join(HARNESS, ".results", other), { recursive: true, force: true })
  }
})

test("a symlinked run directory is refused by runDir()", async () => {
  const id = `guard-${process.pid}-l`
  const outside = temp()
  mkdirSync(join(outside, "world"))
  mkdirSync(join(HARNESS, ".results"), { recursive: true, mode: 0o700 })
  symlinkSync(outside, join(HARNESS, ".results", id))
  try {
    await withEnv({ ...TARGET_ENV, B02_RUN_ID: id, B02_RUN_DIR: join(HARNESS, ".results", id, "world") }, async () => {
      const fixture = await freshFixture()
      assert.throws(() => fixture.runDir(), /symlink/)
    })
  } finally {
    rmSync(join(HARNESS, ".results", id), { force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

/** A fake psql that records its arguments, PG* environment and stdin, then answers `stdout` or fails with `stderr`. */
function fakePsql(dir, { stdout = "", stderr = "", status = 0 } = {}) {
  const psql = join(dir, "psql")
  writeFileSync(
    psql,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/args'\nenv | grep '^PG' | sort > '${dir}/env'\ncat > '${dir}/stdin'\nprintf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${status}\n`
  )
  chmodSync(psql, 0o755)
  return psql
}

test("read-only psql gets the database through libpq variables, never the URL on its command line", async () => {
  const dir = temp()
  fakePsql(dir, { stdout: `["${UUID1}"]` })
  await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
    const fixture = await freshFixture()
    const seen = fixture.db.communityReadable(UUID2, [UUID1])
    assert.deepEqual(seen, [UUID1])
    const args = readFileSync(join(dir, "args"), "utf8")
    assert.equal(args, "-X\n-qAt\n-v\nON_ERROR_STOP=1\n")
    const env = readFileSync(join(dir, "env"), "utf8")
    assert.match(env, /PGHOST=127\.0\.0\.1\nPGOPTIONS=-c default_transaction_read_only=on\nPGPASSWORD=dummy-db-password\nPGPORT=64622\nPGUSER=postgres/)
    const sql = readFileSync(join(dir, "stdin"), "utf8")
    assert.match(sql, /set local role authenticated/)
    assert.match(sql, /json_agg\(x\.id order by x\.id\)/)
    assert.equal(fixture.db.drafts(UUID2, UUID2), NaN) // the fake answers JSON, not a count
    assert.match(readFileSync(join(dir, "stdin"), "utf8"), /and user_id = '00000000-0000-4000-8000-000000000002'::uuid/)
    fixture.db.assets(UUID2, "DEV-FIXTURE-b02")
    assert.match(readFileSync(join(dir, "stdin"), "utf8"), /'mediaType', media_type/)
    for (const key of Object.keys(fixture.pgEnv())) assert.ok(key.startsWith("PG"))
  })
  await withEnv({ ...TARGET_ENV, E2E_DB_URL: "postgresql://postgres@db.example.invalid:64622/postgres" }, async () => {
    const fixture = await freshFixture()
    assert.throws(() => fixture.readOnly("select 1"), /spare6's database/)
  })
  rmSync(dir, { recursive: true, force: true })
})

test("db.groupFor reads contribution_group as the viewer: safe fields, null only for its exact not-found answer", async () => {
  const dir = temp()
  const raw = {
    groupId: UUID1,
    venueId: UUID2,
    createdAt: "2026-11-10T12:00:00+00:00",
    mine: false,
    subject: { kind: "task", id: UUID2, name: "Shelf" },
    members: [{ assetId: UUID1, position: 1, mediaType: "video", uploadState: "ready", mine: false }],
  }
  fakePsql(dir, { stdout: `f\n${JSON.stringify(raw)}` })
  await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
    const fixture = await freshFixture()
    const group = fixture.db.groupFor(UUID2, UUID1)
    assert.deepEqual(group, {
      groupId: UUID1,
      venueId: UUID2,
      mine: false,
      subject: { kind: "task", id: UUID2, name: "Shelf" },
      members: [{ assetId: UUID1, position: 1, mediaType: "video", uploadState: "ready", mine: false }],
    })
    const sql = readFileSync(join(dir, "stdin"), "utf8")
    assert.match(sql, /set local role authenticated;/)
    assert.match(sql, /"sub":"00000000-0000-4000-8000-000000000002"/)
    assert.match(sql, /select public\.contribution_group\('00000000-0000-4000-8000-000000000001'::uuid\)::text;/)
    assert.match(sql, /\\set VERBOSITY verbose/)
    assert.throws(() => fixture.db.groupFor("not-a-uuid", UUID1), /not a uuid/)
  })
  // `mine` comes back verbatim: true stays true on the group and on each member.
  const owner = { ...raw, mine: true, members: [{ ...raw.members[0], mine: true }, { assetId: UUID2, position: 2, mediaType: "image", uploadState: "ready", mine: false }] }
  fakePsql(dir, { stdout: `f\n${JSON.stringify(owner)}` })
  await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
    const fixture = await freshFixture()
    const group = fixture.db.groupFor(UUID2, UUID1)
    assert.equal(group.mine, true)
    assert.deepEqual(group.members.map((m) => m.mine), [true, false])
  })
  // A missing or malformed `mine` on the group or any member is refused, never read as false.
  const malformed = [
    [{ ...raw, mine: undefined }, /no boolean mine for the group/],
    [{ ...raw, mine: null }, /no boolean mine for the group/],
    [{ ...raw, mine: "false" }, /no boolean mine for the group/],
    [{ ...raw, mine: 0 }, /no boolean mine for the group/],
    [{ ...raw, members: [{ ...raw.members[0], mine: undefined }] }, /no boolean mine for member 0/],
    [{ ...raw, members: [raw.members[0], { ...raw.members[0], assetId: UUID2, mine: "true" }] }, /no boolean mine for member 1/],
    [{ ...raw, members: [{ ...raw.members[0], mine: null }] }, /no boolean mine for member 0/],
    [{ ...raw, members: [null] }, /no boolean mine for member 0/],
  ]
  for (const [answer, message] of malformed) {
    fakePsql(dir, { stdout: `f\n${JSON.stringify(answer)}` })
    await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
      const fixture = await freshFixture()
      assert.throws(() => fixture.db.groupFor(UUID2, UUID1), message, JSON.stringify(answer))
    })
  }
  fakePsql(dir, { stderr: "psql:<stdin>:5: ERROR:  P0002: contribution_group_not_found", status: 3 })
  await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
    const fixture = await freshFixture()
    assert.equal(fixture.db.groupFor(UUID2, UUID1), null)
  })
  for (const stderr of ["psql:<stdin>:5: ERROR:  P0001: not_active_user", "psql:<stdin>:5: ERROR:  42501: permission denied for function contribution_group", "ERROR:  P0002: contribution_group_not_found_elsewhere"]) {
    fakePsql(dir, { stderr, status: 3 })
    await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
      const fixture = await freshFixture()
      assert.throws(() => fixture.db.groupFor(UUID2, UUID1), /Read-only query failed/, stderr)
    })
  }
  rmSync(dir, { recursive: true, force: true })
})

test("the charters' Playwright comes from the candidate checkout", async () => {
  const dir = temp()
  const entry = join(dir, "node_modules", "@playwright", "test")
  mkdirSync(entry, { recursive: true })
  writeFileSync(join(entry, "index.mjs"), "export {}\n")
  await withEnv({ B02_CHECKOUT: dir }, async () => {
    const fixture = await freshFixture()
    assert.equal(fixture.candidatePlaywrightTest(), pathToFileURL(join(dir, "node_modules", "@playwright", "test", "index.mjs")).href)
  })
  await withEnv({ B02_CHECKOUT: "relative" }, async () => {
    const fixture = await freshFixture()
    assert.throws(() => fixture.candidatePlaywrightTest(), /B02_CHECKOUT/)
  })
  // The runner's own resolution: CLI and package inside the checkout's node_modules, never outside.
  writeFileSync(join(entry, "package.json"), JSON.stringify({ name: "@playwright/test", version: "1.64.1" }))
  mkdirSync(join(dir, "node_modules", ".bin"))
  writeFileSync(join(entry, "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 })
  symlinkSync(join(entry, "cli.js"), join(dir, "node_modules", ".bin", "playwright"))
  assert.deepEqual({ ...requirePlaywright(dir) }, { bin: join(entry, "cli.js"), version: "1.64.1" })
  const outside = temp()
  writeFileSync(join(outside, "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 })
  rmSync(join(dir, "node_modules", ".bin", "playwright"))
  symlinkSync(join(outside, "cli.js"), join(dir, "node_modules", ".bin", "playwright"))
  assert.throws(() => requirePlaywright(dir), /playwright CLI inside its own node_modules/)
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

// ---- Lock and server owner ---------------------------------------------------------------------

test("an inherited NABALENS_WS_ROOT is rejected before anything runs", () => {
  assert.throws(() => requireCanonicalRoot({ NABALENS_WS_ROOT: "/tmp/elsewhere" }), /NABALENS_WS_ROOT/)
  assert.throws(() => requireCanonicalRoot({ NABALENS_WS_ROOT: "" }), /NABALENS_WS_ROOT/)
  requireCanonicalRoot({})
  for (const command of ["check", "seed", "list"]) {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, NABALENS_WS_ROOT: "/tmp/elsewhere", B02_CHECKOUT: REPO, NODE_OPTIONS: GUARD_IMPORT }
    const r = spawnSync(process.execPath, [RUNNER, command], { env, encoding: "utf8" })
    assert.equal(r.status, 1, command)
    assert.match(r.stderr, /NABALENS_WS_ROOT is set/)
  }
})

test("the canonical lock must be held by this process under this run's label", () => {
  const root = temp()
  const lock = join(root, "spare6.lock")
  const label = "b02 agentic acceptance guard"
  assert.throws(() => verifyLockOwner(label, lock), /not held/)
  mkdirSync(lock)
  assert.throws(() => verifyLockOwner(label, lock), /not held/)
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid + 1, what: label }))
  assert.throws(() => verifyLockOwner(label, lock), /another command/)
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, what: "b02 agentic acceptance other" }))
  assert.throws(() => verifyLockOwner(label, lock), /another command/)
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, what: label }))
  verifyLockOwner(label, lock)
  const linked = join(root, "linked.lock")
  symlinkSync(lock, linked)
  assert.throws(() => verifyLockOwner(label, linked), /not held/)
  rmSync(root, { recursive: true, force: true })
})

test("the app port must be free before start and served only by this run's process group after", async () => {
  verifyServerOwner(3646, 500, () => [501, 502], () => 500)
  assert.throws(() => verifyServerOwner(3646, 500, () => [], () => 500), /Nothing listens/)
  assert.throws(() => verifyServerOwner(3646, 500, () => [501, 777], (pid) => (pid === 777 ? 1 : 500)), /pid 777, outside/)
  assert.throws(() => verifyServerOwner(3646, 500, () => [501], () => null), /outside/)
  await requireFreePort(3646, () => [], async () => false)
  await assert.rejects(requireFreePort(3646, () => [123], async () => false), /already listens/)
  await assert.rejects(requireFreePort(3646, () => [], async () => true), /already listens/)
})

// ---- Redaction and private output ----------------------------------------------------------------

const SECRETS = secretsOf({ SERVICE: "service-role-secret-value", DB: "postgresql://postgres:pw-secret-1@127.0.0.1:64622/postgres", SHORT: "postgres" })
const MARKER = "fake-credential-marker-0123456789"
registerSecrets([...SECRETS, { name: "MARKER", value: MARKER }, ...STACK_VALUES.secrets])

test("redaction replaces every credential value, including across chunk boundaries and long lines", () => {
  assert.deepEqual(SECRETS.map((s) => s.name), ["DB", "SERVICE"])
  assert.equal(redact("k=service-role-secret-value;", SECRETS), "k=[redacted:SERVICE];")
  let out = ""
  const r = lineRedactor(SECRETS, (t) => (out += t), 64)
  r.push("start service-role-")
  r.push("secret-value end\npartial postgresql://postgres:pw-")
  r.push("secret-1@127.0.0.1:64622/postgres tail")
  r.push(" " + "x".repeat(100) + "service-role-secret-value" + "y".repeat(10))
  r.end()
  assert.ok(!out.includes("service-role-secret-value"))
  assert.ok(!out.includes("pw-secret-1"))
  assert.equal(out.split("[redacted:SERVICE]").length - 1, 2)
  assert.equal(out.split("[redacted:DB]").length - 1, 1)
  assert.ok(out.startsWith("start [redacted:SERVICE] end\npartial [redacted:DB] tail"))
})

test("a malformed report holding a credential fails, says nothing of its content, and is scrubbed in place", () => {
  const root = temp()
  mkdirSync(join(root, "staff"), { mode: 0o700 })
  writeFileSync(join(root, "staff", "report.json"), `{ "token": "${MARKER}" `)
  const read = readJson(join(root, "staff", "report.json"))
  assert.deepEqual(read, { problem: "malformed" })
  const secrets = [{ name: "MARKER", value: MARKER }]
  const found = scrubArtifacts(root, secrets)
  assert.deepEqual(found.redacted, [{ file: "staff/report.json", secret: "MARKER" }])
  assert.ok(!readFileSync(join(root, "staff", "report.json"), "utf8").includes(MARKER))
  // Links, special files and oversized reports are refused without being followed.
  symlinkSync(join(root, "staff", "report.json"), join(root, "linked.json"))
  assert.deepEqual(readJson(join(root, "linked.json")), { problem: "a link" })
  assert.deepEqual(readJson(join(root, "staff")), { problem: "not a regular file" })
  writeFileSync(join(root, "big.json"), "[1]")
  assert.deepEqual(readJson(join(root, "big.json"), 2), { problem: "larger than 2 bytes" })
  rmSync(root, { recursive: true, force: true })
})

test("artifact scrub redacts text in place, flags binary hits, links and unsafe files, and makes everything private", () => {
  const root = temp()
  mkdirSync(join(root, "staff", "artifacts"), { recursive: true })
  writeFileSync(join(root, "staff", "report.json"), JSON.stringify({ message: "auth service-role-secret-value failed" }), { mode: 0o644 })
  writeFileSync(join(root, "staff", "artifacts", "shot.png"), Buffer.concat([Buffer.from([0x89, 0, 1]), Buffer.from("service-role-secret-value")]))
  writeFileSync(join(root, "staff", "artifacts", "latin1.txt"), Buffer.concat([Buffer.from([0xe9, 0xff]), Buffer.from("service-role-secret-value")]))
  writeFileSync(join(root, "app.log"), "nothing to see\n")
  symlinkSync("/etc/hosts", join(root, "staff", "link"))
  const outside = temp()
  writeFileSync(join(outside, "shared.txt"), "service-role-secret-value")
  linkSync(join(outside, "shared.txt"), join(root, "staff", "hardlink.txt"))
  const found = scrubArtifacts(root, SECRETS)
  assert.deepEqual(found.redacted, [{ file: "staff/report.json", secret: "SERVICE" }])
  assert.deepEqual(found.binary.sort((a, b) => a.file.localeCompare(b.file)), [
    { file: "staff/artifacts/latin1.txt", secret: "SERVICE" },
    { file: "staff/artifacts/shot.png", secret: "SERVICE" },
  ])
  assert.deepEqual(found.symlinks, ["staff/link"])
  assert.deepEqual(found.unsafe, ["staff/hardlink.txt has other hard links"])
  assert.equal(readFileSync(join(outside, "shared.txt"), "utf8"), "service-role-secret-value", "a hard-linked file outside is never rewritten")
  assert.equal(JSON.parse(readFileSync(join(root, "staff", "report.json"), "utf8")).message, "auth [redacted:SERVICE] failed")
  assert.equal(statSync(join(root, "staff", "report.json")).mode & 0o777, 0o600)
  assert.equal(statSync(join(root, "staff")).mode & 0o777, 0o700)
  const summary = summarise({ id: "x", pin: PINNED, harness: {}, suites: [], results: {}, scrub: found, settlement: { settled: true, reasons: [] } })
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.scrub.problems, [
    "credential value in binary staff/artifacts/latin1.txt",
    "credential value in binary staff/artifacts/shot.png",
    "symlink staff/link",
    "unsafe output: staff/hardlink.txt has other hard links",
  ])
  // A linked run directory is not walked at all.
  const linkedRoot = join(outside, "linked-run")
  symlinkSync(root, linkedRoot)
  assert.deepEqual(scrubArtifacts(linkedRoot, SECRETS).unsafe, ["the run directory is not a real directory"])
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test("the summary is created exclusively in the private run directory, redacted, and a preexisting link is never followed", () => {
  const root = temp()
  const results = join(root, ".results")
  const { runRoot } = prepareRunRoot("guard-s", results)
  const summary = { note: `contains ${MARKER} and service-role-secret-value` }
  assert.deepEqual(writeSummary(runRoot, summary, SECRETS), { ok: true })
  const text = readFileSync(join(runRoot, "summary.json"), "utf8")
  assert.ok(!text.includes(MARKER) && !text.includes("service-role-secret-value"))
  assert.equal(statSync(join(runRoot, "summary.json")).mode & 0o777, 0o600)
  assert.equal(writeSummary(runRoot, summary, SECRETS).ok, false, "never overwritten")
  // A preexisting summary link: refused, and its external target stays unchanged.
  const other = prepareRunRoot("guard-t", results).runRoot
  const external = join(root, "external.json")
  writeFileSync(external, "original\n")
  symlinkSync(external, join(other, "summary.json"))
  const refused = writeSummary(other, summary, SECRETS)
  assert.equal(refused.ok, false)
  assert.match(refused.problem, /summary\.json was not written \(EEXIST\)/)
  assert.equal(readFileSync(external, "utf8"), "original\n")
  assert.ok(lstatSync(join(other, "summary.json")).isSymbolicLink())
  assert.deepEqual(scrubArtifacts(other, SECRETS).symlinks, ["summary.json"])
  // A run directory that is not private is refused before anything is written.
  chmodSync(other, 0o755)
  assert.match(writeSummary(other, summary, SECRETS).problem, /not private/)
  rmSync(root, { recursive: true, force: true })
})

test("the private output chain: every directory from .results down is real and private; a replaced parent is refused, never followed", () => {
  const root = temp()
  const results = join(root, ".results")
  const { runRoot } = prepareRunRoot("guard-chain", results)
  const suite = join(runRoot, "staff")
  mkdirSync(suite, { mode: 0o700 })
  writeFileSync(join(suite, "report.json"), '{"ok":true}')
  requirePrivateChain(results, suite)
  requirePrivateChain(results, results)
  assert.deepEqual(readPrivateJson(results, join(suite, "report.json")), { value: { ok: true } })
  assert.deepEqual(readPrivateJson(results, join(suite, "missing.json")), { problem: "missing" })
  assert.throws(() => requirePrivateChain(results, root), /outside the private results directory/)
  assert.throws(() => requirePrivateChain(results, "/etc"), /outside the private results directory/)
  // The run directory replaced by a link to an exact copy holding its own report: refused, and the copy is untouched.
  const outside = temp("b02-outside-")
  renameSync(runRoot, join(outside, "run"))
  symlinkSync(join(outside, "run"), runRoot)
  writeFileSync(join(outside, "run", "staff", "report.json"), '{"ok":"external"}')
  assert.throws(() => requirePrivateChain(results, suite), /\.results\/guard-chain must be a real directory, not a link/)
  assert.match(readPrivateJson(results, join(suite, "report.json")).problem, /not this run's private output/)
  assert.equal(writeSummary(runRoot, { ok: true }, []).ok, false)
  assert.equal(existsSync(join(outside, "run", "summary.json")), false)
  assert.equal(readFileSync(join(outside, "run", "staff", "report.json"), "utf8"), '{"ok":"external"}')
  rmSync(runRoot)
  renameSync(join(outside, "run"), runRoot)
  requirePrivateChain(results, suite)
  // A suite directory others may enter, or a linked .results, is refused too.
  chmodSync(suite, 0o755)
  assert.throws(() => requirePrivateChain(results, suite), /\.results\/guard-chain\/staff is not private/)
  chmodSync(suite, 0o700)
  const linked = join(root, "linked-results")
  symlinkSync(results, linked)
  assert.throws(() => requirePrivateChain(linked, suite), /outside|not a link/)
  assert.throws(() => requirePrivateChain(linked, join(linked, "guard-chain")), /The results directory must be a real directory, not a link/)
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

// ---- Report validation ---------------------------------------------------------------------------

const START = Date.parse("2026-11-10T19:00:00.000Z")
const sha = (text) => createHash("sha256").update(text).digest("hex")
const testIdOf = (file, titlePath) => [file, ...titlePath].map(encodeURIComponent).join("::")
const titleOf = (suite, k) => [`B02 ${suite}`, `case ${k}`]
const agentStep = (api, overrides = {}) => ({
  id: `step-${api}`,
  index: 1,
  kind: "agent",
  api,
  label: api,
  status: "passed",
  metrics: { modelCalls: 2, actionSteps: 1, observationBytes: 10, contextBytes: 10, ledgerBytes: 10 },
  model: {
    provider: "chatgpt.responses",
    model: "gpt-6-luna",
    endpoint: "provider-default",
    adapterVersion: "executor/e2e-default-agent@2",
    policyVersion: "e2e-default-agent/2",
    calls: 2,
    tokenAccounting: "provider",
    inputTokens: 1000,
    outputTokens: 50,
    peakTokensPerCall: 600,
  },
  events: [],
  artifacts: [],
  ...overrides,
})
/** The collection e2e list reports for a suite, matching e2eReport's results. */
const pairsOf = (suite) =>
  Object.entries(PLAN[suite].targets).flatMap(([target, n]) =>
    Array.from({ length: n }, (_, k) => ({ file: PLAN[suite].file, title: titleOf(suite, k)[1], titlePath: titleOf(suite, k), kind: "test", tags: [], target, disposition: "run" }))
  )
/** A report-1 document shaped like the installed runner's (report-v1.schema.json). */
function e2eReport(suite, { serial = false, agent = true, startedAt = new Date(START + 1000).toISOString() } = {}) {
  const plan = PLAN[suite]
  const results = []
  const groups = new Map()
  let i = 0
  for (const [targetId, n] of Object.entries(plan.targets)) {
    for (let k = 0; k < n; k++) {
      const titlePath = titleOf(suite, k)
      const testId = testIdOf(plan.file, titlePath)
      const steps = [{ id: "s0", index: 0, kind: "assertion", api: "expect", status: "passed", events: [], artifacts: [] }]
      if (plan.agent && agent && k === 0) steps.push(agentStep(plan.agent.api))
      const base = { id: sha(`${suite}-${targetId}-${k}`), testId, kind: "test", declarationIndex: k, titlePath, file: plan.file, targetId, platform: "web", repeat: 0, selected: true, status: "passed" }
      if (serial) {
        const id = sha(`group-${suite}-${targetId}`)
        if (!groups.has(id)) {
          groups.set(id, { id, serialId: `serial::${plan.file}::B02`, declarationIndex: 0, file: plan.file, titlePath: [`B02 ${suite}`], targetId, platform: "web", repeat: 0, memberTestIds: [], status: "passed", attempts: [{ id: "a", index: 0, status: "passed", members: [] }] })
        }
        const group = groups.get(id)
        group.memberTestIds.push(testId)
        group.attempts[0].members.push({ id: `${id}:member:${k}`, index: k, testId, status: "passed", steps })
        results.push({ ...base, serialGroupId: id, attempts: [] })
      } else {
        results.push({ ...base, attempts: [{ id: `a${i}`, index: 0, status: "passed", steps }] })
      }
      i++
    }
  }
  return {
    schemaVersion: "report-1",
    run: {
      status: "passed",
      exitCode: 0,
      runner: { name: "e2e", version: "0.16.0" },
      startedAt,
      project: { id: `nabalens-b02-agentic-${suite}`, configDigest: "c".repeat(64) },
      targets: Object.keys(plan.targets).map((id, index) => ({ id, index, platform: "web", baseOrigin: APP, environment: "test", engine: { name: "web", version: "0.11.1", spiVersion: 1 } })),
      errors: [],
      summary: { discovered: i, selected: i, executed: i, passed: i, failed: 0, flaky: 0, skipped: 0 },
      results,
      serialGroups: [...groups.values()],
      usage: { modelTokens: plan.agent && agent ? 4321 : 0 },
    },
  }
}
const RUNNER_ID = { name: "e2e", version: "0.16.0" }
const verdict = (report, suite, options = {}) => validateE2EReport(report, suite, { startedAtMs: START, collected: pairsOf(suite), runner: RUNNER_ID, ...options })
const fails = (report, suite, message, options) => {
  const v = verdict(report, suite, options)
  assert.equal(v.ok, false, `expected a failure matching ${message}`)
  assert.ok(v.problems.some((p) => message.test(p)), `${message} not in ${JSON.stringify(v.problems)}`)
}

test("well-formed reports pass, plain or serial, with live agent work where the plan asks", () => {
  for (const suite of ["staff", "manager", "recovery", "layout"]) {
    for (const serial of [false, true]) {
      const v = verdict(e2eReport(suite, { serial }), suite)
      assert.deepEqual(v.problems, [], `${suite} serial=${serial}`)
      assert.equal(v.counts.reportedPassed, expectedInstances(suite))
    }
  }
  const layout = verdict(e2eReport("layout"), "layout").counts
  assert.deepEqual(layout.agentSteps, { "agent.assert:passed": 4 })
  assert.equal(layout.modelCalls, 8)
  assert.equal(layout.stepTokens, 4200)
  assert.deepEqual(Object.keys(layout.live).sort(), ["desktop", "phone-320", "phone-375", "phone-390"])
  assert.throws(() => validateE2EReport({}, "charters"), /not an e2e suite/)
  assert.throws(() => validateE2EReport({}, "toString"), /not an e2e suite/)
})

test("every outgoing string is redacted before it is cut: diagnostics, outer failures and the CLI's stderr", () => {
  // A long string with the marker straddling the cut never leaks a fragment of it.
  const text = `${"x".repeat(1990)}${MARKER} tail`
  const out = outgoing(text)
  assert.ok(!out.includes(MARKER.slice(0, 8)), "redacted first, then cut")
  assert.match(out, /x\[redacted:… \(12 more characters\)$/)
  assert.match(outgoing(`short ${MARKER}`), /^short \[redacted:MARKER\]$/)
  assert.equal(outwardFailure(new Error(`boom ${MARKER}`)), "b02: boom [redacted:MARKER]")
  // A report that names the credential: every diagnostic is redacted and bounded.
  const report = e2eReport("manager")
  report.run.status = `failed ${MARKER}`
  report.run.errors.push({ code: MARKER })
  for (let i = 0; i < 100; i++) report.run.results.push({ kind: MARKER })
  const v = validateE2EReport(report, "manager", { startedAtMs: START })
  assert.ok(v.problems.length <= 41)
  assert.match(v.problems.at(-1), /more problems/)
  assert.ok(v.problems.every((p) => !p.includes(MARKER)))
  assert.ok(v.problems.some((p) => p.includes("[redacted:MARKER]")))
  // The CLI's own outer failure path: a marker in the environment-derived error never reaches stderr.
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { registerSecrets, outwardFailure } from ${JSON.stringify(pathToFileURL(RUNNER).href)}
    registerSecrets([{ name: "MARKER", value: ${JSON.stringify(MARKER)} }])
    try { throw new Error("stack status failed: token ${MARKER}") } catch (error) { console.error(outwardFailure(error)); process.exitCode = 1 }
  `], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: GUARD_IMPORT } })
  assert.equal(r.status, 1)
  assert.equal(r.stderr.trim(), "b02: stack status failed: token [redacted:MARKER]")
})

test("missing, malformed, stale or foreign reports fail", () => {
  const dir = temp()
  assert.deepEqual(readJson(join(dir, "report.json")), { problem: "missing" })
  writeFileSync(join(dir, "report.json"), "{ not json")
  assert.deepEqual(readJson(join(dir, "report.json")), { problem: "malformed" })
  for (const bad of [null, [], "report", {}, { schemaVersion: "report-2", run: {} }, { schemaVersion: "report-1" }]) {
    fails(bad, "manager", /not an e2e report-1/)
  }
  const foreign = e2eReport("manager")
  foreign.run.project.id = "nabalens-b02-agentic-staff"
  fails(foreign, "manager", /belongs to project/)
  fails(e2eReport("manager", { startedAt: new Date(START - 60_000).toISOString() }), "manager", /predates/)
  const noDate = e2eReport("manager")
  delete noDate.run.startedAt
  fails(noDate, "manager", /predates/)
  const otherRunner = e2eReport("manager")
  otherRunner.run.runner.version = "0.15.0"
  fails(otherRunner, "manager", /not the reviewed e2e 0\.16\.0/)
  rmSync(dir, { recursive: true, force: true })
})

test("a failed, errored, skipped, flaky, retried or unselected result fails even with exit 0", () => {
  const cases = [
    [(r) => (r.run.status = "failed"), /run status is failed/],
    [(r) => (r.run.exitCode = 1), /exit code is 1/],
    [(r) => r.run.errors.push({ code: "APP_UNREACHABLE" }), /APP_UNREACHABLE/],
    [(r) => delete r.run.errors, /run errors are missing/],
    [
      (r) => {
        r.run.results[1].status = "skipped"
        r.run.results[1].skip = { cause: "explicit", reason: "x" }
        r.run.summary.skipped = 1
        r.run.summary.passed--
      },
      /is skipped/,
    ],
    [(r) => (r.run.summary.skipped = 1), /summary skipped is 1/],
    [(r) => (r.run.results[0].status = "flaky"), /is flaky/],
    [(r) => r.run.results[0].attempts.unshift({ index: 0, status: "failed", steps: [] }), /one attempt/],
    [(r) => (r.run.results[0].attempts[0].index = 1), /one attempt/],
    [(r) => (r.run.results[0].selected = false), /not selected/],
    [(r) => (r.run.results[0].kind = "setup"), /setup result/],
    [(r) => (r.run.results[0].repeat = 1), /repeat 1/],
    [(r) => r.run.results.pop(), /7 results, expected 8/],
    [(r) => r.run.results.push({ ...r.run.results[0], id: sha("extra"), titlePath: ["extra"], testId: testIdOf("manager.e2e.ts", ["extra"]) }), /9 results/],
    [(r) => (r.run.results[1].titlePath = r.run.results[0].titlePath), /appears twice/],
    [(r) => (r.run.results[0].file = "staff.e2e.ts"), /not manager\.e2e\.ts/],
    [(r) => (r.run.results[0].file = "nested/manager.e2e.ts"), /not manager\.e2e\.ts/],
    [(r) => (r.run.results[0].targetId = "toString"), /unplanned target/],
    [(r) => delete r.run.summary, /summary is missing/],
    [(r) => delete r.run.results, /results are missing/],
  ]
  for (const [mutate, message] of cases) {
    const report = e2eReport("manager")
    mutate(report)
    fails(report, "manager", message)
  }
  const serial = e2eReport("manager", { serial: true })
  serial.run.serialGroups[0].attempts[0].members[3].status = "skipped"
  fails(serial, "manager", /did not pass as a serial member/)
  const regrouped = e2eReport("manager", { serial: true })
  regrouped.run.serialGroups[0].attempts.unshift({ index: 0, status: "failed", members: [] })
  fails(regrouped, "manager", /after 2 attempts/)
  const orphan = e2eReport("manager", { serial: true })
  orphan.run.serialGroups = []
  fails(orphan, "manager", /missing serial group/)
})

test("result identities are bound to the plan and the collection: titles, ids, targets and origin", () => {
  // A substituted title (consistent id and path) was never collected for this suite.
  const substituted = e2eReport("manager")
  substituted.run.results[2].titlePath = ["B02 manager", "a different test"]
  substituted.run.results[2].testId = testIdOf("manager.e2e.ts", substituted.run.results[2].titlePath)
  fails(substituted, "manager", /was not collected for this suite/)
  fails(substituted, "manager", /collected .*case 2.* has no result/)
  // Unsupported identities: a non-hash id, or a testId that does not name the title path.
  const badId = e2eReport("manager")
  badId.run.results[0].id = "r0"
  fails(badId, "manager", /unsupported result identity/)
  const badTestId = e2eReport("manager")
  badTestId.run.results[0].testId = testIdOf("manager.e2e.ts", ["B02 manager", "case 5"])
  fails(badTestId, "manager", /unsupported result identity/)
  const undecodable = e2eReport("manager")
  undecodable.run.results[0].testId = "manager.e2e.ts::%E0%A4%A"
  fails(undecodable, "manager", /unsupported result identity/)
  // The runner-owned origin, and exactly the planned targets.
  const origin = e2eReport("manager")
  origin.run.targets[0].baseOrigin = "http://127.0.0.1:3000"
  fails(origin, "manager", /baseOrigin http:\/\/127\.0\.0\.1:3000, not http:\/\/127\.0\.0\.1:3646/)
  const extraTarget = e2eReport("manager")
  extraTarget.run.targets.push({ ...extraTarget.run.targets[0], id: "phone-320", index: 1 })
  fails(extraTarget, "manager", /target phone-320 is not planned/)
  const noTarget = e2eReport("layout")
  noTarget.run.targets.pop()
  fails(noTarget, "layout", /planned target desktop is not in the report/)
})

test("serial groups count only through their own linked, passing members on the same target", () => {
  // A serial result pointing at another target's group is refused, and its steps do not count.
  const crossed = e2eReport("layout", { serial: true })
  const desktopGroup = crossed.run.serialGroups.find((g) => g.targetId === "desktop")
  const at320 = crossed.run.results.find((r) => r.targetId === "phone-320")
  const own320 = crossed.run.serialGroups.find((g) => g.targetId === "phone-320")
  at320.serialGroupId = desktopGroup.id
  fails(crossed, "layout", /names serial group .* on target desktop/)
  fails(crossed, "layout", /no passed live agent\.assert with model calls and tokens at phone-320/)
  fails(crossed, "layout", new RegExp(`serial group ${own320.id} is not linked to any selected result`))
  // An orphan group with otherwise qualifying model metrics is refused and adds no live work.
  const orphan = e2eReport("staff", { agent: false, serial: true })
  orphan.run.usage.modelTokens = 999
  const testId = testIdOf("staff.e2e.ts", ["B02 staff", "orphan"])
  orphan.run.serialGroups.push({
    ...structuredClone(orphan.run.serialGroups[0]),
    id: sha("orphan"),
    memberTestIds: [testId],
    attempts: [{ id: "o", index: 0, status: "passed", members: [{ id: "o:0", index: 0, testId, status: "passed", steps: [agentStep("agent.act")] }] }],
  })
  fails(orphan, "staff", /is not linked to any selected result/)
  fails(orphan, "staff", /no passed live agent\.act with model calls and tokens/)
  // Duplicate members, and members that are not exactly the linked results.
  const duplicate = e2eReport("manager", { serial: true })
  duplicate.run.serialGroups[0].attempts[0].members.push({ ...duplicate.run.serialGroups[0].attempts[0].members[0] })
  fails(duplicate, "manager", /repeats a member in one attempt/)
  fails(duplicate, "manager", /appears 2 times in its serial group's attempt/)
  const declared = e2eReport("manager", { serial: true })
  declared.run.serialGroups[0].memberTestIds.push(testIdOf("manager.e2e.ts", ["B02 manager", "ghost"]))
  fails(declared, "manager", /members are not exactly its linked results/)
  const twice = e2eReport("manager", { serial: true })
  twice.run.serialGroups.push(structuredClone(twice.run.serialGroups[0]))
  fails(twice, "manager", /appears twice/)
  // A member that passed in a group with the wrong file or a repeat is refused.
  const file = e2eReport("manager", { serial: true })
  file.run.serialGroups[0].file = "staff.e2e.ts"
  fails(file, "manager", /serial group comes from staff\.e2e\.ts/)
})

test("staff without a live agent.act, or layout without a live agent.assert at every target, fails", () => {
  fails(e2eReport("staff", { agent: false }), "staff", /no passed live agent\.act/)
  fails(e2eReport("staff", { agent: false }), "staff", /no model tokens/)
  const step = (report, at = 0) => report.run.results[at].attempts[0].steps[1]
  const variants = [
    [(s) => (s.metrics.modelCalls = 0), /no passed live agent\.act/],
    [(s) => (s.metrics.modelCalls = 1.5), /no passed live agent\.act/],
    [(s) => (s.model.calls = 0), /no passed live agent\.act/],
    [(s) => delete s.model, /no passed live agent\.act/],
    [(s) => ((s.model.inputTokens = 0), (s.model.outputTokens = 0)), /no passed live agent\.act/],
    [(s) => (s.model.outputTokens = Number.POSITIVE_INFINITY), /no passed live agent\.act/],
    [(s) => (s.model.model = "gpt-5"), /no passed live agent\.act/],
    [(s) => (s.model.provider = "openai.responses"), /no passed live agent\.act/],
    [(s) => (s.status = "failed"), /no passed live agent\.act/],
    [(s) => (s.api = "agent.assert"), /no passed live agent\.act/],
    [(s) => (s.cache = { mode: "self-finalized", replayedActions: 1, totalActions: 1 }), /replayed from the cache/],
    [(s) => (s.cache = { mode: "missed", reason: "no-entry", replayedActions: 1, totalActions: 2 }), /replayed from the cache/],
  ]
  for (const [mutate, message] of variants) {
    const report = e2eReport("staff")
    mutate(step(report))
    fails(report, "staff", message)
  }
  assert.equal(liveModelWork(agentStep("agent.act")), null)
  assert.match(liveModelWork(agentStep("agent.act", { model: { ...agentStep("x").model, model: "other" } })), /not the saved route/)
  const usage = e2eReport("staff")
  usage.run.usage.modelTokens = 0
  fails(usage, "staff", /no model tokens/)
  const missing375 = e2eReport("layout")
  missing375.run.results.find((r) => r.targetId === "phone-375").attempts[0].steps.pop()
  fails(missing375, "layout", /no passed live agent\.assert with model calls and tokens at phone-375/)
  const twoAt320 = e2eReport("layout")
  twoAt320.run.results.find((r) => r.targetId === "phone-375").targetId = "phone-320"
  fails(twoAt320, "layout", /phone-320 has 2 results, expected 1/)
  fails(twoAt320, "layout", /phone-375 has 0 results/)
  // A live step whose measured viewport is another target's is refused.
  const viewport = e2eReport("layout")
  viewport.run.results.find((r) => r.targetId === "phone-320").attempts[0].steps[1].viewport = { width: 375, height: 667, scale: 2 }
  fails(viewport, "layout", /agent\.assert at phone-320 measured 375x667, not 320x568/)
  const measured = e2eReport("layout")
  measured.run.results.find((r) => r.targetId === "phone-390").attempts[0].steps[1].viewport = { width: 390, height: 844, scale: 3 }
  assert.deepEqual(verdict(measured, "layout").problems, [])
  // Manager and recovery need no agent work: zero is fine there.
  assert.equal(verdict(e2eReport("recovery", { agent: false }), "recovery").ok, true)
})

function pwReport({ listing = false, version = "1.64.1" } = {}) {
  const spec = (title) => ({
    title,
    file: "charters.playwright.ts",
    tests: [{ expectedStatus: "passed", status: listing ? "skipped" : "expected", annotations: [], projectName: "chromium-desktop", projectId: "chromium-desktop", results: listing ? [] : [{ status: "passed", retry: 0 }] }],
  })
  return {
    config: { webServer: null, version, projects: [{ name: "chromium-desktop", id: "chromium-desktop", retries: 0 }] },
    suites: [{ title: "charters.playwright.ts", file: "charters.playwright.ts", specs: CHARTER_TITLES.map(spec), suites: [] }],
    errors: [],
    stats: listing
      ? { startTime: new Date(START - 500).toISOString(), expected: 0, skipped: 2, unexpected: 0, flaky: 0 }
      : { startTime: new Date(START + 500).toISOString(), expected: 2, unexpected: 0, flaky: 0, skipped: 0 },
  }
}
const pwFails = (report, message, options = { startedAtMs: START, version: "1.64.1" }) => {
  const v = validatePlaywrightReport(report, options)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => message.test(p)), `${message} not in ${JSON.stringify(v.problems)}`)
}

test("the charters' Playwright report must show exactly the two titled charters in chromium-desktop, passing fresh, no webServer", () => {
  assert.deepEqual(validatePlaywrightReport(pwReport(), { startedAtMs: START, version: "1.64.1" }).problems, [])
  assert.deepEqual(validatePlaywrightReport(pwReport({ listing: true }), { listing: true, version: "1.64.1" }).problems, [])
  const cases = [
    [(r) => (r.config.webServer = { command: "next start" }), /webServer/],
    [(r) => r.errors.push({ message: "boom" }), /top-level errors/],
    [(r) => r.suites[0].specs.pop(), /1 tests, expected 2/],
    [(r) => (r.suites[0].specs[1].title = r.suites[0].specs[0].title), /not distinct/],
    [(r) => (r.suites[0].specs[0].title = "B02-06-A: something else"), /is not a planned charter title/],
    [(r) => (r.suites[0].specs[0].title = "B02-06-A: something else"), /charter "B02-06-A: an upload interrupted.*" is missing/],
    [(r) => (r.suites[0].specs[0].tests[0].projectName = "chromium"), /ran in project chromium, not chromium-desktop/],
    [(r) => (r.config.projects[0].name = "webkit"), /expected only chromium-desktop/],
    [(r) => r.config.projects.push({ name: "firefox", retries: 0 }), /expected only chromium-desktop/],
    [(r) => (r.config.version = "1.65.0"), /not the candidate's 1\.64\.1/],
    [(r) => (r.suites[0].specs[0].file = "other.spec.ts"), /not charters\.playwright\.ts/],
    [(r) => (r.suites[0].specs[0].tests[0].status = "skipped"), /is skipped/],
    [(r) => (r.suites[0].specs[0].tests[0].status = "flaky"), /is flaky/],
    [(r) => r.suites[0].specs[0].tests[0].results.unshift({ status: "failed", retry: 0 }), /one attempt/],
    [(r) => (r.suites[0].specs[0].tests[0].expectedStatus = "skipped"), /expected to skipped/],
    [(r) => r.suites[0].specs[0].tests[0].annotations.push({ type: "fixme" }), /annotated fixme/],
    [(r) => (r.stats.skipped = 1), /stats skipped is 1/],
    [(r) => (r.stats.startTime = new Date(START - 60_000).toISOString()), /predates/],
    [(r) => (r.config.projects[0].retries = 1), /allows 1 retries/],
    [(r) => delete r.errors, /errors are missing/],
  ]
  for (const [mutate, message] of cases) {
    const report = pwReport()
    mutate(report)
    pwFails(report, message)
  }
  // Collection checks the same titles and project.
  const listedProject = pwReport({ listing: true })
  listedProject.suites[0].specs[1].tests[0].projectName = "chromium"
  pwFails(listedProject, /ran in project chromium/, { listing: true, version: "1.64.1" })
  const listedTitle = pwReport({ listing: true })
  listedTitle.suites[0].specs[1].title = "B02-06-B: renamed"
  pwFails(listedTitle, /is not a planned charter title/, { listing: true, version: "1.64.1" })
  pwFails(null, /not a Playwright JSON report/)
  pwFails({ suites: [] }, /not a Playwright JSON report/)
  // Nested describe blocks still count once each.
  const nested = pwReport()
  nested.suites[0].suites = [{ title: "inner", specs: [nested.suites[0].specs.pop()], suites: [] }]
  assert.equal(validatePlaywrightReport(nested, { startedAtMs: START }).ok, true)
})

test("collection pairs must match the plan exactly per target, once each", () => {
  assert.equal(validateListedPairs(pairsOf("layout"), "layout").ok, true)
  assert.equal(validateListedPairs(pairsOf("manager"), "manager").count, 8)
  const skipped = pairsOf("staff")
  skipped[0].disposition = "skip"
  assert.match(validateListedPairs(skipped, "staff").problems.join(), /would be skipped/)
  assert.match(validateListedPairs(pairsOf("manager").slice(1), "manager").problems.join(), /7 collected, expected 8/)
  const setup = pairsOf("recovery")
  setup[0].kind = "setup"
  assert.match(validateListedPairs(setup, "recovery").problems.join(), /is a setup/)
  const twice = pairsOf("manager")
  twice[1] = { ...twice[0] }
  assert.match(validateListedPairs(twice, "manager").problems.join(), /collected twice/)
  const elsewhere = pairsOf("staff")
  elsewhere[0].file = "nested/staff.e2e.ts"
  assert.match(validateListedPairs(elsewhere, "staff").problems.join(), /comes from nested\/staff\.e2e\.ts/)
  assert.equal(validateListedPairs(undefined, "staff").ok, false)
})

test("a suite's verdict combines the actual exit with the report: a nonzero exit always fails it", () => {
  const good = verdict(e2eReport("manager"), "manager")
  assert.equal(good.ok, true)
  const nonzero = combine("manager", { code: 1, settled: true }, good, "e2e")
  assert.equal(nonzero.ok, false)
  assert.equal(nonzero.counts.passed, 0, "a fresh passing report never counts with a nonzero exit")
  assert.equal(nonzero.counts.reportedPassed, 8)
  assert.deepEqual(nonzero.problems, ["e2e exited 1"])
  const unsettled = combine("manager", { code: 0, settled: false }, good, "e2e")
  assert.equal(unsettled.ok, false)
  assert.deepEqual(unsettled.problems, ["e2e's process group did not settle"])
  const passing = combine("manager", { code: 0, settled: true }, good, "e2e")
  assert.equal(passing.ok, true)
  assert.equal(passing.counts.passed, 8)
})

test("the summary counts only fully passing selected suites; a partial run is never completion", () => {
  const pass = { ok: true }
  const settled = { settled: true, reasons: [] }
  const all = Object.fromEntries(SUITES.map((s) => [s, pass]))
  const clean = { redacted: [], binary: [], symlinks: [], unsafe: [] }
  const full = summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: clean, settlement: settled })
  assert.equal(full.ok, true)
  assert.equal(full.complete, true)
  assert.equal(full.qualification, "full")
  assert.deepEqual(full.instances, { planned: 20, selected: 20, passed: 20 })
  const partial = summarise({ id: "x", pin: PINNED, harness: {}, suites: ["staff"], results: { staff: pass }, scrub: {}, settlement: settled })
  assert.equal(partial.complete, false)
  assert.equal(partial.ok, true)
  assert.equal(partial.qualification, "partial (never completion)")
  assert.equal(partial.suites.manager.status, "not selected")
  const failed = summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: { ...all, layout: { ok: false } }, scrub: {}, settlement: settled })
  assert.equal(failed.ok, false)
  assert.equal(failed.qualification, "failed")
  assert.equal(failed.instances.passed, 16)
  assert.equal(summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: {}, settlement: settled, error: "boom" }).ok, false)
  assert.equal(summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: {}, settlement: settled, interrupted: "signal" }).ok, false)
  // Without proven settlement, or with an unscrubbed run, nothing qualifies.
  assert.equal(summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: {}, settlement: { settled: false, reasons: ["x"] } }).ok, false)
  assert.equal(summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: {} }).ok, false)
  const unscrubbed = summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: { skipped: "uncertain" }, settlement: settled })
  assert.equal(unscrubbed.ok, false)
  assert.deepEqual(unscrubbed.scrub.problems, ["artifacts were not scrubbed: uncertain"])
})

// ---- Partner files and the charters' config ---------------------------------------------------------

test("the charters config is pinned by its exact reviewed bytes: the integrated config passes, any other bytes are refused", () => {
  // The independently reviewed config, as integrated.
  assert.equal(CHARTERS_CONFIG_SHA256, "3721d32a79310184caecf5f1ccf2974412eb8655aaf58f15387a673a2c1b50e6")
  assert.deepEqual({ ...REVIEWED_CHARTERS_CONFIG }, { dir: HARNESS, sha256: CHARTERS_CONFIG_SHA256 })
  assert.equal(sha(readFileSync(join(HARNESS, "charters.config.ts"))), CHARTERS_CONFIG_SHA256)
  assert.equal(requireReviewedChartersConfig(), join(HARNESS, "charters.config.ts"))
  const dir = temp()
  assert.deepEqual(suiteFiles("charters", dir).missing, ["charters.playwright.ts", "charters.config.ts"])
  const original = readFileSync(join(HARNESS, "charters.config.ts"))
  const reviewed = { dir, sha256: CHARTERS_CONFIG_SHA256 }
  writeFileSync(join(dir, "charters.config.ts"), original)
  assert.equal(requireReviewedChartersConfig(reviewed), join(dir, "charters.config.ts"))
  // A server arriving by a route no source reading or report shows, a one-byte change, or nothing at all.
  for (const altered of [
    Buffer.concat([original, Buffer.from("\nconst plugin = { setup: () => import('node:child_process').then((c) => c.spawn('next', ['start'])) }\n")]),
    Buffer.concat([original.subarray(0, -1), Buffer.from(original.at(-1) === 0x0a ? " " : "\n")]),
    Buffer.alloc(0),
  ]) {
    writeFileSync(join(dir, "charters.config.ts"), altered)
    assert.throws(() => requireReviewedChartersConfig(reviewed), /is not the independently reviewed config \(sha256 [0-9a-f]{64}, reviewed 3721d32a/)
  }
  // A link to the reviewed bytes, or a file others may write, is refused too.
  rmSync(join(dir, "charters.config.ts"))
  symlinkSync(join(HARNESS, "charters.config.ts"), join(dir, "charters.config.ts"))
  assert.throws(() => requireReviewedChartersConfig(reviewed), /must be a regular file, not a link/)
  rmSync(join(dir, "charters.config.ts"))
  writeFileSync(join(dir, "charters.config.ts"), original)
  chmodSync(join(dir, "charters.config.ts"), 0o666)
  assert.throws(() => requireReviewedChartersConfig(reviewed), /writable by others/)
  rmSync(join(dir, "charters.config.ts"))
  assert.throws(() => requireReviewedChartersConfig(reviewed), /is missing/)
  assert.deepEqual(suiteFiles("staff", dir).missing, ["staff.e2e.ts"])
  rmSync(dir, { recursive: true, force: true })
})

// ---- Seed against the candidate's helpers ----------------------------------------------------------------

test("every repository helper, RPC and fixture seed.ts uses exists in the pinned candidate, journalled before it writes", () => {
  const show = (path) => {
    const r = spawnSync("git", ["-C", REPO, "show", `${PINNED.commit}:${path}`], { encoding: "utf8" })
    assert.equal(r.status, 0, path)
    return r.stdout
  }
  const exports = {
    "tests/e2e/helpers/world.ts": ["uniqueTag", "fixtureEmail", "createPeople", "createVenues"],
    "tests/e2e/helpers/coverage-world.ts": ["legacyStaffGrant", "seedImages"],
    "tests/e2e/helpers/manager-world.ts": ["activeItemId", "convertToManager", "labelAsUploader", "labelledPhoto"],
    "tests/e2e/helpers/menus.ts": ["ok", "activateMenu"],
    "tests/e2e/helpers/amenities-world.ts": ["readyCheck", "checkId"],
    "tests/e2e/helpers/stack.ts": ["psql", "provisioner"],
    "tests/support/identities.ts": ["signIn"],
  }
  for (const [path, names] of Object.entries(exports)) {
    const source = show(path)
    for (const name of names) assert.match(source, new RegExp(`export (async )?function ${name}\\b`), `${path} ${name}`)
  }
  assert.match(show("tests/e2e/helpers/world.ts"), /`e2e-\$\{label\}-\$\{tag\}@nabalens\.test`/)
  assert.match(show("tests/e2e/helpers/coverage-world.ts"), /purpose\?: "general" \| "amenity"/)
  spawnSync("git", ["-C", REPO, "cat-file", "-e", `${PINNED.commit}:tests/fixtures/media/synthetic.mp4`]).status === 0 || assert.fail("synthetic.mp4")
  // The replacement path is the candidate's own home-todo path, and its RPCs exist at the pin.
  const homeTodo = show("tests/e2e/home-todo.spec.ts")
  for (const rpc of ["save_coverage_requirement", "set_coverage_requirement_assignees", "submit_coverage_photos", "review_coverage_item"]) {
    assert.match(homeTodo, new RegExp(`"${rpc}"`), rpc)
    const defined = spawnSync("git", ["-C", REPO, "grep", "-l", "-i", "-F", `function public.${rpc}(`, PINNED.commit, "--", "supabase/migrations"], { encoding: "utf8" })
    assert.equal(defined.status, 0, rpc)
  }
  assert.match(homeTodo, /p_decision: "needs_another_photo"/)
  const groups = show("supabase/migrations/20261110095910_knowledge_b02c_group_visibility_repair.sql")
  assert.match(groups, /raise exception 'contribution_group_not_found' using errcode = 'P0002'/)
  assert.match(groups, /'mediaType', a\.media_type/)
  assert.match(show("supabase/migrations/20261102110000_staff_departments.sql"), /check \(department in \('foh', 'boh'\)\)/)
  const seed = readFileSync(join(HARNESS, "seed.ts"), "utf8")
  // seed.ts's step is fixture.ts's journalStep (intent appended, fsynced, before `run` starts).
  assert.match(seed, /^const step = journalStep\(dir, scrub\)$/m)
  assert.match(readFileSync(join(HARNESS, "fixture.ts"), "utf8"), /appendJournal\(dir, \{ kind: "intent", step: name, planned \}\)\n {4}let result: T\n {4}try \{\n {6}result = await run\(\)/)
  // The journal intent precedes every helper write in each step.
  assert.ok(seed.indexOf('appendJournal(dir, { kind: "tag"') < seed.indexOf("worldHelpers.createVenues("))
  // Each replacement write happens inside its own journalled step (intent first).
  for (const [name, write] of [
    ["replacement photo", "coverage.seedImages(staffReplacement"],
    ["replacement requirement", '"save_coverage_requirement"'],
    ["replacement assignee", '"set_coverage_requirement_assignees"'],
    ["replacement submission", '"submit_coverage_photos"'],
    ["replacement review", '"review_coverage_item"'],
  ]) {
    const stepAt = seed.indexOf(`step(\n  "${name}"`) >= 0 ? seed.indexOf(`step(\n  "${name}"`) : seed.indexOf(`step("${name}"`)
    const at = seed.indexOf(write, stepAt)
    const next = seed.indexOf("await step(", stepAt + 1)
    assert.ok(stepAt > 0 && at > stepAt && (next < 0 || at < next), `${write} is inside the journalled step "${name}"`)
  }
  assert.match(seed, /staffReplacement: person\(staffReplacement\)/)
  assert.match(seed, /jobTitle: "Curry Chef", department: "boh"/)
  assert.match(seed, /replacement: await jpeg\(`b02-replacement-\$\{tag\}\.jpg`/)
  // The replacement identity's real sign-in begins inside its submission step's
  // callback, after the intent naming the actor's id, and before the RPC; it
  // happens nowhere else, and its planned intent carries no credential.
  const signIn = "identities.signIn(stack.provisioner(), staffReplacement.email)"
  assert.equal(seed.split(signIn).length - 1, 1, "one replacement sign-in")
  const submissionAt = seed.indexOf('step(\n  "replacement submission"')
  const callbackAt = seed.indexOf("async () => {", submissionAt)
  const rpcAt = seed.indexOf('"submit_coverage_photos"', submissionAt)
  assert.ok(submissionAt > 0 && callbackAt > submissionAt && seed.indexOf(signIn) > callbackAt && seed.indexOf(signIn) < rpcAt, "the sign-in is in the step's callback, before the RPC")
  const planned = seed.slice(seed.indexOf("{", submissionAt), callbackAt)
  assert.match(planned, /by: staffReplacement\.id/)
  assert.doesNotMatch(planned, /provisioner|email|key|token|password/i)
})

test("a journalled step's intent is durable on disk when its callback begins (the replacement sign-in), and a failure is scrubbed", async () => {
  const dir = temp()
  startJournal(dir, { runId: "guard-step", candidate: PINNED.commit })
  const fixture = await freshFixture()
  const step = fixture.journalStep(dir, (message) => message.split("service-role-secret-value").join("[redacted]"))
  const planned = { requirement: UUID1, asset: UUID2, by: "00000000-0000-4000-8000-000000000003" }
  let seenAtSignIn = null
  const item = await step(
    "replacement submission",
    planned,
    async () => {
      // What a crash at the very start of the sign-in would leave: read from disk, not memory.
      seenAtSignIn = readFileSync(join(dir, JOURNAL), "utf8").trim().split("\n").map((line) => JSON.parse(line))
      return { item_id: UUID1, revision: 1 }
    },
    (r) => ({ item: r.item_id, revision: r.revision })
  )
  assert.deepEqual(item, { item_id: UUID1, revision: 1 })
  assert.deepEqual(seenAtSignIn.map((l) => l.kind), ["header", "intent"])
  assert.deepEqual(seenAtSignIn[1], { at: seenAtSignIn[1].at, kind: "intent", step: "replacement submission", planned })
  const lines = fixture.readJournal(dir)
  assert.deepEqual(lines.map((l) => l.kind), ["header", "intent", "done"])
  assert.deepEqual(lines[2].created, { item: UUID1, revision: 1 })
  // A sign-in that fails: recorded as failed with the credential scrubbed, and the error still propagates.
  await assert.rejects(step("replacement submission", planned, async () => {
    throw new Error("signIn failed with service-role-secret-value")
  }), /signIn failed/)
  const failed = fixture.readJournal(dir).at(-1)
  assert.deepEqual([failed.kind, failed.message], ["failed", "signIn failed with [redacted]"])
  assert.ok(!readFileSync(join(dir, JOURNAL), "utf8").includes("service-role-secret-value"))
  rmSync(dir, { recursive: true, force: true })
})

// ---- Geometry sources ---------------------------------------------------------------------------------------

test("the page geometry sources are callable function expressions, never invoked expressions", { skip: !realE2E && "no standalone e2e" }, async () => {
  const evaluation = join(dirname(E2E_INSTALL.root), "@e2e-dev", "web", "dist", "evaluation.js")
  const { compileEvaluation } = await import(pathToFileURL(evaluation).href)
  const fixture = await freshFixture()
  try {
    globalThis.document = { documentElement: { scrollWidth: 390, clientWidth: 390 }, querySelectorAll: () => [], activeElement: null, body: {} }
    globalThis.window = { innerWidth: 390, innerHeight: 844 }
    assert.deepEqual(await compileEvaluation(fixture.NO_HORIZONTAL_OVERFLOW, false)(), { ok: true, value: true })
    assert.deepEqual(await compileEvaluation(fixture.VIEWPORT_SIZE, false)(), { ok: true, value: { width: 390, height: 844 } })
    assert.deepEqual(await compileEvaluation(fixture.FOCUSED, false)(), { ok: true, value: { tag: "body", name: "", ring: false } })
    assert.deepEqual(await compileEvaluation(fixture.REGION_GEOMETRY, true)({ name: "To do", align: false }), { ok: false, message: '0 elements are named "To do".' })
    assert.deepEqual(await compileEvaluation(fixture.CONTROL_IN_VIEW, true)("Submit finding"), { ok: false, message: '0 buttons read "Submit finding".' })
    const invoked = await compileEvaluation(`(${fixture.NO_HORIZONTAL_OVERFLOW})()`, false)()
    assert.equal(invoked.ok, false)
  } finally {
    delete globalThis.document
    delete globalThis.window
  }
})

// ---- Process groups and settlement --------------------------------------------------------------------------------

/** Real terminateGroup/onTerminate, recording which groups were stopped and hooks left behind. */
function recordingStack({ falseSuccess = false } = {}) {
  const stopped = []
  const hooks = []
  return {
    stopped,
    hooks,
    async terminateGroup(pid) {
      stopped.push(pid)
      // A false success: resolves at once and removes nothing.
      if (!falseSuccess) await realStack.terminateGroup(pid, 300)
    },
    onTerminate(hook) {
      hooks.push(hook)
      return () => hooks.splice(hooks.indexOf(hook), 1)
    },
    /** What stack.mjs's terminate() does on a signal, without exiting: every hook, newest first. */
    async fire() {
      for (const hook of [...hooks].reverse()) await hook()
    },
  }
}
const quiet = () => {}
/** An offline process table showing no descendant outside its group (ps is unavailable in the sandbox). */
const noEscapes = () => []
/** Where offline children get their private TMPDIRs (the live root is /tmp). */
const SCRATCH = temp("b02-scratch-")
after(() => rmSync(SCRATCH, { recursive: true, force: true }))
/** No listener on any port (lsof would see the machine's real ports). */
const noListeners = () => []
/**
 * A supervisor with offline scratch and listeners, everything else as given. A
 * test's fake stack stands in for the proven stop (the offline table cannot prove
 * ownership), looked up at call time so a test may replace it.
 */
const supervise = (opts) =>
  createSupervisor({ scratchRoot: SCRATCH, listeners: noListeners, log: quiet, ...(opts.stack ? { terminate: (pgid) => opts.stack.terminateGroup(pgid) } : {}), ...opts })

test("probeGroup is the kernel's answer: absent only on ESRCH, ambiguous on EPERM", () => {
  const raise = (code) => () => {
    throw Object.assign(new Error(code), { code })
  }
  assert.equal(probeGroup(4242, () => true), "alive")
  assert.equal(probeGroup(4242, raise("ESRCH")), "absent")
  assert.equal(probeGroup(4242, raise("EPERM")), "ambiguous")
  assert.equal(probeGroup(4242, raise("EINVAL")), "unknown")
  assert.equal(probeGroup(undefined), "unknown")
  assert.equal(probeGroup(1), "unknown", "never the init group")
})

test("supervisor: a spawn failure resolves 127 without signalling anything", async () => {
  const stack = recordingStack()
  const sup = supervise({ table: noEscapes, stack, log: quiet })
  const r = await sup.run("missing", "/nonexistent/b02-no-such-binary", [], {}, 60_000)
  assert.equal(r.code, 127)
  assert.equal(r.settled, true)
  assert.deepEqual(stack.stopped, [])
  assert.deepEqual(sup.report(), { settled: true, interrupted: null, groups: [], reasons: [] })
})

test("supervisor: normal exit returns the code after settling its own group, output redacted", async () => {
  const stack = recordingStack()
  const sup = supervise({ table: noEscapes, stack, log: quiet })
  const out = sink()
  const err = sink()
  const env = { PATH: process.env.PATH, KEY: "service-role-secret-value" }
  const script = 'echo "key $KEY"; echo "err $KEY" >&2; exit 3'
  const three = await sup.run("three", "/bin/sh", ["-c", script], { env }, 60_000, { secrets: SECRETS, out, err })
  assert.deepEqual([three.code, three.settled], [3, true])
  assert.equal(out.text(), "key [redacted:SERVICE]\n")
  assert.equal(err.text(), "err [redacted:SERVICE]\n")
  const captured = await sup.run("capture", "/bin/sh", ["-c", "echo '{\"files\": 1}'; echo service-role-secret-value"], { env }, 60_000, { secrets: SECRETS, capture: true })
  assert.equal(captured.output, '{"files": 1}\n[redacted:SERVICE]\n')
  assert.ok(stack.stopped.every((pid) => !groupAlive(pid)))
  assert.equal(sup.report().settled, true)
  assert.deepEqual(sup.report().groups.map((g) => [g.role, g.state, g.evidence.group]), [
    ["three", "settled", "absent"],
    ["capture", "settled", "absent"],
  ])
})

test("supervisor: a normal exit with a lingering descendant settles only after that descendant's group is gone", async () => {
  const stack = recordingStack()
  const sup = supervise({ table: noEscapes, stack, log: quiet })
  // The leader exits 0 at once; its sleeping child keeps the group and stdout open.
  const r = await sup.run("lingering", "/bin/sh", ["-c", "sleep 30 & exit 0"], {}, 60_000)
  assert.deepEqual([r.code, r.settled], [0, true])
  assert.equal(stack.stopped.length, 1)
  assert.equal(groupAlive(stack.stopped[0]), false)
  const abnormal = await sup.run("orphan", "/bin/sh", ["-c", "sleep 30 & exit 3"], {}, 60_000)
  assert.deepEqual([abnormal.code, abnormal.settled], [3, true])
  assert.equal(groupAlive(stack.stopped[1]), false)
})

test("supervisor: a timeout resolves only after its own group is gone", async () => {
  const stack = recordingStack()
  const sup = supervise({ table: noEscapes, stack, log: quiet })
  // The leader ignores SIGTERM and keeps a grandchild in its group, so cleanup must escalate.
  const started = Date.now()
  const r = await sup.run("hang", "/bin/sh", ["-c", "trap '' TERM; sleep 30 & wait"], {}, 200)
  assert.deepEqual([r.code, r.settled], [124, true])
  assert.equal(stack.stopped.length, 1)
  assert.equal(groupAlive(stack.stopped[0]), false, "child group still alive after the run resolved")
  assert.ok(Date.now() - started < 15_000)
})

test("supervisor: a stop helper that resolves without removing the group is uncertain, recorded in the receipt", async () => {
  const dir = temp()
  const receipt = createReceipt(join(dir, "receipt.json"), { runId: "guard-false", runner: { pid: process.pid } })
  const stack = recordingStack({ falseSuccess: true })
  const sup = supervise({ table: noEscapes, stack, receipt, log: quiet, absenceMs: 300, outputMs: 300 })
  const r = await sup.run("seed", "/bin/sh", ["-c", "sleep 30 & exit 0"], {}, 60_000)
  const pgid = stack.stopped[0]
  try {
    assert.equal(r.code, 0)
    assert.equal(r.settled, false)
    assert.equal(groupAlive(pgid), true, "the helper's false success left the group")
    const report = sup.report()
    assert.equal(report.settled, false)
    assert.match(report.reasons.join("\n"), new RegExp(`seed \\(process group ${pgid}\\): the group is alive after the stop helper returned`))
    const recorded = JSON.parse(readFileSync(receipt.path, "utf8"))
    assert.equal(recorded.state, "in-progress")
    assert.deepEqual(recorded.groups.map((g) => [g.role, g.pgid, g.state, g.evidence.group, g.evidence.stopHelper]), [["seed", pgid, "uncertain", "alive", "returned"]])
    // Missing or ambiguous evidence is just as uncertain.
    const ambiguous = supervise({ table: noEscapes, stack: recordingStack(), log: quiet, probe: () => "ambiguous", absenceMs: 100 })
    const a = await ambiguous.run("build", "/bin/sh", ["-c", "exit 0"], {}, 60_000)
    assert.equal(a.settled, false)
    assert.match(ambiguous.report().reasons[0], /the group is ambiguous after the stop helper returned/)
    // A helper that never returns is not trusted either.
    const hanging = supervise({ table: noEscapes, stack: { terminateGroup: () => new Promise(() => {}) }, log: quiet, stopHelperMs: 100, absenceMs: 100, outputMs: 100 })
    const h = await hanging.run("scan", "/bin/sh", ["-c", "sleep 30 & exit 0"], {}, 60_000)
    assert.equal(h.settled, false)
    assert.match(hanging.report().reasons.join("\n"), /scan .*the group is alive after the stop helper did not return/)
    await realStack.terminateGroup(hanging.report().groups[0].pgid, 200)
  } finally {
    await realStack.terminateGroup(pgid, 200)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("supervisor: an interrupt stops every owned group, refuses new work and resolves after all are checked", async () => {
  const stack = recordingStack()
  const sup = supervise({ table: noEscapes, stack, log: quiet })
  const app = sup.service("app", "/bin/sh", ["-c", "sleep 30"], {})
  const suite = sup.run("e2e staff", "/bin/sh", ["-c", "sleep 30"], {}, 60_000)
  await sleep(100)
  await sup.interrupt("signal")
  assert.equal(groupAlive(app.pid), false)
  const r = await suite
  assert.deepEqual([r.code, r.settled], [130, true])
  assert.throws(() => sup.ensureActive("manager"), /Interrupted \(signal\); manager was not started/)
  await assert.rejects(async () => sup.run("next", "/bin/sh", ["-c", "exit 0"], {}, 1000), /Interrupted/)
  assert.throws(() => sup.service("again", "/bin/sh", ["-c", "exit 0"], {}), /Interrupted/)
  const report = await sup.settle()
  assert.equal(report.settled, true)
  assert.equal(report.interrupted, "signal")
  assert.deepEqual(report.groups.map((g) => g.state), ["settled", "settled"])
})

/** A leader that ignores TERM and INT and never exits on its own. */
const IMMORTAL = "trap '' TERM INT; echo started service-role-secret-value; while :; do sleep 1; done"

test("supervisor: a leader that never exits after its timeout or a signal resolves within the bound, uncertain, its output withheld", async () => {
  const pgids = []
  try {
    for (const [helper, terminateGroup] of [
      ["false success", async () => {}],
      ["refusal", async () => {
        throw new Error("refused")
      }],
      ["no return", () => new Promise(() => {})],
    ]) {
      const sup = supervise({ table: noEscapes, stack: { terminateGroup }, stopHelperMs: 200, absenceMs: 200, outputMs: 200 })
      const started = Date.now()
      const r = await sup.run("seed", "/bin/sh", ["-c", IMMORTAL], {}, 300, { secrets: SECRETS, capture: true })
      const pgid = sup.report().groups[0].pgid
      pgids.push(pgid)
      assert.ok(Date.now() - started < 5000, `${helper}: resolved within the bound`)
      assert.deepEqual([r.code, r.settled, r.output, r.withheld], [124, false, "", true], helper)
      assert.equal(groupAlive(pgid), true, `${helper}: the leader is still alive`)
      assert.match(sup.report().reasons.join("\n"), /seed \(process group \d+\): the group is alive after the stop helper (returned|threw|did not return)/)
      // No phase starts after an uncertain one.
      assert.throws(() => sup.ensureActive("build"), Uncertain)
      assert.throws(() => sup.run("build", "/bin/sh", ["-c", "exit 0"], {}, 1000), /Process settlement is uncertain \(seed .*\); build was not started/)
      assert.throws(() => sup.service("app", "/bin/sh", ["-c", "exit 0"], {}), /Process settlement is uncertain/)
    }
    // After a signal: the interrupt and the child's result both resolve within the bound; settle() too.
    const sup = supervise({ table: noEscapes, stack: { terminateGroup: async () => {} }, stopHelperMs: 200, absenceMs: 200, outputMs: 200 })
    const out = sink()
    const running = sup.run("e2e staff", "/bin/sh", ["-c", IMMORTAL], {}, 60_000, { secrets: SECRETS, out })
    pgids.push(sup.report().groups[0].pgid)
    await waitFor(() => out.text().includes("started"))
    const started = Date.now()
    await sup.interrupt("signal")
    const r = await running
    assert.ok(Date.now() - started < 5000)
    assert.deepEqual([r.code, r.settled, r.withheld], [130, false, true])
    assert.equal(out.text(), "started [redacted:SERVICE]\n", "output was redacted while it ran and nothing more is shown after")
    const report = await sup.settle()
    assert.equal(report.settled, false)
    assert.equal(report.groups[0].state, "uncertain")
    assert.ok(existsSync(report.groups[0].scratch), "an uncertain child's private TMPDIR is kept for the coordinator")
  } finally {
    for (const pgid of pgids) await realStack.terminateGroup(pgid, 200)
  }
})

test("supervisor: each child gets its own private TMPDIR, removed only when the whole run settled", async () => {
  const sup = supervise({ table: noEscapes, stack: recordingStack() })
  const r = await sup.run("seed", "/bin/sh", ["-c", 'printf %s "$TMPDIR"'], { env: { PATH: process.env.PATH, TMPDIR: "/inherited" } }, 60_000, { capture: true })
  const scratch = sup.report().groups[0].scratch
  assert.equal(r.output, scratch)
  assert.equal(dirname(scratch), SCRATCH)
  assert.match(scratch, /\/nb02-[A-Za-z0-9]{6}$/)
  assert.equal(statSync(scratch).mode & 0o777, 0o700)
  assert.equal((await sup.settle()).settled, true)
  assert.equal(existsSync(scratch), false)
  // A process still carrying any of the run's private paths at the end: the final sweep keeps the run uncertain.
  let late = false
  let first = null
  const swept = supervise({ table: () => (late ? [{ pid: 4244, ppid: 1, pgid: 4244, command: `node child.js TMPDIR=${first}` }] : []), stack: recordingStack() })
  assert.equal((await swept.run("build", "/bin/sh", ["-c", "exit 0"], {}, 60_000)).settled, true)
  first = swept.report().groups[0].scratch
  late = true
  const report = await swept.settle()
  assert.equal(report.settled, false)
  assert.match(report.reasons.join("\n"), /the final process sweep found 1 process\(es\) carrying this run's private paths/)
  assert.ok(existsSync(first))
  const blind = supervise({ table: () => (late ? null : []), stack: recordingStack() })
  late = false
  await blind.run("scan", "/bin/sh", ["-c", "exit 0"], {}, 60_000)
  late = true
  assert.match((await blind.settle()).reasons.join("\n"), /the final process sweep could not read the process table/)
  // Markers match a path itself, never a longer path that merely starts or ends with it.
  assert.equal(carriesMarker("sleep 30 TMPDIR=/tmp/nb02-abc123", ["/tmp/nb02-abc123"]), true)
  assert.equal(carriesMarker("chrome --user-data-dir=/tmp/nb02-abc123/playwright_chromiumdev_profile-x", ["/tmp/nb02-abc123"]), true)
  assert.equal(carriesMarker("sleep 30 TMPDIR=/tmp/nb02-abc1234", ["/tmp/nb02-abc123"]), false)
  assert.equal(carriesMarker("sleep 30 TMPDIR=/private/tmp/nb02-abc123", ["/tmp/nb02-abc123"]), false)
  assert.equal(carriesMarker("sleep 30 TMPDIR=/private/tmp/nb02-abc123", ["/tmp/nb02-abc123", "/private/tmp/nb02-abc123"]), true)
  assert.equal(carriesMarker(undefined, ["/tmp/nb02-abc123"]), false)
})

test("supervisor: a detached child that leaves at once with its own stdio is found by its private path, stopped, and proven gone", async () => {
  const stack = recordingStack()
  const dir = temp()
  const handoff = join(dir, "grandchild.json")
  // The leader starts a detached grandchild with independent stdio, records it synchronously and exits at once.
  const leader = `const { spawn } = require("child_process"); const fs = require("fs"); const c = spawn("sleep", ["30"], { detached: true, stdio: "ignore" }); c.unref(); fs.writeFileSync(${JSON.stringify(handoff)}, JSON.stringify({ pid: c.pid, tmpdir: process.env.TMPDIR }))`
  // ps -E after the leader is gone: the grandchild reparented to launchd, alone in its own group, its environment carrying the private TMPDIR.
  const table = () => {
    if (!existsSync(handoff)) return []
    const g = JSON.parse(readFileSync(handoff, "utf8"))
    return groupAlive(g.pid) ? [{ pid: g.pid, ppid: 1, pgid: g.pid, command: `sleep 30 PATH=/usr/bin TMPDIR=${g.tmpdir}`, env: `PATH=/usr/bin TMPDIR=${g.tmpdir}` }] : []
  }
  // No ancestry poll ever runs before the stop: only the private path can find it.
  const sup = supervise({ stack, table, watchMs: 600_000 })
  let grandchild = null
  try {
    const r = await sup.run("playwright charters", process.execPath, ["-e", leader], {}, 60_000)
    grandchild = JSON.parse(readFileSync(handoff, "utf8")).pid
    assert.equal(r.code, 0)
    assert.equal(r.settled, true, JSON.stringify(sup.report().reasons))
    assert.equal(groupAlive(grandchild), false, "the detached grandchild's group is gone")
    const [entry] = sup.report().groups
    // The leader's group was already empty, so its id (perhaps reused by then) was never signalled.
    assert.deepEqual(stack.stopped, [grandchild])
    assert.equal(entry.evidence.stopHelper, "not needed (already absent)")
    assert.deepEqual(entry.evidence.escaped, { [grandchild]: "absent" })
    assert.equal(JSON.parse(readFileSync(handoff, "utf8")).tmpdir, entry.scratch)
  } finally {
    if (grandchild && groupAlive(grandchild)) process.kill(-grandchild, "SIGKILL")
    rmSync(dir, { recursive: true, force: true })
  }
})

test("supervisor: a group mixing this child's process with a stranger's is never signalled; the run is uncertain", async () => {
  const stack = recordingStack()
  const stranger = spawnSync(process.execPath, ["-e", "const c=require('child_process').spawn('sleep',['30'],{detached:true,stdio:'ignore'});c.unref();console.log(c.pid)"], { encoding: "utf8" })
  const other = Number(stranger.stdout.trim())
  let leader = null
  let scratch = null
  // A fresh table: this child's own escaped process (by ancestry, and by its private path) shares group `other` with a stranger.
  const table = () =>
    !leader
      ? []
      : [
          { pid: leader, ppid: process.pid, pgid: leader },
          { pid: 424242, ppid: leader, pgid: other, command: `node TMPDIR=${scratch}` },
          { pid: other, ppid: 1, pgid: other, command: "sleep 30" },
        ]
  const sup = supervise({ stack, table, watchMs: 20, absenceMs: 200 })
  const running = sup.run("e2e staff", "/bin/sh", ["-c", "sleep 30"], {}, 60_000)
  ;({ pgid: leader, scratch } = sup.report().groups[0])
  try {
    await sleep(100)
    await sup.interrupt("signal")
    const r = await running
    assert.equal(r.settled, false)
    assert.match(sup.report().reasons.join("\n"), new RegExp(`escaped descendant groups remain: ${other} not proven this run's \\(mixed membership\\)`))
    assert.equal(groupAlive(other), true, "a mixed group is never signalled")
    assert.deepEqual(stack.stopped, [leader])
  } finally {
    process.kill(-other, "SIGKILL")
  }
  // ownedProcesses: members, private-path carriers and their current children; a stranger is not.
  const rows = [
    { pid: 10, ppid: 1, pgid: 10 },
    { pid: 11, ppid: 10, pgid: 20 },
    { pid: 30, ppid: 1, pgid: 30, command: "chrome --user-data-dir=/tmp/nb02-zzzzzz/profile" },
    { pid: 31, ppid: 30, pgid: 30 },
    { pid: 40, ppid: 1, pgid: 30 },
  ]
  assert.deepEqual([...ownedProcesses(rows, 10, ["/tmp/nb02-zzzzzz"])].sort((a, b) => a - b), [10, 11, 30, 31])
  assert.deepEqual([...escapedDescendants(rows, 10, ["/tmp/nb02-zzzzzz"])].sort((a, b) => a[0] - b[0]), [
    [11, 20],
    [30, 30],
    [31, 30],
  ])
})

test("supervisor: once its own group is proven empty, a reused group id proves nothing: the stranger is never signalled", async () => {
  const stack = recordingStack()
  const stranger = spawnSync(process.execPath, ["-e", "const c=require('child_process').spawn('sleep',['30'],{detached:true,stdio:'ignore'});c.unref();console.log(c.pid)"], { encoding: "utf8" })
  const other = Number(stranger.stdout.trim())
  let leader = null
  // After the child exits and its group empties, an unrelated process S takes the same id and leads it,
  // with its own child in group `other`. No member carries this child's private path.
  const table = () => (leader ? [{ pid: leader, ppid: 1, pgid: leader, command: "stranger" }, { pid: other, ppid: leader, pgid: other, command: "sleep 30" }] : [])
  const sup = supervise({ stack, table, watchMs: 600_000, absenceMs: 200 })
  const running = sup.run("build", "/bin/sh", ["-c", "exit 0"], {}, 60_000)
  leader = sup.report().groups[0].pgid
  try {
    const r = await running
    assert.equal(r.settled, false)
    assert.match(sup.report().reasons.join("\n"), new RegExp(`escaped descendant groups remain: ${other} not proven this run's`))
    assert.deepEqual(stack.stopped, [], "neither the reused id nor the stranger's group is signalled")
    assert.equal(groupAlive(other), true)
  } finally {
    process.kill(-other, "SIGKILL")
  }
})

test("supervisor: after a timeout nothing more of the child is shown while its stop is pending", async () => {
  const out = sink()
  // A slow stop helper: the child keeps writing for most of a second after its timeout.
  const stack = { terminateGroup: async (pid) => (await sleep(800), realStack.terminateGroup(pid, 200)) }
  const sup = supervise({ table: noEscapes, stack })
  const r = await sup.run("seed", "/bin/sh", ["-c", "trap '' TERM; echo first; sleep 1; while :; do echo late; sleep 0.05; done"], {}, 300, { out })
  assert.deepEqual([r.code, r.settled], [124, true])
  assert.equal(out.text(), "first\n")
})

test("supervisor: the app is settled only when nothing listens on its port and no app command or private path remains", async () => {
  for (const [label, opts, message] of [
    ["listener", { listeners: () => [4242] }, /app \(process group \d+\): port 3646 still has 1 listener\(s\) after the group stopped/],
    ["unknown listeners", { listeners: () => null }, /app \(process group \d+\): the listeners on port 3646 could not be read/],
    ["app command", { table: () => [{ pid: 4243, ppid: 1, pgid: 4243, app: true }] }, /app \(process group \d+\): 1 process\(es\) carrying its private path or the app command remain/],
  ]) {
    const sup = supervise({ table: noEscapes, stack: recordingStack(), ...opts })
    const app = sup.service("app", "/bin/sh", ["-c", "sleep 30"], {}, {}, { port: 3646 })
    assert.equal(await app.stop(), false, label)
    assert.match(sup.report().reasons.join("\n"), message, label)
    assert.equal(groupAlive(app.pid), false, label)
    assert.equal(sup.report().groups[0].port, 3646)
  }
  const sup = supervise({ table: noEscapes, stack: recordingStack() })
  const app = sup.service("app", "/bin/sh", ["-c", "sleep 30"], {}, {}, { port: 3646 })
  assert.equal(await app.stop(), true)
  assert.deepEqual(sup.report().groups[0].evidence.listeners, 0)
  assert.equal((await sup.settle()).settled, true)
})

// ---- The blocking receipt ------------------------------------------------------------------------------------------

test("the receipt is created exclusively and privately, updated atomically, and refuses every later run while it remains", () => {
  const dir = temp()
  const path = join(dir, "spare6.b02-acceptance.receipt.json")
  requireNoReceipt(path)
  const receipt = createReceipt(path, { runId: "guard-r", label: "b02 agentic acceptance guard-r", runner: { pid: 4242, pgid: 4242 } })
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.throws(() => createReceipt(path, { runId: "again" }), /EEXIST/)
  assert.throws(() => requireNoReceipt(path), /blocked by an earlier B02 run's receipt .*in-progress receipt of run guard-r, runner pid 4242/)
  receipt.update({ runRoot: "/abs/run", note: `marker ${MARKER}` })
  assert.equal(JSON.parse(readFileSync(path, "utf8")).runRoot, "/abs/run")
  assert.ok(!readFileSync(path, "utf8").includes(MARKER), "the receipt is redacted")
  receipt.block(["seed (process group 4242): the group is alive after the stop helper returned"])
  const blocked = JSON.parse(readFileSync(path, "utf8"))
  assert.equal(blocked.state, "blocked")
  assert.equal(blocked.schema, "b02-acceptance-receipt-1")
  assert.equal(readdirSync(dir).length, 1, "no temp file is left")
  assert.throws(() => requireNoReceipt(path), /blocked receipt of run guard-r/)
  receipt.clear()
  requireNoReceipt(path)
  // A link at the receipt path blocks too, and is never followed or replaced.
  symlinkSync(join(dir, "elsewhere"), path)
  assert.throws(() => requireNoReceipt(path), /\(a link\)/)
  assert.throws(() => createReceipt(path, {}), /EEXIST/)
  rmSync(dir, { recursive: true, force: true })
})

// ---- Exact product inputs -------------------------------------------------------------------------------------------

const FAKE_SCANNER = `import { readFileSync } from "node:fs"
import { join } from "node:path"
const root = process.argv[process.argv.indexOf("--root") + 1]
let mode = "clean"
try { mode = readFileSync(join(root, "node_modules", ".scan-mode"), "utf8").trim() } catch {}
const rules = ["secret-name", ...((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length >= 16 ? ["secret-value:SUPABASE_SERVICE_ROLE_KEY"] : [])]
const findings = mode === "finding" ? [{ rule: "secret-name", file: ".next/static/a.js", offset: 1, match: "SUPABASE_SERVICE_ROLE_KEY" }] : []
console.log(JSON.stringify({ files: 3, bytesScanned: 300, rules, findings }, null, 2))
process.exit(findings.length ? 1 : 0)
`
const FAKE_NEXT = `#!/bin/sh
if [ "$1" = build ]; then mkdir -p .next/static && printf 'build-%s' "$$" > .next/BUILD_ID && exit 0; fi
exec sleep 30
`

/**
 * A clean candidate checkout at its own pin (migrations, a committed fake
 * scanner, ignored fake next), spare6's workdir copy and revision.json, a fake
 * stack and a fake ledger: everything verifyProductInputs reads, offline.
 */
function productWorld() {
  const repo = gitRepo({ "scripts/ci/scan-bundle.mjs": FAKE_SCANNER })
  const { dir, pin } = repo
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true })
  writeFileSync(join(dir, "node_modules", ".bin", "next"), FAKE_NEXT, { mode: 0o755 })
  // anchor/nabalens-ws/spare6, as /tmp/nabalens-ws/spare6 is below /tmp.
  const anchor = temp("b02-anchor-")
  const workdir = join(anchor, "nabalens-ws", "spare6")
  mkdirSync(join(workdir, "supabase", "migrations"), { recursive: true })
  const pinned = pinnedMigrations(dir, pin)
  for (const file of pinned.files) copyFileSync(join(dir, "supabase", "migrations", file), join(workdir, "supabase", "migrations", file))
  const revision = { from: dir, commit: pin.commit, branch: "main", dirty: false, migrationsDigest: pin.migrationsDigest, migrationFiles: [...pinned.files], fixtures: "none", resetAt: new Date().toISOString() }
  writeFileSync(join(workdir, "revision.json"), JSON.stringify(revision))
  const ledger = { versions: [...pinned.versions] }
  const stack = { ...recordingStack(), stackSpec: () => SPEC, statusOf: () => goodStatus(pin, dir), stackEnv: () => stackEnvOf() }
  const context = {
    pin,
    pinned,
    checkout: dir,
    stack,
    spec: SPEC,
    stackWorkdir: workdir,
    stackAnchor: anchor,
    ledger: () => ledger.versions,
    stackEnv: STACK_VALUES.env,
    secrets: STACK_VALUES.secrets,
    harness: { commit: "a".repeat(40), tree: "b".repeat(40), clean: true },
    e2e: null,
  }
  return { ...repo, anchor, workdir, revision, ledger, ctx: context, cleanup: () => [dir, anchor].forEach((d) => rmSync(d, { recursive: true, force: true })) }
}

test("spare6's physical workdir: every component below the anchor a real private-to-write directory, before anything in it is hashed", () => {
  const world = productWorld()
  const { ctx: c, anchor, workdir } = world
  assert.equal(verifyPhysicalWorkdir(workdir, anchor), workdir)
  verifyProductInputs(c)
  // The live anchor is /tmp, itself a system link: only it may resolve elsewhere.
  if (existsSync("/tmp") && lstatSync("/tmp").isSymbolicLink()) {
    assert.throws(() => verifyPhysicalWorkdir("/tmp/b02-no-such-workdir-for-guard"), /spare6's b02-no-such-workdir-for-guard is missing/)
  }
  assert.throws(() => verifyPhysicalWorkdir("/elsewhere/nabalens-ws/spare6", anchor), /not below/)
  assert.throws(() => verifyPhysicalWorkdir(anchor, anchor), /not below/)
  assert.throws(() => verifyPhysicalWorkdir("relative/spare6", anchor), /not below/)
  // Each component in turn replaced by a link to an exact copy: refused before any byte is hashed.
  const decoy = temp("b02-decoy-")
  for (const rel of ["nabalens-ws", join("nabalens-ws", "spare6"), join("nabalens-ws", "spare6", "supabase"), join("nabalens-ws", "spare6", "supabase", "migrations")]) {
    const real = join(anchor, rel)
    const copy = join(decoy, rel.replaceAll(sep, "-"))
    renameSync(real, copy)
    symlinkSync(copy, real)
    let hashed = false
    const counted = { ...c, ledger: () => ((hashed = true), c.ledger()) }
    assert.throws(() => verifyProductInputs(counted), new RegExp(`spare6's ${rel.replaceAll(sep, "/")} must be a real directory, not a link`), rel)
    assert.equal(hashed, false, `${rel}: the ledger is never read through a link`)
    assert.throws(() => verifyPhysicalWorkdir(workdir, anchor), /must be a real directory, not a link/)
    rmSync(real)
    renameSync(copy, real)
  }
  verifyProductInputs(c)
  // A component others may write, or a missing migrations directory.
  chmodSync(join(anchor, "nabalens-ws"), 0o777)
  assert.throws(() => verifyPhysicalWorkdir(workdir, anchor), /spare6's nabalens-ws is writable by others/)
  chmodSync(join(anchor, "nabalens-ws"), 0o755)
  renameSync(join(workdir, "supabase", "migrations"), join(decoy, "gone"))
  assert.throws(() => verifyPhysicalWorkdir(workdir, anchor), /supabase\/migrations is missing/)
  renameSync(join(decoy, "gone"), join(workdir, "supabase", "migrations"))
  verifyProductInputs(c)
  rmSync(decoy, { recursive: true, force: true })
  world.cleanup()
})

test("product inputs: the exact pinned files, bytes, manifest and ledger, under every check", () => {
  const world = productWorld()
  const { ctx: c, workdir, dir } = world
  const migrations = join(workdir, "supabase", "migrations")
  assert.deepEqual(verifyProductInputs(c).files, ["20260101000000_one.sql", "20260102000000_two.sql"])
  // Workdir byte drift: same names, different SQL bytes.
  writeFileSync(join(migrations, "20260102000000_two.sql"), "select 22;\n")
  assert.throws(() => verifyProductInputs(c), /spare6's workdir migrations differ in content/)
  copyFileSync(join(dir, "supabase", "migrations", "20260102000000_two.sql"), join(migrations, "20260102000000_two.sql"))
  // Same-version filename drift: the version matches, the file name does not.
  renameSync(join(migrations, "20260101000000_one.sql"), join(migrations, "20260101000000_uno.sql"))
  assert.throws(() => verifyProductInputs(c), /spare6's workdir migrations are not the pinned 2 migration files .*20260101000000_uno\.sql where the pin has 20260101000000_one\.sql/)
  renameSync(join(migrations, "20260101000000_uno.sql"), join(migrations, "20260101000000_one.sql"))
  // A linked migration in the workdir is refused.
  rmSync(join(migrations, "20260101000000_one.sql"))
  symlinkSync(join(dir, "supabase", "migrations", "20260101000000_one.sql"), join(migrations, "20260101000000_one.sql"))
  assert.throws(() => verifyProductInputs(c), /link or special file/)
  rmSync(join(migrations, "20260101000000_one.sql"))
  copyFileSync(join(dir, "supabase", "migrations", "20260101000000_one.sql"), join(migrations, "20260101000000_one.sql"))
  verifyProductInputs(c)
  // revision.json (the reset's manifest) must name exactly the pinned files, digest, commit and checkout.
  const manifest = (patch) => writeFileSync(join(workdir, "revision.json"), JSON.stringify({ ...world.revision, ...patch }))
  for (const [patch, message] of [
    [{ migrationFiles: ["20260101000000_uno.sql", "20260102000000_two.sql"] }, /revision\.json migration files are not the pinned files/],
    [{ migrationFiles: ["20260101000000_one.sql"] }, /revision\.json migration files are not the pinned files/],
    [{ migrationsDigest: "e".repeat(64) }, /revision\.json migrations digest is not the pinned one/],
    [{ commit: "0".repeat(40) }, /revision\.json records 0{40}/],
    [{ dirty: true }, /revision\.json records .*\(dirty\)/],
    [{ from: workdir }, /revision\.json records another checkout/],
  ]) {
    manifest(patch)
    assert.throws(() => verifyProductInputs(c), message)
  }
  manifest({})
  rmSync(join(workdir, "revision.json"))
  symlinkSync(join(dir, ".gitignore"), join(workdir, "revision.json"))
  assert.throws(() => verifyProductInputs(c), /revision\.json is a link/)
  rmSync(join(workdir, "revision.json"))
  manifest({})
  // The applied ordered version ledger.
  world.ledger.versions = ["20260101000000"]
  assert.throws(() => verifyProductInputs(c), /applied ledger has 1 versions, not the pinned 2/)
  world.ledger.versions = ["20260102000000", "20260101000000"]
  assert.throws(() => verifyProductInputs(c), /first difference at 0/)
  world.ledger.versions = null
  assert.throws(() => verifyProductInputs(c), /ledger could not be read/)
  world.ledger.versions = [...c.pinned.versions]
  verifyProductInputs(c)
  // A product source change after the seed.
  writeFileSync(join(dir, ".env.example"), "EXAMPLE=2\n")
  assert.throws(() => verifyProductInputs(c), /tracked changes/)
  world.cleanup()
})

test("psqlLedger reads the applied versions read-only, with the URL in libpq variables only", () => {
  const dir = temp()
  fakePsql(dir, { stdout: "20260101000000\n20260102000000\n" })
  const versions = withPath(dir, () => psqlLedger({ stackEnv: STACK_VALUES.env }))
  assert.deepEqual(versions, ["20260101000000", "20260102000000"])
  assert.equal(readFileSync(join(dir, "args"), "utf8"), "-X\n-qAt\n-v\nON_ERROR_STOP=1\n")
  assert.match(readFileSync(join(dir, "stdin"), "utf8"), /^select version from supabase_migrations\.schema_migrations order by version;/)
  assert.match(readFileSync(join(dir, "env"), "utf8"), /PGOPTIONS=-c default_transaction_read_only=on\nPGPASSWORD=dummy-db-password\nPGPORT=64622/)
  fakePsql(dir, { stderr: "connection refused", status: 2 })
  assert.equal(withPath(dir, () => psqlLedger({ stackEnv: STACK_VALUES.env })), null)
  rmSync(dir, { recursive: true, force: true })
})
function withPath(dir, fn) {
  const saved = process.env.PATH
  process.env.PATH = `${dir}:${saved}`
  try {
    return fn()
  } finally {
    process.env.PATH = saved
  }
}

test("scanOutcome accepts only a clean scan that looked for spare6's service key", () => {
  const clean = { code: 0, settled: true, overflow: false, output: JSON.stringify({ files: 57, bytesScanned: 1000, rules: ["secret-name", "secret-value:SUPABASE_SERVICE_ROLE_KEY"], findings: [] }) }
  assert.deepEqual(scanOutcome(clean, "b1"), { ok: true, problems: [], evidence: { buildId: "b1", files: 57, bytesScanned: 1000, rules: 2, findings: 0 } })
  const finding = { ...clean, code: 1, output: JSON.stringify({ files: 57, rules: ["secret-value:SUPABASE_SERVICE_ROLE_KEY"], findings: [{ rule: "jwt" }] }) }
  assert.deepEqual(scanOutcome(finding, "b1").problems, ["it exited 1", "it reported 1 finding(s)"])
  assert.match(scanOutcome({ ...clean, output: "scan-bundle: no findings." }, "b1").problems.join(), /not scan-bundle JSON/)
  assert.match(scanOutcome({ ...clean, output: JSON.stringify({ files: 0, rules: [], findings: [] }) }, "b1").problems.join(), /scanned no files.*did not look for spare6's service key/)
  assert.match(scanOutcome({ ...clean, settled: false }, "b1").problems.join(), /did not settle/)
})

// ---- The locked run, offline ----------------------------------------------------------------------------------------

/**
 * lockedRun with every live dependency replaced by an offline fake: a fake
 * stack (its withLock writes owner.json in a temporary lock directory), a
 * temporary receipt path and .results, and the given phases.
 */
function offlineRun(world, phases = {}, { stack = world.ctx.stack } = {}) {
  const root = temp("b02-run-")
  const lockDir = join(root, "spare6.lock")
  stack.withLock = async (spec, what, seconds, fn) => {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() }))
    try {
      return await fn()
    } finally {
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  const calls = []
  const seedWorld = async (c, sup) => {
    calls.push("seed")
    const r = await sup.run("seed", "/bin/sh", ["-c", "exit 0"], {}, 60_000)
    if (r.code !== 0 || !r.settled) throw new Error(`Seed exited ${r.code}${r.settled ? "" : " and its process group did not settle"}.`)
    writeFileSync(join(c.runDir, "world.json"), "{}\n")
  }
  const overrides = {
    check: async () => ({ ...world.ctx, stack }),
    recheck: async (c, label, d) => {
      d.verifyLockOwner(label, d.lockDir)
      verifyProductInputs(c)
    },
    seed: seedWorld,
    build: async () => (calls.push("build"), { buildId: "fake" }),
    scan: async () => (calls.push("scan"), { files: 1 }),
    startApp: async (c, sup) => (calls.push("app"), sup.service("app", "/bin/sh", ["-c", "sleep 30"], {})),
    runSuite: async (c, suite) => (calls.push(suite), { ok: true, exit: 0, settled: true, problems: [], counts: { passed: expectedInstances(suite) } }),
    verifyServerOwner: () => {},
    lockDir,
    laneRoot: root,
    receiptPath: join(root, "spare6.b02-acceptance.receipt.json"),
    blockerPath: join(root, "spare6.qualification.blocker.json"),
    terminate: (pgid) => stack.terminateGroup(pgid),
    results: join(root, ".results"),
    table: noEscapes,
    listeners: noListeners,
    scratchRoot: SCRATCH,
    absenceMs: 500,
    outputMs: 500,
    finalizeMs: 30_000,
    ...phases,
  }
  // A phase given as undefined uses lockedRun's own live phase.
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete overrides[key]
  const run =(id, flags = { build: true, suites: "staff" }, seedOnly = false) => lockedRun(flags, seedOnly, { ...overrides, env: { B02_RUN_ID: id } })
  const summaryOf = (id) => JSON.parse(readFileSync(join(overrides.results, id, "summary.json"), "utf8"))
  return { root, calls, overrides, run, summaryOf, stack, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("locked run: a passing partial selection is never completion, and its receipt is cleared after settlement", async () => {
  const world = productWorld()
  const off = offlineRun(world)
  assert.equal(await off.run("guard-partial", { build: true, suites: "staff,charters" }), 0)
  assert.deepEqual(off.calls, ["seed", "build", "scan", "app", "staff", "charters"])
  const summary = off.summaryOf("guard-partial")
  assert.equal(summary.ok, true)
  assert.equal(summary.complete, false)
  assert.equal(summary.qualification, "partial (never completion)")
  assert.deepEqual(summary.instances, { planned: 20, selected: 6, passed: 6 })
  assert.equal(summary.settlement.settled, true)
  assert.deepEqual(summary.settlement.groups.map((g) => [g.role, g.state]), [
    ["seed", "settled"],
    ["app", "settled"],
  ])
  assert.deepEqual(summary.evidence, { build: { buildId: "fake" }, scan: { files: 1 } })
  assert.equal(existsSync(off.overrides.receiptPath), false, "a settled run clears its own receipt")
  assert.equal(existsSync(off.overrides.lockDir), false)
  assert.equal(statSync(join(off.overrides.results, "guard-partial", "summary.json")).mode & 0o777, 0o600)
  off.cleanup()
  world.cleanup()
})

test("locked run: interrupted during a suite while the app's shutdown is pending, nothing else starts and nothing finalises early", async () => {
  const world = productWorld()
  const stack = { ...world.ctx.stack, ...recordingStack() }
  let appPid = null
  let appGone = null
  const realTerminate = stack.terminateGroup
  stack.terminateGroup = async (pid) => {
    if (pid === appPid) {
      await sleep(600) // the app's shutdown is still pending when the suite's group is already gone
      await realStack.terminateGroup(pid, 300)
      appGone = Date.now()
      return
    }
    await realTerminate(pid)
  }
  let summarySeenWhileAppAlive = false
  let hookDone = null
  const off = offlineRun(
    world,
    {
      startApp: async (c, sup) => {
        const app = sup.service("app", "/bin/sh", ["-c", "sleep 30"], {})
        appPid = app.pid
        return app
      },
      runSuite: async (c, suite, sup) => {
        off.calls.push(suite)
        const running = sup.run(`e2e ${suite}`, "/bin/sh", ["-c", "sleep 30"], {}, 60_000)
        setTimeout(() => stack.fire().then(() => (hookDone = Date.now())), 150)
        const r = await running
        return combine(suite, r, { ok: true, problems: [], counts: {} }, "e2e")
      },
    },
    { stack }
  )
  const outcome = off.run("guard-interrupt", { build: true, suites: "staff,manager,charters" })
  const summaryFile = join(off.overrides.results, "guard-interrupt", "summary.json")
  const watcher = (async () => {
    await waitFor(() => existsSync(summaryFile), 30_000)
    summarySeenWhileAppAlive = groupAlive(appPid)
  })()
  assert.equal(await outcome, 130)
  await watcher
  await waitFor(() => hookDone !== null)
  assert.deepEqual(off.calls.filter((c) => SUITES.includes(c)), ["staff"], "no suite starts after the interrupt")
  assert.equal(summarySeenWhileAppAlive, false, "the summary appeared only after the app group was gone")
  assert.ok(appGone !== null && hookDone >= appGone, "the signal hook returned only after the app's group was gone")
  const summary = off.summaryOf("guard-interrupt")
  assert.equal(summary.ok, false)
  assert.equal(summary.interrupted, "signal")
  assert.match(summary.error, /Interrupted \(signal\); manager was not started/)
  assert.equal(summary.settlement.settled, true)
  assert.equal(summary.suites.staff.exit, 130)
  assert.equal(summary.suites.manager.status, "not run")
  assert.equal(summary.instances.passed, 0)
  assert.equal(existsSync(off.overrides.receiptPath), false, "every group was proven gone")
  off.cleanup()
  world.cleanup()
})

test("locked run: a stop helper's false success leaves a blocking receipt, unscrubbed output and a refused later run", async () => {
  const world = productWorld()
  const stack = { ...world.ctx.stack, ...recordingStack({ falseSuccess: true }) }
  const off = offlineRun(
    world,
    {
      seed: async (c, sup) => {
        off.calls.push("seed")
        const r = await sup.run("seed", "/bin/sh", ["-c", "sleep 30 & exit 0"], {}, 60_000)
        if (r.code !== 0 || !r.settled) throw new Error(`Seed exited ${r.code}${r.settled ? "" : " and its process group did not settle"}.`)
      },
    },
    { stack }
  )
  const pgid = () => stack.stopped[0]
  try {
    assert.equal(await off.run("guard-uncertain"), 1)
    assert.deepEqual(off.calls, ["seed"], "nothing runs after an unsettled seed")
    const receipt = JSON.parse(readFileSync(off.overrides.receiptPath, "utf8"))
    assert.equal(receipt.state, "blocked")
    assert.equal(receipt.runId, "guard-uncertain")
    assert.equal(receipt.label, "b02 agentic acceptance guard-uncertain")
    assert.equal(receipt.runner.pid, process.pid)
    assert.equal(receipt.runRoot, join(off.overrides.results, "guard-uncertain"))
    assert.deepEqual(receipt.groups.map((g) => [g.role, g.pgid, g.state, g.evidence.group]), [["seed", pgid(), "uncertain", "alive"]])
    assert.match(receipt.reasons.join("\n"), /the group is alive after the stop helper returned/)
    const summary = off.summaryOf("guard-uncertain")
    assert.equal(summary.ok, false)
    assert.equal(summary.settlement.settled, false)
    assert.match(summary.scrub.problems.join(), /artifacts were not scrubbed: process settlement is uncertain/)
    // A later run under the same lock refuses while the receipt remains, even with a fresh id.
    await assert.rejects(off.run("guard-fresh-id"), /spare6 is blocked by an earlier B02 run's receipt .*blocked receipt of run guard-uncertain/)
    assert.deepEqual(off.calls, ["seed"])
    assert.equal(existsSync(join(off.overrides.results, "guard-fresh-id")), false)
    assert.ok(existsSync(off.overrides.receiptPath), "only the coordinator clears it")
  } finally {
    await realStack.terminateGroup(pgid(), 200)
    off.cleanup()
    world.cleanup()
  }
})

test("locked run: an unsettled journey suite stops the sequence before the charters; the receipt blocks and nothing is read or scrubbed", async () => {
  for (const how of ["timeout", "signal"]) {
    const world = productWorld()
    const stack = { ...world.ctx.stack, ...recordingStack() }
    let suitePgid = null
    let hookDone = null
    const realTerminate = stack.terminateGroup
    // The stop helper refuses the suite's group only (a false success), so its never-exiting leader stays.
    stack.terminateGroup = async (pid) => (pid === suitePgid ? undefined : realTerminate(pid))
    const off = offlineRun(
      world,
      {
        runSuite: async (c, suite, sup) => {
          off.calls.push(suite)
          const running = sup.run(`e2e ${suite}`, "/bin/sh", ["-c", IMMORTAL], {}, how === "timeout" ? 300 : 60_000, { secrets: c.secrets, capture: true })
          suitePgid = sup.report().groups.at(-1).pgid
          if (how === "signal") setTimeout(() => stack.fire().then(() => (hookDone = Date.now())), 150)
          const r = await running
          assert.equal(r.output, "", "an unsettled child's output is withheld")
          return combine(suite, r, { ok: true, problems: [], counts: {} }, "e2e")
        },
      },
      { stack }
    )
    try {
      const started = Date.now()
      const id = `guard-unsettled-${how}`
      assert.equal(await off.run(id, { build: true, suites: "staff,charters" }), how === "signal" ? 130 : 1, how)
      assert.ok(Date.now() - started < 20_000, `${how}: bounded`)
      if (how === "signal") {
        await waitFor(() => hookDone !== null)
        assert.ok(hookDone - started < 20_000, "the signal hook returned within its bound")
      }
      assert.deepEqual(off.calls.filter((c) => SUITES.includes(c)), ["staff"], `${how}: the charters never start`)
      assert.equal(groupAlive(suitePgid), true, "the refused group was left alone, never claimed gone")
      const receipt = JSON.parse(readFileSync(off.overrides.receiptPath, "utf8"))
      assert.equal(receipt.state, "blocked")
      assert.match(receipt.reasons.join("\n"), new RegExp(`e2e staff \\(process group ${suitePgid}\\): the group is alive after the stop helper returned`))
      const staff = receipt.groups.find((g) => g.pgid === suitePgid)
      assert.equal(staff.state, "uncertain")
      assert.ok(staff.scratch && existsSync(staff.scratch), "the uncertain child's private TMPDIR is recorded and kept")
      const summary = off.summaryOf(id)
      assert.equal(summary.ok, false)
      assert.equal(summary.settlement.settled, false)
      assert.match(summary.error, how === "signal" ? /Interrupted \(signal\)|staff's process group did not settle/ : /staff's process group did not settle; no further suite starts/)
      assert.equal(summary.suites.charters.status, "not run")
      assert.equal(summary.suites.staff.settled, false)
      assert.equal(summary.suites.staff.counts.passed, 0)
      assert.match(summary.scrub.problems.join(), /artifacts were not scrubbed: process settlement is uncertain/)
      assert.ok(!readFileSync(join(off.overrides.results, id, "summary.json"), "utf8").includes("service-role"), "the summary is runner-owned and sanitized")
      await assert.rejects(off.run(`${id}-again`), /spare6 is blocked by an earlier B02 run's receipt/)
    } finally {
      await realStack.terminateGroup(suitePgid, 200)
      off.cleanup()
      world.cleanup()
    }
  }
})

test("locked run: a product source change after the seed stops the run before the build", async () => {
  const world = productWorld()
  const off = offlineRun(world, {
    seed: async (c, sup) => {
      off.calls.push("seed")
      await sup.run("seed", "/bin/sh", ["-c", "exit 0"], {}, 60_000)
      writeFileSync(join(c.runDir, "world.json"), "{}\n")
      writeFileSync(join(c.checkout, "supabase", "migrations", "20260101000000_one.sql"), "select 'changed';\n")
    },
  })
  assert.equal(await off.run("guard-moved"), 1)
  assert.deepEqual(off.calls, ["seed"])
  const summary = off.summaryOf("guard-moved")
  assert.match(summary.error, /B02_CHECKOUT has tracked changes/)
  assert.equal(summary.settlement.settled, true)
  assert.equal(existsSync(off.overrides.receiptPath), false)
  off.cleanup()
  world.cleanup()
})

test("locked run: one fresh guarded build is scanned before the app starts; a failed scan stops the run first", async () => {
  const world = productWorld()
  // The live build and scan phases, on the fake next and the committed fake scanner.
  const off = offlineRun(world, { build: undefined, scan: undefined })
  writeFileSync(join(world.dir, "node_modules", ".scan-mode"), "finding")
  assert.equal(await off.run("guard-scan-finding"), 1)
  assert.deepEqual(off.calls, ["seed"], "the app never starts after a failed scan")
  const failed = off.summaryOf("guard-scan-finding")
  assert.match(failed.error, /The bundle scan of build build-\d+ failed: it exited 1; it reported 1 finding\(s\)/)
  assert.equal(failed.evidence.build.buildId.startsWith("build-"), true)
  assert.deepEqual(failed.evidence.build.switches, { NABALENS_HOME_LAYOUT: "b02", NABALENS_CONTRIBUTION_ENTRY: "b02", NABALENS_MY_CONTRIBUTIONS: "b02", NABALENS_MANAGER_TRIAGE: "b02" })
  assert.equal(failed.settlement.groups.map((g) => g.role).join(","), "seed,build,scan")
  writeFileSync(join(world.dir, "node_modules", ".scan-mode"), "clean")
  assert.equal(await off.run("guard-scan-clean"), 0)
  const passed = off.summaryOf("guard-scan-clean")
  assert.deepEqual(off.calls.slice(1), ["seed", "app", "staff"])
  assert.deepEqual(passed.evidence.scan, { buildId: passed.evidence.build.buildId, files: 3, bytesScanned: 300, rules: 2, findings: 0 })
  off.cleanup()
  world.cleanup()
})

// ---- The suite wrappers, offline -------------------------------------------------------------------------------------

/** What a fake child records of its environment for each invocation (dummy values only). */
const RECORDED_ENV = `const seen = ["SUPABASE_SERVICE_ROLE_KEY", "E2E_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "B02_RUN_ID", "B02_RUN_DIR", "B02_LIST_ONLY", "B02_SUITE", "PLAYWRIGHT_JSON_OUTPUT_FILE", "TMPDIR"]
const record = (kind) => fs.appendFileSync(path.join(__dirname, "invocations.jsonl"), JSON.stringify({ kind, argv: process.argv.slice(2), env: Object.fromEntries(seen.map((k) => [k, process.env[k]])) }) + "\\n")`
const invocationsOf = (dir) => (existsSync(join(dir, "invocations.jsonl")) ? readFileSync(join(dir, "invocations.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])

/**
 * A fake e2e installation whose CLI answers `list` and `run` from a scenario
 * file beside it, records each invocation, writes its output privately (as
 * under the runner's umask) and, when asked, replaces the suite directory
 * (`linkSuiteTo`) or the run directory (`moveRunTo`) with a link after writing.
 */
function fakeE2E() {
  const script = `#!/usr/bin/env node
const fs = require("fs"), path = require("path")
${RECORDED_ENV}
const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8"))
const suite = process.env.B02_SUITE
const s = scenario[suite] || {}
record(process.argv[2])
if (process.argv[2] === "list") { if (s.createOnList) fs.mkdirSync(s.createOnList, { recursive: true }); process.stdout.write(JSON.stringify({ pairs: s.pairs })); process.exit(s.listExit || 0) }
const runRoot = path.dirname(process.env.B02_RUN_DIR)
const out = path.join(runRoot, suite)
fs.mkdirSync(out, { recursive: true, mode: 0o700 })
if (s.report) fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(s.report).split("__NOW__").join(new Date().toISOString()))
if (s.raw !== undefined) fs.writeFileSync(path.join(out, "report.json"), s.raw)
if (s.linkSuiteTo) { fs.rmSync(out, { recursive: true }); fs.symlinkSync(s.linkSuiteTo, out) }
if (s.moveRunTo) { fs.renameSync(runRoot, s.moveRunTo); fs.symlinkSync(s.moveRunTo, runRoot) }
process.exit(s.exit || 0)
`
  const fake = fakeInstall({ script })
  const cli = join(fake.install.root, "dist", "cli")
  return { ...fake, cli, set: (scenario) => writeFileSync(join(cli, "scenario.json"), JSON.stringify(scenario)), invocations: () => invocationsOf(cli) }
}
/**
 * A fake candidate Playwright: --list prints `listing`, a run writes `report`
 * to PLAYWRIGHT_JSON_OUTPUT_FILE; each invocation is recorded. `linkSuiteTo`
 * replaces the charters directory with a link after writing; `alterOnList`
 * appends to that file while collecting.
 */
function fakePlaywright(checkout) {
  const pkg = join(checkout, "node_modules", "@playwright", "test")
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@playwright/test", version: "1.64.1" }))
  writeFileSync(
    join(pkg, "cli.js"),
    `#!/usr/bin/env node
const fs = require("fs"), path = require("path")
${RECORDED_ENV}
const s = JSON.parse(fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8"))
record(process.argv.includes("--list") ? "list" : "run")
if (process.argv.includes("--list")) { if (s.leaveOnList) fs.writeFileSync(s.leaveOnList, "left by the collection\\n"); if (s.alterOnList) fs.appendFileSync(s.alterOnList, "\\n// altered\\n"); process.stdout.write(JSON.stringify(s.listing)); process.exit(s.listExit || 0) }
if (s.report) fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(s.report).split("__NOW__").join(new Date().toISOString()))
if (s.linkSuiteTo) { const out = path.dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE); fs.rmSync(out, { recursive: true }); fs.symlinkSync(s.linkSuiteTo, out) }
process.exit(s.exit || 0)
`,
    { mode: 0o755 }
  )
  mkdirSync(join(checkout, "node_modules", ".bin"), { recursive: true })
  rmSync(join(checkout, "node_modules", ".bin", "playwright"), { force: true })
  symlinkSync(join(pkg, "cli.js"), join(checkout, "node_modules", ".bin", "playwright"))
  rmSync(join(pkg, "invocations.jsonl"), { force: true })
  return { set: (scenario) => writeFileSync(join(pkg, "scenario.json"), JSON.stringify(scenario)), invocations: () => invocationsOf(pkg), reset: () => rmSync(join(pkg, "invocations.jsonl"), { force: true }) }
}
const nowReport = (report) => {
  if (report.run) report.run.startedAt = "__NOW__"
  if (report.stats) report.stats.startTime = "__NOW__"
  return report
}

test("both suite wrappers fail a zero exit with an invalid, stale, missing, skipped or failed report, and any nonzero exit", async () => {
  const fake = fakeE2E()
  const checkout = temp("b02-pw-")
  const pw = fakePlaywright(checkout)
  const stack = recordingStack()
  const runOnce = async (kind, scenario) => {
    const root = temp("b02-wrap-")
    const { runRoot, world } = prepareRunRoot("guard-wrap", join(root, ".results"))
    const c = { id: "guard-wrap", runRoot, runDir: world, stackEnv: STACK_VALUES.env, secrets: STACK_VALUES.secrets, checkout, e2eInstall: fake.install, e2e: resolveE2E(fake.install, {}) }
    const sup = supervise({ table: noEscapes, stack, log: quiet })
    try {
      if (kind === "e2e") {
        fake.set({ manager: { pairs: pairsOf("manager"), ...scenario } })
        return await runE2E(c, "manager", sup)
      }
      pw.set({ listing: pwReport({ listing: true }), ...scenario })
      return await runCharters(c, sup)
    } finally {
      assert.equal(sup.report().settled, true)
      rmSync(root, { recursive: true, force: true })
    }
  }
  const fresh = () => nowReport(e2eReport("manager"))
  const pass = await runOnce("e2e", { report: fresh() })
  assert.equal(pass.ok, true, JSON.stringify(pass.problems))
  assert.equal(pass.counts.passed, 8)
  const e2eCases = [
    [{ report: fresh(), exit: 1 }, /e2e exited 1/],
    [{ raw: "{ not json" }, /report\.json is malformed/],
    [{}, /report\.json is missing/],
    [{ report: e2eReport("manager", { startedAt: new Date(Date.now() - 600_000).toISOString() }) }, /predates/],
    [{ report: (() => ((r) => ((r.run.results[0].status = "skipped"), r))(fresh()))() }, /is skipped/],
    [{ report: (() => ((r) => ((r.run.status = "failed"), (r.run.results[0].status = "failed"), r))(fresh()))() }, /run status is failed/],
    [{ pairs: pairsOf("manager").slice(1) }, /collection: desktop: 7 collected, expected 8/],
    [{ listExit: 2 }, /e2e list manager exited 2/],
  ]
  for (const [scenario, message] of e2eCases) {
    const r = await runOnce("e2e", scenario)
    assert.equal(r.ok, false, String(message))
    assert.equal(r.counts.passed, 0)
    assert.ok(r.problems.some((p) => message.test(p)), `${message} not in ${JSON.stringify(r.problems)}`)
  }
  const pwFresh = () => nowReport(pwReport())
  const pwPass = await runOnce("pw", { report: pwFresh() })
  assert.equal(pwPass.ok, true, JSON.stringify(pwPass.problems))
  assert.equal(pwPass.counts.passed, 2)
  const pwCases = [
    [{ report: pwFresh(), exit: 1 }, /playwright exited 1/],
    [{}, /report\.json is missing/],
    [{ report: (() => ((r) => ((r.stats.startTime = new Date(Date.now() - 600_000).toISOString()), r))(pwReport()))() }, /predates/],
    [{ report: (() => ((r) => ((r.suites[0].specs[0].tests[0].status = "skipped"), (r.stats.skipped = 1), (r.stats.expected = 1), r))(pwFresh()))() }, /is skipped/],
    [{ report: (() => ((r) => ((r.suites[0].specs[1].tests[0].results = [{ status: "failed", retry: 0 }]), (r.suites[0].specs[1].tests[0].status = "unexpected"), r))(pwFresh()))() }, /did not pass on its one attempt/],
    [{ listing: (() => ((r) => ((r.suites[0].specs[0].tests[0].projectName = "chromium"), r))(pwReport({ listing: true })))() }, /collection: .*ran in project chromium/],
    [{ listing: (() => ((r) => ((r.config.webServer = { command: "next start" }), r))(pwReport({ listing: true })))() }, /collection: the charters config declares a webServer/],
  ]
  for (const [scenario, message] of pwCases) {
    const r = await runOnce("pw", scenario)
    assert.equal(r.ok, false, String(message))
    assert.equal(r.counts.passed, 0)
    assert.ok(r.problems.some((p) => message.test(p)), `${message} not in ${JSON.stringify(r.problems)}`)
  }
  // A substituted e2e executable after the guards is refused before it runs.
  const root = temp("b02-wrap-")
  const { runRoot, world } = prepareRunRoot("guard-swap", join(root, ".results"))
  const c = { id: "guard-swap", runRoot, runDir: world, stackEnv: STACK_VALUES.env, secrets: [], checkout, e2eInstall: fake.install, e2e: { ...resolveE2E(fake.install, {}), entrySha256: "0".repeat(64) } }
  await assert.rejects(runE2E(c, "manager", supervise({ table: noEscapes, stack, log: quiet })), /The e2e installation changed during the run \(entrySha256\)/)
  assert.equal(existsSync(join(runRoot, "manager")), false)
  rmSync(root, { recursive: true, force: true })
  rmSync(checkout, { recursive: true, force: true })
  rmSync(fake.dir, { recursive: true, force: true })
})

test("suite wrappers: collection gets no live credential, a replaced output parent is never followed, an altered charters config never loads", async () => {
  const fake = fakeE2E()
  const checkout = temp("b02-pw-")
  const pw = fakePlaywright(checkout)
  const stack = recordingStack()
  const roots = []
  const context = (id) => {
    const root = temp("b02-wrap-")
    roots.push(root)
    const { runRoot, world } = prepareRunRoot(id, join(root, ".results"))
    return { root, runRoot, c: { id, runRoot, runDir: world, stackEnv: STACK_VALUES.env, secrets: STACK_VALUES.secrets, checkout, e2eInstall: fake.install, e2e: resolveE2E(fake.install, {}) } }
  }
  const live = STACK_VALUES.env
  const placeholders = (env, suite) => {
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "list-only-placeholder", suite)
    assert.equal(env.E2E_DB_URL, "postgresql://postgres@127.0.0.1:64622/postgres", suite)
    assert.equal(env.B02_LIST_ONLY, "1")
    assert.equal(env.B02_RUN_ID, "list-only")
    assert.equal(env.B02_RUN_DIR, undefined)
    assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, undefined)
    // The loopback API URL is the same public endpoint by design; no credential value appears anywhere.
    for (const { name, value } of STACK_VALUES.secrets) assert.ok(!Object.values(env).some((v) => typeof v === "string" && v.includes(value)), `${suite} collection saw ${name}`)
  }

  // e2e: the collection sees placeholders only; the run alone gets spare6's service key and database URL.
  {
    const { c } = context("guard-creds")
    fake.set({ manager: { pairs: pairsOf("manager"), report: nowReport(e2eReport("manager")) } })
    const r = await runE2E(c, "manager", supervise({ table: noEscapes, stack }))
    assert.equal(r.ok, true, JSON.stringify(r.problems))
    const [list, run] = fake.invocations()
    assert.deepEqual([list.kind, run.kind], ["list", "run"])
    placeholders(list.env, "manager")
    assert.equal(run.env.SUPABASE_SERVICE_ROLE_KEY, live.SUPABASE_SERVICE_ROLE_KEY)
    assert.equal(run.env.E2E_DB_URL, live.E2E_DB_URL)
    assert.equal(run.env.B02_RUN_ID, "guard-creds")
    assert.ok(list.env.TMPDIR.startsWith(join(SCRATCH, "nb02-")) && run.env.TMPDIR.startsWith(join(SCRATCH, "nb02-")) && list.env.TMPDIR !== run.env.TMPDIR, "each child has its own private TMPDIR")
  }
  // Playwright: the same split.
  {
    const { c } = context("guard-pw-creds")
    pw.set({ listing: pwReport({ listing: true }), report: nowReport(pwReport()) })
    const r = await runCharters(c, supervise({ table: noEscapes, stack }))
    assert.equal(r.ok, true, JSON.stringify(r.problems))
    const [list, run] = pw.invocations()
    assert.deepEqual([list.kind, run.kind], ["list", "run"])
    placeholders(list.env, "charters")
    assert.equal(list.env.PLAYWRIGHT_JSON_OUTPUT_FILE, undefined)
    assert.equal(run.env.SUPABASE_SERVICE_ROLE_KEY, live.SUPABASE_SERVICE_ROLE_KEY)
    assert.equal(run.env.PLAYWRIGHT_JSON_OUTPUT_FILE, join(c.runRoot, "charters", "report.json"))
    pw.reset()
  }

  // A replaced output parent holding a fresh, passing report: refused without following it; the external sentinel is unchanged.
  const sentinel = (report) => {
    const dir = temp("b02-external-")
    roots.push(dir)
    writeFileSync(join(dir, "report.json"), JSON.stringify(report).split("__NOW__").join(new Date().toISOString()))
    chmodSync(join(dir, "report.json"), 0o644)
    const bytes = readFileSync(join(dir, "report.json"))
    const check = () => {
      assert.deepEqual(readFileSync(join(dir, "report.json")), bytes, "the external sentinel's bytes are unchanged")
      assert.equal(statSync(join(dir, "report.json")).mode & 0o777, 0o644, "the external sentinel's mode is unchanged")
    }
    return { dir, bytes, check }
  }
  {
    const { c, runRoot } = context("guard-link-suite")
    const outside = sentinel(nowReport(e2eReport("manager")))
    fake.set({ manager: { pairs: pairsOf("manager"), report: nowReport(e2eReport("manager")), linkSuiteTo: outside.dir } })
    const r = await runE2E(c, "manager", supervise({ table: noEscapes, stack }))
    assert.equal(r.ok, false)
    assert.match(r.problems.join(), /report\.json is in a directory that is not this run's private output/)
    assert.deepEqual(readFileSync(join(outside.dir, "report.json")), outside.bytes)
    outside.check()
    // The scrub after settlement records the link and never walks or rewrites through it.
    assert.deepEqual(scrubArtifacts(runRoot, [{ name: "SERVICE", value: "dummy-service-role-value" }]).symlinks, ["manager"])
    assert.deepEqual(readFileSync(join(outside.dir, "report.json")), outside.bytes)
    outside.check()
  }
  {
    const { c, root } = context("guard-move-run")
    const moved = join(temp("b02-moved-"), "run")
    roots.push(dirname(moved))
    fake.set({ manager: { pairs: pairsOf("manager"), report: nowReport(e2eReport("manager")), moveRunTo: moved } })
    const r = await runE2E(c, "manager", supervise({ table: noEscapes, stack }))
    assert.equal(r.ok, false)
    assert.match(r.problems.join(), /report\.json is in a directory that is not this run's private output/)
    assert.ok(lstatSync(join(root, ".results", "guard-move-run")).isSymbolicLink())
    assert.equal(writeSummary(c.runRoot, { ok: true }, []).ok, false, "no summary is written through the replaced run directory")
    assert.equal(existsSync(join(moved, "summary.json")), false)
  }
  {
    const { c } = context("guard-pw-link")
    const outside = sentinel(nowReport(pwReport()))
    pw.set({ listing: pwReport({ listing: true }), report: nowReport(pwReport()), linkSuiteTo: outside.dir })
    const r = await runCharters(c, supervise({ table: noEscapes, stack }))
    assert.equal(r.ok, false)
    assert.match(r.problems.join(), /report\.json is in a directory that is not this run's private output/)
    assert.deepEqual(readFileSync(join(outside.dir, "report.json")), outside.bytes)
    outside.check()
    pw.reset()
  }

  // An altered charters config is refused before Playwright is started at all, for the collection or (altered meanwhile) the run.
  {
    const { c, runRoot } = context("guard-pw-config")
    const dir = temp("b02-config-")
    roots.push(dir)
    writeFileSync(join(dir, "charters.config.ts"), Buffer.concat([readFileSync(join(HARNESS, "charters.config.ts")), Buffer.from("\n// a plugin that starts a server\n")]))
    c.chartersConfig = { dir, sha256: CHARTERS_CONFIG_SHA256 }
    pw.set({ listing: pwReport({ listing: true }), report: nowReport(pwReport()) })
    await assert.rejects(runCharters(c, supervise({ table: noEscapes, stack })), /charters\.config\.ts is not the independently reviewed config/)
    assert.deepEqual(pw.invocations(), [], "Playwright never loaded the altered config")
    assert.equal(existsSync(join(runRoot, "charters")), false)
    // Reviewed at collection, altered before the run: the run never starts.
    writeFileSync(join(dir, "charters.config.ts"), readFileSync(join(HARNESS, "charters.config.ts")))
    const second = context("guard-pw-config-run")
    second.c.chartersConfig = { dir, sha256: CHARTERS_CONFIG_SHA256 }
    pw.set({ listing: pwReport({ listing: true }), report: nowReport(pwReport()), alterOnList: join(dir, "charters.config.ts") })
    await assert.rejects(runCharters(second.c, supervise({ table: noEscapes, stack })), /not the independently reviewed config/)
    assert.deepEqual(pw.invocations().map((i) => i.kind), ["list"], "only the collection ran, on the reviewed bytes")
    pw.reset()
  }
  for (const dir of [...roots, checkout, fake.dir]) rmSync(dir, { recursive: true, force: true })
})

test("suite wrappers: an unsettled child's output and report are never read", async () => {
  const fake = fakeE2E()
  const checkout = temp("b02-pw-")
  const pw = fakePlaywright(checkout)
  const root = temp("b02-wrap-")
  const pgids = []
  // The stop helper's false success for every group: each child is left alive and uncertain.
  const stack = recordingStack({ falseSuccess: true })
  try {
    for (const [kind, scenario] of [
      ["e2e", { manager: { pairs: pairsOf("manager"), report: nowReport(e2eReport("manager")) } }],
      ["pw", { listing: pwReport({ listing: true }), report: nowReport(pwReport()) }],
    ]) {
      const { runRoot, world } = prepareRunRoot(`guard-unsettled-${kind}`, join(root, ".results"))
      const c = { id: `guard-unsettled-${kind}`, runRoot, runDir: world, stackEnv: STACK_VALUES.env, secrets: STACK_VALUES.secrets, checkout, e2eInstall: fake.install, e2e: resolveE2E(fake.install, {}) }
      // A lingering sleeper keeps each child's group alive after its leader exits.
      const sup = supervise({ table: noEscapes, stack, absenceMs: 200, outputMs: 200 })
      const realRun = sup.run
      sup.run = (role, cmd, args, opts, ms, io) => realRun("wrapped " + role, "/bin/sh", ["-c", '"$0" "$@"; s=$?; (sleep 30 &); exit $s', cmd, ...args], opts, ms, io)
      if (kind === "e2e") fake.set(scenario)
      else pw.set(scenario)
      const r = kind === "e2e" ? await runE2E(c, "manager", sup) : await runCharters(c, sup)
      pgids.push(...sup.report().groups.map((g) => g.pgid))
      assert.equal(r.ok, false)
      assert.equal(r.settled, false)
      assert.match(r.problems.join(), /the collection was not read: its process group did not settle/)
      assert.equal((kind === "e2e" ? fake.invocations() : pw.invocations()).filter((i) => i.kind === "run").length, 0, "nothing runs after an unsettled collection")
      assert.throws(() => sup.ensureActive("the next suite"), /Process settlement is uncertain/)
    }
  } finally {
    for (const pgid of pgids) await realStack.terminateGroup(pgid, 200)
    for (const dir of [root, checkout, fake.dir]) rmSync(dir, { recursive: true, force: true })
  }
})

test("locked run: the final exit and summary combine both child types' exits with their reports", async () => {
  const world = productWorld()
  const fake = fakeE2E()
  const pw = fakePlaywright(world.dir)
  // The live suite wrappers, on the fake e2e installation and the candidate's fake Playwright.
  const off = offlineRun(world, { runSuite: undefined })
  world.ctx.e2eInstall = fake.install
  world.ctx.e2e = resolveE2E(fake.install, {})
  fake.set({ staff: { pairs: pairsOf("staff"), report: nowReport(e2eReport("staff")), exit: 1 } })
  pw.set({ listing: pwReport({ listing: true }), report: (() => ((r) => ((r.suites[0].specs[0].tests[0].status = "skipped"), r))(nowReport(pwReport())))() })
  assert.equal(await off.run("guard-combined", { build: true, suites: "staff,charters" }), 1)
  const summary = off.summaryOf("guard-combined")
  assert.equal(summary.ok, false)
  assert.equal(summary.qualification, "failed")
  assert.deepEqual(summary.instances, { planned: 20, selected: 6, passed: 0 })
  assert.equal(summary.suites.staff.exit, 1)
  assert.equal(summary.suites.staff.counts.passed, 0)
  assert.equal(summary.suites.staff.counts.reportedPassed, 4)
  assert.match(summary.suites.staff.problems.join(), /e2e exited 1/)
  assert.equal(summary.suites.charters.exit, 0)
  assert.match(summary.suites.charters.problems.join(), /is skipped/)
  // Both passing: exit 0, a partial pass that is still not completion.
  fake.set({ staff: { pairs: pairsOf("staff"), report: nowReport(e2eReport("staff")) } })
  pw.set({ listing: pwReport({ listing: true }), report: nowReport(pwReport()) })
  assert.equal(await off.run("guard-combined-pass", { build: true, suites: "staff,charters" }), 0)
  const passed = off.summaryOf("guard-combined-pass")
  assert.deepEqual(passed.instances, { planned: 20, selected: 6, passed: 6 })
  assert.equal(passed.qualification, "partial (never completion)")
  assert.equal(passed.e2e.version, "0.16.0")
  off.cleanup()
  world.cleanup()
  rmSync(fake.dir, { recursive: true, force: true })
})

// ---- Review repairs: escaped descendants, hidden checkout state, late app output ------------------------------------

test("escapedDescendants follows every member and child of a group to the processes that left it", () => {
  const rows = [
    { pid: 100, ppid: 1, pgid: 100 }, // leader
    { pid: 101, ppid: 100, pgid: 100 }, // member
    { pid: 200, ppid: 101, pgid: 200 }, // a detached browser, its own group
    { pid: 201, ppid: 200, pgid: 200 }, // the browser's child
    { pid: 300, ppid: 201, pgid: 300 }, // a grandchild in yet another group
    { pid: 400, ppid: 1, pgid: 400 }, // unrelated
  ]
  assert.deepEqual([...escapedDescendants(rows, 100)].sort((a, b) => a[0] - b[0]), [
    [200, 200],
    [201, 200],
    [300, 300],
  ])
  assert.deepEqual([...escapedDescendants(rows, 999)], [])
})

/** A child that starts a detached grandchild (as Playwright starts a browser) and reports its pid. */
const DETACHED = `const { spawn } = require("child_process"); const c = spawn("sleep", ["30"], { detached: true, stdio: "ignore" }); c.unref(); console.log(c.pid); setTimeout(() => {}, 30000)`

test("supervisor: a descendant that left the group is recorded, stopped and proven gone before the run settles", async () => {
  const stack = recordingStack()
  let leader = null
  let escaped = null
  let scratch = null
  // The process table as ps -E would read it while the child runs (ps is unavailable in the sandbox): the
  // detached browser inherited the child's private TMPDIR, which still proves it ours once the leader is gone.
  const table = () => (leader && escaped && groupAlive(escaped) ? [{ pid: leader, ppid: process.pid, pgid: leader }, { pid: escaped, ppid: leader, pgid: escaped, command: `sleep 30 TMPDIR=${scratch}` }] : [])
  const dir = temp()
  const receipt = createReceipt(join(dir, "receipt.json"), { runId: "guard-escape" })
  const sup = supervise({ stack, table, receipt, log: quiet, watchMs: 20 })
  const out = { write: (t) => (escaped ??= Number(t.trim())) }
  const running = sup.run("playwright charters", process.execPath, ["-e", DETACHED], {}, 1500, { out })
  await waitFor(() => escaped !== null)
  scratch = sup.report().groups[0].scratch
  leader = stack.stopped.length ? null : sup.report().groups[0].pgid
  await waitFor(() => JSON.parse(readFileSync(receipt.path, "utf8")).groups[0]?.escaped?.includes(escaped), 5000)
  const r = await running
  assert.equal(r.code, 124)
  assert.equal(r.settled, true, JSON.stringify(sup.report().reasons))
  assert.equal(groupAlive(escaped), false, "the escaped browser group is gone")
  assert.deepEqual(stack.stopped, [leader, escaped])
  assert.deepEqual(sup.report().groups[0].evidence.escaped, { [escaped]: "absent" })
  rmSync(dir, { recursive: true, force: true })
})

test("supervisor: an escaped group not proven this run's, or an unreadable process table, is uncertain and never killed", async () => {
  // A recorded group whose live members are not pids this run recorded (the pgid was reused).
  const stack = recordingStack()
  const stranger = spawnSync(process.execPath, ["-e", "const c=require('child_process').spawn('sleep',['30'],{detached:true,stdio:'ignore'});c.unref();console.log(c.pid)"], { encoding: "utf8" })
  const other = Number(stranger.stdout.trim())
  let leader = null
  let reused = false
  // While the child runs it has a descendant 424242 in group `other`; by stop time that pid is gone
  // and `other` holds only an unrelated process, so the group is not proven this run's.
  const table = () =>
    !leader ? [] : reused ? [{ pid: leader, ppid: 1, pgid: leader }, { pid: other, ppid: 1, pgid: other }] : [{ pid: leader, ppid: 1, pgid: leader }, { pid: 424242, ppid: leader, pgid: other }]
  const sup = supervise({ stack, table, log: quiet, watchMs: 20, absenceMs: 200 })
  const running = sup.run("e2e staff", "/bin/sh", ["-c", "sleep 30"], {}, 60_000)
  leader = sup.report().groups[0].pgid
  await sleep(100)
  reused = true
  await sup.interrupt("signal")
  const r = await running
  try {
    assert.equal(r.settled, false)
    assert.match(sup.report().reasons.join("\n"), new RegExp(`escaped descendant groups remain: ${other} not proven this run's`))
    assert.equal(groupAlive(other), true, "a group not proven ours is never signalled")
    assert.deepEqual(stack.stopped, [leader])
  } finally {
    process.kill(-other, "SIGKILL")
  }
  // Without a process table, escaped descendants are unknown: uncertain.
  const blind = supervise({ stack: recordingStack(), table: () => null, log: quiet, watchMs: 20 })
  const b = await blind.run("build", "/bin/sh", ["-c", "exit 0"], {}, 60_000)
  assert.equal(b.settled, false)
  assert.match(blind.report().reasons[0], /process table could not be read/)
})

test("verifyCheckout refuses repository state that hides source from status", () => {
  const cases = [
    [({ dir, g }) => (writeFileSync(join(dir, ".env.example"), "EXAMPLE=evil\n"), g("update-index", "--skip-worktree", ".env.example")), /skip-worktree or assume-unchanged/],
    [({ dir, g }) => (writeFileSync(join(dir, ".env.example"), "EXAMPLE=evil\n"), g("update-index", "--assume-unchanged", ".env.example")), /skip-worktree or assume-unchanged/],
    [({ dir }) => (mkdirSync(join(dir, "app"), { recursive: true }), writeFileSync(join(dir, "app", "evil.ts"), "x"), writeFileSync(join(dir, ".git", "info", "exclude"), "app/evil.ts\n")), /no tracked \.gitignore ignores \(app\/evil\.ts\)/],
    [({ dir }) => (mkdirSync(join(dir, "app", "route"), { recursive: true }), writeFileSync(join(dir, "app", "route", "page.ts"), "x"), writeFileSync(join(dir, "app", "route", ".gitignore"), "*\n")), /no tracked \.gitignore ignores \(app\/route\//],
    [({ g }) => g("config", "--local", "filter.hide.clean", "cat"), /local git config sets filter\.hide\.clean/],
    [({ g }) => g("config", "--local", "core.attributesFile", "/dev/null"), /local git config sets core\.attributesfile/],
  ]
  for (const [mutate, message] of cases) {
    const repo = gitRepo()
    mkdirSync(join(repo.dir, ".git", "info"), { recursive: true })
    verifyCheckout(repo.dir, repo.pin)
    mutate(repo)
    assert.throws(() => verifyCheckout(repo.dir, repo.pin), message)
    rmSync(repo.dir, { recursive: true, force: true })
  }
  // Ignored build output and Claude tooling state stay acceptable.
  const repo = gitRepo()
  mkdirSync(join(repo.dir, "node_modules", "x"), { recursive: true })
  writeFileSync(join(repo.dir, "node_modules", "x", "index.js"), "x")
  mkdirSync(join(repo.dir, ".claude", "worktrees"), { recursive: true })
  writeFileSync(join(repo.dir, ".claude", "worktrees", "state"), "x")
  mkdirSync(join(repo.dir, ".git", "info"), { recursive: true })
  writeFileSync(join(repo.dir, ".git", "info", "exclude"), "# tooling\n.claude/\n")
  verifyCheckout(repo.dir, repo.pin)
  rmSync(repo.dir, { recursive: true, force: true })
})

test("late app output after app.log is closed is dropped, never a crash", async () => {
  const dir = temp()
  const log = privateStream(join(dir, "app.log"))
  log.write("ready\n")
  await log.close()
  log.write("late line from a group that never settled\n")
  await sleep(50)
  assert.equal(readFileSync(join(dir, "app.log"), "utf8"), "ready\n")
  assert.equal(statSync(join(dir, "app.log")).mode & 0o777, 0o600)
  assert.throws(() => privateStream(join(dir, "app.log")), /EEXIST/)
  rmSync(dir, { recursive: true, force: true })
})

// ---- The shared lane guard, proven signals and launch output ----------------------------------------------

test("the lane is clear only with a proven root and no blocker or receipt; the blocker is read, never changed", () => {
  const root = temp("b02-lane-")
  const paths = { root, receiptPath: join(root, "spare6.b02-acceptance.receipt.json"), blockerPath: join(root, "spare6.qualification.blocker.json") }
  chmodSync(root, 0o755)
  requireLaneClear(paths)
  // Another qualification's blocker, as the B10 runner writes it: refused with its own state, and left byte for byte.
  const bytes = JSON.stringify({ state: "settlement_pending", stack: "nabalens-ws-spare6", phase: "security-tests", runnerPid: 4242, nonce: "n" }) + "\n"
  writeFileSync(paths.blockerPath, bytes, { mode: 0o600 })
  assert.throws(() => requireLaneClear(paths), /spare6 is blocked by another qualification's lane blocker at .*settlement_pending for security-tests, runner pid 4242/)
  assert.throws(() => requireNoQualificationBlocker(paths.blockerPath), /lane blocker/)
  assert.equal(readFileSync(paths.blockerPath, "utf8"), bytes)
  assert.equal(statSync(paths.blockerPath).mode & 0o777, 0o600)
  rmSync(paths.blockerPath)
  // Anything at the path counts, and a link is never followed.
  symlinkSync(join(root, "elsewhere.json"), paths.blockerPath)
  assert.throws(() => requireLaneClear(paths), /lane blocker at .*\(a link\)/)
  rmSync(paths.blockerPath)
  mkdirSync(paths.blockerPath)
  assert.throws(() => requireLaneClear(paths), /lane blocker at .*\(not a file\)/)
  rmSync(paths.blockerPath, { recursive: true })
  writeFileSync(paths.blockerPath, "not json")
  assert.throws(() => requireLaneClear(paths), /lane blocker at .*\(unreadable\)/)
  rmSync(paths.blockerPath)
  // A B02 receipt of any run blocks too.
  writeFileSync(paths.receiptPath, JSON.stringify({ state: "blocked", runId: "earlier" }))
  assert.throws(() => requireLaneClear(paths), /blocked by an earlier B02 run's receipt .*blocked receipt of run earlier/)
  rmSync(paths.receiptPath)
  requireLaneClear(paths)
  // The root itself: writable by others, a link, or guard paths outside it.
  chmodSync(root, 0o777)
  assert.throws(() => requireLaneClear(paths), /writable by others \(mode 777\)/)
  chmodSync(root, 0o755)
  const link = join(temp("b02-lane-link-"), "nabalens-ws")
  symlinkSync(root, link)
  assert.throws(() => requireLaneClear({ root: link, receiptPath: join(link, "r.json"), blockerPath: join(link, "b.json") }), /must be a real directory, not a link/)
  assert.throws(() => requireLaneClear({ ...paths, blockerPath: join(tmpdir(), "spare6.qualification.blocker.json") }), /must sit directly in the lane root/)
  rmSync(dirname(link), { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
})

test("locked run: a lane blocker refuses the run before its receipt, and one appearing mid-run stops the next phase", async () => {
  const world = productWorld()
  const off = offlineRun(world)
  const { blockerPath, receiptPath } = off.overrides
  const bytes = JSON.stringify({ state: "settlement_pending", phase: "apply", runnerPid: 4242 }) + "\n"
  writeFileSync(blockerPath, bytes, { mode: 0o600 })
  await assert.rejects(off.run("guard-lane-before"), /spare6 is blocked by another qualification's lane blocker/)
  assert.deepEqual(off.calls, [])
  assert.equal(existsSync(receiptPath), false, "no receipt is created while the lane is held")
  assert.equal(existsSync(join(off.overrides.results, "guard-lane-before")), false)
  rmSync(blockerPath)
  // Appearing after the seed: the build never starts; this run settles and clears only its own receipt.
  const seed = off.overrides.seed
  off.overrides.seed = async (c, sup) => {
    await seed(c, sup)
    writeFileSync(blockerPath, bytes, { mode: 0o600 })
  }
  assert.equal(await off.run("guard-lane-during"), 1)
  assert.deepEqual(off.calls, ["seed"])
  const summary = off.summaryOf("guard-lane-during")
  assert.match(summary.error, /lane blocker/)
  assert.equal(summary.settlement.settled, true)
  assert.equal(existsSync(receiptPath), false)
  assert.equal(readFileSync(blockerPath, "utf8"), bytes, "the other qualification's blocker is left as it was")
  off.cleanup()
  world.cleanup()
})

test("groupProof: a signal needs every member proven by a live leader that is the runner's child or by the private path", () => {
  const runner = 100
  const marker = "/tmp/nb02-abcdef"
  const leader = { pid: 10, ppid: runner, pgid: 10 }
  const child = { pid: 11, ppid: 10, pgid: 10 }
  const marked = { pid: 12, ppid: 1, pgid: 10, command: "node", env: `TMPDIR=${marker}` }
  assert.equal(groupProof([leader, child], 10, 10, [marker], runner), "proven")
  assert.equal(groupProof([marked], 10, 10, [marker], runner), "proven", "leader gone: the private path still proves it")
  // Leader gone and an unmarked member: the id may have been reused.
  assert.equal(groupProof([{ pid: 13, ppid: 1, pgid: 10 }], 10, 10, [marker], runner), "not proven this run's")
  // A stranger now leading a reused id is not the runner's child.
  assert.equal(groupProof([{ pid: 10, ppid: 1, pgid: 10 }, { pid: 14, ppid: 10, pgid: 10 }], 10, 10, [marker], runner), "not proven this run's")
  assert.equal(groupProof([leader, { pid: 15, ppid: 1, pgid: 10 }], 10, 10, [marker], runner), "not proven this run's (mixed membership)")
  // An escaped group is proven through the owner's proven processes.
  assert.equal(groupProof([leader, { pid: 20, ppid: 10, pgid: 20 }], 20, 10, [marker], runner), "proven")
  assert.equal(groupProof([leader], 30, 10, [marker], runner), "no visible member")
  assert.equal(groupProof(null, 10, 10, [marker], runner), "the process table could not be read")
  assert.deepEqual([...provenOwned([leader, child, { pid: 16, ppid: 1, pgid: 10 }], 10, [], runner)].sort(), [10, 11])
})

test("terminateProvenGroup proves ownership immediately before each signal, the SIGKILL escalation included", async () => {
  const run = async ({ alive, proofs }) => {
    const sent = []
    let probes = 0
    const probe = () => (alive(probes++, sent) ? "alive" : "absent")
    const said = await terminateProvenGroup(4242, () => proofs.shift() ?? "proven", { signal: (pid, name) => sent.push([pid, name]), probe, graceMs: 30, killMs: 30 })
    return { said, sent }
  }
  // Already gone: nothing is signalled.
  assert.deepEqual(await run({ alive: () => false, proofs: [] }), { said: "absent", sent: [] })
  // Not proven: nothing is signalled.
  assert.deepEqual(await run({ alive: () => true, proofs: ["not proven this run's"] }), { said: "SIGTERM withheld: not proven this run's", sent: [] })
  // SIGTERM is ignored and the id is reused before escalation: SIGKILL is withheld.
  assert.deepEqual(await run({ alive: () => true, proofs: ["proven", "not proven this run's"] }), { said: "SIGKILL withheld: not proven this run's", sent: [[-4242, "SIGTERM"]] })
  // Proven both times: SIGTERM, then SIGKILL, each to the group.
  const both = await run({ alive: (n, sent) => sent.length < 2, proofs: [] })
  assert.deepEqual(both, { said: "absent", sent: [[-4242, "SIGTERM"], [-4242, "SIGKILL"]] })
  // SIGTERM is enough: no escalation.
  assert.deepEqual(await run({ alive: (n, sent) => sent.length < 1, proofs: [] }), { said: "absent", sent: [[-4242, "SIGTERM"]] })
})

const psReadable = processTable([]) !== null
test("supervisor, live stop: a child ignoring SIGTERM is escalated only after a fresh ps proof, then proven gone", { skip: !psReadable && "ps -E is unavailable" }, async () => {
  const sent = []
  const sup = createSupervisor({ scratchRoot: SCRATCH, listeners: noListeners, log: quiet, signal: (pid, name) => (sent.push(name), process.kill(pid, name)), graceMs: 300, killMs: 2000, absenceMs: 2000 })
  const r = await sup.run("seed", "/bin/sh", ["-c", "trap '' TERM; sleep 30 & wait"], {}, 300)
  const { pgid } = sup.report().groups[0]
  assert.deepEqual([r.code, r.settled], [124, true], JSON.stringify(sup.report().reasons))
  assert.deepEqual(sent, ["SIGTERM", "SIGKILL"])
  assert.equal(groupAlive(pgid), false)
  // A stranger's group (not this runner's child, no private path) is never signalled by the live stop.
  const stranger = spawnSync(process.execPath, ["-e", "const c=require('child_process').spawn('sleep',['30'],{detached:true,stdio:'ignore'});c.unref();console.log(c.pid)"], { encoding: "utf8" })
  const other = Number(stranger.stdout.trim())
  try {
    const none = []
    const said = await terminateProvenGroup(other, () => groupProof(processTable([]), other, other, []), { signal: (pid, name) => none.push(name), graceMs: 50, killMs: 50 })
    assert.equal(said, "SIGTERM withheld: not proven this run's")
    assert.deepEqual(none, [])
    assert.equal(groupAlive(other), true)
  } finally {
    process.kill(-other, "SIGKILL")
  }
})

test("launch output: after collection the suite's output is still absent (e2e) or empty (charters), inside the private chain", async () => {
  const root = temp("b02-launch-")
  const { runRoot } = prepareRunRoot("guard-launch", join(root, ".results"))
  assert.equal(requireLaunchOutput(runRoot, "staff", join(runRoot, "staff")), join(runRoot, "staff"))
  assert.throws(() => requireLaunchOutput(runRoot, "staff", join(runRoot, "manager")), /is not staff's output/)
  mkdirSync(join(runRoot, "staff"), { mode: 0o700 })
  assert.throws(() => requireLaunchOutput(runRoot, "staff", join(runRoot, "staff")), /already exists/)
  mkdirSync(join(runRoot, "charters"), { mode: 0o700 })
  assert.equal(requireLaunchOutput(runRoot, "charters", join(runRoot, "charters")), join(runRoot, "charters"))
  writeFileSync(join(runRoot, "charters", "report.json"), "{}")
  assert.throws(() => requireLaunchOutput(runRoot, "charters", join(runRoot, "charters")), /not empty after collection \(report\.json\)/)
  rmSync(join(runRoot, "charters"), { recursive: true })
  symlinkSync(temp("b02-launch-elsewhere-"), join(runRoot, "charters"))
  assert.throws(() => requireLaunchOutput(runRoot, "charters", join(runRoot, "charters")), /real directory, not a link/)
  rmSync(root, { recursive: true, force: true })

  // Through the wrappers: a collection that creates or fills the output never reaches the run.
  const fake = fakeE2E()
  const checkout = temp("b02-pw-")
  const pw = fakePlaywright(checkout)
  const stack = recordingStack()
  const wrapRoot = temp("b02-wrap-")
  const context = (id) => {
    const { runRoot: rr, world } = prepareRunRoot(id, join(wrapRoot, ".results"))
    return { rr, c: { id, runRoot: rr, runDir: world, stackEnv: STACK_VALUES.env, secrets: STACK_VALUES.secrets, checkout, e2eInstall: fake.install, e2e: resolveE2E(fake.install, {}) } }
  }
  {
    const { rr, c } = context("guard-launch-e2e")
    fake.set({ manager: { pairs: pairsOf("manager"), report: e2eReport("manager"), createOnList: join(rr, "manager") } })
    await assert.rejects(runE2E(c, "manager", supervise({ table: noEscapes, stack })), /manager already exists; a suite writes into a new directory/)
    assert.deepEqual(fake.invocations().map((i) => i.kind), ["list"])
  }
  {
    const { rr, c } = context("guard-launch-pw")
    pw.set({ listing: pwReport({ listing: true }), leaveOnList: join(rr, "charters", "stale.json") })
    await assert.rejects(runCharters(c, supervise({ table: noEscapes, stack })), /not empty after collection \(stale\.json\)/)
    assert.deepEqual(pw.invocations().map((i) => i.kind), ["list"])
  }
  rmSync(wrapRoot, { recursive: true, force: true })
  rmSync(checkout, { recursive: true, force: true })
  rmSync(fake.dir, { recursive: true, force: true })
})

test("signal proof is the exact TMPDIR entry in the environment: a process that only names the scratch path in its arguments is never signalled", async () => {
  const marker = "/tmp/nb02-abcdef"
  // Offline rows: a mention in argv, a longer path, or the entry nested in another value prove nothing.
  for (const row of [
    { pid: 12, ppid: 1, pgid: 12, command: `tail -f ${marker}/app.log` },
    { pid: 12, ppid: 1, pgid: 12, command: `du -sh ${marker}`, env: "PATH=/usr/bin" },
    { pid: 12, ppid: 1, pgid: 12, command: "sh", env: `TMPDIR=${marker}/sub` },
    { pid: 12, ppid: 1, pgid: 12, command: "sh", env: `FOO=TMPDIR=${marker}` },
  ]) {
    assert.equal(groupProof([row], 12, 10, [marker], 100), "not proven this run's", JSON.stringify(row))
  }
  assert.equal(groupProof([{ pid: 12, ppid: 1, pgid: 12, command: "sleep 30", env: `PATH=/usr/bin TMPDIR=${marker} HOME=/x` }], 12, 10, [marker], 100), "proven")
  assert.equal(hasTmpdirEntry(`A=1 TMPDIR=${marker}`, [marker]), true)
  assert.equal(hasTmpdirEntry(null, [marker]), false)
  // Discovery still sees the broad mention (fail-safe: lingering and sweep), only signalling needs the entry.
  assert.deepEqual([...ownedProcesses([{ pid: 12, ppid: 1, pgid: 12, command: `tail ${marker}/x` }], 10, [marker], { group: false })], [12])
})

test("live ps: an unrelated process naming a scratch path in argv is detected but not proven, so no signal reaches it; one inheriting TMPDIR is proven", { skip: !psReadable && "ps -E is unavailable" }, async () => {
  const marker = join(SCRATCH, `nb02-f1-${process.pid}`)
  // Started through an intermediate that exits, so neither is this runner's child. Node, not a system
  // binary: macOS hides the environment of platform binaries such as /bin/sh from ps -E.
  const start = (env, extra) =>
    Number(
      spawnSync(process.execPath, ["-e", `const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)',...${JSON.stringify(extra)}],{detached:true,stdio:'ignore',env:${JSON.stringify(env)}});c.unref();console.log(c.pid)`], { encoding: "utf8" }).stdout.trim()
    )
  const mention = start({ PATH: "/usr/bin:/bin" }, [`${marker}/`])
  const inherits = start({ PATH: "/usr/bin:/bin", TMPDIR: marker }, [])
  try {
    await waitFor(() => (processTable([marker]) ?? []).some((row) => row.pid === mention), 5000)
    const rows = processTable([marker])
    const m = rows.find((row) => row.pid === mention)
    assert.deepEqual([m.marked, m.envMarked], [true, false], "argv mention: detected, not proof")
    assert.equal(groupProof(rows, mention, mention, [marker]), "not proven this run's")
    const sent = []
    const said = await terminateProvenGroup(mention, () => groupProof(processTable([marker]), mention, mention, [marker]), { signal: (pid, name) => sent.push(name), graceMs: 50, killMs: 50 })
    assert.equal(said, "SIGTERM withheld: not proven this run's")
    assert.deepEqual(sent, [])
    assert.equal(groupAlive(mention), true)
    const i = rows.find((row) => row.pid === inherits)
    assert.equal(i.envMarked, true, "the inherited TMPDIR entry is proof")
    assert.equal(groupProof(rows, inherits, inherits, [marker]), "proven")
  } finally {
    for (const pid of [mention, inherits]) if (pid > 1 && groupAlive(pid)) process.kill(-pid, "SIGKILL")
  }
})

test("terminateProvenGroup never signals process group 0, 1 or a non-integer", async () => {
  for (const pgid of [0, 1, -5, 1.5, undefined]) {
    const sent = []
    const said = await terminateProvenGroup(pgid, () => "proven", { signal: (pid, name) => sent.push([pid, name]), probe: () => "alive", graceMs: 10, killMs: 10 })
    assert.equal(said, "SIGTERM withheld: not a valid process group")
    assert.deepEqual(sent, [])
  }
})

test("the receipt is replaced and cleared only while the path still holds the file this run wrote", () => {
  const dir = temp()
  const path = join(dir, "receipt.json")
  const receipt = createReceipt(path, { runId: "guard-own" })
  receipt.update({ runRoot: "/x" })
  // Another file swapped in at the path (same name, different inode): never overwritten or removed.
  const foreign = JSON.stringify({ runId: "someone-else" })
  rmSync(path)
  writeFileSync(path, foreign, { mode: 0o600 })
  assert.throws(() => receipt.update({ runRoot: "/y" }), /was replaced by something else/)
  assert.throws(() => receipt.block(["x"]), /was replaced by something else/)
  assert.throws(() => receipt.clear(), /was replaced by something else/)
  assert.equal(readFileSync(path, "utf8"), foreign)
  assert.deepEqual(readdirSync(dir).sort(), ["receipt.json"], "no temp file is left behind")
  rmSync(path)
  assert.throws(() => receipt.clear(), /was replaced by something else/)
  rmSync(dir, { recursive: true, force: true })
})

test("a stale revision.json is refused: the live ledger and the fixture manifest decide, not the reset record", () => {
  const world = productWorld()
  const { ctx: c, workdir } = world
  const revision = (patch) => writeFileSync(join(workdir, "revision.json"), JSON.stringify({ ...world.revision, ...patch }))
  const manifest = (body) => writeFileSync(join(workdir, "fixtures.json"), JSON.stringify(body))
  const resetAt = "2026-11-11T00:11:47.629Z"
  // A reset that loaded fixtures: the manifest from the same reset agrees.
  revision({ fixtures: "journey-world: 5 people, 2 venues", resetAt })
  manifest({ stack: "spare6", loadedAt: "2026-11-11T00:11:46.000Z", menus: [], media: [] })
  verifyProductInputs(c)
  assert.deepEqual(verifyFixtureManifest(workdir), { fixtures: "journey-world: 5 people, 2 venues", loadedAt: "2026-11-11T00:11:46.000Z" })
  // A later reset failed part-way: fixtures.json was cleared first and revision.json was never rewritten.
  rmSync(join(workdir, "fixtures.json"))
  assert.throws(() => verifyProductInputs(c), /records fixtures \(journey-world: 5 people, 2 venues\) but fixtures\.json is missing: a later reset failed part-way and revision\.json is stale/)
  // A manifest from another reset, another stack, or after the record, or not JSON.
  for (const [body, message] of [
    [{ stack: "spare6", loadedAt: "2026-11-10T19:45:00.000Z" }, /is not from the reset revision\.json records/],
    [{ stack: "spare6", loadedAt: "2026-11-11T00:20:00.000Z" }, /is not from the reset revision\.json records/],
    [{ stack: "spare4", loadedAt: "2026-11-11T00:11:46.000Z" }, /fixtures\.json is for spare4/],
    [{ stack: "spare6" }, /is not from the reset/],
  ]) {
    manifest(body)
    assert.throws(() => verifyProductInputs(c), message, JSON.stringify(body))
  }
  writeFileSync(join(workdir, "fixtures.json"), "{not json")
  assert.throws(() => verifyProductInputs(c), /fixtures\.json is malformed/)
  rmSync(join(workdir, "fixtures.json"))
  symlinkSync(join(workdir, "revision.json"), join(workdir, "fixtures.json"))
  assert.throws(() => verifyProductInputs(c), /fixtures\.json is a link/)
  rmSync(join(workdir, "fixtures.json"))
  // revision.json says no fixtures but a manifest is there: they disagree.
  revision({ fixtures: "none" })
  manifest({ stack: "spare6", loadedAt: world.revision.resetAt })
  assert.throws(() => verifyProductInputs(c), /records no fixtures, but fixtures\.json exists/)
  rmSync(join(workdir, "fixtures.json"))
  verifyProductInputs(c)
  // The B04 case: revision.json still names the pin's 49 migrations, the live database has 67 others.
  const live = [...c.pinned.versions, ...Array.from({ length: 65 }, (_, i) => `2026111100${String(i).padStart(4, "0")}`)]
  world.ledger.versions = live
  assert.throws(() => verifyProductInputs(c), new RegExp(`applied ledger has ${live.length} versions, not the pinned ${c.pinned.versions.length}`))
  world.ledger.versions = ["20260101000000", "20261111000001"]
  assert.throws(() => verifyProductInputs(c), /first difference at 1: 20261111000001 where the pin has 20260102000000/)
  world.ledger.versions = [...c.pinned.versions]
  verifyProductInputs(c)
  world.cleanup()
})

test("the budget gate's guards use the same live-lane check as run.mjs (verifyProductInputs), before the lock and again under it", () => {
  const source = readFileSync(fileURLToPath(new URL("./budget.mjs", import.meta.url)), "utf8")
  assert.equal((source.match(/verifyProductInputs\(ctx\)/g) ?? []).length, 2)
})

test("budget gate: the under-lock recheck re-reads candidate.json, the harness, Playwright, the stack env, the inputs, the reset and the port", async () => {
  const world = productWorld()
  fakePlaywright(world.dir).set({})
  const root = temp("b02-budget-lock-")
  chmodSync(root, 0o755)
  const lockDir = join(root, "spare6.lock")
  const label = "b02 budget gate budget-test"
  mkdirSync(lockDir)
  writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, what: label, since: new Date().toISOString() }))
  const ctx = { ...world.ctx, harness: harnessState(), playwright: requirePlaywright(world.dir), reset: budgetResetManifest(world.workdir) }
  let ports = 0
  const d = {
    lockDir,
    laneRoot: root,
    blockerPath: join(root, "spare6.qualification.blocker.json"),
    loadPin: () => world.ctx.pin,
    fresh: () => freshOf(stackEnvOf()),
    requireFreePort: async () => void ports++,
  }
  const again = (patch = {}, dd = {}) => recheckUnderLock({ ...ctx, ...patch }, label, { ...d, ...dd })
  await again()
  assert.equal(ports, 1, "the port is checked")
  await assert.rejects(again({}, { loadPin: () => ({ ...world.ctx.pin, commit: "0".repeat(40) }) }), /candidate\.json changed during the run/)
  await assert.rejects(again({ harness: { ...ctx.harness, commit: "f".repeat(40) } }), /The harness changed during the run/)
  await assert.rejects(again({ playwright: { ...ctx.playwright, version: "0.0.1" } }), /Playwright changed during the run/)
  await assert.rejects(recheckUnderLock(ctx, "another label", d), /lock/i)
  await assert.rejects(again({}, { fresh: () => freshOf(stackEnvOf(), { SERVICE_ROLE_KEY: "rotated-service-role-value" }) }), /does not match a fresh supabase status/)
  await assert.rejects(again({}, { requireFreePort: async () => { throw new Error("Port 3646 is in use") } }), /3646 is in use/)
  writeFileSync(d.blockerPath, JSON.stringify({ state: "settlement_pending", phase: "b04", runnerPid: 1 }))
  await assert.rejects(again(), /lane blocker/)
  rmSync(d.blockerPath)
  // The reset changed after the guards (another reset, or a failed one: fixtures.json gone).
  writeFileSync(join(world.workdir, "revision.json"), JSON.stringify({ ...world.revision, resetAt: "2026-11-11T09:00:00.000Z" }))
  await assert.rejects(again(), /revision\.json changed between the guards and the lock/)
  world.ledger.versions = [...world.ctx.pinned.versions, "20261111000001"]
  await assert.rejects(again(), /applied ledger has/)
  world.cleanup()
  rmSync(root, { recursive: true, force: true })
})

// ---- Offline guard ----------------------------------------------------------------------------------------

test("offline guard: the live lane is unreachable from these tests and from every runner child they spawn", () => {
  // In this process: the default lane paths are refused before any read.
  assert.throws(() => requireLaneClear(), /cannot be inspected \(ELIVELANE\)/)
  assert.throws(() => requireNoQualificationBlocker(), /cannot be inspected \(ELIVELANE\)/)
  assert.throws(() => requireNoReceipt(), /cannot be inspected \(ELIVELANE\)/)
  forgetLiveLaneTouches(3)
  // In a spawned node child preloaded as the runner tests preload it.
  const child = spawnSync(process.execPath, ["-e", "require('fs').lstatSync('/tmp/nabalens-ws')"], { env: { PATH: process.env.PATH, NODE_OPTIONS: GUARD_IMPORT }, encoding: "utf8" })
  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /ELIVELANE|touched the live lane/)
})

after(() => {
  assert.deepEqual(liveLaneTouches(), [], "an offline test touched the live spare6 lane")
})
