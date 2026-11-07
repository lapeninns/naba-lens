import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { menuPhotoFailure, OWN_PHOTO_MESSAGE } =
  await import("@/lib/server/menu-photos/errors")

const err = (
  message: string,
  code = "P0001",
  details: string | null = null
) => ({ message, code, details })

afterEach(() => vi.restoreAllMocks())

describe("menuPhotoFailure", () => {
  it("self_review_not_allowed is the own-photo note", () => {
    expect(
      menuPhotoFailure(err("self_review_not_allowed", "42501"), "t")
    ).toMatchObject({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: OWN_PHOTO_MESSAGE,
    })
  })

  it.each([
    "menu_item_relinked",
    "menu_item_labelled",
    "asset_has_labels",
    "relink_requires_label",
    "invalid_transition",
    "menu_item_unavailable",
    "menu_item_not_labelled",
  ])("%s is a state conflict that needs a refresh", (message) => {
    const f = menuPhotoFailure(err(message), "t")
    expect(f).toMatchObject({
      code: "state_conflict",
      status: 409,
      needsRefresh: true,
    })
    expect(f.message).not.toMatch(/dish/i)
  })

  it("invalid_transition 'withdraw first' says so", () => {
    expect(
      menuPhotoFailure(
        err("invalid_transition", "P0001", "withdraw first"),
        "t"
      ).message
    ).toMatch(/Withdraw that decision first/)
  })

  it("corrects_mismatch asks for a reload", () => {
    expect(menuPhotoFailure(err("corrects_mismatch", "22023"), "t")).toEqual(
      expect.objectContaining({
        code: "invalid_input",
        message: "This photo changed. Reload the page.",
      })
    )
  })

  it("evidence_not_eligible is asset_ineligible", () => {
    expect(
      menuPhotoFailure(
        err("evidence_not_eligible", "P0001", "not_ready"),
        "t",
        ["a"]
      )
    ).toMatchObject({
      code: "asset_ineligible",
      assetErrors: [{ assetId: "a", reason: "not_ready" }],
    })
    expect(
      menuPhotoFailure(
        err("evidence_not_eligible", "P0001", "not_food_or_drink"),
        "t"
      )
    ).toMatchObject({
      code: "asset_ineligible",
      message: expect.stringMatching(/food or drink/),
    })
  })

  it.each([
    "media_asset_not_found",
    "menu_item_photo_not_found",
    "venue_not_found",
  ])("%s is not_found", (message) => {
    expect(menuPhotoFailure(err(message, "P0002"), "t")).toMatchObject({
      code: "not_found",
      status: 404,
    })
  })

  it("not_venue_manager is not_permitted", () => {
    expect(
      menuPhotoFailure(err("not_venue_manager", "42501"), "t")
    ).toMatchObject({ code: "not_permitted", status: 403 })
  })

  it("idempotency_key_reused is an invalid request", () => {
    expect(
      menuPhotoFailure(err("idempotency_key_reused", "22023"), "t")
    ).toMatchObject({
      code: "invalid_input",
      message: "This request is invalid. Reload the page.",
    })
  })

  it("coverage_conflict keeps the revision", () => {
    expect(
      menuPhotoFailure(
        err("coverage_conflict", "40001", JSON.stringify({ revision: 7 })),
        "t"
      )
    ).toMatchObject({ code: "revision_conflict", currentRevision: 7 })
  })

  it("unknown error → 503 redacted", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const f = menuPhotoFailure(
      err("relation secret_table does not exist", "42P01"),
      "manager test"
    )
    expect(f).toMatchObject({ code: "unavailable", status: 503 })
    expect(f.message).not.toMatch(/secret_table/)
    expect(log).toHaveBeenCalledOnce()
  })
})
