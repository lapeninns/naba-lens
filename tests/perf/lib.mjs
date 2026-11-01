// Shared helpers for the WS3 baseline harness. Local throwaway stack only:
// every entry point calls requireSpare6(), which refuses any other target.
import { execFileSync, spawnSync } from "node:child_process"

export const STACK = {
  apiPort: 64621,
  dbPort: 64622,
  appPort: 3646,
}

/** Reads the stack env from process.env (source /tmp/nabalens-ws/spare6/env.sh). */
export function requireSpare6() {
  const env = process.env
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
  ]) {
    if (!env[k]) {
      throw new Error(`${k} is not set. source /tmp/nabalens-ws/spare6/env.sh`)
    }
  }
  const api = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
  const db = new URL(env.SUPABASE_DB_URL)
  const local = (h) => h === "127.0.0.1" || h === "localhost"
  if (
    !local(api.hostname) ||
    !local(db.hostname) ||
    Number(api.port) !== STACK.apiPort ||
    Number(db.port) !== STACK.dbPort
  ) {
    throw new Error(
      `Refusing to run: target is not the local spare6 stack (api ${STACK.apiPort}, db ${STACK.dbPort}).`
    )
  }
  return {
    apiUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    dbUrl: env.SUPABASE_DB_URL,
  }
}

/** Runs psql against the stack DB as postgres. Returns stdout. */
export function psql(dbUrl, args, { input, quiet = true } = {}) {
  const res = spawnSync(
    "psql",
    [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", ...(quiet ? ["-q"] : []), ...args],
    { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 }
  )
  if (res.status !== 0) {
    throw new Error(`psql failed: ${(res.stderr || "").trim().slice(0, 2000)}`)
  }
  return res.stdout
}

/** One scalar or row set as an array of arrays (tuples only, unaligned). */
export function query(dbUrl, sql) {
  const out = psql(dbUrl, ["-At", "-F", "\t", "-c", sql])
  return out
    .split("\n")
    .filter((l) => l.length)
    .map((l) => l.split("\t"))
}

export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}

export function summarise(values) {
  const r = (v) => (v == null ? null : Math.round(v * 10) / 10)
  return {
    n: values.length,
    min: r(Math.min(...values)),
    p50: r(percentile(values, 50)),
    p95: r(percentile(values, 95)),
    max: r(Math.max(...values)),
  }
}

export function gitHead() {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const dirty =
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== ""
  return { sha, dirty }
}
