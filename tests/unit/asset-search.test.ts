// B05-m4 asset search service (contracts/b05-m4-build-scope.md) with a mocked
// caller-scoped RPC client: filter parsing and combinations, the cursor
// round-trip and its rejections, the request shape, error mapping, and the
// manager arm of the thumbnail gate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { signDerivative } from "@/lib/server/media/access"
import { encodeCursor } from "@/lib/server/media/library"
import {
  ASSET_SEARCH_PAGE,
  decodeSearchCursor,
  encodeSearchCursor,
  parseSearchFilters,
  searchAssets,
  searchRpcFailure,
  type AssetSearchRow,
} from "@/lib/server/media/search"
import type { MediaActor } from "@/lib/server/media/types"

const VENUE = "11111111-1111-4111-8111-111111111111"
const ITEM = "22222222-2222-4222-8222-222222222222"
const VARIANT = "33333333-3333-4333-8333-333333333333"
const ASSET = "55555555-5555-4555-8555-555555555555"
const OTHER = "66666666-6666-4666-8666-666666666666"
const AT = "2026-11-11T10:00:00.123456+00:00"

function row(id: string, over: Partial<AssetSearchRow> = {}): AssetSearchRow {
  return {
    id,
    mediaType: "image",
    hasThumbnail: true,
    venueName: "TEST venue",
    uploaderFirstName: "Anna",
    uploadedAt: AT,
    groupId: null,
    subjects: { menuItems: [], checks: [], tasks: [], group: null },
    use: { state: "not_granted", inForce: 0, withdrawn: 0, destinations: [] },
    menuDecisions: [],
    ...over,
  }
}

function actorWith(
  handler: (
    fn: string,
    args: Record<string, unknown>
  ) => { data?: unknown; error?: { message: string; code?: string } },
  role: "admin" | "manager" | "staff" = "manager"
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const out = handler(fn, args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const actor = {
    profile: { id: "u", active: true, role },
    db: { rpc },
    service: { rpc },
    storage: {},
  } as unknown as MediaActor
  return { actor, rpc }
}

describe("parseSearchFilters", () => {
  it("treats absent, null and empty values as no filter", () => {
    expect(parseSearchFilters(undefined)).toEqual({
      ok: true,
      filters: {},
      db: {},
    })
    expect(
      parseSearchFilters({ venue: null, item: "", rights: undefined })
    ).toEqual({ ok: true, filters: {}, db: {} })
  })

  it("combines every filter and lower-cases ids", () => {
    const parsed = parseSearchFilters({
      venue: VENUE.toUpperCase(),
      mediaType: "video",
      item: ITEM,
      variant: VARIANT,
      check: ITEM,
      group: VARIANT,
      submission: { source: "knowledge", id: ASSET },
      rights: "in_force",
      destination: "test_web",
      uploadedFrom: "2026-03-29",
      uploadedTo: "2026-03-29",
      menuState: "needs_recheck",
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.filters.venue).toBe(VENUE)
    expect(parsed.db).toEqual({
      venue: VENUE,
      mediaType: "video",
      item: ITEM,
      variant: VARIANT,
      check: ITEM,
      group: VARIANT,
      submission: { source: "knowledge", id: ASSET },
      rights: "in_force",
      destination: "test_web",
      menuState: "needs_recheck",
      // The BST change day is 23 hours long.
      uploadedFrom: "2026-03-29T00:00:00.000Z",
      uploadedBefore: "2026-03-29T23:00:00.000Z",
    })
  })

  it("sends upload days as a half-open range of upload time", () => {
    const parsed = parseSearchFilters({ uploadedTo: "2026-07-01" })
    expect(parsed).toMatchObject({
      ok: true,
      db: { uploadedBefore: "2026-07-01T23:00:00.000Z" },
    })
    if (parsed.ok) expect(parsed.db).not.toHaveProperty("uploadedFrom")
  })

  it("refuses unknown keys with a field error each", () => {
    expect(
      parseSearchFilters({ venue: VENUE, freshness: "current", staff: VENUE })
    ).toEqual({
      ok: false,
      fieldErrors: {
        freshness: "This filter is not available.",
        staff: "This filter is not available.",
      },
    })
  })

  it.each([
    [{ venue: "not-a-uuid" }, "venue"],
    [{ item: 3 }, "item"],
    [{ mediaType: "document" }, "mediaType"],
    [{ rights: "granted" }, "rights"],
    [{ rights: "in_force", destination: "Bad Key" }, "destination"],
    [{ destination: "test_web" }, "destination"],
    [{ rights: "expired", destination: "test_web" }, "destination"],
    [{ menuState: "pending" }, "menuState"],
    [{ submission: { source: "coverage" } }, "submission"],
    [{ submission: { source: "upload", id: ASSET } }, "submission"],
    [{ submission: { source: "coverage", id: ASSET, x: 1 } }, "submission"],
    [{ submission: ASSET }, "submission"],
    [{ uploadedFrom: "2026-02-30" }, "uploadedFrom"],
    [{ uploadedTo: "11/11/2026" }, "uploadedTo"],
    [{ uploadedFrom: "2026-11-12", uploadedTo: "2026-11-11" }, "uploadedTo"],
    [{ uploadedFrom: "9999-12-31" }, "uploadedFrom"],
    [{ uploadedTo: "9999-12-31" }, "uploadedTo"],
    [{ uploadedFrom: "0000-01-01" }, "uploadedFrom"],
    [{ answerFreshness: "stale" }, "answerFreshness"],
    [{ answerUse: "public" }, "answerUse"],
    [{ answerFreshness: "current", answerUse: "everyone" }, "answerUse"],
  ])("refuses %j on %s", (input, field) => {
    const parsed = parseSearchFilters(input)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(Object.keys(parsed.fieldErrors)).toEqual([field])
  })

  it("refuses a day whose bounds leave four-digit years, with the date wording", () => {
    expect(
      parseSearchFilters({
        uploadedFrom: "9999-12-31",
        uploadedTo: "9999-12-31",
      })
    ).toEqual({
      ok: false,
      fieldErrors: {
        uploadedFrom: "Enter a valid date.",
        uploadedTo: "Enter a valid date.",
      },
    })
    expect(parseSearchFilters({ uploadedTo: "9999-12-30" })).toMatchObject({
      ok: true,
      db: { uploadedBefore: "9999-12-31T00:00:00.000Z" },
    })
  })

  it("refuses a filter value that is not an object", () => {
    for (const input of [[], "venue", 3])
      expect(parseSearchFilters(input)).toMatchObject({
        ok: false,
        fieldErrors: { filters: expect.any(String) },
      })
  })
})

describe("search cursor", () => {
  it("round-trips through the library codec", () => {
    const cursor = encodeSearchCursor(AT, ASSET)
    expect(cursor).toBe(encodeCursor(AT, ASSET))
    expect(decodeSearchCursor(cursor)).toEqual({ createdAt: AT, id: ASSET })
  })

  it.each([
    ["too long", "A".repeat(513)],
    ["bad charset", "abc+/="],
    ["empty", ""],
    ["not JSON", Buffer.from("nope").toString("base64url")],
    [
      "bad timestamp",
      Buffer.from(JSON.stringify(["yesterday", ASSET])).toString("base64url"),
    ],
    ["bad id", Buffer.from(JSON.stringify([AT, "x"])).toString("base64url")],
  ])("rejects a cursor: %s", (_, cursor) => {
    expect(decodeSearchCursor(cursor)).toBeNull()
  })
})

describe("searchAssets", () => {
  let error: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => error.mockRestore())

  it("sends the parsed filters, the default page size and no cursor", async () => {
    const { actor, rpc } = actorWith(() => ({
      data: { hasMore: false, items: [row(ASSET)] },
    }))
    const out = await searchAssets(actor, {
      filters: { item: ITEM, uploadedFrom: "2026-11-01" },
    })
    expect(rpc).toHaveBeenCalledWith("asset_search", {
      p_filters: { item: ITEM, uploadedFrom: "2026-11-01T00:00:00.000Z" },
      p_after_created_at: null,
      p_after_id: null,
      p_limit: ASSET_SEARCH_PAGE.default,
    })
    const expected: Record<string, unknown> = {
      ...row(ASSET),
      thumbnailUrl: `/api/media/${ASSET}/thumb`,
      answers: [],
    }
    delete expected.hasThumbnail
    expect(out).toEqual({
      ok: true,
      items: [expected],
      nextCursor: null,
    })
  })

  it("returns a next cursor from the last row only when more remain", async () => {
    const { actor, rpc } = actorWith(() => ({
      data: {
        hasMore: true,
        items: [row(OTHER), row(ASSET, { hasThumbnail: false })],
      },
    }))
    const out = await searchAssets(actor, { limit: 2 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.items[1]!.thumbnailUrl).toBeNull()
    expect(decodeSearchCursor(out.nextCursor!)).toEqual({
      createdAt: AT,
      id: ASSET,
    })
    await searchAssets(actor, { cursor: out.nextCursor, limit: 48 })
    expect(rpc).toHaveBeenCalledWith(
      "asset_search",
      expect.objectContaining({
        p_after_created_at: AT,
        p_after_id: ASSET,
        p_limit: 48,
      })
    )
  })

  it("adds each card's supported answers from asset_search_answers", async () => {
    const answer = {
      checkId: OTHER,
      questionKey: "guest_toilets",
      question: "Are there guest toilets?",
      freshness: [
        {
          use: "internal",
          state: "unrated",
          nextCheckDue: null,
          basis: null,
          basisDate: null,
        },
      ],
    }
    const { actor, rpc } = actorWith((fn) =>
      fn === "asset_search_answers"
        ? { data: { items: [{ assetId: ASSET, answers: [answer] }] } }
        : { data: { hasMore: false, items: [row(ASSET), row(OTHER)] } }
    )
    const out = await searchAssets(actor, {})
    expect(rpc).toHaveBeenCalledWith("asset_search_answers", {
      p_asset_ids: [ASSET, OTHER],
    })
    expect(out.ok && out.items.map((i) => i.answers)).toEqual([[answer], []])
  })

  it("keeps the page when the answers read fails", async () => {
    const { actor } = actorWith((fn) =>
      fn === "asset_search_answers"
        ? { error: { message: "boom" } }
        : { data: { hasMore: false, items: [row(ASSET)] } }
    )
    const out = await searchAssets(actor, {})
    expect(out.ok && out.items[0]!.answers).toEqual([])
    expect(error).toHaveBeenCalled()
  })

  it("skips the answers read for an empty page", async () => {
    const { actor, rpc } = actorWith(() => ({
      data: { hasMore: false, items: [] },
    }))
    await searchAssets(actor, {})
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("resumes a capped freshness page after the last row it read", async () => {
    const LATER = "2026-01-01T00:00:00.000Z"
    const { actor, rpc } = actorWith((fn) =>
      fn === "asset_search_answers"
        ? { data: { items: [] } }
        : {
            data: {
              hasMore: true,
              items: [row(ASSET)],
              resumeAfter: { uploadedAt: LATER, id: OTHER },
            },
          }
    )
    const out = await searchAssets(actor, {
      filters: { answerFreshness: "expired", answerUse: "public" },
    })
    expect(rpc).toHaveBeenCalledWith(
      "asset_search",
      expect.objectContaining({
        p_filters: { answerFreshness: "expired", answerUse: "public" },
      })
    )
    expect(out.ok && decodeSearchCursor(out.nextCursor!)).toEqual({
      createdAt: LATER,
      id: OTHER,
    })
  })

  it("asks for a venue when the database refuses answer freshness without one", async () => {
    const { actor } = actorWith(() => ({
      error: {
        message: "invalid_search_filter",
        details: "answerFreshness",
      } as {
        message: string
      },
    }))
    expect(
      await searchAssets(actor, { filters: { answerFreshness: "current" } })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_input",
      fieldErrors: { answerFreshness: "Choose a venue first." },
    })
  })

  it("refuses bad filters, cursors and limits before calling the database", async () => {
    const { actor, rpc } = actorWith(() => ({ data: null }))
    expect(
      await searchAssets(actor, {
        filters: { tagged: true },
        cursor: "%%%",
        limit: 49,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_input",
      fieldErrors: {
        tagged: expect.any(String),
        cursor: expect.any(String),
        limit: expect.any(String),
      },
    })
    for (const limit of [0, 1.5, "10"])
      expect(await searchAssets(actor, { limit })).toMatchObject({
        status: 400,
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses an inactive profile without calling the database", async () => {
    const { actor, rpc } = actorWith(() => ({ data: null }))
    ;(actor.profile as { active: boolean }).active = false
    expect(await searchAssets(actor, {})).toMatchObject({
      ok: false,
      status: 403,
      code: "not_permitted",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["not_venue_manager", 403, "not_permitted"],
    ["not_active_user", 403, "not_permitted"],
    ["wrong_venue", 403, "not_permitted"],
    ["venue_not_found", 404, "not_found"],
    ["invalid_search_filter", 400, "invalid_input"],
    ["invalid_search_cursor", 400, "invalid_input"],
  ])("maps %s to %i", async (message, status, code) => {
    const { actor } = actorWith(() => ({ error: { message, code: "42501" } }))
    expect(await searchAssets(actor, {})).toMatchObject({
      ok: false,
      status,
      code,
    })
    expect(error).not.toHaveBeenCalled()
  })

  it("maps by message substring and redacts unknown errors to 503", async () => {
    expect(
      searchRpcFailure({ message: "ERROR: wrong_venue" }, "t")
    ).toMatchObject({ status: 403, code: "not_permitted" })
    const out = searchRpcFailure(
      { message: "relation secret_table does not exist", code: "42P01" },
      "t"
    )
    expect(out).toEqual({
      ok: false,
      status: 503,
      code: "unavailable",
      message: "Something went wrong. Try again in a moment.",
    })
    expect(JSON.stringify(out)).not.toContain("secret_table")
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("treats a malformed database answer as unavailable", async () => {
    const { actor } = actorWith(() => ({ data: { items: "x" } }))
    expect(await searchAssets(actor, {})).toMatchObject({ status: 503 })
  })
})

describe("thumbnail gate: search arm", () => {
  const THUMB = `u/${ASSET}/thumb.webp`

  function gateActor(
    role: "manager" | "staff" | "admin",
    canOpen: boolean | "error"
  ) {
    const rpc = vi.fn(async (fn: string) =>
      fn !== "asset_search_can_open"
        ? { data: [], error: null }
        : canOpen === "error"
          ? { data: null, error: { message: "boom" } }
          : { data: canOpen, error: null }
    )
    // The caller's own read finds no row (another person's asset).
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const serviceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: ASSET,
          uploader_id: "other",
          media_type: "image",
          original_path: `u/${ASSET}/original.jpg`,
          preview_path: null,
          thumbnail_path: THUMB,
          validated_mime_type: "image/jpeg",
          size_bytes: 4,
        },
        error: null,
      }),
    }
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: "https://signed.example/thumb" },
      error: null,
    }))
    const actor = {
      profile: { id: "u", active: true, role },
      db: { rpc, from: vi.fn(() => query) },
      service: {
        rpc,
        from: vi.fn(() => serviceQuery),
        storage: { from: vi.fn(() => ({ createSignedUrl })) },
      },
      storage: {},
    } as unknown as MediaActor
    return { actor, rpc, createSignedUrl }
  }

  it("signs a manager's thumbnail that asset search lists, for at most 60 s", async () => {
    const { actor, rpc, createSignedUrl } = gateActor("manager", true)
    expect(await signDerivative(actor, ASSET, "thumbnail")).toEqual({
      ok: true,
      url: "https://signed.example/thumb",
    })
    expect(rpc).toHaveBeenCalledWith("asset_search_can_open", {
      p_asset_id: ASSET,
    })
    expect(createSignedUrl).toHaveBeenCalledWith(THUMB, 60)
  })

  it("keeps 404 when the search predicate refuses, and 503 when it fails", async () => {
    expect(
      await signDerivative(
        gateActor("manager", false).actor,
        ASSET,
        "thumbnail"
      )
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      await signDerivative(
        gateActor("manager", "error").actor,
        ASSET,
        "thumbnail"
      )
    ).toMatchObject({ ok: false, status: 503 })
  })

  it("never asks for previews or admins", async () => {
    const preview = gateActor("manager", true)
    expect(await signDerivative(preview.actor, ASSET, "preview")).toMatchObject(
      { ok: false, status: 404 }
    )
    expect(preview.rpc).not.toHaveBeenCalled()
    const admin = gateActor("admin", true)
    await signDerivative(admin.actor, ASSET, "thumbnail")
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "asset_search_can_open",
      expect.anything()
    )
  })

  it("lets the search predicate decide for staff accounts", async () => {
    // Plain staff: asset_search refuses them, so can_open answers false.
    const plain = gateActor("staff", false)
    expect(await signDerivative(plain.actor, ASSET, "thumbnail")).toMatchObject(
      { ok: false, status: 404 }
    )
    expect(plain.rpc).toHaveBeenCalledWith("asset_search_can_open", {
      p_asset_id: ASSET,
    })
    expect(plain.createSignedUrl).not.toHaveBeenCalled()
    // A legacy staff account holding an open venue-manager grant.
    const grant = gateActor("staff", true)
    expect(await signDerivative(grant.actor, ASSET, "thumbnail")).toEqual({
      ok: true,
      url: "https://signed.example/thumb",
    })
    expect(grant.createSignedUrl).toHaveBeenCalledWith(THUMB, 60)
  })

  it("asks once, only after a 404, and never for inactive or malformed ids", async () => {
    const grant = gateActor("staff", true)
    await signDerivative(grant.actor, ASSET, "thumbnail")
    expect(
      grant.rpc.mock.calls.filter(([fn]) => fn === "asset_search_can_open")
    ).toHaveLength(1)
    const bad = gateActor("staff", true)
    expect(
      await signDerivative(bad.actor, "not-a-uuid", "thumbnail")
    ).toMatchObject({ ok: false, status: 404 })
    expect(bad.rpc).not.toHaveBeenCalled()
    const inactive = gateActor("staff", true)
    ;(inactive.actor.profile as { active: boolean }).active = false
    expect(
      await signDerivative(inactive.actor, ASSET, "thumbnail")
    ).toMatchObject({ ok: false, status: 404 })
    expect(inactive.rpc).not.toHaveBeenCalled()
  })
})
