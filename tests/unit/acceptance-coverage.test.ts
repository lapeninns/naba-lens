import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  checkCoverage,
  checkRepository,
  parseCatalogue,
} from "../../tests/journeys/acceptance-coverage.mjs"

const HEADER =
  "| id | kind | source | journeys | status | note |\n| --- | --- | --- | --- | --- | --- |\n"

const catalogue = (rows: string[]) => parseCatalogue(HEADER + rows.join("\n"))

const journey = (id: string, scenarios: string[], historicalId?: string) => ({
  id,
  scenarios,
  ...(historicalId
    ? { historical: { source: "docs/qa/x.md", id: historicalId } }
    : {}),
})

describe("acceptance id catalogue", () => {
  it("reads rows and ignores tables that are not id rows", () => {
    const parsed = parseCatalogue(
      "| `id` | Meaning |\n| --- | --- |\n| `id` | The id |\n" +
        HEADER +
        "| `MENUS-QA-01` | matrix | docs/a.md:1 | `menus.a`, `menus.b` | covered | note |"
    )
    expect(parsed.problems).toEqual([])
    expect(parsed.entries).toEqual([
      {
        id: "MENUS-QA-01",
        kind: "matrix",
        source: "docs/a.md:1",
        journeys: ["menus.a", "menus.b"],
        status: "covered",
        note: "note",
      },
    ])
  })

  it("passes when journeys and rows agree", () => {
    const rows = catalogue([
      "| `MENUS-QA-01` | matrix | docs/a.md:1 | `menus.a` | covered | n |",
      "| `MENUS-D2` | defect | docs/a.md:2 | `menus.d2` | covered | n |",
      "| `MEDIA-X` | media | docs/b.md:3 | - | gap | not written yet |",
    ])
    expect(
      checkCoverage(rows, [
        journey("menus.a", ["MENUS-QA-01"]),
        journey("menus.d2", ["MENUS-D2"], "MENUS-D2"),
      ])
    ).toEqual([])
  })

  it("fails when a journey declares an id missing from the catalogue", () => {
    const rows = catalogue([
      "| `MENUS-QA-01` | matrix | docs/a.md:1 | `menus.a` | covered | n |",
    ])
    const problems = checkCoverage(rows, [
      journey("menus.a", ["MENUS-QA-01", "MENUS-QA-99"]),
    ])
    expect(problems).toEqual([
      "menus.a: declares MENUS-QA-99, which is not in docs/qa/acceptance-ids.md",
    ])
  })

  it("fails when a historical id has no journey", () => {
    const rows = catalogue([
      "| `MENUS-D1` | defect | docs/a.md:1 | - | gap | later |",
      "| `MENUS-O2` | observation | docs/a.md:2 | `menus.o2` | covered | n |",
    ])
    const problems = checkCoverage(rows, [journey("menus.o2", ["MENUS-O2"])])
    expect(problems).toContain(
      "MENUS-D1: a historical defect must have a journey"
    )
    expect(problems).toContain(
      "MENUS-O2: no journey carries historical.id MENUS-O2"
    )
  })

  it("keeps the map and the declarations in step both ways", () => {
    const rows = catalogue([
      "| `MENUS-QA-01` | matrix | docs/a.md:1 | `menus.gone` | covered | n |",
      "| `MENUS-QA-02` | matrix | docs/a.md:2 | `menus.a` | covered | n |",
      "| `MENUS-QA-03` | matrix | docs/a.md:3 | - | covered | n |",
      "| `MENUS-QA-04` | matrix | docs/a.md:4 | `menus.a` | gap | n |",
      "| `MENUS-QA-05` | matrix | docs/a.md:5 | - | not covered | - |",
    ])
    const problems = checkCoverage(rows, [
      journey("menus.a", ["MENUS-QA-04", "MENUS-QA-05"]),
    ])
    expect(problems).toEqual(
      expect.arrayContaining([
        "MENUS-QA-01: journey menus.gone does not exist",
        "MENUS-QA-02: journey menus.a does not declare this id",
        "MENUS-QA-03: is covered but lists no journey",
        'MENUS-QA-04: is "gap" but lists menus.a',
        'MENUS-QA-05: "not covered" needs the reason in note',
        "menus.a: declares MENUS-QA-05, but its row does not list this journey",
      ])
    )
  })

  it("rejects a historical.id that is not a defect or observation row", () => {
    const rows = catalogue([
      "| `MENUS-QA-01` | matrix | docs/a.md:1 | `menus.a` | covered | n |",
    ])
    expect(
      checkCoverage(rows, [journey("menus.a", ["MENUS-QA-01"], "MENUS-QA-01")])
    ).toEqual([
      "menus.a: historical.id MENUS-QA-01 must be a defect or observation row in docs/qa/acceptance-ids.md",
    ])
  })

  it("rejects unknown kinds, statuses and duplicate ids", () => {
    const rows = catalogue([
      "| `MENUS-QA-01` | row | docs/a.md:1 | - | maybe | n |",
      "| `MENUS-QA-01` | matrix | docs/a.md:1 | - | gap | n |",
    ])
    const problems = checkCoverage(rows, [])
    expect(problems).toEqual(
      expect.arrayContaining([
        "MENUS-QA-01: listed twice",
        expect.stringContaining('kind "row"'),
        expect.stringContaining('status "maybe"'),
      ])
    )
  })
})

describe("this repository", () => {
  it("has journey declarations and docs/qa/acceptance-ids.md in agreement", () => {
    expect(
      checkRepository(fileURLToPath(new URL("../..", import.meta.url)))
    ).toEqual([])
  })
})
