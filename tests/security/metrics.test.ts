// Full App v1, S2-METRICS: the measures of spec §18.1 and the instrumentation
// of §18.3 (AC39, AC21, AC13). Migrations 20261118117000-117100. Real
// signed-in identities through PostgREST for every public function: own
// venue, other venue, staff, manager, admin, inactive and anon. The service
// role and psql only build fixtures and read back.
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  markReady,
  type TestIdentity,
} from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  json,
  service,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  reserveReady,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type Counts = Record<string, number>
type Metrics = {
  venueId: string
  venueName: string
  days: number
  coverage: {
    categories: Array<{ category: string } & Counts>
    totals: Counts
  }
  slots: Array<{
    kind: string
    slotId: string
    category: string
    state: string
    counted: boolean
  }>
  items: Array<{ category: string; satisfied: number; total: number }>
  facts: { numerator: number; denominator: number }
  review: {
    decided: number
    medianSeconds: number | null
    processing: { count: number }
  }
  labels: {
    reviewed: number
    corrected: number
    byRoute: Array<{ route: string; reviewed: number; corrected: number }>
    labelledByReviewer: number
  }
  needsLabel: { count: number; inManagerQueue: number }
  contributions: Counts
  contentUse: { exports: Counts; publications: Counts }
  reliability: Counts
  flow: Array<{ name: string; route: string | null; count: number }>
}

const metrics = (who: TestIdentity, venue?: string, days?: number) =>
  json<Metrics>(who, "venue_metrics", {
    ...(venue ? { p_venue_id: venue } : {}),
    ...(days ? { p_days: days } : {}),
  })

async function errorOf(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  return error?.message ?? null
}

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

type V = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
  place: string
}

const MENU = () =>
  menu("TEST metrics", [
    section("mains", "Mains", [
      item("mains--pie", "Pie"),
      item("mains--fish", "Fish"),
      item("mains--soup", "Soup"),
      item("mains--tart", "Tart"),
    ]),
    section("drinks", "Drinks", [item("drinks--ale", "Ale")], "drinks"),
  ])

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(w.admin, w.venue, MENU())
  const items = (await readDocument(service, version)).byKey
  const place = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Garden', '${w.admin.id}') returning id`
  )
  return { w, version, items, place }
}

/** A ready photo; a duplicate is linked before it is ready (finalise's rule). */
async function readyPhoto(who: TestIdentity, duplicateOf?: string) {
  if (!duplicateOf) return reserveReady(service, who)
  const asset = await reserve(who)
  psql(
    `update public.media_assets set duplicate_of_asset_id = '${duplicateOf}' where id = '${asset.id}'`
  )
  await markReady(service, asset.id)
  return asset
}

async function dishPhoto(
  v: V,
  who: TestIdentity,
  itemId: string,
  duplicateOf?: string
) {
  const asset = await readyPhoto(who, duplicateOf)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    items: [{ itemId, variantId: null }],
    catalogue: v.version,
  })
  return asset.id
}

const setLevel = async (
  who: TestIdentity,
  asset: string,
  itemId: string,
  level: "public" | "reference"
) =>
  ok(
    call(who, "set_menu_item_photo_level", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null,
      p_level: level,
      p_expected_revision: head(itemId),
    })
  )

const event = (venue: string, extra: Record<string, unknown> = {}) => ({
  name: "flow_started",
  route: "gallery",
  venueId: venue,
  count: 2,
  clientEventId: randomUUID(),
  occurredAt: new Date().toISOString(),
  ...extra,
})

const record = (who: TestIdentity, events: unknown[]) =>
  call(who, "record_product_events", { p_events: events })

let v: V
let other: V
let inactive: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("met-a"), venue("met-b")])
  inactive = await createIdentity(service, {
    label: "met-inactive",
    role: "staff",
    venueId: v.w.venue,
  })
  await ok(
    service.from("profiles").update({ active: false }).eq("id", inactive.id)
  )
})

afterAll(() => {
  psql(
    `delete from public.product_events where venue_id in ('${v.w.venue}', '${other.w.venue}')`
  )
})

// ---------------------------------------------------------------------------

describe("venue_metrics: access", () => {
  it("serves the venue's manager and an admin naming it", async () => {
    const mine = await metrics(v.w.manager)
    expect(mine.venueId).toBe(v.w.venue)
    expect(mine.days).toBe(30)
    const theirs = await metrics(v.w.admin, v.w.venue)
    expect(theirs.venueId).toBe(v.w.venue)
    expect(theirs.coverage).toEqual(mine.coverage)
  })

  it("refuses staff, another venue's manager, an admin without a venue, the inactive and anon", async () => {
    expect(await errorOf(call(v.w.staffA, "venue_metrics", {}))).toBe(
      "not_venue_manager"
    )
    expect(
      await errorOf(
        call(v.w.staffA, "venue_metrics", { p_venue_id: v.w.venue })
      )
    ).toBe("not_venue_manager")
    expect(
      await errorOf(
        call(v.w.manager, "venue_metrics", { p_venue_id: other.w.venue })
      )
    ).toBe("not_venue_manager")
    expect(await errorOf(call(v.w.admin, "venue_metrics", {}))).toBe(
      "venue_required"
    )
    expect(
      await errorOf(
        call(v.w.admin, "venue_metrics", { p_venue_id: randomUUID() })
      )
    ).toBe("venue_not_found")
    expect(await errorOf(call(inactive, "venue_metrics", {}))).toBe(
      "not_active_user"
    )
    const anon = await anonClient().rpc("venue_metrics" as never, {} as never)
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })

  it("refuses a period outside 1 to 366 days", async () => {
    for (const days of [0, 367]) {
      expect(
        await errorOf(call(v.w.manager, "venue_metrics", { p_days: days }))
      ).toBe("invalid_period")
    }
  })
})

describe("metrics_overview: access", () => {
  it("lists every active venue for an admin, without slots", async () => {
    const read = await json<{
      days: number
      failedJobs: number
      venues: Array<Metrics & { slots?: unknown }>
    }>(v.w.admin, "metrics_overview", { p_days: 7 })
    expect(read.days).toBe(7)
    const row = read.venues.find((r) => r.venueId === v.w.venue)
    expect(row).toBeDefined()
    expect(row!.slots).toBeUndefined()
    expect(read.venues.some((r) => r.venueId === other.w.venue)).toBe(true)
    // Inactive venues are left out.
    const inactiveVenues = psql(
      `select coalesce(string_agg(id::text, ','), '') from public.venues where not active`
    )
      .split(",")
      .filter(Boolean)
    for (const id of inactiveVenues)
      expect(read.venues.some((r) => r.venueId === id)).toBe(false)
  })

  it("refuses a manager, staff, the inactive and anon", async () => {
    for (const who of [v.w.manager, v.w.staffA, inactive])
      expect(await errorOf(call(who, "metrics_overview", {}))).toBe("not_admin")
    const anon = await anonClient().rpc(
      "metrics_overview" as never,
      {} as never
    )
    expect(anon.error).not.toBeNull()
  })
})

describe("coverage: one rule, reproducible (AC39, §18.2)", () => {
  it("equals coverage_slots and reproduces each numerator and denominator", async () => {
    const read = await metrics(v.w.manager)
    const slots = await json<{
      totals: Counts
      categories: Array<{ category: string } & Counts>
    }>(v.w.manager, "coverage_slots", {})
    expect(read.coverage.totals).toEqual(slots.totals)
    expect(read.coverage.categories).toEqual(slots.categories)
    const counted = read.slots.filter((s) => s.counted)
    expect(read.coverage.totals.total).toBe(counted.length)
    expect(read.coverage.totals.covered).toBe(
      counted.filter((s) => s.state === "covered").length
    )
    for (const c of read.coverage.categories) {
      const mine = counted.filter((s) => s.category === c.category)
      expect(c.total, c.category).toBe(mine.length)
      expect(c.covered, c.category).toBe(
        mine.filter((s) => s.state === "covered").length
      )
    }
  })

  it("is not moved by a reference photo or an extra photo of a covered dish", async () => {
    const soup = v.items["mains--soup"]!.itemId
    const before = (await metrics(v.w.manager)).coverage.totals
    const ref = await dishPhoto(v, v.w.staffA, soup)
    await setLevel(v.w.manager, ref, soup, "reference")
    const afterRef = (await metrics(v.w.manager)).coverage.totals
    expect(afterRef.covered).toBe(before.covered)
    expect(afterRef.total).toBe(before.total)

    const first = await dishPhoto(v, v.w.staffA, soup)
    await setLevel(v.w.manager, first, soup, "public")
    const covered = (await metrics(v.w.manager)).coverage.totals
    expect(covered.covered).toBe(before.covered + 1)

    const extra = await dishPhoto(v, v.w.staffB, soup)
    await setLevel(v.w.manager, extra, soup, "public")
    const afterExtra = (await metrics(v.w.manager)).coverage.totals
    expect(afterExtra.covered).toBe(covered.covered)
    expect(afterExtra.total).toBe(covered.total)
  })

  it("reports item coverage per category, with food and drinks equal to their slots", async () => {
    const read = await metrics(v.w.manager)
    for (const key of ["food", "drinks", "spaces"]) {
      const cat = read.coverage.categories.find((c) => c.category === key)!
      const it = read.items.find((i) => i.category === key)!
      expect(it).toEqual({
        category: key,
        satisfied: cat.covered,
        total: cat.total,
      })
    }
    const fac = read.items.find((i) => i.category === "facilities")!
    expect(fac.total).toBe(read.facts.denominator)
    expect(fac.satisfied).toBeLessThanOrEqual(read.facts.numerator)
  })

  it("reports fact coverage on knowledge_fact_coverage's rule", async () => {
    const read = await metrics(v.w.manager)
    const facts = await json<{ numerator: number; denominator: number }>(
      v.w.manager,
      "knowledge_fact_coverage",
      { p_venue_id: v.w.venue }
    )
    expect(read.facts.numerator).toBe(facts.numerator)
    expect(read.facts.denominator).toBe(facts.denominator)
  })
})

describe("useful contributions (§18.1, AC21)", () => {
  it("counts a first fulfilment and a replacement, never an extra, a repeat, a reference or a duplicate", async () => {
    const fish = v.items["mains--fish"]!.itemId
    const before = (await metrics(v.w.manager)).contributions
    const mineBefore = await json<Counts>(
      v.w.staffA,
      "my_contribution_metrics",
      {}
    )
    const theirsBefore = await json<Counts>(
      v.w.staffB,
      "my_contribution_metrics",
      {}
    )

    // First fulfilment by A.
    const a = await dishPhoto(v, v.w.staffA, fish)
    await setLevel(v.w.manager, a, fish, "public")
    // An extra by B while A's photo is current.
    const b = await dishPhoto(v, v.w.staffB, fish)
    await setLevel(v.w.manager, b, fish, "public")
    // A reference photo by B: never a contribution.
    const ref = await dishPhoto(v, v.w.staffB, fish)
    await setLevel(v.w.manager, ref, fish, "reference")
    // Both current photos stop being public; then B's next one replaces them.
    await setLevel(v.w.manager, a, fish, "reference")
    await setLevel(v.w.manager, b, fish, "reference")
    const c = await dishPhoto(v, v.w.staffB, fish)
    await setLevel(v.w.manager, c, fish, "public")
    // A's photo made public again: a repeat, not a new contribution.
    await setLevel(v.w.manager, a, fish, "public")
    // A duplicate never counts.
    const dup = await dishPhoto(v, v.w.staffA, fish, a)
    await setLevel(v.w.manager, dup, fish, "public")

    const after = (await metrics(v.w.manager)).contributions
    expect(after.firstFulfilment - before.firstFulfilment).toBe(1)
    expect(after.replacement - before.replacement).toBe(1)
    expect(after.useful - before.useful).toBe(2)
    expect(after.extra - before.extra).toBe(1)
    expect(after.duplicates - before.duplicates).toBe(1)

    // Each person sees only their own.
    const mine = await json<Counts>(v.w.staffA, "my_contribution_metrics", {})
    const theirs = await json<Counts>(v.w.staffB, "my_contribution_metrics", {})
    expect(mine.useful - mineBefore.useful).toBe(1)
    expect(mine.firstFulfilment - mineBefore.firstFulfilment).toBe(1)
    expect(theirs.useful - theirsBefore.useful).toBe(1)
    expect(theirs.replacement - theirsBefore.replacement).toBe(1)
    expect(theirs.extra - theirsBefore.extra).toBe(1)
  })

  it("refuses my_contribution_metrics to the inactive and anon", async () => {
    expect(await errorOf(call(inactive, "my_contribution_metrics", {}))).toBe(
      "not_active_user"
    )
    const anon = await anonClient().rpc(
      "my_contribution_metrics" as never,
      {} as never
    )
    expect(anon.error).not.toBeNull()
  })
})

describe("label correction by route, needs label and review delay", () => {
  it("counts a corrected label against the route recorded at submission", async () => {
    const pie = v.items["mains--pie"]!.itemId
    const tart = v.items["mains--tart"]!.itemId
    const before = (await metrics(v.w.manager)).labels
    const wrong = await dishPhoto(v, v.w.staffA, pie)
    const right = await dishPhoto(v, v.w.staffA, tart)
    expect(
      await ok(
        record(v.w.staffA, [
          event(v.w.venue, {
            name: "submitted",
            route: "gallery",
            assetId: wrong,
          }),
          event(v.w.venue, { name: "submitted", route: "slot", assetId: right }),
        ])
      )
    ).toBe(2)
    // The reviewer chooses Tart for the photo labelled Pie.
    await ok(
      call(v.w.manager, "assign_menu_item_photo", {
        p_asset_id: wrong,
        p_item_id: tart,
        p_variant_id: null,
        p_corrects_item_id: pie,
        p_corrects_variant_id: null,
        p_reason: "TEST it is the tart",
        p_expected_revision: head(tart),
      })
    )
    await setLevel(v.w.manager, right, tart, "public")

    const after = (await metrics(v.w.manager)).labels
    expect(after.reviewed - before.reviewed).toBe(2)
    expect(after.corrected - before.corrected).toBe(1)
    const route = (r: string) =>
      after.byRoute.find((x) => x.route === r) ?? {
        reviewed: 0,
        corrected: 0,
      }
    expect(route("gallery")).toMatchObject({ reviewed: 1, corrected: 1 })
    expect(route("slot")).toMatchObject({ reviewed: 1, corrected: 0 })

    // Each decision has a review delay; each upload a processing time.
    const review = (await metrics(v.w.manager)).review
    expect(review.decided).toBeGreaterThanOrEqual(2)
    expect(review.medianSeconds).toBeGreaterThanOrEqual(0)
    expect(review.processing.count).toBeGreaterThan(0)
  })

  it("counts ready photos awaiting a label, leaving duplicates out", async () => {
    const before = (await metrics(v.w.manager)).needsLabel.count
    const loose = await reserveReady(service, v.w.staffB)
    await readyPhoto(v.w.staffB, loose.id)
    const after = (await metrics(v.w.manager)).needsLabel
    expect(after.count - before).toBe(1)
    expect(after.inManagerQueue).toBeLessThanOrEqual(after.count)
  })
})

describe("reliability: technical apart from editorial", () => {
  it("counts a failed upload as technical and a retake as editorial", async () => {
    const before = (await metrics(v.w.manager)).reliability
    const asset = await reserve(v.w.staffA)
    psql(
      `update public.media_assets set upload_state = 'failed' where id = '${asset.id}'`
    )
    const area = (await reserveReady(service, v.w.staffA)).id
    const [row] = (await ok(
      v.w.staffA.client.rpc("set_media_area_label", {
        p_asset_id: area,
        p_subject_id: v.place,
      })
    ))!
    await ok(
      call(v.w.manager, "decide_area_photo_level", {
        p_label_id: row!.label_id,
        p_action: "needs_another_photo",
        p_level: "public",
        p_reason: "TEST too dark",
      })
    )
    await ok(
      record(v.w.staffA, [
        event(v.w.venue, { name: "transfer_failed", stage: "transfer" }),
        event(v.w.venue, { name: "transfer_retried", stage: "transfer" }),
      ])
    )
    const after = (await metrics(v.w.manager)).reliability
    expect(after.failed - before.failed).toBe(1)
    expect(after.technical - before.technical).toBe(1)
    expect(after.editorial - before.editorial).toBe(1)
    expect(after.clientFailures - before.clientFailures).toBe(1)
    expect(after.clientRetries - before.clientRetries).toBe(1)
    // The failed upload is remembered with its failure.
    expect(
      psql(
        `select failure_count from public.media_state_times where asset_id = '${asset.id}'`
      )
    ).toBe("1")
  })
})

describe("record_product_events (§18.3, AC13)", () => {
  it("stores an event from the person's own venue once, and reports it", async () => {
    const one = event(v.w.venue, { name: "batch_grouped", count: 3 })
    expect(await ok(record(v.w.staffB, [one]))).toBe(1)
    // A replayed client event id is not stored twice.
    expect(await ok(record(v.w.staffB, [one]))).toBe(0)
    expect(
      psql(
        `select actor_role || ',' || item_count from public.product_events
         where client_event_id = '${one.clientEventId}'`
      )
    ).toBe("staff,3")
    const flow = (await metrics(v.w.manager)).flow
    expect(
      flow.find((f) => f.name === "batch_grouped" && f.route === "gallery")
        ?.count
    ).toBeGreaterThanOrEqual(1)
  })

  it("lets the manager and an admin record at the venue", async () => {
    expect(await ok(record(v.w.manager, [event(v.w.venue)]))).toBe(1)
    expect(await ok(record(v.w.admin, [event(other.w.venue)]))).toBe(1)
  })

  it("refuses any field outside the allowlist: no location, file names or notes", async () => {
    for (const extra of [
      { latitude: 51.5 },
      { lng: -0.1 },
      { location: "Garden" },
      { exif: "GPS" },
      { fileName: "IMG_0001.HEIC" },
      { note: "free text" },
    ]) {
      expect(
        await errorOf(record(v.w.staffA, [event(v.w.venue, extra)])),
        Object.keys(extra)[0]
      ).toBe("event_field_not_allowed")
    }
    // Free text can't hide in an allowed field either.
    expect(
      await errorOf(
        record(v.w.staffA, [event(v.w.venue, { outcome: "Bad photo: GPS" })])
      )
    ).toBe("invalid_events")
    expect(
      await errorOf(
        record(v.w.staffA, [event(v.w.venue, { name: "location_seen" })])
      )
    ).toBe("invalid_events")
    expect(
      await errorOf(
        record(v.w.staffA, [event(v.w.venue, { count: { lat: 1 } })])
      )
    ).toBe("invalid_events")
    expect(
      psql(
        `select count(*) from public.product_events where actor_id = '${v.w.staffA.id}' and outcome is not null`
      )
    ).toBe("0")
  })

  it("refuses another venue, another person's photo, too many events, the inactive and anon", async () => {
    expect(
      await errorOf(record(v.w.staffA, [event(other.w.venue)]))
    ).toBe("wrong_venue")
    expect(
      await errorOf(record(v.w.manager, [event(other.w.venue)]))
    ).toBe("wrong_venue")
    const theirs = await reserveReady(service, other.w.staffA)
    expect(
      await errorOf(
        record(v.w.staffA, [event(v.w.venue, { assetId: theirs.id })])
      )
    ).toBe("event_asset_not_found")
    const colleague = await reserveReady(service, v.w.staffB)
    expect(
      await errorOf(
        record(v.w.staffA, [event(v.w.venue, { assetId: colleague.id })])
      )
    ).toBe("event_asset_not_found")
    expect(
      await errorOf(
        record(
          v.w.staffA,
          Array.from({ length: 51 }, () => event(v.w.venue))
        )
      )
    ).toBe("too_many_events")
    expect(await errorOf(record(inactive, [event(v.w.venue)]))).toBe(
      "not_active_user"
    )
    const anon = await anonClient().rpc(
      "record_product_events" as never,
      { p_events: [event(v.w.venue)] } as never
    )
    expect(anon.error).not.toBeNull()
  })

  it("keeps the tables closed to direct reads and writes", async () => {
    for (const table of ["product_events", "media_state_times"]) {
      const read = await v.w.manager.client
        .from(table as never)
        .select("*")
        .limit(1)
      expect(read.error, table).not.toBeNull()
      const write = await v.w.staffA.client
        .from(table as never)
        .insert({} as never)
      expect(write.error, table).not.toBeNull()
    }
  })
})
