import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const assistDir = join(root, "lib/server/assist")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const sources = (dir: string) =>
  walk(dir).filter((f) => /\.(tsx?|mjs|cjs|js)$/.test(f))

function importsOf(source: string): string[] {
  return [
    ...source.matchAll(
      /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
    ),
  ].map((m) => m[1] ?? m[2] ?? m[3])
}

// The offline slice may use only these modules (B09 design §4.6 and §4.7).
const ALLOWED_IMPORT = [
  /^\.{1,2}\//,
  /^@\/lib\/server\/assist\//,
  /^@\/lib\/menus\/types$/,
  /^@\/lib\/amenities\/contract$/,
  /^node:crypto$/,
]

const FORBIDDEN_TEXT = [
  "SUPABASE_",
  "service_role",
  "NEXT_PUBLIC_",
  "process.env",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
]

describe("assist isolation (B09 design §4.7, static)", () => {
  const files = sources(assistDir)

  it("finds the assist sources", () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  it("imports nothing outside the allowlist", () => {
    const bad = files.flatMap((f) =>
      importsOf(readFileSync(f, "utf8"))
        .filter((spec) => !ALLOWED_IMPORT.some((re) => re.test(spec)))
        .map((spec) => `${relative(root, f)} -> ${spec}`)
    )
    expect(bad).toEqual([])
  })

  it("reads no environment and names no secret or network API", () => {
    const bad = files.flatMap((f) => {
      const text = readFileSync(f, "utf8")
      return FORBIDDEN_TEXT.filter((t) => text.includes(t)).map(
        (t) => `${relative(root, f)}: ${t}`
      )
    })
    expect(bad).toEqual([])
  })

  it("is imported by no application module", () => {
    const appFiles = ["app", "components", "lib"].flatMap((d) =>
      sources(join(root, d))
    )
    const bad = appFiles
      .filter((f) => !f.startsWith(assistDir))
      .filter((f) =>
        importsOf(readFileSync(f, "utf8")).some((spec) =>
          spec.includes("lib/server/assist")
        )
      )
      .map((f) => relative(root, f))
    expect(bad).toEqual([])
  })
})
