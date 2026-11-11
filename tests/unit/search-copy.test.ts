import { describe, expect, it } from "vitest"

import {
  DECISION_LABEL,
  RIGHTS_LABEL,
  SEARCH_COPY,
  uploadedWhen,
} from "@/components/nabalens/search/search-copy"
import {
  MENU_DECISION_STATES,
  SEARCH_RIGHTS,
} from "@/lib/server/media/search/types"

/** Every string the copy can produce, with sample arguments. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (typeof value === "function")
    return strings((value as (...a: unknown[]) => unknown)("Soup", "Large"))
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings)
  return []
}

describe("asset search copy (B05-06)", () => {
  it("names every use state and menu decision (no humanised fallback)", () => {
    for (const r of SEARCH_RIGHTS) expect(RIGHTS_LABEL[r]).toBeTruthy()
    for (const s of MENU_DECISION_STATES) expect(DECISION_LABEL[s]).toBeTruthy()
    expect(Object.keys(RIGHTS_LABEL).sort()).toEqual([...SEARCH_RIGHTS].sort())
    expect(Object.keys(DECISION_LABEL).sort()).toEqual(
      [...MENU_DECISION_STATES].sort()
    )
  })

  it("uses the SS-1 use words", () => {
    expect(RIGHTS_LABEL).toEqual({
      legacy_unknown: "Uploaded before use records",
      not_granted: "No use agreed",
      in_force: "In use",
      expired: "Use ended",
      withdrawn: "Use withdrawn",
    })
  })

  it("never says approved, reuse or another destination", () => {
    const all = [
      ...strings(SEARCH_COPY),
      ...strings(RIGHTS_LABEL),
      ...strings(DECISION_LABEL),
    ]
    expect(all.length).toBeGreaterThan(50)
    for (const text of all) {
      expect(text).not.toMatch(/approv/i)
      expect(text).not.toMatch(/\breuse\b|another destination/i)
      expect(text).not.toMatch(/\btags?\b|comment|fresh|derivative/i)
    }
  })

  it("dates uploads in London time, dropping this year's year", () => {
    const now = new Date("2026-11-11T12:00:00Z")
    expect(uploadedWhen("2026-11-03T14:05:00Z", now)).toBe("3 Nov, 14:05")
    // British Summer Time: 13:05 UTC is 14:05 in London.
    expect(uploadedWhen("2025-07-03T13:05:00Z", now)).toBe("3 Jul 2025, 14:05")
  })
})
