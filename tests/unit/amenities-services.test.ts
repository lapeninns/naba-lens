// Amenity services with a mocked caller-scoped RPC client: input checks, error
// mapping, revisions and replays, and the view DTOs built from rows.
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  AmenityRpcName,
  AmenityServiceName,
  AmenityServices,
  CheckRow,
  EventRow,
  SubmissionAssetRow,
  SubmissionRow,
} from "@/lib/amenities/contract"
import * as amenities from "@/lib/server/amenities"
import { amenityRpcFailure } from "@/lib/server/amenities/errors"
import { parseSubmit, parseWifi } from "@/lib/server/amenities/validate"
import {
  checkPermissions,
  submissionViews,
  venueLists,
  wifiFrom,
} from "@/lib/server/amenities/views"
import type { Access } from "@/lib/server/coverage/context"
import type { MediaActor } from "@/lib/server/media/types"

// Every exported service has the contract's shape (actor + untrusted input).
type Impl<K extends AmenityServiceName> = (
  actor: MediaActor,
  input: unknown
) => ReturnType<AmenityServices[K]>
const _services: { [K in AmenityServiceName]: Impl<K> } = amenities
void _services

const VENUE = "11111111-1111-4111-8111-111111111111"
const OTHER_VENUE = "22222222-2222-4222-8222-222222222222"
const CHECK = "33333333-3333-4333-8333-333333333333"
const USER = "44444444-4444-4444-8444-444444444444"
const ASSET = "55555555-5555-4555-8555-555555555555"
const VIDEO = "66666666-6666-4666-8666-666666666666"

type Scope = {
  isAdmin?: boolean
  role?: "staff" | "manager" | "admin"
  venueId?: string | null
  managerVenueId?: string | null
}

type Handler = (args: Record<string, unknown>) => {
  data?: unknown
  error?: { message?: string; code?: string; details?: string | null }
}

function actorWith(
  handlers: Partial<Record<AmenityRpcName, Handler>>,
  scope: Scope = {}
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === "coverage_access_scope") {
      const admin = scope.isAdmin ?? false
      return {
        data: [
          {
            user_id: USER,
            active: true,
            is_admin: admin,
            role: scope.role ?? (admin ? "admin" : "staff"),
            venue_id: scope.venueId === undefined ? VENUE : scope.venueId,
            venue_active: true,
            department: "foh",
            manager_venue_id: scope.managerVenueId ?? null,
          },
        ],
        error: null,
      }
    }
    const handler = handlers[fn as AmenityRpcName]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const actor = {
    profile: {
      id: USER,
      active: true,
      role: scope.role ?? (scope.isAdmin ? "admin" : "staff"),
    },
    db: { rpc },
    service: {},
    storage: {},
  } as unknown as MediaActor
  return { actor, rpc }
}

/** A transitional staff account holding a grant. */
const manager = { managerVenueId: VENUE }
/** A venue manager account: its venue is the managed one. */
const managerAccount = { role: "manager", managerVenueId: VENUE } as const
const admin = { isAdmin: true, venueId: null }

function checkRow(over: Partial<CheckRow> = {}): CheckRow {
  return {
    id: CHECK,
    venue_id: VENUE,
    template_key: "guest_wifi",
    category: "Connectivity",
    question: "Is there guest Wi-Fi?",
    capture_brief: "Photo the sign with the password covered.",
    evidence_rule: "both",
    is_core: true,
    position: 40,
    catalogue_version: 1,
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    current_submission_id: null,
    assignee_user_id: null,
    assignee_name: null,
    answered_by: null,
    answered_by_name: null,
    answered_at: null,
    recheck_reason: null,
    notes: null,
    revision: 1,
    updated_at: "2026-11-07T10:00:00Z",
    ...over,
  }
}

function access(over: Partial<Access> = {}): Access {
  return {
    userId: USER,
    isAdmin: false,
    isStaff: true,
    isManager: false,
    venueId: VENUE,
    venueActive: true,
    department: "foh",
    managerVenueId: null,
    ...over,
  }
}

const submitInput = (over: Record<string, unknown> = {}) => ({
  checkId: CHECK,
  revision: 3,
  idempotencyKey: crypto.randomUUID(),
  answer: "yes",
  finding: "  Sign by the bar  ",
  assetIds: [ASSET, VIDEO],
  wifi: {
    testSpot: "Back garden",
    testedOn: "2026-11-06",
    downloadMbps: 54.2,
    uploadMbps: "12",
  },
  redactionConfirmed: true,
  ...over,
})

afterEach(() => vi.restoreAllMocks())

describe("amenity input checks", () => {
  const now = new Date("2026-11-07T12:00:00Z")

  it("normalises a valid submission", () => {
    const parsed = parseSubmit(submitInput(), now)
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        answer: "yes",
        finding: "Sign by the bar",
        limitations: null,
        reason: null,
        assetIds: [ASSET, VIDEO],
        redactionConfirmed: true,
        wifi: {
          testSpot: "Back garden",
          testedOn: "2026-11-06",
          downloadMbps: 54.2,
          uploadMbps: 12,
        },
      },
    })
  })

  it("needs a reason for No and Not applicable, not for Yes", () => {
    for (const answer of ["no", "not_applicable"]) {
      expect(
        parseSubmit(submitInput({ answer, reason: "  " }), now)
      ).toMatchObject({
        code: "invalid_input",
        fieldErrors: { reason: "Enter a reason." },
      })
      expect(
        parseSubmit(
          submitInput({ answer, reason: "Closed", assetIds: [] }),
          now
        )
      ).toMatchObject({ ok: true, value: { reason: "Closed", assetIds: [] } })
    }
    expect(
      parseSubmit(submitInput({ reason: "x".repeat(501) }), now)
    ).toMatchObject({ fieldErrors: { reason: expect.any(String) } })
  })

  it("refuses more than 10 assets, duplicates and bad ids", () => {
    const eleven = Array.from({ length: 11 }, () => crypto.randomUUID())
    for (const assetIds of [eleven, [ASSET, ASSET], ["nope"], "x"])
      expect(parseSubmit(submitInput({ assetIds }), now)).toMatchObject({
        code: "invalid_input",
        fieldErrors: { assetIds: expect.any(String) },
      })
  })

  it("rejects bad answers, idempotency keys, revisions and ids", () => {
    expect(parseSubmit(submitInput({ answer: "to_check" }), now)).toMatchObject(
      { fieldErrors: { answer: expect.any(String) } }
    )
    expect(
      parseSubmit(submitInput({ idempotencyKey: "retry-1" }), now)
    ).toMatchObject({ fieldErrors: { idempotencyKey: expect.any(String) } })
    expect(parseSubmit(submitInput({ revision: -1 }), now)).toMatchObject({
      code: "invalid_input",
    })
    expect(parseSubmit(submitInput({ revision: 1.5 }), now)).toMatchObject({
      code: "invalid_input",
    })
    expect(parseSubmit(submitInput({ checkId: "x" }), now)).toMatchObject({
      code: "not_found",
    })
  })

  it("checks Wi-Fi notes: spot, a past London date, and speeds in range", () => {
    expect(
      parseWifi(
        {
          testSpot: "",
          testedOn: "2026-11-08",
          downloadMbps: -1,
          uploadMbps: 10001,
        },
        now
      )
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: {
        "wifi.testSpot": expect.any(String),
        "wifi.testedOn": expect.any(String),
        "wifi.downloadMbps": expect.any(String),
        "wifi.uploadMbps": expect.any(String),
      },
    })
    expect(
      parseWifi(
        {
          testSpot: "x".repeat(121),
          testedOn: "2026-02-30",
          downloadMbps: Number.NaN,
          uploadMbps: "fast",
        },
        now
      )
    ).toMatchObject({
      fieldErrors: {
        "wifi.testSpot": expect.any(String),
        "wifi.testedOn": expect.any(String),
        "wifi.downloadMbps": expect.any(String),
        "wifi.uploadMbps": expect.any(String),
      },
    })
    // 23:30 UTC on 7 Nov is still 7 Nov in London in winter, but 8 Nov in BST.
    expect(
      parseWifi(
        {
          testSpot: "Bar",
          testedOn: "2026-11-07",
          downloadMbps: 0,
          uploadMbps: 0,
        },
        new Date("2026-11-07T23:30:00Z")
      ).ok
    ).toBe(true)
    expect(
      parseWifi(
        {
          testSpot: "Bar",
          testedOn: "2026-07-08",
          downloadMbps: 1,
          uploadMbps: 1,
        },
        new Date("2026-07-07T23:30:00Z")
      ).ok
    ).toBe(true)
    expect(parseWifi(null, now)).toMatchObject({
      fieldErrors: { wifi: expect.any(String) },
    })
  })
})

describe("amenity RPC error mapping", () => {
  it("maps a stale revision to revision_conflict with the current revision", () => {
    expect(
      amenityRpcFailure(
        {
          message: "amenity_conflict",
          code: "P0001",
          details: '{"revision":7}',
        },
        "test"
      )
    ).toMatchObject({
      code: "revision_conflict",
      status: 409,
      currentRevision: 7,
    })
    expect(
      amenityRpcFailure({ message: "amenity_conflict", details: "junk" }, "t")
    ).toMatchObject({ code: "revision_conflict", currentRevision: null })
  })

  it("carries the unmet rule and the ineligible asset", () => {
    for (const details of ['"both"', "both", '{"rule":"both"}'])
      expect(
        amenityRpcFailure({ message: "evidence_rule_unmet", details }, "t")
      ).toMatchObject({
        code: "evidence_rule_unmet",
        rule: "both",
        message: "Yes needs at least one photo and one video.",
      })
    expect(
      amenityRpcFailure(
        {
          message: "evidence_not_eligible",
          details: JSON.stringify({ assetId: ASSET, reason: "not_own" }),
        },
        "t"
      )
    ).toMatchObject({
      code: "asset_ineligible",
      assetId: ASSET,
      assetReason: "not_own",
    })
  })

  it("maps each named exception by message, never by HTTP status", () => {
    const cases: Record<string, [string, Record<string, unknown>?]> = {
      not_active_user: ["account_inactive"],
      not_active_admin: ["not_permitted"],
      not_venue_manager: ["not_permitted"],
      amenity_not_permitted: ["not_permitted"],
      venue_not_found: ["not_found"],
      amenity_check_not_found: ["not_found"],
      amenity_key_not_found: ["not_found"],
      amenities_not_enabled: ["needs_setup"],
      amenity_check_archived: ["state_conflict"],
      idempotency_key_reused: ["state_conflict"],
      staff_not_eligible: ["state_conflict"],
      invalid_answer: ["invalid_input", { answer: expect.any(String) }],
      reason_required: ["invalid_input", { reason: "Enter a reason." }],
      invalid_reason: ["invalid_input", { reason: expect.any(String) }],
      invalid_finding: ["invalid_input", { finding: expect.any(String) }],
      invalid_limitations: [
        "invalid_input",
        { limitations: expect.any(String) },
      ],
      invalid_notes: ["invalid_input", { notes: expect.any(String) }],
      invalid_asset_list: ["invalid_input", { assetIds: expect.any(String) }],
      invalid_key_list: ["invalid_input", { keys: expect.any(String) }],
      invalid_wifi_metadata: ["invalid_input", { wifi: expect.any(String) }],
      invalid_reopen_preset: ["invalid_input", { preset: expect.any(String) }],
      redaction_not_confirmed: [
        "invalid_input",
        { redactionConfirmed: expect.any(String) },
      ],
    }
    for (const [message, [code, fieldErrors]] of Object.entries(cases))
      expect(
        amenityRpcFailure({ message, code: "P0001" }, "t"),
        message
      ).toMatchObject({ code, ...(fieldErrors ? { fieldErrors } : {}) })
  })

  it("maps a write at an inactive venue to needs_setup", () => {
    expect(
      amenityRpcFailure({ message: "venue_inactive", code: "P0001" }, "t")
    ).toEqual({
      ok: false,
      code: "needs_setup",
      status: 409,
      message: "This venue is not active, so amenity checks can't be changed.",
    })
  })

  it("logs unexpected failures redacted and answers unavailable", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = amenityRpcFailure(
      {
        message: "boom https://x.test/secret?token=abcdefghijklmnopqrstuvwxyz",
        code: "XX000",
      },
      "submit finding"
    )
    expect(result).toMatchObject({ code: "unavailable", status: 503 })
    expect(log).toHaveBeenCalledOnce()
    const logged = JSON.stringify(log.mock.calls[0])
    expect(logged).toContain("[amenities] submit finding failed")
    expect(logged).not.toContain("x.test")
    expect(logged).not.toContain("abcdefghijklmnopqrstuvwxyz")
  })
})

describe("amenity views", () => {
  it("splits lists, counts active progress and keeps the 10 newest completions", () => {
    const rows: CheckRow[] = [
      checkRow({ id: "a", status: "archived", progress: "complete" }),
      checkRow({ id: "b", progress: "needs_recheck", position: 2 }),
      checkRow({ id: "c", progress: "needs_capture", position: 1 }),
      ...Array.from({ length: 12 }, (_, i) =>
        checkRow({
          id: `done-${i}`,
          template_key: `k${i}`,
          position: 10 + i,
          progress: "complete",
          answer: "yes",
          answered_at: `2026-11-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
        })
      ),
    ]
    const view = venueLists(rows)
    expect(view.archived.map((c) => c.id)).toEqual(["a"])
    expect(view.active[0].id).toBe("c")
    expect(view.counts).toEqual({
      needs_capture: 1,
      complete: 12,
      needs_recheck: 1,
    })
    expect(view.recentlyCompleted).toHaveLength(10)
    expect(view.recentlyCompleted[0].id).toBe("done-11")
    expect(view.recentlyCompleted[9].id).toBe("done-2")
  })

  it("builds evidence links: derivatives for photos, a stream for videos", () => {
    const sub = (id: string, at: string): SubmissionRow => ({
      id,
      check_id: CHECK,
      answer: "yes",
      finding: null,
      limitations: null,
      reason: null,
      submitted_by: USER,
      submitted_by_name: "Sam",
      created_at: at,
      template_version: 1,
      evidence_rule: "both",
      internal_metadata: null,
    })
    const asset = (over: Partial<SubmissionAssetRow>): SubmissionAssetRow => ({
      submission_id: "s2",
      asset_id: ASSET,
      evidence_kind: "photo",
      available: true,
      has_thumbnail: true,
      has_preview: true,
      ...over,
    })
    const views = submissionViews(
      [sub("s1", "2026-11-01T00:00:00Z"), sub("s2", "2026-11-05T00:00:00Z")],
      [
        asset({}),
        asset({ asset_id: VIDEO, evidence_kind: "video" }),
        asset({ asset_id: "gone", available: false }),
        asset({
          asset_id: "nothumb",
          has_thumbnail: false,
          has_preview: false,
        }),
      ],
      "s2"
    )
    expect(views.map((v) => [v.id, v.isCurrent])).toEqual([
      ["s2", true],
      ["s1", false],
    ])
    expect(views[1].evidence).toEqual([])
    expect(views[0].evidence).toEqual([
      {
        assetId: ASSET,
        kind: "photo",
        available: true,
        thumbUrl: `/api/amenities/evidence/${ASSET}/thumb`,
        previewUrl: `/api/amenities/evidence/${ASSET}/preview`,
        streamUrl: null,
      },
      {
        assetId: VIDEO,
        kind: "video",
        available: true,
        thumbUrl: null,
        previewUrl: null,
        streamUrl: `/api/amenities/evidence/${VIDEO}/stream`,
      },
      {
        assetId: "gone",
        kind: "photo",
        available: false,
        thumbUrl: null,
        previewUrl: null,
        streamUrl: null,
      },
      {
        assetId: "nothumb",
        kind: "photo",
        available: true,
        thumbUrl: null,
        previewUrl: null,
        streamUrl: null,
      },
    ])
  })

  it("reads Wi-Fi notes only from internal metadata that is present and complete", () => {
    expect(wifiFrom(null)).toBeNull()
    expect(wifiFrom({ testSpot: "Bar" })).toBeNull()
    expect(
      wifiFrom({
        testSpot: "Bar",
        testedOn: "2026-11-01",
        downloadMbps: 50,
        uploadMbps: 10,
      })
    ).toEqual({
      testSpot: "Bar",
      testedOn: "2026-11-01",
      downloadMbps: 50,
      uploadMbps: 10,
    })
    expect(
      wifiFrom({
        test_spot: "Bar",
        tested_on: "2026-11-01",
        download_mbps: "50",
        upload_mbps: 10,
      })
    ).toMatchObject({ testSpot: "Bar", downloadMbps: 50 })
  })

  it("gives permission flags by role, venue, assignment and state", () => {
    const managerAccess = access({ managerVenueId: VENUE })
    expect(checkPermissions(checkRow(), managerAccess)).toEqual({
      canAssign: true,
      canArchive: true,
      canRestore: false,
      canReopen: false,
      canSubmit: true,
      canAttachLegacy: false,
    })
    expect(
      checkPermissions(
        checkRow({ template_key: "onsite_parking", progress: "complete" }),
        access({ isAdmin: true, isStaff: false, venueId: null })
      )
    ).toEqual({
      canAssign: true,
      canArchive: true,
      canRestore: false,
      canReopen: true,
      canSubmit: true,
      canAttachLegacy: true,
    })
    expect(
      checkPermissions(checkRow({ status: "archived" }), managerAccess)
    ).toMatchObject({
      canRestore: true,
      canArchive: false,
      canSubmit: false,
      canAssign: false,
    })
    // A manager of another venue gets nothing.
    expect(
      Object.values(
        checkPermissions(
          checkRow(),
          access({ venueId: OTHER_VENUE, managerVenueId: OTHER_VENUE })
        )
      ).some(Boolean)
    ).toBe(false)
    // Staff may only submit, and only while assigned.
    expect(
      checkPermissions(checkRow({ assignee_user_id: USER }), access())
    ).toEqual({
      canAssign: false,
      canArchive: false,
      canRestore: false,
      canReopen: false,
      canSubmit: true,
      canAttachLegacy: false,
    })
    expect(checkPermissions(checkRow(), access()).canSubmit).toBe(false)
  })

  it("gives a manager account the full manager flags at its venue only", () => {
    const account = access({
      isStaff: false,
      isManager: true,
      managerVenueId: VENUE,
    })
    expect(
      checkPermissions(
        checkRow({ template_key: "onsite_parking", progress: "complete" }),
        account
      )
    ).toEqual({
      canAssign: true,
      canArchive: true,
      canRestore: false,
      canReopen: true,
      canSubmit: true,
      canAttachLegacy: true,
    })
    expect(
      checkPermissions(checkRow({ status: "archived" }), account)
    ).toMatchObject({ canRestore: true, canSubmit: false })
    // Without an effective grant (or at another venue) it gets nothing, even
    // when named as the assignee.
    for (const other of [
      access({ isStaff: false, isManager: true, managerVenueId: null }),
      access({
        isStaff: false,
        isManager: true,
        venueId: OTHER_VENUE,
        managerVenueId: OTHER_VENUE,
      }),
    ])
      expect(
        Object.values(
          checkPermissions(checkRow({ assignee_user_id: USER }), other)
        ).some(Boolean)
      ).toBe(false)
  })
})

describe("amenity services", () => {
  it("resolves the venue: staff refused, managers held to theirs, admins must name one", async () => {
    const { actor: staff } = actorWith({})
    expect(await amenities.getVenueAmenities(staff, {})).toMatchObject({
      code: "not_permitted",
    })
    const { actor: mgr } = actorWith({}, manager)
    expect(
      await amenities.getVenueAmenities(mgr, { venueId: OTHER_VENUE })
    ).toMatchObject({ code: "wrong_venue" })
    const { actor: adm } = actorWith({}, admin)
    expect(await amenities.getVenueAmenities(adm, {})).toMatchObject({
      code: "invalid_input",
      fieldErrors: { venueId: expect.any(String) },
    })
    expect(
      await amenities.getVenueAmenities(adm, { venueId: "nope" })
    ).toMatchObject({ code: "invalid_input" })
  })

  it("resolves a manager account to its managed venue", async () => {
    const venueState = (args: Record<string, unknown>) => ({
      data: [
        {
          venue_id: args.p_venue_id,
          venue_name: "Crown",
          enabled: false,
          can_enable: false,
        },
      ],
    })
    const { actor: mgr, rpc } = actorWith(
      { amenity_venue_state: venueState },
      managerAccount
    )
    expect(await amenities.getVenueAmenities(mgr, {})).toMatchObject({
      ok: true,
      view: { venue: { id: VENUE } },
    })
    expect(
      await amenities.getVenueAmenities(mgr, { venueId: VENUE })
    ).toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith("amenity_venue_state", {
      p_venue_id: VENUE,
    })
    expect(
      await amenities.getVenueAmenities(mgr, { venueId: OTHER_VENUE })
    ).toMatchObject({ code: "wrong_venue" })
    expect(
      await amenities.listCatalogue(mgr, { venueId: OTHER_VENUE })
    ).toMatchObject({ code: "wrong_venue" })
    // A manager account whose grant is no longer effective manages nothing.
    const { actor: lapsed } = actorWith(
      { amenity_venue_state: venueState },
      { role: "manager", managerVenueId: null }
    )
    expect(await amenities.getVenueAmenities(lapsed, {})).toMatchObject({
      code: "not_permitted",
    })
    expect(
      await amenities.addChecks(lapsed, { keys: ["darts"] })
    ).toMatchObject({ code: "not_permitted" })
  })

  it("gives a manager account no tasks without asking the database", async () => {
    const { actor, rpc } = actorWith({}, managerAccount)
    expect(await amenities.getMyAmenityTasks(actor, {})).toEqual({
      ok: true,
      tasks: [],
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("shows a not-enabled venue without reading its checks", async () => {
    const { actor, rpc } = actorWith(
      {
        amenity_venue_state: (args) => {
          expect(args).toEqual({ p_venue_id: VENUE })
          return {
            data: [
              {
                venue_id: VENUE,
                venue_name: "The Old Crown",
                enabled: false,
                can_enable: false,
              },
            ],
          }
        },
      },
      manager
    )
    const result = await amenities.getVenueAmenities(actor, {})
    expect(result).toEqual({
      ok: true,
      view: {
        venue: { id: VENUE, name: "The Old Crown" },
        enabled: false,
        canEnable: false,
        active: [],
        archived: [],
        recentlyCompleted: [],
        counts: { needs_capture: 0, complete: 0, needs_recheck: 0 },
      },
    })
    expect(rpc).not.toHaveBeenCalledWith(
      "amenity_checks_for_venue",
      expect.anything()
    )
  })

  it("reads an enabled venue's checks including archived", async () => {
    const { actor } = actorWith(
      {
        amenity_venue_state: () => ({
          data: [
            {
              venue_id: VENUE,
              venue_name: "Crown",
              enabled: true,
              can_enable: true,
            },
          ],
        }),
        amenity_checks_for_venue: (args) => {
          expect(args).toEqual({ p_venue_id: VENUE, p_include_archived: true })
          return {
            data: [checkRow(), checkRow({ id: "x", status: "archived" })],
          }
        },
      },
      admin
    )
    const result = await amenities.getVenueAmenities(actor, { venueId: VENUE })
    if (!result.ok) throw new Error(result.code)
    expect(result.view.canEnable).toBe(true)
    expect(result.view.active).toHaveLength(1)
    expect(result.view.archived).toHaveLength(1)
    expect(result.view.active[0]).toMatchObject({
      id: CHECK,
      entry: { key: "guest_wifi", evidenceRule: "both", isCore: true },
      assignee: null,
    })
  })

  it("enables only for admins", async () => {
    const { actor: mgr, rpc } = actorWith({}, manager)
    expect(
      await amenities.enableAmenities(mgr, { venueId: VENUE })
    ).toMatchObject({ code: "not_permitted" })
    expect(rpc).not.toHaveBeenCalledWith(
      "amenity_enable_venue",
      expect.anything()
    )
    const { actor: adm } = actorWith(
      { amenity_enable_venue: () => ({ data: 4 }) },
      admin
    )
    expect(await amenities.enableAmenities(adm, { venueId: VENUE })).toEqual({
      ok: true,
      created: 4,
    })
    expect(await amenities.enableAmenities(adm, {})).toMatchObject({
      code: "invalid_input",
    })
  })

  it("validates catalogue keys before adding", async () => {
    const { actor, rpc } = actorWith(
      {
        amenity_add_checks: (args) => {
          expect(args).toEqual({
            p_venue_id: VENUE,
            p_keys: ["darts", "pool_table"],
          })
          return { data: ["c1", "c2"] }
        },
      },
      manager
    )
    for (const keys of [[], ["darts", "darts"], ["Bad Key"], "darts", [1]])
      expect(await amenities.addChecks(actor, { keys })).toMatchObject({
        code: "invalid_input",
        fieldErrors: { keys: expect.any(String) },
      })
    expect(
      await amenities.addChecks(actor, {
        keys: Array.from({ length: 40 }, (_, i) => `k${i}`),
      })
    ).toMatchObject({ code: "invalid_input" })
    expect(rpc).toHaveBeenCalledTimes(0)
    expect(
      await amenities.addChecks(actor, { keys: ["darts", "pool_table"] })
    ).toEqual({ ok: true, checkIds: ["c1", "c2"] })
  })

  it("passes revisions through and reports a stale one", async () => {
    const { actor } = actorWith({
      amenity_archive_check: (args) =>
        args.p_revision === 2
          ? { data: 3 }
          : {
              error: {
                message: "amenity_conflict",
                code: "P0001",
                details: '{"revision": 5}',
              },
            },
    })
    expect(
      await amenities.archiveCheck(actor, { checkId: CHECK, revision: 2 })
    ).toEqual({ ok: true, revision: 3 })
    expect(
      await amenities.archiveCheck(actor, { checkId: CHECK, revision: 1 })
    ).toMatchObject({ code: "revision_conflict", currentRevision: 5 })
    expect(
      await amenities.archiveCheck(actor, { checkId: CHECK })
    ).toMatchObject({ code: "invalid_input" })
  })

  it("assigns and unassigns", async () => {
    const seen: unknown[] = []
    const { actor } = actorWith({
      amenity_assign_check: (args) => {
        seen.push(args.p_assignee_id)
        return { data: 9 }
      },
    })
    expect(
      await amenities.assignCheck(actor, {
        checkId: CHECK,
        revision: 8,
        assigneeId: USER,
      })
    ).toEqual({ ok: true, revision: 9 })
    await amenities.assignCheck(actor, {
      checkId: CHECK,
      revision: 8,
      assigneeId: null,
    })
    expect(seen).toEqual([USER, null])
    expect(
      await amenities.assignCheck(actor, {
        checkId: CHECK,
        revision: 8,
        assigneeId: "bob",
      })
    ).toMatchObject({ fieldErrors: { assigneeId: expect.any(String) } })
  })

  it("needs free text to reopen with Other", async () => {
    const { actor, rpc } = actorWith({
      amenity_reopen_check: () => ({ data: 4 }),
    })
    expect(
      await amenities.reopenCheck(actor, {
        checkId: CHECK,
        revision: 3,
        preset: "other",
      })
    ).toMatchObject({ fieldErrors: { reason: "Enter a reason." } })
    expect(
      await amenities.reopenCheck(actor, {
        checkId: CHECK,
        revision: 3,
        preset: "nope",
      })
    ).toMatchObject({ fieldErrors: { preset: expect.any(String) } })
    expect(rpc).not.toHaveBeenCalled()
    expect(
      await amenities.reopenCheck(actor, {
        checkId: CHECK,
        revision: 3,
        preset: "credentials_visible",
      })
    ).toEqual({ ok: true, revision: 4 })
    expect(rpc).toHaveBeenLastCalledWith("amenity_reopen_check", {
      p_check_id: CHECK,
      p_revision: 3,
      p_preset: "credentials_visible",
      p_reason: null,
    })
  })

  it("clears notes with blank text and caps their length", async () => {
    const { actor, rpc } = actorWith({
      amenity_set_check_notes: () => ({ data: 2 }),
    })
    await amenities.setCheckNotes(actor, {
      checkId: CHECK,
      revision: 1,
      notes: "   ",
    })
    expect(rpc).toHaveBeenLastCalledWith("amenity_set_check_notes", {
      p_check_id: CHECK,
      p_notes: "",
      p_revision: 1,
    })
    expect(
      await amenities.setCheckNotes(actor, {
        checkId: CHECK,
        revision: 1,
        notes: "x".repeat(2001),
      })
    ).toMatchObject({ fieldErrors: { notes: expect.any(String) } })
  })

  it("submits a finding and returns a replay as the first result", async () => {
    const calls: Record<string, unknown>[] = []
    let first = true
    const { actor } = actorWith({
      amenity_submit_finding: (args) => {
        calls.push(args)
        const replayed = !first
        first = false
        return {
          data: [{ submission_id: "sub-1", revision: 4, replayed }],
        }
      },
    })
    const input = submitInput()
    expect(await amenities.submitFinding(actor, input)).toEqual({
      ok: true,
      submissionId: "sub-1",
      revision: 4,
      replayed: false,
    })
    expect(await amenities.submitFinding(actor, input)).toEqual({
      ok: true,
      submissionId: "sub-1",
      revision: 4,
      replayed: true,
    })
    expect(calls[0]).toEqual({
      p_check_id: CHECK,
      p_revision: 3,
      p_idempotency_key: input.idempotencyKey,
      p_answer: "yes",
      p_finding: "Sign by the bar",
      p_limitations: null,
      p_reason: null,
      p_asset_ids: [ASSET, VIDEO],
      p_internal_metadata: {
        testSpot: "Back garden",
        testedOn: "2026-11-06",
        downloadMbps: 54.2,
        uploadMbps: 12,
      },
      p_redaction_confirmed: true,
    })
  })

  it("maps submit failures from the database", async () => {
    const { actor } = actorWith({
      amenity_submit_finding: () => ({
        error: { message: "evidence_rule_unmet", details: "video" },
      }),
    })
    expect(
      await amenities.submitFinding(
        actor,
        submitInput({ wifi: undefined, redactionConfirmed: undefined })
      )
    ).toMatchObject({
      code: "evidence_rule_unmet",
      rule: "video",
      status: 400,
    })
  })

  it("builds a check detail and reads assignee options only for those who may assign", async () => {
    const handlers = {
      amenity_check: () => ({
        data: [
          checkRow({
            progress: "complete",
            answer: "yes",
            current_submission_id: "s1",
            assignee_user_id: USER,
            assignee_name: "Sam",
          }),
        ],
      }),
      amenity_check_submissions: () => ({
        data: [
          {
            id: "s1",
            check_id: CHECK,
            answer: "yes",
            finding: "Fast",
            limitations: null,
            reason: null,
            submitted_by: USER,
            submitted_by_name: "Sam",
            created_at: "2026-11-06T10:00:00Z",
            template_version: 1,
            evidence_rule: "both",
            internal_metadata: {
              testSpot: "Bar",
              testedOn: "2026-11-06",
              downloadMbps: 80,
              uploadMbps: 20,
            },
          } satisfies SubmissionRow,
        ],
      }),
      amenity_check_submission_assets: () => ({ data: [] }),
      amenity_check_events: () => ({
        data: [
          {
            id: "e1",
            check_id: CHECK,
            kind: "added",
            actor_id: null,
            actor_name: null,
            reason: null,
            detail: { source: "enable" },
            created_at: "2026-11-01T00:00:00Z",
          },
          {
            id: "e2",
            check_id: CHECK,
            kind: "submitted",
            actor_id: USER,
            actor_name: "Sam",
            reason: null,
            detail: { submissionId: "s1", answer: "yes" },
            created_at: "2026-11-06T10:00:00Z",
          },
        ] satisfies EventRow[],
      }),
      amenity_assignee_options: () => ({
        data: [{ id: USER, display_name: "Sam", job_title: null }],
      }),
    } satisfies Partial<Record<AmenityRpcName, Handler>>

    const { actor: mgr } = actorWith(handlers, manager)
    const result = await amenities.getCheck(mgr, { checkId: CHECK })
    if (!result.ok) throw new Error(result.code)
    expect(result.detail.check.assignee).toEqual({
      id: USER,
      displayName: "Sam",
    })
    expect(result.detail.submissions[0]).toMatchObject({
      isCurrent: true,
      wifi: { testSpot: "Bar", downloadMbps: 80 },
    })
    expect(result.detail.events.map((e) => e.id)).toEqual(["e2", "e1"])
    expect(result.detail.assigneeOptions).toEqual([
      { id: USER, displayName: "Sam", jobTitle: null },
    ])
    expect(result.detail.permissions.canReopen).toBe(true)

    const { actor: staff, rpc } = actorWith(handlers)
    const own = await amenities.getCheck(staff, { checkId: CHECK })
    if (!own.ok) throw new Error(own.code)
    expect(own.detail.assigneeOptions).toEqual([])
    expect(own.detail.permissions).toMatchObject({
      canSubmit: true,
      canAssign: false,
    })
    expect(rpc).not.toHaveBeenCalledWith(
      "amenity_assignee_options",
      expect.anything()
    )
  })

  it("treats an unknown or hidden check as not found", async () => {
    const empty = () => ({ data: [] })
    const { actor } = actorWith({
      amenity_check: empty,
      amenity_check_submissions: empty,
      amenity_check_submission_assets: empty,
      amenity_check_events: empty,
    })
    expect(await amenities.getCheck(actor, { checkId: CHECK })).toMatchObject({
      code: "not_found",
      status: 404,
    })
    expect(await amenities.getCheck(actor, { checkId: "1" })).toMatchObject({
      code: "not_found",
    })
  })

  it("lists my open tasks and my submittable assets", async () => {
    const { actor } = actorWith({
      amenity_my_checks: () => ({
        data: [
          checkRow({ id: "mine", assignee_user_id: USER }),
          checkRow({
            id: "done",
            assignee_user_id: USER,
            progress: "complete",
          }),
          checkRow({ id: "theirs", assignee_user_id: OTHER_VENUE }),
        ],
      }),
      amenity_submittable_assets: () => ({
        data: [
          {
            asset_id: ASSET,
            media_type: "image",
            created_at: "2026-11-06T10:00:00Z",
            source: "own",
            has_thumbnail: true,
          },
          {
            asset_id: VIDEO,
            media_type: "video",
            created_at: "2026-11-06T10:00:00Z",
            source: "legacy_coverage",
            has_thumbnail: true,
          },
        ],
      }),
    })
    const tasks = await amenities.getMyAmenityTasks(actor, {})
    if (!tasks.ok) throw new Error(tasks.code)
    expect(tasks.tasks.map((t) => t.id)).toEqual(["mine"])
    expect(
      await amenities.listSubmittableAssets(actor, { checkId: CHECK })
    ).toEqual({
      ok: true,
      assets: [
        {
          assetId: ASSET,
          kind: "photo",
          createdAt: "2026-11-06T10:00:00Z",
          source: "own",
          thumbUrl: `/api/amenities/evidence/${ASSET}/thumb`,
        },
        {
          assetId: VIDEO,
          kind: "video",
          createdAt: "2026-11-06T10:00:00Z",
          source: "legacy_coverage",
          thumbUrl: null,
        },
      ],
    })
  })

  it("marks the catalogue options a venue already has", async () => {
    const { actor } = actorWith(
      {
        amenity_catalogue_for_venue: () => ({
          data: [
            {
              key: "darts",
              category: "Games",
              question: "Darts?",
              capture_brief: "Photo the board",
              evidence_rule: "photo",
              is_core: false,
              position: 30,
              catalogue_version: 1,
              check_id: null,
              check_status: null,
            },
            {
              key: "guest_wifi",
              category: "Connectivity",
              question: "Wi-Fi?",
              capture_brief: "Sign",
              evidence_rule: "both",
              is_core: true,
              position: 4,
              catalogue_version: 1,
              check_id: CHECK,
              check_status: "archived",
            },
          ],
        }),
      },
      manager
    )
    const result = await amenities.listCatalogue(actor, {})
    if (!result.ok) throw new Error(result.code)
    expect(result.options.map((o) => [o.key, o.existing])).toEqual([
      ["guest_wifi", { checkId: CHECK, status: "archived" }],
      ["darts", null],
    ])
  })

  it("reports a venue without Amenities as needing setup", async () => {
    const { actor } = actorWith(
      {
        amenity_catalogue_for_venue: () => ({
          error: { message: "amenities_not_enabled", code: "P0001" },
        }),
      },
      manager
    )
    expect(await amenities.listCatalogue(actor, {})).toMatchObject({
      code: "needs_setup",
      status: 409,
    })
  })
})
