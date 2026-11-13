// B05-m1 use-grant services (contracts/b05-design.md §2.5) with a mocked
// caller-scoped RPC client: the rollback switch, early input checks, request
// shapes and the mapping from database exceptions to outcomes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MediaActor } from "@/lib/server/media/types"
import {
  createUseGrant,
  getAssetUseStatus,
  mediaUseRpcFailure,
  withdrawAssetUse,
  withdrawUseGrant,
} from "@/lib/server/media/use"

const ASSET = "55555555-5555-4555-8555-555555555555"
const GRANT = "66666666-6666-4666-8666-666666666666"
const ITEM = "77777777-7777-4777-8777-777777777777"
const KEY = "req_0123456789abcdef"

function actorWith(
  handler: (
    fn: string,
    args: Record<string, unknown>
  ) => { data?: unknown; error?: { message: string; code?: string } }
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const out = handler(fn, args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  const actor = {
    profile: { id: "u", active: true, role: "admin" },
    db,
    service: db,
    storage: {},
  } as unknown as MediaActor
  return { actor, rpc }
}

const grantInput = (over: Record<string, unknown> = {}) => ({
  requestKey: KEY,
  assetId: ASSET,
  destinationKey: "old_crown_website",
  purpose: "general_gallery",
  clearanceVersion: "v1",
  clearance: { a_ok: true, b_ok: true },
  ...over,
})

beforeEach(() => vi.stubEnv("NABALENS_PUBLIC_USE_GRANTS", "on"))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("createUseGrant", () => {
  it("is refused while the publicUseGrants switch is off, without a call", async () => {
    vi.stubEnv("NABALENS_PUBLIC_USE_GRANTS", "")
    const { actor, rpc } = actorWith(() => ({}))
    expect(await createUseGrant(actor, grantInput())).toMatchObject({
      ok: false,
      code: "disabled",
      status: 409,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends the caller-scoped RPC with the subject kind derived from the purpose", async () => {
    const { actor, rpc } = actorWith(() => ({
      data: { grantId: GRANT, state: "in_force", replayed: false },
    }))
    const out = await createUseGrant(
      actor,
      grantInput({
        purpose: "menu_item_image",
        subjectId: ITEM,
        effectiveUntil: "2027-11-11T00:00:00Z",
        note: "  checked  ",
      })
    )
    expect(out).toEqual({
      ok: true,
      grantId: GRANT,
      state: "in_force",
      replayed: false,
    })
    expect(rpc).toHaveBeenCalledWith("media_use_grant_create", {
      p_request_key: KEY,
      p_asset_id: ASSET,
      p_destination_key: "old_crown_website",
      p_purpose: "menu_item_image",
      p_subject_kind: "menu_item",
      p_subject_id: ITEM,
      p_profile_key: null,
      p_effective_from: null,
      p_effective_until: "2027-11-11T00:00:00Z",
      p_clearance_version: "v1",
      p_clearance: { a_ok: true, b_ok: true },
      p_note: "checked",
    })
  })

  it("checks input before calling the database", async () => {
    const { actor, rpc } = actorWith(() => ({}))
    const cases: [Record<string, unknown>, string][] = [
      [{ requestKey: "short" }, "requestKey"],
      [{ destinationKey: "Bad Key" }, "destinationKey"],
      [{ purpose: "billboard" }, "purpose"],
      [{ purpose: "menu_item_image" }, "subjectId"],
      [{ subjectId: ITEM }, "subjectId"],
      [{ effectiveUntil: "2027-01-01" }, "effectiveUntil"],
      [
        {
          effectiveFrom: "2027-01-02T00:00:00Z",
          effectiveUntil: "2027-01-01T00:00:00Z",
        },
        "effectiveUntil",
      ],
      [{ clearance: { a_ok: true, b_ok: false } }, "clearance"],
      [{ clearance: {} }, "clearance"],
      [{ clearance: { a_ok: "true" } }, "clearance"],
      [{ note: "x".repeat(501) }, "note"],
      [{ profileKey: "Not A Key" }, "profileKey"],
    ]
    for (const [over, field] of cases) {
      const out = await createUseGrant(actor, grantInput(over))
      expect(out, field).toMatchObject({ ok: false, code: "invalid_input" })
      expect(out.ok ? {} : out.fieldErrors, field).toHaveProperty(field)
    }
    expect(
      await createUseGrant(actor, grantInput({ assetId: "nope" }))
    ).toMatchObject({ ok: false, code: "not_found", status: 404 })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("withdrawals and status", () => {
  it("withdraw works with the switch off and refuses the system-only reason early", async () => {
    vi.stubEnv("NABALENS_PUBLIC_USE_GRANTS", "")
    const { actor, rpc } = actorWith(() => ({
      data: { grantId: GRANT, withdrawn: 1, replayed: false },
    }))
    expect(
      await withdrawUseGrant(actor, {
        requestKey: KEY,
        grantId: GRANT,
        reasonCode: "granter_withdrawn",
      })
    ).toMatchObject({ ok: true, withdrawn: 1 })
    expect(rpc).toHaveBeenCalledWith("media_use_grant_withdraw", {
      p_request_key: KEY,
      p_grant_id: GRANT,
      p_reason_code: "granter_withdrawn",
      p_note: null,
    })
    expect(
      await withdrawUseGrant(actor, {
        requestKey: KEY,
        grantId: GRANT,
        reasonCode: "asset_deleted",
      })
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(
      await withdrawAssetUse(actor, {
        requestKey: KEY,
        assetId: ASSET,
        reasonCode: "owner_request",
        note: "TEST",
      })
    ).toMatchObject({ ok: true })
    expect(rpc).toHaveBeenLastCalledWith("media_use_withdraw_asset", {
      p_request_key: KEY,
      p_asset_id: ASSET,
      p_reason_code: "owner_request",
      p_note: "TEST",
    })
  })

  it("reads status as the caller and maps not found", async () => {
    const status = {
      assetId: ASSET,
      view: "uploader",
      state: "not_granted",
      destinations: [],
    }
    const { actor } = actorWith(() => ({ data: status }))
    expect(await getAssetUseStatus(actor, { assetId: ASSET })).toEqual({
      ok: true,
      status,
    })
    const missing = actorWith(() => ({
      error: { message: "media_asset_not_found", code: "P0002" },
    }))
    expect(
      await getAssetUseStatus(missing.actor, { assetId: ASSET })
    ).toMatchObject({ ok: false, code: "not_found", status: 404 })
  })
})

describe("mediaUseRpcFailure", () => {
  it("maps every named B05-m1 exception", () => {
    const expected: Record<string, [string, number]> = {
      not_active_user: ["not_permitted", 403],
      not_public_use_granter: ["not_permitted", 403],
      own_upload_not_grantable: ["not_permitted", 403],
      media_asset_not_found: ["not_found", 404],
      media_use_grant_not_found: ["not_found", 404],
      use_subject_not_found: ["not_found", 404],
      use_destination_unavailable: ["destination_unavailable", 409],
      subject_not_publishable: ["subject_not_publishable", 409],
      profile_unavailable: ["profile_unavailable", 409],
      derivative_profile_required: ["invalid_input", 400],
      clearance_incomplete: ["clearance_incomplete", 400],
      invalid_use_purpose: ["invalid_input", 400],
      invalid_use_subject: ["invalid_input", 400],
      invalid_use_period: ["invalid_input", 400],
      invalid_request_key: ["invalid_input", 400],
      invalid_reason_code: ["invalid_input", 400],
      invalid_note: ["invalid_input", 400],
      idempotency_key_reused: ["state_conflict", 409],
    }
    for (const [message, [code, status]] of Object.entries(expected))
      expect(mediaUseRpcFailure({ message }, "t"), message).toMatchObject({
        ok: false,
        code,
        status,
      })
  })

  it("logs anything else redacted and answers retry", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(
      mediaUseRpcFailure({ message: "connection reset", code: "08006" }, "t")
    ).toMatchObject({ ok: false, code: "unavailable", status: 503 })
    expect(log).toHaveBeenCalledOnce()
  })
})
