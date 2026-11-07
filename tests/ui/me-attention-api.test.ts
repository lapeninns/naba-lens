// The Me "Needs attention" client for /api/upload-labels (contract C1).
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ATTENTION_LOAD_FAILED,
  discardPendingLabels,
  loadNeedsAttention,
  saveFixedLabels,
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

  it("treats a server without the list (the catalogue answer) as nothing to fix", async () => {
    answer({ ok: true, catalogue: { status: "none" }, focus: null })
    expect(await loadNeedsAttention()).toEqual({ ok: true, items: [] })
  })

  it("passes the server's refusal on, and words a dropped connection", async () => {
    answer({ ok: false, message: "Sign in again." }, 401)
    expect(await loadNeedsAttention()).toEqual({
      ok: false,
      message: "Sign in again.",
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

  it("discards one asset's labels with DELETE", async () => {
    const fetch = answer({ ok: true })
    expect(await discardPendingLabels(ASSET)).toBe(true)
    expect(fetch).toHaveBeenCalledWith(`/api/upload-labels?assetId=${ASSET}`, {
      method: "DELETE",
    })
    answer({ ok: false, message: "nope" }, 500)
    expect(await discardPendingLabels(ASSET)).toBe(false)
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
