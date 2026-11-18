import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Docs point at real things (S3-R7, release review V23 and V24).
 *
 * AGENTS.md sends people to the design-system catalogue before they build a
 * component, so a path there that no longer exists sends them to nothing.
 * The planning checklist justifies "built as departure …" rows by id, so an
 * id that is not in departures.md cannot be checked.
 */

const root = join(__dirname, "..", "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [relative(root, path)]
  })
}

const sources = ["app", "components", "lib", "supabase", "tests", "scripts"]
  .filter((dir) => existsSync(join(root, dir)))
  .flatMap((dir) => walk(join(root, dir)))
  .map((path) => path.split("\\").join("/"))

// A repo path such as `components/nabalens/album/slot-tile.tsx` or a
// shortened one such as `tasks/month-card.tsx:22`.
const PATH = /([A-Za-z0-9_.()[\]/-]+\.(?:tsx|ts|css|mjs|sql))(?::\d+)?/g

function exists(path: string) {
  const clean = path.replace(/^\(+/, "")
  return sources.some((f) => f === clean || f.endsWith(`/${clean}`))
}

// The prototype stylesheets that common-room.md §13 says live outside the
// repo; components.md cites them for provenance only.
const PROTOTYPE = new Set(["common-room.css", "pass-rail.css"])

const basename = (path: string) => path.split("/").pop() ?? path

function missingPaths(doc: string) {
  const lines = read(doc).split("\n")
  const paths = (line: string) =>
    [...line.matchAll(PATH)].map((m) => m[1].replace(/^\(+/, ""))
  // A line that says a file was deleted is a record, not a pointer, and it
  // covers that file's other mentions in the same doc (a snapshot's cells).
  const deleted = new Set(
    lines
      .filter((line) => /deleted/i.test(line))
      .flatMap((line) => paths(line).map(basename))
  )
  return lines.flatMap((line, i) =>
    paths(line)
      .filter((p) => !PROTOTYPE.has(p) && !deleted.has(basename(p)))
      .filter((p) => !exists(p))
      .map((p) => `${doc}:${i + 1} ${p}`)
  )
}

describe("design-system docs", () => {
  it.each([
    "docs/design-system/catalogue.md",
    "docs/design-system/departures.md",
    "docs/design-system/components.md",
  ])("%s cites only files that exist, or says they were deleted", (doc) => {
    expect(missingPaths(doc)).toEqual([])
  })

  it("flags a missing path that is not marked deleted", () => {
    expect(exists("components/nabalens/album/slot-tile.tsx")).toBe(true)
    expect(exists("tasks/monthly-progress-card.tsx")).toBe(false)
  })
})

describe("full-app checklist", () => {
  const departures = new Set(
    [
      ...read("docs/design-system/departures.md").matchAll(/^\| (A-[\w-]+) /gm),
    ].map((m) => m[1])
  )
  const checklist = read("docs/plans/full-app-v1/checklist.md")

  it("reads the departure ids", () => {
    expect(departures.has("A-D1")).toBe(true)
    expect(departures.has("A-3")).toBe(false)
  })

  it("cites only departure ids that departures.md defines", () => {
    const cited = [
      ...checklist.matchAll(/departure (A-[\w-]+)|\((A-[\w-]+)\)/g),
    ].map((m) => (m[1] ?? m[2]).replace(/[.,;]$/, ""))
    expect(cited.length).toBeGreaterThan(0)
    expect(cited.filter((id) => !departures.has(id))).toEqual([])
  })

  it("names the live reviewer store, not the removed venue_reviewers table", () => {
    expect(checklist).not.toMatch(/`venue_reviewers`/)
  })
})
