// S1-MENUS (spec §8 A3): CSV identity and date columns, the downloadable
// template, and the preview's split of changed items into presentation
// changes (photos go to recheck) and other changes.
import { describe, expect, it } from "vitest"

import {
  diffMenuDocuments,
  isCsvDate,
  matchImportToBase,
  MENU_CSV_TEMPLATE_COLUMNS,
  menuCsvTemplate,
  parseMenuCsv,
  parseMenuFile,
  splitChanged,
} from "@/lib/menus/import"
import type { MenuDocument } from "@/lib/menus/types"

const ID = "6f1d3c1e-3b0a-4c55-9d7e-0a1b2c3d4e5f"

describe("CSV identity and date columns", () => {
  it("collects venue, menu, item_id and active dates, and titles the draft from menu", () => {
    const csv = [
      "venue,menu,section,item,item_id,active_from,active_to,variant",
      `The Inn,Winter menu,Mains,Pie,${ID},2026-12-01,2027-02-28,Small|Large`,
      "The Inn,Winter menu,Mains,Soup,,2026-12-01,2027-02-28,",
    ].join("\n")
    const out = parseMenuFile({ fileName: "upload.csv", text: csv })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.document.title).toBe("Winter menu")
    expect(out.csv).toEqual({
      venues: ["The Inn"],
      menuName: "Winter menu",
      itemIds: { "mains--pie": { itemId: ID, row: 2 } },
      activeFrom: "2026-12-01",
      activeTo: "2027-02-28",
    })
    expect(
      out.document.sections[0]!.items[0]!.variants.map((v) => v.name)
    ).toEqual(["Small", "Large"])
  })

  it("keeps the file name as the title when there is no menu column", () => {
    const out = parseMenuFile({
      fileName: "Spring.csv",
      text: "section,item\nMains,Pie",
    })
    expect(out.ok && out.document.title).toBe("Spring")
  })

  it.each([
    [
      "an invalid item_id",
      "section,item,item_id\nMains,Pie,not-an-id",
      "row 2",
      "item_id is not a valid item id",
    ],
    [
      "a bad date",
      "section,item,active_from\nMains,Pie,01/12/2026",
      "row 2",
      "active_from must be a date (YYYY-MM-DD)",
    ],
    [
      "an impossible date",
      "section,item,active_to\nMains,Pie,2026-02-30",
      "row 2",
      "active_to must be a date (YYYY-MM-DD)",
    ],
    [
      "two menus in one file",
      "section,item,menu\nMains,Pie,Lunch\nMains,Soup,Dinner",
      "row 3",
      "menu differs from an earlier row; one file is one menu",
    ],
    [
      "an end before the start",
      "section,item,active_from,active_to\nMains,Pie,2026-12-02,2026-12-01",
      "active_to",
      "active_to is before active_from",
    ],
    [
      "both variant columns",
      "section,item,variant,variants\nMains,Pie,a,b",
      "row 1",
      "Use one of variant or variants, not both",
    ],
  ])("rejects %s with a row-level issue", (_, text, path, message) => {
    const out = parseMenuCsv(text)
    expect(out.ok).toBe(false)
    expect(out.issues).toContainEqual({ path, message, severity: "error" })
  })

  it("validates calendar dates", () => {
    expect(isCsvDate("2028-02-29")).toBe(true)
    expect(isCsvDate("2027-02-29")).toBe(false)
    expect(isCsvDate("2027-2-01")).toBe(false)
  })
})

describe("CSV template", () => {
  it("parses as a valid import with every documented column", () => {
    const text = menuCsvTemplate()
    expect(text.split("\r\n")[0]).toBe(MENU_CSV_TEMPLATE_COLUMNS.join(","))
    const out = parseMenuFile({ fileName: "template.csv", text })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.document.title).toBe("Main menu")
    expect(out.document.sections.map((s) => [s.name, s.kind])).toEqual([
      ["Mains", "food"],
      ["Drinks", "drinks"],
    ])
    expect(out.csv?.activeFrom).toBe("2026-12-01")
  })
})

describe("preview diff groups", () => {
  const base: MenuDocument = {
    title: "Base",
    sections: [
      {
        slug: "mains",
        name: "Mains",
        kind: "food",
        items: [
          {
            itemId: "i-pie",
            sourceKey: "mains--pie",
            name: "Pie",
            description: null,
            aliases: [],
            sourceMeta: { price: "10" },
            variants: [
              { variantId: "v-s", name: "Small" },
              { variantId: "v-l", name: "Large" },
            ],
            review: null,
          },
          {
            itemId: "i-soup",
            sourceKey: "mains--soup",
            name: "Soup",
            description: null,
            aliases: [],
            sourceMeta: { price: "6" },
            variants: [],
            review: null,
          },
          {
            itemId: "i-tart",
            sourceKey: "mains--tart",
            name: "Tart",
            description: null,
            aliases: [],
            sourceMeta: {},
            variants: [],
            review: null,
          },
        ],
      },
    ],
  }

  it("separates presentation changes from price changes, and lists proposed retirements", () => {
    const next = parseMenuCsv(
      [
        "section,item,key,variants,price",
        "Mains,Pie,mains--pie,Small,10",
        "Mains,Soup,mains--soup,,7",
      ].join("\n")
    )
    expect(next.ok).toBe(true)
    if (!next.ok) return
    const matched = matchImportToBase(base, next.document)
    const diff = diffMenuDocuments(base, matched)
    const { presentation, other } = splitChanged(diff)
    expect(presentation.map((c) => [c.name, c.variantsRemoved])).toEqual([
      ["Pie", ["Large"]],
    ])
    expect(other.map((c) => [c.name, c.fields])).toEqual([["Soup", ["meta"]]])
    expect(diff.removed.map((r) => r.name)).toEqual(["Tart"])
  })

  it("treats a case-only rename as not a presentation change", () => {
    const changed = splitChanged({
      added: [],
      removed: [],
      uncertain: [],
      unchangedCount: 0,
      changed: [
        {
          sourceKey: "a",
          itemId: "x",
          name: "PIE ",
          sectionName: "Mains",
          fields: ["name"],
          before: { name: "pie" },
        },
        {
          sourceKey: "b",
          itemId: "y",
          name: "Steak pie",
          sectionName: "Mains",
          fields: ["name"],
          before: { name: "Pie" },
        },
      ],
    })
    expect(changed.presentation.map((c) => c.name)).toEqual(["Steak pie"])
    expect(changed.other.map((c) => c.name)).toEqual(["PIE "])
  })
})
