import { afterEach, describe, expect, it, vi } from "vitest"
import { headers } from "next/headers"

import {
  correlatedFetch,
  currentRequestId,
  logger,
  scrubLogText,
  validRequestId,
  withRequestId,
} from "@/lib/server/log/logger"

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
const id = "bf110582-2a07-4e00-8eb0-def0afa03cc7"
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("request correlation and log redaction", () => {
  it("omits synthetic emails, phones, credentials and cookie values", () => {
    const output = scrubLogText(
      "fixture@example.test +44 7700 900000 password=sensitive\nCookie: private\nBearer sample"
    )
    for (const str of ["fixture@", "7700", "sensitive", "private", "sample"]) {
      expect(output).not.toContain(str)
    }
  })

  it("logs valid request metadata, never whole payloads", async () => {
    const captured = vi.spyOn(console, "error").mockImplementation(() => {})
    await withRequestId(id, async () => {
      expect(await currentRequestId()).toBe(id)
      logger.error(
        "failed",
        new Error("fixture@example.test"),
        { private: true },
        503,
        null
      )
    })
    expect(JSON.parse(captured.mock.calls[0][0])).toEqual({
      level: "error",
      event: "failed",
      requestId: id,
      details: ["Error: [email]", "[object omitted]", 503, null],
    })
    expect(validRequestId(id)).toBe(id)
    expect(validRequestId("invalid")).toBeNull()
    expect(await currentRequestId()).toBeNull()
  })

  it("keeps known sign-in event names distinct and still scrubs log details", () => {
    const captured = vi.spyOn(console, "error").mockImplementation(() => {})
    withRequestId(id, () => {
      logger.error("auth_sign_in_link_failed", "private@example.test")
      logger.error("auth_sign_in_code_failed", "invalid_code")
      logger.error("untrusted_opaque_identifier")
    })
    expect(captured.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      {
        level: "error",
        event: "auth_sign_in_link_failed",
        requestId: id,
        details: ["[email]"],
      },
      {
        level: "error",
        event: "auth_sign_in_code_failed",
        requestId: id,
        details: ["invalid_code"],
      },
      { level: "error", event: "[redacted]", requestId: id },
    ])
  })

  it("does not propagate outside the configured origin or outside a request", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response())
    vi.stubGlobal("fetch", send)
    const track = correlatedFetch("https://provider.example.test")
    const provider = "https://provider.example.test/path"
    await track(provider)
    await withRequestId(id, async () => {
      await track(
        new Request(provider, { headers: { accept: "application/json" } })
      )
      await track("https://elsewhere.example.test")
    })
    expect(send.mock.calls[0][1]).toBeUndefined()
    const sent = new Headers(send.mock.calls[1][1]?.headers)
    expect(sent.get("x-request-id")).toBe(id)
    expect(sent.get("accept")).toBe("application/json")
    expect(send.mock.calls[2][1]).toBeUndefined()
  })

  it("correlates concurrent app requests after leaving the proxy scope", async () => {
    const other = "e108d4e1-dd55-42e4-9e22-6d4d35f40657"
    vi.mocked(headers)
      .mockResolvedValueOnce(new Headers({ "x-request-id": id }))
      .mockResolvedValueOnce(new Headers({ "x-request-id": other }))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("first", "42P01")
    logger.error("second", "503")
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2))
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      { level: "error", event: "first", requestId: id, details: ["42P01"] },
      { level: "error", event: "second", requestId: other, details: ["503"] },
    ])
  })

  it("emits immediately without a server request and handles a rejected lookup", async () => {
    const unavailable = new Error("No request")
    vi.mocked(headers)
      .mockImplementationOnce(() => {
        throw unavailable
      })
      .mockRejectedValueOnce(unavailable)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("job failed")
    expect(log).toHaveBeenCalledOnce()
    logger.error("request failed")
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2))
    expect(log.mock.calls.map(([line]) => JSON.parse(line).requestId)).toEqual([
      null,
      null,
    ])
  })
})
