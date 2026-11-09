import { describe, expect, it, vi } from "vitest"

import {
  credentialDigest,
  parseRegistry,
} from "@/app/api/knowledge/_reader/credentials"
import {
  handleAnswersRequest,
  handleMetaRequest,
  type ReaderDeps,
  type ReaderLogEntry,
} from "@/app/api/knowledge/_reader/handler"
import { ConsumerLimiter } from "@/app/api/knowledge/_reader/rate-limit"
import type { ReaderSource } from "@/app/api/knowledge/_reader/source"

const VENUE = "0f8f6b2e-1111-4111-8111-111111111111"
const OTHER_VENUE = "1a2b3c4d-2222-4222-8222-222222222222"
const CRED = `nlr_ops-desk_${"s".repeat(43)}`
const LIMITED = `nlr_toilets-only_${"t".repeat(43)}`
const NOW = Date.parse("2026-11-20T10:00:00Z")
const QUERY =
  "keys=onsite_parking,guest_wifi&audience=internal&purpose=operations_lookup&schema=1.0"

const registry = parseRegistry(
  JSON.stringify([
    {
      id: "ops-desk",
      credentials: [
        { sha256: credentialDigest(CRED), expiresAt: "2027-01-01T00:00:00Z" },
      ],
      venues: [VENUE],
      audiences: ["internal"],
      purposes: ["operations_lookup"],
      questions: "all",
      schemaMajors: [1],
    },
    {
      id: "toilets-only",
      credentials: [
        {
          sha256: credentialDigest(LIMITED),
          expiresAt: "2027-01-01T00:00:00Z",
        },
      ],
      venues: [VENUE],
      audiences: ["internal"],
      purposes: ["pilot_verification"],
      questions: ["guest_toilets"],
      schemaMajors: [1],
    },
  ])
)!

function rowFor(key: string, extra: Record<string, unknown> = {}) {
  return {
    question_key: key,
    status: "available",
    reason: null,
    detail: null,
    revision: 3,
    question_version: 1,
    value: "yes",
    current_submission_id: "6c1e0000-0000-4000-8000-000000000001",
    current_contribution_id: null,
    contribution_kind: "submission",
    source_basis: null,
    finding: "Seen",
    limitations: null,
    reason_text: null,
    confirmation_required: false,
    confirmation_state: "not_required",
    confirmation_basis: null,
    confirmation_self: null,
    confirmation_saved_at: null,
    evidence_photos: 1,
    evidence_videos: 0,
    redaction_proof: key === "guest_wifi" ? "not_recorded" : "not_applicable",
    saved_at: "2026-11-18T14:02:11Z",
    observed_at: null,
    next_check_due: null,
    freshness_state: "unrated",
    ...extra,
  }
}

const fakeSource = (): ReaderSource =>
  vi.fn<ReaderSource>(async ({ keys }) => ({
    ok: true as const,
    rows: keys.map((k) => rowFor(k)),
  }))

function deps(overrides: Partial<ReaderDeps> = {}) {
  const logs: ReaderLogEntry[] = []
  const d: ReaderDeps = {
    config: () => ({ ok: true, registry }),
    source: fakeSource(),
    limiter: new ConsumerLimiter({
      perMinute: 60,
      burst: 10,
      maxConcurrent: 4,
      now: () => NOW,
    }),
    now: () => NOW,
    requestId: () => "req-1",
    sourceTimeoutMs: 50,
    log: (entry) => logs.push(entry),
    ...overrides,
  }
  return { d, logs }
}

function get(
  path: string,
  init: {
    credential?: string | null
    method?: string
    headers?: Record<string, string>
  } = {}
) {
  const headers = new Headers(init.headers)
  const credential = init.credential === undefined ? CRED : init.credential
  if (credential) headers.set("authorization", `Bearer ${credential}`)
  return new Request(`https://lens.test${path}`, {
    method: init.method ?? "GET",
    headers,
  })
}
const answersPath = (venue = VENUE, query = QUERY) =>
  `/api/knowledge/v1/venues/${venue}/answers?${query}`
const answers = (req: Request, d: ReaderDeps, venue = VENUE) =>
  handleAnswersRequest(req, venue, d)

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code
}

describe("answers handler", () => {
  it("returns one snapshot of answers in request order, uncached", async () => {
    const { d, logs } = deps()
    const res = await answers(get(answersPath()), d)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("x-request-id")).toBe("req-1")
    const body = await res.json()
    expect(body).toMatchObject({
      schema: "1.0",
      venue: { id: VENUE },
      audience: "internal",
      purpose: "operations_lookup",
      snapshot: {
        readAt: "2026-11-20T10:00:00.000Z",
        etag: res.headers.get("etag"),
      },
    })
    expect(body.answers.map((a: { key: string }) => a.key)).toEqual([
      "onsite_parking",
      "guest_wifi",
    ])
    expect(body.answers[0].provenance).toMatchObject({
      sourceKind: "observation",
      contributionId: "6c1e0000-0000-4000-8000-000000000001",
      idKind: "submission",
    })
    expect(body.answers[1].summary).toBeNull()
    expect(d.source).toHaveBeenCalledOnce()
    expect(logs).toEqual([
      expect.objectContaining({
        status: 200,
        consumerId: "ops-desk",
        venueId: VENUE,
        revisions: { onsite_parking: 3, guest_wifi: 3 },
      }),
    ])
    expect(JSON.stringify(logs)).not.toContain("nlr_")
    expect(JSON.stringify(logs)).not.toContain("Seen")
  })

  it("answers 304 for a matching If-None-Match, and HEAD without a body", async () => {
    const { d } = deps()
    const first = await answers(get(answersPath()), d)
    const etag = first.headers.get("etag")!
    const again = await answers(
      get(answersPath(), { headers: { "if-none-match": etag } }),
      d
    )
    expect(again.status).toBe(304)
    expect(await again.text()).toBe("")
    const head = await answers(get(answersPath(), { method: "HEAD" }), d)
    expect(head.status).toBe(200)
    expect(head.headers.get("etag")).toBe(etag)
    expect(await head.text()).toBe("")
  })

  it("asks the source only for permitted keys and hides the rest", async () => {
    const { d } = deps()
    const query =
      "keys=guest_toilets,guest_wifi&audience=internal&purpose=pilot_verification&schema=1.0"
    const res = await answers(
      get(answersPath(VENUE, query), { credential: LIMITED }),
      d
    )
    const body = await res.json()
    expect(d.source).toHaveBeenCalledWith(
      expect.objectContaining({ venueId: VENUE, keys: ["guest_toilets"] })
    )
    expect(body.answers[1]).toMatchObject({
      key: "guest_wifi",
      revision: null,
      unavailable: { reason: "not_permitted", detail: null },
    })
  })

  it("checks the venue even when no requested key is permitted", async () => {
    const query =
      "keys=guest_wifi&audience=internal&purpose=pilot_verification&schema=1.0"
    const gone = deps({
      source: vi.fn<ReaderSource>(async () => ({
        ok: false,
        error: "venue_not_found",
      })),
    }).d
    const res = await answers(
      get(answersPath(VENUE, query), { credential: LIMITED }),
      gone
    )
    expect(res.status).toBe(404)
    expect(gone.source).toHaveBeenCalledWith(
      expect.objectContaining({ venueId: VENUE, keys: [] })
    )

    const open = deps({
      source: vi.fn<ReaderSource>(async () => ({ ok: true, rows: [] })),
    }).d
    const ok = await answers(
      get(answersPath(VENUE, query), { credential: LIMITED }),
      open
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).answers).toEqual([
      expect.objectContaining({
        key: "guest_wifi",
        revision: null,
        unavailable: { reason: "not_permitted", detail: null },
      }),
    ])
  })

  it("gives every credential failure the same 401", async () => {
    const { d } = deps()
    const bodies = new Set<string>()
    for (const req of [
      get(answersPath(), { credential: null }),
      get(answersPath(), { credential: `nlr_ops-desk_${"x".repeat(43)}` }),
      get(answersPath(), { credential: "not-a-credential" }),
      get(answersPath(), {
        credential: null,
        headers: { cookie: `sb-auth-token=abc` },
      }),
      get(`${answersPath()}&t=${CRED}`),
      get(answersPath(), { headers: { cookie: `k=${CRED}` } }),
    ]) {
      const res = await answers(req, d)
      expect(res.status).toBe(401)
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /)
      bodies.add(await res.text())
    }
    expect(bodies.size).toBe(1)
    expect([...bodies][0]).not.toContain("nlr_")
    expect(d.source).not.toHaveBeenCalled()
  })

  it("checks the method and URL size before anything else", async () => {
    const { d } = deps({ config: () => ({ ok: false, reason: "disabled" }) })
    const post = await answers(get(answersPath(), { method: "POST" }), d)
    expect(post.status).toBe(405)
    expect(post.headers.get("allow")).toBe("GET, HEAD")
    const long = await answers(
      get(`${answersPath()}&pad=${"x".repeat(2100)}`),
      d
    )
    expect(long.status).toBe(414)
    expect(await errorCode(long)).toBe("request_too_large")
  })

  it("is 503 while switched off, misconfigured or not integrated", async () => {
    for (const config of [
      () => ({ ok: false as const, reason: "disabled" as const }),
      () => ({ ok: false as const, reason: "invalid_registry" as const }),
    ]) {
      const res = await answers(get(answersPath()), deps({ config }).d)
      expect(res.status).toBe(503)
    }
    const res = await answers(
      get(answersPath()),
      deps({ source: async () => ({ ok: false, error: "unavailable" }) }).d
    )
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("30")
  })

  it("authenticates before it validates parameters", async () => {
    const { d } = deps()
    const res = await answers(
      get(answersPath(VENUE, "keys=bad"), { credential: null }),
      d
    )
    expect(res.status).toBe(401)
    expect(
      await errorCode(await answers(get(answersPath(VENUE, "keys=bad")), d))
    ).toBe("invalid_request")
    const version = await answers(
      get(answersPath(VENUE, QUERY.replace("1.0", "2.0"))),
      d
    )
    expect(version.status).toBe(400)
    expect(await version.json()).toMatchObject({
      error: { code: "unsupported_version", supported: ["1.0"] },
    })
  })

  it("refuses an audience or purpose the credential does not hold with 403", async () => {
    const { d } = deps()
    const res = await answers(
      get(
        answersPath(
          VENUE,
          QUERY.replace("operations_lookup", "pilot_verification")
        )
      ),
      d
    )
    expect(res.status).toBe(403)
  })

  it("makes an out-of-scope venue and an unknown venue the same 404", async () => {
    const outside = await answers(
      get(answersPath(OTHER_VENUE)),
      deps().d,
      OTHER_VENUE
    )
    const unknown = await answers(
      get(answersPath()),
      deps({ source: async () => ({ ok: false, error: "venue_not_found" }) }).d
    )
    expect(outside.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await outside.text()).toBe(await unknown.text())
  })

  it("rate limits per consumer with Retry-After", async () => {
    const { d } = deps()
    for (let i = 0; i < 10; i++)
      expect((await answers(get(answersPath()), d)).status).toBe(200)
    const limited = await answers(get(answersPath()), d)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("1")
  })

  it("gives up on a slow source with 503 and frees the slot", async () => {
    const never: ReaderSource = () => new Promise(() => {})
    const { d, logs } = deps({
      source: never,
      limiter: new ConsumerLimiter({
        perMinute: 60,
        burst: 10,
        maxConcurrent: 1,
        now: () => NOW,
      }),
    })
    const res = await answers(get(answersPath()), d)
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("5")
    expect(logs[0].note).toBe("source_timeout")
    d.source = fakeSource()
    expect((await answers(get(answersPath()), d)).status).toBe(200)
  })

  it("fails closed when the source breaks its contract", async () => {
    for (const rows of [
      [rowFor("onsite_parking")], // a key missing
      [rowFor("onsite_parking"), rowFor("onsite_parking")], // duplicated
      [rowFor("onsite_parking"), rowFor("guest_toilets")], // not requested
      [rowFor("onsite_parking"), rowFor("guest_wifi", { status: "weird" })],
    ]) {
      const res = await answers(
        get(answersPath()),
        deps({ source: async () => ({ ok: true, rows }) }).d
      )
      expect(res.status).toBe(500)
      expect(await errorCode(res)).toBe("internal_error")
    }
    const thrown = await answers(
      get(answersPath()),
      deps({
        source: async () => {
          throw new Error("db down")
        },
      }).d
    )
    expect(thrown.status).toBe(503)
  })
})

describe("meta handler", () => {
  it("describes what the credential may read", async () => {
    const res = await handleMetaRequest(
      get("/api/knowledge/v1/meta", { credential: LIMITED }),
      deps().d
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      supportedSchemas: ["1.0"],
      consumer: {
        id: "toilets-only",
        venues: [VENUE],
        audiences: ["internal"],
        purposes: ["pilot_verification"],
        questions: ["guest_toilets"],
        schemaMajors: [1],
      },
    })
  })

  it("needs a credential and takes no parameters", async () => {
    expect(
      (
        await handleMetaRequest(
          get("/api/knowledge/v1/meta", { credential: null }),
          deps().d
        )
      ).status
    ).toBe(401)
    expect(
      (await handleMetaRequest(get("/api/knowledge/v1/meta?x=1"), deps().d))
        .status
    ).toBe(400)
  })
})
