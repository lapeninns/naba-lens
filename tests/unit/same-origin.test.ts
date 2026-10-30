import { describe, expect, it } from "vitest"

import { isSameOriginRequest } from "@/lib/server/http/same-origin"

const h = (init: Record<string, string>) => new Headers(init)

describe("isSameOriginRequest (wave 3 finding 7)", () => {
  it("accepts a same-origin browser POST, including 127.0.0.1 in development", () => {
    expect(
      isSameOriginRequest(
        h({
          host: "127.0.0.1:3631",
          origin: "http://127.0.0.1:3631",
          "sec-fetch-site": "same-origin",
        })
      )
    ).toBe(true)
    expect(
      isSameOriginRequest(
        h({
          host: "internal:3000",
          "x-forwarded-host": "nabalens.example",
          origin: "https://nabalens.example",
        })
      )
    ).toBe(true)
  })

  it("accepts requests without browser provenance headers (no cookies to ride)", () => {
    expect(isSameOriginRequest(h({ host: "nabalens.example" }))).toBe(true)
  })

  it("rejects cross-site and same-site-but-cross-origin requests", () => {
    for (const site of ["cross-site", "same-site"])
      expect(
        isSameOriginRequest(
          h({ host: "nabalens.example", "sec-fetch-site": site })
        )
      ).toBe(false)
    expect(
      isSameOriginRequest(
        h({ host: "nabalens.example", origin: "https://evil.example" })
      )
    ).toBe(false)
    expect(
      isSameOriginRequest(
        h({
          host: "nabalens.example",
          origin: "https://sub.nabalens.example",
        })
      )
    ).toBe(false)
  })

  it("rejects an opaque or malformed Origin", () => {
    for (const origin of ["null", "not a url"])
      expect(isSameOriginRequest(h({ host: "nabalens.example", origin }))).toBe(
        false
      )
  })
})
