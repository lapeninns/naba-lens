// lib/server/album.ts reads and writes (release review A, R-4): a failed
// placement read never fails staff Home, the app's brief rule matches the
// database's (characters, no control characters), and every error the album
// functions raise has a message. The database rules are in
// tests/security/album-places.test.ts and album-briefs.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest"

import { BRIEF_MAX, isBriefText } from "@/lib/album/model"

const mocks = vi.hoisted(() => ({
  getWorkingList: vi.fn(),
  listOurMenuItems: vi.fn(),
  listMyRetakeNotes: vi.fn(),
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

const BAR = "00000000-0000-4000-8000-00000000b001"
const DARTS = "00000000-0000-4000-8000-0000000a0001"
const SECTION = "00000000-0000-4000-8000-0000000c0001"
const KORMA = "00000000-0000-4000-8000-0000000d0001"

type Answer = { data: unknown; error: unknown } | "throw"

function dbActor(rpcs: Record<string, Answer>) {
  const rpc = vi.fn(async (name: string) => {
    const answer = rpcs[name]
    if (answer === "throw") throw new Error("network")
    if (!answer) return { data: { items: [] }, error: null }
    return answer
  })
  return { rpc, actor: { db: { rpc }, profile: { active: true } } as never }
}

const placesRead = {
  data: {
    items: [{ subjectId: BAR, label: "The bar", kind: "area", active: true }],
  },
  error: null,
}
const placedRead = {
  data: {
    items: [
      { source: "amenity_category", key: "Games", subjectId: BAR },
      { source: "menu_section", key: "mains", subjectId: BAR },
    ],
    sections: [{ sectionId: SECTION, slug: "mains", name: "Mains" }],
  },
  error: null,
}
const areasRead = {
  data: { items: [{ subjectId: BAR, label: "The bar", state: "needed" }] },
  error: null,
}
const FAILED = { data: null, error: { message: "permission denied" } }

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.listOurMenuItems.mockResolvedValue({
    ok: true,
    items: [
      {
        itemId: KORMA,
        name: "Korma",
        sectionId: SECTION,
        sectionName: "Mains",
        covered: false,
        needsRecheck: false,
        primary: null,
      },
    ],
    nextCursor: null,
  })
  mocks.listMyRetakeNotes.mockResolvedValue({ ok: true, notes: [] })
  mocks.getWorkingList.mockResolvedValue({
    ok: true,
    view: {
      slots: [
        {
          checkId: DARTS,
          key: "darts",
          question: "Can guests play darts?",
          category: "Games",
          progress: "needs_capture",
          answerInUse: { status: "unavailable", value: null },
          myLatest: null,
        },
      ],
    },
  })
})

/** Place (subjectId, null for Not placed yet) to its slot ids. */
async function placesOf(rpcs: Record<string, Answer>) {
  const { loadAlbum } = await import("@/lib/server/album")
  const result = await loadAlbum(dbActor(rpcs).actor)
  if (!result.ok) throw new Error(`album failed: ${result.message}`)
  const all = [
    ...result.album.places,
    ...(result.album.unplaced ? [result.album.unplaced] : []),
  ]
  return new Map(
    all.map((p) => [
      p.subjectId,
      p.groups.flatMap((g) => g.slots.map((s) => s.id)).sort(),
    ])
  )
}

describe("loadAlbum when a placement read fails", () => {
  it("places slots as the database says when both reads work", async () => {
    const places = await placesOf({
      knowledge_subjects: placesRead,
      album_places: placedRead,
      album_area_states: areasRead,
    })
    expect(places.get(BAR)).toEqual(
      [`amenity:${DARTS}`, `area:${BAR}`, `dish:${KORMA}`].sort()
    )
    expect(places.has(null)).toBe(false)
  })

  it("draws Home with every slot under Not placed yet when album_places fails", async () => {
    for (const failed of [FAILED, "throw" as const]) {
      const places = await placesOf({
        knowledge_subjects: placesRead,
        album_places: failed,
        album_area_states: areasRead,
      })
      expect(places.get(null)).toEqual([`amenity:${DARTS}`, `dish:${KORMA}`])
      // The area slot is a place itself, so it stays where it is.
      expect(places.get(BAR)).toEqual([`area:${BAR}`])
    }
  })

  it("draws Home without area slots when the places read fails", async () => {
    const places = await placesOf({
      knowledge_subjects: FAILED,
      album_places: placedRead,
      album_area_states: areasRead,
    })
    expect([...places.keys()]).toEqual([null])
    expect(places.get(null)).toEqual([`amenity:${DARTS}`, `dish:${KORMA}`])
  })

  it("still fails the manager's placements read, which writes from it", async () => {
    const { getAlbumPlacements } = await import("@/lib/server/album")
    const failed = await getAlbumPlacements(
      dbActor({ knowledge_subjects: placesRead, album_places: FAILED }).actor
    )
    expect(failed.ok).toBe(false)
    const thrown = await getAlbumPlacements(
      dbActor({ knowledge_subjects: placesRead, album_places: "throw" }).actor
    )
    expect(thrown.ok).toBe(false)
    const read = await getAlbumPlacements(
      dbActor({ knowledge_subjects: placesRead, album_places: placedRead })
        .actor
    )
    expect(read).toMatchObject({ ok: true, placements: placedRead.data.items })
  })
})

describe("brief text", () => {
  it("counts characters as the database does", () => {
    expect(isBriefText("🍛".repeat(BRIEF_MAX))).toBe(true)
    expect(isBriefText("🍛".repeat(BRIEF_MAX + 1))).toBe(false)
    expect(isBriefText("x".repeat(BRIEF_MAX))).toBe(true)
    expect(isBriefText("x".repeat(BRIEF_MAX + 1))).toBe(false)
  })

  it("refuses control characters, not only line breaks", () => {
    for (const brief of [
      "a\nb",
      "a\rb",
      "a\tb",
      "a\u0007b",
      "a\u007fb",
      "a\u0085b",
    ])
      expect(isBriefText(brief)).toBe(false)
    expect(isBriefText("Plate from above, café light")).toBe(true)
  })

  it("is applied before setAlbumBrief calls the database", async () => {
    const { setAlbumBrief } = await import("@/lib/server/album")
    const { actor, rpc } = dbActor({
      album_brief_set: { data: { changed: true, brief: "x" }, error: null },
    })
    const tab = await setAlbumBrief(actor, {
      source: "menu_section",
      key: "mains",
      brief: "Tab\there",
    })
    expect(tab).toMatchObject({ ok: false, code: "invalid_input" })
    expect(rpc).not.toHaveBeenCalled()

    const emoji = await setAlbumBrief(actor, {
      source: "menu_section",
      key: "mains",
      brief: "🍛".repeat(BRIEF_MAX),
    })
    expect(emoji.ok).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("album error messages", () => {
  it.each([
    ["venue_required", "invalid_input"],
    ["venue_inactive", "state_conflict"],
    ["not_admin", "not_permitted"],
    ["unknown_slot", "state_conflict"],
  ])("gives %s its own message", async (message, code) => {
    const { setAlbumPlace } = await import("@/lib/server/album")
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await setAlbumPlace(
      dbActor({ album_place_set: { data: null, error: { message } } }).actor,
      { source: "amenity_category", key: "Games", subjectId: BAR }
    )
    expect(result).toMatchObject({ ok: false, code })
    // A known error is not logged as an outage.
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
