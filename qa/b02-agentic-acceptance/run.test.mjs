// Offline guard tests for run.mjs and fixture.ts: no database, app, browser,
// model, network or stack lock. Temporary git repositories, fake psql and
// short-lived local processes only.
//   node --test qa/b02-agentic-acceptance/run.test.mjs
// Uses this repository as a stand-in checkout where only git objects are
// needed (it contains the pinned candidate commit) and its
// scripts/ci/stack.mjs for the process-group helpers.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as realStack from "../../scripts/ci/stack.mjs"
import {
  bounded,
  buildEnv,
  commitMigrations,
  e2eEnv,
  expectedInstances,
  freshOutput,
  HARNESS,
  isSuite,
  JOURNAL,
  lineRedactor,
  listEnv,
  loadPin,
  parse,
  PLAN,
  playwrightEnv,
  prepareRunRoot,
  readJson,
  redact,
  requireCanonicalRoot,
  requireFreePort,
  requireNoWebServer,
  runId,
  scrubArtifacts,
  secretsOf,
  seedEnv,
  serverEnv,
  startJournal,
  suiteFiles,
  suitesFrom,
  summarise,
  SUITES,
  TOTAL_INSTANCES,
  validatedStackEnvironment,
  validateE2EReport,
  validateListedPairs,
  validatePlaywrightReport,
  verifyCheckout,
  verifyLockOwner,
  verifyPinnedMigrations,
  verifyServerOwner,
  verifyStack,
} from "./run.mjs"

const RUNNER = fileURLToPath(new URL("./run.mjs", import.meta.url))
const FIXTURE = pathToFileURL(fileURLToPath(new URL("./fixture.ts", import.meta.url))).href
const REPO = fileURLToPath(new URL("../..", import.meta.url))
const E2E = join(process.env.B02_E2E_HOME ?? homedir(), "node_modules", ".bin", "e2e")

/** The exact application candidate this harness must accept (split contract), never the harness snapshot. */
const PINNED = {
  commit: "1c5389497f15d4aec04bad77568223ec82537cd1",
  tree: "bb009c741c3269dc367e8788b4e2eba64968a316",
  migrationsDigest: "22f8296906983c88bc214c08c28b8c669914f41a321e16f7af0360bfe8359caf",
  migrationCount: 49,
  latestMigration: "20261110095911",
}
const HARNESS_SNAPSHOT = "2bfd50909d7773c5631c677910f94ad6e09ca63e"

const temp = (prefix = "b02-guard-") => mkdtempSync(join(tmpdir(), prefix))
let fixtureImports = 0
const freshFixture = () => import(`${FIXTURE}?case=${++fixtureImports}`)

// ---- The pin ------------------------------------------------------------------------

test("candidate.json pins exactly the 1c538949 application, its tree and its 49-migration digest", () => {
  assert.deepEqual({ ...loadPin() }, PINNED)
  assert.notEqual(loadPin().commit, HARNESS_SNAPSHOT)
  const fromGit = commitMigrations(REPO, PINNED.commit)
  assert.deepEqual(fromGit, { digest: PINNED.migrationsDigest, count: 49, latest: PINNED.latestMigration })
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

function gitRepo() {
  const dir = temp("b02-checkout-")
  const g = (...args) => {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=guard", "-c", "user.email=guard@example.invalid", ...args], { encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  g("init", "-q")
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260101000000_one.sql"), "select 1;\n")
  writeFileSync(join(dir, "supabase", "migrations", "20260102000000_two.sql"), "select 2;\n")
  writeFileSync(join(dir, ".gitignore"), ".env*\n!.env.example\n.next/\n")
  writeFileSync(join(dir, ".env.example"), "EXAMPLE=1\n")
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

test("the runner refuses a non-candidate checkout before any lock or write", () => {
  const id = `guard-${process.pid}-head`
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, B02_CHECKOUT: REPO, B02_RUN_ID: id }
  const r = spawnSync(process.execPath, [RUNNER, "run", "--build"], { env, encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /not the pinned candidate 1c5389497f15d4aec04bad77568223ec82537cd1/)
  assert.equal(existsSync(join(HARNESS, ".results", id)), false)
  const missing = spawnSync(process.execPath, [RUNNER, "seed"], { env: { ...env, B02_CHECKOUT: "" }, encoding: "utf8" })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /absolute path/)
})

// ---- The stack ---------------------------------------------------------------------------

const SPEC = {
  name: "spare6",
  project: "nabalens-ws-spare6",
  workdir: "/tmp/nabalens-ws/spare6",
  apiPort: 64621,
  dbPort: 64622,
  mailpitPort: 64624,
  appPort: 3646,
}
const goodStatus = () => ({
  state: "running",
  project: SPEC.project,
  workdir: SPEC.workdir,
  migrations: { applied: PINNED.migrationCount, latest: PINNED.latestMigration, matchesRecordedFiles: true },
  lastReset: { from: REPO, commit: PINNED.commit, dirty: false, migrationsDigest: PINNED.migrationsDigest },
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

test("the stack environment is read fresh, validated, narrowed to four values and its credentials collected", () => {
  let generation = 1
  const stack = { stackEnv: () => stackEnvOf({ SUPABASE_SERVICE_ROLE_KEY: `dummy-service-role-${generation}` }) }
  const before = validatedStackEnvironment(stack, SPEC)
  generation++
  const after = validatedStackEnvironment(stack, SPEC)
  assert.notEqual(after.env.SUPABASE_SERVICE_ROLE_KEY, before.env.SUPABASE_SERVICE_ROLE_KEY)
  assert.deepEqual(Object.keys(after.env).sort(), ["E2E_DB_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  const names = after.secrets.map((s) => s.name).sort()
  assert.deepEqual(names, ["DB_PASSWORD", "E2E_DB_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_DB_URL", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"])
  const bad = (overrides, message) => assert.throws(() => validatedStackEnvironment({ stackEnv: () => stackEnvOf(overrides) }, SPEC), message)
  bad({ E2E_DB_URL: "postgresql://postgres@db.example.invalid:64622/postgres" }, /127\.0\.0\.1/)
  bad({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, /64621/)
  bad({ SUPABASE_DB_URL: "postgresql://postgres@127.0.0.1:54322/postgres" }, /SUPABASE_DB_URL/)
  bad({ MAILPIT_URL: "http://127.0.0.1:54324" }, /MAILPIT_URL/)
  bad({ SUPABASE_SERVICE_ROLE_KEY: "" }, /SUPABASE_SERVICE_ROLE_KEY/)
  bad({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, /PUBLISHABLE_KEY/)
  bad({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dummy-service-role-value" }, /same/)
  bad({ E2E_DB_URL: "not a url" }, /not a URL/)
})

// ---- Child environments ------------------------------------------------------------------

const ctx = {
  stackEnv: validatedStackEnvironment({ stackEnv: () => stackEnvOf() }, SPEC).env,
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
  PLAYWRIGHT_BROWSERS_PATH: "/browsers",
}
const keys = (env) => Object.keys(env).sort()
const RUN = ["APP_URL", "B02_RUN_DIR", "B02_RUN_ID", "B02_STACK"]

test("each child gets only what it needs: seed, build, server, e2e and Playwright", () => {
  assert.deepEqual(keys(seedEnv(BASE, ctx)), [...RUN, "B02_CHECKOUT", "B02_VIA_RUNNER", "E2E_DB_URL", "E2E_ISOLATED_STACK", "HOME", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "PATH", "SUPABASE_SERVICE_ROLE_KEY"].sort())
  const build = buildEnv(BASE, ctx)
  assert.deepEqual(keys(build), ["HOME", "NABALENS_CONTRIBUTION_ENTRY", "NABALENS_HOME_LAYOUT", "NABALENS_MANAGER_TRIAGE", "NABALENS_MY_CONTRIBUTIONS", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_TELEMETRY_DISABLED", "PATH"])
  assert.equal(build.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:64621")
  assert.equal(build.NEXT_PUBLIC_SITE_URL, "http://127.0.0.1:3646")
  assert.deepEqual(keys(serverEnv(BASE, ctx)), [...keys(build), "SUPABASE_SERVICE_ROLE_KEY"].sort())
  const e2e = e2eEnv(BASE, ctx, "staff")
  assert.deepEqual(keys(e2e), [...RUN, "B02_SUITE", "E2E_DB_URL", "HOME", "NEXT_PUBLIC_SUPABASE_URL", "PATH", "PLAYWRIGHT_BROWSERS_PATH", "SUPABASE_SERVICE_ROLE_KEY"].sort())
  const pw = playwrightEnv(BASE, ctx, "/abs/report.json")
  assert.deepEqual(keys(pw), [...keys(e2e), "B02_CHECKOUT", "PLAYWRIGHT_JSON_OUTPUT_FILE"].sort())
  assert.equal(pw.B02_SUITE, "charters")
  for (const env of [seedEnv(BASE, ctx), build, serverEnv(BASE, ctx), e2e, pw, listEnv("staff", BASE)]) {
    for (const leaked of ["DATABASE_URL", "VERCEL_TOKEN", "SUPABASE_JWT_SECRET", "NABALENS_HOME_LAYOUT_B01_VENUES", "CI", "SUPABASE_DB_URL", "MAILPIT_URL", "E2E_SUPABASE_WORKDIR"]) {
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

test("the e2e config refuses inherited suite names before collecting anything", { skip: !existsSync(E2E) && "no standalone e2e" }, () => {
  for (const name of ["toString", "__proto__", "constructor"]) {
    const r = spawnSync(E2E, ["list", "--config", join(HARNESS, "e2e.config.ts"), "--reporter", "json"], { cwd: HARNESS, encoding: "utf8", env: listEnv(name) })
    assert.notEqual(r.status, 0, name)
    assert.match(r.stdout + r.stderr, /B02_SUITE must be staff, manager, recovery or layout/, name)
  }
})

test("the plan is the fixed 4 + 8 + 2 + 1x4 + 2 = 20 instances, matching the e2e config", () => {
  assert.deepEqual(SUITES, ["staff", "manager", "recovery", "layout", "charters"])
  assert.deepEqual(SUITES.map(expectedInstances), [4, 8, 2, 4, 2])
  assert.equal(TOTAL_INSTANCES, 20)
  assert.deepEqual(Object.keys(PLAN.layout.targets), ["phone-320", "phone-375", "phone-390", "desktop"])
  assert.equal(PLAN.staff.agent.api, "agent.act")
  assert.deepEqual({ ...PLAN.layout.agent }, { api: "agent.assert", perTarget: true })
  const config = readFileSync(join(HARNESS, "e2e.config.ts"), "utf8")
  for (const s of SUITES.filter((name) => PLAN[name].kind === "e2e")) assert.ok(config.includes(`${s}: { tests: '${PLAN[s].file}'`), s)
  assert.ok(!/charters:\s*\{/.test(config), "the charters are not an e2e suite")
})

test("run ids are one plain segment; the default is generated in that form", () => {
  for (const bad of [".", "..", "a/b", ".hidden", "a.b", "-x", "_x", "x".repeat(65), "", "a b", "../x"]) {
    assert.throws(() => runId({ B02_RUN_ID: bad }), /plain segment/, bad)
  }
  assert.equal(runId({ B02_RUN_ID: "b02-1c53-20261110" }), "b02-1c53-20261110")
  assert.match(runId({}, new Date("2026-11-10T18:00:00.000Z")), /^b02-2026-11-10T18-00-00-000Z$/)
})

// ---- Paths, journal and world binding -------------------------------------------------------

test("a run's output directory is created exclusively in a real .results; suite output must be new", () => {
  const root = temp()
  const results = join(root, ".results")
  const { runRoot, world } = prepareRunRoot("guard-a", results)
  assert.equal(statSync(runRoot).mode & 0o777, 0o700)
  assert.ok(existsSync(world))
  assert.throws(() => prepareRunRoot("guard-a", results), /already exists/)
  assert.throws(() => prepareRunRoot("..", results), /not a run id/)
  mkdirSync(join(runRoot, "staff"))
  assert.throws(() => freshOutput(runRoot, "staff"), /already exists/)
  assert.equal(freshOutput(runRoot, "layout"), join(runRoot, "layout"))
  assert.throws(() => freshOutput(runRoot, "toString"), /not a suite/)
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
  assert.equal(spawnSync("ls", ["-A", dir], { encoding: "utf8" }).stdout.includes(".tmp"), false)
  rmSync(dir, { recursive: true, force: true })
})

const TARGET_ENV = {
  B02_STACK: "spare6",
  APP_URL: "http://127.0.0.1:3646",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:64621",
  E2E_DB_URL: "postgresql://postgres:dummy-db-password@127.0.0.1:64622/postgres",
}
function withEnv(values, fn) {
  const saved = {}
  for (const k of Object.keys(values)) saved[k] = process.env[k]
  Object.assign(process.env, values)
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
/** A world directory of this harness for run `id`, removed afterwards. */
function worldOf(id, world, header = { runId: id, candidate: PINNED.commit }) {
  const dir = join(HARNESS, ".results", id, "world")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  startJournal(dir, header)
  if (world) writeFileSync(join(dir, "world.json"), JSON.stringify(world))
  return dir
}
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
})

test("world() loads only this run's complete world for the pinned candidate", async () => {
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
        else assert.equal(fixture.world().runId, id)
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
  mkdirSync(join(HARNESS, ".results"), { recursive: true })
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

test("read-only psql gets the database through libpq variables, never the URL on its command line", async () => {
  const dir = temp()
  const psql = join(dir, "psql")
  writeFileSync(psql, `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/args'\nenv | grep '^PG' | sort > '${dir}/env'\ncat > '${dir}/stdin'\necho '["00000000-0000-4000-8000-000000000001"]'\n`)
  chmodSync(psql, 0o755)
  await withEnv({ ...TARGET_ENV, PATH: `${dir}:${process.env.PATH}` }, async () => {
    const fixture = await freshFixture()
    const viewer = "00000000-0000-4000-8000-000000000002"
    const seen = fixture.db.communityReadable(viewer, ["00000000-0000-4000-8000-000000000001"])
    assert.deepEqual(seen, ["00000000-0000-4000-8000-000000000001"])
    const args = readFileSync(join(dir, "args"), "utf8")
    assert.equal(args, "-X\n-qAt\n-v\nON_ERROR_STOP=1\n")
    const env = readFileSync(join(dir, "env"), "utf8")
    assert.match(env, /PGHOST=127\.0\.0\.1\nPGOPTIONS=-c default_transaction_read_only=on\nPGPASSWORD=dummy-db-password\nPGPORT=64622\nPGUSER=postgres/)
    const sql = readFileSync(join(dir, "stdin"), "utf8")
    assert.match(sql, /set local role authenticated/)
    assert.match(sql, /json_agg\(x\.id order by x\.id\)/)
    assert.equal(fixture.db.drafts(viewer, viewer), NaN) // the fake answers JSON, not a count
    assert.match(readFileSync(join(dir, "stdin"), "utf8"), /and user_id = '00000000-0000-4000-8000-000000000002'::uuid/)
    for (const key of Object.keys(fixture.pgEnv())) assert.ok(key.startsWith("PG"))
  })
  await withEnv({ ...TARGET_ENV, E2E_DB_URL: "postgresql://postgres@db.example.invalid:64622/postgres" }, async () => {
    const fixture = await freshFixture()
    assert.throws(() => fixture.readOnly("select 1"), /spare6's database/)
  })
  rmSync(dir, { recursive: true, force: true })
})

test("the charters' Playwright comes from the candidate checkout", async () => {
  const dir = temp()
  const entry = join(dir, "node_modules", "@playwright", "test")
  mkdirSync(entry, { recursive: true })
  writeFileSync(join(entry, "index.mjs"), "export {}\n")
  await withEnv({ B02_CHECKOUT: dir }, async () => {
    const fixture = await freshFixture()
    assert.equal(fixture.candidatePlaywrightTest(), pathToFileURL(join(realpathOf(dir), "node_modules", "@playwright", "test", "index.mjs")).href)
  })
  await withEnv({ B02_CHECKOUT: "relative" }, async () => {
    const fixture = await freshFixture()
    assert.throws(() => fixture.candidatePlaywrightTest(), /B02_CHECKOUT/)
  })
  rmSync(dir, { recursive: true, force: true })
})
const realpathOf = (p) => spawnSync("realpath", [p], { encoding: "utf8" }).stdout.trim()

// ---- Lock and server owner ---------------------------------------------------------------------

test("an inherited NABALENS_WS_ROOT is rejected before anything runs", () => {
  assert.throws(() => requireCanonicalRoot({ NABALENS_WS_ROOT: "/tmp/elsewhere" }), /NABALENS_WS_ROOT/)
  assert.throws(() => requireCanonicalRoot({ NABALENS_WS_ROOT: "" }), /NABALENS_WS_ROOT/)
  requireCanonicalRoot({})
  for (const command of ["check", "seed", "list"]) {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, NABALENS_WS_ROOT: "/tmp/elsewhere", B02_CHECKOUT: REPO }
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

// ---- Redaction ----------------------------------------------------------------------------------

const SECRETS = secretsOf({ SERVICE: "service-role-secret-value", DB: "postgresql://postgres:pw-secret-1@127.0.0.1:64622/postgres", SHORT: "postgres" })

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

test("artifact scrub redacts text in place, flags binary hits and symlinks, and makes everything private", () => {
  const root = temp()
  mkdirSync(join(root, "staff", "artifacts"), { recursive: true })
  writeFileSync(join(root, "staff", "report.json"), JSON.stringify({ message: "auth service-role-secret-value failed" }), { mode: 0o644 })
  writeFileSync(join(root, "staff", "artifacts", "shot.png"), Buffer.concat([Buffer.from([0x89, 0, 1]), Buffer.from("service-role-secret-value")]))
  writeFileSync(join(root, "app.log"), "nothing to see\n")
  symlinkSync("/etc/hosts", join(root, "staff", "link"))
  const found = scrubArtifacts(root, SECRETS)
  assert.deepEqual(found.redacted, [{ file: "staff/report.json", secret: "SERVICE" }])
  assert.deepEqual(found.binary, [{ file: "staff/artifacts/shot.png", secret: "SERVICE" }])
  assert.deepEqual(found.symlinks, ["staff/link"])
  assert.equal(JSON.parse(readFileSync(join(root, "staff", "report.json"), "utf8")).message, "auth [redacted:SERVICE] failed")
  assert.equal(statSync(join(root, "staff", "report.json")).mode & 0o777, 0o600)
  assert.equal(statSync(join(root, "staff")).mode & 0o777, 0o700)
  const summary = summarise({ id: "x", pin: PINNED, harness: {}, suites: [], results: {}, scrub: found })
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.scrub.problems, ["credential value in binary staff/artifacts/shot.png", "symlink staff/link"])
  rmSync(root, { recursive: true, force: true })
})

// ---- Report validation ---------------------------------------------------------------------------

const START = Date.parse("2026-11-10T19:00:00.000Z")
const agentStep = (api, overrides = {}) => ({
  kind: "agent",
  api,
  status: "passed",
  metrics: { modelCalls: 2, actionSteps: 1 },
  cache: { mode: "missed", replayedActions: 0, totalActions: 1 },
  ...overrides,
})
function e2eReport(suite, { serial = false, agent = true } = {}) {
  const plan = PLAN[suite]
  const results = []
  const groups = new Map()
  let i = 0
  for (const [targetId, n] of Object.entries(plan.targets)) {
    for (let k = 0; k < n; k++) {
      const testId = `t${i}`
      const steps = [{ kind: "assertion", api: "expect", status: "passed" }]
      if (plan.agent && agent && k === 0) steps.push(agentStep(plan.agent.api))
      const base = { id: `r${i}`, testId, kind: "test", titlePath: [`B02 ${suite}`, `case ${k}`], file: plan.file, targetId, repeat: 0, selected: true, status: "passed" }
      if (serial) {
        const id = `g-${targetId}`
        if (!groups.has(id)) groups.set(id, { id, targetId, status: "passed", attempts: [{ status: "passed", members: [] }] })
        groups.get(id).attempts[0].members.push({ testId, status: "passed", steps })
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
      startedAt: new Date(START + 1000).toISOString(),
      project: { id: `nabalens-b02-agentic-${suite}` },
      errors: [],
      summary: { discovered: i, selected: i, executed: i, passed: i, failed: 0, flaky: 0, skipped: 0 },
      results,
      serialGroups: [...groups.values()],
      usage: { modelTokens: plan.agent && agent ? 4321 : 0 },
    },
  }
}
const verdict = (report, suite) => validateE2EReport(report, suite, { startedAtMs: START })
const fails = (report, suite, message) => {
  const v = verdict(report, suite)
  assert.equal(v.ok, false, `expected a failure matching ${message}`)
  assert.ok(v.problems.some((p) => message.test(p)), `${message} not in ${JSON.stringify(v.problems)}`)
}

test("well-formed reports pass, plain or serial, with live agent work where the plan asks", () => {
  for (const suite of ["staff", "manager", "recovery", "layout"]) {
    for (const serial of [false, true]) {
      const v = verdict(e2eReport(suite, { serial }), suite)
      assert.deepEqual(v.problems, [], `${suite} serial=${serial}`)
      assert.equal(v.counts.passed, expectedInstances(suite))
    }
  }
  assert.deepEqual(verdict(e2eReport("layout"), "layout").counts.agentSteps, { "agent.assert:passed": 4 })
  assert.throws(() => validateE2EReport({}, "charters"), /not an e2e suite/)
  assert.throws(() => validateE2EReport({}, "toString"), /not an e2e suite/)
})

test("missing, malformed or foreign reports fail", () => {
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
  const stale = e2eReport("manager")
  stale.run.startedAt = new Date(START - 60_000).toISOString()
  fails(stale, "manager", /predates/)
  const noDate = e2eReport("manager")
  delete noDate.run.startedAt
  fails(noDate, "manager", /predates/)
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
        r.run.summary.skipped = 1
        r.run.summary.passed--
      },
      /is skipped/,
    ],
    [(r) => (r.run.summary.skipped = 1), /summary skipped is 1/],
    [(r) => (r.run.results[0].status = "flaky"), /is flaky/],
    [(r) => r.run.results[0].attempts.unshift({ status: "failed", steps: [] }), /one attempt/],
    [(r) => (r.run.results[0].selected = false), /not selected/],
    [(r) => (r.run.results[0].kind = "setup"), /setup result/],
    [(r) => (r.run.results[0].repeat = 1), /repeat 1/],
    [(r) => r.run.results.pop(), /7 results, expected 8/],
    [(r) => r.run.results.push({ ...r.run.results[0], id: "extra", titlePath: ["extra"] }), /9 results/],
    [(r) => (r.run.results[1].titlePath = r.run.results[0].titlePath), /appears twice/],
    [(r) => (r.run.results[0].file = "staff.e2e.ts"), /not manager\.e2e\.ts/],
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
  regrouped.run.serialGroups[0].attempts.unshift({ status: "failed", members: [] })
  fails(regrouped, "manager", /after 2 attempts/)
  const orphan = e2eReport("manager", { serial: true })
  orphan.run.serialGroups = []
  fails(orphan, "manager", /missing serial group/)
})

test("staff without a live agent.act, or layout without a live agent.assert at every target, fails", () => {
  fails(e2eReport("staff", { agent: false }), "staff", /no passed live agent\.act/)
  fails(e2eReport("staff", { agent: false }), "staff", /no model tokens/)
  const noCalls = e2eReport("staff")
  noCalls.run.results[0].attempts[0].steps[1].metrics.modelCalls = 0
  fails(noCalls, "staff", /no passed live agent\.act/)
  const cached = e2eReport("staff", { serial: true })
  cached.run.serialGroups[0].attempts[0].members[0].steps[1].cache.mode = "self-finalized"
  fails(cached, "staff", /replayed from the cache/)
  const failedAct = e2eReport("staff")
  failedAct.run.results[0].attempts[0].steps[1].status = "failed"
  fails(failedAct, "staff", /no passed live agent\.act/)
  const wrongKind = e2eReport("staff")
  wrongKind.run.results[0].attempts[0].steps[1].api = "agent.assert"
  fails(wrongKind, "staff", /no passed live agent\.act/)
  const missing375 = e2eReport("layout")
  missing375.run.results.find((r) => r.targetId === "phone-375").attempts[0].steps.pop()
  fails(missing375, "layout", /no passed live agent\.assert with model calls at phone-375/)
  const twoAt320 = e2eReport("layout")
  twoAt320.run.results.find((r) => r.targetId === "phone-375").targetId = "phone-320"
  fails(twoAt320, "layout", /phone-320 has 2 results, expected 1/)
  fails(twoAt320, "layout", /phone-375 has 0 results/)
  // Manager and recovery need no agent work: zero is fine there.
  assert.equal(verdict(e2eReport("recovery", { agent: false }), "recovery").ok, true)
})

function pwReport({ listing = false } = {}) {
  const spec = (title) => ({
    title,
    file: "charters.playwright.ts",
    tests: [{ expectedStatus: "passed", status: listing ? undefined : "expected", annotations: [], projectName: "chromium", results: listing ? [] : [{ status: "passed", retry: 0 }] }],
  })
  return {
    config: { webServer: null, projects: [{ name: "chromium", retries: 0 }] },
    suites: [{ title: "charters.playwright.ts", file: "charters.playwright.ts", specs: [spec("B02-06-A interrupted upload"), spec("B02-06-B offline draft")], suites: [] }],
    errors: [],
    ...(listing ? {} : { stats: { startTime: new Date(START + 500).toISOString(), expected: 2, unexpected: 0, flaky: 0, skipped: 0 } }),
  }
}
const pwFails = (report, message, options = { startedAtMs: START }) => {
  const v = validatePlaywrightReport(report, options)
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => message.test(p)), `${message} not in ${JSON.stringify(v.problems)}`)
}

test("the charters' Playwright report must show exactly two fresh passes and no webServer", () => {
  assert.deepEqual(validatePlaywrightReport(pwReport(), { startedAtMs: START }).problems, [])
  assert.deepEqual(validatePlaywrightReport(pwReport({ listing: true }), { listing: true }).problems, [])
  const cases = [
    [(r) => (r.config.webServer = { command: "next start" }), /webServer/],
    [(r) => r.errors.push({ message: "boom" }), /top-level errors/],
    [(r) => r.suites[0].specs.pop(), /1 tests, expected 2/],
    [(r) => (r.suites[0].specs[1].title = r.suites[0].specs[0].title), /not distinct/],
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
  pwFails(null, /not a Playwright JSON report/)
  pwFails({ suites: [] }, /not a Playwright JSON report/)
  // Nested describe blocks still count once each.
  const nested = pwReport()
  nested.suites[0].suites = [{ title: "inner", specs: [nested.suites[0].specs.pop()], suites: [] }]
  assert.equal(validatePlaywrightReport(nested, { startedAtMs: START }).ok, true)
})

test("collection pairs must match the plan exactly per target", () => {
  const pairs = (suite) =>
    Object.entries(PLAN[suite].targets).flatMap(([target, n]) =>
      Array.from({ length: n }, (_, i) => ({ file: PLAN[suite].file, title: `case ${i}`, titlePath: ["s", `case ${i}`], kind: "test", tags: [], target, disposition: "run" }))
    )
  assert.equal(validateListedPairs(pairs("layout"), "layout").ok, true)
  assert.equal(validateListedPairs(pairs("manager"), "manager").count, 8)
  const skipped = pairs("staff")
  skipped[0].disposition = "skip"
  assert.match(validateListedPairs(skipped, "staff").problems.join(), /would be skipped/)
  assert.match(validateListedPairs(pairs("manager").slice(1), "manager").problems.join(), /7 collected, expected 8/)
  const setup = pairs("recovery")
  setup[0].kind = "setup"
  assert.match(validateListedPairs(setup, "recovery").problems.join(), /is a setup/)
  assert.equal(validateListedPairs(undefined, "staff").ok, false)
})

test("the summary counts only fully passing selected suites; a partial run is never completion", () => {
  const pass = { ok: true }
  const all = Object.fromEntries(SUITES.map((s) => [s, pass]))
  const full = summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: { redacted: [], binary: [], symlinks: [] } })
  assert.equal(full.ok, true)
  assert.equal(full.complete, true)
  assert.deepEqual(full.instances, { planned: 20, selected: 20, passed: 20 })
  const partial = summarise({ id: "x", pin: PINNED, harness: {}, suites: ["staff"], results: { staff: pass }, scrub: {} })
  assert.equal(partial.complete, false)
  assert.equal(partial.suites.manager.status, "not selected")
  const failed = summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: { ...all, layout: { ok: false } }, scrub: {} })
  assert.equal(failed.ok, false)
  assert.equal(failed.instances.passed, 16)
  assert.equal(summarise({ id: "x", pin: PINNED, harness: {}, suites: [...SUITES], results: all, scrub: {}, error: "boom" }).ok, false)
})

// ---- Partner files and the charters' config ---------------------------------------------------------

test("missing partner files are reported per suite; a charters config may not declare a webServer", () => {
  const dir = temp()
  assert.deepEqual(suiteFiles("charters", dir).missing, ["charters.playwright.ts", "charters.config.ts"])
  writeFileSync(join(dir, "charters.config.ts"), "export default { use: { baseURL: process.env.APP_URL } }\n")
  requireNoWebServer(dir)
  writeFileSync(join(dir, "charters.config.ts"), "export default { webServer: { command: 'next start' } }\n")
  assert.throws(() => requireNoWebServer(dir), /webServer/)
  assert.deepEqual(suiteFiles("staff", dir).missing, ["staff.e2e.ts"])
  rmSync(dir, { recursive: true, force: true })
})

// ---- Seed against the candidate's helpers ----------------------------------------------------------------

test("every repository helper and fixture seed.ts uses exists in the pinned candidate", () => {
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
  spawnSync("git", ["-C", REPO, "cat-file", "-e", `${PINNED.commit}:tests/fixtures/media/synthetic.mp4`]).status === 0 || assert.fail("synthetic.mp4")
  const seed = readFileSync(join(HARNESS, "seed.ts"), "utf8")
  assert.match(seed, /appendJournal\(dir, \{ kind: "intent"/)
  // The journal intent precedes every helper write in each step.
  assert.ok(seed.indexOf('appendJournal(dir, { kind: "tag"') < seed.indexOf("worldHelpers.createVenues("))
})

// ---- Geometry sources ---------------------------------------------------------------------------------------

test("the page geometry sources are callable function expressions, never invoked expressions", async () => {
  const evaluation = join(process.env.B02_E2E_HOME ?? homedir(), "node_modules", "@e2e-dev", "web", "dist", "evaluation.js")
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

// ---- Children --------------------------------------------------------------------------------------------------

/** Real terminateGroup/onTerminate, recording which groups were stopped and hooks left behind. */
function recordingStack() {
  const stopped = []
  let hooks = 0
  return {
    stopped,
    hooks: () => hooks,
    async terminateGroup(pid) {
      stopped.push(pid)
      await realStack.terminateGroup(pid, 500)
    },
    onTerminate(hook) {
      hooks++
      const unhook = realStack.onTerminate(hook)
      return () => {
        hooks--
        unhook()
      }
    },
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

test("bounded: spawn failure resolves without signalling anything", async () => {
  const stack = recordingStack()
  const code = await bounded(stack, "missing", "/nonexistent/b02-no-such-binary", [], { stdio: "ignore" }, 60_000)
  assert.equal(code, 127)
  assert.deepEqual(stack.stopped, [])
  assert.equal(stack.hooks(), 0)
})

test("bounded: normal exit returns the code after settling its own group, output redacted", async () => {
  const stack = recordingStack()
  const out = sink()
  const err = sink()
  const env = { PATH: process.env.PATH, KEY: "service-role-secret-value" }
  const script = 'echo "key $KEY"; echo "err $KEY" >&2; exit 3'
  assert.equal(await bounded(stack, "three", "/bin/sh", ["-c", script], { env }, 60_000, SECRETS, out, err), 3)
  assert.equal(out.text(), "key [redacted:SERVICE]\n")
  assert.equal(err.text(), "err [redacted:SERVICE]\n")
  assert.equal(await bounded(stack, "zero", "/bin/sh", ["-c", "exit 0"], { stdio: "ignore" }, 60_000), 0)
  assert.ok(stack.stopped.every((pid) => !groupAlive(pid)))
  assert.equal(stack.hooks(), 0)
})

test("bounded: an abnormal leader exit cleans up surviving descendants before resolving", async () => {
  const stack = recordingStack()
  const code = await bounded(stack, "orphan", "/bin/sh", ["-c", "sleep 30 & exit 3"], { stdio: "ignore" }, 60_000)
  assert.equal(code, 3)
  assert.equal(stack.stopped.length, 1)
  assert.equal(groupAlive(stack.stopped[0]), false)
  assert.equal(stack.hooks(), 0)
})

test("bounded: a timeout resolves only after its own group is gone", async () => {
  const stack = recordingStack()
  // The leader ignores SIGTERM and keeps a grandchild in its group, so cleanup
  // must escalate and outlast the leader's own exit.
  const started = Date.now()
  const code = await bounded(stack, "hang", "/bin/sh", ["-c", "trap '' TERM; sleep 30 & wait"], { stdio: "ignore" }, 200)
  assert.equal(code, 124)
  assert.equal(stack.stopped.length, 1)
  assert.equal(groupAlive(stack.stopped[0]), false, "child group still alive after bounded resolved")
  assert.ok(Date.now() - started < 15_000)
  assert.equal(stack.hooks(), 0)
})
