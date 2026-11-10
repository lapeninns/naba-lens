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
  DEFAULT_FIELD_AUTHORITY,
  MENU_FIELDS,
  contentHashInput,
  proposeCrosswalk,
  snapshotDocumentError,
  type CatalogueEntry,
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
  rows<Head>(`select h.* from public.menu_crosswalk_heads h
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
    const catalogue: CatalogueEntry[] = docA.sections.flatMap((s) =>
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
    const expected = proposeCrosswalk({
      snapshotId: snap,
      sourceKind: "venue_website",
      entries,
      contentHashes: await Promise.all(
        entries.map((e) => sha256Hex(contentHashInput(e)))
      ),
      catalogue,
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
        'menu_record_snapshot', 'menu_crosswalk_propose', 'menu_crosswalk_decide', 'menu_set_field_authority')
      order by 1`)
    expect(fns).toEqual([
      { name: "menu_crosswalk_decide", volatility: "v", definer: true },
      { name: "menu_crosswalk_propose", volatility: "v", definer: true },
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
