// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { parseMenuFile } from "../../lib/menus/import"
import {
  applyReviewDecision,
  diffMenuDocuments,
  matchImportToBase,
} from "../../lib/menus/import/matching"
import type { MenuDocument } from "../../lib/menus/types"
import * as reference from "./support/menus-matching-reference"

// The matcher was rewritten from array scans to lookup maps. These tests pin
// its results to the previous implementation (kept in support/) on the menu
// fixtures and on a 2,000-item synthetic menu.

const FIXTURES = join(__dirname, "../fixtures/menus")

function loadFixture(file: string): MenuDocument | null {
  const parsed = parseMenuFile({
    fileName: file,
    text: readFileSync(join(FIXTURES, file), "utf8"),
  })
  return parsed.ok ? parsed.document : null
}

/** A base document as the database would return it: every item has an id. */
function asBase(document: MenuDocument, prefix: string): MenuDocument {
  const base = structuredClone(document)
  let n = 0
  for (const section of base.sections)
    for (const item of section.items) {
      item.itemId = `${prefix}-item-${n++}`
      item.variants.forEach((v, k) => (v.variantId = `${item.itemId}-v${k}`))
    }
  return base
}

function expectSameResults(base: MenuDocument | null, incoming: MenuDocument) {
  const before = reference.matchImportToBase(base, incoming)
  const after = matchImportToBase(base, incoming)
  expect(after).toEqual(before)
  expect(diffMenuDocuments(base, after)).toEqual(
    reference.diffMenuDocuments(base, before)
  )
  return after
}

const fixtureFiles = readdirSync(FIXTURES).filter((f) =>
  /\.(json|csv)$/.test(f)
)
const fixtures = fixtureFiles.flatMap((file) => {
  const document = loadFixture(file)
  return document ? [{ file, document }] : []
})

describe("import matching on the menu fixtures", () => {
  it("parses the fixtures it compares", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8)
  })

  for (const base of fixtures)
    for (const incoming of fixtures)
      it(`${incoming.file} against base ${base.file}`, () => {
        expectSameResults(asBase(base.document, "b"), incoming.document)
      })

  it("matches with no base menu", () => {
    for (const { document } of fixtures) expectSameResults(null, document)
  })
})

// ---------------------------------------------------------------------------
// Synthetic 2,000-item menu
// ---------------------------------------------------------------------------

const STYLES = ["Classic", "Smoked", "Spiced", "Crispy", "House"]
const PROTEINS = ["Chicken", "Lamb", "Prawn", "Paneer", "Beef", "Cod", "Duck"]
const DISHES = ["Tikka", "Karahi", "Masala", "Biryani", "Skewers", "Pie"]

type Options = {
  keyPrefix?: string
  /** Every nth item gets a new name, keeping its key. */
  renameEvery?: number
  /** Every nth item is dropped. */
  dropEvery?: number
  /** Added items per hundred. */
  addPerHundred?: number
  /** Reuse these names (case and punctuation varied) under new keys. */
  recycleNames?: boolean
  /** Give every nth item aliases that equal other items' names. */
  aliasEvery?: number
}

function synthetic(size: number, options: Options = {}): MenuDocument {
  const { keyPrefix = "", renameEvery, dropEvery, addPerHundred = 0 } = options
  const name = (i: number) =>
    `${STYLES[i % 5]} ${PROTEINS[Math.floor(i / 5) % 7]} ${DISHES[Math.floor(i / 35) % 6]} ${Math.floor(i / 210)}`
  const sections = Array.from({ length: 40 }, (_, s) => ({
    slug: `sec-${s}`,
    name: `Section ${s}`,
    kind: "food" as const,
    items: [] as MenuDocument["sections"][number]["items"],
  }))
  const total = size + Math.round((size * addPerHundred) / 100)
  for (let i = 0; i < total; i++) {
    if (dropEvery && i < size && i % dropEvery === 0) continue
    const renamed = renameEvery && i < size && i % renameEvery === 1
    let itemName = name(renamed ? i + size : i)
    if (options.recycleNames) itemName = ` ${itemName.toUpperCase()}!`
    const section = sections[i % sections.length]
    sections[i % sections.length].items.push({
      itemId: null,
      sourceKey: `${keyPrefix}${section.slug}--item-${i}`,
      name: itemName,
      description: i % 3 === 0 ? `Description ${i}` : null,
      aliases:
        options.aliasEvery && i % options.aliasEvery === 0
          ? [name((i + 1) % size), name((i + 2) % size), name(i)]
          : [],
      variants:
        i % 4 === 0
          ? [
              { variantId: null, name: "Regular" },
              { variantId: null, name: "Large" },
            ]
          : [],
      sourceMeta: i % 5 === 0 ? { price: String(i) } : {},
    } as MenuDocument["sections"][number]["items"][number])
  }
  return {
    title: "SYNTHETIC TEST DATA",
    sections: sections.filter((s) => s.items.length > 0),
  } as MenuDocument
}

describe("import matching on a 2,000-item synthetic menu", () => {
  const base = asBase(synthetic(2000), "b")

  const cases: [string, Options][] = [
    ["identical", {}],
    [
      "same keys, 10% renamed, 10% dropped, 10% added",
      { renameEvery: 10, dropEvery: 10, addPerHundred: 10 },
    ],
    ["every key changed", { keyPrefix: "new-" }],
    [
      "every key changed, names recycled",
      { keyPrefix: "new-", recycleNames: true },
    ],
    [
      "every key changed, aliases equal other names",
      { keyPrefix: "new-", aliasEvery: 3 },
    ],
    ["every key changed, 30% renamed", { keyPrefix: "new-", renameEvery: 3 }],
  ]
  for (const [label, options] of cases)
    it(label, () => {
      const out = expectSameResults(base, synthetic(2000, options))
      expect(out.sections.length).toBeGreaterThan(0)
    })

  it("finds the same candidates and reviews on the 'every key changed' case", () => {
    const out = expectSameResults(base, synthetic(2000, { keyPrefix: "new-" }))
    const reviews = out.sections.flatMap((s) => s.items).filter((i) => i.review)
    expect(reviews.length).toBe(2000)
  })

  it("applies review decisions identically", () => {
    const incoming = synthetic(2000, { keyPrefix: "new-" })
    const matched = matchImportToBase(base, incoming)
    const item = matched.sections.flatMap((s) => s.items)[7]
    const decision = {
      kind: "same" as const,
      itemId: item.review!.candidates[0],
    }
    expect(
      applyReviewDecision(matched, item.sourceKey, decision, base)
    ).toEqual(
      reference.applyReviewDecision(matched, item.sourceKey, decision, base)
    )
  })

  it("matches 150 items the same way", () => {
    const small = asBase(synthetic(150), "s")
    for (const [, options] of cases)
      expectSameResults(small, synthetic(150, options))
  })
})
