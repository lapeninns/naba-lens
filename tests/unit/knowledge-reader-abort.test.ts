import { createClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { readKnowledgeAnswers } from "@/lib/server/knowledge"
import type { Db } from "@/lib/server/media/types"

const VENUE = "0f8f6b2e-1111-4111-8111-111111111111"

/** An rpc() result like supabase-js's builder: awaitable, with abortSignal. */
function builder(result: { data: unknown; error: unknown }) {
  const abortSignal = vi.fn(() => Promise.resolve(result))
  const call = {
    then: Promise.resolve(result).then.bind(Promise.resolve(result)),
    abortSignal,
  }
  return { db: { rpc: vi.fn(() => call) } as unknown as Db, abortSignal }
}

afterEach(() => vi.restoreAllMocks())

describe("reader abort signal", () => {
  it("matches the real supabase-js rpc builder, which offers abortSignal", () => {
    const client = createClient("http://127.0.0.1:9", "placeholder-key")
    const call = client.rpc("knowledge_reader_answers_v1", {
      p_venue_id: VENUE,
      p_keys: [],
    })
    expect(typeof call.abortSignal).toBe("function")
  })

  it("passes the caller's signal to the RPC", async () => {
    const { db, abortSignal } = builder({ data: [], error: null })
    const signal = new AbortController().signal
    expect(
      await readKnowledgeAnswers(db, VENUE, ["guest_toilets"], { signal })
    ).toEqual({
      ok: true,
      rows: [],
    })
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it("does not attach one when no signal is given", async () => {
    const { db, abortSignal } = builder({ data: [], error: null })
    await readKnowledgeAnswers(db, VENUE, [])
    expect(abortSignal).not.toHaveBeenCalled()
  })

  it("treats an aborted read as unavailable without logging a database failure", async () => {
    const { db } = builder({
      data: null,
      error: { code: "20", message: "AbortError: This operation was aborted" },
    })
    const controller = new AbortController()
    controller.abort()
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(
      await readKnowledgeAnswers(db, VENUE, [], { signal: controller.signal })
    ).toEqual({ ok: false, code: "unavailable" })
    expect(logged).not.toHaveBeenCalled()
  })
})
