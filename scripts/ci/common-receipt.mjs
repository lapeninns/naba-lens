/** Reuse only the common job from this exact immutable source and CI run. */
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"

export const commonChecks = [
  "typecheck",
  "lint",
  "unit",
  "monitoring",
  "archive",
  "verification",
]
const sha = (value) => createHash("sha256").update(value).digest("hex")
export function receiptContext(cwd = process.cwd(), env = process.env) {
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
  if (!env.CI_VERIFICATION_RUN_ID) throw Error("A CI run identity is required")
  if (git("status", "--porcelain", "--untracked-files=normal"))
    throw Error("Common evidence requires a clean immutable checkout")
  const environment = Object.fromEntries(
    Object.entries(env)
      .filter(
        ([k]) =>
          [
            "CI",
            "NODE_ENV",
            "NODE_OPTIONS",
            "TZ",
            "LANG",
            "LC_ALL",
            "NEXT_TELEMETRY_DISABLED",
          ].includes(k) || /^(NEXT_PUBLIC_|SUPABASE_|E2E_)/.test(k)
      )
      .sort()
  )
  return {
    tree: git("rev-parse", "HEAD^{tree}"),
    lock: sha(readFileSync(`${cwd}/pnpm-lock.yaml`)),
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { cwd, encoding: "utf8" }).trim(),
    run: env.CI_VERIFICATION_RUN_ID,
    environment: sha(JSON.stringify(environment)),
  }
}
export function validateReceipt(receipt, expected) {
  if (
    receipt?.version !== 1 ||
    receipt.status !== "passed" ||
    JSON.stringify(receipt.checks) !== JSON.stringify(commonChecks) ||
    JSON.stringify(receipt.context) !== JSON.stringify(expected)
  )
    throw Error(
      "Common job evidence is missing, stale or incompatible with this lane"
    )
  return true
}
function safePath(path) {
  if (
    !path ||
    !isAbsolute(path) ||
    realpathSync(dirname(path)) !== dirname(path) ||
    lstatSync(dirname(path)).uid !== process.getuid?.()
  )
    throw Error("Use an owned canonical absolute receipt path")
  if (
    existsSync(path) &&
    (!lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink() ||
      lstatSync(path).uid !== process.getuid?.())
  )
    throw Error("Unsafe receipt file")
}
export function writeReceipt(path, context) {
  safePath(path)
  const temporary = path + ".writing-" + randomUUID()
  writeFileSync(
    temporary,
    JSON.stringify({
      version: 1,
      status: "passed",
      checks: commonChecks,
      context,
    }) + "\n",
    { mode: 0o600, flag: "wx" }
  )
  renameSync(temporary, path)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [op, path] = process.argv.slice(2)
    if (process.argv.length !== 4 || !["clear", "write", "verify"].includes(op))
      throw Error("Use clear|write|verify /absolute/common-receipt.json")
    safePath(path)
    if (op === "clear") {
      if (existsSync(path)) unlinkSync(path)
    } else if (op === "write") writeReceipt(path, receiptContext())
    else
      validateReceipt(JSON.parse(readFileSync(path, "utf8")), receiptContext())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
