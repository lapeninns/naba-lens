import assert from "node:assert/strict"
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  commonChecks,
  validateReceipt,
  writeReceipt,
} from "./common-receipt.mjs"
const context = {
  tree: "source-tree",
  lock: "lock-hash",
  node: "node-version",
  pnpm: "pnpm-version",
  run: "this-ci-run",
  environment: "env-hash",
}
const receipt = () => ({
  version: 1,
  status: "passed",
  checks: [...commonChecks],
  context: { ...context },
})
test("all common checks are mandatory for an exact source/run/toolchain receipt", () => {
  assert.equal(validateReceipt(receipt(), context), true)
  for (const key of Object.keys(context))
    assert.throws(
      () => validateReceipt(receipt(), { ...context, [key]: "changed" }),
      /stale/
    )
  for (const value of [
    null,
    { ...receipt(), status: "failed" },
    { ...receipt(), checks: commonChecks.slice(1) },
  ])
    assert.throws(() => validateReceipt(value, context))
})
test("receipt publication is atomic and refuses a symlink target", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "common-proof-")))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, "common-receipt.json")
  writeReceipt(file, context)
  assert.equal(validateReceipt(JSON.parse(readFileSync(file)), context), true)
  symlinkSync(file, join(dir, "link.json"))
  assert.throws(() => writeReceipt(join(dir, "link.json"), context), /Unsafe/)
})
