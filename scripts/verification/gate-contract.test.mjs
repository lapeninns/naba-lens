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
          ? "if(process.env.FAIL_BROWSER==='1')process.exit(4);"
          : "")
    )
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\nprintf "pnpm %s\\n" "$*" >> "$TRACE"\nif [ "$1" = --version ]; then echo 10.30.1; exit 0; fi\nif [ "$1" = "$FAIL_CHECK" ]; then exit 3; fi\n',
    { mode: 0o755 }
  )
  writeFileSync(
    join(bin, "supabase"),
    '#!/bin/sh\nprintf "supabase %s\\n" "$*" >> "$TRACE"\nprintf "{}\\n"\n',
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
    "test",
    "test:monitoring",
    "test:archive",
    "test:verification",
  ])
    assert.equal(lines.filter((l) => l === "pnpm " + check).length, 1, check)
  for (const check of [
    "pnpm build",
    "node scan-bundle.mjs",
    "node prepare-stack.mjs",
    "node run-suites.mjs",
    "node privacy-runtime.mjs",
  ])
    assert.equal(lines.filter((l) => l === check).length, 3, check)
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
    "pnpm test",
    "pnpm test:monitoring",
    "pnpm test:archive",
    "pnpm test:verification",
    "pnpm build",
    "node run-suites.mjs",
    "node privacy-runtime.mjs",
  ])
    assert.ok(f.lines().includes(check), check)
})
