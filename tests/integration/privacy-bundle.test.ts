// Self-test for scripts/ci/scan-bundle.mjs: planted secrets and server-only code
// in a fake build are found (exit 1), a clean build passes (exit 0), a missing
// build is an error (exit 2). Then the real `.next` of this checkout is scanned
// when one exists. No Supabase stack is needed.
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

const SCRIPT = resolve("scripts/ci/scan-bundle.mjs")
const roots: string[] = []

function jwt(payload: object) {
  const part = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`
}

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "nabalens-scan-"))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function scan(root: string, env: Record<string, string> = {}) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--json"],
    {
      encoding: "utf8",
      // Only the values under test: never the caller's real secrets.
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
    }
  )
  const report =
    result.status === 2
      ? null
      : (JSON.parse(result.stdout) as {
          findings: { rule: string; file: string; match: string }[]
        })
  return { status: result.status, report, stderr: result.stderr }
}

const SERVER_SOURCES = {
  "lib/server/media/sign.ts":
    "export async function signPrivateThing() {}\nexport const sharedActionName = 1\n",
  "lib/supabase/admin.ts": "export function createAdminClient() {}\n",
  "app/staff/actions.ts":
    '"use server"\nexport async function sharedActionName() {}\n',
}

describe("scripts/ci/scan-bundle.mjs", () => {
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it("finds secrets, non-anon JWTs and server-only code in client output", () => {
    const value = "super-secret-cleanup-value-0123456789"
    const root = fixture({
      ...SERVER_SOURCES,
      ".next/static/chunks/a.js": [
        `const k=process.env.SUPABASE_SERVICE_ROLE_KEY;`,
        `const c="${value}";`,
        `const s="${jwt({ role: "service_role" })}";`,
        `const anon="${jwt({ role: "anon" })}";`,
        `const n="sb_secret_abcdefghijklmnop";`,
        `const r={role:"service_role"};`,
        `import "[project]/lib/server/media/sign.ts";`,
        `signPrivateThing();createAdminClient();sharedActionName();`,
      ].join("\n"),
      ".next/server/app/staff.html": "<p>postgres://u:pw@db.example:5432/x</p>",
      // Server chunks may hold secrets; they are not shipped.
      ".next/server/chunks/ssr.js": "process.env.CLEANUP_SECRET",
      "public/robots.txt": "-----BEGIN PRIVATE KEY-----",
    })
    const { status, report } = scan(root, { CLEANUP_SECRET: value })
    expect(status).toBe(1)
    const rules = new Set(report!.findings.map((f) => f.rule))
    expect([...rules].sort()).toEqual(
      [
        "jwt",
        "postgres-url-password",
        "private-key",
        "secret-name",
        "secret-value:CLEANUP_SECRET",
        "server-module-path",
        "server-only-export",
        "service-role-claim",
        "supabase-secret-key",
      ].sort()
    )
    // Only the service-role JWT, not the public anon key.
    expect(report!.findings.filter((f) => f.rule === "jwt")).toHaveLength(1)
    const exports = report!.findings
      .filter((f) => f.rule === "server-only-export")
      .map((f) => f.match)
    expect(exports.sort()).toEqual(["createAdminClient", "signPrivateThing"])
    expect(report!.findings.some((f) => f.file.includes("server/chunks"))).toBe(
      false
    )
    // Values are redacted in the report.
    expect(JSON.stringify(report)).not.toContain(value)
  })

  it("passes a clean build and fails without one", () => {
    const clean = fixture({
      ...SERVER_SOURCES,
      ".next/static/chunks/a.js": `const anon="${jwt({ role: "anon" })}";sharedActionName();`,
    })
    expect(scan(clean).status).toBe(0)
    expect(scan(fixture({ "README.md": "" })).status).toBe(2)
  })

  it.skipIf(!existsSync(".next/static"))(
    "finds nothing in this checkout's build",
    () => {
      const { status, report } = scan(resolve("."), {
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY
          ? { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
          : {}),
        ...(process.env.CLEANUP_SECRET
          ? { CLEANUP_SECRET: process.env.CLEANUP_SECRET }
          : {}),
      })
      expect(report?.findings ?? []).toEqual([])
      expect(status).toBe(0)
    }
  )
})
