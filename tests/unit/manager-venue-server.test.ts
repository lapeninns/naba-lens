// S2-MGR: lib/server/manager/venue.ts validates untrusted input, sends the
// right RPC arguments and maps database refusals to the shared error shape.
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  confirmMenuMonth,
  getManagerVenueSummary,
  getVenueHistory,
  getVenueReviewers,
  setVenueReviewer,
} from "@/lib/server/manager/venue"
import type { MediaActor } from "@/lib/server/media/types"

const VENUE = "11111111-1111-4111-8111-111111111111"
const PERSON = "22222222-2222-4222-8222-222222222222"

type Reply = { data?: unknown; error?: { message: string; code: string } }

function actorWith(reply: (fn: string, args: object) => Reply) {
  const rpc = vi.fn(async (fn: string, args: object = {}) => {
    const r = reply(fn, args)
    return { data: r.data ?? null, error: r.error ?? null }
  })
  return { actor: { db: { rpc } } as unknown as MediaActor, rpc }
}

const REVIEWERS = {
  venueId: VENUE,
  main: { profileId: PERSON, name: "Maya", since: "2026-11-18T10:00:00Z" },
  backup: null,
  candidates: [{ profileId: PERSON, name: "Maya" }],
}

describe("venue reviewers", () => {
  it("reads the manager's own venue without naming it", async () => {
    const { actor, rpc } = actorWith(() => ({ data: REVIEWERS }))
    expect(await getVenueReviewers(actor)).toMatchObject({
      ok: true,
      reviewers: { main: { name: "Maya" } },
    })
    expect(rpc).toHaveBeenCalledWith("venue_review_assignments", {})
    expect(await getVenueReviewers(actor, "nope")).toMatchObject({
      ok: false,
      code: "not_found",
    })
  })

  it("nominates, clears and validates before calling the database", async () => {
    const { actor, rpc } = actorWith(() => ({ data: REVIEWERS }))
    expect(
      await setVenueReviewer(actor, {
        venueId: VENUE,
        role: "main",
        profileId: PERSON,
        reason: "  Covers weekends ",
      })
    ).toMatchObject({ ok: true })
    expect(rpc).toHaveBeenLastCalledWith("set_venue_reviewer", {
      p_venue_id: VENUE,
      p_role: "main",
      p_profile_id: PERSON,
      p_reason: "Covers weekends",
    })
    await setVenueReviewer(actor, {
      venueId: VENUE,
      role: "backup",
      profileId: null,
    })
    expect(rpc).toHaveBeenLastCalledWith("set_venue_reviewer", {
      p_venue_id: VENUE,
      p_role: "backup",
      p_profile_id: null,
    })
    for (const bad of [
      null,
      { venueId: VENUE, role: "deputy", profileId: PERSON },
      { venueId: "x", role: "main", profileId: PERSON },
      { venueId: VENUE, role: "main", profileId: "x" },
      {
        venueId: VENUE,
        role: "main",
        profileId: PERSON,
        reason: "x".repeat(501),
      },
    ])
      expect((await setVenueReviewer(actor, bad)).ok).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("maps the database's refusals", async () => {
    const refuse = (message: string, code = "42501") =>
      actorWith(() => ({ error: { message, code } })).actor
    const input = { venueId: VENUE, role: "main", profileId: PERSON }
    expect(
      await setVenueReviewer(refuse("reviewer_not_eligible"), input)
    ).toMatchObject({ code: "invalid_input", field: "profileId" })
    expect(
      await setVenueReviewer(refuse("not_venue_manager"), input)
    ).toMatchObject({ code: "forbidden", status: 403 })
    expect(
      await setVenueReviewer(refuse("boom", "XX000"), input)
    ).toMatchObject({ code: "unavailable", retryable: true })
  })
})

describe("venue summary and the monthly menu check", () => {
  it("reads the summary and rejects a malformed reply", async () => {
    const good = actorWith(() => ({
      data: {
        venueId: VENUE,
        unlabelledPhotos: 2,
        menuCheck: null,
        reviewers: { main: null, backup: null },
      },
    })).actor
    expect(await getManagerVenueSummary(good)).toMatchObject({
      ok: true,
      summary: { unlabelledPhotos: 2, menuCheck: null },
    })
    const bad = actorWith(() => ({ data: { venueId: VENUE } })).actor
    expect(await getManagerVenueSummary(bad)).toMatchObject({
      code: "unavailable",
    })
  })

  it("confirms with an optional note and says when there is no menu", async () => {
    const check = {
      month: "2026-11-01",
      menuVersionId: "m",
      menuTitle: "Autumn",
      due: false,
      confirmedAt: "2026-11-18T10:00:00Z",
      confirmedBy: "Maya",
    }
    const { actor, rpc } = actorWith(() => ({ data: check }))
    expect(
      await confirmMenuMonth(actor, { venueId: VENUE, note: " ok " })
    ).toMatchObject({ ok: true, check: { due: false } })
    expect(rpc).toHaveBeenLastCalledWith("confirm_menu_month", {
      p_venue_id: VENUE,
      p_note: "ok",
    })
    const none = actorWith(() => ({
      error: { message: "no_active_menu", code: "P0002" },
    })).actor
    expect(await confirmMenuMonth(none, {})).toMatchObject({
      code: "conflict",
      message: "This venue has no active menu to confirm.",
    })
  })
})

describe("venue history", () => {
  it("passes source, cursor and a bounded limit; rejects unknown filters", async () => {
    const { actor, rpc } = actorWith(() => ({
      data: { venueId: VENUE, items: [], nextCursor: null },
    }))
    const cursor = { at: "2026-11-18T10:00:00Z", source: "activity", id: "4" }
    expect(
      await getVenueHistory(actor, {
        source: "menu",
        before: cursor,
        limit: 500,
      })
    ).toMatchObject({ ok: true, page: { items: [] } })
    expect(rpc).toHaveBeenLastCalledWith("venue_history", {
      p_source: "menu",
      p_before: cursor,
      p_limit: 100,
    })
    expect(await getVenueHistory(actor, { source: "secrets" })).toMatchObject({
      code: "invalid_input",
      field: "source",
    })
    expect(await getVenueHistory(actor, { before: { at: 1 } })).toMatchObject({
      code: "invalid_input",
      field: "before",
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
