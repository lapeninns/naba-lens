// B05-06 (R5, R12): the search fetcher combines the caller's signal with its
// own timeout without AbortSignal.any, keeps codes and field errors, and only
// rethrows the caller's own abort.
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SEARCH_FETCH_TIMEOUT_MS,
  fetchSearchPage,
} from "@/app/_media/fetch-search-page"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

/** A fetch that never answers until its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted)
          return reject(new DOMException("aborted", "AbortError"))
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        )
      })
  )
}

describe("fetchSearchPage", () => {
  it("returns the page on 200 and sends the cursor", async () => {
    const page = { items: [], nextCursor: "n" }
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () =>
      json(200, { ok: true, page })
    )
    vi.stubGlobal("fetch", fetch)
    expect(await fetchSearchPage("rights=in_force", "c1")).toEqual({
      ok: true,
      page,
    })
    expect(fetch.mock.calls[0]![0]).toBe(
      "/api/media/search?rights=in_force&cursor=c1"
    )
  })

  it("keeps the code and field errors of a 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(400, {
          ok: false,
          code: "invalid_input",
          message: "Check",
          fieldErrors: { cursor: "Expired." },
        })
      )
    )
    expect(await fetchSearchPage("", "old")).toEqual({
      ok: false,
      status: 400,
      code: "invalid_input",
      message: "Check",
      fieldErrors: { cursor: "Expired." },
    })
  })

  it("answers a body that isn't JSON as no reply, with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502 }))
    )
    expect(await fetchSearchPage("", null)).toMatchObject({
      ok: false,
      status: 502,
      code: "no_reply",
    })
  })

  it("rethrows the caller's own abort", async () => {
    vi.stubGlobal("fetch", hangingFetch())
    const controller = new AbortController()
    const pending = fetchSearchPage("", "c", controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
  })

  it("rethrows at once for a signal that was already aborted", async () => {
    const fetch = hangingFetch()
    vi.stubGlobal("fetch", fetch)
    const controller = new AbortController()
    controller.abort()
    await expect(fetchSearchPage("", "c", controller.signal)).rejects.toThrow()
  })

  it("gives up after the timeout as no reply, without AbortSignal.any", async () => {
    vi.useFakeTimers()
    // Safari 16.4-17.3 have neither.
    vi.spyOn(AbortSignal, "any").mockImplementation(() => {
      throw new TypeError("AbortSignal.any is not a function")
    })
    vi.stubGlobal("fetch", hangingFetch())
    const controller = new AbortController()
    const pending = fetchSearchPage("", "c", controller.signal)
    await vi.advanceTimersByTimeAsync(SEARCH_FETCH_TIMEOUT_MS)
    expect(await pending).toMatchObject({
      ok: false,
      status: 0,
      code: "no_reply",
    })
  })

  it("answers a network failure as no reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      })
    )
    expect(await fetchSearchPage("", null)).toMatchObject({
      ok: false,
      code: "no_reply",
    })
  })
})
