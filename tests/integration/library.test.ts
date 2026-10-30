import { randomUUID } from "node:crypto"

import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { MEDIA_LIMITS } from "../../lib/config/media"
import {
  getReadableAsset,
  PRIVATE_HEADERS,
  signDerivative,
  signedUrlTtlSeconds,
  streamOriginal,
} from "../../lib/server/media/access"
import { listLibrary, listOwnMedia } from "../../lib/server/media/library"
import type {
  LibraryFilters,
  MediaActor,
  MediaItemView,
} from "../../lib/server/media/types"
import {
  feedCompare,
  setupIdentity,
  newestFirst,
  secondsBefore,
  seedAsset,
  type SeededAsset,
} from "../library/seed"
import { actorFor } from "../slice/media-actor"
import {
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

/**
 * Library correctness (spec §3 admin library, §6 stable cursor pagination, §7
 * signed reads) against the local stack. The database is shared with other
 * suites, so every assertion is scoped to rows this file created: filters use
 * fresh venues and staff, and unfiltered feeds are checked on our subset.
 */

const service = serviceClient()
const PAGE = MEDIA_LIMITS.pageSize
// Identity setup can wait on a loaded local auth server (see setupIdentity).
const SETUP_TIMEOUT = 180_000
const NO_FILTERS: LibraryFilters = { venueId: null, staffId: null, type: null }

// Few identities: the local auth server is slow when several stacks share the
// machine. seedAsset writes any (uploader, venue) pair, so most tests share
// `solo` and scope their feed by a fresh venue instead.
let adminUser: TestIdentity
let admin: MediaActor
let homeVenue: { id: string; name: string }
let solo: TestIdentity

beforeAll(async () => {
  homeVenue = await createVenue(service, "lib-home")
  adminUser = await setupIdentity(service, {
    label: "lib-admin",
    role: "admin",
  })
  solo = await setupIdentity(service, {
    label: "lib-solo",
    role: "staff",
    venueId: homeVenue.id,
  })
  admin = await actorFor(adminUser)
}, SETUP_TIMEOUT)

/** Every page of a feed, following nextCursor; fails on a repeated id. */
async function allPages(
  list: (cursor: string | null) => ReturnType<typeof listLibrary>,
  maxPages = 200
) {
  const items: MediaItemView[] = []
  const pageSizes: number[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPages; i++) {
    const page = await list(cursor)
    if (!page.ok) throw new Error(page.message)
    items.push(...page.items)
    pageSizes.push(page.items.length)
    cursor = page.nextCursor
    if (!cursor) break
  }
  expect(cursor, "feed did not end").toBeNull()
  const ids = items.map((i) => i.id)
  expect(new Set(ids).size, "duplicate ids across pages").toBe(ids.length)
  return { items, ids, pageSizes }
}

/** The feed's own order: (created_at desc, id desc), strictly. */
function expectFeedOrder(items: MediaItemView[]) {
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]
    const b = items[i]
    expect(
      feedCompare(a, b) < 0,
      `${a.id}@${a.createdAt} before ${b.id}@${b.createdAt}`
    ).toBe(true)
  }
}

describe("newest-first order", () => {
  it("orders by created_at desc with id desc as the tiebreak, in every feed", async () => {
    const venue = await createVenue(service, "lib-order")
    const staff = await setupIdentity(service, {
      label: "lib-order",
      role: "staff",
      venueId: venue.id,
    })
    const base = new Date(Date.now() - 3600_000)
    const tie = secondsBefore(base, 5)
    // Inserted out of order; three share one timestamp.
    const seeded: SeededAsset[] = []
    for (const offset of [3, 9, 1, 7]) {
      seeded.push(
        await seedAsset(service, {
          uploaderId: staff.id,
          venueId: venue.id,
          createdAt: secondsBefore(base, offset),
        })
      )
    }
    for (let i = 0; i < 3; i++) {
      seeded.push(
        await seedAsset(service, {
          uploaderId: staff.id,
          venueId: venue.id,
          createdAt: tie,
        })
      )
    }
    const expected = newestFirst(seeded).map((s) => s.id)

    const byStaff = await allPages((c) =>
      listLibrary(admin, { ...NO_FILTERS, staffId: staff.id }, c)
    )
    expect(byStaff.ids).toEqual(expected)
    const byVenue = await allPages((c) =>
      listLibrary(admin, { ...NO_FILTERS, venueId: venue.id }, c)
    )
    expect(byVenue.ids).toEqual(expected)
    const owner = await actorFor(staff)
    const own = await allPages((c) => listOwnMedia(owner, c))
    expect(own.ids).toEqual(expected)

    // The central feed (shared with other suites): globally ordered, and our
    // rows appear in the same relative order.
    const first = await listLibrary(admin, NO_FILTERS)
    if (!first.ok) throw new Error(first.message)
    expectFeedOrder(first.items)
  })
})

describe("stable cursor pagination", () => {
  it("pages equal timestamps by id with no duplicates or skips", async () => {
    const venue = await createVenue(service, "lib-ties")
    const staff = solo
    const createdAt = new Date(Date.now() - 7200_000).toISOString()
    const seeded: SeededAsset[] = []
    for (let i = 0; i < PAGE * 2 + 3; i++) {
      seeded.push(
        await seedAsset(service, {
          uploaderId: staff.id,
          venueId: venue.id,
          createdAt,
        })
      )
    }
    const feed = await allPages((c) =>
      listLibrary(admin, { ...NO_FILTERS, venueId: venue.id }, c)
    )
    expect(feed.pageSizes).toEqual([PAGE, PAGE, 3])
    expect(feed.ids).toEqual(newestFirst(seeded).map((s) => s.id))
  })

  it("keeps later pages exact while new uploads and deletions arrive between pages", async () => {
    const venue = await createVenue(service, "lib-concurrent")
    const staff = solo
    const base = new Date(Date.now() - 600_000)
    const seeded: SeededAsset[] = []
    for (let i = 0; i < PAGE + 10; i++) {
      seeded.push(
        await seedAsset(service, {
          uploaderId: staff.id,
          venueId: venue.id,
          createdAt: secondsBefore(base, i),
        })
      )
    }
    const filters = { ...NO_FILTERS, venueId: venue.id }
    const first = await listLibrary(admin, filters)
    if (!first.ok) throw new Error(first.message)
    expect(first.items.map((i) => i.id)).toEqual(
      seeded.slice(0, PAGE).map((s) => s.id)
    )
    const boundary = first.items.at(-1)!

    // Between page 1 and page 2: five new uploads land at the top, concurrently.
    const fresh = await Promise.all(
      Array.from({ length: 5 }, () =>
        seedAsset(service, { uploaderId: staff.id, venueId: venue.id })
      )
    )
    // Two rows land exactly on the cursor's timestamp. The (created_at, id)
    // order puts the smaller id after the boundary, so page 2 must include
    // it; the larger id sorts before the boundary, so it shows up only on a
    // refresh of the first page.
    const hex = () => randomUUID().slice(-12)
    const tieAfter = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
      createdAt: boundary.createdAt,
      id: `00000000-0000-4000-8000-${hex()}`,
    })
    const tieBefore = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
      createdAt: boundary.createdAt,
      id: `ffffffff-ffff-4fff-bfff-${hex()}`,
    })
    expect(tieAfter.id < boundary.id && tieBefore.id > boundary.id).toBe(true)
    // And one older, already-unseen asset is deleted.
    const removed = seeded[PAGE + 2]
    await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", removed.id)

    const rest = await allPages((c) =>
      listLibrary(admin, filters, c ?? first.nextCursor)
    )
    const expectedRest = newestFirst([
      ...seeded.slice(PAGE).filter((s) => s.id !== removed.id),
      tieAfter,
    ]).map((s) => s.id)
    expect(rest.ids).toEqual(expectedRest)
    // Nothing from page 1 repeats, and the new uploads are not on later pages.
    const firstIds = new Set(first.items.map((i) => i.id))
    expect(rest.ids.some((id) => firstIds.has(id))).toBe(false)
    expect(rest.ids.some((id) => fresh.some((f) => f.id === id))).toBe(false)
    expect(rest.ids).not.toContain(tieBefore.id)

    // A refresh (first page, no cursor) brings the new uploads to the top.
    const refreshed = await listLibrary(admin, filters)
    if (!refreshed.ok) throw new Error(refreshed.message)
    expect(new Set(refreshed.items.slice(0, 5).map((i) => i.id))).toEqual(
      new Set(fresh.map((f) => f.id))
    )
    // Starting over from the top, the whole feed is exact again.
    const whole = await allPages((c) => listLibrary(admin, filters, c))
    expect(whole.ids).toEqual(
      newestFirst([
        ...fresh,
        ...seeded.filter((s) => s.id !== removed.id),
        tieAfter,
        tieBefore,
      ]).map((s) => s.id)
    )
  })

  it("rejects a forged or malformed cursor", async () => {
    for (const cursor of [
      "garbage",
      Buffer.from('["not-a-date","x"]').toString("base64url"),
      Buffer.from(
        JSON.stringify(["2026-01-01T00:00:00Z", "1' or 1=1 --"])
      ).toString("base64url"),
    ]) {
      expect(await listLibrary(admin, NO_FILTERS, cursor)).toMatchObject({
        ok: false,
        status: 400,
      })
    }
  })
})

describe("filters", () => {
  // Two venues, two staff, both types; staff 1 transfers from A to B, so their
  // media sits at both venues (each asset keeps its upload-time venue).
  let venueA: { id: string; name: string }
  let venueB: { id: string; name: string }
  let staff1: TestIdentity
  let staff2: TestIdentity
  let seeded: SeededAsset[]

  beforeAll(async () => {
    venueA = await createVenue(service, "lib-filter-a")
    venueB = await createVenue(service, "lib-filter-b")
    staff1 = await setupIdentity(service, {
      label: "lib-filter-1",
      role: "staff",
      venueId: venueA.id,
    })
    staff2 = await setupIdentity(service, {
      label: "lib-filter-2",
      role: "staff",
      venueId: venueB.id,
    })
    const base = new Date(Date.now() - 1800_000)
    const plan: [TestIdentity, { id: string }, "image" | "video", number][] = [
      [staff1, venueA, "image", 3],
      [staff1, venueA, "video", 2],
      [staff1, venueB, "image", 2],
      [staff1, venueB, "video", 1],
      [staff2, venueB, "image", 3],
      [staff2, venueB, "video", 1],
    ]
    seeded = []
    let n = 0
    for (const [who, venue, type, count] of plan) {
      for (let i = 0; i < count; i++) {
        seeded.push(
          await seedAsset(service, {
            uploaderId: who.id,
            venueId: venue.id,
            type,
            createdAt: secondsBefore(base, n++),
          })
        )
      }
    }
  }, SETUP_TIMEOUT)

  it("combines every venue x staff x type choice (including cleared) correctly", async () => {
    const ours = new Set(seeded.map((s) => s.id))
    const venues = [null, venueA, venueB]
    const staffs = [null, staff1, staff2]
    const types = [null, "image", "video"] as const
    let empties = 0
    for (const venue of venues) {
      for (const who of staffs) {
        for (const type of types) {
          const filters: LibraryFilters = {
            venueId: venue?.id ?? null,
            staffId: who?.id ?? null,
            type,
          }
          const label = JSON.stringify([venue?.name, who?.id, type])
          const unscoped = !filters.venueId && !filters.staffId
          const feed = await allPages(
            (c) => listLibrary(admin, filters, c),
            unscoped ? 400 : 5
          )
          // Every returned row satisfies every active filter.
          for (const item of feed.items) {
            if (venue) expect(item.venueName, label).toBe(venue.name)
            if (who) expect(item.contributorId, label).toBe(who.id)
            if (type) expect(item.mediaType, label).toBe(type)
            expect(item.uploadState, label).toBe("ready")
          }
          expectFeedOrder(feed.items)
          const expected = newestFirst(
            seeded.filter(
              (s) =>
                (!venue || s.venueId === venue.id) &&
                (!who || s.uploaderId === who.id) &&
                (!type || s.type === type)
            )
          ).map((s) => s.id)
          // Scoped feeds hold exactly our rows; cleared ones hold our rows too.
          const got = unscoped
            ? feed.ids.filter((id) => ours.has(id))
            : feed.ids
          expect(got, label).toEqual(expected)
          if (expected.length === 0) {
            empties++
            expect(feed.items, label).toEqual([])
          }
        }
      }
    }
    // venue A x staff 2 (never at A), in all three type choices.
    expect(empties).toBe(3)
  })

  it("returns an empty first page (no cursor) for a filter with no matches", async () => {
    const empty = await listLibrary(admin, {
      venueId: venueA.id,
      staffId: staff2.id,
      type: null,
    })
    expect(empty).toEqual({ ok: true, items: [], nextCursor: null })
    const unused = await createVenue(service, "lib-filter-empty")
    expect(
      await listLibrary(admin, { ...NO_FILTERS, venueId: unused.id })
    ).toEqual({ ok: true, items: [], nextCursor: null })
  })

  it("keeps the filter on every page", async () => {
    // Enough of staff 1's photos at venue B to need three pages, interleaved
    // with non-matching rows (videos, other staff, other venue) in time.
    const base = new Date(Date.now() - 900_000)
    const matching: SeededAsset[] = []
    for (let i = 0; i < PAGE * 2 + 1; i++) {
      matching.push(
        await seedAsset(service, {
          uploaderId: staff1.id,
          venueId: venueB.id,
          type: "image",
          createdAt: secondsBefore(base, i * 3),
        })
      )
      await seedAsset(service, {
        uploaderId: i % 2 ? staff2.id : staff1.id,
        venueId: venueB.id,
        type: i % 2 ? "image" : "video",
        createdAt: secondsBefore(base, i * 3 + 1),
      })
    }
    const filters = {
      venueId: venueB.id,
      staffId: staff1.id,
      type: "image" as const,
    }
    const feed = await allPages((c) => listLibrary(admin, filters, c))
    const expected = newestFirst([
      ...matching,
      ...seeded.filter(
        (s) =>
          s.venueId === venueB.id &&
          s.uploaderId === staff1.id &&
          s.type === "image"
      ),
    ]).map((s) => s.id)
    expect(feed.ids).toEqual(expected)
    expect(feed.pageSizes.slice(0, 2)).toEqual([PAGE, PAGE])
    for (const item of feed.items) {
      expect(item).toMatchObject({
        contributorId: staff1.id,
        venueName: venueB.name,
        mediaType: "image",
      })
    }
    // A cursor from one filter is only a position: reusing it with no filter
    // continues the unfiltered feed from that point, still ordered.
    const first = await listLibrary(admin, filters)
    if (!first.ok || !first.nextCursor) throw new Error("expected a cursor")
    const other = await listLibrary(admin, NO_FILTERS, first.nextCursor)
    if (!other.ok) throw new Error(other.message)
    expectFeedOrder([first.items.at(-1)!, ...other.items])
  })

  it("lists only ready, non-deleted media and only for active admins", async () => {
    // solo's assigned venue: only this test writes there, and a reservation
    // always lands at the uploader's current venue.
    const venue = homeVenue
    const staff = solo
    const ready = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
    })
    const deleted = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
    })
    await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleted.id)
    // A reservation that never finished processing.
    const { error } = await staff.client.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "pending.jpg",
    })
    expect(error).toBeNull()

    const feed = await allPages((c) =>
      listLibrary(admin, { ...NO_FILTERS, venueId: venue.id }, c)
    )
    expect(feed.ids).toEqual([ready.id])
    expect(
      await listLibrary(await actorFor(staff), {
        ...NO_FILTERS,
        staffId: staff.id,
      })
    ).toMatchObject({ ok: false, status: 403 })
  })
})

describe("signed reads", () => {
  const original = process.env.NABALENS_SIGNED_URL_TTL_SECONDS
  afterEach(() => {
    if (original === undefined)
      delete process.env.NABALENS_SIGNED_URL_TTL_SECONDS
    else process.env.NABALENS_SIGNED_URL_TTL_SECONDS = original
  })

  it("issues 60 s links; the test override can only shorten them", () => {
    delete process.env.NABALENS_SIGNED_URL_TTL_SECONDS
    expect(signedUrlTtlSeconds()).toBe(60)
    for (const [value, ttl] of [
      ["2", 2],
      ["59", 59],
      ["60", 60],
      ["3600", 60],
      ["0", 60],
      ["-5", 60],
      ["1.5", 60],
      ["abc", 60],
      ["", 60],
    ] as const) {
      process.env.NABALENS_SIGNED_URL_TTL_SECONDS = value
      expect(signedUrlTtlSeconds(), value).toBe(ttl)
    }
  })

  it("an expired preview link fails; re-authorising issues a working one", async () => {
    process.env.NABALENS_SIGNED_URL_TTL_SECONDS = "8"
    const venue = await createVenue(service, "lib-expiry")
    const staff = solo
    const asset = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
      derivatives: true,
    })
    const owner = await actorFor(staff)
    // Generous TTL: under machine load a request can take seconds, and a
    // link must not expire between signing and its first fetch.
    for (const [which, actor] of [
      ["thumbnail", admin],
      ["preview", owner],
    ] as const) {
      {
        const first = await signDerivative(actor, asset.id, which)
        if (!first.ok) throw new Error(first.message)
        expect((await fetch(first.url)).status).toBe(200)

        await new Promise((r) => setTimeout(r, 9500))
        const stale = await fetch(first.url)
        await stale.body?.cancel()
        expect(stale.ok, `${which} link still valid after expiry`).toBe(false)

        const again = await signDerivative(actor, asset.id, which)
        if (!again.ok) throw new Error(again.message)
        expect(again.url).not.toBe(first.url)
        const fresh = await fetch(again.url)
        expect(fresh.status).toBe(200)
        expect(fresh.headers.get("content-type")).toBe("image/webp")
      }
    }
  }, 90_000)

  it("re-authorises on every sign: a deleted asset gets no new link", async () => {
    const venue = await createVenue(service, "lib-expiry-del")
    const staff = solo
    const asset = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
      derivatives: true,
    })
    expect(await signDerivative(admin, asset.id, "thumbnail")).toMatchObject({
      ok: true,
    })
    await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", asset.id)
    expect(await signDerivative(admin, asset.id, "thumbnail")).toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it("original responses carry attachment, validated type, nosniff and private, no-store", async () => {
    const venue = await createVenue(service, "lib-headers")
    const staff = solo
    const asset = await seedAsset(service, {
      uploaderId: staff.id,
      venueId: venue.id,
      filename: "menu.html",
    })
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const { error } = await service.storage
      .from("media")
      .upload(`${staff.id}/${asset.id}/original.jpg`, bytes, {
        // What a hostile browser might have declared; never echoed back.
        contentType: "text/html",
        upsert: true,
      })
    expect(error).toBeNull()

    const found = await getReadableAsset(admin, asset.id)
    if (!found.ok) throw new Error(found.message)
    for (const range of [null, "bytes=0-1"]) {
      const response = await streamOriginal(admin, found.asset, range)
      expect(response.status).toBe(range ? 206 : 200)
      expect(response.headers.get("content-type")).toBe("image/jpeg")
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment; filename="menu\.jpg"; filename\*=UTF-8''menu\.jpg$/
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      const body = new Uint8Array(await response.arrayBuffer())
      expect(body).toEqual(range ? bytes.slice(0, 2) : bytes)
    }
    expect(PRIVATE_HEADERS).toMatchObject({
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    })
  })
})
