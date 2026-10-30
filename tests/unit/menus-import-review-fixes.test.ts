// Regressions for the v0.3 final review (I-2, I-4): generated reviews stay within
// the save contract, and an oversized document is refused with a clear issue.
import { describe, expect, it } from "vitest"

import { matchImportToBase, validateMenuDocument } from "@/lib/menus/import"
import {
  MENU_IMPORT_LIMITS,
  type MenuDocItem,
  type MenuDocument,
} from "@/lib/menus/types"

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function item(over: Partial<MenuDocItem>): MenuDocItem {
  return {
    itemId: null,
    sourceKey: "s--x",
    name: "X",
    description: null,
    aliases: [],
    sourceMeta: {},
    variants: [],
    review: null,
    ...over,
  }
}

describe("matchImportToBase review bounds (I-4)", () => {
  const longName = "A".repeat(120)

  it("keeps the reason within 200 characters for long names", () => {
    const base: MenuDocument = {
      title: "Base",
      sections: [
        {
          slug: "s1",
          name: "S".repeat(120),
          kind: "food",
          items: [item({ itemId: id(1), sourceKey: "s1--a", name: longName })],
        },
        {
          slug: "s2",
          name: "T".repeat(120),
          kind: "food",
          items: [item({ itemId: id(2), sourceKey: "s2--a", name: longName })],
        },
      ],
    }
    const incoming: MenuDocument = {
      title: "Next",
      sections: [
        {
          slug: "s3",
          name: "New",
          kind: "food",
          items: [item({ sourceKey: "s3--a", name: longName })],
        },
      ],
    }
    const review = matchImportToBase(base, incoming).sections[0].items[0].review
    expect(review?.candidates).toEqual([id(1), id(2)])
    expect([...(review?.reason ?? "")].length).toBeLessThanOrEqual(200)
  })

  it("caps candidates at 20 and says how many matched", () => {
    const base: MenuDocument = {
      title: "Base",
      sections: [
        {
          slug: "s1",
          name: "Old",
          kind: "food",
          items: Array.from({ length: 25 }, (_, i) =>
            item({
              itemId: id(i + 1),
              sourceKey: `s1--a-${i}`,
              name: "Chicken",
            })
          ),
        },
      ],
    }
    const incoming: MenuDocument = {
      title: "Next",
      sections: [
        {
          slug: "s2",
          name: "New",
          kind: "food",
          items: [item({ sourceKey: "s2--chicken", name: "Chicken" })],
        },
      ],
    }
    const review = matchImportToBase(base, incoming).sections[0].items[0].review
    expect(review?.candidates).toHaveLength(20)
    expect(review?.reason).toMatch(/25 existing items/)
  })
})

describe("validateMenuDocument size cap (I-2)", () => {
  it("refuses a document over documentMaxBytes", () => {
    const big = "x".repeat(600)
    const doc: MenuDocument = {
      title: "Big",
      sections: Array.from({ length: 100 }, (_, s) => ({
        slug: `s${s}`,
        name: `S${s}`,
        kind: "food" as const,
        items: Array.from({ length: 20 }, (_, i) =>
          item({
            sourceKey: `s${s}--i${i}`,
            name: `I${i}`,
            description: big,
            sourceMeta: { blob: "y".repeat(1500) },
          })
        ),
      })),
    }
    expect(
      new TextEncoder().encode(JSON.stringify(doc)).length
    ).toBeGreaterThan(MENU_IMPORT_LIMITS.documentMaxBytes)
    const issues = validateMenuDocument(doc)
    expect(
      issues.some((i) => i.path === "document" && /too large/.test(i.message))
    ).toBe(true)
  })
})
