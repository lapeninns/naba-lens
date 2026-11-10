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
  CROSSWALK_LOCATOR_MAX,
  CROSSWALK_REVIEW_STATUSES,
  CROSSWALK_STATUSES,
  DEFAULT_FIELD_AUTHORITY,
  FIELD_AUTHORITIES,
  MANIFEST_REVIEW_LIMIT,
  MENU_CHANNELS,
  MENU_FIELDS,
  MENU_SOURCE_KINDS,
  NABALENS_FIELDS_NOW,
  contentHashInput,
  crosswalkDecisionError,
  crosswalkProvenanceError,
  manifestCsv,
  manifestOutcome,
  proposeCrosswalk,
  snapshotDocumentError,
  variantLocators,
  websiteLocators,
  type CatalogueEntry,
  type CrosswalkHead,
  type CrosswalkRow,
  type CrosswalkRowsCursor,
  type CurrentSnapshot,
  type MenuManifest,
  type ProposeInput,
  type SnapshotEntry,
} from "../../lib/menus/trading/crosswalk"
import {
  crosswalkRpcFailure,
  declareMenuSource,
  decideMenuCrosswalk,
  listMenuCrosswalkRows,
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

const byLocator = <T extends { locator: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.locator, r])) as Record<string, T>

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
    // The entry is no longer mapped, so its mapped variant goes back to review,
    // on the new snapshot's evidence.
    expect(rows[`${korma.locator}#variant=Chicken`]).toMatchObject({
      status: "needs_review",
      variantId: KORMA_CHICKEN,
      candidates: [KORMA_CHICKEN],
      contentHash: rows[korma.locator].contentHash,
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

  it("marks a removed variant not_on_source even while its entry awaits review", async () => {
    const heads = await confirmedBase()
    // The variant list changed, so the entry needs review; the variant the
    // source no longer lists is off the source, not back in review.
    const changed = proposeCrosswalk(
      await input([chips, { ...korma, variants: [] }, gone], {
        snapshotId: S2,
        heads,
      })
    )
    expect(byLocator(changed.rows)[korma.locator]).toMatchObject({
      status: "needs_review",
    })
    expect(
      byLocator(changed.rows)[`${korma.locator}#variant=Chicken`]
    ).toMatchObject({
      status: "not_on_source",
      variantId: KORMA_CHICKEN,
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

const S3 = id(903)
const confirmTo = (itemId: string, variantId: string | null = null) =>
  ({ status: "confirmed", itemId, variantId, channel: "all" }) as const
const variantOf = (v: string) =>
  ({
    [KORMA_CHICKEN]: KORMA,
    [KORMA_LAMB]: KORMA,
    [TIKKA_CHICKEN]: TIKKA_MAINS,
  })[v] ?? null
async function snapshotOf(
  entries: SnapshotEntry[],
  processed = true
): Promise<CurrentSnapshot> {
  return {
    processed,
    entries,
    contentHashes: await Promise.all(
      entries.map((e) => sha256Hex(contentHashInput(e)))
    ),
  }
}

describe("decision provenance: only current source evidence is decided", () => {
  const chips: SnapshotEntry = {
    locator: "sides.json#name=Chips",
    name: "Chips",
    priceText: "3.5",
  }

  async function confirmedOnS1() {
    const s1 = proposeCrosswalk(await input([chips]))
    return headsAfter(s1.rows, S1, { [chips.locator]: { itemId: CHIPS } })
  }

  it("refuses to confirm (or decide) a tombstone, and the S2 matcher run again leaves it removed", async () => {
    const heads = await confirmedOnS1()
    const s2 = proposeCrosswalk(await input([], { snapshotId: S2, heads }))
    expect(s2.rows).toMatchObject([
      { locator: chips.locator, status: "not_on_source", itemId: CHIPS },
    ])
    const after = headsAfter(s2.rows, S2, {}, heads)
    const tomb = byLocator(after)[chips.locator]
    const current = await snapshotOf([])
    for (const decision of [
      confirmTo(CHIPS),
      { status: "rejected" as const },
      { status: "unmatched" as const },
    ]) {
      expect(
        crosswalkDecisionError(after, chips.locator, decision, variantOf)
      ).toBe("crosswalk_not_on_source")
      expect(crosswalkProvenanceError(tomb, decision, current)).toBe(
        "crosswalk_not_on_source"
      )
    }
    // Retrying the S2 matcher after the refused decision changes nothing.
    expect(
      proposeCrosswalk(await input([], { snapshotId: S2, heads: after }))
    ).toEqual({ rows: [], skipped: 0 })
    // A mapped head the snapshot does not list is removed whichever snapshot
    // wrote it (the head the old decide path could leave stamped S2).
    const forged = after.map((h) =>
      h.locator === chips.locator ? { ...h, status: "confirmed" as const } : h
    )
    expect(
      proposeCrosswalk(await input([], { snapshotId: S2, heads: forged })).rows
    ).toMatchObject([{ locator: chips.locator, status: "not_on_source" }])
  })

  it("refuses every decision while a newer snapshot awaits the matcher", async () => {
    const s1 = proposeCrosswalk(await input([chips]))
    const proposed = byLocator(headsAfter(s1.rows, S1))[chips.locator]
    // S2 is recorded (without Chips) but the matcher has not run on it.
    const pending = await snapshotOf([], false)
    for (const decision of [
      confirmTo(CHIPS),
      { status: "rejected" as const },
      { status: "unmatched" as const },
    ])
      expect(crosswalkProvenanceError(proposed, decision, pending)).toBe(
        "crosswalk_reconcile_pending"
      )
    // Even when S2 still lists it unchanged.
    expect(
      crosswalkProvenanceError(
        proposed,
        confirmTo(CHIPS),
        await snapshotOf([chips], false)
      )
    ).toBe("crosswalk_reconcile_pending")
    // Once the matcher has run on S2 the row decides on S2's evidence.
    expect(
      crosswalkProvenanceError(
        proposed,
        confirmTo(CHIPS),
        await snapshotOf([chips])
      )
    ).toBeNull()
  })

  it("confirms only the listed content; rejects on presence alone", async () => {
    const s1 = proposeCrosswalk(await input([chips]))
    const proposed = byLocator(headsAfter(s1.rows, S1))[chips.locator]
    const changed = await snapshotOf([{ ...chips, priceText: "4" }])
    expect(crosswalkProvenanceError(proposed, confirmTo(CHIPS), changed)).toBe(
      "crosswalk_not_on_source"
    )
    expect(
      crosswalkProvenanceError(proposed, { status: "rejected" }, changed)
    ).toBeNull()
  })

  it("checks a variant occurrence, not just its entry", async () => {
    const entry: SnapshotEntry = {
      locator: "k",
      name: "Korma",
      variants: ["Chicken"],
    }
    const head = {
      locator: "k#variant=Lamb",
      entryLocator: "k",
      status: "proposed" as const,
      contentHash: (await snapshotOf([entry])).contentHashes[0],
    }
    expect(
      crosswalkProvenanceError(
        head,
        { status: "rejected" },
        await snapshotOf([entry])
      )
    ).toBe("crosswalk_not_on_source")
    expect(
      crosswalkProvenanceError(
        { ...head, locator: "k#variant=Chicken" },
        confirmTo(KORMA, KORMA_CHICKEN),
        await snapshotOf([entry])
      )
    ).toBeNull()
  })
})

describe("variant transitions: retained, removed and remapped", () => {
  const korma: SnapshotEntry = {
    locator: "curries.json#name=Korma",
    name: "Korma",
    variants: ["Chicken", "Lamb"],
    priceText: "10.5",
  }
  const chickenAt = `${korma.locator}#variant=Chicken`
  const lambAt = `${korma.locator}#variant=Lamb`

  /** Korma confirmed on S1 with both variants confirmed. */
  async function mapped() {
    const first = proposeCrosswalk(await input([korma]))
    const heads = headsAfter(first.rows, S1, {
      [korma.locator]: { itemId: KORMA },
    })
    const variants = proposeCrosswalk(await input([korma], { heads }))
    return headsAfter(
      variants.rows,
      S1,
      {
        [chickenAt]: { variantId: KORMA_CHICKEN },
        [lambAt]: { variantId: KORMA_LAMB },
      },
      heads
    )
  }

  it("re-reviews a retained variant on new evidence and removes a dropped one while the entry is pending", async () => {
    const heads = await mapped()
    const next: SnapshotEntry = {
      ...korma,
      variants: ["Chicken"],
      priceText: "11",
    }
    const s2 = proposeCrosswalk(await input([next], { snapshotId: S2, heads }))
    const rows = byLocator(s2.rows)
    expect(rows[korma.locator]).toMatchObject({ status: "needs_review" })
    expect(rows[chickenAt]).toMatchObject({
      status: "needs_review",
      itemId: KORMA,
      variantId: KORMA_CHICKEN,
      candidates: [KORMA_CHICKEN],
      contentHash: rows[korma.locator].contentHash,
    })
    expect(rows[lambAt]).toMatchObject({
      status: "not_on_source",
      variantId: KORMA_LAMB,
    })

    // The entry is reconfirmed on S2 and the matcher runs again: the retained
    // variant stays in review (current), the removed one stays removed.
    const after = headsAfter(
      s2.rows,
      S2,
      { [korma.locator]: { itemId: KORMA } },
      heads
    )
    expect(
      proposeCrosswalk(await input([next], { snapshotId: S2, heads: after }))
    ).toEqual({ rows: [], skipped: 2 })
    const current = await snapshotOf([next])
    const at = byLocator(after)
    expect(
      crosswalkProvenanceError(
        at[chickenAt],
        confirmTo(KORMA, KORMA_CHICKEN),
        current
      )
    ).toBeNull()
    expect(
      crosswalkDecisionError(
        after,
        chickenAt,
        confirmTo(KORMA, KORMA_CHICKEN),
        variantOf
      )
    ).toBeNull()
    expect(
      crosswalkProvenanceError(
        at[lambAt],
        confirmTo(KORMA, KORMA_LAMB),
        current
      )
    ).toBe("crosswalk_not_on_source")
  })

  it("puts a variant back in review when it reappears while its entry is pending", async () => {
    const heads = await mapped()
    const s2 = proposeCrosswalk(
      await input([{ ...korma, variants: ["Chicken"] }], {
        snapshotId: S2,
        heads,
      })
    )
    const h2 = headsAfter(s2.rows, S2, {}, heads)
    expect(byLocator(h2)[lambAt].status).toBe("not_on_source")
    const s3 = proposeCrosswalk(
      await input([korma], { snapshotId: S3, heads: h2 })
    )
    expect(byLocator(s3.rows)[lambAt]).toMatchObject({
      status: "needs_review",
      variantId: KORMA_LAMB,
      candidates: [KORMA_LAMB],
    })
    // Chicken is open already (needs review from S2) and is not re-proposed
    // until its entry is mapped again.
    expect(byLocator(s3.rows)[chickenAt]).toBeUndefined()
    const h3 = headsAfter(
      s3.rows,
      S3,
      { [korma.locator]: { itemId: KORMA } },
      h2
    )
    const again = proposeCrosswalk(
      await input([korma], { snapshotId: S3, heads: h3 })
    )
    expect(again.rows).toMatchObject([
      {
        locator: chickenAt,
        status: "proposed",
        variantId: KORMA_CHICKEN,
        contentHash: byLocator(s3.rows)[korma.locator].contentHash,
      },
    ])
  })

  it("re-proposes variant rows inside the item an entry is mapped to again in the same snapshot", async () => {
    const first = proposeCrosswalk(await input([korma]))
    let heads = headsAfter(first.rows, S1, {
      [korma.locator]: { itemId: KORMA },
    })
    const variants = proposeCrosswalk(await input([korma], { heads }))
    expect(byLocator(variants.rows)[chickenAt]).toMatchObject({
      itemId: KORMA,
      variantId: KORMA_CHICKEN,
    })
    heads = headsAfter(variants.rows, S1, {}, heads)
    // The reviewer rejects the entry, then confirms it to another dish.
    heads = headsAfter(
      [],
      S1,
      { [korma.locator]: { status: "rejected" } },
      heads
    )
    heads = headsAfter(
      [],
      S1,
      { [korma.locator]: { itemId: TIKKA_MAINS } },
      heads
    )
    const again = proposeCrosswalk(await input([korma], { heads }))
    expect(again.skipped).toBe(1)
    const rows = byLocator(again.rows)
    expect(Object.keys(rows)).toEqual([chickenAt, lambAt])
    expect(rows[chickenAt]).toMatchObject({
      status: "proposed",
      itemId: TIKKA_MAINS,
      variantId: TIKKA_CHICKEN,
      candidates: [TIKKA_CHICKEN],
    })
    expect(rows[lambAt]).toMatchObject({
      status: "proposed",
      itemId: TIKKA_MAINS,
      variantId: null,
      candidates: [],
    })
    expect(again.rows.flatMap((r) => r.candidates)).not.toContain(KORMA_CHICKEN)
    expect(
      proposeCrosswalk(
        await input([korma], { heads: headsAfter(again.rows, S1, {}, heads) })
      )
    ).toEqual({ rows: [], skipped: 3 })
  })

  it("keeps a variant decision under the same item and re-proposes it under another", async () => {
    const first = proposeCrosswalk(await input([korma]))
    let heads = headsAfter(first.rows, S1, {
      [korma.locator]: { itemId: KORMA },
    })
    const variants = proposeCrosswalk(await input([korma], { heads }))
    // Lamb marked unmatched on S1: the row keeps the item it was matched inside.
    heads = headsAfter(
      variants.rows,
      S1,
      { [lambAt]: { status: "unmatched", variantId: null } },
      heads
    )
    const s2 = proposeCrosswalk(await input([korma], { snapshotId: S2, heads }))
    expect(byLocator(s2.rows)[korma.locator]).toMatchObject({
      status: "carried",
    })
    expect(byLocator(s2.rows)[lambAt]).toBeUndefined()
    heads = headsAfter(s2.rows, S2, {}, heads)
    // The entry is mapped to another dish (rejected, then confirmed) on S2.
    heads = headsAfter(
      [],
      S2,
      { [korma.locator]: { itemId: TIKKA_MAINS } },
      heads
    )
    expect(
      byLocator(
        proposeCrosswalk(await input([korma], { snapshotId: S2, heads })).rows
      )[lambAt]
    ).toMatchObject({ status: "proposed", itemId: TIKKA_MAINS })
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

  it("keeps repeats and literal #2 suffixes apart", () => {
    const names = ["Dish", "Dish", "Dish#2"]
    const entries = websiteLocators(
      names.map((name) => ({ file: "f.json", name }))
    )
    expect(entries).toEqual([
      "f.json#name=Dish",
      "f.json#name=Dish#2",
      "f.json#name=Dish%232",
    ])
    // A snapshot generated from them passes the duplicate check.
    expect(
      snapshotDocumentError(
        entries.map((locator, i) => ({ locator, name: names[i] }))
      )
    ).toBeNull()
    expect(
      variantLocators({
        locator: "l",
        name: "K",
        variants: ["Regular", "Regular", "Regular#2"],
      })
    ).toEqual([
      "l#variant=Regular",
      "l#variant=Regular#2",
      "l#variant=Regular%232",
    ])
  })

  it("encodes delimiter and escape characters in files, categories and names", () => {
    const sources = [
      { file: "m.json", category: "Mains#name=Pie", name: "X" },
      { file: "m.json", category: "Mains", name: "Pie#name=X" },
      { file: "m.json", category: "Mains", name: "Pie%23name=X" },
      { file: "m.json#category=Mains", name: "Pie" },
      { file: "m.json", category: "Mains", name: "Pie" },
      { file: "m.json", name: "A#variant=B" },
      { file: "m.json", name: "100% Beef" },
    ]
    const got = websiteLocators(sources)
    expect(new Set(got).size).toBe(sources.length)
    expect(got.slice(0, 3)).toEqual([
      "m.json#category=Mains%23name=Pie#name=X",
      "m.json#category=Mains#name=Pie%23name=X",
      "m.json#category=Mains#name=Pie%2523name=X",
    ])
    expect(got.filter((l) => l.includes("#variant="))).toEqual([])
    expect(
      snapshotDocumentError(got.map((locator) => ({ locator, name: "N" })))
    ).toBeNull()
    const variants = variantLocators({
      locator: "e",
      name: "N",
      variants: ["a#2", "a", "a", "a%232", "#", "%"],
    })
    expect(variants).toEqual([
      "e#variant=a%232",
      "e#variant=a",
      "e#variant=a#2",
      "e#variant=a%25232",
      "e#variant=%23",
      "e#variant=%25",
    ])
    expect(new Set(variants).size).toBe(variants.length)
  })

  it("bounds the longest variant locator as the migration does", () => {
    const worst: SnapshotEntry = {
      locator: "x".repeat(300),
      name: "N",
      variants: Array(12).fill("#".repeat(80)),
    }
    expect(snapshotDocumentError([worst])).toBeNull()
    const lengths = variantLocators(worst).map((l) => [...l].length)
    expect(Math.max(...lengths)).toBe(CROSSWALK_LOCATOR_MAX)
    expect(CROSSWALK_LOCATOR_MAX).toBe(552)
    expect(MIGRATION).toContain(
      `locator text not null check (length(locator) between 1 and ${CROSSWALK_LOCATOR_MAX})`
    )
    expect(MIGRATION).toContain(
      "select replace(replace(p_text, '%', '%25'), '#', '%23');"
    )
  })

  it("proposes every listed variant once, literal suffixes included", async () => {
    const entry: SnapshotEntry = {
      locator: "curries.json#name=Korma",
      name: "Korma",
      variants: ["Chicken", "Chicken", "Chicken#2"],
    }
    const first = proposeCrosswalk(await input([entry]))
    const heads = headsAfter(first.rows, S1, {
      [entry.locator]: { itemId: KORMA },
    })
    const { rows } = proposeCrosswalk(await input([entry], { heads }))
    expect(rows.map((r) => [r.locator, r.status, r.variantId])).toEqual([
      ["curries.json#name=Korma#variant=Chicken", "proposed", KORMA_CHICKEN],
      ["curries.json#name=Korma#variant=Chicken#2", "ambiguous", null],
      ["curries.json#name=Korma#variant=Chicken%232", "proposed", null],
    ])
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

  it("reviews the same statuses and page sizes as the manifest and rows reads", () => {
    const review = `array[${CROSSWALK_REVIEW_STATUSES.map((s) => `'${s}'`).join(", ")}]`
    expect(MIGRATION).toContain(review)
    expect(MIGRATION).toContain(
      `where v_admin and h.status in (${CROSSWALK_REVIEW_STATUSES.map((s) => `'${s}'`).join(", ")})`
    )
    expect(MIGRATION).toContain(`limit ${MANIFEST_REVIEW_LIMIT}`)
    expect(MIGRATION).toContain(
      "v_limit integer := greatest(1, least(coalesce(p_limit, 100), 1000));"
    )
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
        listMenuCrosswalkRows(a, { venueId: id(1) }),
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
    for (const [message, status] of [
      ["crosswalk_reconcile_pending", 409],
      ["crosswalk_not_on_source", 409],
      ["invalid_crosswalk_cursor", 400],
    ] as const) {
      const failure = crosswalkRpcFailure({ message, code: "P0001" }, "t")
      expect(failure.status, message).toBe(status)
      expect(failure.message, message).not.toContain("_")
    }
  })

  it("checks a rows request before calling the database and passes the cursor through", async () => {
    const { rpc, actor: a } = actor("admin", {
      data: { venueId: id(1), rows: [], next: null },
      error: null,
    })
    for (const bad of [
      { venueId: "x" },
      { venueId: id(1), statuses: [] },
      { venueId: id(1), statuses: ["confirmed", "deleted"] },
      { venueId: id(1), sourceId: "x" },
      { venueId: id(1), itemId: "x" },
      { venueId: id(1), after: { sourceId: id(2), locator: "" } },
      { venueId: id(1), after: { sourceId: "x", locator: "a" } },
      { venueId: id(1), limit: 0 },
      { venueId: id(1), limit: 1001 },
      { venueId: id(1), limit: 2.5 },
    ])
      expect(
        (
          await listMenuCrosswalkRows(
            a,
            bad as Parameters<typeof listMenuCrosswalkRows>[1]
          )
        ).ok,
        JSON.stringify(bad)
      ).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
    expect(
      await listMenuCrosswalkRows(a, {
        venueId: id(1),
        statuses: ["confirmed", "carried"],
        itemId: CHIPS,
        after: { sourceId: id(2), locator: "a#name=B" },
        limit: 50,
      })
    ).toEqual({ ok: true, rows: [], next: null })
    expect(rpc).toHaveBeenCalledWith("menu_crosswalk_rows", {
      p_venue: id(1),
      p_statuses: ["confirmed", "carried"],
      p_source: null,
      p_item: CHIPS,
      p_after_source: id(2),
      p_after_locator: "a#name=B",
      p_limit: 50,
    })
    const { actor: wrong } = actor("admin", {
      data: { venueId: id(2), rows: [], next: null },
      error: null,
    })
    expect((await listMenuCrosswalkRows(wrong, { venueId: id(1) })).ok).toBe(
      false
    )
  })

  /**
   * A stand-in for the database's rows in force: menu_crosswalk_rows ordered
   * by (source order, locator), with the cursor and page size, and
   * menu_crosswalk_decide's row id / revision compare-and-set and
   * one-identity rule. The SQL itself is covered by the security suite.
   */
  function fakeCrosswalk(
    initial: (Pick<CrosswalkRow, "sourceId" | "locator" | "status"> & {
      itemId?: string | null
    })[]
  ) {
    const order = [...new Set(initial.map((r) => r.sourceId))]
    let next = 0
    const rows = new Map<string, CrosswalkRow>(
      initial.map((r) => [
        `${r.sourceId} ${r.locator}`,
        {
          rowId: id(1000 + next++),
          revision: 1,
          entryLocator: null,
          basis: "name_candidate",
          variantId: null,
          channel: "all",
          candidates: [],
          evidence: {},
          proposedAt: "2026-11-10T00:00:00Z",
          reviewedBy: null,
          reviewedAt: null,
          reason: null,
          itemId: null,
          ...r,
        },
      ])
    )
    const sorted = () =>
      [...rows.values()].sort(
        (x, y) =>
          order.indexOf(x.sourceId) - order.indexOf(y.sourceId) ||
          (x.locator < y.locator ? -1 : x.locator > y.locator ? 1 : 0)
      )
    const calls: Record<string, unknown>[] = []
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, ...args })
      if (fn === "menu_crosswalk_rows") {
        const statuses = (args.p_statuses as string[] | null) ?? [
          ...CROSSWALK_REVIEW_STATUSES,
        ]
        const limit = (args.p_limit as number | null) ?? 100
        let list = sorted().filter((r) => statuses.includes(r.status))
        if (args.p_after_source) {
          const at = list.findIndex(
            (r) =>
              r.sourceId === args.p_after_source &&
              r.locator === args.p_after_locator
          )
          list = list.slice(at + 1)
        }
        const page = list.slice(0, limit)
        return {
          data: {
            venueId: args.p_venue,
            rows: page,
            next:
              list.length > limit
                ? {
                    sourceId: page[limit - 1].sourceId,
                    locator: page[limit - 1].locator,
                  }
                : null,
          },
          error: null,
        }
      }
      // menu_crosswalk_decide
      const head = [...rows.values()].find((r) => r.rowId === args.p_row)
      if (!head || head.revision !== args.p_expected)
        return { data: null, error: { message: "crosswalk_stale" } }
      if (
        args.p_status === "confirmed" &&
        (head.status === "confirmed" || head.status === "carried") &&
        head.itemId !== args.p_item
      )
        return { data: null, error: { message: "crosswalk_conflict" } }
      head.rowId = id(1000 + next++)
      head.revision += 1
      head.status = args.p_status as CrosswalkRow["status"]
      head.itemId =
        args.p_status === "confirmed" ? (args.p_item as string) : head.itemId
      return {
        data: {
          rowId: head.rowId,
          status: head.status,
          revision: head.revision,
          replayed: false,
        },
        error: null,
      }
    })
    const fresh = () =>
      ({
        profile: {
          id: id(77),
          role: "admin",
          active: true,
          venueId: null,
          displayName: "TEST",
        },
        db: { rpc },
        service: {},
        storage: {},
      }) as unknown as MediaActor
    return { fresh, calls }
  }

  it("lets a reviewer find, reject and reconfirm a current mapping after a reload", async () => {
    const db = fakeCrosswalk([
      {
        sourceId: S1,
        locator: "sides.json#name=Chips",
        status: "confirmed",
        itemId: CHIPS,
      },
      { sourceId: S1, locator: "sides.json#name=Rice", status: "proposed" },
    ])
    // A new request: the review list does not show the confirmed row.
    const review = await listMenuCrosswalkRows(db.fresh(), { venueId: id(1) })
    expect(review.ok && review.rows.map((r) => r.locator)).toEqual([
      "sides.json#name=Rice",
    ])
    const mapped = await listMenuCrosswalkRows(db.fresh(), {
      venueId: id(1),
      statuses: ["confirmed", "carried"],
      itemId: CHIPS,
    })
    if (!mapped.ok) throw new Error(mapped.message)
    const [row] = mapped.rows
    expect(row).toMatchObject({ status: "confirmed", itemId: CHIPS })
    const decide = (
      rowId: string,
      expectedRevision: number,
      decision: Parameters<typeof decideMenuCrosswalk>[1]["decision"]
    ) =>
      decideMenuCrosswalk(db.fresh(), {
        rowId,
        expectedRevision,
        decision,
        reason: null,
        requestKey: id(600 + db.calls.length),
      })
    expect(
      await decide(row.rowId, row.revision, confirmTo(KORMA))
    ).toMatchObject({ ok: false, status: 409 })
    const rejected = await decide(row.rowId, row.revision, {
      status: "rejected",
    })
    if (!rejected.ok) throw new Error(rejected.message)
    expect(
      await decide(rejected.rowId, rejected.revision, confirmTo(KORMA))
    ).toMatchObject({ ok: true, status: "confirmed", revision: 3 })
    const now = await listMenuCrosswalkRows(db.fresh(), {
      venueId: id(1),
      statuses: ["confirmed"],
    })
    expect(now.ok && now.rows.map((r) => [r.locator, r.itemId])).toEqual([
      ["sides.json#name=Chips", KORMA],
    ])
  })

  it("pages the whole review queue past retained removed rows", async () => {
    const db = fakeCrosswalk([
      ...["a", "b", "c", "d", "e"].map((l) => ({
        sourceId: S1,
        locator: `gone#${l}`,
        status: "not_on_source" as const,
      })),
      { sourceId: S1, locator: "open#a", status: "proposed" },
      { sourceId: S1, locator: "kept#a", status: "confirmed", itemId: CHIPS },
      { sourceId: S2, locator: "gone#a", status: "not_on_source" },
      { sourceId: S2, locator: "open#b", status: "needs_review" },
    ])
    const seen: string[] = []
    let after: CrosswalkRowsCursor | null = null
    let pages = 0
    do {
      const page = await listMenuCrosswalkRows(db.fresh(), {
        venueId: id(1),
        after,
        limit: 2,
      })
      if (!page.ok) throw new Error(page.message)
      seen.push(...page.rows.map((r) => `${r.sourceId} ${r.locator}`))
      after = page.next
      pages++
    } while (after && pages < 10)
    expect(pages).toBe(4)
    expect(seen).toEqual([
      `${S1} gone#a`,
      `${S1} gone#b`,
      `${S1} gone#c`,
      `${S1} gone#d`,
      `${S1} gone#e`,
      `${S1} open#a`,
      `${S2} gone#a`,
      `${S2} open#b`,
    ])
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
