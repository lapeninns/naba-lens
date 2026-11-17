import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const root = join(__dirname, "..", "..")

// Two specs can be cited. DESIGN.md is Album, the design system adopted on
// 17 Nov 2026 (decision D8). common-room.md is the frozen Common Room spec:
// it describes the code that still ships until Album batch A5 retires it,
// so comments on that code keep citing it.
const SPECS = {
  "DESIGN.md": "docs/design-system/DESIGN.md",
  "common-room.md": "docs/design-system/common-room.md",
} as const
type Spec = keyof typeof SPECS

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
  })
}

// Code comments justify sizes, shapes and colours by section number, as
// "DESIGN.md §4". The section numbers are therefore load-bearing: each
// cited section must exist in the spec it names. A lettered subsection
// ("§5a") is cited and checked as itself.
const CITATION =
  /\b(DESIGN\.md|common-room\.md)(?:\s+v[\d.]+)?[\s,(]*§\s*(\d+[a-z]?)/g
const HEADING = /^#{2,3} (\d+[a-z]?)\. /gm

const sections = Object.fromEntries(
  (Object.keys(SPECS) as Spec[]).map((name) => {
    const text = readFileSync(join(root, SPECS[name]), "utf8")
    return [name, new Set([...text.matchAll(HEADING)].map((m) => m[1]))]
  })
) as Record<Spec, Set<string>>

const cite = (text: string) =>
  [...text.matchAll(CITATION)].map((m) => `${m[1]} ${m[2]}`)

describe("design spec citations", () => {
  it("numbers the sections of both specs", () => {
    expect(sections["DESIGN.md"].size).toBeGreaterThan(0)
    expect(sections["common-room.md"].size).toBeGreaterThan(0)
  })

  it("reads the spec name and a lettered subsection as themselves", () => {
    expect(sections["DESIGN.md"].has("5a")).toBe(true)
    expect(sections["common-room.md"].has("5a")).toBe(true)
    expect(cite("DESIGN.md §5a")).toEqual(["DESIGN.md 5a"])
    expect(cite("common-room.md v0.4 §5")).toEqual(["common-room.md 5"])
    expect(cite("(common-room.md §11, rule 7)")).toEqual(["common-room.md 11"])
    // A missing subsection is reported, not read as its parent.
    expect(sections["DESIGN.md"].has("5z")).toBe(false)
  })

  it("only cites sections that exist in the spec named", () => {
    const missing: string[] = []
    let cited = 0
    for (const file of ["app", "components", "lib"].flatMap((dir) =>
      sourceFiles(join(root, dir))
    )) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const match of line.matchAll(CITATION)) {
            cited += 1
            if (!sections[match[1] as Spec].has(match[2]))
              missing.push(
                `${relative(root, file)}:${i + 1} cites ${match[1]} §${match[2]}`
              )
          }
        })
    }
    expect(missing).toEqual([])
    // The scan is doing something: the code cites a spec today.
    expect(cited).toBeGreaterThan(0)
  })
})
