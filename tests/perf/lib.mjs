// Shared helpers for the WS3 perf harness. Local throwaway workstream stacks
// only: every entry point calls requireWorkstreamStack(), which refuses any
// other target. The stack is chosen with PERF_STACK (default spare6); its ports
// come from scripts/ci/stack.mjs, the one port table.
import { execFileSync, spawnSync } from "node:child_process"

import { stackSpec } from "../../scripts/ci/stack.mjs"

/** Resolved ports of the selected workstream stack. Throws for any other name. */
export function perfStack(name = process.env.PERF_STACK || "spare6") {
  let spec
  try {
    spec = stackSpec(name)
  } catch {
    throw new Error(
      `Refusing to run: PERF_STACK "${name}" is not a workstream stack (ws1, ws2, gate, spare4..spare9).`
    )
  }
  return {
    name: spec.name,
    apiPort: spec.apiPort,
    dbPort: spec.dbPort,
    appPort: spec.appPort,
    appBase: `http://127.0.0.1:${spec.appPort}`,
  }
}

/**
 * Reads the stack env from process.env (source /tmp/nabalens-ws/<stack>/env.sh
 * or `node scripts/ci/stack.mjs env <stack>`) and checks it points at the
 * PERF_STACK ports on this machine.
 */
export function requireWorkstreamStack() {
  const stack = perfStack()
  const env = process.env
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
  ]) {
    if (!env[k]) {
      throw new Error(`${k} is not set. source /tmp/nabalens-ws/${stack.name}/env.sh`)
    }
  }
  const api = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
  const db = new URL(env.SUPABASE_DB_URL)
  const local = (h) => h === "127.0.0.1" || h === "localhost"
  if (
    !local(api.hostname) ||
    !local(db.hostname) ||
    Number(api.port) !== stack.apiPort ||
    Number(db.port) !== stack.dbPort
  ) {
    throw new Error(
      `Refusing to run: the environment is not the local ${stack.name} stack (api ${stack.apiPort}, db ${stack.dbPort}).`
    )
  }
  return {
    stack,
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
