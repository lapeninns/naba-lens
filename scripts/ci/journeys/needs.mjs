// Prerequisites a journey needs beyond the stack and browser, derived from what
// its spec imports. Fixture helpers (tests/e2e/helpers/world.ts, journey
// helpers) shell out to host `psql`, and a declaration cannot be trusted to
// remember that, so a journey whose spec reaches such a module needs psql
// whether or not it says so.
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const RELATIVE_IMPORT = /\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g
const SUFFIXES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.mjs"]
const IMPORTS_PSQL = /import\s*(?:type\s*)?\{[^}]*\bpsql\b[^}]*\}\s*from/
const SPAWNS_PSQL =
  /(?:execFileSync|execFile|spawnSync|spawn|execSync)\(\s*["']psql["']/
const DEFINES_PSQL = /export\s+(?:async\s+)?function\s+psql\b/

const isFile = (path) => existsSync(path) && statSync(path).isFile()

function resolveImport(from, specifier) {
  const base = resolve(dirname(from), specifier)
  return SUFFIXES.map((suffix) => base + suffix).find(isFile) ?? null
}

/** True when a module calls psql itself or imports the shared `psql` helper. */
export function usesPsql(source) {
  return (
    IMPORTS_PSQL.test(source) ||
    (SPAWNS_PSQL.test(source) && !DEFINES_PSQL.test(source))
  )
}

/** Prerequisites implied by the relative-import closure of a spec (repo files only). */
export function inferNeeds(root, spec) {
  const entry = join(root, spec)
  const seen = new Set()
  const queue = isFile(entry) ? [entry] : []
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, "utf8")
    if (usesPsql(source)) return ["psql"]
    for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
      const next = resolveImport(file, specifier)
      if (next && !relative(root, next).startsWith("..")) queue.push(next)
    }
  }
  return []
}
