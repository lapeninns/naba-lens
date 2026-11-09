import { describe, expect, it } from "vitest"

import {
  bearerCredential,
  consumerQuestions,
  credentialDigest,
  credentialOutsideHeader,
  parseRegistry,
  readerConfigFromEnv,
  verifyCredential,
} from "@/app/api/knowledge/_reader/credentials"

const VENUE = "0f8f6b2e-1111-4111-8111-111111111111"
const SECRET_A = "a".repeat(43)
const SECRET_B = "B-_".repeat(15)
const CRED_A = `nlr_ops-desk_${SECRET_A}`
const CRED_B = `nlr_ops-desk_${SECRET_B}`
const NOW = Date.parse("2026-11-20T10:00:00Z")
const FUTURE = "2027-02-01T00:00:00Z"
const PAST = "2026-11-01T00:00:00Z"

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "ops-desk",
    credentials: [{ sha256: credentialDigest(CRED_A), expiresAt: FUTURE }],
    venues: [VENUE],
    audiences: ["internal"],
    purposes: ["operations_lookup"],
    questions: "all",
    schemaMajors: [1],
    ...overrides,
  }
}
const registryOf = (...entries: unknown[]) =>
  parseRegistry(JSON.stringify(entries))

describe("consumer registry", () => {
  it("accepts a well-formed registry", () => {
    const registry = registryOf(entry())!
    const consumer = registry.get("ops-desk")!
    expect(consumer.venues.has(VENUE)).toBe(true)
    expect(consumer.disabled).toBe(false)
    expect(consumerQuestions(consumer)).toEqual([
      "step_free_entrance",
      "onsite_parking",
      "guest_toilets",
      "guest_wifi",
    ])
    expect(
      consumerQuestions(
        registryOf(entry({ questions: ["guest_toilets"] }))!.get("ops-desk")!
      )
    ).toEqual(["guest_toilets"])
  })

  it.each<[string, unknown]>([
    ["not JSON", "{"],
    ["not an array", { id: "x" }],
    ["an empty array", []],
    ["an unknown field", [entry({ secret: "x" })]],
    ["a bad id", [entry({ id: "Ops_Desk" })]],
    ["duplicate ids", [entry(), entry()]],
    ["no credentials", [entry({ credentials: [] })]],
    [
      "three credentials",
      [
        entry({
          credentials: [1, 2, 3].map(() => ({
            sha256: credentialDigest(CRED_A),
            expiresAt: FUTURE,
          })),
        }),
      ],
    ],
    [
      "a plain credential instead of a digest",
      [entry({ credentials: [{ sha256: CRED_A, expiresAt: FUTURE }] })],
    ],
    [
      "an upper-case digest",
      [
        entry({
          credentials: [
            {
              sha256: credentialDigest(CRED_A).toUpperCase(),
              expiresAt: FUTURE,
            },
          ],
        }),
      ],
    ],
    [
      "a credential without expiry",
      [entry({ credentials: [{ sha256: credentialDigest(CRED_A) }] })],
    ],
    [
      "an invalid expiry",
      [
        entry({
          credentials: [
            { sha256: credentialDigest(CRED_A), expiresAt: "soon" },
          ],
        }),
      ],
    ],
    ["a venue name instead of an ID", [entry({ venues: ["The Old Crown"] })]],
    ["no venues", [entry({ venues: [] })]],
    ["the public audience (B06)", [entry({ audiences: ["public"] })]],
    ["an unknown purpose", [entry({ purposes: ["marketing"] })]],
    [
      "a question outside the working list",
      [entry({ questions: ["dogs_inside"] })],
    ],
    ["schema major 2", [entry({ schemaMajors: [2] })]],
    ["a non-boolean disabled", [entry({ disabled: "yes" })]],
  ])("refuses %s", (_name, value) => {
    expect(
      parseRegistry(typeof value === "string" ? value : JSON.stringify(value))
    ).toBeNull()
  })

  it("is off unless switched on, and off when the registry is invalid", () => {
    const raw = JSON.stringify([entry()])
    expect(readerConfigFromEnv({ KNOWLEDGE_READER_CONSUMERS: raw })).toEqual({
      ok: false,
      reason: "disabled",
    })
    expect(
      readerConfigFromEnv({
        KNOWLEDGE_READER_ENABLED: "true",
        KNOWLEDGE_READER_CONSUMERS: "[",
      })
    ).toEqual({ ok: false, reason: "invalid_registry" })
    expect(
      readerConfigFromEnv({
        KNOWLEDGE_READER_ENABLED: "true",
        KNOWLEDGE_READER_CONSUMERS: raw,
      }).ok
    ).toBe(true)
  })
})

describe("credential verification", () => {
  const registry = registryOf(
    entry({
      credentials: [
        { sha256: credentialDigest(CRED_A), expiresAt: FUTURE },
        { sha256: credentialDigest(CRED_B), expiresAt: FUTURE },
      ],
    }),
    entry({
      id: "old-tool",
      credentials: [
        {
          sha256: credentialDigest(`nlr_old-tool_${SECRET_A}`),
          expiresAt: PAST,
        },
      ],
    }),
    entry({
      id: "off-tool",
      disabled: true,
      credentials: [
        {
          sha256: credentialDigest(`nlr_off-tool_${SECRET_A}`),
          expiresAt: FUTURE,
        },
      ],
    })
  )!

  it("accepts either of a consumer's two credentials (rotation)", () => {
    expect(verifyCredential(registry, CRED_A, NOW)?.id).toBe("ops-desk")
    expect(verifyCredential(registry, CRED_B, NOW)?.id).toBe("ops-desk")
  })

  it.each([
    ["missing", null],
    ["empty", ""],
    ["a wrong secret", `nlr_ops-desk_${"c".repeat(43)}`],
    ["another consumer's id with a valid secret", `nlr_off-tool_${SECRET_B}`],
    ["an unknown consumer", `nlr_nobody_${SECRET_A}`],
    ["an expired credential", `nlr_old-tool_${SECRET_A}`],
    ["a disabled consumer", `nlr_off-tool_${SECRET_A}`],
    ["a short secret", `nlr_ops-desk_${"a".repeat(42)}`],
    ["no prefix", `ops-desk_${SECRET_A}`],
    ["the digest itself", credentialDigest(CRED_A)],
  ])("refuses %s", (_name, credential) => {
    expect(verifyCredential(registry, credential, NOW)).toBeNull()
  })

  it("expires at the stored time", () => {
    const at = Date.parse(FUTURE)
    expect(verifyCredential(registry, CRED_A, at - 1)).not.toBeNull()
    expect(verifyCredential(registry, CRED_A, at)).toBeNull()
  })
})

describe("where the credential may be sent", () => {
  const headers = (h: Record<string, string>) => new Headers(h)

  it("reads only an Authorization Bearer header", () => {
    expect(
      bearerCredential(headers({ authorization: `Bearer ${CRED_A}` }))
    ).toBe(CRED_A)
    expect(
      bearerCredential(headers({ authorization: `bearer ${CRED_A}` }))
    ).toBe(CRED_A)
    for (const value of [
      `Basic ${CRED_A}`,
      CRED_A,
      `Bearer ${CRED_A} extra`,
      `Bearer ${"x".repeat(600)}`,
    ]) {
      expect(
        bearerCredential(headers({ authorization: value })),
        value.slice(0, 20)
      ).toBeNull()
    }
    expect(bearerCredential(headers({}))).toBeNull()
  })

  it("notices a credential in the query string or a cookie", () => {
    const req = (url: string, h: Record<string, string> = {}) =>
      new Request(`https://lens.test${url}`, { headers: h })
    expect(
      credentialOutsideHeader(req(`/api/knowledge/v1/meta?token=${CRED_A}`))
    ).toBe(true)
    expect(
      credentialOutsideHeader(req(`/api/knowledge/v1/meta?${CRED_A}`))
    ).toBe(true)
    expect(
      credentialOutsideHeader(
        req("/api/knowledge/v1/meta", { cookie: `t=${CRED_A}` })
      )
    ).toBe(true)
    expect(
      credentialOutsideHeader(req("/api/knowledge/v1/meta?keys=guest_wifi"))
    ).toBe(false)
  })
})
