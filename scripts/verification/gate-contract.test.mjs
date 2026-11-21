// Runs the real shell orchestration with fixture executables, never Docker or browsers.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
const source = fileURLToPath(new URL("../../", import.meta.url))
test("the source-selected lci tier and hosted aggregate retain database and every browser lane", () => {
  // The steward's backwards-compatible profile selects this tier by this
  // source marker; removing it must be an explicit contract change.
  assert.match(
    readFileSync(join(source, "scripts/ci/local-ci.sh"), "utf8"),
    /CI_DATABASE_RECEIPT/
  )
  const workflow = readFileSync(
    join(source, ".github/workflows/ci.yml"),
    "utf8"
  )
  assert.match(workflow, /needs: \[common, database, fixtures\]/)
  assert.match(workflow, /test "\$DATABASE" = success/)
  for (const lane of ["chromium-1", "chromium-2", "firefox", "webkit"])
    assert.ok(workflow.includes(`lane: ${lane}`), lane)
})
function fixture(t) {
  const dir = realpathSync(
      mkdtempSync(join(tmpdir(), "nabalens-gate-contract-"))
    ),
    root = join(dir, "repo"),
    bin = join(dir, "bin"),
    trace = join(dir, "trace")
  mkdirSync(join(root, "scripts/ci"), { recursive: true })
  mkdirSync(bin)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const path of [
    "scripts/ci/local-ci.sh",
    "scripts/ci/common-receipt.mjs",
  ])
    copyFileSync(join(source, path), join(root, path))
  writeFileSync(join(root, "package.json"), "{}\n")
  writeFileSync(join(root, "pnpm-lock.yaml"), "fixture\n")
  const logger =
    "import fs from 'node:fs'; fs.appendFileSync(process.env.TRACE,'node '+process.argv[1].split('/').pop()+'\\n');"
  writeFileSync(
    join(root, "scripts/ci/prepare-stack.mjs"),
    logger + "fs.writeFileSync(process.argv[2]+'/e2e-port','3457');"
  )
  for (const file of [
    "scan-bundle.mjs",
    "run-suites.mjs",
    "privacy-runtime.mjs",
  ])
    writeFileSync(
      join(root, "scripts/ci", file),
      logger +
        (file === "run-suites.mjs"
          ? "fs.appendFileSync(process.env.TRACE,'suite-mode '+process.argv[3]+'\\n');if(process.env.FAIL_BROWSER==='1'||process.env.FAIL_DATABASE==='1')process.exit(4);"
          : "")
    )
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\nprintf "pnpm %s\\n" "$*" >> "$TRACE"\nif [ "$1" = --version ]; then echo 10.30.1; exit 0; fi\nif [ "$1" = "$FAIL_CHECK" ]; then exit 3; fi\n',
    { mode: 0o755 }
  )
  writeFileSync(
    join(bin, "supabase"),
    '#!/bin/sh\nprintf "supabase %s\\n" "$*" >> "$TRACE"\nif [ "$3" = stop ] && [ "$FAIL_STOP" = 1 ]; then exit 5; fi\nprintf "{}\\n"\n',
    { mode: 0o755 }
  )
  for (const name of ["ffmpeg", "psql"])
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  symlinkSync(process.execPath, join(bin, "node"))
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" })
  git("init", "-q")
  git("add", ".")
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture"
  )
  const receipt = join(dir, "common-receipt.json")
  const databaseReceipt = join(dir, "database-receipt.json")
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    TRACE: trace,
    CI_VERIFICATION_RUN_ID: "fixture-run",
    CI_COMMON_RECEIPT: receipt,
    CI_LOG_DIR: join(dir, "logs"),
  }
  const run = (phase, extra = {}) =>
    spawnSync("bash", ["scripts/ci/local-ci.sh"], {
      cwd: root,
      env: { ...env, CI_PHASE: phase, ...extra },
      encoding: "utf8",
    })
  return {
    dir,
    root,
    trace,
    receipt,
    databaseReceipt,
    run,
    lines: () =>
      existsSync(trace) ? readFileSync(trace, "utf8").split("\n") : [],
  }
}
test("common checks run once, all browser lanes retain build, database/browser and privacy steps", (t) => {
  const f = fixture(t)
  let r = f.run("common")
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const browser of ["chromium", "firefox", "webkit"]) {
    r = f.run("browser", { CI_BROWSER: browser })
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  const lines = f.lines()
  for (const check of [
    "typecheck",
    "lint",
    "test --reporter=verbose",
    "test:monitoring",
    "test:archive",
    "test:verification",
  ])
    assert.equal(lines.filter((l) => l === "pnpm " + check).length, 1, check)
  for (const check of [
    "node prepare-stack.mjs",
    "node run-suites.mjs",
    "node privacy-runtime.mjs",
  ])
    assert.equal(lines.filter((l) => l === check).length, 3, check)
  assert.equal(
    lines.includes("pnpm build"),
    false,
    "no build before the stack exists"
  )
  assert.equal(lines.filter((l) => l === "suite-mode full").length, 3)
  assert.equal(
    lines.filter((l) => l.startsWith("supabase ") && l.includes(" stop "))
      .length,
    3
  )
})
test("a failed common check removes old evidence and prevents any browser work", (t) => {
  const f = fixture(t)
  assert.equal(f.run("common").status, 0)
  assert.equal(existsSync(f.receipt), true)
  assert.notEqual(f.run("common", { FAIL_CHECK: "lint" }).status, 0)
  assert.equal(existsSync(f.receipt), false)
  assert.notEqual(f.run("browser").status, 0)
  assert.equal(
    f.lines().some((l) => l === "node prepare-stack.mjs"),
    false
  )
})
test("changed source and a different CI run reject evidence before stack startup", (t) => {
  const f = fixture(t)
  assert.equal(f.run("common").status, 0)
  assert.notEqual(
    f.run("browser", { CI_VERIFICATION_RUN_ID: "other-run" }).status,
    0
  )
  writeFileSync(join(f.root, "package.json"), '{"changed":true}\n')
  assert.notEqual(f.run("browser").status, 0)
  assert.equal(
    f.lines().some((l) => l === "node prepare-stack.mjs"),
    false
  )
})
test("a failed browser suite still runs privacy checks and cleanup and cannot pass", (t) => {
  const f = fixture(t)
  assert.equal(f.run("common").status, 0)
  const r = f.run("browser", { FAIL_BROWSER: "1" })
  assert.notEqual(r.status, 0)
  assert.ok(f.lines().includes("node privacy-runtime.mjs"))
  assert.ok(
    f.lines().some((l) => l.startsWith("supabase ") && l.includes(" stop "))
  )
})
test("standalone full mode keeps every common check and browser boundary without a receipt", (t) => {
  const f = fixture(t),
    r = f.run("full", { CI_COMMON_RECEIPT: "" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const check of [
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test --reporter=verbose",
    "pnpm test:monitoring",
    "pnpm test:archive",
    "pnpm test:verification",
    "node run-suites.mjs",
    "node privacy-runtime.mjs",
  ])
    assert.ok(f.lines().includes(check), check)
})

test("hosted common retains scrubbed per-test diagnostics, not raw unit logs", (t) => {
  const workflow = readFileSync(
    join(source, ".github/workflows/ci.yml"),
    "utf8"
  )
  const common = workflow.split("\n  database:")[0]
  assert.match(common, /os\.availableParallelism\(\)/)
  assert.match(common, /common-logs\/unit\.scrubbed\.log/)
  assert.doesNotMatch(common, /common-logs\/unit\.log/)
  const script = common.match(
    /node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/
  )
  assert.ok(script, "common diagnostic script")
  const dir = mkdtempSync(join(tmpdir(), "nabalens-common-diagnostics-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl"
  writeFileSync(join(dir, "unit.log"), `case cost 123ms ${token}\n`)
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    cwd: source,
    env: { ...process.env, CI_LOG_DIR: dir },
    input: script[1],
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  const scrubbed = readFileSync(join(dir, "unit.scrubbed.log"), "utf8")
  assert.match(scrubbed, /case cost 123ms/)
  assert.equal(scrubbed.includes(token), false)
  assert.match(scrubbed, /\[redacted-jwt\]/)
})

test("database proof requires every suite and cleanup, and each browser validates it before setup", (t) => {
  const f = fixture(t)
  const options = { CI_DATABASE_RECEIPT: f.databaseReceipt }
  assert.equal(f.run("common").status, 0)
  assert.notEqual(f.run("browser", options).status, 0)
  assert.equal(f.lines().includes("node prepare-stack.mjs"), false)
  const database = f.run("database", options)
  assert.equal(database.status, 0, database.stdout + database.stderr)
  assert.equal(existsSync(f.databaseReceipt), true)
  assert.ok(f.lines().includes("suite-mode database"))
  for (const browser of ["chromium", "firefox", "webkit"]) {
    const r = f.run("browser", { ...options, CI_BROWSER: browser })
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  assert.equal(f.lines().filter((l) => l === "suite-mode database").length, 1)
  assert.equal(f.lines().filter((l) => l === "suite-mode browser").length, 3)
  assert.notEqual(
    f.run("browser", { ...options, CI_VERIFICATION_RUN_ID: "stale-run" })
      .status,
    0
  )
  writeFileSync(join(f.root, "package.json"), '{"changed":true}\n')
  assert.notEqual(f.run("browser", options).status, 0)
  assert.equal(
    f.lines().filter((l) => l === "node prepare-stack.mjs").length,
    4
  )
})

for (const failure of ["FAIL_DATABASE", "FAIL_STOP"]) {
  test(`controlled ${failure} failure removes prior proof and blocks browser reuse`, (t) => {
    const f = fixture(t)
    const options = { CI_DATABASE_RECEIPT: f.databaseReceipt }
    assert.equal(f.run("common").status, 0)
    assert.equal(f.run("database", options).status, 0)
    const r = f.run("database", { ...options, [failure]: "1" })
    assert.notEqual(r.status, 0, r.stdout + r.stderr)
    assert.equal(existsSync(f.databaseReceipt), false)
    assert.notEqual(f.run("browser", options).status, 0)
    assert.ok(
      f.lines().some((l) => l.startsWith("supabase ") && l.includes(" stop "))
    )
  })
}

test("a supplied E2E_PORT is restored before publishing source-context evidence", (t) => {
  const f = fixture(t)
  const options = { E2E_PORT: "12345", CI_DATABASE_RECEIPT: f.databaseReceipt }
  assert.equal(f.run("common", options).status, 0)
  const r = f.run("database", options)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const browser = f.run("browser", options)
  assert.equal(browser.status, 0, browser.stdout + browser.stderr)
})
