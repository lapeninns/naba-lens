// Offline tests for budget.mjs: no stack, app, browser, lock or network. Pure functions and fixtures only.
//   node --test qa/b02-agentic-acceptance/budget.test.mjs
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  BUDGET_GROUPS,
  budgetListEnv,
  budgetRunEnv,
  budgetRunId,
  EXPECTED_CASES,
  FINALIZE_MS,
  groupArgs,
  judgeGroup,
  resetManifest,
  summariseBudget,
  terminationHook,
  validateMeasurement,
  validateSelection,
} from "./budget.mjs"

const SOURCE = readFileSync(fileURLToPath(new URL("./budget.mjs", import.meta.url)), "utf8")
const byName = Object.fromEntries(BUDGET_GROUPS.map((g) => [g.name, g]))
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "b02-budget-")))

// Every title in the candidate's phone-width block (upload-label-flow.spec.ts, c4671823), budget or not.
const BLOCK_TITLES = [360, 412].flatMap((w) => [
  `d @${w}: known dish from Our menu in at most 2 taps and 1 modal (J5)`,
  `d2 @${w}: Choose from photos on a dish opens the photo library, photos only`,
  `e1 @${w}: Add with one dish in at most 6 taps and 3 modals`,
  `e2 @${w}: batch of 3 with one exception in at most 9 taps and 3 modals`,
])

const spec = (id, title, { project = "chromium", results = [{ status: "passed", attachments: [] }], expectedStatus = "passed", file = "tests/e2e/upload-label-flow.spec.ts" } = {}) => ({
  id,
  title,
  file,
  tests: [{ projectName: project, expectedStatus, results }],
})
const reportOf = (...specs) => ({ suites: [{ title: "upload-label-flow.spec.ts", specs }] })
const casesOf = (group, opts = {}) => Object.entries(group.cases).map(([id, title]) => spec(id, title, typeof opts === "function" ? opts(id) : opts))
const measuredResult = (group, path = `/out/${group.name}.json`) => [{ status: "passed", attachments: [{ name: `${group.name}-taps-and-modals`, path, contentType: "application/json" }] }]
const ok = { code: 0, settled: true }

test("the plan is exactly five groups and six cases: E1 and E2 at 360 and 412 (measured), J5 at both widths (asserted)", () => {
  assert.deepEqual(BUDGET_GROUPS.map((g) => g.name), ["e1-360", "e1-412", "e2-360", "e2-412", "j5"])
  assert.equal(EXPECTED_CASES, 6)
  assert.deepEqual(
    BUDGET_GROUPS.flatMap((g) => Object.keys(g.cases)),
    [
      "6ba767f6c311117e4d57-513ca76ffea133db7fb8",
      "6ba767f6c311117e4d57-849ee240b53576c8d092",
      "6ba767f6c311117e4d57-f2e5dae724f391c4b5e1",
      "6ba767f6c311117e4d57-57ceccb41c1d3bd75143",
      "6ba767f6c311117e4d57-02e1abfec4ac2e26ec31",
      "6ba767f6c311117e4d57-03317c923f5c1c8517d2",
    ]
  )
  assert.deepEqual(BUDGET_GROUPS.map((g) => [g.budget.taps, g.budget.modals, g.budget.measured]), [
    [6, 3, true],
    [6, 3, true],
    [9, 3, true],
    [9, 3, true],
    [2, 1, false],
  ])
  assert.ok(Object.isFrozen(BUDGET_GROUPS) && BUDGET_GROUPS.every((g) => Object.isFrozen(g) && Object.isFrozen(g.cases) && Object.isFrozen(g.budget)))
})

test("each group's grep selects exactly its own titles from the phone-width block (never d2, never the other width)", () => {
  for (const group of BUDGET_GROUPS) {
    const re = new RegExp(group.grep)
    assert.deepEqual(BLOCK_TITLES.filter((t) => re.test(t)).sort(), Object.values(group.cases).sort(), group.name)
  }
})

test("the selection must be exactly the group's case IDs and titles, once, in the spec file, on chromium", () => {
  const e1 = byName["e1-360"]
  const j5 = byName.j5
  assert.equal(validateSelection(reportOf(...casesOf(j5)), j5).ok, true)
  const [a, b] = casesOf(j5)
  assert.match(validateSelection(reportOf(a), j5).problems.join(), /1 cases selected, expected 2.*missing case 6ba767f6c311117e4d57-03317c923f5c1c8517d2/)
  assert.match(validateSelection(reportOf(a, b, spec("x-1", "d2 @360: Choose from photos")), j5).problems.join(), /unexpected case x-1/)
  assert.match(validateSelection(reportOf(a, a), j5).problems.join(), /appears twice/)
  assert.match(validateSelection(reportOf(spec(Object.keys(e1.cases)[0], "e1 @360: renamed")), e1).problems.join(), /is titled "e1 @360: renamed"/)
  assert.match(validateSelection(reportOf(...casesOf(e1, { project: "firefox" })), e1).problems.join(), /not exactly one chromium test/)
  assert.match(validateSelection(reportOf(...casesOf(e1, { file: "tests/e2e/other.spec.ts" })), e1).problems.join(), /is in tests\/e2e\/other\.spec\.ts/)
  assert.equal(validateSelection(null, e1).ok, false)
})

test("a measurement must be the candidate's recordBudget shape with the approved limits, and within them", () => {
  const e2 = byName["e2-412"]
  assert.deepEqual(validateMeasurement({ taps: 9, modals: 3, limits: { taps: 9, modals: 3 }, route: "Add > A dish" }, e2), { ok: true, problems: [], taps: 9, modals: 3, route: "Add > A dish" })
  assert.match(validateMeasurement({ taps: 10, modals: 3, limits: { taps: 9, modals: 3 } }, e2).problems.join(), /10 taps and 3 modals exceed 9 and 3/)
  assert.match(validateMeasurement({ taps: 9, modals: 4, limits: { taps: 9, modals: 3 } }, e2).problems.join(), /exceed/)
  assert.match(validateMeasurement({ taps: 6, modals: 3, limits: { taps: 6, modals: 3 } }, e2).problems.join(), /not the approved 9 taps and 3 modals/)
  assert.match(validateMeasurement({ taps: 1.5, modals: 3, limits: { taps: 9, modals: 3 } }, e2).problems.join(), /taps is not a whole number/)
  assert.equal(validateMeasurement(null, e2).ok, false)
})

test("a measured group passes only with exit 0, settlement, its one passing case and exactly one in-budget measurement", () => {
  const g = byName["e1-412"]
  const read = (m) => () => m
  const pass = judgeGroup(g, ok, reportOf(...casesOf(g, { results: measuredResult(g) })), read({ taps: 6, modals: 3, limits: { taps: 6, modals: 3 }, route: "r" }))
  assert.equal(pass.ok, true, JSON.stringify(pass.problems))
  assert.deepEqual(pass.cases[0].budget, { status: "within", taps: 6, modals: 3, route: "r", tapsLimit: 6, modalsLimit: 3 })
  const over = judgeGroup(g, ok, reportOf(...casesOf(g, { results: measuredResult(g) })), read({ taps: 7, modals: 3, limits: { taps: 6, modals: 3 } }))
  assert.equal(over.ok, false)
  assert.match(over.problems.join(), /7 taps and 3 modals exceed 6 and 3/)
  const unmeasured = judgeGroup(g, ok, reportOf(...casesOf(g)), read(null))
  assert.match(unmeasured.problems.join(), /0 e1-412-taps-and-modals attachments, expected 1/)
  const outside = judgeGroup(g, ok, reportOf(...casesOf(g, { results: measuredResult(g) })), () => ({ problem: "outside this group's private output" }))
  assert.match(outside.problems.join(), /the measurement is outside this group's private output/)
  assert.match(judgeGroup(g, { code: 1, settled: true }, reportOf(...casesOf(g, { results: measuredResult(g) })), read({ taps: 6, modals: 3, limits: { taps: 6, modals: 3 } })).problems.join(), /playwright exited 1/)
  assert.match(judgeGroup(g, { code: 0, settled: false }, reportOf(...casesOf(g, { results: measuredResult(g) })), read({ taps: 6, modals: 3, limits: { taps: 6, modals: 3 } })).problems.join(), /did not settle/)
})

test("J5 passes only when both d cases ran once and passed; its limits are asserted in the test, so no measurement is required", () => {
  const j5 = byName.j5
  const pass = judgeGroup(j5, ok, reportOf(...casesOf(j5)), () => assert.fail("J5 reads no measurement"))
  assert.equal(pass.ok, true, JSON.stringify(pass.problems))
  assert.deepEqual(pass.cases.map((c) => c.budget), [
    { status: "asserted in test (passed)", tapsLimit: 2, modalsLimit: 1 },
    { status: "asserted in test (passed)", tapsLimit: 2, modalsLimit: 1 },
  ])
  const [id360] = Object.keys(j5.cases)
  for (const [label, override, message] of [
    ["failed", { results: [{ status: "failed" }] }, /d @360: .*: failed/],
    ["skipped", { results: [{ status: "skipped" }], expectedStatus: "skipped" }, /skipped/],
    ["not run", { results: [] }, /not run/],
    ["retried", { results: [{ status: "failed" }, { status: "passed" }] }, /retried/],
  ]) {
    const r = judgeGroup(j5, ok, reportOf(...casesOf(j5, (id) => (id === id360 ? override : {}))), () => null)
    assert.equal(r.ok, false, label)
    assert.match(r.problems.join(), message, label)
  }
})

test("the gate is complete and passing only with all five groups, all six cases passed and settled", () => {
  const passing = BUDGET_GROUPS.map((g) => ({ name: g.name, ok: true, cases: Object.keys(g.cases).map((id) => ({ id, passed: true })) }))
  assert.deepEqual(summariseBudget(passing, { settled: true }), { ok: true, complete: true, cases: { expected: 6, selected: 6, passed: 6 } })
  assert.equal(summariseBudget(passing, { settled: false }).ok, false)
  assert.equal(summariseBudget(passing.slice(0, 4), { settled: true }).ok, false)
  const oneFailed = passing.map((g, i) => (i === 4 ? { ...g, ok: false, cases: [{ passed: true }, { passed: false }] } : g))
  assert.deepEqual(summariseBudget(oneFailed, { settled: true }).cases, { expected: 6, selected: 6, passed: 5 })
})

test("collection sees placeholders only; the run gets spare6's values, port 3646, the switches and its own report path", () => {
  const list = budgetListEnv({ PATH: "/bin", HOME: "/h", SUPABASE_SERVICE_ROLE_KEY: "real-key-from-shell", E2E_DB_URL: "postgresql://u:p@h/db" })
  assert.equal(list.SUPABASE_SERVICE_ROLE_KEY, "list-only-placeholder")
  assert.equal(list.E2E_DB_URL, "postgresql://postgres@127.0.0.1:64622/postgres")
  assert.equal(list.E2E_STACK_RESOLVED, "1")
  assert.ok(!Object.values(list).some((v) => /real-key|u:p@/.test(v)))
  const ctx = { stackEnv: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:64621", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk-value-123456", SUPABASE_SERVICE_ROLE_KEY: "service-value-123456", E2E_DB_URL: "postgresql://postgres:pw@127.0.0.1:64622/postgres" } }
  const run = budgetRunEnv({ PATH: "/bin", HOME: "/h", STRAY_TOKEN: "do-not-pass" }, ctx, "/r/report.json")
  assert.equal(run.SUPABASE_SERVICE_ROLE_KEY, "service-value-123456")
  assert.equal(run.E2E_PORT, "3646")
  assert.equal(run.E2E_SUPABASE_WORKDIR, "/tmp/nabalens-ws/spare6")
  assert.equal(run.E2E_SKIP_BUILD, "1")
  assert.equal(run.PLAYWRIGHT_JSON_OUTPUT_FILE, "/r/report.json")
  assert.equal(run.NABALENS_CONTRIBUTION_ENTRY, "b02")
  assert.equal(run.STRAY_TOKEN, undefined)
})

test("group arguments: the candidate config, chromium, no retries, one worker, forbid-only, the spec and the group's grep", () => {
  const g = byName.j5
  assert.deepEqual(groupArgs(g, "/out/j5"), ["test", "--config=playwright.config.ts", "--project=chromium", "--retries=0", "--workers=1", "--trace=off", "tests/e2e/upload-label-flow.spec.ts", "--grep", "\\bd @(360|412):", "--reporter=list,json", "--forbid-only", "--output=/out/j5/test-results"])
  assert.deepEqual(groupArgs(g, null, { list: true }).slice(-2), ["--list", "--reporter=json"])
})

test("run ids are one budget- segment", () => {
  assert.match(budgetRunId({}, new Date("2026-11-11T01:02:03.456Z")), /^budget-c467-20261111T010203Z$/)
  assert.equal(budgetRunId({ B02_BUDGET_RUN_ID: "budget-x1" }), "budget-x1")
  assert.throws(() => budgetRunId({ B02_BUDGET_RUN_ID: "b02-c467" }), /starting budget-/)
  assert.throws(() => budgetRunId({ B02_BUDGET_RUN_ID: "budget-../x" }), /one plain segment/)
})

test("the reset manifest is spare6's revision.json as it is, hashed; a link or a large file is refused", () => {
  const dir = temp()
  const bytes = JSON.stringify({ commit: "c467182323b9db4cbeb330db8248b3dd26042400", from: "/c", resetAt: "2026-11-11T00:11:47.629Z", migrationFiles: new Array(49).fill("x"), migrationsDigest: "22f8" })
  writeFileSync(join(dir, "revision.json"), bytes)
  assert.deepEqual(resetManifest(dir), { sha256: createHash("sha256").update(bytes).digest("hex"), commit: "c467182323b9db4cbeb330db8248b3dd26042400", from: "/c", resetAt: "2026-11-11T00:11:47.629Z", migrations: 49, migrationsDigest: "22f8" })
  const linked = temp()
  symlinkSync(join(dir, "revision.json"), join(linked, "revision.json"))
  assert.throws(() => resetManifest(linked), /not a small regular file/)
  rmSync(dir, { recursive: true, force: true })
  rmSync(linked, { recursive: true, force: true })
})

test("every guard and every child comes from run.mjs: no own signals, no stack.mjs terminateGroup, no copied lock or receipt code", () => {
  for (const banned of [/process\.kill/, /terminateGroup/, /\bspawn\(/, /mkdirSync\([^)]*lock/i, /writeFileSync/, /openSync/]) assert.doesNotMatch(SOURCE, banned, String(banned))
  for (const imported of ["createSupervisor", "createReceipt", "requireLaneClear", "requireNoQualificationBlocker", "verifyLockOwner", "verifyProductInputs", "requireFreePort", "readPrivateJson", "requirePrivateChain", "prepareRunRoot", "buildPhase", "scanPhase", "scrubArtifacts"]) {
    assert.match(SOURCE, new RegExp(`^  ${imported},$`, "m"), imported)
  }
  // The only child spawned outside the supervisor is the offline list (spawnSync, killed only as its own unreaped child).
  assert.equal((SOURCE.match(/spawnSync\(/g) ?? []).length, 1)
  assert.match(SOURCE, /sup\.run\(`playwright \$\{group\.name\}`/)
})

test("on a signal the gate interrupts every group, waits for finalisation within the deadline, and blocks the receipt if it does not finish", async () => {
  const calls = []
  const sup = { interrupt: async (why) => calls.push(`interrupt ${why}`), report: () => ({ reasons: ["seed (process group 7): alive"] }) }
  const receipt = { block: (reasons) => calls.push(["block", reasons]) }
  // Finalised in time: nothing more.
  await terminationHook(sup, receipt, Promise.resolve(), 50)()
  assert.deepEqual(calls, ["interrupt signal"])
  calls.length = 0
  // Never finalised: the receipt is blocked with the reasons and the deadline.
  await terminationHook(sup, receipt, new Promise(() => {}), 30)()
  assert.deepEqual(calls, ["interrupt signal", ["block", ["seed (process group 7): alive", "the run did not finish settling and finalising before the signal handler's deadline"]]])
  // A receipt that cannot be written still lets the hook return (the in-progress receipt already blocks).
  await terminationHook(sup, { block: () => { throw new Error("EROFS") } }, new Promise(() => {}), 10)()
  assert.equal(FINALIZE_MS, 120_000)
})
