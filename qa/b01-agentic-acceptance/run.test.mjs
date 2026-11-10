// Offline guard tests for run.mjs: no database, app, browser, network or lock.
//   node --test qa/b01-agentic-acceptance/run.test.mjs
// Uses this repository as a stand-in checkout (it contains the candidate
// commit) and its scripts/ci/stack.mjs for the process-group helpers.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import * as realStack from "../../scripts/ci/stack.mjs"
import { bounded, candidateMigrationsDigest, parse, requireCanonicalRoot, validatedStackEnvironment, verifyStack } from "./run.mjs"

const RUNNER = fileURLToPath(new URL("./run.mjs", import.meta.url))
const REPO = fileURLToPath(new URL("../..", import.meta.url))
const CANDIDATE = "a41cc6b41562be4ff3717102d1dd0c35a117d2eb"

test("an inherited NABALENS_WS_ROOT is rejected before anything runs", () => {
  assert.throws(() => requireCanonicalRoot({ NABALENS_WS_ROOT: "/tmp/elsewhere" }), /NABALENS_WS_ROOT/)
  assert.throws(() => requireCanonicalRoot({ NABALENS_WS_ROOT: "" }), /NABALENS_WS_ROOT/)
  requireCanonicalRoot({})
  const env = { ...process.env, NABALENS_WS_ROOT: "/tmp/elsewhere", B01_CHECKOUT: REPO }
  const r = spawnSync(process.execPath, [RUNNER, "check"], { env, encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /NABALENS_WS_ROOT is set/)
})

test("run requires --build and refuses --reuse-build", () => {
  assert.throws(() => parse(["run"]), /needs --build/)
  assert.throws(() => parse(["run", "--reuse-build"]), /needs --build/)
  assert.throws(() => parse(["run", "--build", "--reuse-build"]), /needs --build/)
  assert.deepEqual(parse(["run", "--build", "--suites", "journey"]).flags, { build: true, suites: "journey" })
})

test("the candidate digest mirrors stack.mjs migrationsDigest", () => {
  const fromCommit = candidateMigrationsDigest(REPO, CANDIDATE)
  assert.match(fromCommit, /^[0-9a-f]{64}$/)
  // supabase/migrations is unchanged between the candidate and this commit.
  assert.equal(fromCommit, realStack.migrationsDigest(join(REPO, "supabase", "migrations")))
})

const SPEC = {
  name: "spare6",
  project: "nabalens-ws-spare6",
  workdir: "/tmp/nabalens-ws/spare6",
  apiPort: 64621,
  dbPort: 64622,
  appPort: 3646,
}
const goodStatus = () => ({
  state: "running",
  project: SPEC.project,
  workdir: SPEC.workdir,
  migrations: { applied: 3, latest: "3", matchesRecordedFiles: true },
  lastReset: { from: REPO, commit: CANDIDATE, dirty: false, migrationsDigest: "d".repeat(64) },
})
const check = (status, spec = SPEC, digest = "d".repeat(64)) =>
  verifyStack({ statusOf: () => status }, spec, REPO, digest)

test("verifyStack accepts the clean candidate stack and rejects each mismatch", () => {
  check(goodStatus())
  const cases = [
    [(s) => (s.state = "stopped"), /not running/],
    [(s) => (s.workdir = "/tmp/elsewhere/spare6"), /not running/],
    [(s) => (s.lastReset = null), /no revision\.json/],
    [(s) => (s.lastReset.commit = "0".repeat(40)), /not the clean candidate/],
    [(s) => (s.lastReset.dirty = true), /not the clean candidate/],
    [(s) => delete s.lastReset.dirty, /not the clean candidate/],
    [(s) => (s.lastReset.from = "/tmp"), /another checkout/],
    [(s) => (s.migrations = null), /applied migrations/],
    [(s) => (s.migrations.matchesRecordedFiles = null), /applied migrations/],
    [(s) => (s.migrations.matchesRecordedFiles = false), /applied migrations/],
    [(s) => (s.lastReset.migrationsDigest = "e".repeat(64)), /digest/],
  ]
  for (const [mutate, message] of cases) {
    const status = goodStatus()
    mutate(status)
    assert.throws(() => check(status), message)
  }
  assert.throws(() => check(goodStatus(), { ...SPEC, workdir: "/tmp/elsewhere/spare6" }), /workdir/)
  assert.throws(() => check(goodStatus(), { ...SPEC, dbPort: 1 }), /dbPort/)
  assert.throws(() => check(goodStatus(), SPEC, null), /digest/)
})

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

test("bounded: spawn failure resolves without signalling anything", async () => {
  const stack = recordingStack()
  const code = await bounded(stack, "missing", "/nonexistent/b01-no-such-binary", [], { stdio: "ignore" }, 60_000)
  assert.equal(code, 127)
  assert.deepEqual(stack.stopped, [])
  assert.equal(stack.hooks(), 0)
})

test("bounded: normal close returns the exit code after checking its own group", async () => {
  const stack = recordingStack()
  assert.equal(await bounded(stack, "true", "/bin/sh", ["-c", "exit 0"], { stdio: "ignore" }, 60_000), 0)
  assert.equal(await bounded(stack, "three", "/bin/sh", ["-c", "exit 3"], { stdio: "ignore" }, 60_000), 3)
  assert.equal(stack.stopped.length, 2)
  assert.ok(stack.stopped.every((pid) => !groupAlive(pid)))
  assert.equal(stack.hooks(), 0)
})

test("bounded: an abnormal leader exit cleans up surviving descendants", async () => {
  const stack = recordingStack()
  const code = await bounded(stack, "orphan", "/bin/sh", ["-c", "sleep 30 & exit 3"], { stdio: "ignore" }, 60_000)
  assert.equal(code, 3)
  assert.equal(stack.stopped.length, 1)
  assert.equal(groupAlive(stack.stopped[0]), false)
  assert.equal(stack.hooks(), 0)
})

test("stack environment is read and validated again after a reset", () => {
  let generation = 1
  const stack = {
    stackEnv: () => ({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:64621",
      E2E_DB_URL: "postgresql://postgres@127.0.0.1:64622/postgres",
      SUPABASE_SERVICE_ROLE_KEY: `dummy-service-${generation}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `dummy-public-${generation}`,
    }),
  }
  const before = validatedStackEnvironment(stack, SPEC)
  generation++
  const after = validatedStackEnvironment(stack, SPEC)
  assert.notEqual(after.SUPABASE_SERVICE_ROLE_KEY, before.SUPABASE_SERVICE_ROLE_KEY)
  assert.notEqual(after.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, before.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  assert.throws(() => validatedStackEnvironment({ stackEnv: () => ({ ...after, E2E_DB_URL: "postgresql://remote.invalid:64622/postgres" }) }, SPEC), /127\.0\.0\.1/)
})

test("bounded: a timeout resolves only after its own group is gone", async () => {
  const stack = recordingStack()
  // The leader ignores SIGTERM and keeps a grandchild in its group, so cleanup
  // must escalate and outlast the leader's own exit.
  const script = "trap '' TERM; sleep 30 & wait"
  const started = Date.now()
  const code = await bounded(stack, "hang", "/bin/sh", ["-c", script], { stdio: "ignore" }, 200)
  assert.equal(code, 124)
  assert.equal(stack.stopped.length, 1)
  assert.equal(groupAlive(stack.stopped[0]), false, "child group still alive after bounded resolved")
  assert.ok(Date.now() - started < 15_000)
  assert.equal(stack.hooks(), 0)
})
