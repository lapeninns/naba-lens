// /staff/manage redirects run in next.config, before the staff layout can
// send a manager account to /manager (D3).
import { describe, expect, it } from "vitest"

import { RETIRED_MANAGE_REDIRECTS } from "@/lib/config/retired-manage-routes"

/** Where next.config's first matching redirect sends a path. */
function target(path: string): string | null {
  for (const r of RETIRED_MANAGE_REDIRECTS) {
    const rest = r.source.endsWith("/:rest*")
      ? r.source.slice(0, -"/:rest*".length)
      : null
    if (rest === null && path === r.source) return r.destination
    // `:rest*` is zero or more segments, as in Next's path matching.
    if (rest !== null && (path === rest || path.startsWith(`${rest}/`))) {
      const tail = path.slice(rest.length + 1)
      return r.destination.replace("/:rest*", tail ? `/${tail}` : "")
    }
  }
  return null
}

describe("retired /staff/manage redirects (D3)", () => {
  it.each([
    ["/staff/manage", "/manager"],
    ["/staff/manage/review", "/manager/review"],
    ["/staff/manage/team", "/manager/team"],
    ["/staff/manage/menu", "/manager/menu"],
    ["/staff/manage/menu/items", "/manager/menu"],
    ["/staff/manage/search", "/manager/search"],
    ["/staff/manage/amenities", "/manager/amenities"],
    ["/staff/manage/amenities/places", "/manager/amenities/places"],
    ["/staff/manage/amenities/c1", "/manager/amenities/c1"],
    ["/staff/manage/amenities/c1/capture", "/manager/amenities/c1/capture"],
    ["/staff/manage/checklist", "/manager"],
    ["/staff/manage/checklist/r1", "/manager"],
  ])("%s goes to %s", (from, to) => {
    expect(target(from)).toBe(to)
  })

  it("are permanent and touch nothing outside /staff/manage", () => {
    for (const r of RETIRED_MANAGE_REDIRECTS) {
      expect(r.permanent).toBe(true)
      expect(r.source.startsWith("/staff/manage")).toBe(true)
    }
    expect(target("/staff/managed")).toBeNull()
  })
})
