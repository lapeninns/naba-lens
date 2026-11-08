import { afterEach, describe, expect, it, vi } from "vitest"

import { createRequirement } from "@/lib/server/coverage/config"
import { attachPhotos } from "@/lib/server/coverage/review"
import {
  getMyMonth,
  getMyTasks,
  submitPhotos,
} from "@/lib/server/coverage/staff"
import { coverageRpcFailure, failure } from "@/lib/server/coverage/errors"
import {
  dueView,
  isLocalDate,
  isOverdue,
  isPeriodKey,
  londonMidnight,
  periodKeyOf,
  periodView,
  shiftPeriod,
} from "@/lib/server/coverage/time"
import type { CoverageErrorCode } from "@/lib/server/coverage/types"
import {
  isRequestKey,
  optionalText,
  optionalUuid,
  uuidList,
} from "@/lib/server/coverage/validate"
import {
  decodeKey,
  encodeKey,
  readableAssets,
} from "@/lib/server/coverage/views"

afterEach(() => vi.restoreAllMocks())

describe("coverage London calendar", () => {
  it("labels months and gives London-midnight bounds in GMT and BST", () => {
    expect(periodView("2026-11", new Date("2026-11-02T10:00:00Z"))).toEqual({
      key: "2026-11",
      label: "November 2026",
      startsAt: "2026-11-01T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
      isCurrent: true,
      timeZone: "Europe/London",
    })
    const july = periodView("2026-07", new Date("2026-11-02T10:00:00Z"))
    expect(july.startsAt).toBe("2026-06-30T23:00:00.000Z")
    expect(july.endsAt).toBe("2026-07-31T23:00:00.000Z")
    expect(july.isCurrent).toBe(false)
    // Months that contain a clock change start and end at different offsets.
    expect(periodView("2026-03").startsAt).toBe("2026-03-01T00:00:00.000Z")
    expect(periodView("2026-03").endsAt).toBe("2026-03-31T23:00:00.000Z")
    expect(periodView("2026-10").startsAt).toBe("2026-09-30T23:00:00.000Z")
    expect(periodView("2026-10").endsAt).toBe("2026-11-01T00:00:00.000Z")
  })

  it("finds London midnight on both clock-change days", () => {
    expect(londonMidnight(2026, 3, 29).toISOString()).toBe(
      "2026-03-29T00:00:00.000Z"
    )
    expect(londonMidnight(2026, 3, 30).toISOString()).toBe(
      "2026-03-29T23:00:00.000Z"
    )
    expect(londonMidnight(2026, 10, 25).toISOString()).toBe(
      "2026-10-24T23:00:00.000Z"
    )
    expect(londonMidnight(2026, 10, 26).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z"
    )
  })

  it("puts an instant in its London month, not its UTC month", () => {
    expect(periodKeyOf(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07")
    expect(periodKeyOf(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10")
    expect(periodKeyOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12")
  })

  it("formats due dates and the exclusive due instant", () => {
    expect(dueView("2026-11-30", false)).toEqual({
      dueOn: "2026-11-30",
      dueAt: "2026-12-01T00:00:00.000Z",
      label: "Due 30 Nov 2026",
      overdue: false,
    })
    expect(dueView("2026-07-31", true).dueAt).toBe("2026-07-31T23:00:00.000Z")
    const now = new Date("2026-11-02T12:00:00Z")
    expect(isOverdue("2026-11-01", false, now)).toBe(true)
    expect(isOverdue("2026-11-01", true, now)).toBe(false)
    expect(isOverdue("2026-11-02", false, now)).toBe(false)
    expect(isOverdue(null, false, now)).toBe(false)
  })

  it("validates period keys and calendar dates", () => {
    expect(isPeriodKey("2026-11")).toBe(true)
    for (const bad of ["2026-13", "2026-1", "26-11", 202611, null])
      expect(isPeriodKey(bad)).toBe(false)
    expect(isLocalDate("2028-02-29")).toBe(true)
    expect(isLocalDate("2026-02-29")).toBe(false)
    expect(isLocalDate("2026-11-31")).toBe(false)
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01")
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12")
  })
})

describe("coverage input checks", () => {
  it("accepts UUID request keys and rejects short or odd ones", () => {
    expect(isRequestKey(crypto.randomUUID())).toBe(true)
    expect(isRequestKey("short")).toBe(false)
    expect(isRequestKey("has space in it")).toBe(false)
  })

  it("rejects duplicate ids regardless of case and enforces the batch size", () => {
    const id = crypto.randomUUID()
    expect(uuidList([id, id.toUpperCase()], 1, 10)).toBeNull()
    expect(uuidList([], 1, 10)).toBeNull()
    expect(uuidList([], 0, 10)).toEqual([])
    expect(
      uuidList(
        Array.from({ length: 11 }, () => crypto.randomUUID()),
        1,
        10
      )
    ).toBeNull()
    expect(uuidList(["not-a-uuid"], 1, 10)).toBeNull()
  })

  it("trims text and flags overlong or non-string values", () => {
    expect(optionalText("  hi  ", 5)).toBe("hi")
    expect(optionalText("   ", 5)).toBeNull()
    expect(optionalText(undefined, 5)).toBeNull()
    expect(optionalText("toolong", 5)).toBeUndefined()
    expect(optionalText(42, 5)).toBeUndefined()
    expect(optionalUuid("")).toBeNull()
    expect(optionalUuid("x")).toBeUndefined()
  })
})

describe("coverage page cursors", () => {
  it("round-trips database timestamps and refuses anything but ISO-8601", () => {
    const id = crypto.randomUUID()
    for (const at of [
      "2026-11-02T08:13:06+00:00",
      "2026-11-02T08:13:06.243+00:00",
      "2026-11-02T08:13:06.243456+01:00",
      "2026-11-02T08:13:06.243Z",
    ])
      expect(decodeKey(encodeKey(at, id))).toEqual({ at, id })
    expect(decodeKey(encodeKey("2026-11-02T08:13:06Z", 42))).toEqual({
      at: "2026-11-02T08:13:06Z",
      id: "42",
    })

    const breakout = 'Nov 1 2026 (",id.gt.0)'
    expect(Number.isNaN(Date.parse(breakout))).toBe(false)
    for (const at of [
      breakout,
      "2026-11-02",
      "2026-11-02 08:13:06+00",
      "2026-11-02T08:13:06+00:00)",
      "2026-11-02T08:13:06+00:00,id.gt.0",
    ])
      expect(decodeKey(encodeKey(at, id)), at).toBeNull()
  })
})

describe("createRequirement replay flag", () => {
  const venueId = crypto.randomUUID()
  const requirementId = crypto.randomUUID()

  function fakeActor(replayed: boolean) {
    const rpc = vi.fn(async (name: string) =>
      name === "coverage_access_scope"
        ? {
            data: [
              {
                user_id: "u",
                active: true,
                is_admin: false,
                role: "staff",
                venue_id: venueId,
                venue_active: true,
                department: "foh",
                manager_venue_id: venueId,
              },
            ],
            error: null,
          }
        : {
            data: [{ requirement_id: requirementId, revision: 1, replayed }],
            error: null,
          }
    )
    return { profile: { id: "u" }, db: { rpc, from: vi.fn() } }
  }

  // Concurrent retries all wait on the database lock, so only its answer can
  // tell a retry from the create.
  it.each([false, true])(
    "passes on replayed=%s from the database without reading first",
    async (replayed) => {
      const actor = fakeActor(replayed)
      const requestId = crypto.randomUUID()
      const result = await createRequirement(actor as never, {
        requestId,
        kind: "service",
        title: "Terrace",
        photoTarget: 1,
      })
      expect(result).toEqual({ ok: true, requirementId, revision: 1, replayed })
      expect(actor.db.rpc).toHaveBeenCalledWith(
        "save_coverage_requirement",
        expect.objectContaining({
          p_client_request_key: requestId,
          p_venue_id: venueId,
        })
      )
      expect(actor.db.from).not.toHaveBeenCalled()
    }
  )
})

describe("readable photos", () => {
  it("reads through community_readable_assets in batches of 100", async () => {
    const ids = Array.from({ length: 150 }, () => crypto.randomUUID())
    const rpc = vi.fn(
      async (_name: string, args: { p_asset_ids: string[] }) => ({
        data: args.p_asset_ids.slice(0, 1).map((id) => ({ id })),
        error: null,
      })
    )
    const result = await readableAssets({ db: { rpc } } as never, ids)
    expect(
      rpc.mock.calls.map(([name, a]) => [name, a.p_asset_ids.length])
    ).toEqual([
      ["community_readable_assets", 100],
      ["community_readable_assets", 50],
    ])
    expect(result.ok && [...result.byId.keys()]).toEqual([ids[0], ids[100]])

    rpc.mockClear()
    expect(await readableAssets({ db: { rpc } } as never, [])).toMatchObject({
      ok: true,
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

/** A query whose calls all chain; awaiting it gives `rows`, maybeSingle the first. */
function fakeQuery(rows: unknown[]): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === "then"
          ? (resolve: (value: unknown) => void) =>
              resolve({ data: rows, error: null })
          : prop === "maybeSingle"
            ? async () => ({ data: rows[0] ?? null, error: null })
            : () => chain,
    }
  )
  return chain
}

describe("submit and attach replay flags", () => {
  const venueId = crypto.randomUUID()
  const requirementId = crypto.randomUUID()
  const assetId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const scope = {
    user_id: "u",
    active: true,
    is_admin: false,
    role: "staff",
    venue_id: venueId,
    venue_active: true,
    department: "foh",
    manager_venue_id: venueId,
  }
  const tables: Record<string, unknown[]> = {
    coverage_submissions: [],
    coverage_submission_items: [],
    coverage_requirements: [{ id: requirementId, venue_id: venueId }],
    media_assets: [
      {
        id: assetId,
        uploader_id: "u",
        venue_id: venueId,
        upload_state: "ready",
        deleted_at: null,
        media_type: "image",
        created_at: new Date().toISOString(),
      },
    ],
  }

  function fakeActor(rpc: string, replayed: boolean) {
    const row = {
      item_id: itemId,
      asset_id: assetId,
      state: "submitted",
      revision: 1,
      reused: replayed,
      replayed,
    }
    return {
      profile: { id: "u", role: "staff" },
      db: {
        from: vi.fn((table: string) => fakeQuery(tables[table] ?? [])),
        rpc: vi.fn(async (name: string) => ({
          data:
            name === "coverage_access_scope"
              ? [scope]
              : name === "community_readable_assets"
                ? tables.media_assets
                : name === rpc
                  ? [row]
                  : null,
          error: null,
        })),
      },
    }
  }

  // A concurrent retry finds no earlier request when it reads first; only the
  // database, which made it wait for the first call, knows it was a replay.
  it.each([false, true])(
    "passes on replayed=%s from the database when nothing was found first",
    async (replayed) => {
      const submitter = fakeActor("submit_coverage_photos", replayed)
      expect(
        await submitPhotos(submitter as never, {
          requestId: crypto.randomUUID(),
          requirementId: null,
          assetIds: [assetId],
        })
      ).toMatchObject({
        ok: true,
        replayed,
        submitted: [{ submissionId: itemId, reused: replayed }],
      })
      const manager = fakeActor("attach_coverage_evidence", replayed)
      expect(
        await attachPhotos(manager as never, {
          requestId: crypto.randomUUID(),
          requirementId,
          assetIds: [assetId],
        })
      ).toMatchObject({
        ok: true,
        replayed,
        submitted: [{ submissionId: itemId }],
      })
    }
  )
})

describe("coverage RPC failure mapping (schema v4 §8)", () => {
  const map = (
    message: string,
    code: string,
    details?: string,
    ids?: string[]
  ) => coverageRpcFailure({ message, code, details }, "test", ids)

  it("maps a stale revision to revision_conflict with the current revision", () => {
    const f = map(
      "coverage_conflict",
      "40001",
      '{"revision": 4, "state": "submitted"}'
    )
    expect(f).toMatchObject({
      code: "revision_conflict",
      status: 409,
      currentRevision: 4,
    })
    expect(
      map("coverage_conflict", "40001", '{"revision": null}').currentRevision
    ).toBeNull()
  })

  it.each([
    ["requirement_not_assigned", "P0001", "not_permitted", 403],
    ["not_venue_manager", "42501", "not_permitted", 403],
    ["historical_admin_only", "42501", "not_permitted", 403],
    ["not_active_user", "42501", "account_inactive", 403],
    ["coverage_item_not_found", "P0002", "not_found", 404],
    ["invalid_transition", "P0001", "state_conflict", 409],
    ["idempotency_key_reused", "22023", "state_conflict", 409],
    ["staff_not_eligible", "P0001", "state_conflict", 409],
    ["requirement_not_open", "P0001", "state_conflict", 409],
    ["amenity_unknown", "P0001", "needs_setup", 409],
    ["amenity_unconfirmed", "P0001", "needs_setup", 409],
    ["venue_inactive", "P0001", "needs_setup", 409],
    ["some_new_denial", "42501", "not_permitted", 403],
    ["some_new_missing", "P0002", "not_found", 404],
  ])("maps %s (%s) to %s", (message, code, expected, status) => {
    expect(map(message, code)).toMatchObject({ code: expected, status })
  })

  it("keys field errors by input field", () => {
    expect(map("invalid_title", "22023").fieldErrors).toEqual({
      title: expect.any(String),
    })
    expect(map("reason_required", "22023").fieldErrors).toEqual({
      reason: "Enter a reason.",
    })
    expect(map("invalid_target_count", "22023").fieldErrors).toHaveProperty(
      "targetCount"
    )
  })

  it("names the photo problem and attributes it when one photo was sent", () => {
    const id = crypto.randomUUID()
    expect(
      map("evidence_not_eligible", "P0001", "other_venue", [id])
    ).toMatchObject({
      code: "asset_ineligible",
      assetErrors: [{ assetId: id, reason: "wrong_venue" }],
    })
    expect(
      map("evidence_not_eligible", "P0001", "evidence_removed", [id, id])
    ).toMatchObject({
      code: "asset_ineligible",
      assetErrors: [],
    })
    expect(
      map("asset_already_submitted", "P0001", '{"itemId":"x"}', [id])
        .assetErrors
    ).toEqual([{ assetId: id, reason: "counted_elsewhere" }])
    expect(
      map("evidence_not_eligible", "P0001", "outside_period", [id])
    ).toMatchObject({
      code: "asset_ineligible",
      status: 409,
      message: "A photo was not uploaded this month.",
      assetErrors: [{ assetId: id, reason: "outside_period" }],
    })
  })

  it("says how many menu sections still need setup", () => {
    expect(
      map("plan_incomplete", "P0001", '{"needsSetup": 3}').message
    ).toContain("3 left")
  })

  it("hides unexpected database text and logs it redacted", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const f = map("relation does not exist", "42P01")
    expect(f).toMatchObject({ code: "unavailable", status: 503 })
    expect(f.message).not.toContain("relation")
    expect(log).toHaveBeenCalledWith(
      "[coverage] test failed",
      expect.anything()
    )
  })

  it("uses one status per error code", () => {
    const expected: Record<CoverageErrorCode, number> = {
      unauthenticated: 401,
      account_inactive: 403,
      not_permitted: 403,
      wrong_venue: 403,
      not_found: 404,
      invalid_input: 400,
      needs_setup: 409,
      revision_conflict: 409,
      state_conflict: 409,
      asset_ineligible: 409,
      unavailable: 503,
    }
    for (const [code, status] of Object.entries(expected))
      expect(failure(code as CoverageErrorCode, "x").status).toBe(status)
  })
})

describe("own photo windows", () => {
  const venueId = crypto.randomUUID()
  const me = crypto.randomUUID()
  const scope = {
    user_id: me,
    active: true,
    is_admin: false,
    role: "staff",
    venue_id: venueId,
    venue_active: true,
    department: "foh",
    manager_venue_id: null,
  }

  function itemRow(state: string, overrides: Record<string, unknown> = {}) {
    return {
      item_id: crypto.randomUUID(),
      venue_id: venueId,
      revision: 1,
      state,
      origin: "submitted",
      requirement_id: null,
      requirement_title: null,
      author_id: me,
      author_name: "TEST Sam",
      author_active: true,
      submitted_by: me,
      submitted_at: "2026-11-02T10:00:00.000Z",
      submitted_month: "2026-11-01",
      uploaded_month: "2026-11-01",
      monthly_eligible: true,
      asset_id: crypto.randomUUID(),
      media_type: "image",
      has_preview: true,
      has_thumbnail: true,
      width: 100,
      height: 100,
      evidence_available: true,
      decision_reason: state === "needs_another_photo" ? "Too dark" : null,
      decided_by: state === "submitted" ? null : crypto.randomUUID(),
      decided_at: state === "submitted" ? null : "2026-11-03T10:00:00.000Z",
      self_review: false,
      archived: false,
      replaces_item_id: null,
      ...overrides,
    }
  }

  /** The database as getMyTasks/getMyMonth read it: the window holds `newest`. */
  function fakeActor({
    newest,
    declined = [],
    replacements = [],
  }: {
    newest: unknown[]
    declined?: unknown[]
    replacements?: unknown[]
  }) {
    const tables: Record<string, unknown[]> = {
      coverage_requirement_assignees: [],
      coverage_submission_items: replacements,
    }
    return {
      profile: { id: me, role: "staff", displayName: "TEST Sam", venue: null },
      db: {
        from: vi.fn((table: string) => fakeQuery(tables[table] ?? [])),
        rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
          data:
            name === "coverage_access_scope"
              ? [scope]
              : name === "coverage_items_page"
                ? (args.p_states as string[] | undefined)?.includes(
                    "needs_another_photo"
                  )
                  ? declined
                  : newest
                : [],
          error: null,
        })),
      },
    }
  }

  it("keeps a request for another photo that 101 newer photos pushed out of the window", async () => {
    const newest = Array.from({ length: 101 }, () => itemRow("submitted"))
    const old = itemRow("needs_another_photo", {
      submitted_at: "2026-10-01T10:00:00.000Z",
    })
    const answered = itemRow("needs_another_photo", {
      submitted_at: "2026-09-01T10:00:00.000Z",
    })
    const actor = fakeActor({
      newest,
      declined: [old, answered],
      replacements: [{ replaces_item_id: answered.item_id }],
    })
    const result = await getMyTasks(actor as never)
    expect(
      result.ok && result.tasks.needsAnotherPhoto.map((s) => s.id)
    ).toEqual([old.item_id])
    expect(actor.db.rpc).toHaveBeenCalledWith(
      "coverage_items_page",
      expect.objectContaining({
        p_author_id: me,
        p_states: ["needs_another_photo"],
      })
    )
  })

  it("drops a request answered by a replacement inside the window", async () => {
    const asked = itemRow("needs_another_photo")
    const replacement = itemRow("submitted", {
      replaces_item_id: asked.item_id,
    })
    const actor = fakeActor({
      newest: [replacement, asked],
      declined: [asked],
    })
    const result = await getMyTasks(actor as never)
    expect(result.ok && result.tasks.needsAnotherPhoto).toEqual([])
  })

  it.each([
    [100, false],
    [101, true],
  ])(
    "shows the newest 100 of %i sent photos and says whether there are more",
    async (sent, more) => {
      const actor = fakeActor({
        newest: Array.from({ length: sent }, () => itemRow("submitted")),
      })
      const result = await getMyMonth(actor as never, { period: "2026-11" })
      expect(result.ok && result.month.submissions).toHaveLength(100)
      expect(result.ok && result.more).toBe(more)
    }
  )
})
