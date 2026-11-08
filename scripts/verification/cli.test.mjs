import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
const source = fileURLToPath(new URL("../../", import.meta.url))
function fixture(t, probe = "") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "verification-cli-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "scripts/verification"), { recursive: true })
  mkdirSync(join(root, "scripts/ci"))
  for (const name of ["cli.mjs", "policy.mjs"])
    copyFileSync(
      join(source, "scripts/verification", name),
      join(root, "scripts/verification", name)
    )
  writeFileSync(
    join(root, "scripts/verification/probe.test.mjs"),
    probe || "import test from 'node:test'; test('fixture check',()=>{});\n"
  )
  writeFileSync(
    join(root, "scripts/ci/common-receipt.test.mjs"),
    "import test from 'node:test'; test('receipt fixture',()=>{});\n"
  )
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  git("init", "-q", "-b", "feat/fixture")
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
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/verification/cli.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
    })
  return { root, git, run }
}
test("real CLI refuses empty/full-suite focus and unfinished integration; records a frozen exact head", (t) => {
  const f = fixture(t)
  assert.notEqual(f.run("focused", "unit").status, 0)
  assert.equal(
    f.run("start", "Fixture batch", "22", "policy", "review").status,
    0
  )
  assert.notEqual(f.run("start", "Duplicate", "22", "other").status, 0)
  assert.notEqual(f.run("integrate").status, 0)
  assert.equal(f.run("complete", "policy").status, 0)
  assert.equal(f.run("complete", "review").status, 0)
  assert.equal(f.run("integrate").status, 0)
  const head = f.git("rev-parse", "HEAD")
  assert.equal(f.run("freeze", head, "coordinator-reviewed-evidence").status, 0)
  const status = JSON.parse(f.run("status").stdout)
  assert.equal(status.batch.candidate.head, head)
  assert.equal(status.batch.phase, "frozen")
})
test("focused tooling execution writes measured evidence without authorizing release", (t) => {
  const f = fixture(t),
    result = f.run("focused", "tooling")
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /fixture check/)
  const s = JSON.parse(f.run("status").stdout)
  assert.equal(s.batch, null)
  assert.equal(s.summary.focusedRuns, 1)
  assert.ok(s.summary.focusedMs > 0)
  assert.notEqual(f.run("release").status, 0)
})
test("a successful test command that changed tracked source is marked stale and fails", (t) => {
  const f = fixture(
    t,
    "import fs from 'node:fs'; fs.writeFileSync('package.json','{\"changed\":true}\\n');\n"
  )
  assert.notEqual(f.run("focused", "tooling").status, 0)
  const s = JSON.parse(f.run("status").stdout)
  assert.equal(s.summary.failedOrStaleFocusedRuns, 1)
})
test("batch control is unavailable on main and a dirty candidate cannot freeze", (t) => {
  const f = fixture(t)
  f.git("checkout", "-qb", "main")
  assert.notEqual(f.run("start", "Forbidden", "22", "policy").status, 0)
  f.git("checkout", "feat/fixture")
  assert.equal(f.run("start", "Batch", "22", "policy").status, 0)
  f.run("complete", "policy")
  f.run("integrate")
  writeFileSync(join(f.root, "package.json"), "{}\n")
  assert.notEqual(
    f.run("freeze", f.git("rev-parse", "HEAD"), "review").status,
    0
  )
})
