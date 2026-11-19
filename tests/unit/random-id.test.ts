import { afterEach, expect, it, vi } from "vitest"

import { newIdempotencyKey } from "@/lib/browser/random-id"

afterEach(() => vi.unstubAllGlobals())

it("uses native randomUUID in a secure context", () => {
  const uuid = "12345678-9abc-4def-8123-456789abcdef"
  vi.stubGlobal("crypto", { randomUUID: () => uuid })
  expect(newIdempotencyKey()).toBe(uuid)
})

it("builds a v4 UUID from secure random bytes on HTTP LAN origins", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
  })
  expect(newIdempotencyKey()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
})
