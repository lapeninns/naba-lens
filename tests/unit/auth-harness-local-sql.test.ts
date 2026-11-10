import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A stand-in `psql` on PATH records its real argv and stdin, so this crosses
// the actual process boundary that failed with spawnSync E2BIG on Linux.
const DB = "postgresql://postgres:fixture@127.0.0.1:59992/postgres"
const FAKE_PSQL = `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const input = fs.readFileSync(0)
const dir = process.env.FAKE_PSQL_DIR
fs.writeFileSync(path.join(dir, "argv.json"), JSON.stringify(process.argv.slice(2)))
fs.writeFileSync(path.join(dir, "stdin.sql"), input)
if (input.includes("fail here")) {
  process.stderr.write("psql:<stdin>:2: ERROR:  fixture failure\\n")
  process.exit(3)
}
process.stdout.write("  first\\nlast  \\n")
`

let dir: string
beforeEach(() => {
  vi.resetModules()
  dir = mkdtempSync(join(tmpdir(), "local-sql-"))
  writeFileSync(join(dir, "psql"), FAKE_PSQL)
  chmodSync(join(dir, "psql"), 0o755)
  vi.stubEnv("PATH", `${dir}${delimiter}${process.env.PATH}`)
  vi.stubEnv("FAKE_PSQL_DIR", dir)
  vi.stubEnv("SUPABASE_DB_URL", DB)
  vi.stubEnv("SUPABASE_JWT_SECRET", "fixture-jwt-secret")
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})
const argv = () =>
  JSON.parse(readFileSync(join(dir, "argv.json"), "utf8")) as string[]

describe("localSql process boundary", () => {
  it("sends SQL larger than the 1,005-person fixture on stdin, not argv", async () => {
    const tuple = (i: number) =>
      `('00000000-0000-4000-8000-${String(i).padStart(12, "0")}'::uuid, 'it-dir-many-${i}-é@nabalens.test')`
    const sql = `insert into fixture values ${Array.from({ length: 10_000 }, (_, i) => tuple(i)).join(",\n")};\nselect 'last';`
    expect(Buffer.byteLength(sql)).toBeGreaterThan(512 * 1024)
    const { localSql } = await import("../integration/auth-support")

    expect(localSql(sql)).toBe("first\nlast")
    expect(readFileSync(join(dir, "stdin.sql"))).toEqual(Buffer.from(sql))
    const args = argv()
    expect(args.join(" ").length).toBeLessThan(200)
    expect(args.some((arg) => arg.includes("insert into"))).toBe(false)
    expect(args[0]).toBe(DB)
    expect(args).not.toContain("-c")
    expect(args.slice(-2)).toEqual(["-f", "-"])
  })

  it("asks psql for one transaction that stops on the first error", async () => {
    const { localSql } = await import("../integration/auth-support")
    localSql("delete from a;\ndelete from b;")
    const args = argv()
    expect(args).toContain("--single-transaction")
    expect(args.slice(args.indexOf("-v"), args.indexOf("-v") + 2)).toEqual([
      "-v",
      "ON_ERROR_STOP=1",
    ])
    expect(args).toContain("-At")
  })

  it("propagates a nonzero psql exit with its error output", async () => {
    const { localSql } = await import("../integration/auth-support")
    let failure: unknown
    try {
      localSql("delete from a;\nselect 'fail here';")
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ status: 3 })
    expect(String((failure as { stderr: string }).stderr)).toContain(
      "ERROR:  fixture failure"
    )
  })

  it("keeps refusing a non-local database before starting psql", async () => {
    vi.stubEnv(
      "SUPABASE_DB_URL",
      "postgresql://postgres:fixture@db.example.com:5432/postgres"
    )
    const { localSql } = await import("../integration/auth-support")
    expect(() => localSql("select 1")).toThrow("non-local database host")
    expect(() => readFileSync(join(dir, "argv.json"))).toThrow()
  })
})
