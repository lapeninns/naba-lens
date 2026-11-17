// Album AL-7: slot photos staff can see. The read model fills thumbnailUrl
// for accepted or waiting area slots and accepted amenity slots from
// album_slot_photos; the thumbnail route checks album_slot_asset before
// signing. Route, server read and model rules here; the database rules are
// in tests/security/album-slot-photos.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildAlbum,
  type AlbumInput,
  type AmenityInput,
  type AreaInput,
} from "@/lib/album/model"

const mocks = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  signEvidence: vi.fn(),
  getWorkingList: vi.fn(),
  listOurMenuItems: vi.fn(),
  listMyRetakeNotes: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
}))
vi.mock("@/lib/server/coverage/evidence", () => ({
  signEvidence: mocks.signEvidence,
}))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: { getWorkingList: mocks.getWorkingList },
}))
vi.mock("@/lib/server/coverage/menu-items", () => ({
  listOurMenuItems: mocks.listOurMenuItems,
}))
vi.mock("@/lib/server/coverage/retake-notes", () => ({
  listMyRetakeNotes: mocks.listMyRetakeNotes,
}))

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})

const BAR = "00000000-0000-4000-8000-00000000b001"
const GARDEN = "00000000-0000-4000-8000-00000000b002"
const SNUG = "00000000-0000-4000-8000-00000000b003"
const DARTS = "00000000-0000-4000-8000-0000000a0001"
const POOL = "00000000-0000-4000-8000-0000000a0002"
const ASSET_1 = "00000000-0000-4000-8000-00000000f001"
const ASSET_2 = "00000000-0000-4000-8000-00000000f002"
const ASSET_3 = "00000000-0000-4000-8000-00000000f003"

const ctx = (assetId: string) => ({ params: Promise.resolve({ assetId }) })
const routeActor = { profile: { id: "u", active: true } }

describe("GET /api/album/[assetId]/thumb", () => {
  const route = () => import("@/app/api/album/[assetId]/thumb/route")

  it("answers a signed-out caller privately without signing", async () => {
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Sign in to continue.",
    })
    const res = await (
      await route()
    ).GET(new Request("http://local.test"), ctx(ASSET_1))
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.signEvidence).not.toHaveBeenCalled()
  })

  it("admits staff, managers and admins, and signs a thumbnail with the slot check", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: routeActor })
    mocks.signEvidence.mockResolvedValue({
      ok: true,
      url: "http://127.0.0.1/signed",
    })
    const res = await (
      await route()
    ).GET(new Request("http://local.test"), ctx(ASSET_1))
    expect(mocks.getMediaActor).toHaveBeenCalledWith([
      "staff",
      "manager",
      "admin",
    ])
    expect(mocks.signEvidence).toHaveBeenCalledWith(
      routeActor,
      ASSET_1,
      "thumbnail",
      "album_slot_asset"
    )
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("http://127.0.0.1/signed")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
  })

  it("is the same 404 for unknown, forbidden and malformed ids, and signs nothing", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: routeActor })
    const { signEvidence } = await vi.importActual<
      typeof import("@/lib/server/coverage/evidence")
    >("@/lib/server/coverage/evidence")
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const serviceFrom = vi.fn()
    mocks.signEvidence.mockImplementation((_a, id, which, check) =>
      signEvidence(
        {
          profile: { active: true },
          db: { rpc },
          service: { from: serviceFrom },
        } as never,
        id,
        which,
        check
      )
    )
    for (const id of [ASSET_1, "not-a-uuid"]) {
      const res = await (
        await route()
      ).GET(new Request("http://local.test"), ctx(id))
      expect(res.status).toBe(404)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
    }
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("album_slot_asset", {
      p_asset_id: ASSET_1,
    })
    expect(serviceFrom).not.toHaveBeenCalled()
  })

  it("asks the client to retry when the check cannot run", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: routeActor })
    mocks.signEvidence.mockResolvedValue({
      ok: false,
      status: 503,
      message: "Try again.",
    })
    const res = await (
      await route()
    ).GET(new Request("http://local.test"), ctx(ASSET_1))
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("5")
  })
})

// ---- server read -------------------------------------------------------------

function dbActor(rpcs: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string) => {
    const answer = rpcs[name]
    if (!answer) throw new Error(`unexpected rpc ${name}`)
    return answer
  })
  return { rpc, actor: { db: { rpc }, profile: { active: true } } as never }
}

const workingList = (
  slots: Array<{ checkId: string; progress: string; value?: string }>
) => ({
  ok: true,
  view: {
    slots: slots.map((s) => ({
      checkId: s.checkId,
      question: `Question ${s.checkId}`,
      category: "Games",
      progress: s.progress,
      answerInUse: s.value
        ? { status: "available", value: s.value }
        : { status: "unavailable", value: null },
      myLatest: null,
    })),
  },
})

const placesRead = {
  data: {
    items: [
      { subjectId: BAR, label: "The bar", kind: "area", active: true },
      { subjectId: GARDEN, label: "Garden", kind: "area", active: true },
      { subjectId: SNUG, label: "Snug", kind: "room", active: true },
    ],
  },
  error: null,
}
const placedRead = {
  data: {
    items: [{ source: "amenity_category", key: "Games", subjectId: BAR }],
    sections: [],
  },
  error: null,
}
const areasRead = {
  data: {
    items: [
      { subjectId: BAR, label: "The bar", state: "accepted" },
      { subjectId: GARDEN, label: "Garden", state: "waiting" },
      { subjectId: SNUG, label: "Snug", state: "retake" },
    ],
  },
  error: null,
}

describe("slotPhotos", () => {
  it("maps each slot to its thumbnail route, by kind, and drops malformed rows", async () => {
    const { slotPhotos } = await import("@/lib/server/album")
    const { actor, rpc } = dbActor({
      album_slot_photos: {
        data: {
          items: [
            { kind: "area", slotId: BAR, assetId: ASSET_1 },
            { kind: "amenity", slotId: DARTS, assetId: ASSET_2 },
            { kind: "dish", slotId: POOL, assetId: ASSET_3 },
            { kind: "area", slotId: GARDEN, assetId: "../../x" },
          ],
        },
        error: null,
      },
    })
    const photos = await slotPhotos(actor)
    expect(rpc).toHaveBeenCalledWith("album_slot_photos", {})
    expect([...photos.area]).toEqual([[BAR, `/api/album/${ASSET_1}/thumb`]])
    expect([...photos.amenity]).toEqual([
      [DARTS, `/api/album/${ASSET_2}/thumb`],
    ])
  })

  it("shows no photos when the read fails", async () => {
    const { slotPhotos } = await import("@/lib/server/album")
    const { actor } = dbActor({
      album_slot_photos: { data: null, error: { message: "boom" } },
    })
    const photos = await slotPhotos(actor)
    expect(photos.area.size + photos.amenity.size).toBe(0)
  })
})

describe("loadAlbum with slot photos", () => {
  const setup = (photos: { data: unknown; error: unknown }) => {
    mocks.listOurMenuItems.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    mocks.listMyRetakeNotes.mockResolvedValue({ ok: true, notes: [] })
    mocks.getWorkingList.mockResolvedValue(
      workingList([
        { checkId: DARTS, progress: "complete", value: "yes" },
        { checkId: POOL, progress: "needs_capture" },
      ])
    )
    return dbActor({
      knowledge_subjects: placesRead,
      album_places: placedRead,
      album_area_states: areasRead,
      album_slot_photos: photos,
    })
  }

  const slotsOf = (
    album: Awaited<ReturnType<typeof import("@/lib/server/album").loadAlbum>>
  ) => {
    if (!album.ok) throw new Error("album failed")
    return new Map(
      album.album.places
        .flatMap((p) => p.groups.flatMap((g) => g.slots))
        .map((s) => [s.id, s])
    )
  }

  it("fills thumbnailUrl on accepted and waiting areas and the accepted amenity", async () => {
    const { loadAlbum } = await import("@/lib/server/album")
    const { actor, rpc } = setup({
      data: {
        items: [
          { kind: "area", slotId: BAR, assetId: ASSET_1 },
          { kind: "area", slotId: GARDEN, assetId: ASSET_2 },
          { kind: "amenity", slotId: DARTS, assetId: ASSET_3 },
        ],
      },
      error: null,
    })
    const slots = slotsOf(await loadAlbum(actor))
    expect(slots.get(`area:${BAR}`)).toMatchObject({
      state: "accepted",
      thumbnailUrl: `/api/album/${ASSET_1}/thumb`,
    })
    expect(slots.get(`area:${GARDEN}`)).toMatchObject({
      state: "waiting",
      thumbnailUrl: `/api/album/${ASSET_2}/thumb`,
    })
    expect(slots.get(`area:${SNUG}`)).toMatchObject({
      state: "retake",
      thumbnailUrl: null,
    })
    expect(slots.get(`amenity:${DARTS}`)).toMatchObject({
      state: "accepted",
      thumbnailUrl: `/api/album/${ASSET_3}/thumb`,
    })
    expect(slots.get(`amenity:${POOL}`)).toMatchObject({
      state: "needed",
      thumbnailUrl: null,
    })
    // One slot-photo read for both loaders.
    expect(
      rpc.mock.calls.filter(([name]) => name === "album_slot_photos")
    ).toHaveLength(1)
  })

  it("still draws the album, without photos, when the photo read fails", async () => {
    const { loadAlbum } = await import("@/lib/server/album")
    const { actor } = setup({ data: null, error: { message: "boom" } })
    const result = await loadAlbum(actor)
    expect(result.ok).toBe(true)
    const slots = slotsOf(result)
    expect(slots.get(`area:${BAR}`)?.thumbnailUrl).toBeNull()
    expect(slots.get(`amenity:${DARTS}`)?.thumbnailUrl).toBeNull()
  })
})

// ---- model rules -------------------------------------------------------------

const input = (amenities: AmenityInput[], areas: AreaInput[]): AlbumInput => ({
  places: [{ subjectId: BAR, label: "The bar" }],
  placements: [{ source: "amenity_category", key: "Games", subjectId: BAR }],
  sections: [],
  dishes: [],
  amenities,
  areas,
  myRetakeItemIds: new Set(),
})

const amenity = (over: Partial<AmenityInput>): AmenityInput => ({
  checkId: DARTS,
  question: "Can guests play darts?",
  category: "Games",
  progress: "complete",
  answer: "yes",
  myLatestState: null,
  thumbnailUrl: "/api/album/x/thumb",
  ...over,
})

describe("buildAlbum slot photos", () => {
  const only = (view: ReturnType<typeof buildAlbum>) =>
    view.places[0]!.groups.flatMap((g) => g.slots)[0]!

  it("shows an amenity photo only on an accepted slot", () => {
    expect(only(buildAlbum(input([amenity({})], []))).thumbnailUrl).toBe(
      "/api/album/x/thumb"
    )
    for (const over of [
      { answer: "no" as const },
      { progress: "needs_recheck" as const },
      { progress: "needs_capture" as const },
    ])
      expect(
        only(buildAlbum(input([amenity(over)], []))).thumbnailUrl
      ).toBeNull()
  })

  it("shows an area photo on accepted and waiting, never on a retake", () => {
    const area = (state: AreaInput["state"]) =>
      only(
        buildAlbum(
          input(
            [],
            [{ subjectId: BAR, label: "The bar", state, thumbnailUrl: "/t" }]
          )
        )
      ).thumbnailUrl
    expect(area("accepted")).toBe("/t")
    expect(area("waiting")).toBe("/t")
    expect(area("retake")).toBeNull()
    expect(area("needed")).toBeNull()
  })

  it("leaves thumbnailUrl null when the loader gave none", () => {
    expect(
      only(buildAlbum(input([amenity({ thumbnailUrl: undefined })], [])))
        .thumbnailUrl
    ).toBeNull()
  })
})
