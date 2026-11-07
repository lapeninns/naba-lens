import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { parseDecideInput } = await import("@/lib/server/menu-photos/validate")

const ASSET = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const ITEM = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"
const OTHER = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a03"
const PHOTO = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a04"

const base = (extra: Record<string, unknown> = {}) => ({
  requestId: "req-12345678",
  action: "accept",
  assetId: ASSET,
  itemId: ITEM,
  expectedRevision: 1,
  ...extra,
})

const parse = (extra: Record<string, unknown> = {}) =>
  parseDecideInput(base(extra))

describe("parseDecideInput", () => {
  it("accepts a plain accept", () => {
    const r = parse()
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.input).toMatchObject({
        action: "accept",
        variantId: null,
        correctsVariantId: null,
        basis: null,
      })
  })

  it("rejects non-uuid asset", () => {
    expect(parse({ assetId: "nope" })).toMatchObject({
      ok: false,
      code: "not_found",
    })
    expect(parse({ itemId: 7 })).toMatchObject({ ok: false, code: "not_found" })
    expect(parse({ variantId: "x" })).toMatchObject({
      ok: false,
      code: "not_found",
    })
  })

  it("reason required for ask_another|withdraw|relink", () => {
    for (const extra of [
      { action: "ask_another" },
      { action: "withdraw", photoId: PHOTO },
      { action: "relink", itemId: OTHER, correctsItemId: ITEM },
    ]) {
      const r = parse({ ...extra, reason: "   " })
      expect(r, extra.action).toMatchObject({
        ok: false,
        code: "invalid_input",
        fieldErrors: { reason: expect.any(String) },
      })
      expect(parse({ ...extra, reason: "Blurry" }).ok, extra.action).toBe(true)
    }
    // Optional elsewhere.
    expect(parse({ action: "assign_stale", correctsItemId: OTHER }).ok).toBe(
      true
    )
  })

  it("reason trimmed and capped at 500", () => {
    const r = parse({ action: "ask_another", reason: "  Too dark  " })
    expect(r.ok && r.input.reason).toBe("Too dark")
    expect(parse({ action: "ask_another", reason: "x".repeat(500) }).ok).toBe(
      true
    )
    expect(
      parse({ action: "ask_another", reason: "x".repeat(501) })
    ).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } })
    expect(parse({ reason: 5 })).toMatchObject({ ok: false })
  })

  it("relink and assign_stale require correctsItemId; assign_unlabelled rejects it", () => {
    expect(parse({ action: "relink", reason: "Wrong" }).ok).toBe(false)
    expect(parse({ action: "assign_stale" }).ok).toBe(false)
    expect(
      parse({ action: "assign_unlabelled", correctsItemId: OTHER }).ok
    ).toBe(false)
    expect(parse({ action: "assign_unlabelled" }).ok).toBe(true)
    // A corrected option needs its item.
    expect(parse({ action: "assign_stale", correctsVariantId: OTHER }).ok).toBe(
      false
    )
    // A relink must change the item or the option.
    expect(
      parse({ action: "relink", reason: "Wrong", correctsItemId: ITEM })
    ).toMatchObject({ ok: false, fieldErrors: { itemId: expect.any(String) } })
    expect(
      parse({
        action: "relink",
        reason: "Large, not small",
        correctsItemId: ITEM,
        correctsVariantId: OTHER,
      }).ok
    ).toBe(true)
  })

  it("set_preferred and withdraw need the photo", () => {
    expect(parse({ action: "set_preferred" }).ok).toBe(false)
    expect(parse({ action: "set_preferred", photoId: PHOTO }).ok).toBe(true)
  })

  it("revision must be positive int", () => {
    for (const expectedRevision of [0, -1, 1.5, "1", null, 2 ** 31])
      expect(parse({ expectedRevision }).ok, String(expectedRevision)).toBe(
        false
      )
    expect(parse({ expectedRevision: 2 ** 31 - 1 }).ok).toBe(true)
  })

  it("requestId pattern", () => {
    for (const requestId of ["short", "has space 123", "x".repeat(129), 12])
      expect(parse({ requestId }).ok, String(requestId)).toBe(false)
    expect(parse({ requestId: "A_b-1234" }).ok).toBe(true)
  })

  it("rejects an unknown action, basis or venue", () => {
    expect(parse({ action: "delete_all" }).ok).toBe(false)
    expect(parse({ action: "reaccept", basis: "guess" }).ok).toBe(false)
    expect(parse({ venueId: "nope" }).ok).toBe(false)
    expect(parseDecideInput(null).ok).toBe(false)
    expect(parseDecideInput([]).ok).toBe(false)
  })
})
