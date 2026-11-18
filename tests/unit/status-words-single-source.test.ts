// S3-R14 (round-2 review: single-source-status-words, X10, X11): the files
// the review named as restating status words now read them from
// components/nabalens/status-chip.tsx. This guard fails if one of them types
// a chip's word again as a string literal. Comments are ignored.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { CHIP_STATES } from "@/components/nabalens/status-chip"

const root = join(__dirname, "..", "..")

/** The files the review named (the other owners' files are in the report). */
const FILES = [
  "components/nabalens/metrics/copy.ts",
  "components/nabalens/requests/request-form.tsx",
  "lib/library/model.ts",
  "app/staff/staff-portfolio.tsx",
  "components/nabalens/tasks/status-badges.tsx",
  "lib/server/exports/model.ts",
  "app/admin/publishing/_components/package-detail.tsx",
  "app/admin/library/_components/asset-detail.tsx",
  "app/admin/library/_components/compare.tsx",
]

/**
 * Chip words distinctive enough to be a restatement when quoted: more than
 * one word ("Open", "Active" and "Saved" are ordinary words too).
 */
const WORDS = [
  ...new Set(
    Object.values(CHIP_STATES)
      .map((s) => s.word)
      .filter((w) => w.includes(" "))
  ),
]

/** A heading that happens to share a chip's word, not a state of a thing. */
const HEADINGS: Record<string, string[]> = {
  // The Metrics section of counts that need a manager (DESIGN.md §11 rule 3).
  "components/nabalens/metrics/copy.ts": ["Needs attention"],
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

describe("status words have one source", () => {
  it("has distinctive words to look for", () => {
    expect(WORDS).toContain("Approved for public use")
    expect(WORDS).toContain("Another photo requested")
    expect(WORDS).toContain("Withdrawn since")
  })

  it.each(FILES)("%s does not restate a chip's word", (file) => {
    const src = stripComments(readFileSync(join(root, file), "utf8"))
    const restated = WORDS.filter(
      (w) =>
        !HEADINGS[file]?.includes(w) &&
        ['"', "'", "`"].some((q) => src.includes(`${q}${w}${q}`))
    )
    expect(restated).toEqual([])
  })

  it("names the coverage states with the coverage chips, on Metrics and New request (X11)", () => {
    for (const file of [
      "components/nabalens/metrics/copy.ts",
      "components/nabalens/requests/request-form.tsx",
    ]) {
      const src = stripComments(readFileSync(join(root, file), "utf8"))
      expect(src).not.toMatch(
        /In the album|No photo yet|Photo waiting for review|Another photo asked for/
      )
    }
  })
})

describe("one word, one look", () => {
  /**
   * Words two chips share for different things, each drawn its own way on
   * purpose. Anything else that shares a word draws the same icon and tone.
   */
  const DIFFERENT = new Map<string, string>([
    // An upload queue row (mono, no box) and a staff outcome: two concepts
    // sharing a word, handed to S3-R12 (reports/S3-R14.md).
    ["Waiting", "upload queue vs review outcome"],
    // A venue's operating status and a request's state.
    ["Open", "venue status vs request state"],
    // Me's milestone (plain, no icon) and a knowledge finding.
    ["Saved", "portfolio milestone vs knowledge finding"],
  ])

  it("draws a shared word with the same icon and tone (Withdrawn, S4-DOCS)", () => {
    const byWord = new Map<string, Array<{ icon: unknown; tone: string }>>()
    for (const s of Object.values(CHIP_STATES)) {
      const list = byWord.get(s.word) ?? []
      list.push({ icon: "icon" in s ? s.icon : undefined, tone: s.tone })
      byWord.set(s.word, list)
    }
    const mixed = [...byWord]
      .filter(([word, list]) => list.length > 1 && !DIFFERENT.has(word))
      .filter(([, list]) =>
        list.some((x) => x.icon !== list[0]!.icon || x.tone !== list[0]!.tone)
      )
      .map(([word]) => word)
    expect(mixed).toEqual([])
    expect(CHIP_STATES.publication_withdrawn_confirmed.icon).toBe(
      CHIP_STATES.outcome_withdrawn.icon
    )
  })
})
