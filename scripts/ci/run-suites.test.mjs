// Runs the real scripts/ci/run-suites.mjs with a fixture pnpm: no stack, no browser.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { failureExcerpt, scrub } from "./suite-report.mjs"

const runSuites = fileURLToPath(new URL("./run-suites.mjs", import.meta.url))
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl"
const JWT_SECRET = "fixture-jwt-secret-with-enough-length"
// Dummy fixtures, not credentials: shaped like a stack S3 secret and a
// Supabase session cookie only so the redaction patterns are exercised.
const S3_SECRET = "DUMMY-NOT-A-SECRET-s3-fixture-for-redaction-0000"
const AUTH_COOKIE = `sb-127-auth-token=base64-${Buffer.from(
  '{"access_token":"DUMMY-placeholder","refresh_token":"DUMMY-placeholder"}'
).toString("base64")}`

test("scrub removes keys, tokens, passwords and exact secret values", () => {
  const text = [
    `key ${JWT}`,
    "sb_secret_abcdefgh12345 sb_publishable_xyz987654",
    "postgresql://postgres:hunter2pass@127.0.0.1:54322/postgres",
    "Authorization: Bearer abc.def.ghi",
    "/auth/confirm?token_hash=0123456789abcdef&type=email",
    `nlr_ops-desk_${"a".repeat(43)}`,
    `secret ${JWT_SECRET}`,
  ].join("\n")
  const out = scrub(text, [JWT_SECRET])
  for (const leaked of [
    JWT,
    "abcdefgh12345",
    "xyz987654",
    "hunter2pass",
    "abc.def.ghi",
    "0123456789abcdef",
    "a".repeat(43),
    JWT_SECRET,
  ])
    assert.equal(out.includes(leaked), false, leaked)
  assert.match(out, /postgresql:\/\/postgres:\[redacted\]@127\.0\.0\.1/)
})

test("scrub removes base64 Supabase auth cookies, in and out of a cookie header", () => {
  const value = AUTH_COOKIE.split("=base64-")[1]
  const out = scrub(`Cookie: ${AUTH_COOKIE}; other=1\nstored base64-${value}`)
  assert.equal(out.includes(value), false)
  assert.match(out, /sb-127-auth-token=\[redacted\]; other=1/)
  assert.match(out, /stored base64-\[redacted\]/)
})

test("the excerpt never exceeds maxLines, summary included", () => {
  const log = [
    "⎯⎯⎯ Failed Tests 2 ⎯⎯⎯",
    ...Array.from({ length: 50 }, (_, i) => `   at frame ${i}`),
    " Test Files  2 failed | 28 passed (30)",
    "      Tests  2 failed | 300 passed (302)",
    "  3 failed",
    "  12 passed (1.2m)",
  ].join("\n")
  for (const maxLines of [1, 2, 5, 6, 8, 27])
    assert.ok(
      failureExcerpt(log, { maxLines }).length <= maxLines,
      `${maxLines}`
    )
})

test("the excerpt starts at the failure section, keeps the summary and is bounded", () => {
  const log = [
    "AuthApiError: Invalid Refresh Token (expected noise from a passing test)",
    ...Array.from({ length: 40 }, (_, i) => ` ✓ passing case ${i}`),
    "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯",
    " FAIL  tests/integration/example.test.ts > lists everyone",
    "AssertionError: expected 1000 to be greater than 1000",
    ...Array.from({ length: 30 }, (_, i) => `   at frame ${i}`),
    " Test Files  1 failed | 28 passed (29)",
    "      Tests  1 failed | 300 passed (301)",
  ].join("\n")
  const lines = failureExcerpt(log, { maxLines: 12 })
  assert.ok(lines.length <= 12)
  assert.ok(lines.some((l) => l.includes("FAIL  tests/integration/example")))
  assert.ok(lines.some((l) => l.includes("expected 1000")))
  assert.ok(lines.some((l) => l.includes("Test Files  1 failed")))
  assert.equal(
    lines.some((l) => l.includes("Invalid Refresh Token")),
    false
  )
})

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nabalens-run-suites-")))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const work = join(dir, "work"),
    bin = join(dir, "bin"),
    logs = join(dir, "logs"),
    trace = join(dir, "trace")
  mkdirSync(work)
  mkdirSync(bin)
  writeFileSync(
    join(work, "status.json"),
    JSON.stringify({
      API_URL: "http://127.0.0.1:64621",
      ANON_KEY: "anon-fixture-key",
      SERVICE_ROLE_KEY: JWT,
      DB_URL: "postgresql://postgres:hunter2pass@127.0.0.1:64622/postgres",
      JWT_SECRET,
      S3_PROTOCOL_ACCESS_KEY_SECRET: S3_SECRET,
    })
  )
  // Prints realistic output; test:integration fails unless PASS_ALL is set,
  // and every suite fails with FAIL_ALL.
  writeFileSync(
    join(bin, "pnpm"),
    [
      "#!/bin/sh",
      'printf "%s\\n" "$1" >> "$TRACE"',
      'echo "running $1 with $SUPABASE_SERVICE_ROLE_KEY"',
      'echo "s3 ${S3_LEAK:-}"',
      `echo "Cookie: ${AUTH_COOKIE}"`,
      'if [ -n "$FAIL_ALL" ] || { [ "$1" = test:integration ] && [ -z "$PASS_ALL" ]; }; then',
      '  echo "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯"',
      '  echo " FAIL  tests/$1.test.ts > lists everyone past max_rows in $1" >&2',
      '  echo "AssertionError: expected 1000 to be greater than 1000 at $SUPABASE_DB_URL"',
      '  i=0; while [ $i -lt 40 ]; do echo "   at frame $i"; i=$((i+1)); done',
      '  echo " Test Files  1 failed | 28 passed (29)"',
      '  echo "      Tests  1 failed | 300 passed (301)"',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 }
  )
  const run = (extra = {}) =>
    spawnSync(process.execPath, [runSuites, work], {
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        TRACE: trace,
        CI_LOG_DIR: logs,
        CI_PLAYWRIGHT_SHARD: "",
        ...extra,
      },
      encoding: "utf8",
    })
  return { run, logs, trace }
}

test("every sub-suite runs in order and a failure is named in the last 35 lines, scrubbed", (t) => {
  const f = fixture(t)
  const r = f.run()
  assert.equal(r.status, 1)
  assert.deepEqual(readFileSync(f.trace, "utf8").trim().split("\n"), [
    "test:integration",
    "test:lifecycle",
    "test:security",
    "exec",
  ])
  const tail = (r.stdout + r.stderr).split("\n").slice(-35).join("\n")
  assert.match(tail, /test:integration\s+FAIL\s+exit 1/)
  assert.match(tail, /test:security\s+PASS\s+exit 0/)
  assert.match(
    tail,
    /test:integration\.test\.ts > lists everyone past max_rows/
  )
  assert.match(r.stdout, /^test:integration: FAIL \(exit 1\)$/m)
  assert.match(r.stdout, /^exec: PASS$/m)
  const excerpt = tail.slice(tail.indexOf("Failure excerpt"))
  assert.equal(excerpt.includes(JWT), false)
  assert.equal(excerpt.includes("hunter2pass"), false)
  const raw = readFileSync(join(f.logs, "suite-test-integration.log"), "utf8")
  const clean = readFileSync(
    join(f.logs, "suite-test-integration.scrubbed.log"),
    "utf8"
  )
  assert.ok(raw.includes("hunter2pass"))
  assert.equal(clean.includes(JWT) || clean.includes("hunter2pass"), false)
  for (const name of ["test-lifecycle", "test-security", "playwright"])
    readFileSync(join(f.logs, `suite-${name}.scrubbed.log`), "utf8")
})

test("with every suite failing, the whole summary and each failure fit in the last 35 lines", (t) => {
  const f = fixture(t)
  const r = f.run({ FAIL_ALL: "1", S3_LEAK: S3_SECRET })
  assert.equal(r.status, 1)
  const tail = r.stdout.trimEnd().split("\n").slice(-35)
  const text = tail.join("\n")
  assert.ok(
    tail.some((l) => l.startsWith("run-suites summary")),
    text
  )
  for (const label of [
    "test:integration",
    "test:lifecycle",
    "test:security",
    "exec",
  ]) {
    assert.match(text, new RegExp(`${label}\\s+FAIL\\s+exit 1`))
    assert.match(text, new RegExp(`Failure excerpt, ${label} `))
  }
  for (const name of [
    "test:integration",
    "test:lifecycle",
    "test:security",
    "exec",
  ])
    assert.match(text, new RegExp(`past max_rows in ${name}`))
  for (const name of [
    "test-integration",
    "test-lifecycle",
    "test-security",
    "playwright",
  ]) {
    const clean = readFileSync(
      join(f.logs, `suite-${name}.scrubbed.log`),
      "utf8"
    )
    assert.equal(clean.includes(S3_SECRET), false, name)
    assert.equal(clean.includes(AUTH_COOKIE.split("=base64-")[1]), false, name)
  }
})

test("all suites passing exits 0 with no failure excerpt", (t) => {
  const f = fixture(t)
  const r = f.run({ PASS_ALL: "1" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout.includes("Failure excerpt"), false)
  assert.match(r.stdout, /test:integration\s+PASS\s+exit 0/)
})
