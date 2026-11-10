// B04-a database contract (b04-design §4.2, §4.6, §10, §19.2 S1): menu
// sources, snapshots, field authority and the reviewed crosswalk. Roles and
// venue isolation, uniqueness, same-name ambiguity, variants inside their
// confirmed item, carry by locator and hash, immutable provenance, inert
// authority switches, an untouched credit function, and TS/SQL parity of the
// matcher (lib/menus/trading/crosswalk.ts). Every assertion runs as a real
// signed-in identity; psql (postgres, local only) reads state back and tries
// direct writes. All menus and prices are synthetic.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { sha256Hex } from "../../lib/menus/import"
import {
  CROSSWALK_LOCATOR_BYTES_MAX,
  CROSSWALK_LOCATOR_MAX,
  DEFAULT_FIELD_AUTHORITY,
  MENU_FIELDS,
  SNAPSHOT_LIMITS,
  contentHashInput,
  proposeCrosswalk,
  snapshotDocumentError,
  variantLocators,
  websiteLocators,
  type CatalogueEntry,
  type CrosswalkHead,
  type SnapshotEntry,
} from "../../lib/menus/trading/crosswalk"
import { nameKey } from "../../lib/menus/import/matching"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { makeManager, psql } from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  section,
} from "./menus-fixtures"

type RpcError = { code: string; message: string; details?: string }
type Rpc = {
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: RpcError | null }>
}
const service = serviceClient()
const rpc = (
  who: TestIdentity,
  fn: string,
  args: Record<string, unknown> = {}
) => (who.client as unknown as Rpc).rpc(fn, args)

async function ok<T = Record<string, unknown>>(
  call: PromiseLike<{ data: unknown; error: RpcError | null }>
): Promise<T> {
  const { data, error } = await call
  if (error)
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  return data as T
}
async function fails(
  call: PromiseLike<{ data: unknown; error: RpcError | null }>,
  message: string,
  code?: string
) {
  const { error } = await call
  expect(error, `expected ${message}`).not.toBeNull()
  expect(error!.message).toBe(message)
  if (code) expect(error!.code).toBe(code)
  return error!
}

/** Rows of a query as JSON (psql, local DB only). */
function rows<T = Record<string, unknown>>(sql: string): T[] {
  return JSON.parse(
    psql(`select coalesce(json_agg(t), '[]') from (${sql}) t`)
  ) as T[]
}
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`

let venueA: string
let venueB: string
let admin: TestIdentity
let otherAdmin: TestIdentity
let inactiveAdmin: TestIdentity
let managerA: TestIdentity
let staffA: TestIdentity
let staffB: TestIdentity
let anon: TestIdentity
let versionA: string
let docA: Awaited<ReturnType<typeof readDocument>>
let docB: Awaited<ReturnType<typeof readDocument>>

beforeAll(async () => {
  venueA = (await createVenue(service, "crosswalk-a")).id
  venueB = (await createVenue(service, "crosswalk-b")).id
  admin = await createIdentity(service, { label: "cw-admin", role: "admin" })
  otherAdmin = await createIdentity(service, {
    label: "cw-admin-2",
    role: "admin",
  })
  inactiveAdmin = await createIdentity(service, {
    label: "cw-admin-off",
    role: "admin",
    active: false,
  })
  staffA = await createIdentity(service, {
    label: "cw-staff-a",
    role: "staff",
    venueId: venueA,
  })
  staffB = await createIdentity(service, {
    label: "cw-staff-b",
    role: "staff",
    venueId: venueB,
  })
  managerA = await createIdentity(service, {
    label: "cw-mgr-a",
    role: "staff",
    venueId: venueA,
  })
  await makeManager(admin, managerA, venueA)
  anon = await createIdentity(service, {
    label: "cw-anon",
    role: "staff",
    profile: false,
  })

  versionA = await publishMenu(
    admin,
    venueA,
    menu("TEST crosswalk A", [
      section("starters", "Starters", [
        item("starters--chicken-tikka", "Chicken Tikka"),
      ]),
      section("mains", "Mains", [
        item("mains--chicken-tikka", "Chicken Tikka", {
          variants: ["Chicken"],
        }),
        item("mains--korma", "Korma", {
          variants: ["Chicken", "Lamb"],
          aliases: ["Kurma"],
        }),
      ]),
      section("sides", "Sides", [
        item("sides--chips", "Chips"),
        item("sides--rice", "Rice"),
      ]),
    ])
  )
  docA = await readDocument(service, versionA)
  docB = await readDocument(
    service,
    await publishMenu(
      admin,
      venueB,
      menu("TEST crosswalk B", [
        section("sides", "Sides", [item("sides--chips", "Chips")]),
      ])
    )
  )
})

const A = (key: string) => docA.byKey[key]!

async function declare(
  venueId: string,
  kind: string,
  label: string,
  who = admin
) {
  const r = await ok<{ sourceId: string }>(
    rpc(who, "menu_declare_source", {
      p_venue: venueId,
      p_kind: kind,
      p_label: label,
      p_locator: null,
      p_request_key: randomUUID(),
    })
  )
  return r.sourceId
}

async function snapshot(
  sourceId: string,
  revision: string,
  entries: SnapshotEntry[]
) {
  const r = await ok<{ snapshotId: string }>(
    rpc(admin, "menu_record_snapshot", {
      p_source: sourceId,
      p_revision: revision,
      p_sha256: await sha256Hex(JSON.stringify(entries)),
      p_captured_at: null,
      p_document: entries,
      p_request_key: randomUUID(),
    })
  )
  return r.snapshotId
}

const propose = (snapshotId: string, who = admin) =>
  rpc(who, "menu_crosswalk_propose", {
    p_snapshot: snapshotId,
    p_request_key: randomUUID(),
  })

type Head = {
  locator: string
  entry_locator: string | null
  status: string
  /** The basis of the head's row. */
  basis: string
  item_id: string | null
  variant_id: string | null
  channel: string
  content_hash: string
  snapshot_id: string
  candidates: string[]
  row_id: string
  revision: number
}
const heads = (sourceId: string) =>
  rows<Head>(`select h.*, r.basis from public.menu_crosswalk_heads h
    join public.menu_crosswalk r on r.id = h.row_id
    where h.source_id = ${literal(sourceId)} order by h.locator collate "C"`)
const headAt = (sourceId: string, locator: string) =>
  heads(sourceId).find((h) => h.locator === locator)!

function decide(
  head: Head,
  status: "confirmed" | "rejected" | "unmatched",
  opts: {
    item?: string
    variant?: string | null
    channel?: string
    who?: TestIdentity
  } = {}
) {
  return rpc(opts.who ?? admin, "menu_crosswalk_decide", {
    p_row: head.row_id,
    p_expected: head.revision,
    p_status: status,
    p_item: opts.item ?? null,
    p_variant: opts.variant ?? null,
    p_channel: opts.channel ?? "all",
    p_reason: null,
    p_request_key: randomUUID(),
  })
}

const manifest = (who: TestIdentity, venueId: string) =>
  rpc(who, "menu_manifest", { p_venue: venueId })

type Cursor = { sourceId: string; locator: string }
type Page = {
  rows: {
    rowId: string
    revision: number
    sourceId: string
    locator: string
    status: string
    itemId: string | null
    reviewedBy: string | null
  }[]
  next: Cursor | null
}
const listRows = (
  who: TestIdentity,
  venueId: string,
  opts: {
    statuses?: string[]
    source?: string
    item?: string
    after?: Cursor | null
    limit?: number
  } = {}
) =>
  rpc(who, "menu_crosswalk_rows", {
    p_venue: venueId,
    p_statuses: opts.statuses ?? null,
    p_source: opts.source ?? null,
    p_item: opts.item ?? null,
    p_after_source: opts.after?.sourceId ?? null,
    p_after_locator: opts.after?.locator ?? null,
    p_limit: opts.limit ?? null,
  })

/** A version read back as the TypeScript matcher's catalogue. */
const catalogueOf = (
  doc: Awaited<ReturnType<typeof readDocument>>
): CatalogueEntry[] =>
  doc.sections.flatMap((s) =>
    s.items.map((i) => ({
      itemId: i.itemId!,
      sourceKey: i.sourceKey,
      name: i.name,
      aliases: i.aliases,
      sectionName: s.name,
      variants: i.variants.map((v) => ({
        variantId: v.variantId!,
        name: v.name,
      })),
    }))
  )
/** Venue A's active version as the TypeScript matcher's catalogue. */
const catalogueA = () => catalogueOf(docA)

const asTsHeads = (list: Head[]): CrosswalkHead[] =>
  list.map((h) => ({
    locator: h.locator,
    entryLocator: h.entry_locator,
    status: h.status as CrosswalkHead["status"],
    basis: h.basis as CrosswalkHead["basis"],
    itemId: h.item_id,
    variantId: h.variant_id,
    channel: h.channel as CrosswalkHead["channel"],
    contentHash: h.content_hash,
    snapshotId: h.snapshot_id,
  }))

/** The rows one run wrote, in write order, as the matcher's rows. */
const rowsFrom = (sourceId: string, snapshotId: string, afterSeq: number) =>
  rows<Head>(`select r.locator, r.entry_locator, r.status, r.item_id, r.variant_id,
      r.channel, r.content_hash, r.candidates
    from public.menu_crosswalk r
    where r.source_id = ${literal(sourceId)} and r.snapshot_id = ${literal(snapshotId)}
      and r.seq > ${afterSeq}
    order by r.seq`).map((r) => [
    r.locator,
    r.status,
    r.item_id,
    r.variant_id,
    r.candidates,
    r.content_hash,
  ])
const lastSeq = () =>
  Number(psql("select coalesce(max(seq), 0) from public.menu_crosswalk"))

// ---------------------------------------------------------------------------

describe("roles and privileges (§10, OD-B4-2 default)", () => {
  it("lets only an active admin write", async () => {
    for (const who of [managerA, staffA, staffB, inactiveAdmin, anon]) {
      const { error } = await rpc(who, "menu_declare_source", {
        p_venue: venueA,
        p_kind: "venue_website",
        p_label: `TEST denied ${randomUUID()}`,
        p_locator: null,
        p_request_key: randomUUID(),
      })
      expect(error, who.email).not.toBeNull()
      expect([
        "not_active_admin",
        "permission denied for function menu_declare_source",
      ]).toContain(error!.message)
    }
    const source = await declare(
      venueA,
      "operator_document",
      `TEST roles ${randomUUID()}`
    )
    const snap = await snapshot(source, "r1", [
      { locator: "a#name=Chips", name: "Chips" },
    ])
    await fails(propose(snap, managerA), "not_active_admin", "42501")
    await ok(propose(snap))
    const [head] = heads(source)
    await fails(
      decide(head!, "unmatched", { who: managerA }),
      "not_active_admin",
      "42501"
    )
    await fails(
      decide(head!, "unmatched", { who: staffA }),
      "not_active_admin",
      "42501"
    )
    await fails(
      rpc(managerA, "menu_set_field_authority", {
        p_venue: venueA,
        p_field: "price",
        p_channel: "all",
        p_authority: "not_published",
        p_source: null,
        p_reason: "TEST",
        p_request_key: randomUUID(),
      }),
      "not_active_admin",
      "42501"
    )
  })

  it("gives the manifest to admins and the venue's manager only", async () => {
    await fails(manifest(staffA, venueA), "not_venue_manager", "42501")
    await fails(manifest(staffB, venueB), "not_venue_manager", "42501")
    await fails(manifest(managerA, venueB), "not_venue_manager", "42501")
    await fails(manifest(inactiveAdmin, venueA), "not_venue_manager", "42501")
    const { error } = await manifest(anon, venueA)
    expect(error).not.toBeNull()
    const m = await ok<{ view: string; review: unknown; venueId: string }>(
      manifest(managerA, venueA)
    )
    expect(m).toMatchObject({ view: "manager", review: null, venueId: venueA })
    expect((await ok<{ view: string }>(manifest(admin, venueA))).view).toBe(
      "admin"
    )
  })

  it("exposes no table to clients", async () => {
    for (const table of [
      "menu_sources",
      "menu_source_snapshots",
      "menu_field_authority",
      "menu_crosswalk",
      "menu_crosswalk_heads",
      "menu_source_commands",
      "menu_crosswalk_runs",
    ]) {
      const client = admin.client as unknown as {
        from(t: string): {
          select(c: string): PromiseLike<{ error: { code: string } | null }>
          insert(v: object): PromiseLike<{ error: { code: string } | null }>
        }
      }
      expect((await client.from(table).select("*")).error?.code, table).toBe(
        "42501"
      )
      expect((await client.from(table).insert({})).error?.code, table).toBe(
        "42501"
      )
    }
  })
})

describe("sources and snapshots (§4.3, §4.5)", () => {
  it("declares by venue id only, once per kind and label, with replay", async () => {
    await fails(
      rpc(admin, "menu_declare_source", {
        p_venue: randomUUID(),
        p_kind: "venue_website",
        p_label: "TEST",
        p_locator: null,
        p_request_key: randomUUID(),
      }),
      "venue_not_found",
      "P0002"
    )
    const key = randomUUID()
    const args = {
      p_venue: venueA,
      p_kind: "venue_website",
      p_label: `TEST site ${randomUUID()}`,
      p_locator: "TEST repo menu/*.json",
      p_request_key: key,
    }
    const first = await ok<{ sourceId: string; replayed: boolean }>(
      rpc(admin, "menu_declare_source", args)
    )
    expect(first.replayed).toBe(false)
    expect(await ok(rpc(admin, "menu_declare_source", args))).toEqual({
      sourceId: first.sourceId,
      replayed: true,
    })
    await fails(
      rpc(admin, "menu_declare_source", { ...args, p_locator: "x" }),
      "idempotency_key_reused"
    )
    await fails(
      rpc(otherAdmin, "menu_declare_source", args),
      "idempotency_key_reused"
    )
    await fails(
      rpc(admin, "menu_declare_source", {
        ...args,
        p_request_key: randomUUID(),
      }),
      "menu_source_exists"
    )
  })

  it("keeps one revision's bytes, never the import time as capture time", async () => {
    const source = await declare(
      venueA,
      "menu_design",
      `TEST design ${randomUUID()}`
    )
    const entries: SnapshotEntry[] = [
      { locator: "d#1", name: "Chips", priceText: "3.50" },
    ]
    const args = {
      p_source: source,
      p_revision: "abc123",
      p_sha256: "a".repeat(64),
      p_captured_at: null,
      p_document: entries,
    }
    const first = await ok<{ snapshotId: string; unchanged: boolean }>(
      rpc(admin, "menu_record_snapshot", {
        ...args,
        p_request_key: randomUUID(),
      })
    )
    expect(first.unchanged).toBe(false)
    expect(
      await ok(
        rpc(admin, "menu_record_snapshot", {
          ...args,
          p_request_key: randomUUID(),
        })
      )
    ).toMatchObject({ snapshotId: first.snapshotId, unchanged: true })
    await fails(
      rpc(admin, "menu_record_snapshot", {
        ...args,
        p_sha256: "b".repeat(64),
        p_request_key: randomUUID(),
      }),
      "snapshot_revision_conflict",
      "P0001"
    )
    expect(
      rows(
        `select captured_at from public.menu_source_snapshots where id = ${literal(first.snapshotId)}`
      )
    ).toEqual([{ captured_at: null }])
  })

  it("validates documents exactly as the TypeScript validator", async () => {
    const source = await declare(
      venueA,
      "operator_document",
      `TEST parity ${randomUUID()}`
    )
    const ok1: SnapshotEntry = { locator: "a", name: "A" }
    const documents: unknown[] = [
      {},
      [ok1, "x"],
      [{ ...ok1, zz: 1, price: 1 }],
      [{ name: "A" }],
      [{ ...ok1, locator: "a#variant=b" }],
      [{ ...ok1, priceText: 10.5 }],
      [{ ...ok1, sourceKey: "Bad Key" }],
      [{ ...ok1, variants: null }],
      [{ ...ok1, labels: ["GF", ""] }],
      [ok1, { ...ok1, name: "B" }],
      [{ ...ok1, name: "🍛".repeat(120) }],
      // Locator bounds: 900 characters and 1200 UTF-8 bytes.
      [{ ...ok1, locator: "x".repeat(900) }],
      [{ ...ok1, locator: "x".repeat(901) }],
      [{ ...ok1, locator: "🍛".repeat(300) }],
      [{ ...ok1, locator: `${"🍛".repeat(300)}x` }],
      [{ ...ok1, locator: "é".repeat(601) }],
      [{ ...ok1, locator: ` ${"x".repeat(10)}` }],
      // A generated menu.json locator for a name of 100 literal #.
      websiteLocators([
        { file: "menu.json", name: `Dish${"#".repeat(100)}` },
        { file: "menu.json", name: `Dish${"#".repeat(100)}` },
      ]).map((locator) => ({ locator, name: `Dish${"#".repeat(100)}` })),
    ]
    for (const [n, document] of documents.entries()) {
      const expected = snapshotDocumentError(document)
      const { error } = await rpc(admin, "menu_record_snapshot", {
        p_source: source,
        p_revision: `parity-${n}`,
        p_sha256: "c".repeat(64),
        p_captured_at: null,
        p_document: document,
        p_request_key: randomUUID(),
      })
      if (expected === null) expect(error, `#${n}`).toBeNull()
      else {
        expect(error?.message, `#${n}`).toBe("invalid_snapshot_document")
        expect(JSON.parse(error!.details!), `#${n}`).toEqual(expected)
      }
    }
  })
})

describe("crosswalk proposals (§4.2 #2, #4, #5)", () => {
  let source: string
  let snap: string
  const korma: SnapshotEntry = {
    locator: "curries.json#name=Korma",
    name: "Korma",
    variants: ["Chicken", "Lamb"],
    priceText: "10.5",
  }
  const entries: SnapshotEntry[] = [
    {
      locator: "starters.json#name=Chicken Tikka",
      name: "Chicken Tikka",
      section: "Starters",
      labels: ["GF"],
    },
    {
      locator: "mains.json#name=Chicken Tikka",
      name: "Chicken Tikka",
      section: "Mains",
    },
    korma,
    { locator: "sides.json#name=Chips", name: "Chips", priceText: "3.5" },
  ]

  beforeAll(async () => {
    source = await declare(venueA, "venue_website", `TEST site ${randomUUID()}`)
    snap = await snapshot(source, "rev-1", entries)
  })

  it("makes same-name entries ambiguous with every candidate and confirms nothing", async () => {
    const result = await ok<{ counts: Record<string, number> }>(propose(snap))
    expect(result.counts).toMatchObject({
      proposed: 2,
      ambiguous: 2,
      carried: 0,
    })
    const tikka = heads(source).filter((h) =>
      h.locator.includes("Chicken Tikka")
    )
    expect(tikka).toHaveLength(2)
    for (const h of tikka) {
      expect(h.status).toBe("ambiguous")
      expect(h.item_id).toBeNull()
      expect(h.candidates).toEqual([
        A("starters--chicken-tikka").itemId,
        A("mains--chicken-tikka").itemId,
      ])
    }
    expect(
      rows(`select 1 from public.menu_crosswalk where source_id = ${literal(source)}
        and (status in ('confirmed', 'carried') or reviewed_by is not null)`)
    ).toEqual([])
    // A source label stays evidence, never a claim.
    expect(
      rows<{
        evidence: { entry: { labels: string[] } }
      }>(`select r.evidence from public.menu_crosswalk r
        where r.source_id = ${literal(source)} and r.locator = 'starters.json#name=Chicken Tikka'`)[0]!
        .evidence.entry.labels
    ).toEqual(["GF"])
  })

  it("matches the TypeScript matcher row for row", async () => {
    // Recomputed from the same inputs the database saw (no prior heads).
    const expected = proposeCrosswalk({
      snapshotId: snap,
      sourceKind: "venue_website",
      entries,
      contentHashes: await Promise.all(
        entries.map((e) => sha256Hex(contentHashInput(e)))
      ),
      catalogue: catalogueA(),
      heads: [],
    })
    const got =
      rows<Head>(`select r.locator, r.entry_locator, r.status, r.item_id, r.variant_id,
        r.channel, r.content_hash, r.candidates
      from public.menu_crosswalk r
      where r.source_id = ${literal(source)} and r.supersedes is null and r.entry_locator is null
      order by r.seq`)
    expect(
      got.map((r) => [
        r.locator,
        r.status,
        r.item_id,
        r.variant_id,
        r.candidates,
        r.content_hash,
      ])
    ).toEqual(
      expected.rows.map((r) => [
        r.locator,
        r.status,
        r.itemId,
        r.variantId,
        r.candidates,
        r.contentHash,
      ])
    )
  })

  it("matches variants only inside the item the entry is confirmed to", async () => {
    const kormaId = A("mains--korma").itemId
    await ok(
      decide(headAt(source, korma.locator), "confirmed", { item: kormaId })
    )
    const again = await ok<{ counts: Record<string, number> }>(propose(snap))
    expect(again.counts).toMatchObject({ proposed: 2, skipped: 4 })
    const chicken = headAt(source, `${korma.locator}#variant=Chicken`)
    expect(chicken).toMatchObject({
      status: "proposed",
      item_id: kormaId,
      variant_id: A("mains--korma").variants[0]!.variantId,
      entry_locator: korma.locator,
    })
    const tikkaChicken = A("mains--chicken-tikka").variants[0]!.variantId
    expect(heads(source).flatMap((h) => h.candidates)).not.toContain(
      tikkaChicken
    )
    await fails(
      decide(chicken, "confirmed", { item: kormaId, variant: tikkaChicken }),
      "crosswalk_variant_wrong_item"
    )
    await fails(
      decide(chicken, "confirmed", { item: kormaId }),
      "crosswalk_variant_required"
    )
    await ok(
      decide(chicken, "confirmed", {
        item: kormaId,
        variant: A("mains--korma").variants[0]!.variantId,
      })
    )
    // A rejected entry sends its confirmed variants back to review.
    await ok(decide(headAt(source, korma.locator), "rejected"))
    expect(headAt(source, `${korma.locator}#variant=Chicken`).status).toBe(
      "needs_review"
    )
  })
})

describe("uniqueness and venue isolation (§4.2 #3, §3)", () => {
  let source: string
  beforeAll(async () => {
    source = await declare(venueA, "venue_website", `TEST site ${randomUUID()}`)
    const snap = await snapshot(source, "rev-1", [
      { locator: "food/sides.json#name=Chips", name: "Chips" },
      { locator: "takeaway/sides.json#name=Chips", name: "Chips" },
      { locator: "food/sides.json#name=Rice", name: "Rice" },
    ])
    await ok(propose(snap))
  })

  it("refuses two entries confirmed to one (item, variant, channel), and one entry to two items", async () => {
    const chips = A("sides--chips").itemId
    await ok(
      decide(headAt(source, "food/sides.json#name=Chips"), "confirmed", {
        item: chips,
      })
    )
    await fails(
      decide(headAt(source, "takeaway/sides.json#name=Chips"), "confirmed", {
        item: chips,
      }),
      "crosswalk_conflict",
      "P0001"
    )
    await fails(
      decide(headAt(source, "food/sides.json#name=Chips"), "confirmed", {
        item: A("sides--rice").itemId,
      }),
      "crosswalk_conflict",
      "P0001"
    )
  })

  it("maps the same dish on food and takeaway as two channels of one item", async () => {
    const chips = A("sides--chips").itemId
    await ok(decide(headAt(source, "food/sides.json#name=Chips"), "rejected"))
    await ok(
      decide(headAt(source, "food/sides.json#name=Chips"), "confirmed", {
        item: chips,
        channel: "dine_in",
      })
    )
    await ok(
      decide(headAt(source, "takeaway/sides.json#name=Chips"), "confirmed", {
        item: chips,
        channel: "takeaway",
      })
    )
    expect(
      heads(source)
        .filter((h) => h.status === "confirmed")
        .map((h) => [h.item_id, h.channel])
        .sort()
    ).toEqual([
      [chips, "dine_in"],
      [chips, "takeaway"],
    ])
  })

  it("refuses stale decisions and another venue's items", async () => {
    const rice = headAt(source, "food/sides.json#name=Rice")
    await fails(
      rpc(admin, "menu_crosswalk_decide", {
        p_row: rice.row_id,
        p_expected: rice.revision + 1,
        p_status: "unmatched",
        p_item: null,
        p_variant: null,
        p_channel: "all",
        p_reason: null,
        p_request_key: randomUUID(),
      }),
      "crosswalk_stale",
      "40001"
    )
    await fails(
      decide(rice, "confirmed", { item: docB.byKey["sides--chips"]!.itemId }),
      "menu_item_wrong_venue"
    )
    // Structural: the composite key refuses a cross-venue row for any role.
    expect(() =>
      psql(`insert into public.menu_crosswalk (venue_id, source_id, snapshot_id, locator,
          content_hash, item_id, status, basis, proposed_by)
        select r.venue_id, r.source_id, r.snapshot_id, 'TEST cross-venue', r.content_hash,
          ${literal(docB.byKey["sides--chips"]!.itemId)}, 'proposed', 'manual', r.proposed_by
        from public.menu_crosswalk r where r.id = ${literal(rice.row_id)}`)
    ).toThrow(/menu_crosswalk_item_fkey/)
  })
})

describe("revision change: carry by locator and hash (§4.2 #6)", () => {
  it("carries identical rows with the original reviewer, re-reviews changes, removes missing entries", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const chips: SnapshotEntry = {
      locator: "s#Chips",
      name: "Chips",
      priceText: "3.5",
    }
    const korma: SnapshotEntry = {
      locator: "c#Korma",
      name: "Korma",
      priceText: "10.5",
    }
    const rice: SnapshotEntry = { locator: "s#Rice", name: "Rice" }
    await ok(propose(await snapshot(source, "rev-1", [chips, korma, rice])))
    for (const [locator, key] of [
      [chips.locator, "sides--chips"],
      [korma.locator, "mains--korma"],
      [rice.locator, "sides--rice"],
    ] as const)
      await ok(
        decide(headAt(source, locator), "confirmed", { item: A(key).itemId })
      )

    const rev2 = await snapshot(source, "rev-2", [
      chips,
      { ...korma, priceText: "11.00" },
    ])
    await ok(propose(rev2, otherAdmin))
    const after = Object.fromEntries(heads(source).map((h) => [h.locator, h]))
    expect(after[chips.locator]).toMatchObject({
      status: "carried",
      item_id: A("sides--chips").itemId,
    })
    expect(
      rows(
        `select reviewed_by, proposed_by from public.menu_crosswalk where id = ${literal(after[chips.locator]!.row_id)}`
      )
    ).toEqual([{ reviewed_by: admin.id, proposed_by: otherAdmin.id }])
    expect(after[korma.locator]).toMatchObject({
      status: "needs_review",
      candidates: [A("mains--korma").itemId],
    })
    expect(after[rice.locator]).toMatchObject({ status: "not_on_source" })
    // An older snapshot can never be proposed over a newer one.
    const rev1 = rows<{
      id: string
    }>(`select id from public.menu_source_snapshots
      where source_id = ${literal(source)} and source_revision = 'rev-1'`)[0]!
      .id
    await fails(propose(rev1), "snapshot_not_latest")
  })
})

describe("decision provenance: only current source evidence is decided (§4.2 #2, #6)", () => {
  const chips: SnapshotEntry = { locator: "s#Chips", name: "Chips" }
  const rice: SnapshotEntry = { locator: "s#Rice", name: "Rice" }

  it("refuses decisions while a recorded snapshot awaits the matcher, and still replays a committed one", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    await ok(propose(await snapshot(source, "r1", [chips, rice])))
    await ok(
      decide(headAt(source, chips.locator), "confirmed", {
        item: A("sides--chips").itemId,
      })
    )
    const riceHead = headAt(source, rice.locator)
    const committed = {
      p_row: riceHead.row_id,
      p_expected: riceHead.revision,
      p_status: "unmatched",
      p_item: null,
      p_variant: null,
      p_channel: "all",
      p_reason: null,
      p_request_key: randomUUID(),
    }
    const first = await ok<{ revision: number }>(
      rpc(admin, "menu_crosswalk_decide", committed)
    )

    // S2 drops Chips; it is recorded but not proposed.
    await snapshot(source, "r2", [rice])
    await fails(
      decide(headAt(source, chips.locator), "rejected"),
      "crosswalk_reconcile_pending",
      "P0001"
    )
    await fails(
      decide(headAt(source, chips.locator), "confirmed", {
        item: A("sides--chips").itemId,
      }),
      "crosswalk_reconcile_pending",
      "P0001"
    )
    // The decision that committed before S2 replays.
    expect(await ok(rpc(admin, "menu_crosswalk_decide", committed))).toEqual({
      rowId: headAt(source, rice.locator).row_id,
      status: "unmatched",
      revision: first.revision,
      replayed: true,
    })

    type Src = {
      sourceId: string
      latestSnapshot: { revision: string; snapshotId?: string }
      reconciledSnapshot: { revision: string; snapshotId?: string } | null
      reconciliationPending: boolean
    }
    const adminView = await ok<{ sources: Src[] }>(manifest(admin, venueA))
    expect(adminView.sources.find((s) => s.sourceId === source)).toMatchObject({
      latestSnapshot: { revision: "r2" },
      reconciledSnapshot: { revision: "r1" },
      reconciliationPending: true,
    })
    const managerView = await ok<{ sources: Src[] }>(manifest(managerA, venueA))
    const seen = managerView.sources.find((s) => s.sourceId === source)!
    expect(seen.reconciliationPending).toBe(true)
    expect(seen.reconciledSnapshot).not.toHaveProperty("snapshotId")
  })

  it("refuses to confirm an S2 tombstone, and retrying the S2 matcher leaves it removed", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    await ok(propose(await snapshot(source, "r1", [chips, rice])))
    await ok(
      decide(headAt(source, chips.locator), "confirmed", {
        item: A("sides--chips").itemId,
      })
    )
    const s2 = await snapshot(source, "r2", [rice])
    await ok(propose(s2))
    const tomb = headAt(source, chips.locator)
    expect(tomb).toMatchObject({ status: "not_on_source", snapshot_id: s2 })
    for (const status of ["confirmed", "rejected", "unmatched"] as const)
      await fails(
        decide(tomb, status, {
          item: status === "confirmed" ? A("sides--chips").itemId : undefined,
        }),
        "crosswalk_not_on_source",
        "P0001"
      )
    const retry = await ok<{ counts: Record<string, number> }>(propose(s2))
    expect(retry.counts).toMatchObject({
      proposed: 0,
      ambiguous: 0,
      carried: 0,
      needsReview: 0,
      notOnSource: 0,
    })
    expect(headAt(source, chips.locator)).toMatchObject({
      status: "not_on_source",
      row_id: tomb.row_id,
      revision: tomb.revision,
    })
    const m = await ok<{
      entries: {
        itemId: string
        outcomes: { sourceId: string; outcome: string }[]
      }[]
    }>(manifest(admin, venueA))
    expect(
      m.entries
        .find((e) => e.itemId === A("sides--chips").itemId)!
        .outcomes.find((o) => o.sourceId === source)!.outcome
    ).toBe("not_on_source")
  })
})

describe("variant transitions: retained, removed and remapped (§4.2 #5, #6)", () => {
  const korma: SnapshotEntry = {
    locator: "c#Korma",
    name: "Korma",
    variants: ["Chicken", "Lamb"],
    priceText: "10.5",
  }
  const chickenAt = `${korma.locator}#variant=Chicken`
  const lambAt = `${korma.locator}#variant=Lamb`

  it("re-reviews a retained variant, removes a dropped one while the entry is pending, as the TypeScript matcher does", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const kormaId = A("mains--korma").itemId
    const [kChicken, kLamb] = A("mains--korma").variants.map(
      (v) => v.variantId!
    )
    const s1 = await snapshot(source, "r1", [korma])
    await ok(propose(s1))
    await ok(
      decide(headAt(source, korma.locator), "confirmed", { item: kormaId })
    )
    await ok(propose(s1))
    await ok(
      decide(headAt(source, chickenAt), "confirmed", {
        item: kormaId,
        variant: kChicken,
      })
    )
    await ok(
      decide(headAt(source, lambAt), "confirmed", {
        item: kormaId,
        variant: kLamb,
      })
    )

    const next: SnapshotEntry = {
      ...korma,
      variants: ["Chicken"],
      priceText: "11",
    }
    const before = heads(source)
    const seq = lastSeq()
    const s2 = await snapshot(source, "r2", [next])
    await ok(propose(s2))
    const expected = proposeCrosswalk({
      snapshotId: s2,
      sourceKind: "venue_website",
      entries: [next],
      contentHashes: [await sha256Hex(contentHashInput(next))],
      catalogue: catalogueA(),
      heads: asTsHeads(before),
    })
    expect(rowsFrom(source, s2, seq)).toEqual(
      expected.rows.map((r) => [
        r.locator,
        r.status,
        r.itemId,
        r.variantId,
        r.candidates,
        r.contentHash,
      ])
    )
    const kormaHead = headAt(source, korma.locator)
    expect(kormaHead.status).toBe("needs_review")
    expect(headAt(source, chickenAt)).toMatchObject({
      status: "needs_review",
      variant_id: kChicken,
      content_hash: kormaHead.content_hash,
      snapshot_id: s2,
    })
    expect(headAt(source, lambAt)).toMatchObject({
      status: "not_on_source",
      variant_id: kLamb,
    })

    // The entry is reconfirmed on S2 and the matcher runs again.
    await ok(decide(kormaHead, "confirmed", { item: kormaId }))
    const chickenBefore = headAt(source, chickenAt)
    expect(
      (await ok<{ counts: Record<string, number> }>(propose(s2))).counts
    ).toMatchObject({ proposed: 0, needsReview: 0, notOnSource: 0 })
    expect(headAt(source, chickenAt)).toMatchObject({
      row_id: chickenBefore.row_id,
      status: "needs_review",
    })
    await ok(
      decide(headAt(source, chickenAt), "confirmed", {
        item: kormaId,
        variant: kChicken,
      })
    )
    await fails(
      decide(headAt(source, lambAt), "confirmed", {
        item: kormaId,
        variant: kLamb,
      }),
      "crosswalk_not_on_source"
    )
  })

  it("moves a retained variant's open review to new evidence while its entry is still pending, as the TypeScript matcher does", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const kormaId = A("mains--korma").itemId
    const [kChicken, kLamb] = A("mains--korma").variants.map(
      (v) => v.variantId!
    )
    const s1 = await snapshot(source, "r1", [korma])
    await ok(propose(s1))
    await ok(
      decide(headAt(source, korma.locator), "confirmed", { item: kormaId })
    )
    await ok(propose(s1))
    await ok(
      decide(headAt(source, chickenAt), "confirmed", {
        item: kormaId,
        variant: kChicken,
      })
    )
    await ok(
      decide(headAt(source, lambAt), "confirmed", {
        item: kormaId,
        variant: kLamb,
      })
    )

    // S2 changes the price: the entry and its retained variants need review.
    const s2Entry: SnapshotEntry = { ...korma, priceText: "11" }
    await ok(propose(await snapshot(source, "r2", [s2Entry])))
    const chickenS2 = headAt(source, chickenAt)
    expect(chickenS2).toMatchObject({
      status: "needs_review",
      variant_id: kChicken,
    })
    expect(headAt(source, korma.locator).status).toBe("needs_review")
    type Row = {
      id: string
      seq: number
      snapshot_id: string
      status: string
      content_hash: string
      evidence: { entry: { priceText?: string } }
      reviewed_by: string | null
      supersedes: string | null
    }
    const history = () =>
      rows<Row>(`select r.id, r.seq, r.snapshot_id, r.status, r.content_hash, r.evidence,
          r.reviewed_by, r.supersedes
        from public.menu_crosswalk r
        where r.source_id = ${literal(source)} and r.locator = ${literal(chickenAt)}
        order by r.seq`)
    const historyS2 = history()

    // S3 changes the price again before anyone reviews Korma.
    const s3Entry: SnapshotEntry = { ...korma, priceText: "12" }
    const before = heads(source)
    const seq = lastSeq()
    const s3 = await snapshot(source, "r3", [s3Entry])
    await ok(propose(s3))
    const s3Hash = await sha256Hex(contentHashInput(s3Entry))
    const expected = proposeCrosswalk({
      snapshotId: s3,
      sourceKind: "venue_website",
      entries: [s3Entry],
      contentHashes: [s3Hash],
      catalogue: catalogueA(),
      heads: asTsHeads(before),
    })
    expect(rowsFrom(source, s3, seq)).toEqual(
      expected.rows.map((r) => [
        r.locator,
        r.status,
        r.itemId,
        r.variantId,
        r.candidates,
        r.contentHash,
      ])
    )
    const chickenS3 = headAt(source, chickenAt)
    expect(chickenS3).toMatchObject({
      status: "needs_review",
      item_id: kormaId,
      variant_id: kChicken,
      candidates: [kChicken],
      content_hash: s3Hash,
      snapshot_id: s3,
      revision: chickenS2.revision + 1,
    })
    expect(headAt(source, lambAt)).toMatchObject({
      status: "needs_review",
      content_hash: s3Hash,
      snapshot_id: s3,
    })
    expect(headAt(source, korma.locator).status).toBe("proposed")
    // One new row on S3's evidence; the S1 decision and S2 review are intact.
    const historyS3 = history()
    expect(historyS3.slice(0, historyS2.length)).toEqual(historyS2)
    expect(historyS3).toHaveLength(historyS2.length + 1)
    expect(historyS3.at(-1)).toMatchObject({
      id: chickenS3.row_id,
      snapshot_id: s3,
      status: "needs_review",
      content_hash: s3Hash,
      evidence: { entry: { priceText: "12" } },
      reviewed_by: null,
      supersedes: chickenS2.row_id,
    })
    expect(
      historyS2.some((r) => r.status === "confirmed" && r.reviewed_by)
    ).toBe(true)
    expect(historyS2.at(-1)).toMatchObject({
      status: "needs_review",
      evidence: { entry: { priceText: "11" } },
    })

    // S3 again adds no variant row.
    const retry = await ok<{ counts: Record<string, number> }>(propose(s3))
    expect(retry.counts).toMatchObject({
      proposed: 0,
      ambiguous: 0,
      carried: 0,
      needsReview: 0,
      notOnSource: 0,
    })
    expect(headAt(source, chickenAt)).toMatchObject({
      row_id: chickenS3.row_id,
      revision: chickenS3.revision,
    })

    // The S2 decision is stale against S3, and the S3 row still needs its
    // entry confirmed first.
    await fails(
      decide(chickenS2, "confirmed", { item: kormaId, variant: kChicken }),
      "crosswalk_stale",
      "40001"
    )
    await fails(
      decide(chickenS3, "confirmed", { item: kormaId, variant: kChicken }),
      "crosswalk_parent_not_confirmed",
      "P0001"
    )
    // With the entry confirmed on S3, the S3 row is current evidence.
    await ok(
      decide(headAt(source, korma.locator), "confirmed", { item: kormaId })
    )
    await ok(
      decide(headAt(source, chickenAt), "confirmed", {
        item: kormaId,
        variant: kChicken,
      })
    )
    expect(headAt(source, chickenAt)).toMatchObject({
      status: "confirmed",
      snapshot_id: s3,
      content_hash: s3Hash,
    })
  })

  it("re-proposes variant rows inside the item an entry is remapped to in the same snapshot", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const kormaId = A("mains--korma").itemId
    const tikkaId = A("mains--chicken-tikka").itemId
    const tikkaChicken = A("mains--chicken-tikka").variants[0]!.variantId!
    const snap = await snapshot(source, "r1", [korma])
    await ok(propose(snap))
    await ok(
      decide(headAt(source, korma.locator), "confirmed", { item: kormaId })
    )
    await ok(propose(snap))
    expect(headAt(source, chickenAt)).toMatchObject({ item_id: kormaId })
    await ok(decide(headAt(source, korma.locator), "rejected"))
    await ok(
      decide(headAt(source, korma.locator), "confirmed", { item: tikkaId })
    )
    await ok(propose(snap))
    expect(headAt(source, chickenAt)).toMatchObject({
      status: "proposed",
      item_id: tikkaId,
      variant_id: tikkaChicken,
      candidates: [tikkaChicken],
    })
    expect(headAt(source, lambAt)).toMatchObject({
      status: "proposed",
      item_id: tikkaId,
      variant_id: null,
      candidates: [],
    })
    const kormaVariants = A("mains--korma").variants.map((v) => v.variantId)
    expect(
      heads(source)
        .flatMap((h) => h.candidates)
        .filter((c) => kormaVariants.includes(c))
    ).toEqual([])
    await ok(
      decide(headAt(source, chickenAt), "confirmed", {
        item: tikkaId,
        variant: tikkaChicken,
      })
    )
  })
})

describe("deferred variant proposals: open variants while the entry is pending (§4.2 #5, #6)", () => {
  const bhuna: SnapshotEntry = {
    locator: "c#Bhuna",
    name: "Bhuna",
    variants: ["Chicken", "Lamb", "Chicken"],
    priceText: "9",
  }
  const chickenAt = `${bhuna.locator}#variant=Chicken`
  const lambAt = `${bhuna.locator}#variant=Lamb`
  const chicken2At = `${bhuna.locator}#variant=Chicken#2`
  const variantAts = [chickenAt, lambAt, chicken2At]

  type Row = {
    id: string
    snapshot_id: string
    status: string
    basis: string
    item_id: string | null
    variant_id: string | null
    candidates: string[]
    evidence: Record<string, unknown> & { deferredProposal?: unknown }
    supersedes: string | null
    reviewed_by: string | null
  }
  const rowById = (rowId: string) =>
    rows<Row>(`select r.id, r.snapshot_id, r.status, r.basis, r.item_id, r.variant_id,
        r.candidates, r.evidence, r.supersedes, r.reviewed_by
      from public.menu_crosswalk r where r.id = ${literal(rowId)}`)[0]!
  const headsBy = (sourceId: string) =>
    Object.fromEntries(heads(sourceId).map((h) => [h.locator, h])) as Record<
      string,
      Head
    >

  /** A venue whose active menu lists Bhuna with Chicken and Lamb. */
  async function bhunaVenue(label: string) {
    const venue = (await createVenue(service, label)).id
    const version = await publishMenu(
      admin,
      venue,
      menu(`TEST ${label}`, [
        section("mains", "Mains", [
          item("mains--bhuna", "Bhuna", { variants: ["Chicken", "Lamb"] }),
        ]),
      ])
    )
    const doc = await readDocument(service, version)
    const bhunaRow = doc.byKey["mains--bhuna"]!
    return {
      venue,
      version,
      doc,
      source: await declare(
        venue,
        "venue_website",
        `TEST site ${randomUUID()}`
      ),
      itemId: bhunaRow.itemId,
      chicken: bhunaRow.variants[0]!.variantId,
      lamb: bhunaRow.variants[1]!.variantId,
    }
  }

  /**
   * Runs the matcher on a snapshot of one entry and checks it wrote what the
   * TypeScript matcher computes from the heads it read, basis and channel
   * included.
   */
  async function proposeLikeTs(
    sourceId: string,
    snapshotId: string,
    entry: SnapshotEntry,
    catalogue: CatalogueEntry[]
  ) {
    const before = heads(sourceId)
    const seq = lastSeq()
    const result = await ok<{ counts: Record<string, number> }>(
      propose(snapshotId)
    )
    const expected = proposeCrosswalk({
      snapshotId,
      sourceKind: "venue_website",
      entries: [entry],
      contentHashes: [await sha256Hex(contentHashInput(entry))],
      catalogue,
      heads: asTsHeads(before),
    })
    expect(
      rows<
        Head & { basis: string }
      >(`select r.locator, r.status, r.basis, r.item_id,
          r.variant_id, r.channel, r.candidates, r.content_hash
        from public.menu_crosswalk r
        where r.source_id = ${literal(sourceId)} and r.snapshot_id = ${literal(snapshotId)}
          and r.seq > ${seq}
        order by r.seq`).map((r) => [
        r.locator,
        r.status,
        r.basis,
        r.item_id,
        r.variant_id,
        r.channel,
        r.candidates,
        r.content_hash,
      ])
    ).toEqual(
      expected.rows.map((r) => [
        r.locator,
        r.status,
        r.basis,
        r.itemId,
        r.variantId,
        r.channel,
        r.candidates,
        r.contentHash,
      ])
    )
    return result
  }

  it("defers S1 proposals to S2 evidence, refuses the S1 decision, defers again on S3 and rematches after reconfirmation in the active catalogue", async () => {
    const v = await bhunaVenue("crosswalk-deferred")
    const s1 = await snapshot(v.source, "r1", [bhuna])
    await proposeLikeTs(v.source, s1, bhuna, catalogueOf(v.doc))
    await ok(
      decide(headAt(v.source, bhuna.locator), "confirmed", { item: v.itemId })
    )
    await proposeLikeTs(v.source, s1, bhuna, catalogueOf(v.doc))
    const h1 = headsBy(v.source)
    // A single candidate, a single candidate, a repeated occurrence.
    const proposals = [
      [chickenAt, "proposed", v.chicken, [v.chicken]],
      [lambAt, "proposed", v.lamb, [v.lamb]],
      [chicken2At, "ambiguous", null, [v.chicken]],
    ] as const
    for (const [at, status, variantId, candidates] of proposals)
      expect(h1[at]).toMatchObject({
        status,
        basis: "name_candidate",
        item_id: v.itemId,
        variant_id: variantId,
        candidates,
        snapshot_id: s1,
      })

    // S2 changes the price and keeps the variants; nobody reviews Bhuna.
    const s2Entry: SnapshotEntry = { ...bhuna, priceText: "9.5" }
    const s2Hash = await sha256Hex(contentHashInput(s2Entry))
    const s2 = await snapshot(v.source, "r2", [s2Entry])
    expect(
      await proposeLikeTs(v.source, s2, s2Entry, catalogueOf(v.doc))
    ).toMatchObject({
      counts: {
        proposed: 0,
        ambiguous: 0,
        carried: 0,
        needsReview: 4,
        notOnSource: 0,
      },
    })
    const h2 = headsBy(v.source)
    expect(h2[bhuna.locator]).toMatchObject({
      status: "needs_review",
      snapshot_id: s2,
    })
    for (const [at, status, , candidates] of proposals) {
      expect(h2[at]).toMatchObject({
        status: "needs_review",
        basis: "name_candidate",
        entry_locator: bhuna.locator,
        item_id: v.itemId,
        variant_id: null,
        channel: "all",
        candidates: [],
        content_hash: s2Hash,
        snapshot_id: s2,
        revision: h1[at]!.revision + 1,
      })
      const row = rowById(h2[at]!.row_id)
      expect(row.supersedes).toBe(h1[at]!.row_id)
      // Latest entry and variant evidence; the proposal only as history.
      expect(row.evidence).toEqual({
        entry: {
          name: "Bhuna",
          variants: ["Chicken", "Lamb", "Chicken"],
          priceText: "9.5",
        },
        variant: at === lambAt ? "Lamb" : "Chicken",
        deferredProposal: {
          role: "historical",
          rowId: h1[at]!.row_id,
          snapshotId: s1,
          status,
          itemId: v.itemId,
          candidates,
          candidateCount: 1,
        },
      })
      // The superseded S1 proposal is intact.
      expect(rowById(h1[at]!.row_id)).toMatchObject({
        snapshot_id: s1,
        status,
        candidates,
        evidence: { candidateCount: 1, entry: { priceText: "9" } },
      })
    }

    // The admin queue gives the S2 rows and revisions.
    const queue = await ok<{
      rows: {
        rowId: string
        revision: number
        locator: string
        status: string
        basis: string
        candidates: string[]
        evidence: { entry: { priceText?: string } }
      }[]
    }>(listRows(admin, v.venue, { source: v.source }))
    for (const at of variantAts)
      expect(queue.rows.find((r) => r.locator === at)).toMatchObject({
        rowId: h2[at]!.row_id,
        revision: h2[at]!.revision,
        status: "needs_review",
        basis: "name_candidate",
        candidates: [],
        evidence: { entry: { priceText: "9.5" } },
      })

    // A decision on an S1 proposal is stale; the S2 row waits for its entry.
    await fails(decide(h1[chicken2At]!, "rejected"), "crosswalk_stale", "40001")
    await fails(
      decide(h1[chickenAt]!, "confirmed", {
        item: v.itemId,
        variant: v.chicken,
      }),
      "crosswalk_stale",
      "40001"
    )
    await fails(
      decide(h2[chickenAt]!, "confirmed", {
        item: v.itemId,
        variant: v.chicken,
      }),
      "crosswalk_parent_not_confirmed",
      "P0001"
    )

    // S2 again writes nothing.
    expect(
      (await ok<{ counts: Record<string, number> }>(propose(s2))).counts
    ).toMatchObject({
      proposed: 0,
      ambiguous: 0,
      carried: 0,
      needsReview: 0,
      notOnSource: 0,
    })
    for (const at of variantAts)
      expect(headAt(v.source, at)).toMatchObject({
        row_id: h2[at]!.row_id,
        revision: h2[at]!.revision,
      })

    // S3 changes the price again: deferred again, keeping the S1 proposal.
    const s3Entry: SnapshotEntry = { ...bhuna, priceText: "10" }
    const s3Hash = await sha256Hex(contentHashInput(s3Entry))
    const s3 = await snapshot(v.source, "r3", [s3Entry])
    await proposeLikeTs(v.source, s3, s3Entry, catalogueOf(v.doc))
    const h3 = headsBy(v.source)
    for (const at of variantAts) {
      expect(h3[at]).toMatchObject({
        status: "needs_review",
        basis: "name_candidate",
        variant_id: null,
        candidates: [],
        content_hash: s3Hash,
        snapshot_id: s3,
        revision: h2[at]!.revision + 1,
      })
      const row = rowById(h3[at]!.row_id)
      expect(row).toMatchObject({
        supersedes: h2[at]!.row_id,
        evidence: { entry: { priceText: "10" } },
      })
      expect(row.evidence.deferredProposal).toEqual(
        rowById(h2[at]!.row_id).evidence.deferredProposal
      )
      expect(row.evidence.deferredProposal).toMatchObject({
        rowId: h1[at]!.row_id,
        snapshotId: s1,
      })
    }
    expect(
      (await ok<{ counts: Record<string, number> }>(propose(s3))).counts
    ).toMatchObject({ proposed: 0, ambiguous: 0, needsReview: 0 })

    // The active version changes before the rematch: Lamb is a new variant.
    const doc2 = await readDocument(
      service,
      await publishMenu(
        admin,
        v.venue,
        menu("TEST crosswalk-deferred 2", [
          section("mains", "Mains", [
            item("mains--bhuna", "Bhuna", {
              itemId: v.itemId,
              variants: [
                { variantId: v.chicken, name: "Chicken" },
                { variantId: null, name: "Lamb" },
              ],
            }),
          ]),
        ]),
        v.version
      )
    )
    const newLamb = doc2.byKey["mains--bhuna"]!.variants[1]!.variantId
    expect(newLamb).not.toBe(v.lamb)

    // Bhuna is confirmed on S3 to the same item: the variants are matched
    // afresh, exactly as the TypeScript matcher does, on S3's evidence.
    expect(headAt(v.source, bhuna.locator)).toMatchObject({
      status: "proposed",
      item_id: v.itemId,
      snapshot_id: s3,
    })
    await ok(
      decide(headAt(v.source, bhuna.locator), "confirmed", { item: v.itemId })
    )
    expect(
      await proposeLikeTs(v.source, s3, s3Entry, catalogueOf(doc2))
    ).toMatchObject({
      counts: { proposed: 2, ambiguous: 1, needsReview: 0, skipped: 1 },
    })
    const h4 = headsBy(v.source)
    expect(h4[chickenAt]).toMatchObject({
      status: "proposed",
      basis: "name_candidate",
      variant_id: v.chicken,
      candidates: [v.chicken],
      content_hash: s3Hash,
      snapshot_id: s3,
    })
    expect(h4[lambAt]).toMatchObject({
      status: "proposed",
      variant_id: newLamb,
      candidates: [newLamb],
    })
    expect(h4[chicken2At]).toMatchObject({
      status: "ambiguous",
      variant_id: null,
      candidates: [v.chicken],
    })
    const lambRow = rowById(h4[lambAt]!.row_id)
    expect(lambRow.evidence).toMatchObject({
      candidateCount: 1,
      entry: { priceText: "10" },
    })
    expect(lambRow.evidence).not.toHaveProperty("deferredProposal")

    // S3 again: nothing new.
    expect(
      (await ok<{ counts: Record<string, number> }>(propose(s3))).counts
    ).toMatchObject({ proposed: 0, ambiguous: 0, needsReview: 0, skipped: 4 })
    await fails(
      decide(h4[lambAt]!, "confirmed", { item: v.itemId, variant: v.lamb }),
      "crosswalk_variant_wrong_item"
    )
    await ok(
      decide(h4[lambAt]!, "confirmed", { item: v.itemId, variant: newLamb })
    )
    // A rematched proposal confirmed to its candidate keeps its basis.
    expect(headAt(v.source, lambAt)).toMatchObject({
      status: "confirmed",
      basis: "name_candidate",
      variant_id: newLamb,
      revision: h4[lambAt]!.revision + 1,
    })
  })

  it("keeps decisions on deferred rows and an ordinary review, confirms a deferred row directly, and rematches the rest on the same S2 item", async () => {
    const v = await bhunaVenue("crosswalk-deferred-decided")
    const entry: SnapshotEntry = {
      ...bhuna,
      variants: ["Chicken", "Lamb", "Chicken", "Lamb", "Chicken"],
    }
    const lamb2At = `${bhuna.locator}#variant=Lamb#2`
    const chicken3At = `${bhuna.locator}#variant=Chicken#3`
    const catalogue = catalogueOf(v.doc)
    const s1 = await snapshot(v.source, "r1", [entry])
    await ok(propose(s1))
    await ok(
      decide(headAt(v.source, bhuna.locator), "confirmed", { item: v.itemId })
    )
    await ok(propose(s1))
    const h1 = headsBy(v.source)
    expect(h1[chicken3At]).toMatchObject({
      status: "ambiguous",
      basis: "name_candidate",
      variant_id: null,
      candidates: [v.chicken],
      snapshot_id: s1,
    })
    await ok(
      decide(headAt(v.source, chickenAt), "confirmed", {
        item: v.itemId,
        variant: v.chicken,
      })
    )

    const s2Entry: SnapshotEntry = { ...entry, priceText: "9.5" }
    const s2 = await snapshot(v.source, "r2", [s2Entry])
    await proposeLikeTs(v.source, s2, s2Entry, catalogue)
    let h = headsBy(v.source)
    // The confirmed variant is an ordinary review of its mapping...
    expect(h[chickenAt]).toMatchObject({
      status: "needs_review",
      basis: "carried",
      variant_id: v.chicken,
      candidates: [v.chicken],
      snapshot_id: s2,
    })
    // ...the open proposals are deferred.
    for (const at of [lambAt, chicken2At, lamb2At, chicken3At])
      expect(h[at]).toMatchObject({
        status: "needs_review",
        basis: "name_candidate",
        variant_id: null,
        candidates: [],
        snapshot_id: s2,
      })

    // While Bhuna is pending, the reviewer rejects Lamb and marks Chicken#2
    // unmatched on their S2 rows.
    await ok(decide(h[lambAt]!, "rejected"))
    await ok(decide(h[chicken2At]!, "unmatched"))
    h = headsBy(v.source)
    expect(h[lambAt]).toMatchObject({
      status: "rejected",
      item_id: v.itemId,
      variant_id: null,
      snapshot_id: s2,
    })
    expect(h[chicken2At]).toMatchObject({
      status: "unmatched",
      item_id: v.itemId,
      snapshot_id: s2,
    })

    // Bhuna is reconfirmed to the same item on S2.
    await ok(decide(h[bhuna.locator]!, "confirmed", { item: v.itemId }))

    // Before any rematch, the reviewer confirms the still-deferred Chicken#3
    // to Lamb, a variant its S1 proposal never named: chosen, not matched.
    const deferred = headAt(v.source, chicken3At)
    expect(deferred).toMatchObject({
      row_id: h[chicken3At]!.row_id,
      revision: h[chicken3At]!.revision,
      status: "needs_review",
      basis: "name_candidate",
      candidates: [],
    })
    await ok(decide(deferred, "confirmed", { item: v.itemId, variant: v.lamb }))
    const direct = headAt(v.source, chicken3At)
    expect(direct).toMatchObject({
      status: "confirmed",
      basis: "manual",
      entry_locator: bhuna.locator,
      item_id: v.itemId,
      variant_id: v.lamb,
      channel: "all",
      candidates: [],
      snapshot_id: s2,
      revision: deferred.revision + 1,
    })
    const directRow = rowById(direct.row_id)
    expect(directRow).toMatchObject({
      supersedes: deferred.row_id,
      reviewed_by: admin.id,
    })
    // S2 evidence, with the S1 proposal still only as history.
    expect(directRow.evidence).toEqual({
      entry: {
        name: "Bhuna",
        variants: ["Chicken", "Lamb", "Chicken", "Lamb", "Chicken"],
        priceText: "9.5",
      },
      variant: "Chicken",
      deferredProposal: {
        role: "historical",
        rowId: h1[chicken3At]!.row_id,
        snapshotId: s1,
        status: "ambiguous",
        itemId: v.itemId,
        candidates: [v.chicken],
        candidateCount: 1,
      },
    })
    expect(directRow.evidence.deferredProposal).toEqual(
      rowById(deferred.row_id).evidence.deferredProposal
    )

    // The decisions hold, the ordinary review still awaits the reviewer, and
    // only Lamb#2 (deferred) is matched afresh.
    expect(await proposeLikeTs(v.source, s2, s2Entry, catalogue)).toMatchObject(
      {
        counts: { proposed: 0, ambiguous: 1, needsReview: 0, skipped: 5 },
      }
    )
    const after = headsBy(v.source)
    expect(after[chicken3At]).toMatchObject({
      row_id: direct.row_id,
      revision: direct.revision,
    })
    for (const at of [chickenAt, lambAt, chicken2At])
      expect(after[at]).toMatchObject({
        row_id: h[at]!.row_id,
        revision: h[at]!.revision,
      })
    expect(after[lamb2At]).toMatchObject({
      status: "ambiguous",
      basis: "name_candidate",
      item_id: v.itemId,
      variant_id: null,
      candidates: [v.lamb],
      snapshot_id: s2,
      revision: h[lamb2At]!.revision + 1,
    })
    await ok(
      decide(after[chickenAt]!, "confirmed", {
        item: v.itemId,
        variant: v.chicken,
      })
    )
    // An ordinary review is a manual decision.
    expect(headAt(v.source, chickenAt)).toMatchObject({
      status: "confirmed",
      basis: "manual",
      variant_id: v.chicken,
      revision: after[chickenAt]!.revision + 1,
    })
  })
})

describe("variant locators: duplicates and literal suffixes (§4.3)", () => {
  const fixtures: SnapshotEntry[] = [
    {
      locator: "x#name=Chips",
      name: "Chips",
      variants: ["Regular", "Regular", "Regular#2"],
    },
    {
      locator: "x#name=Odd",
      name: "Odd",
      variants: ["a#2", "a", "a", "a%232", "#", "%", "x#variant=y"],
    },
  ]

  it("writes the TypeScript locators and finds each occurrence", () => {
    for (const entry of fixtures) {
      const got = rows<{ locator: string }>(`select v.locator
        from private.menu_crosswalk_variants(${literal(JSON.stringify(entry))}::jsonb) v
        order by v.ord`).map((r) => r.locator)
      expect(got).toEqual(variantLocators(entry))
      for (const locator of got)
        expect(
          psql(`select private.menu_crosswalk_occurrence(
            ${literal(JSON.stringify(fixtures))}::jsonb, ${literal(locator)}, ${literal(entry.locator)}) ->> 'locator'`)
        ).toBe(entry.locator)
      expect(
        psql(`select private.menu_crosswalk_occurrence(
          ${literal(JSON.stringify(fixtures))}::jsonb,
          ${literal(`${entry.locator}#variant=Missing`)}, ${literal(entry.locator)}) is null`)
      ).toBe("t")
    }
  })

  it("proposes one row for every listed variant, literal suffixes included", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const snap = await snapshot(source, "r1", [fixtures[0]!])
    await ok(propose(snap))
    await ok(
      decide(headAt(source, fixtures[0]!.locator), "confirmed", {
        item: A("sides--chips").itemId,
      })
    )
    const again = await ok<{ counts: Record<string, number> }>(propose(snap))
    expect(again.counts).toMatchObject({ proposed: 3 })
    expect(
      heads(source)
        .filter((h) => h.entry_locator === fixtures[0]!.locator)
        .map((h) => h.locator)
        .sort()
    ).toEqual([...variantLocators(fixtures[0]!)].sort())
  })

  it("ingests and persists the longest admitted entry and variant locators", async () => {
    const hashes = `Dish${"#".repeat(100)}`
    const [generated] = websiteLocators([{ file: "menu.json", name: hashes }])
    expect(generated).toHaveLength(319)
    const entries: SnapshotEntry[] = [
      {
        locator: generated!,
        name: hashes,
        variants: ["Regular", "Regular", "#".repeat(80)],
      },
      {
        locator: "x".repeat(SNAPSHOT_LIMITS.locatorMax),
        name: "Long",
        variants: Array(12).fill("#".repeat(80)),
      },
      {
        locator: "🍛".repeat(SNAPSHOT_LIMITS.locatorBytesMax / 4),
        name: "Wide",
        variants: Array(12).fill("🍛".repeat(80)),
      },
    ]
    expect(snapshotDocumentError(entries)).toBeNull()
    const items = [
      A("sides--chips").itemId,
      A("sides--rice").itemId,
      A("starters--chicken-tikka").itemId,
    ]
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const snap = await snapshot(source, "r1", entries)
    await ok(propose(snap))
    for (const [n, entry] of entries.entries()) {
      expect(headAt(source, entry.locator).entry_locator).toBeNull()
      await ok(
        decide(headAt(source, entry.locator), "confirmed", { item: items[n] })
      )
    }
    await ok(propose(snap))
    for (const entry of entries) {
      const derived = rows<{ locator: string }>(`select v.locator
        from private.menu_crosswalk_variants(${literal(JSON.stringify(entry))}::jsonb) v
        order by v.ord`).map((r) => r.locator)
      expect(derived).toEqual(variantLocators(entry))
      expect(
        heads(source)
          .filter((h) => h.entry_locator === entry.locator)
          .map((h) => h.locator)
          .sort()
      ).toEqual([...variantLocators(entry)].sort())
    }
    expect(
      rows(`select max(length(r.locator)) as chars, max(octet_length(r.locator)) as bytes,
          max(length(r.entry_locator)) as entry_chars,
          max(octet_length(r.entry_locator)) as entry_bytes
        from public.menu_crosswalk r where r.source_id = ${literal(source)}`)
    ).toEqual([
      {
        chars: CROSSWALK_LOCATOR_MAX,
        bytes: CROSSWALK_LOCATOR_BYTES_MAX,
        entry_chars: SNAPSHOT_LIMITS.locatorMax,
        entry_bytes: SNAPSHOT_LIMITS.locatorBytesMax,
      },
    ])

    // One character or byte past either bound is refused for any role.
    const insert = (locator: string, entryLocator: string) =>
      psql(`insert into public.menu_crosswalk (venue_id, source_id, snapshot_id, locator,
          entry_locator, content_hash, status, basis, proposed_by)
        select r.venue_id, r.source_id, r.snapshot_id, ${literal(locator)},
          ${literal(entryLocator)}, r.content_hash, 'proposed', 'manual', r.proposed_by
        from public.menu_crosswalk r where r.source_id = ${literal(source)} limit 1`)
    expect(() => insert(`${"x".repeat(CROSSWALK_LOCATOR_MAX)}y`, "e")).toThrow(
      /menu_crosswalk_locator_check/
    )
    expect(() =>
      insert(`${variantLocators(entries[2]!).at(-1)}y`, "e")
    ).toThrow(/menu_crosswalk_locator_check/)
    expect(() =>
      insert("l", "x".repeat(SNAPSHOT_LIMITS.locatorMax + 1))
    ).toThrow(/menu_crosswalk_entry_locator_check/)
    expect(() => insert("l", `${entries[2]!.locator}y`)).toThrow(
      /menu_crosswalk_entry_locator_check/
    )
  })
})

describe("admin rows read: current mappings and review paging (§4.2 #3, B04-01d)", () => {
  it("finds a current mapping after a reload so it can be rejected and remapped", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const chips = A("sides--chips").itemId
    await ok(
      propose(
        await snapshot(source, "r1", [{ locator: "s#Chips", name: "Chips" }])
      )
    )
    await ok(decide(headAt(source, "s#Chips"), "confirmed", { item: chips }))
    // A fresh request: the review list no longer shows the confirmed row.
    const review = await ok<Page>(listRows(admin, venueA, { source }))
    expect(review.rows).toEqual([])
    const mapped = await ok<Page>(
      listRows(admin, venueA, {
        source,
        statuses: ["confirmed", "carried"],
        item: chips,
      })
    )
    expect(mapped.rows).toHaveLength(1)
    const row = mapped.rows[0]!
    expect(row).toMatchObject({ status: "confirmed", reviewedBy: admin.id })
    const rice = A("sides--rice").itemId
    await fails(
      decide(
        {
          ...headAt(source, "s#Chips"),
          row_id: row.rowId,
          revision: row.revision,
        },
        "confirmed",
        { item: rice }
      ),
      "crosswalk_conflict"
    )
    await ok(
      decide(
        {
          ...headAt(source, "s#Chips"),
          row_id: row.rowId,
          revision: row.revision,
        },
        "rejected"
      )
    )
    const rejected = await ok<Page>(
      listRows(admin, venueA, { source, statuses: ["rejected"] })
    )
    await ok(
      decide(
        {
          ...headAt(source, "s#Chips"),
          row_id: rejected.rows[0]!.rowId,
          revision: rejected.rows[0]!.revision,
        },
        "confirmed",
        { item: rice }
      )
    )
    expect(
      (
        await ok<Page>(
          listRows(admin, venueA, { source, statuses: ["confirmed"] })
        )
      ).rows.map((r) => r.itemId)
    ).toEqual([rice])
  })

  it("pages the review queue past retained removed rows, admin only", async () => {
    const source = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const names = ["A1", "A2", "A3", "A4", "A5", "B1", "B2"]
    await ok(
      propose(
        await snapshot(
          source,
          "r1",
          names.map((n) => ({ locator: `s#${n}`, name: `TEST ${n}` }))
        )
      )
    )
    await ok(
      propose(
        await snapshot(
          source,
          "r2",
          ["B1", "B2"].map((n) => ({ locator: `s#${n}`, name: `TEST ${n}` }))
        )
      )
    )
    const seen: string[] = []
    let after: Cursor | null = null
    let pages = 0
    do {
      const page: Page = await ok<Page>(
        listRows(admin, venueA, { source, after, limit: 2 })
      )
      seen.push(...page.rows.map((r) => `${r.locator} ${r.status}`))
      after = page.next
      pages++
    } while (after && pages < 10)
    expect(pages).toBe(4)
    expect(seen).toEqual([
      ...["A1", "A2", "A3", "A4", "A5"].map((n) => `s#${n} not_on_source`),
      "s#B1 proposed",
      "s#B2 proposed",
    ])

    await fails(listRows(managerA, venueA), "not_active_admin", "42501")
    await fails(listRows(staffA, venueA), "not_active_admin", "42501")
    await fails(
      listRows(admin, venueB, { source }),
      "menu_source_not_found",
      "P0002"
    )
    await fails(
      listRows(admin, venueB, { after: { sourceId: source, locator: "s#A1" } }),
      "invalid_crosswalk_cursor"
    )
    await fails(
      listRows(admin, venueA, { statuses: ["deleted"] }),
      "invalid_crosswalk_status"
    )
    const m = await ok<{ reviewTruncated: boolean; reviewNext: unknown }>(
      manifest(admin, venueA)
    )
    expect(m).toMatchObject({ reviewTruncated: false, reviewNext: null })
    expect(
      await ok<{ reviewNext: unknown }>(manifest(managerA, venueA))
    ).toMatchObject({ reviewNext: null })
  })
})

describe("field authority (§4.4, OD-B4-1: inert defaults)", () => {
  it("reads the §4.4 defaults, awaiting the owner, for a venue with no rows", async () => {
    const m = await ok<{
      fields: {
        field: string
        channel: string
        authority: string
        basis: string
      }[]
    }>(manifest(admin, venueA))
    expect(
      m.fields.map((f) => [f.field, f.channel, f.authority, f.basis])
    ).toEqual(
      MENU_FIELDS.map((f) => [
        f,
        "all",
        DEFAULT_FIELD_AUTHORITY[f],
        "design_default",
      ])
    )
  })

  it("seeded only defaults: no field switched to NabaLens beyond identity and photos", () => {
    expect(
      rows(`select 1 from public.menu_field_authority
        where authority = 'nabalens' and field not in ('identity', 'photos')`)
    ).toEqual([])
    expect(
      rows(`select 1 from public.menu_field_authority
        where basis = 'design_default' and (approved_by is not null or supersedes is not null)`)
    ).toEqual([])
  })

  it("refuses a switch to NabaLens and a source of the wrong kind or venue", async () => {
    const site = await declare(
      venueA,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const design = await declare(
      venueA,
      "menu_design",
      `TEST design ${randomUUID()}`
    )
    const siteB = await declare(
      venueB,
      "venue_website",
      `TEST site ${randomUUID()}`
    )
    const set = (
      field: string,
      authority: string,
      source: string | null,
      key = randomUUID()
    ) =>
      rpc(admin, "menu_set_field_authority", {
        p_venue: venueA,
        p_field: field,
        p_channel: "all",
        p_authority: authority,
        p_source: source,
        p_reason: "TEST owner decision recorded by admin",
        p_request_key: key,
      })
    for (const field of MENU_FIELDS.filter(
      (f) => f !== "identity" && f !== "photos"
    ))
      await fails(
        set(field, "nabalens", null),
        "authority_switch_not_enabled",
        "P0001"
      )
    await fails(
      set("price", "venue_website", design),
      "menu_source_kind_mismatch"
    )
    await fails(
      set("name", "source_document", site),
      "menu_source_kind_mismatch"
    )
    await fails(set("price", "venue_website", siteB), "menu_source_not_found")
    await fails(set("price", "venue_website", null), "menu_source_required")
    const first = await ok<{ authorityId: string }>(
      set("price", "venue_website", site)
    )
    expect(await ok(set("price", "venue_website", site))).toMatchObject({
      authorityId: first.authorityId,
      unchanged: true,
    })
    const m = await ok<{
      fields: { field: string; basis: string; sourceId: string }[]
    }>(manifest(admin, venueA))
    expect(m.fields.find((f) => f.field === "price")).toMatchObject({
      basis: "owner_approval",
      sourceId: site,
    })
  })
})

describe("manifest (§4.2 #7, White Horse-style disagreement)", () => {
  it("lists every active entry, shows differing source prices and confirms nothing itself", async () => {
    const venue = (await createVenue(service, "crosswalk-wh")).id
    const version = await publishMenu(
      admin,
      venue,
      menu("TEST two sources", [
        section("mains", "Mains", [
          item("mains--pie", "Pie"),
          item("mains--fish", "Fish"),
        ]),
      ])
    )
    const doc = await readDocument(service, version)
    const site = await declare(venue, "venue_website", "TEST synthetic website")
    const design = await declare(
      venue,
      "menu_design",
      "TEST synthetic menu design"
    )
    await ok(
      propose(
        await snapshot(site, "w1", [
          { locator: "w#Pie", name: "Pie", priceText: "12.00" },
        ])
      )
    )
    await ok(
      propose(
        await snapshot(design, "d1", [
          {
            locator: "d#pie",
            name: "Pie",
            priceText: "12.50",
            sourceKey: "mains--pie",
          },
        ])
      )
    )
    expect(
      rows(`select 1 from public.menu_crosswalk_heads where venue_id = ${literal(venue)}
        and status in ('confirmed', 'carried')`)
    ).toEqual([])
    type Entry = {
      itemId: string
      outcomes: { sourceId: string; outcome: string; priceText?: string }[]
      priceDisagreement: boolean
    }
    const m = await ok<{ entries: Entry[]; review: unknown[] }>(
      manifest(admin, venue)
    )
    expect(m.entries.map((e) => e.itemId)).toEqual([
      doc.byKey["mains--pie"]!.itemId,
      doc.byKey["mains--fish"]!.itemId,
    ])
    const pie = m.entries[0]!
    expect(pie.outcomes).toEqual([
      { sourceId: site, outcome: "needs_review", priceText: "12.00" },
      { sourceId: design, outcome: "needs_review", priceText: "12.50" },
    ])
    expect(pie.priceDisagreement).toBe(true)
    expect(m.entries[1]!.outcomes.map((o) => o.outcome)).toEqual([
      "not_on_source",
      "not_on_source",
    ])
    expect(m.review).toHaveLength(2)
  })

  it("keeps internal detail out of the manager view (V11)", async () => {
    const text = JSON.stringify(await ok(manifest(managerA, venueA)))
    for (const forbidden of [
      '"locator"',
      '"priceText"',
      '"evidence"',
      '"reason"',
      '"approvedBy"',
      '"snapshotId"',
    ])
      expect(text).not.toContain(forbidden)
  })
})

describe("immutable provenance and untouched credit (§3, §13.2)", () => {
  it("refuses changes to snapshots, authority rows, crosswalk rows and heads for every role", () => {
    for (const sql of [
      "update public.menu_source_snapshots set notes = 'x'",
      "delete from public.menu_source_snapshots",
      "update public.menu_field_authority set reason = 'x'",
      "delete from public.menu_field_authority",
      "update public.menu_crosswalk set reason = 'x'",
      "delete from public.menu_crosswalk_heads",
      "update public.menu_crosswalk_heads set status = 'confirmed'",
      "update public.menu_sources set label = 'x'",
      "update public.menu_crosswalk_runs set run_at = now()",
      "delete from public.menu_crosswalk_runs",
      "truncate public.menu_crosswalk cascade",
    ])
      expect(() => psql(sql), sql).toThrow()
  })

  it("keeps the credit function byte-identical and writes no photo or catalogue row", () => {
    expect(
      psql(`select md5(pg_get_functiondef(
        'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`)
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
    // No B04-a function writes a catalogue, label or photo table.
    const writers = rows<{
      name: string
    }>(`select p.proname as name from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where (p.proname like 'menu\\_crosswalk%' or p.proname like 'menu\\_source%'
          or p.proname in ('menu_declare_source', 'menu_record_snapshot', 'menu_set_field_authority', 'menu_manifest'))
        and p.prosrc ~* '(insert into|update|delete from)\\s+public\\.(menu_items|menu_variants|menu_versions|menu_entries|menu_entry_variants|menu_item_photos|menu_item_photo_events|media_label_items)'`)
    expect(writers).toEqual([])
  })

  it("keeps the manifest one STABLE definer read and the commands volatile (T9b)", () => {
    const fns = rows<{
      name: string
      volatility: string
      definer: boolean
    }>(`select p.proname as name,
        p.provolatile as volatility, p.prosecdef as definer
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('menu_manifest', 'menu_declare_source',
        'menu_record_snapshot', 'menu_crosswalk_propose', 'menu_crosswalk_decide', 'menu_set_field_authority',
        'menu_crosswalk_rows')
      order by 1`)
    expect(fns).toEqual([
      { name: "menu_crosswalk_decide", volatility: "v", definer: true },
      { name: "menu_crosswalk_propose", volatility: "v", definer: true },
      { name: "menu_crosswalk_rows", volatility: "s", definer: true },
      { name: "menu_declare_source", volatility: "v", definer: true },
      { name: "menu_manifest", volatility: "s", definer: true },
      { name: "menu_record_snapshot", volatility: "v", definer: true },
      { name: "menu_set_field_authority", volatility: "v", definer: true },
    ])
  })
})

describe("TS/SQL parity of the name key and content hash", () => {
  const names = [
    "Chicken Tikka",
    "  chicken   TIKKA!! ",
    "Café crème",
    "Café crème",
    "Fish & Chips",
    "Fish and\tchips",
    "½ Pint",
    "Ünïcödé — Dish",
    "",
    // Unicode numbers beyond decimal digits (No, Nl) and other scripts' Nd.
    "Pint",
    "Ⅻ Course ⅲ \u{10140}",
    "٣ Kebabs ३ Samosa",
    // NFC composes several marks; a mark with no composed form is removed.
    "Phở Bò",
    "x́ y⃝",
    // Whole-string lower case: a final sigma and a dotted capital I.
    "ΟΔΟΣ ΣΟΣ",
    "İstanbul",
    // JavaScript whitespace collapses; a zero width space is not whitespace.
    " Fish and　Chips Tea​Cake﻿ ",
    "A-B (Large), £5!",
    // Numeric-looking symbols outside N.
    "№ 5 #1 ℅",
  ]
  it("normalises names alike", () => {
    const got = rows<{
      k: string
    }>(`select private.menu_crosswalk_name_key(x) as k
      from unnest(array[${names.map(literal).join(", ")}]::text[]) with ordinality as t(x, n) order by n`)
    expect(got.map((r) => r.k)).toEqual(names.map(nameKey))
  })

  it("hashes entries alike", async () => {
    const entries: SnapshotEntry[] = [
      { locator: "a", name: "Pie" },
      {
        locator: "b",
        name: 'Pie "special"\n',
        description: "Tab\there",
        variants: ["Half", "Full"],
        labels: ["GF"],
        priceText: "£10.50",
      },
      { locator: "c", name: "Ünïcödé", priceText: null, description: null },
    ]
    const got = rows<{
      h: string
    }>(`select private.menu_crosswalk_content_hash(e) as h
      from jsonb_array_elements(${literal(JSON.stringify(entries))}::jsonb) with ordinality as t(e, n)
      order by n`)
    expect(got.map((r) => r.h)).toEqual(
      await Promise.all(entries.map((e) => sha256Hex(contentHashInput(e))))
    )
  })
})

describe("name key: Unicode numbers keep names apart (§4.2 #4)", () => {
  it("proposes '½ Pint' and 'Pint' each to its own item, as the TypeScript matcher does", async () => {
    const venue = (await createVenue(service, "crosswalk-pint")).id
    const doc = await readDocument(
      service,
      await publishMenu(
        admin,
        venue,
        menu("TEST pints", [
          section("beer", "Beer", [
            item("beer--half-pint", "½ Pint"),
            item("beer--pint", "Pint"),
          ]),
        ])
      )
    )
    const source = await declare(venue, "venue_website", "TEST synthetic pints")
    const entries: SnapshotEntry[] = [
      { locator: "beer#½ Pint", name: "½ Pint", priceText: "3.20" },
      { locator: "beer#Pint", name: "Pint", priceText: "5.90" },
    ]
    const snap = await snapshot(source, "p1", entries)
    const result = await ok<{ counts: Record<string, number> }>(propose(snap))
    expect(result.counts).toMatchObject({ proposed: 2, ambiguous: 0 })
    const half = doc.byKey["beer--half-pint"]!.itemId
    const pint = doc.byKey["beer--pint"]!.itemId
    expect(
      heads(source).map((h) => [h.locator, h.status, h.item_id, h.candidates])
    ).toEqual([
      ["beer#Pint", "proposed", pint, [pint]],
      ["beer#½ Pint", "proposed", half, [half]],
    ])
    const expected = proposeCrosswalk({
      snapshotId: snap,
      sourceKind: "venue_website",
      entries,
      contentHashes: await Promise.all(
        entries.map((e) => sha256Hex(contentHashInput(e)))
      ),
      catalogue: catalogueOf(doc),
      heads: [],
    })
    expect(rowsFrom(source, snap, 0)).toEqual(
      expected.rows.map((r) => [
        r.locator,
        r.status,
        r.itemId,
        r.variantId,
        r.candidates,
        r.contentHash,
      ])
    )
  })
})
