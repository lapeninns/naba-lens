import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

const approvalPath = "scripts/readiness/secret-scan-exceptions.json"
const initializing = process.argv[2] === "--initialize-known-fixtures"
if (initializing && existsSync(approvalPath))
  throw Error("Do not regenerate existing secret scan exceptions")
// Non-credential findings reviewed by path and syntax, not by printing values.
const reviewed = new Map([
  [
    "lib/server/amenities/validate.ts:73",
    "API parameter name in a catalogue validation comment",
  ],
  [
    "scripts/ci/run-suites.test.mjs:21",
    "Synthetic JWT-shaped secret scrubbing test input",
  ],
  [
    "tests/e2e/menus-admin.spec.ts:427",
    "Menu item key assigned by a Playwright fixture",
  ],
  ["tests/fixtures/menus/the-railway.drinks.json:388", "Fixture menu item key"],
  ["tests/unit/exports-service.test.ts:59", "Idempotency request key fixture"],
  ["tests/unit/exports-service.test.ts:89", "Idempotency request key fixture"],
  ["tests/unit/exports-service.test.ts:130", "Idempotency request key fixture"],
  ["tests/unit/media-use-services.test.ts:18", "Mock request key"],
  [
    "tests/unit/media-actor-unavailable.test.ts:64",
    "Synthetic provider error text",
  ],
])
const approvals = initializing
  ? {}
  : JSON.parse(readFileSync(approvalPath, "utf8"))
const detected = {}
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" }
)
const dir = mkdtempSync(join(tmpdir(), "nabalens-secret-scan-"))
try {
  const snapshot = join(dir, "snapshot")
  for (const file of new Set(files.split("\0").filter(Boolean))) {
    if (
      file
        .split("/")
        .some(
          (part) =>
            (part.startsWith(".env") && part !== ".env.example") ||
            part === ".dev.vars"
        )
    )
      continue
    const info = lstatSync(file, { throwIfNoEntry: false })
    if (!info?.isFile()) continue
    const dest = join(snapshot, file)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(file, dest)
  }
  const report = join(dir, "redacted.json")
  const scan = spawnSync(
    "gitleaks",
    [
      "dir",
      "--redact=100",
      "--no-banner",
      "--no-color",
      "--exit-code",
      "1",
      "--report-format",
      "json",
      "--report-path",
      report,
      snapshot,
    ],
    { stdio: "inherit", cwd: dir }
  )
  if (scan.error)
    throw Error(
      "Install gitleaks with your approved package manager before running this gate",
      { cause: scan.error }
    )
  if (scan.status === 1 && existsSync(report)) {
    let blocked = false
    for (const finding of JSON.parse(readFileSync(report, "utf8"))) {
      const path = relative(snapshot, finding.File)
      const location = `${path}:${finding.StartLine}`
      const key = `${path}:${finding.RuleID}`
      const lines = readFileSync(join(snapshot, path), "utf8").split("\n")
      const range = lines
        .slice(finding.StartLine - 1, finding.EndLine)
        .join("\n")
      const digest = createHash("sha256").update(range).digest("hex")
      const why = reviewed.get(location)
      if (initializing && why) (detected[key] ??= []).push({ digest, why })
      else if (!approvals[key]?.some((entry) => entry.digest === digest)) {
        console.error(`${location}: ${finding.RuleID}`)
        blocked = true
      }
    }
    if (!blocked) {
      if (initializing)
        writeFileSync(approvalPath, JSON.stringify(detected, null, 2) + "\n", {
          flag: "wx",
        })
      console.log("Secret scan: no unapproved findings")
      process.exitCode = 0
    } else process.exitCode = 1
  } else {
    process.exitCode = scan.status ?? 1
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
