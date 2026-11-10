import { describe, expect, it } from "vitest"

import {
  parseAnswersRequest,
  parseMetaRequest,
} from "@/app/api/knowledge/_reader/request"

const VENUE = "0F8F6B2E-1111-4111-8111-111111111111"
const BASE =
  "keys=step_free_entrance,guest_wifi&audience=internal&purpose=operations_lookup&schema=1.0"
const url = (query: string) =>
  new URL(`https://lens.test/api/knowledge/v1/venues/x/answers?${query}`)

describe("answers request", () => {
  it("parses a valid request, keeping key order and lower-casing the venue", () => {
    expect(parseAnswersRequest(url(BASE), VENUE)).toEqual({
      ok: true,
      value: {
        venueId: VENUE.toLowerCase(),
        keys: ["step_free_entrance", "guest_wifi"],
        audience: "internal",
        purpose: "operations_lookup",
        schema: { major: 1, minor: 0, text: "1.0" },
      },
    })
  })

  it.each([
    ["no parameters", ""],
    [
      "a missing schema",
      "keys=guest_wifi&audience=internal&purpose=operations_lookup",
    ],
    ["an unknown parameter", `${BASE}&venue=other`],
    ["a repeated parameter", `${BASE}&audience=internal`],
    ["empty keys", BASE.replace("step_free_entrance,guest_wifi", "")],
    ["an empty key in the list", BASE.replace("guest_wifi", "guest_wifi,")],
    ["duplicate keys", BASE.replace("guest_wifi", "guest_wifi,guest_wifi")],
    ["a malformed key", BASE.replace("guest_wifi", "Guest-WiFi")],
    [
      "a key outside the v1 working list",
      BASE.replace("guest_wifi", "dogs_inside"),
    ],
    [
      "21 keys",
      BASE.replace(
        "step_free_entrance,guest_wifi",
        Array.from({ length: 21 }, (_, i) => `k${i}`).join(",")
      ),
    ],
    ["the public audience", BASE.replace("internal", "public")],
    ["an unknown purpose", BASE.replace("operations_lookup", "marketing")],
    ["a malformed schema", BASE.replace("1.0", "v1")],
  ])("refuses %s as invalid_request", (_name, query) => {
    expect(parseAnswersRequest(url(query), VENUE)).toEqual({
      ok: false,
      failure: { code: "invalid_request" },
    })
  })

  it.each([
    ["a venue name", "the-old-crown"],
    ["a truncated UUID", "0f8f6b2e-1111-4111-8111"],
  ])("refuses %s as the venue ID", (_name, venue) => {
    expect(parseAnswersRequest(url(BASE), venue).ok).toBe(false)
  })

  it.each(["2.0", "1.1", "01.0"])(
    "refuses schema %s as unsupported_version",
    (schema) => {
      expect(
        parseAnswersRequest(url(BASE.replace("1.0", schema)), VENUE)
      ).toEqual({
        ok: false,
        failure: { code: "unsupported_version", supported: ["1.0"] },
      })
    }
  )
})

describe("meta request", () => {
  it("takes no parameters", () => {
    expect(
      parseMetaRequest(new URL("https://lens.test/api/knowledge/v1/meta")).ok
    ).toBe(true)
    expect(
      parseMetaRequest(new URL("https://lens.test/api/knowledge/v1/meta?x=1"))
        .ok
    ).toBe(false)
  })
})
