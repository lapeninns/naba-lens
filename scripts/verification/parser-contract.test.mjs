// Real pinned Playwright parser/collection; no browser, server or database starts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { stripVTControlCharacters } from "node:util"
const root = fileURLToPath(new URL("../../", import.meta.url))
test("joined browser project selection collects only the requested case using real Playwright", (t) => {
  const artifacts = join(root, ".artifacts")
  mkdirSync(artifacts, { recursive: true })
  const dir = mkdtempSync(join(artifacts, "verification-parser-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const api = pathToFileURL(
    join(root, "node_modules/@playwright/test/index.mjs")
  ).href
  writeFileSync(
    join(dir, "fixture.spec.mjs"),
    `import {test} from ${JSON.stringify(api)}; test('sentinel focus',()=>{}); test('unrelated case',()=>{});\n`
  )
  writeFileSync(
    join(dir, "config.mjs"),
    `export default { testDir: ${JSON.stringify(dir)}, projects: [{name:'chromium'}] };\n`
  )
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const args = [
    join(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    join(dir, "config.mjs"),
  ]
  const good = spawnSync(
    process.execPath,
    [
      ...args,
      "--project=chromium",
      "fixture.spec.mjs",
      "--grep",
      "sentinel focus",
      "--list",
    ],
    { cwd: root, env, encoding: "utf8" }
  )
  assert.equal(good.status, 0, good.stderr + good.stdout)
  const output = stripVTControlCharacters(good.stdout)
  assert.match(output, /sentinel focus/)
  assert.doesNotMatch(output, /unrelated case/)
  assert.match(output, /Total: 1 test/)
  const bad = spawnSync(
    process.execPath,
    [
      ...args,
      "--project",
      "chromium",
      "fixture.spec.mjs",
      "--grep",
      "sentinel focus",
      "--list",
    ],
    { cwd: root, env, encoding: "utf8" }
  )
  assert.notEqual(bad.status, 0)
  assert.match(
    bad.stderr + bad.stdout,
    /Project\(s\).*fixture.spec.mjs.*not found/s
  )
})
