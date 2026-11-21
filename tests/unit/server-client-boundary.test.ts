import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/*
 * S3-E2E-2 D1 / S3-E2E-1 E1: staff Home crashed because a server page called
 * `askedForItems` from a "use client" module. A server component may render a
 * client component (PascalCase), but any other value it imports from a client
 * module is a client reference, and calling it throws at request time. This
 * guard reads every server page and layout under app/ and refuses a call
 * into, or a read from, a non-component value of a "use client" module.
 */

const ROOT = join(__dirname, "..", "..")

// Found by this guard in other repair areas (S3-R3 report): the copy object
// is read on the server, so the heading renders empty. Owners: S3-R6
// (admin coverage) and S3-R2 (knowledge upgrades). Remove each line when its
// owner moves the copy to a server-safe module.
const KNOWN = new Set([
  "app/admin/coverage/(this-month)/page.tsx: ITEM_SELF_REVIEWS_COPY from @/components/nabalens/menu-photos/item-photo-self-reviews",
  "app/admin/knowledge/upgrades/page.tsx: UPGRADE_COPY from @/components/nabalens/knowledge/upgrade-control",
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/^(page|layout|template|default|not-found)\.tsx?$/.test(name))
      out.push(path)
  }
  return out
}

const isClient = (source: string) =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source)

function resolveModule(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith(".")) base = join(from, "..", spec)
  else return null
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      if (statSync(base + ext).isFile()) return base + ext
    } catch {
      // try the next extension
    }
  }
  return null
}

function valueImports(source: string): { names: string[]; spec: string }[] {
  const out: { names: string[]; spec: string }[] = []
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
  for (const m of source.matchAll(re)) {
    if (m[1]) continue
    const names = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("type "))
      .map((s) => s.split(/\s+as\s+/)[0].trim())
    out.push({ names, spec: m[3] })
  }
  return out
}

describe("server pages never call into a client module", () => {
  it("imports only components and types from 'use client' modules", () => {
    const offences: string[] = []
    for (const file of walk(join(ROOT, "app"))) {
      const source = readFileSync(file, "utf8")
      if (isClient(source)) continue
      for (const { names, spec } of valueImports(source)) {
        const target = resolveModule(spec, file)
        if (!target || !isClient(readFileSync(target, "utf8"))) continue
        for (const name of names) {
          if (/^[A-Z][a-z]/.test(name)) continue
          // Passing a client value straight through as a prop is fine (it
          // resolves in the browser); calling it or reading into it is not.
          const used = new RegExp(`\\b${name}\\s*(?:\\(|\\.|\\[)`)
          if (used.test(source))
            offences.push(`${relative(ROOT, file)}: ${name} from ${spec}`)
        }
      }
    }
    expect(offences.filter((o) => !KNOWN.has(o))).toEqual([])
    // The staff Home page is the D1 case itself.
    expect(offences.some((o) => o.startsWith("app/staff/"))).toBe(false)
  })
})
