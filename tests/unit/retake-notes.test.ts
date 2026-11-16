import { describe, expect, it, vi } from "vitest"

import {
  listMyRetakeNotes,
  setRetakeNoteAside,
} from "@/lib/server/coverage/retake-notes"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))
const media = vi.hoisted(() => ({ listOwnMediaByIds: vi.fn() }))
vi.mock("@/lib/server/media/library", () => media)

const NOTE = "00000000-0000-4000-8000-0000000000c1"

function actor(
  rpc: (fn: string, args?: object) => Promise<unknown>,
  profile: Partial<{ active: boolean; role: string }> = {}
) {
  return {
    profile: { id: "me", active: true, role: "staff", ...profile },
    db: { rpc: vi.fn(rpc) },
  } as unknown as MediaActor & { db: { rpc: ReturnType<typeof vi.fn> } }
}

const row = (overrides: Record<string, unknown> = {}) => ({
  kind: "menu",
  note_id: "p1",
  note_revision: 2,
  asset_id: "a1",
  item_id: "i1",
  variant_id: null,
  item_name: "Korma",
  variant_name: null,
  requirement_id: null,
  requirement_title: null,
  requirement_kind: null,
  reason: "Too dark",
  asked_by_name: "TEST Chef",
  asked_at: "2026-11-14T12:00:00Z",
  status: "open",
  can_retake: true,
  set_aside_at: null,
  ...overrides,
})

describe("listMyRetakeNotes", () => {
  it("maps both kinds and signs thumbnails only for notes still shown", async () => {
    media.listOwnMediaByIds.mockResolvedValueOnce({
      ok: true,
      items: [{ id: "a1", thumbnailUrl: "/t/a1" }],
    })
    const a = actor(async () => ({
      data: [
        row(),
        row({
          kind: "coverage",
          note_id: "c1",
          asset_id: "a2",
          item_id: null,
          item_name: null,
          requirement_id: "r1",
          requirement_title: "Bar set-up",
          requirement_kind: "service",
        }),
        row({ note_id: "p9", asset_id: "a9", status: "cleared" }),
      ],
      error: null,
    }))
    const result = await listMyRetakeNotes(a)
    expect(a.db.rpc).toHaveBeenCalledWith("my_retake_notes")
    expect(media.listOwnMediaByIds).toHaveBeenCalledWith(a, ["a1", "a2"])
    expect(result).toEqual({
      ok: true,
      notes: [
        expect.objectContaining({
          kind: "menu",
          noteId: "p1",
          revision: 2,
          thumbnailUrl: "/t/a1",
          dish: {
            itemId: "i1",
            variantId: null,
            itemName: "Korma",
            variantName: null,
          },
          requirement: null,
          askedBy: "TEST Chef",
          canRetake: true,
        }),
        expect.objectContaining({
          kind: "coverage",
          noteId: "c1",
          thumbnailUrl: null,
          dish: null,
          requirement: { id: "r1", title: "Bar set-up", kind: "service" },
        }),
        expect.objectContaining({ noteId: "p9", status: "cleared" }),
      ],
    })
  })

  it("is staff only, and reports a failed read", async () => {
    const admin = actor(async () => ({ data: [], error: null }), {
      role: "admin",
    })
    expect(await listMyRetakeNotes(admin)).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(admin.db.rpc).not.toHaveBeenCalled()
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined)
    const down = actor(async () => ({
      data: null,
      error: { message: "boom", code: "XX000" },
    }))
    expect(await listMyRetakeNotes(down)).toMatchObject({
      ok: false,
      code: "unavailable",
    })
  })
})

describe("setRetakeNoteAside", () => {
  it("sends one note id by kind", async () => {
    const a = actor(async () => ({
      data: [{ set_aside_at: "2026-11-15T10:00:00Z", replayed: false }],
      error: null,
    }))
    expect(
      await setRetakeNoteAside(a, { kind: "coverage", noteId: NOTE })
    ).toEqual({ ok: true, setAsideAt: "2026-11-15T10:00:00Z", replayed: false })
    expect(a.db.rpc).toHaveBeenCalledWith("set_retake_note_aside", {
      p_submission_item_id: NOTE,
    })
    await setRetakeNoteAside(a, { kind: "menu", noteId: NOTE })
    expect(a.db.rpc).toHaveBeenLastCalledWith("set_retake_note_aside", {
      p_photo_id: NOTE,
    })
  })

  it("refuses bad input before the database", async () => {
    const a = actor(async () => ({ data: [], error: null }))
    for (const input of [
      null,
      { kind: "menu" },
      { kind: "task", noteId: NOTE },
      { kind: "menu", noteId: "nope" },
    ])
      expect(await setRetakeNoteAside(a, input)).toMatchObject({
        ok: false,
        code: "invalid_input",
      })
    expect(a.db.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["retake_note_not_found", "not_found"],
    ["retake_note_not_open", "state_conflict"],
    ["work_profile_forbidden", "not_permitted"],
    ["invalid_retake_note", "invalid_input"],
  ])("maps %s to %s", async (message, code) => {
    const a = actor(async () => ({ data: null, error: { message } }))
    expect(
      await setRetakeNoteAside(a, { kind: "menu", noteId: NOTE })
    ).toMatchObject({ ok: false, code })
  })
})
