import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const root = join(__dirname, "..", "..")
const SPEC = "docs/design-system/DESIGN.md"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
  })
}

// Code comments justify sizes, shapes and colours by section number, as
// "DESIGN.md §4". The section numbers are therefore load-bearing: the spec
// lives in the repo and each cited section must exist in it.
const CITATION = /DESIGN\.md(?:\s+v[\d.]+)?[\s,(]*§\s*(\d+)/g

describe("design spec citations", () => {
  const spec = readFileSync(join(root, SPEC), "utf8")
  const sections = new Set(
    [...spec.matchAll(/^## (\d+)\. /gm)].map((match) => match[1])
  )

  it("numbers the spec's sections", () => {
    expect(sections.size).toBeGreaterThan(0)
  })

  it("only cites sections that exist in the spec", () => {
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
            if (!sections.has(match[1]))
              missing.push(
                `${relative(root, file)}:${i + 1} cites §${match[1]}`
              )
          }
        })
    }
    expect(missing).toEqual([])
    // The scan is doing something: the code cites the spec today.
    expect(cited).toBeGreaterThan(0)
  })
})
