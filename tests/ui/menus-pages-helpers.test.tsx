// Pure helpers of the admin menu pages (app/admin/menus/review.ts) and the
// catalogue server (lib/server/menus/{validate,errors,document}.ts).
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  blockingErrors,
  decideInDraft,
  itemOptions,
  resolveDecisions,
  reviewCount,
  sameDocument,
} from "@/app/admin/menus/review"
import type { MenuDocItem, MenuDocument } from "@/lib/menus/types"
import {
  buildDocument,
  copyForDraft,
  countByItem,
  reviewBaseFor,
} from "@/lib/server/menus/document"
import { menuRpcFailure } from "@/lib/server/menus/errors"
import {
  cleanFileName,
  cleanNote,
  cleanTitle,
  describeIssues,
  draftDocumentErrors,
  isUuid,
  parseSource,
} from "@/lib/server/menus/validate"

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function item(
  sourceKey: string,
  name: string,
  patch: Partial<MenuDocItem> = {}
): MenuDocItem {
  return {
    itemId: null,
    sourceKey,
    name,
    description: null,
    aliases: [],
    sourceMeta: {},
    variants: [],
    review: null,
    ...patch,
  }
}

const base: MenuDocument = {
  title: "Base",
  sections: [
    {
      slug: "curries",
      name: "Curries",
      kind: "food",
      items: [
        item("curries--korma", "Korma", {
          itemId: ID(1),
          variants: [
            { variantId: ID(11), name: "Veg" },
            { variantId: ID(12), name: "Lamb" },
          ],
        }),
        item("curries--balti", "Balti", { itemId: ID(2) }),
      ],
    },
    {
      slug: "sides",
      name: "Sides",
      kind: "food",
      items: [item("sides--rice", "Rice", { itemId: ID(3) })],
    },
  ],
}

const incoming: MenuDocument = {
  title: "Next",
  sections: [
    {
      slug: "curries",
      name: "Curries",
      kind: "food",
      items: [
        item("curries--korma-new", "Korma", {
          variants: [
            { variantId: null, name: "Veg" },
            { variantId: null, name: "Lamb" },
          ],
          review: { candidates: [ID(1)], reason: "Same name" },
        }),
        item("curries--balti", "Balti", { itemId: ID(2) }),
      ],
    },
  ],
}

describe("review decisions", () => {
  it("applies decisions to the original preview so they can be changed", () => {
    const same = resolveDecisions(
      incoming,
      { "curries--korma-new": { kind: "same", itemId: ID(1) } },
      base
    )
    expect(same.error).toBeNull()
    const korma = same.document.sections[0].items[0]
    expect(korma.itemId).toBe(ID(1))
    expect(korma.variants.map((v) => v.variantId)).toEqual([ID(11), ID(12)])
    expect(korma.review).toBeNull()

    const changed = resolveDecisions(
      incoming,
      { "curries--korma-new": { kind: "new" } },
      base
    )
    expect(changed.document.sections[0].items[0]).toMatchObject({
      itemId: null,
      review: null,
    })
    // The input is never mutated.
    expect(incoming.sections[0].items[0].review).not.toBeNull()
  })

  it("reports a decision that cannot apply instead of throwing", () => {
    const result = resolveDecisions(
      incoming,
      { "curries--korma-new": { kind: "same", itemId: ID(9) } },
      base
    )
    expect(result.error).toMatch(/curries--korma-new/)
  })

  it("lets a draft decision be changed after the review was cleared", () => {
    const first = decideInDraft(
      incoming,
      incoming,
      "curries--korma-new",
      { kind: "new" },
      base
    )
    expect(reviewCount(first)).toBe(0)
    const second = decideInDraft(
      first,
      incoming,
      "curries--korma-new",
      { kind: "same", itemId: ID(1) },
      base
    )
    expect(second.sections[0].items[0].itemId).toBe(ID(1))
    expect(() =>
      decideInDraft(first, incoming, "missing", { kind: "new" }, base)
    ).toThrow()
  })

  it("lists active items for suggestions, without archived ones", () => {
    expect(itemOptions(base, [ID(2)])).toEqual([
      { id: ID(1), name: "Korma (Curries)" },
      { id: ID(3), name: "Rice (Sides)" },
    ])
    expect(itemOptions(null)).toEqual([])
  })

  it("separates review issues from blocking errors", () => {
    expect(
      blockingErrors([
        {
          severity: "error",
          path: "sections[0].items[0].review",
          message: "x",
        },
        { severity: "error", path: "sections[0].name", message: "y" },
        { severity: "warning", path: "file", message: "z" },
      ]).map((i) => i.path)
    ).toEqual(["sections[0].name"])
    expect(sameDocument(base, structuredClone(base))).toBe(true)
    expect(sameDocument(base, incoming)).toBe(false)
  })
})

describe("server validation helpers", () => {
  it("accepts a draft with an unresolved review but checks ids and shapes", () => {
    expect(draftDocumentErrors(incoming)).toEqual([])
    const bad = structuredClone(incoming)
    bad.sections[0].items[1].itemId = "abc"
    bad.sections[0].items[0].variants[0].variantId = "x"
    bad.sections[0].items[0].review = { candidates: ["nope"], reason: "r" }
    expect(draftDocumentErrors(bad).map((i) => i.path)).toEqual([
      "sections[0].items[0].variants[0]",
      "sections[0].items[0].review",
      "sections[0].items[1].itemId",
    ])
    expect(draftDocumentErrors(null)).toHaveLength(1)
    expect(draftDocumentErrors({ title: "x", sections: [null] })).not.toEqual(
      []
    )
    const empty = structuredClone(base)
    empty.sections[0].items[0].name = ""
    expect(describeIssues(draftDocumentErrors(empty))).toMatch(
      /^The menu has 1 error\. sections\[0\]\.items\[0\]\.name: /
    )
  })

  it("validates provenance, titles, notes and ids", () => {
    expect(
      parseSource({
        kind: "json",
        label: " menu.json ",
        sha256: "a".repeat(64),
        revision: null,
        capturedAt: "2026-10-21T17:23:43+01:00",
        notes: "",
      })
    ).toEqual({
      kind: "json",
      label: "menu.json",
      sha256: "a".repeat(64),
      revision: null,
      capturedAt: "2026-10-21T16:23:43.000Z",
      notes: null,
    })
    expect(parseSource({ kind: "pdf" })).toBeNull()
    expect(parseSource({ kind: "csv", sha256: "abc" })).toBeNull()
    expect(parseSource({ kind: "csv", revision: "x".repeat(81) })).toBeNull()
    expect(parseSource({ kind: "csv", capturedAt: "yesterday" })).toBeNull()
    expect(cleanTitle("  Autumn ")).toBe("Autumn")
    expect(cleanTitle(" ")).toBeNull()
    expect(cleanTitle("x".repeat(121))).toBeNull()
    expect(cleanNote("  ")).toBeNull()
    expect(cleanNote("x".repeat(281))).toBeUndefined()
    expect(cleanFileName("C:\\menus\\railway.json")).toBe("railway.json")
    expect(cleanFileName("a/b/" + "x".repeat(300))).toHaveLength(200)
    expect(isUuid(ID(1))).toBe(true)
    expect(isUuid("1")).toBe(false)
  })
})

describe("RPC error mapping (A2.2)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("maps by message or SQLSTATE, never by HTTP status", () => {
    expect(
      menuRpcFailure(
        {
          message: "menu_version_conflict",
          code: "40001",
          details: '{"revision":4}',
        },
        "save"
      )
    ).toMatchObject({
      status: 409,
      message: expect.stringContaining("revision 4"),
    })
    expect(
      menuRpcFailure({ message: "menu_version_not_found", code: "P0002" }, "x")
    ).toMatchObject({ status: 404 })
    expect(
      menuRpcFailure({ message: "menu_review_pending", code: "P0001" }, "x")
    ).toMatchObject({ status: 409 })
    expect(
      menuRpcFailure(
        {
          message: "invalid_menu_document",
          code: "22023",
          details: '{"path":"sections[2].items[5].name","message":"Too long"}',
        },
        "x"
      )
    ).toEqual({
      ok: false,
      status: 400,
      message: "The menu is invalid. sections[2].items[5].name: Too long",
    })
    expect(
      menuRpcFailure({ message: "not_active_admin", code: "42501" }, "x")
    ).toMatchObject({ status: 403 })
    expect(
      menuRpcFailure({ message: "menu_empty", code: "P0001" }, "x")
    ).toMatchObject({
      status: 400,
    })
  })

  it("logs unexpected failures redacted and answers 503", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = menuRpcFailure(
      {
        message: "boom eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
        code: "XX000",
      },
      "save"
    )
    expect(result).toMatchObject({ status: 503 })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toContain("[menus] save failed")
    expect(logged).not.toContain("eyJhbGci")
  })
})

describe("document rebuild", () => {
  it("orders sections, entries and variants by position and keeps reviews", () => {
    const doc = buildDocument(
      "T",
      [
        { id: "s2", slug: "b", name: "B", kind: "drinks", position: 1 },
        { id: "s1", slug: "a", name: "A", kind: "food", position: 0 },
      ],
      [
        {
          id: "e2",
          section_id: "s1",
          item_id: ID(2),
          name: "Second",
          description: null,
          aliases: null,
          source_key: "a--second",
          source_meta: { price: "1" },
          position: 1,
          needs_review: true,
          review_candidates: [ID(3)],
          review_reason: "Same name",
          variants: [
            { variant_id: ID(22), name: "Large", position: 1 },
            { variant_id: ID(21), name: "Small", position: 0 },
          ],
        },
        {
          id: "e1",
          section_id: "s1",
          item_id: ID(1),
          name: "First",
          description: "d",
          aliases: ["One"],
          source_key: "a--first",
          source_meta: null,
          position: 0,
          needs_review: false,
          review_candidates: [],
          review_reason: null,
          variants: null,
        },
      ]
    )
    expect(doc.sections.map((s) => s.slug)).toEqual(["a", "b"])
    expect(doc.sections[0].items.map((i) => i.name)).toEqual([
      "First",
      "Second",
    ])
    expect(doc.sections[0].items[0].sourceMeta).toEqual({})
    expect(doc.sections[0].items[1].variants.map((v) => v.name)).toEqual([
      "Small",
      "Large",
    ])
    expect(doc.sections[0].items[1].review).toEqual({
      candidates: [ID(3)],
      reason: "Same name",
    })
    expect(doc.sections[1].items).toEqual([])
  })

  it("trims the review base to candidate items and copies drafts safely", () => {
    const trimmed = reviewBaseFor(base, incoming)!
    expect(
      trimmed.sections.flatMap((s) => s.items.map((i) => i.itemId))
    ).toEqual([ID(1)])
    expect(reviewBaseFor(null, incoming)).toBeNull()
    const copy = copyForDraft(incoming)
    expect(reviewCount(copy)).toBe(0)
    expect(reviewCount(incoming)).toBe(1)
    expect(
      countByItem([{ item_id: "a" }, { item_id: "a" }, { item_id: "b" }])
    ).toEqual({
      a: 2,
      b: 1,
    })
  })
})
