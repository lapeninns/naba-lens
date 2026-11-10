// @vitest-environment node
// B04-a crosswalk (b04-design §4.2, §4.6): the pure matcher, snapshot rules,
// locators, content hash, decision rules and manifest helpers, plus the
// server functions' input checks and error mapping. The database side of the
// same rules is tests/security/menus-crosswalk.test.ts. All data is synthetic.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { sha256Hex } from "../../lib/menus/import"
import {
  CROSSWALK_BASES,
  CROSSWALK_STATUSES,
  DEFAULT_FIELD_AUTHORITY,
  FIELD_AUTHORITIES,
  MENU_CHANNELS,
  MENU_FIELDS,
  MENU_SOURCE_KINDS,
  NABALENS_FIELDS_NOW,
  contentHashInput,
  crosswalkDecisionError,
  manifestCsv,
  manifestOutcome,
  proposeCrosswalk,
  snapshotDocumentError,
  variantLocators,
  websiteLocators,
  type CatalogueEntry,
  type CrosswalkHead,
  type MenuManifest,
  type ProposeInput,
  type SnapshotEntry,
} from "../../lib/menus/trading/crosswalk"
import {
  crosswalkRpcFailure,
  declareMenuSource,
  decideMenuCrosswalk,
  readMenuManifest,
  recordMenuSnapshot,
  setMenuFieldAuthority,
} from "../../lib/server/menus/crosswalk"
import type { MediaActor } from "../../lib/server/media/types"

const MIGRATION = readFileSync(
  join(
    __dirname,
    "../../supabase/migrations/20261110150000_menu_b04a_sources_crosswalk.sql"
  ),
  "utf8"
)

// Synthetic ids (valid UUID shape, never real records).
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const TIKKA_MAINS = id(1)
const TIKKA_STARTERS = id(2)
const KORMA = id(3)
const KORMA_CHICKEN = id(31)
const KORMA_LAMB = id(32)
const TIKKA_CHICKEN = id(11)
const CHIPS = id(4)
const S1 = id(901)
const S2 = id(902)

const catalogue: CatalogueEntry[] = [
  {
    itemId: TIKKA_STARTERS,
    sourceKey: "starters--chicken-tikka",
    name: "Chicken Tikka",
    aliases: [],
    sectionName: "Starters",
    variants: [],
  },
  {
    itemId: TIKKA_MAINS,
    sourceKey: "mains--chicken-tikka",
    name: "Chicken Tikka",
    aliases: [],
    sectionName: "Mains",
    variants: [{ variantId: TIKKA_CHICKEN, name: "Chicken" }],
  },
  {
    itemId: KORMA,
    sourceKey: "mains--korma",
    name: "Korma",
    aliases: ["Kurma"],
    sectionName: "Mains",
    variants: [
      { variantId: KORMA_CHICKEN, name: "Chicken" },
      { variantId: KORMA_LAMB, name: "Lamb" },
    ],
  },
  {
    itemId: CHIPS,
    sourceKey: "sides--chips",
    name: "Chips",
    aliases: [],
    sectionName: "Sides",
    variants: [],
  },
]

async function input(
  entries: SnapshotEntry[],
  opts: Partial<Omit<ProposeInput, "entries" | "contentHashes">> = {}
): Promise<ProposeInput> {
  return {
    snapshotId: opts.snapshotId ?? S1,
    sourceKind: opts.sourceKind ?? "venue_website",
    entries,
    contentHashes: await Promise.all(
      entries.map((e) => sha256Hex(contentHashInput(e)))
    ),
    catalogue: opts.catalogue === undefined ? catalogue : opts.catalogue,
    heads: opts.heads ?? [],
  }
}

/** Heads after applying proposals, with confirmations a reviewer made. */
function headsAfter(
  rows: ReturnType<typeof proposeCrosswalk>["rows"],
  snapshotId: string,
  confirm: Record<string, Partial<CrosswalkHead>> = {},
  previous: CrosswalkHead[] = []
): CrosswalkHead[] {
  const map = new Map(previous.map((h) => [h.locator, h]))
  for (const r of rows)
    map.set(r.locator, {
      locator: r.locator,
      entryLocator: r.entryLocator,
      status: r.status,
      itemId: r.itemId,
      variantId: r.variantId,
      channel: r.channel,
      contentHash: r.contentHash,
      snapshotId,
    })
  for (const [locator, patch] of Object.entries(confirm))
    map.set(locator, { ...map.get(locator)!, status: "confirmed", ...patch })
  return [...map.values()]
}

const byLocator = (rows: { locator: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.locator, r]))

describe("same-name ambiguity (§4.2 #4)", () => {
  it("lists every candidate and confirms nothing for two Chicken Tikka entries", async () => {
    const { rows } = proposeCrosswalk(
      await input([
        {
          locator: "starters.json#name=Chicken Tikka",
          name: "Chicken Tikka",
          section: "Starters",
        },
        {
          locator: "mains.json#name=Chicken Tikka",
          name: "Chicken Tikka",
          section: "Mains",
        },
      ])
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.status).toBe("ambiguous")
      expect(r.itemId).toBeNull()
      // Display order of the catalogue, both listed.
      expect(r.candidates).toEqual([TIKKA_STARTERS, TIKKA_MAINS])
      expect(r.candidateCount).toBe(2)
    }
    expect(
      rows.some((r) => r.status === "confirmed" || r.status === "carried")
    ).toBe(false)
  })

  it("keeps a name the source repeats ambiguous even with one candidate", async () => {
    const { rows } = proposeCrosswalk(
      await input([
        { locator: "a.json#name=Chips", name: "Chips" },
        { locator: "b.json#name=Chips", name: "CHIPS!" },
      ])
    )
    expect(rows.map((r) => [r.status, r.itemId, r.candidates])).toEqual([
      ["ambiguous", null, [CHIPS]],
      ["ambiguous", null, [CHIPS]],
    ])
  })

  it("proposes a single name or alias match, never confirms it", async () => {
    const { rows } = proposeCrosswalk(
      await input([
        { locator: "x#name=Chips", name: " chips".trim() },
        { locator: "x#name=Kurma", name: "Kurma" },
        { locator: "x#name=Paneer", name: "Paneer", aliases: ["Korma"] },
        { locator: "x#name=New", name: "Brand New Dish" },
      ])
    )
    expect(
      rows.map((r) => [r.status, r.basis, r.itemId, r.candidates])
    ).toEqual([
      ["proposed", "name_candidate", CHIPS, [CHIPS]],
      ["proposed", "name_candidate", KORMA, [KORMA]],
      ["proposed", "name_candidate", KORMA, [KORMA]],
      ["proposed", "name_candidate", null, []],
    ])
  })

  it("uses source keys only for NabaLens-lineage sources", async () => {
    const entry = {
      locator: "doc#mains--chicken-tikka",
      name: "Chicken Tikka",
      sourceKey: "mains--chicken-tikka",
    }
    const design = proposeCrosswalk(
      await input([entry], { sourceKind: "menu_design" })
    )
    expect(design.rows[0]).toMatchObject({
      status: "proposed",
      basis: "source_key_exact",
      itemId: TIKKA_MAINS,
    })
    const website = proposeCrosswalk(
      await input([entry], { sourceKind: "venue_website" })
    )
    expect(website.rows[0]).toMatchObject({ status: "ambiguous", itemId: null })
  })

  it("proposes without candidates when the venue has no active menu", async () => {
    const { rows } = proposeCrosswalk(
      await input([{ locator: "x#name=Chips", name: "Chips" }], {
        catalogue: null,
      })
    )
    expect(rows[0]).toMatchObject({
      status: "proposed",
      itemId: null,
      candidates: [],
    })
  })
})

describe("variants only inside the confirmed item (§4.2 #5)", () => {
  const korma: SnapshotEntry = {
    locator: "curries.json#name=Korma",
    name: "Korma",
    variants: ["Chicken", "Lamb", "Prawn"],
    priceText: "10.5",
  }

  it("proposes no variant row until the entry is confirmed", async () => {
    const { rows } = proposeCrosswalk(await input([korma]))
    expect(rows.map((r) => r.locator)).toEqual([korma.locator])
  })

  it("matches 'Chicken' under Korma, never under Tikka", async () => {
    const first = proposeCrosswalk(await input([korma]))
    const heads = headsAfter(first.rows, S1, {
      [korma.locator]: { itemId: KORMA },
    })
    const again = proposeCrosswalk(await input([korma], { heads }))
    // The confirmed entry row is skipped; only variant rows are new.
    expect(again.skipped).toBe(1)
    const rows = byLocator(again.rows)
    expect(Object.keys(rows)).toEqual([
      "curries.json#name=Korma#variant=Chicken",
      "curries.json#name=Korma#variant=Lamb",
      "curries.json#name=Korma#variant=Prawn",
    ])
    expect(rows["curries.json#name=Korma#variant=Chicken"]).toMatchObject({
      status: "proposed",
      itemId: KORMA,
      variantId: KORMA_CHICKEN,
      entryLocator: korma.locator,
    })
    expect(again.rows.flatMap((r) => r.candidates)).not.toContain(TIKKA_CHICKEN)
    expect(rows["curries.json#name=Korma#variant=Prawn"]).toMatchObject({
      status: "proposed",
      itemId: KORMA,
      variantId: null,
      candidates: [],
    })
  })

  it("keeps a variant name the entry repeats ambiguous", async () => {
    const entry = {
      ...korma,
      variants: ["Chicken", "chicken "].map((v) => v.trim()),
    }
    const first = proposeCrosswalk(await input([entry]))
    const heads = headsAfter(first.rows, S1, {
      [entry.locator]: { itemId: KORMA },
    })
    const { rows } = proposeCrosswalk(await input([entry], { heads }))
    expect(rows.map((r) => [r.locator, r.status, r.variantId])).toEqual([
      ["curries.json#name=Korma#variant=Chicken", "proposed", KORMA_CHICKEN],
      ["curries.json#name=Korma#variant=chicken#2", "ambiguous", null],
    ])
  })
})

describe("revision change: carry by locator and hash (§4.2 #6)", () => {
  const chips: SnapshotEntry = {
    locator: "sides.json#name=Chips",
    name: "Chips",
    priceText: "3.5",
  }
  const korma: SnapshotEntry = {
    locator: "curries.json#name=Korma",
    name: "Korma",
    variants: ["Chicken"],
    priceText: "10.5",
  }
  const gone: SnapshotEntry = { locator: "sides.json#name=Rice", name: "Rice" }

  async function confirmedBase() {
    const first = proposeCrosswalk(await input([chips, korma, gone]))
    let heads = headsAfter(first.rows, S1, {
      [chips.locator]: { itemId: CHIPS },
      [korma.locator]: { itemId: KORMA },
      [gone.locator]: { itemId: KORMA, channel: "takeaway" },
    })
    const variants = proposeCrosswalk(
      await input([chips, korma, gone], { heads })
    )
    heads = headsAfter(
      variants.rows,
      S1,
      {
        [`${korma.locator}#variant=Chicken`]: { variantId: KORMA_CHICKEN },
      },
      heads
    )
    return heads
  }

  it("carries identical entries, re-reviews changed ones, removes missing ones", async () => {
    const heads = await confirmedBase()
    const next = proposeCrosswalk(
      await input([chips, { ...korma, priceText: "11.00" }], {
        snapshotId: S2,
        heads,
      })
    )
    const rows = byLocator(next.rows)
    expect(rows[chips.locator]).toMatchObject({
      status: "carried",
      basis: "carried",
      itemId: CHIPS,
    })
    expect(rows[korma.locator]).toMatchObject({
      status: "needs_review",
      itemId: KORMA,
      candidates: [KORMA],
    })
    // The entry is no longer mapped, so its mapped variant goes back to review.
    expect(rows[`${korma.locator}#variant=Chicken`]).toMatchObject({
      status: "needs_review",
      variantId: KORMA_CHICKEN,
      candidates: [KORMA_CHICKEN],
    })
    expect(rows[gone.locator]).toMatchObject({
      status: "not_on_source",
      itemId: KORMA,
      channel: "takeaway",
    })
    expect(next.rows.filter((r) => r.status === "confirmed")).toEqual([])
  })

  it("carries variant rows with their entry", async () => {
    const heads = await confirmedBase()
    const next = proposeCrosswalk(
      await input([chips, korma, gone], { snapshotId: S2, heads })
    )
    expect(next.rows.map((r) => [r.locator, r.status])).toEqual([
      [chips.locator, "carried"],
      [korma.locator, "carried"],
      [gone.locator, "carried"],
      [`${korma.locator}#variant=Chicken`, "carried"],
    ])
  })

  it("marks a removed variant not_on_source while its entry stays mapped", async () => {
    const heads = await confirmedBase()
    // Same content except the variant list, so the entry needs review too:
    // its variant goes back to review with it, not off the source.
    const changed = proposeCrosswalk(
      await input([chips, { ...korma, variants: [] }, gone], {
        snapshotId: S2,
        heads,
      })
    )
    expect(
      byLocator(changed.rows)[`${korma.locator}#variant=Chicken`]
    ).toMatchObject({
      status: "needs_review",
    })
    // An entry that disappears takes its variants off the source.
    const removed = proposeCrosswalk(
      await input([chips, gone], { snapshotId: S2, heads })
    )
    expect(
      byLocator(removed.rows)[`${korma.locator}#variant=Chicken`]
    ).toMatchObject({
      status: "not_on_source",
    })
  })

  it("keeps an unchanged rejected or unmatched decision, re-proposes a changed one", async () => {
    const first = proposeCrosswalk(await input([chips]))
    const heads = headsAfter(first.rows, S1, {
      [chips.locator]: { status: "unmatched", itemId: null },
    })
    expect(
      proposeCrosswalk(await input([chips], { snapshotId: S2, heads }))
    ).toEqual({
      rows: [],
      skipped: 1,
    })
    const changed = proposeCrosswalk(
      await input([{ ...chips, priceText: "4" }], { snapshotId: S2, heads })
    )
    expect(changed.rows[0]).toMatchObject({ status: "proposed", itemId: CHIPS })
  })

  it("is idempotent for one snapshot", async () => {
    const first = proposeCrosswalk(await input([chips, korma]))
    const heads = headsAfter(first.rows, S1)
    expect(proposeCrosswalk(await input([chips, korma], { heads }))).toEqual({
      rows: [],
      skipped: 2,
    })
  })
})

describe("decision rules (§4.2 #3, §4.6)", () => {
  const head = (
    locator: string,
    patch: Partial<CrosswalkHead> = {}
  ): CrosswalkHead => ({
    locator,
    entryLocator: null,
    status: "proposed",
    itemId: null,
    variantId: null,
    channel: "all",
    contentHash: "0".repeat(64),
    snapshotId: S1,
    ...patch,
  })
  const variantItem = (v: string) =>
    ({
      [KORMA_CHICKEN]: KORMA,
      [KORMA_LAMB]: KORMA,
      [TIKKA_CHICKEN]: TIKKA_MAINS,
    })[v] ?? null

  it("refuses two source entries confirmed to one (item, variant, channel)", () => {
    const heads = [head("a", { status: "confirmed", itemId: CHIPS }), head("b")]
    expect(
      crosswalkDecisionError(
        heads,
        "b",
        { status: "confirmed", itemId: CHIPS, variantId: null, channel: "all" },
        variantItem
      )
    ).toBe("crosswalk_conflict")
  })

  it("refuses one source entry confirmed to two items", () => {
    const heads = [head("a", { status: "carried", itemId: CHIPS })]
    expect(
      crosswalkDecisionError(
        heads,
        "a",
        { status: "confirmed", itemId: KORMA, variantId: null, channel: "all" },
        variantItem
      )
    ).toBe("crosswalk_conflict")
    // Rejecting it first is how a reviewer changes their mind.
    expect(
      crosswalkDecisionError(heads, "a", { status: "rejected" }, variantItem)
    ).toBeNull()
  })

  it("maps one dish on food and takeaway as two channels of one item", () => {
    const heads = [
      head("food/curries.json#name=Korma", {
        status: "confirmed",
        itemId: KORMA,
        channel: "dine_in",
      }),
      head("takeaway/curries.json#name=Korma"),
    ]
    expect(
      crosswalkDecisionError(
        heads,
        "takeaway/curries.json#name=Korma",
        {
          status: "confirmed",
          itemId: KORMA,
          variantId: null,
          channel: "takeaway",
        },
        variantItem
      )
    ).toBeNull()
  })

  it("checks variants against their item and confirmed entry", () => {
    const heads = [
      head("k", { status: "confirmed", itemId: KORMA }),
      head("k#variant=Chicken", { entryLocator: "k" }),
      head("t", { status: "proposed", itemId: TIKKA_MAINS }),
      head("t#variant=Chicken", { entryLocator: "t" }),
    ]
    const confirm = (variantId: string | null, itemId = KORMA) =>
      ({ status: "confirmed", itemId, variantId, channel: "all" }) as const
    expect(
      crosswalkDecisionError(
        heads,
        "k#variant=Chicken",
        confirm(TIKKA_CHICKEN),
        variantItem
      )
    ).toBe("crosswalk_variant_wrong_item")
    expect(
      crosswalkDecisionError(
        heads,
        "k#variant=Chicken",
        confirm(null),
        variantItem
      )
    ).toBe("crosswalk_variant_required")
    expect(
      crosswalkDecisionError(
        heads,
        "t#variant=Chicken",
        confirm(TIKKA_CHICKEN, TIKKA_MAINS),
        variantItem
      )
    ).toBe("crosswalk_parent_not_confirmed")
    expect(
      crosswalkDecisionError(
        heads,
        "k#variant=Chicken",
        confirm(KORMA_CHICKEN),
        variantItem
      )
    ).toBeNull()
  })
})

describe("snapshot documents", () => {
  const ok: SnapshotEntry = { locator: "a#name=A", name: "A" }
  const cases: [unknown, { path: string; message: string } | null][] = [
    [[ok], null],
    [
      [
        {
          ...ok,
          section: null,
          description: null,
          priceText: null,
          sourceKey: null,
        },
      ],
      null,
    ],
    [{}, { path: "", message: "The document is a list of entries" }],
    [Array(2001).fill(ok), { path: "", message: "At most 2000 entries" }],
    [[ok, "x"], { path: "[1]", message: "Each entry is an object" }],
    // jsonb order: shorter key first.
    [
      [{ ...ok, zz: 1, price: 1 }],
      { path: "[0].zz", message: "Unknown field" },
    ],
    [
      [{ name: "A" }],
      { path: "[0].locator", message: "1 to 300 characters, no outer spaces" },
    ],
    [
      [{ ...ok, locator: " a" }],
      { path: "[0].locator", message: "1 to 300 characters, no outer spaces" },
    ],
    [
      [{ ...ok, locator: "a#variant=b" }],
      { path: "[0].locator", message: "Contains the reserved #variant=" },
    ],
    [
      [{ ...ok, name: "x".repeat(121) }],
      { path: "[0].name", message: "1 to 120 characters, no outer spaces" },
    ],
    [
      [{ ...ok, priceText: 10.5 }],
      {
        path: "[0].priceText",
        message: "Up to 80 characters, no outer spaces",
      },
    ],
    [
      [{ ...ok, sourceKey: "Bad Key" }],
      { path: "[0].sourceKey", message: "Invalid source key" },
    ],
    [
      [{ ...ok, variants: null }],
      {
        path: "[0].variants",
        message: "Up to 12 values of 1 to 80 characters",
      },
    ],
    [
      [{ ...ok, labels: ["GF", ""] }],
      { path: "[0].labels", message: "Up to 20 values of 1 to 40 characters" },
    ],
    [
      [ok, { ...ok, name: "B" }],
      { path: "[1].locator", message: "Duplicate locator" },
    ],
  ]
  it.each(cases)("%#", (document, expected) => {
    expect(snapshotDocumentError(document)).toEqual(expected)
  })

  it("counts characters, not UTF-16 units", () => {
    expect(
      snapshotDocumentError([{ ...ok, name: "🍛".repeat(120) }])
    ).toBeNull()
  })
})

describe("locators and content hash (§4.3)", () => {
  it("disambiguates a name a category repeats", () => {
    expect(
      websiteLocators([
        { file: "curries.json", name: "Chicken Curry" },
        { file: "curries.json", name: "Chicken Curry" },
        { file: "takeaway/curries.json", name: "Chicken Curry" },
        { file: "menu.json", category: "Mains", name: "Chicken Curry" },
      ])
    ).toEqual([
      "curries.json#name=Chicken Curry",
      "curries.json#name=Chicken Curry#2",
      "takeaway/curries.json#name=Chicken Curry",
      "menu.json#category=Mains#name=Chicken Curry",
    ])
    expect(
      variantLocators({ locator: "l", name: "K", variants: ["Lamb", "lamb"] })
    ).toEqual(["l#variant=Lamb", "l#variant=lamb#2"])
  })

  it("writes the hash input as Postgres prints jsonb_build_array", async () => {
    expect(
      contentHashInput({
        locator: "ignored",
        name: 'Tikka "Special"',
        variants: ["Half", "Full"],
        labels: [],
        priceText: "10.5",
      })
    ).toBe('["Tikka \\"Special\\"", null, ["Half", "Full"], [], "10.5"]')
    const a = await sha256Hex(
      contentHashInput({ locator: "a", name: "X", priceText: "1" })
    )
    const b = await sha256Hex(
      contentHashInput({ locator: "b", name: "X", priceText: "1" })
    )
    const c = await sha256Hex(
      contentHashInput({ locator: "a", name: "X", priceText: "1.00" })
    )
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe("manifest helpers (§4.2 #7)", () => {
  const h = (patch: Partial<CrosswalkHead & { candidates: string[] }>) => ({
    locator: "l",
    entryLocator: null,
    status: "proposed" as const,
    itemId: null,
    variantId: null,
    channel: "all" as const,
    contentHash: "0".repeat(64),
    snapshotId: S1,
    candidates: [],
    ...patch,
  })
  it("gives every active entry one of four outcomes", () => {
    expect(manifestOutcome(CHIPS, [])).toBe("unmatched")
    expect(
      manifestOutcome(CHIPS, [h({ status: "carried", itemId: CHIPS })])
    ).toBe("confirmed")
    expect(
      manifestOutcome(CHIPS, [
        h({ status: "ambiguous", candidates: [CHIPS, KORMA] }),
      ])
    ).toBe("needs_review")
    expect(
      manifestOutcome(CHIPS, [h({ status: "confirmed", itemId: KORMA })])
    ).toBe("not_on_source")
    // A variant row never stands for its item.
    expect(
      manifestOutcome(CHIPS, [
        h({ status: "confirmed", itemId: CHIPS, entryLocator: "x" }),
      ])
    ).toBe("not_on_source")
  })

  it("exports CSV with formula prefixes neutralised", () => {
    const manifest = {
      sources: [{ sourceId: S1, label: "=HYPERLINK(1)" }],
      entries: [
        {
          itemId: CHIPS,
          name: 'Chips, "large"',
          sectionName: "Sides",
          outcomes: [{ sourceId: S1, outcome: "confirmed" }],
          priceDisagreement: true,
        },
        {
          itemId: KORMA,
          name: "Korma",
          sectionName: "Mains",
          outcomes: [],
          priceDisagreement: false,
        },
      ],
    } as unknown as MenuManifest
    expect(manifestCsv(manifest).split("\r\n")).toEqual([
      "item_id,name,section,source,outcome,price_disagreement",
      `${CHIPS},"Chips, ""large""",Sides,'=HYPERLINK(1),confirmed,yes`,
      `${KORMA},Korma,Mains,,unmatched,no`,
      "",
    ])
  })
})

describe("closed sets match the migration", () => {
  const listAfter = (anchor: string) => {
    const at = MIGRATION.indexOf(anchor)
    expect(at, anchor).toBeGreaterThan(-1)
    // The list starts at the anchor's last parenthesis.
    const open = at + anchor.lastIndexOf("(")
    const close = MIGRATION.indexOf(")", open)
    return [...MIGRATION.slice(open + 1, close).matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1]
    )
  }

  it("kinds, fields, channels, authorities, statuses and bases", () => {
    expect(listAfter("kind text not null check (kind in (")).toEqual([
      ...MENU_SOURCE_KINDS,
    ])
    expect(listAfter("field text not null check (field in (")).toEqual([
      ...MENU_FIELDS,
    ])
    expect(
      listAfter("channel text not null default 'all' check (channel in (")
    ).toEqual([...MENU_CHANNELS])
    expect(listAfter("authority text not null check (authority in (")).toEqual([
      ...FIELD_AUTHORITIES,
    ])
    expect(listAfter("status text not null check (status in (")).toEqual([
      ...CROSSWALK_STATUSES,
    ])
    expect(listAfter("check (basis in ('source_key_exact'")).toEqual([
      ...CROSSWALK_BASES,
    ])
    const fields = MIGRATION.slice(
      MIGRATION.indexOf("create function private.menu_fields()"),
      MIGRATION.indexOf("];")
    )
    expect([...fields.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      ...MENU_FIELDS,
    ])
  })

  it("seeds the §4.4 defaults and switches nothing to NabaLens", () => {
    expect(DEFAULT_FIELD_AUTHORITY).toEqual({
      identity: "nabalens",
      name: "source_document",
      description: "source_document",
      section: "source_document",
      variants: "source_document",
      price: "venue_website",
      portion: "venue_website",
      availability: "venue_website",
      temporary_unavailability: "venue_website",
      modifiers: "venue_website",
      dietary: "venue_website",
      allergens: "not_published",
      photos: "nabalens",
    })
    const nabalens = MENU_FIELDS.filter(
      (f) => DEFAULT_FIELD_AUTHORITY[f] === "nabalens"
    )
    expect(nabalens).toEqual([...NABALENS_FIELDS_NOW])
    expect(MIGRATION).toContain(
      "when p_field in ('identity', 'photos') then 'nabalens'"
    )
    expect(MIGRATION).toContain(
      "if p_authority = 'nabalens' and p_field not in ('identity', 'photos') then"
    )
  })

  it("re-creates no existing function and touches no catalogue, photo or credit row", () => {
    expect(MIGRATION).not.toMatch(/create or replace function/i)
    expect(MIGRATION).not.toMatch(
      /function\s+private\.monthly_venue_completion_counts/
    )
    expect(MIGRATION).not.toMatch(
      /(insert into|update|delete from)\s+public\.(menu_items|menu_variants|menu_versions|menu_entries|menu_entry_variants|menu_item_photos|media_label_items)\b/i
    )
    expect(MIGRATION).not.toMatch(
      /alter table public\.(menu_|media_|venues)(?!sources|source_|field_|crosswalk)/
    )
  })
})

// ---------------------------------------------------------------------------
// Server functions (fake actor; the database decides roles for real)
// ---------------------------------------------------------------------------

function actor(
  role: "admin" | "manager" | "staff",
  rpcResult: { data: unknown; error: unknown }
) {
  const rpc = vi.fn(async () => rpcResult)
  return {
    rpc,
    actor: {
      profile: {
        id: id(77),
        role,
        active: true,
        venueId: null,
        displayName: "TEST",
      },
      db: { rpc },
      service: {},
      storage: {},
    } as unknown as MediaActor,
  }
}
const KEY = id(500)

describe("server functions", () => {
  it("refuses non-admin writes before calling the database", async () => {
    for (const role of ["manager", "staff"] as const) {
      const { rpc, actor: a } = actor(role, { data: null, error: null })
      const results = await Promise.all([
        declareMenuSource(a, {
          venueId: id(1),
          kind: "venue_website",
          label: "x",
          locator: null,
          requestKey: KEY,
        }),
        setMenuFieldAuthority(a, {
          venueId: id(1),
          field: "price",
          channel: "all",
          authority: "venue_website",
          sourceId: id(2),
          reason: "x",
          requestKey: KEY,
        }),
        decideMenuCrosswalk(a, {
          rowId: id(3),
          expectedRevision: 1,
          decision: { status: "rejected" },
          reason: null,
          requestKey: KEY,
        }),
      ])
      for (const r of results)
        expect(r).toMatchObject({ ok: false, status: 403 })
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it("checks a snapshot with the database's rules first", async () => {
    const { rpc, actor: a } = actor("admin", { data: null, error: null })
    const r = await recordMenuSnapshot(a, {
      sourceId: id(1),
      revision: "abc123",
      sha256: "a".repeat(64),
      capturedAt: null,
      entries: [
        { locator: "x", name: "A" },
        { locator: "x", name: "B" },
      ],
      requestKey: KEY,
    })
    expect(r).toEqual({
      ok: false,
      status: 400,
      message: "The snapshot is invalid. [1].locator: Duplicate locator",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("passes a confirmation through and maps conflicts", async () => {
    const { rpc, actor: a } = actor("admin", {
      data: null,
      error: { message: "crosswalk_conflict", code: "P0001" },
    })
    const r = await decideMenuCrosswalk(a, {
      rowId: id(3),
      expectedRevision: 2,
      decision: {
        status: "confirmed",
        itemId: KORMA,
        variantId: null,
        channel: "takeaway",
      },
      reason: "  same dish  ",
      requestKey: KEY,
    })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(rpc).toHaveBeenCalledWith("menu_crosswalk_decide", {
      p_row: id(3),
      p_expected: 2,
      p_status: "confirmed",
      p_item: KORMA,
      p_variant: null,
      p_channel: "takeaway",
      p_reason: "same dish",
      p_request_key: KEY,
    })
  })

  it("maps database codes to plain messages", () => {
    expect(
      crosswalkRpcFailure(
        { message: "authority_switch_not_enabled", code: "P0001" },
        "t"
      )
    ).toMatchObject({
      status: 409,
    })
    expect(
      crosswalkRpcFailure({ message: "crosswalk_stale", code: "40001" }, "t")
        .status
    ).toBe(409)
    expect(
      crosswalkRpcFailure({ message: "not_venue_manager", code: "42501" }, "t")
        .status
    ).toBe(403)
    expect(
      crosswalkRpcFailure(
        {
          message: "invalid_snapshot_document",
          code: "22023",
          details: JSON.stringify({
            path: "[3].name",
            message: "1 to 120 characters, no outer spaces",
          }),
        },
        "t"
      )
    ).toEqual({
      ok: false,
      status: 400,
      message:
        "The snapshot is invalid. [3].name: 1 to 120 characters, no outer spaces",
    })
    expect(
      crosswalkRpcFailure(
        { message: "menu_item_wrong_venue", code: "P0001" },
        "t"
      ).status
    ).toBe(400)
  })

  it("lets the database decide manifest access and checks the shape", async () => {
    const manifest = {
      schema: "1.0",
      venueId: id(1),
      fields: [],
      sources: [],
      entries: [],
    }
    const { actor: manager } = actor("manager", { data: manifest, error: null })
    expect(await readMenuManifest(manager, id(1))).toEqual({
      ok: true,
      manifest,
    })
    const { actor: other } = actor("manager", {
      data: { ...manifest, venueId: id(2) },
      error: null,
    })
    expect((await readMenuManifest(other, id(1))).ok).toBe(false)
  })
})
