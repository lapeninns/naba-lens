// S5-IMPORT (FA-54): the legacy importer's pure parts. Manifest parsing
// (CSV, columns, paths kept inside the folder, capture dates never
// invented), label matching (exactly one current subject, else a note), the
// stable asset id and the result CSV.
import { describe, expect, it } from "vitest"

import {
  amenityWords,
  matchLegacyLabel,
  normaliseLabel,
  type LabelCandidate,
} from "../../scripts/import/labels"
import {
  parseCaptureDate,
  parseCsv,
  parseManifest,
  safeRelativePath,
} from "../../scripts/import/manifest"

// The import modules also pull lib/server code that is server-only; these
// tests import only the pure helpers and the two exports below.
const { importAssetId, resultCsv } =
  await import("../../scripts/import/legacy-import")

const NOW = new Date("2026-11-18T12:00:00Z")

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, commas, CRLF and a BOM", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\nlast,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["last", ""],
    ])
  })

  it("keeps a newline inside quotes and refuses an unclosed quote", () => {
    expect(parseCsv('a\n"one\ntwo"')).toEqual([["a"], ["one\ntwo"]])
    expect(() => parseCsv('a\n"open')).toThrow(/unclosed quote/)
  })
})

describe("safeRelativePath", () => {
  it("keeps paths inside the folder", () => {
    expect(safeRelativePath("2019/bar/one.jpg")).toBe("2019/bar/one.jpg")
    expect(safeRelativePath(".\\2019\\two.JPG")).toBe("2019/two.JPG")
  })

  it.each([
    "",
    "/etc/passwd",
    "../x.jpg",
    "a/../../x.jpg",
    "C:\\x.jpg",
    "a\u0000b",
  ])("refuses %j", (path) => expect(safeRelativePath(path)).toBeNull())
})

describe("parseCaptureDate", () => {
  it("reads a date as midday in London (BST and GMT)", () => {
    const summer = parseCaptureDate("2019-06-01", NOW)
    const winter = parseCaptureDate("2019-12-01", NOW)
    expect(summer.ok && summer.value.toISOString()).toBe(
      "2019-06-01T11:00:00.000Z"
    )
    expect(winter.ok && winter.value.toISOString()).toBe(
      "2019-12-01T12:00:00.000Z"
    )
  })

  it("reads a London wall-clock time, or an explicit offset", () => {
    const local = parseCaptureDate("2019-06-01T18:30", NOW)
    const utc = parseCaptureDate("2019-06-01T18:30:05Z", NOW)
    const offset = parseCaptureDate("2019-06-01 18:30+02:00", NOW)
    expect(local.ok && local.value.toISOString()).toBe(
      "2019-06-01T17:30:00.000Z"
    )
    expect(utc.ok && utc.value.toISOString()).toBe("2019-06-01T18:30:05.000Z")
    expect(offset.ok && offset.value.toISOString()).toBe(
      "2019-06-01T16:30:00.000Z"
    )
  })

  it.each([
    ["2019-02-30", "not a real date"],
    ["2019-06-01T24:00", "not a real date and time"],
    ["01/06/2019", "use YYYY-MM-DD"],
    ["1989-12-31", "before 1990"],
    ["2026-11-21", "in the future"],
  ])("refuses %j", (value, message) => {
    const result = parseCaptureDate(value, NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(message)
  })
})

describe("parseManifest", () => {
  it("reads every column, with aliases and any column order", () => {
    const { rows, problems } = parseManifest(
      [
        "Legacy_Folder,FILE_PATH,venue_slug,Contributor,captured_at,label",
        "Approved,2019/fish.jpg,the-bell,Sam@Example.com,2019-06-01,Fish & chips",
        ",2019/garden.jpg,the-bell,,,",
      ].join("\n"),
      NOW
    )
    expect(problems).toEqual([])
    expect(rows).toEqual([
      {
        line: 2,
        file: "2019/fish.jpg",
        venue: "the-bell",
        contributorEmail: "sam@example.com",
        capturedAt: new Date("2019-06-01T11:00:00Z"),
        legacyLabel: "Fish & chips",
        legacyFolder: "Approved",
      },
      {
        line: 3,
        file: "2019/garden.jpg",
        venue: "the-bell",
        contributorEmail: null,
        capturedAt: null,
        legacyLabel: null,
        legacyFolder: null,
      },
    ])
  })

  it("reports bad rows by line and keeps the good ones", () => {
    const { rows, problems } = parseManifest(
      [
        "file,venue,contributor_email,capture_date",
        "../secret.jpg,the-bell,,",
        "a.jpg,,,",
        "b.jpg,the-bell,not-an-email,",
        "c.jpg,the-bell,,yesterday",
        "d.jpg,the-bell,,",
        "",
        "d.jpg,the-bell,,",
        "d.jpg,the-crown,,",
      ].join("\n"),
      NOW
    )
    expect(rows.map((r) => [r.line, r.file, r.venue])).toEqual([
      [6, "d.jpg", "the-bell"],
      [9, "d.jpg", "the-crown"],
    ])
    expect(problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 8])
    expect(problems[0]!.message).toContain("inside the import folder")
    expect(problems[4]!.message).toBe("same file and venue as line 6")
  })

  it("needs a file and a venue column", () => {
    expect(() => parseManifest("file,label\na.jpg,x")).toThrow(
      /"file" and a "venue" column/
    )
    expect(() => parseManifest("")).toThrow(/empty/)
  })
})

describe("matchLegacyLabel", () => {
  const candidates: LabelCandidate[] = [
    { kind: "dish", id: "fish", names: ["Fish and chips", "Cod & chips"] },
    { kind: "dish", id: "pie", names: ["Steak pie"] },
    { kind: "place", id: "garden", names: ["Beer garden"] },
    { kind: "place", id: "bar", names: ["Bar"] },
    { kind: "dish", id: "bar-snack", names: ["Bar"] },
    { kind: "amenity", id: "pool", names: [amenityWords("pool_table")] },
  ]

  it("normalises case, punctuation, & and accents", () => {
    expect(normaliseLabel("  Fish & Chips! ")).toBe("fish and chips")
    expect(normaliseLabel("Crème brûlée")).toBe("creme brulee")
    expect(normaliseLabel("Chef's_special")).toBe("chefs special")
  })

  it("matches exactly one dish (name or alias), place or amenity", () => {
    expect(matchLegacyLabel("FISH & CHIPS", candidates)).toEqual({
      state: "matched",
      kind: "dish",
      id: "fish",
    })
    expect(matchLegacyLabel("cod and chips", candidates)).toMatchObject({
      id: "fish",
    })
    expect(matchLegacyLabel("beer-garden", candidates)).toEqual({
      state: "matched",
      kind: "place",
      id: "garden",
    })
    expect(matchLegacyLabel("Pool table", candidates)).toEqual({
      state: "matched",
      kind: "amenity",
      id: "pool",
    })
  })

  it("never guesses: no match, a partial match or two matches stay notes", () => {
    expect(matchLegacyLabel("Fish", candidates)).toEqual({ state: "none" })
    expect(matchLegacyLabel("Steak pie and chips", candidates)).toEqual({
      state: "none",
    })
    expect(matchLegacyLabel("bar", candidates)).toEqual({
      state: "ambiguous",
      count: 2,
    })
    expect(matchLegacyLabel("  ", candidates)).toEqual({ state: "no_label" })
    expect(matchLegacyLabel(null, candidates)).toEqual({ state: "no_label" })
  })
})

describe("importAssetId and resultCsv", () => {
  it("gives one stable v4-shaped id per batch and line", () => {
    const a = importAssetId("batch-1", 2)
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(importAssetId("batch-1", 2)).toBe(a)
    expect(importAssetId("batch-1", 3)).not.toBe(a)
    expect(importAssetId("batch-2", 2)).not.toBe(a)
  })

  it("gives each retry attempt its own stable id; attempt 0 is the first run's", () => {
    // S5-R3 (review Y6): a line whose reservation cleanup tombstoned moves to
    // its next attempt; attempt 0 keeps the id earlier runs used.
    expect(importAssetId("batch-1", 2, 0)).toBe(importAssetId("batch-1", 2))
    const ids = [0, 1, 2].map((k) => importAssetId("batch-1", 2, k))
    expect(new Set(ids).size).toBe(3)
    expect(importAssetId("batch-1", 2, 1)).toBe(ids[1])
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
  })

  it("quotes cells and neutralises spreadsheet formulas", () => {
    const csv = resultCsv([
      {
        line: 2,
        file: "a, b.jpg",
        venue: "the-bell",
        outcome: "failed",
        detail: 'said "no"',
        assetId: "",
        duplicateOf: "",
        label: "=HYPERLINK(1)",
        labelMatch: "",
        capturedAt: "",
        capturedSource: "",
        contributor: "",
      },
    ])
    expect(csv.split("\n")[0]).toBe(
      "line,file,venue,outcome,detail,asset_id,duplicate_of,legacy_label,label_match,captured_at,captured_source,contributor_email"
    )
    expect(csv.split("\n")[1]).toBe(
      `2,"a, b.jpg",the-bell,failed,"said ""no""",,,'=HYPERLINK(1),,,,`
    )
  })
})
