// The Me "Needs attention" client for /api/upload-labels (contract C1).
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ATTENTION_LOAD_FAILED,
  discardPendingLabels,
  loadNeedsAttention,
  saveFixedLabels,
  SIGNED_OUT_MESSAGE,
} from "@/app/staff/needs-attention-api"
import { EMPTY_LABEL_SUMMARY, type SaveLabelsInput } from "@/lib/menus/types"

const ASSET = "7d000000-0000-4000-8000-000000000001"
const VENUE = "00000000-0000-4000-8000-0000000000a1"
const INPUT: SaveLabelsInput = {
  assetId: ASSET,
  expectedRevision: 0,
  catalogueVersionId: "version-2",
  contentTypes: [],
  note: null,
  items: [],
  missingItem: null,
}

function answer(body: unknown, status = 200) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  )
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe("needs-attention API client", () => {
  it("reads the caller's own rows without caching", async () => {
    const items = [{ assetId: ASSET }]
    const fetch = answer({ ok: true, items })
    expect(await loadNeedsAttention()).toEqual({ ok: true, items })
    expect(fetch).toHaveBeenCalledWith(
      "/api/upload-labels?attention=1",
      expect.objectContaining({ cache: "no-store" })
    )
  })

  it("treats a reply without the list as a failed check, not as nothing to fix", async () => {
    // e.g. a server answering with the label catalogue instead (review n3).
    answer({ ok: true, catalogue: { status: "none" }, focus: null })
    expect(await loadNeedsAttention()).toEqual({
      ok: false,
      message: ATTENTION_LOAD_FAILED,
    })
    answer({ ok: true, items: null })
    expect(await loadNeedsAttention()).toEqual({
      ok: false,
      message: ATTENTION_LOAD_FAILED,
    })
    answer({ ok: true, items: [] })
    expect(await loadNeedsAttention()).toEqual({ ok: true, items: [] })
  })

  it("passes the server's refusal on, and words a dropped connection", async () => {
    answer(
      { ok: false, message: "Your account is not assigned to a venue." },
      403
    )
    expect(await loadNeedsAttention()).toEqual({
      ok: false,
      message: "Your account is not assigned to a venue.",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError()))
    )
    expect(await loadNeedsAttention()).toEqual({
      ok: false,
      message: ATTENTION_LOAD_FAILED,
    })
  })

  it("discards one asset's labels with DELETE and says what happened", async () => {
    const fetch = answer({ ok: true, state: "discarded" })
    expect(await discardPendingLabels(ASSET)).toEqual({
      ok: true,
      state: "discarded",
    })
    expect(fetch).toHaveBeenCalledWith(`/api/upload-labels?assetId=${ASSET}`, {
      method: "DELETE",
    })
    answer({ ok: true, state: "none" })
    expect(await discardPendingLabels(ASSET)).toEqual({
      ok: true,
      state: "none",
    })
    answer({ ok: false, message: "nope" }, 500)
    expect(await discardPendingLabels(ASSET)).toEqual({ ok: false })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError()))
    )
    expect(await discardPendingLabels(ASSET)).toEqual({ ok: false })
  })

  it("reports labels the upload applied before the discard (review m2)", async () => {
    const labels = { ...EMPTY_LABEL_SUMMARY, hasLabels: true, revision: 1 }
    answer({ ok: true, state: "already_applied", labels })
    expect(await discardPendingLabels(ASSET)).toEqual({
      ok: true,
      state: "already_applied",
      labels,
    })
    answer({ ok: true, state: "already_applied" })
    expect(await discardPendingLabels(ASSET)).toEqual({
      ok: true,
      state: "already_applied",
      labels: null,
    })
  })

  it("saves a fix and maps saved, pending, refused and offline answers", async () => {
    const labels = { ...EMPTY_LABEL_SUMMARY, hasLabels: true, revision: 1 }
    const fetch = answer({ ok: true, assetId: ASSET, state: "saved", labels })
    expect(await saveFixedLabels(VENUE, INPUT)).toEqual({
      ok: true,
      assetId: ASSET,
      labels,
    })
    expect(fetch).toHaveBeenCalledWith(
      "/api/upload-labels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ venueId: VENUE, input: INPUT }),
      })
    )

    answer({ ok: true, assetId: ASSET, state: "pending" })
    expect(await saveFixedLabels(VENUE, INPUT)).toMatchObject({
      ok: true,
      pending: true,
    })

    const refused = {
      ok: false,
      assetId: ASSET,
      code: "catalogue_changed",
      message: "The menu changed.",
    }
    answer(refused, 409)
    expect(await saveFixedLabels(VENUE, INPUT)).toEqual(refused)

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError()))
    )
    expect(await saveFixedLabels(VENUE, INPUT)).toMatchObject({
      ok: false,
      code: "unavailable",
      message: "Labels not saved yet. Check your connection and try again.",
    })
  })
})

describe("R7: a 401 means the session ended", () => {
  const signedOut = () =>
    answer({ ok: false, message: "Sign in to continue." }, 401)

  it("says to sign in again when listing, discarding or fixing", async () => {
    signedOut()
    expect(await loadNeedsAttention()).toEqual({
      ok: false,
      message: SIGNED_OUT_MESSAGE,
    })
    signedOut()
    expect(await discardPendingLabels(ASSET)).toEqual({
      ok: false,
      message: SIGNED_OUT_MESSAGE,
    })
    signedOut()
    expect(await saveFixedLabels(VENUE, INPUT)).toEqual({
      ok: false,
      assetId: ASSET,
      code: "forbidden",
      message: SIGNED_OUT_MESSAGE,
    })
  })
})
