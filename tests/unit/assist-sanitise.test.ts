import { describe, expect, it } from "vitest"

import {
  checkEvidenceDescribeInput,
  checkLabelSuggestInput,
  checkMenuImportInput,
  prepareMissingFieldInput,
  redactText,
  type AssetFacts,
} from "@/lib/server/assist/sanitise"

import cases from "../fixtures/assist/sanitise.json"

const ownPhoto: AssetFacts = {
  purpose: "general",
  mediaType: "image",
  uploadState: "ready",
  deleted: false,
  viewerCanOpen: true,
  ownUpload: true,
}

describe("text redaction (B09-02b)", () => {
  for (const c of cases.cases) {
    it(c.id, () => {
      const out = redactText(c.note)
      for (const gone of c.mustNotContain) expect(out.text).not.toContain(gone)
      for (const kept of c.mustContain) expect(out.text).toContain(kept)
      expect(out.credentialLike).toBe(c.credentialLike)
    })
  }
})

describe("input refusals (B09-02b)", () => {
  it("J1: only a ready, general-purpose image the person can open", () => {
    const check = (asset: Partial<AssetFacts>) =>
      checkLabelSuggestInput({
        asset: { ...ownPhoto, ...asset },
        requester: "staff",
        reviewTriggerEnabled: false,
      })
    expect(check({})).toEqual({ ok: true })
    expect(check({ purpose: "amenity" })).toEqual({
      ok: false,
      reason: "asset_purpose_excluded",
    })
    expect(check({ mediaType: "video" })).toEqual({
      ok: false,
      reason: "video_not_supported",
    })
    expect(check({ uploadState: "processing" })).toEqual({
      ok: false,
      reason: "asset_not_ready",
    })
    expect(check({ deleted: true })).toEqual({
      ok: false,
      reason: "asset_deleted",
    })
    expect(check({ viewerCanOpen: false })).toEqual({
      ok: false,
      reason: "asset_not_found",
    })
  })

  it("J1: a colleague's photo only in Review, and only once OD-B9-3 allows it (review L1)", () => {
    const colleague = { ...ownPhoto, ownUpload: false }
    expect(
      checkLabelSuggestInput({
        asset: colleague,
        requester: "manager",
        reviewTriggerEnabled: false,
      })
    ).toEqual({ ok: false, reason: "review_trigger_not_enabled" })
    expect(
      checkLabelSuggestInput({
        asset: colleague,
        requester: "staff",
        reviewTriggerEnabled: true,
      })
    ).toEqual({ ok: false, reason: "review_trigger_not_enabled" })
    expect(
      checkLabelSuggestInput({
        asset: colleague,
        requester: "manager",
        reviewTriggerEnabled: true,
      })
    ).toEqual({ ok: true })
  })

  it("J2: admins only, operator documents only, within limits", () => {
    const base = {
      sourceKind: "operator_document",
      requester: "admin" as const,
      pageCount: 2,
      totalBytes: 1000,
      maxPages: 20,
      maxBytes: 10_000,
    }
    expect(checkMenuImportInput(base)).toEqual({ ok: true })
    expect(checkMenuImportInput({ ...base, requester: "manager" })).toEqual({
      ok: false,
      reason: "requester_not_allowed",
    })
    expect(
      checkMenuImportInput({ ...base, sourceKind: "venue_website" })
    ).toEqual({ ok: false, reason: "source_not_operator_document" })
    expect(checkMenuImportInput({ ...base, pageCount: 21 })).toEqual({
      ok: false,
      reason: "too_many_pages",
    })
    expect(checkMenuImportInput({ ...base, totalBytes: 20_000 })).toEqual({
      ok: false,
      reason: "input_too_large",
    })
  })

  it("J3: never for guest_wifi or restricted keys, or someone else's photo", () => {
    const check = (
      questionKey: string,
      sensitivity: "ordinary" | "restricted_detail",
      asset = ownPhoto
    ) => checkEvidenceDescribeInput({ questionKey, sensitivity, asset })
    expect(check("step_free_entrance", "ordinary")).toEqual({ ok: true })
    expect(check("guest_wifi", "ordinary")).toEqual({
      ok: false,
      reason: "question_excluded",
    })
    expect(check("onsite_parking", "restricted_detail")).toEqual({
      ok: false,
      reason: "question_excluded",
    })
    expect(
      check("step_free_entrance", "ordinary", { ...ownPhoto, ownUpload: false })
    ).toEqual({ ok: false, reason: "asset_not_own" })
  })

  it("J4: redacts the note and refuses anything credential-like", () => {
    const base = {
      questionKey: "onsite_parking",
      sensitivity: "ordinary" as const,
      maxBytes: 4096,
    }
    const ok = prepareMissingFieldInput({
      ...base,
      note: "Fee £2, ask 07700 900123",
    })
    expect(ok.ok && ok.text).toBe("Fee £2, ask [removed]")
    expect(
      prepareMissingFieldInput({ ...base, note: "password: abc123" })
    ).toEqual({ ok: false, reason: "credential_like_text" })
    expect(
      prepareMissingFieldInput({
        ...base,
        questionKey: "guest_wifi",
        note: "fast",
      })
    ).toEqual({ ok: false, reason: "question_excluded" })
    expect(
      prepareMissingFieldInput({ ...base, note: "x".repeat(5000) })
    ).toEqual({ ok: false, reason: "input_too_large" })
  })
})
