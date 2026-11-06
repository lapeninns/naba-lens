import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

import {
  GUIDE_ANGLES,
  GUIDE_DISHES,
  guideAlt,
  showsDishGuide,
  suggestedAngles,
} from "@/lib/guide/dish-guide"
import type { MenuSectionRef } from "@/lib/server/coverage/types"

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url))

function section(sectionKind: string | null): MenuSectionRef {
  return {
    menuPlanId: "p1",
    menuPlanStatus: "active",
    menuVersionId: "v1",
    sectionName: "Starters",
    sectionSlug: "starters",
    sectionKind,
    position: 1,
    itemCount: 6,
  }
}

describe("suggestedAngles", () => {
  it.each([
    [0, []],
    [1, ["three_quarter"]],
    [2, ["three_quarter", "overhead"]],
    [3, ["three_quarter", "overhead", "close_up"]],
    [4, ["three_quarter", "overhead", "close_up", "side"]],
    [7, ["three_quarter", "overhead", "close_up", "side"]],
    [null, []],
    [undefined, []],
    [-1, []],
    [Number.NaN, []],
  ])("target %s suggests %j", (target, expected) => {
    expect(suggestedAngles(target)).toEqual(expected)
  })
})

describe("showsDishGuide", () => {
  it("shows on food, other and unset menu sections", () => {
    for (const kind of ["food", "other", null]) {
      expect(
        showsDishGuide({ kind: "menu_section", menuSection: section(kind) }),
        String(kind)
      ).toBe(true)
    }
  })

  it("shows on a menu section without its snapshot", () => {
    expect(showsDishGuide({ kind: "menu_section", menuSection: null })).toBe(
      true
    )
  })

  it("hides on drinks sections and every non-menu task", () => {
    expect(
      showsDishGuide({ kind: "menu_section", menuSection: section("drinks") })
    ).toBe(false)
    for (const kind of ["amenity", "service", "venue_specific"] as const) {
      expect(showsDishGuide({ kind, menuSection: null }), kind).toBe(false)
    }
  })
})

describe("guide data", () => {
  it("has five dishes with four angles in prototype order", () => {
    expect(GUIDE_DISHES.map((d) => d.name)).toEqual([
      "Mixed grill",
      "Garlic naan",
      "Curry",
      "Momos",
      "Mint curry",
    ])
    expect(GUIDE_ANGLES.map((a) => a.name)).toEqual([
      "45° angle",
      "Overhead",
      "Close-up",
      "Side view",
    ])
  })

  it("names each example by dish and angle", () => {
    expect(guideAlt(GUIDE_DISHES[0], "three_quarter")).toBe(
      "Mixed grill, 45° angle example"
    )
    expect(guideAlt(GUIDE_DISHES[3], "close_up")).toBe(
      "Momos, close-up example"
    )
  })

  it("every image exists under public/guide/v1 at its stated size", async () => {
    const checked: string[] = []
    for (const dish of GUIDE_DISHES) {
      for (const angle of GUIDE_ANGLES) {
        const image = dish.images[angle.id]
        for (const [src, width, height] of [
          [image.src, image.width, image.height],
          [image.src2x, image.width2x, image.height2x],
        ] as const) {
          expect(src.startsWith("/guide/v1/"), src).toBe(true)
          const file = `${PUBLIC}${src}`
          expect(existsSync(file), src).toBe(true)
          const meta = await sharp(file).metadata()
          expect([meta.format, meta.width, meta.height], src).toEqual([
            "webp",
            width,
            height,
          ])
          // Metadata stripped: no camera or location data in public files.
          expect(meta.exif, src).toBeUndefined()
          checked.push(src)
        }
      }
    }
    expect(new Set(checked).size).toBe(40)
  })
})
