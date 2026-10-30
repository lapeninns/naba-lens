import { describe, expect, it } from "vitest"

import { rpcFailure } from "@/lib/server/media/errors"

describe("rpcFailure: reserve_media_asset limits (wave 3 finding 5)", () => {
  it("maps the open-reservation cap to a plain, non-retry-storm message", () => {
    expect(rpcFailure({ message: "too_many_open_uploads" })).toMatchObject({
      ok: false,
      status: 409,
      message: expect.stringMatching(/too many unfinished uploads/i),
    })
  })

  it("maps a refused extension or size to 400", () => {
    for (const message of ["invalid_extension", "invalid_size"])
      expect(rpcFailure({ message })).toMatchObject({ ok: false, status: 400 })
  })
})
