import { describe, expect, it } from "vitest"

import {
  buildCatalogueIndex,
  searchCatalogue,
} from "@/components/nabalens/labels/catalogue-search"
import {
  EMPTY_COMMON,
  NO_ADJUST,
  addItem,
  adoptCurrent,
  buildSaveInput,
  effectiveLabels,
  isDirty,
  missingItemChange,
  removeItem,
  setContentType,
} from "@/components/nabalens/labels/label-draft"

import { CATALOGUE, summary, view } from "./labels-fixtures"

const index = buildCatalogueIndex(CATALOGUE)
const names = (q: string) =>
  searchCatalogue(index, q).map((h) => `${h.item.name} / ${h.section.name}`)

describe("catalogue search", () => {
  it("matches names, aliases, descriptions and section names", () => {
    expect(names("onion")).toEqual(["Onion Bhaji / Starters"])
    expect(names("bhajia")).toEqual(["Onion Bhaji / Starters"])
    expect(searchCatalogue(index, "bhajia")[0].matchedAlias).toBe("Bhajia")
    expect(names("yoghurt")).toEqual(["Mango Lassi / Drinks"])
    expect(names("korma")).toEqual(["Chicken / Korma Dishes"])
    expect(names("lamb")).toEqual(["Tikka Masala / House Specials"])
  })

  it("keeps same-name items apart by section and ranks name matches first", () => {
    expect(names("chicken")).toEqual([
      "Chicken / Korma Dishes",
      "Chicken / Madras Dishes",
      "Tikka Masala / House Specials",
    ])
    expect(names("chicken madras")).toEqual(["Chicken / Madras Dishes"])
  })

  it("ignores case, accents and punctuation; empty query finds nothing", () => {
    expect(names("  MANGÓ-lassi ")).toEqual(["Mango Lassi / Drinks"])
    expect(names("")).toEqual([])
    expect(
      buildCatalogueIndex({ status: "none", venueId: "v", venueName: "V" })
    ).toEqual([])
  })
})

describe("label merge rule", () => {
  const korma = view("item-korma-chicken", "Chicken", "Korma Dishes")
  const lassi = view("item-lassi", "Mango Lassi", "Drinks")
  const bhaji = view("item-bhaji", "Onion Bhaji", "Starters")
  const base = summary({
    revision: 2,
    items: [korma],
    contentTypes: ["dish"],
    note: "Saved note",
  })
  const common = {
    items: [lassi],
    contentTypes: ["drinks" as const],
    note: "Common note",
  }

  it("is saved ∪ common ∪ file additions − file removals; file note wins", () => {
    let adj = addItem(NO_ADJUST, bhaji)
    adj = removeItem(adj, "item-lassi:", true)
    adj = setContentType(adj, "dish", false)
    let eff = effectiveLabels(base, common, adj)
    expect(eff.items.map((i) => i.itemId)).toEqual([
      "item-korma-chicken",
      "item-bhaji",
    ])
    expect(eff.contentTypes).toEqual(["drinks"])
    expect(eff.note).toBe("Common note")
    expect(eff.removedCommon).toEqual([lassi])
    adj = { ...adj, note: "Mine" }
    eff = effectiveLabels(base, common, adj)
    expect(eff.note).toBe("Mine")
    expect(eff.noteSource).toBe("file")
    expect(effectiveLabels(base, EMPTY_COMMON, NO_ADJUST).note).toBe(
      "Saved note"
    )
  })

  it("builds the complete desired input and detects no-op edits", () => {
    const eff = effectiveLabels(base, common, NO_ADJUST)
    expect(buildSaveInput("a1", base, eff, "version-1")).toEqual({
      assetId: "a1",
      expectedRevision: 2,
      catalogueVersionId: "version-1",
      contentTypes: ["dish", "drinks"],
      note: "Common note",
      items: [
        { itemId: "item-korma-chicken", variantId: null },
        { itemId: "item-lassi", variantId: null },
      ],
      missingItem: null,
    })
    expect(isDirty(base, effectiveLabels(base, EMPTY_COMMON, NO_ADJUST))).toBe(
      false
    )
    expect(isDirty(base, eff)).toBe(true)
  })

  it("missing item: null unchanged, empty string withdraws, text suggests", () => {
    expect(missingItemChange(summary(), "")).toBeNull()
    expect(missingItemChange(summary(), " Lamb shank ")).toBe("Lamb shank")
    expect(missingItemChange(summary({ missingItem: "Pie" }), "Pie")).toBeNull()
    expect(missingItemChange(summary({ missingItem: "Pie" }), "  ")).toBe("")
  })

  it("adopting the current labels makes the file show exactly them", () => {
    const current = summary({ revision: 5, items: [bhaji], note: null })
    const eff = effectiveLabels(current, common, adoptCurrent(current, common))
    expect(isDirty(current, eff)).toBe(false)
  })
})
