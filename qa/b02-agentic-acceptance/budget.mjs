#!/usr/bin/env node
// B02 focused budget gate (README.md, "Budget gate"): the owner-approved phone tap and modal budgets on
// the pinned candidate (candidate.json) on spare6, as a separate gate from the 20-case agentic run.
// Derived from the coordinator's focused retest runner (sha256 82673455…, pinned to abdb77f9 and an older
// reset), re-pinned to candidate.json and to spare6's CURRENT reset (verified and hashed at run time),
// with exactly five groups and six cases:
//   e1-360, e1-412  "e1 @<w>: Add with one dish in at most 6 taps and 3 modals"           (measured)
//   e2-360, e2-412  "e2 @<w>: batch of 3 with one exception in at most 9 taps and 3 modals" (measured)
//   j5              "d @360" and "d @412": known dish in at most 2 taps and 1 modal (J5)  (asserted in test)
// The candidate's own Playwright and playwright.config.ts run tests/e2e/upload-label-flow.spec.ts; its web
// server starts the app on 3646 from the build this runner made and scanned. The lane, lock, receipt,
// ownership, signal and output guards are run.mjs's own (imported, never copied): every child runs in the
// supervisor's proven-ownership process groups, and settlement uncertainty blocks spare6 by the receipt.
//
//   node budget.mjs list      collect the five groups' exact case IDs (placeholders; contacts nothing)
//   node budget.mjs check     guards only, no lock, no writes
//   node budget.mjs run       lock, guards, build, scan, the five groups, settle, summary
//
// Env: B02_CHECKOUT (the candidate checkout) and B02_BUDGET_RUN_ID (optional). NABALENS_WS_ROOT must be unset.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  APP,
  buildEnv,
  buildPhase,
  createReceipt,
  createSupervisor,
  fail,
  harnessState,
  HARNESS,
  LANE_ROOT,
  loadPin,
  LOCK_DIR,
  outwardFailure,
  pinnedMigrations,
  prepareRunRoot,
  psqlLedger,
  QUALIFICATION_BLOCKER,
  readPrivateJson,
  RECEIPT,
  registerSecrets,
  requireCanonicalRoot,
  requireDistinctIdentities,
  requireFreePort,
  requireLaneClear,
  requireLaneRoot,
  requireNoQualificationBlocker,
  requirePlaywright,
  requirePrivateChain,
  RUN_ID,
  scanPhase,
  scrubArtifacts,
  STACK,
  validatedStackEnvironment,
  freshStackStatus,
  verifyCheckout,
  verifyLockOwner,
  verifyPhysicalWorkdir,
  verifyProductInputs,
  writeSummary,
} from "./run.mjs"

const say = (line) => console.log(`b02-budget: ${line}`)
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const SPEC = "tests/e2e/upload-label-flow.spec.ts"
const PROJECT = "chromium"
const RESULTS = join(HARNESS, ".results")

const frozen = (value) => Object.freeze(value)
/**
 * The five groups, each with its exact Playwright case IDs (file + title + project, listed from the
 * candidate) and titles. `measured` groups must attach the candidate's own `<case>-<width>-taps-and-
 * modals.json` (recordBudget); J5's `d` asserts its limits inside the test and writes no measurement.
 */
export const BUDGET_GROUPS = frozen([
  frozen({ name: "e1-360", grep: "\\be1 @360:", budget: frozen({ taps: 6, modals: 3, measured: true }), cases: frozen({ "6ba767f6c311117e4d57-513ca76ffea133db7fb8": "e1 @360: Add with one dish in at most 6 taps and 3 modals" }) }),
  frozen({ name: "e1-412", grep: "\\be1 @412:", budget: frozen({ taps: 6, modals: 3, measured: true }), cases: frozen({ "6ba767f6c311117e4d57-849ee240b53576c8d092": "e1 @412: Add with one dish in at most 6 taps and 3 modals" }) }),
  frozen({ name: "e2-360", grep: "\\be2 @360:", budget: frozen({ taps: 9, modals: 3, measured: true }), cases: frozen({ "6ba767f6c311117e4d57-f2e5dae724f391c4b5e1": "e2 @360: batch of 3 with one exception in at most 9 taps and 3 modals" }) }),
  frozen({ name: "e2-412", grep: "\\be2 @412:", budget: frozen({ taps: 9, modals: 3, measured: true }), cases: frozen({ "6ba767f6c311117e4d57-57ceccb41c1d3bd75143": "e2 @412: batch of 3 with one exception in at most 9 taps and 3 modals" }) }),
  frozen({
    name: "j5",
    grep: "\\bd @(360|412):",
    budget: frozen({ taps: 2, modals: 1, measured: false }),
    cases: frozen({
      "6ba767f6c311117e4d57-02e1abfec4ac2e26ec31": "d @360: known dish from Our menu in at most 2 taps and 1 modal (J5)",
      "6ba767f6c311117e4d57-03317c923f5c1c8517d2": "d @412: known dish from Our menu in at most 2 taps and 1 modal (J5)",
    }),
  }),
])
export const EXPECTED_CASES = 6
if (BUDGET_GROUPS.reduce((n, g) => n + Object.keys(g.cases).length, 0) !== EXPECTED_CASES) throw new Error("The budget plan is not exactly six cases.")

const GROUP_MS = 8 * 60_000
/** As run.mjs's FINALIZE_MS: how long a signal waits for settlement and the summary before blocking the receipt. */
export const FINALIZE_MS = 120_000

/**
 * The stack.onTerminate hook, as run.mjs's underLock installs it: interrupt (no group or phase starts
 * again, every running group is stopped and checked), then wait for the run to settle and finalise; if
 * that does not happen within `ms`, block the receipt with the reasons and the deadline, so the lock is
 * released only behind a blocking receipt.
 */
export function terminationHook(sup, receipt, final, ms = FINALIZE_MS) {
  return async () => {
    await sup.interrupt("signal")
    let timer
    const late = await Promise.race([final.then(() => false), new Promise((done) => (timer = setTimeout(() => done(true), ms)))])
    clearTimeout(timer)
    if (!late) return
    try {
      receipt.block([...sup.report().reasons, "the run did not finish settling and finalising before the signal handler's deadline"])
    } catch {
      // The in-progress receipt already blocks later runs.
    }
  }
}
const LOCK_SECONDS = 60

/** Collection only: fixed loopback values and placeholders, so the config resolves nothing from any stack. */
export function budgetListEnv(base = process.env) {
  return {
    ...pick(base, ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH"]),
    CI: "true",
    TZ: "Europe/London",
    E2E_PORT: String(STACK.appPort),
    E2E_STACK_RESOLVED: "1",
    E2E_ISOLATED_STACK: "1",
    E2E_SKIP_BUILD: "1",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STACK.apiPort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "list-only-placeholder",
    SUPABASE_SERVICE_ROLE_KEY: "list-only-placeholder",
    E2E_DB_URL: `postgresql://postgres@127.0.0.1:${STACK.dbPort}/postgres`,
    MAILPIT_URL: `http://127.0.0.1:${STACK.mailpitPort}`,
  }
}
const pick = (base, names) => Object.fromEntries(names.filter((n) => base[n] !== undefined).map((n) => [n, base[n]]))

/** A group's run: spare6's values (read fresh), the build switches, and the app on spare6's port from the scanned build. */
export function budgetRunEnv(base, ctx, reportFile) {
  const s = ctx.stackEnv
  return {
    ...buildEnv(base, ctx),
    CI: "true",
    TZ: "Europe/London",
    SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY,
    E2E_DB_URL: s.E2E_DB_URL,
    E2E_PORT: String(STACK.appPort),
    E2E_SUPABASE_WORKDIR: STACK.workdir,
    E2E_STACK_RESOLVED: "1",
    E2E_ISOLATED_STACK: "1",
    E2E_SKIP_BUILD: "1",
    MAILPIT_URL: `http://127.0.0.1:${STACK.mailpitPort}`,
    PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
    ...(base.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: base.PLAYWRIGHT_BROWSERS_PATH } : {}),
  }
}

export function groupArgs(group, out, { list = false } = {}) {
  const common = ["test", "--config=playwright.config.ts", `--project=${PROJECT}`, "--retries=0", "--workers=1", "--trace=off", SPEC, "--grep", group.grep]
  return list ? [...common, "--list", "--reporter=json"] : [...common, "--reporter=list,json", "--forbid-only", `--output=${join(out, "test-results")}`]
}

/** Every spec in a Playwright JSON report, in report order, with its one test and its results. */
export function reportCases(report) {
  if (!report || !Array.isArray(report.suites)) return null
  const out = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) out.push(spec)
    for (const child of suite.suites ?? []) walk(child)
  }
  report.suites.forEach(walk)
  return out
}

/** The collection (or the run) selected exactly this group's case IDs, titles, file and project, once each. */
export function validateSelection(report, group) {
  const problems = []
  const specs = reportCases(report)
  if (!specs) return { ok: false, problems: ["the report is not Playwright JSON"] }
  const want = Object.entries(group.cases)
  if (specs.length !== want.length) problems.push(`${specs.length} cases selected, expected ${want.length}`)
  const seen = new Set()
  for (const spec of specs) {
    const title = group.cases[spec.id]
    if (title === undefined) problems.push(`unexpected case ${spec.id} (${spec.title})`)
    else if (spec.title !== title) problems.push(`case ${spec.id} is titled "${spec.title}", expected "${title}"`)
    if (seen.has(spec.id)) problems.push(`case ${spec.id} appears twice`)
    seen.add(spec.id)
    if (!String(spec.file ?? "").endsWith("upload-label-flow.spec.ts")) problems.push(`case ${spec.id} is in ${spec.file}`)
    if (!Array.isArray(spec.tests) || spec.tests.length !== 1 || spec.tests[0].projectName !== PROJECT) problems.push(`case ${spec.id} is not exactly one ${PROJECT} test`)
  }
  for (const [id] of want) if (!seen.has(id)) problems.push(`missing case ${id}`)
  return { ok: problems.length === 0, problems, specs }
}

/** The candidate's own recordBudget file for one measured case: integers, the approved limits, within them. */
export function validateMeasurement(measured, group) {
  const problems = []
  if (!measured || typeof measured !== "object") return { ok: false, problems: ["the measurement is not JSON"] }
  if (!Number.isInteger(measured.taps) || measured.taps < 0) problems.push("taps is not a whole number")
  if (!Number.isInteger(measured.modals) || measured.modals < 0) problems.push("modals is not a whole number")
  if (measured.limits?.taps !== group.budget.taps || measured.limits?.modals !== group.budget.modals) problems.push(`limits ${JSON.stringify(measured.limits)} are not the approved ${group.budget.taps} taps and ${group.budget.modals} modals`)
  const within = problems.length === 0 && measured.taps <= group.budget.taps && measured.modals <= group.budget.modals
  if (problems.length === 0 && !within) problems.push(`${measured.taps} taps and ${measured.modals} modals exceed ${group.budget.taps} and ${group.budget.modals}`)
  return { ok: problems.length === 0, problems, taps: measured.taps ?? null, modals: measured.modals ?? null, route: typeof measured.route === "string" ? measured.route : null }
}

/**
 * One group's verdict from the child's exit and its report: exactly its cases, each run once and
 * passed (an explicit skip, a serial not-run or a retry fails it), and for measured groups exactly one
 * measurement attachment per case, read inside the private run output and within budget. `readMeasurement`
 * is (path) => parsed JSON or { problem }.
 */
export function judgeGroup(group, child, report, readMeasurement) {
  const problems = []
  if (child.code !== 0) problems.push(`playwright exited ${child.code}`)
  if (child.settled !== true) problems.push("its process group did not settle")
  const selection = validateSelection(report, group)
  problems.push(...selection.problems)
  const cases = []
  for (const spec of selection.specs ?? []) {
    const test = spec.tests?.[0]
    const results = Array.isArray(test?.results) ? test.results : []
    const status = results.length === 1 ? results[0].status : results.length === 0 ? "not run" : "retried"
    const entry = { id: spec.id, title: spec.title, status, passed: status === "passed" && test.expectedStatus === "passed" }
    if (!entry.passed) problems.push(`${spec.title}: ${status}`)
    if (group.budget.measured) {
      const name = `${group.name}-taps-and-modals`
      const attached = (results[0]?.attachments ?? []).filter((a) => a.name === name && typeof a.path === "string")
      if (attached.length !== 1) {
        entry.budget = { status: attached.length ? "ambiguous" : "unmeasured" }
        if (entry.passed) problems.push(`${spec.title}: ${attached.length} ${name} attachments, expected 1`)
      } else {
        const read = readMeasurement(attached[0].path)
        const v = read?.problem ? { ok: false, problems: [`the measurement is ${read.problem}`] } : validateMeasurement(read, group)
        entry.budget = { status: v.ok ? "within" : "invalid or over", taps: v.taps, modals: v.modals, route: v.route, tapsLimit: group.budget.taps, modalsLimit: group.budget.modals }
        if (!v.ok) problems.push(...v.problems.map((p) => `${spec.title}: ${p}`))
      }
    } else {
      entry.budget = { status: entry.passed ? "asserted in test (passed)" : "asserted in test (not passed)", tapsLimit: group.budget.taps, modalsLimit: group.budget.modals }
    }
    cases.push(entry)
  }
  const ok = problems.length === 0 && cases.length === Object.keys(group.cases).length && cases.every((c) => c.passed)
  return { name: group.name, ok, exit: child.code, settled: child.settled === true, cases, problems: problems.slice(0, 40) }
}

/** The whole gate: all five groups present and passing, all six cases, and every process group settled. */
export function summariseBudget(groups, settlement) {
  const cases = groups.flatMap((g) => g.cases)
  const passed = cases.filter((c) => c.passed).length
  const complete = groups.length === BUDGET_GROUPS.length && cases.length === EXPECTED_CASES
  return { ok: complete && passed === EXPECTED_CASES && groups.every((g) => g.ok) && settlement?.settled === true, complete, cases: { expected: EXPECTED_CASES, selected: cases.length, passed } }
}

export function budgetRunId(env = process.env, now = new Date()) {
  const id = env.B02_BUDGET_RUN_ID ?? `budget-c467-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`
  if (!RUN_ID.test(id) || !id.startsWith("budget-")) fail("B02_BUDGET_RUN_ID must be one plain segment starting budget- ([A-Za-z0-9_-]).")
  return id
}

/** spare6's current reset record, hashed: the gate's evidence of which reset it ran on (verifyProductInputs proves it is the pin's). */
export function resetManifest(workdir = STACK.workdir) {
  const path = join(workdir, "revision.json")
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) fail(`${path} is not a small regular file.`)
  const bytes = readFileSync(path)
  const record = JSON.parse(bytes)
  return { sha256: sha256(bytes), commit: record.commit, from: record.from, resetAt: record.resetAt, migrations: record.migrationFiles?.length ?? null, migrationsDigest: record.migrationsDigest }
}

/** The candidate's budget spec and helpers, hashed into the summary (no Playwright file is edited here). */
function specIdentity(checkout) {
  return Object.fromEntries([SPEC, "tests/e2e/helpers/upload-label-flow.ts", "playwright.config.ts"].map((f) => [f, sha256(readFileSync(join(checkout, f)))]))
}

async function guards() {
  requireCanonicalRoot()
  requireLaneClear()
  const pin = loadPin()
  const checkout = process.env.B02_CHECKOUT
  verifyCheckout(checkout, pin)
  const pinned = pinnedMigrations(checkout, pin)
  const harness = harnessState()
  if (!harness.clean) fail("The harness directory has uncommitted changes; run a committed harness.")
  requireDistinctIdentities(harness, checkout, pin)
  const stack = await import(pathToFileURL(join(checkout, "scripts", "ci", "stack.mjs")).href)
  const spec = stack.stackSpec(STACK.name)
  if (spec.workdir !== STACK.workdir) fail(`stack.mjs workdir for ${STACK.name} is ${spec.workdir}, expected ${STACK.workdir}.`)
  const ctx = { pin, pinned, checkout, stack, spec, stackWorkdir: spec.workdir, ledger: psqlLedger, harness }
  ;({ env: ctx.stackEnv, secrets: ctx.secrets } = validatedStackEnvironment(stack, spec, freshStackStatus, verifyPhysicalWorkdir(spec.workdir)))
  registerSecrets(ctx.secrets)
  verifyProductInputs(ctx)
  ctx.reset = resetManifest(verifyPhysicalWorkdir(spec.workdir))
  await requireFreePort()
  ctx.playwright = requirePlaywright(checkout)
  ctx.specFiles = specIdentity(checkout)
  say(`candidate ${pin.commit} (tree ${pin.tree}) clean; ${STACK.name} reset ${ctx.reset.resetAt} from it (revision.json sha256 ${ctx.reset.sha256}); port ${STACK.appPort} free; Playwright ${ctx.playwright.version}`)
  return ctx
}

/**
 * The guards again, inside the held lock and before the build, as run.mjs's recheck does: the lock is
 * this run's; the lane root is proven and the shared blocker absent; candidate.json, the harness and
 * the candidate's Playwright are unchanged; spare6's spec and env are read fresh (and their secrets
 * registered); the exact product inputs and the live ledger hold; the reset record is the one the guards
 * saw; and the app port is free.
 */
export async function recheckUnderLock(ctx, label, d = {}) {
  const lockDir = d.lockDir ?? LOCK_DIR
  requireCanonicalRoot()
  verifyLockOwner(label, lockDir)
  requireLaneRoot(d.laneRoot ?? LANE_ROOT)
  requireNoQualificationBlocker(d.blockerPath ?? QUALIFICATION_BLOCKER)
  if (JSON.stringify((d.loadPin ?? loadPin)()) !== JSON.stringify(ctx.pin)) fail("candidate.json changed during the run.")
  const harness = harnessState()
  if (harness.commit !== ctx.harness.commit || harness.tree !== ctx.harness.tree || harness.clean !== ctx.harness.clean) fail("The harness changed during the run.")
  const pw = requirePlaywright(ctx.checkout)
  if (pw.bin !== ctx.playwright.bin || pw.version !== ctx.playwright.version) fail("The candidate's Playwright changed during the run.")
  const spec = ctx.stack.stackSpec(STACK.name)
  if (spec.workdir !== STACK.workdir) fail(`stack.mjs workdir for ${STACK.name} changed to ${spec.workdir}.`)
  ;({ env: ctx.stackEnv, secrets: ctx.secrets } = validatedStackEnvironment(ctx.stack, spec, d.fresh ?? freshStackStatus, verifyPhysicalWorkdir(ctx.stackWorkdir, ctx.stackAnchor)))
  registerSecrets(ctx.secrets)
  verifyProductInputs(ctx)
  const reset = resetManifest(verifyPhysicalWorkdir(ctx.stackWorkdir, ctx.stackAnchor))
  if (reset.sha256 !== ctx.reset.sha256) fail("spare6's revision.json changed between the guards and the lock.")
  await (d.requireFreePort ?? requireFreePort)()
  say("guards, candidate, harness, Playwright, stack env, product inputs, live ledger and port rechecked under the lock")
}

async function runGate(ctx) {
  const id = budgetRunId()
  const label = `b02 budget gate ${id}`
  return ctx.stack.withLock(ctx.spec, label, LOCK_SECONDS, async () => {
    verifyLockOwner(label, LOCK_DIR)
    requireLaneClear({ root: LANE_ROOT, receiptPath: RECEIPT, blockerPath: QUALIFICATION_BLOCKER })
    const receipt = createReceipt(RECEIPT, { stack: STACK.name, lock: LOCK_DIR, runId: id, label, runner: { pid: process.pid }, gate: "budget", candidate: { commit: ctx.pin.commit, tree: ctx.pin.tree }, harness: { commit: ctx.harness.commit, tree: ctx.harness.tree } })
    const sup = createSupervisor({ stack: ctx.stack, receipt })
    const gate = (phase) => {
      sup.ensureActive(phase)
      verifyLockOwner(label, LOCK_DIR)
      requireLaneRoot()
      requireNoQualificationBlocker()
    }
    let finalised
    const final = new Promise((done) => (finalised = done))
    const unhook = ctx.stack.onTerminate(terminationHook(sup, receipt, final))
    const groups = []
    const evidence = {}
    let error = null
    let runRoot = null
    try {
      await recheckUnderLock(ctx, label)
      ;({ runRoot } = prepareRunRoot(id, RESULTS))
      receipt.update({ runRoot })
      gate("build")
      evidence.build = await buildPhase(ctx, sup)
      gate("scan")
      evidence.scan = await scanPhase(ctx, sup)
      for (const group of BUDGET_GROUPS) {
        gate(group.name)
        await requireFreePort()
        const out = join(runRoot, group.name)
        if (existsSync(out)) fail(`${group.name}'s output already exists.`)
        mkdirSync(out, { mode: 0o700 })
        requirePrivateChain(RESULTS, out)
        const reportFile = join(out, "report.json")
        say(`group ${group.name}: ${Object.keys(group.cases).length} case(s)`)
        const child = await sup.run(`playwright ${group.name}`, ctx.playwright.bin, groupArgs(group, out), { cwd: ctx.checkout, env: budgetRunEnv(process.env, ctx, reportFile) }, GROUP_MS, { secrets: ctx.secrets })
        if (!child.settled) {
          groups.push({ name: group.name, ok: false, exit: child.code, settled: false, cases: [], problems: ["its process group did not settle; nothing it wrote was read"] })
          break
        }
        // The candidate's web server served this group from the scanned build; nothing may be left on the port.
        await requireFreePort()
        const read = readPrivateJson(RESULTS, reportFile)
        const report = read.problem ? null : read.value
        const verdict = judgeGroup(group, child, report, (path) => {
          const abs = resolve(path)
          if (relative(out, abs).startsWith("..") || isAbsolute(relative(out, abs))) return { problem: "outside this group's private output" }
          const m = readPrivateJson(RESULTS, abs)
          return m.problem ? { problem: m.problem } : m.value
        })
        if (read.problem) verdict.problems.unshift(`report.json is ${read.problem}`)
        groups.push(verdict)
        say(`${group.name}: ${verdict.ok ? "PASS" : "FAIL"} ${verdict.cases.map((c) => `${c.title.split(":")[0]} ${c.status}${c.budget?.taps !== undefined && c.budget?.taps !== null ? ` ${c.budget.taps}/${c.budget.tapsLimit} taps ${c.budget.modals}/${c.budget.modalsLimit} modals` : ""}`).join("; ")}`)
      }
    } catch (caught) {
      error = caught
    }
    const settlement = await sup.settle()
    let scrub = { skipped: "process settlement is uncertain" }
    try {
      if (runRoot && settlement.settled) {
        requirePrivateChain(RESULTS, runRoot)
        scrub = scrubArtifacts(runRoot, ctx.secrets ?? [])
      }
    } catch (caught) {
      scrub = { unsafe: [`the scrub stopped (${caught.code ?? caught.message})`] }
    }
    const verdict = summariseBudget(groups, settlement)
    const summary = { gate: "b02 owner budgets (E1, E2 at 360/412; J5)", runId: id, ...verdict, candidate: { commit: ctx.pin.commit, tree: ctx.pin.tree }, harness: { commit: ctx.harness.commit, tree: ctx.harness.tree }, reset: ctx.reset, specFiles: ctx.specFiles, playwright: ctx.playwright.version, app: APP, evidence, groups, settlement, scrub, error: error ? String(error.message ?? error) : null }
    const written = runRoot ? writeSummary(runRoot, summary, ctx.secrets ?? []) : { ok: false, problem: "no run directory was created" }
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
    if (!settlement.settled) say(`process settlement is uncertain; ${RECEIPT} is ${receiptState} and blocks ${STACK.name} until the coordinator clears it`)
    say(`${verdict.cases.passed}/${EXPECTED_CASES} budget cases passed; settled ${settlement.settled}; summary ${runRoot ? relative(HARNESS, join(runRoot, "summary.json")) : "none"}${written.ok ? "" : ` (${written.problem})`}`)
    if (error) say(`error: ${error.message ?? error}`)
    if (sup.interrupted) return 130
    return summary.ok && written.ok ? 0 : 1
  })
}

function listGroups() {
  requireCanonicalRoot()
  const checkout = process.env.B02_CHECKOUT
  if (!checkout || !isAbsolute(checkout)) fail("set B02_CHECKOUT to the candidate checkout")
  const pw = requirePlaywright(checkout)
  let failed = false
  let collected = 0
  for (const group of BUDGET_GROUPS) {
    const r = spawnSync(pw.bin, groupArgs(group, null, { list: true }), { cwd: checkout, env: budgetListEnv(), encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" })
    let report
    try {
      report = JSON.parse(r.stdout)
    } catch {
      report = null
    }
    const v = r.status === 0 ? validateSelection(report, group) : { ok: false, problems: [`playwright --list exited ${r.status}`] }
    collected += v.ok ? Object.keys(group.cases).length : 0
    failed ||= !v.ok
    say(`list ${group.name}: ${v.ok ? "ok" : "FAIL"} ${Object.keys(group.cases).join(", ")}`)
    for (const p of v.problems) say(`  ${group.name}: ${p}`)
  }
  say(`collected ${collected} of ${EXPECTED_CASES} budget cases with Playwright ${pw.version}`)
  return failed ? 1 : 0
}

async function main() {
  requireCanonicalRoot()
  process.umask(0o077)
  const command = process.argv[2]
  if (process.argv.length !== 3) return usage()
  if (command === "list") return listGroups()
  if (command === "check") {
    await guards()
    return 0
  }
  if (command === "run") return runGate(await guards())
  return usage()
}
function usage() {
  console.log("usage: node budget.mjs <list|check|run>")
  return 2
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(outwardFailure(error))
      process.exit(1)
    }
  )
}
