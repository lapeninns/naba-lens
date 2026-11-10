// The internal reader over B03-c's knowledge_reader_answers_v1
// (docs/knowledge/internal-reader-api.md §5.5; b03-design §3.8, §5.2): a
// qualified or incomplete policy answer comes back through the real route as
// unavailable under an existing v1 reason, the rest of the response stays
// 200, and nothing of the withheld answer leaks. Every registry key is on
// version 1, so, as knowledge-b03-policy.test.ts does, a detail row is
// attached to an adopted finding through psql.
import { randomBytes } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { credentialDigest } from "@/app/api/knowledge/_reader/credentials"
import { GET } from "@/app/api/knowledge/v1/venues/[venueId]/answers/route"

import { psql } from "./coverage-fixtures"
import { submit, world, yes, type World } from "./knowledge-fixtures"

const OPS = `nlr_sec-b03_${randomBytes(32).toString("base64url")}`

let w: World
let disputed: World

function attach(contributionId: string, schema: string, detail: object) {
  psql(`insert into public.knowledge_contribution_details
      (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
    select x.id, x.venue_id, 1, '${schema}', 1, '${JSON.stringify(detail).replace(/'/g, "''")}'::jsonb,
      encode(sha256('TEST'::bytea), 'hex')
    from public.knowledge_contributions x where x.id = '${contributionId}'`)
}

async function read(at: World, keys: string) {
  const query = new URLSearchParams({
    keys,
    audience: "internal",
    purpose: "operations_lookup",
    schema: "1.0",
  })
  const res = await GET(
    new Request(
      `http://127.0.0.1:3000/api/knowledge/v1/venues/${at.venue}/answers?${query}`,
      { headers: { authorization: `Bearer ${OPS}` } }
    ),
    { params: Promise.resolve({ venueId: at.venue }) }
  )
  return { status: res.status, raw: await res.text() }
}

const WITHHELD = {
  status: "unavailable",
  value: null,
  summary: null,
  conditions: [],
  provenance: null,
  freshness: null,
}

beforeAll(async () => {
  ;[w, disputed] = await Promise.all([
    world("kn-b03-api"),
    world("kn-b03-api-dispute"),
  ])
  vi.stubEnv("KNOWLEDGE_READER_ENABLED", "true")
  vi.stubEnv(
    "KNOWLEDGE_READER_CONSUMERS",
    JSON.stringify([
      {
        id: "sec-b03",
        credentials: [
          { sha256: credentialDigest(OPS), expiresAt: "2099-01-01T00:00:00Z" },
        ],
        venues: [w.venue, disputed.venue],
        audiences: ["internal"],
        purposes: ["operations_lookup"],
        questions: "all",
        schemaMajors: [1],
      },
    ])
  )
})
afterAll(() => vi.unstubAllEnvs())

describe("internal reader over B03-c answers", () => {
  it("withholds a qualified and an incomplete policy answer, keeps a plain Yes, and answers 200", async () => {
    const plain = await yes(w.staffA, w, "guest_wifi")
    const toilets = await yes(w.staffA, w, "guest_toilets", {
      finding: "TEST toilets out of order",
      limitations: "TEST until Friday",
    })
    attach(toilets.contributionId, "facility", {
      availability: {
        state: "temporarily_unavailable",
        note: "TEST plumber booked",
      },
    })
    const parking = await yes(w.staffA, w, "onsite_parking", {
      finding: "TEST permit only",
    })
    attach(parking.contributionId, "policy", {
      stance: "conditional",
      authority: {
        basis: "venue_manager",
        source: "in_person",
        statedOn: "2026-11-01",
      },
    })

    const { status, raw } = await read(
      w,
      "guest_toilets,onsite_parking,guest_wifi"
    )
    expect(status).toBe(200)
    const [t, p, g] = JSON.parse(raw).answers
    expect(t).toMatchObject({
      key: "guest_toilets",
      ...WITHHELD,
      unavailable: { reason: "stale", detail: "qualified_answer" },
    })
    expect(p).toMatchObject({
      key: "onsite_parking",
      ...WITHHELD,
      unavailable: { reason: "not_confirmed", detail: "policy_incomplete" },
    })
    expect(g).toMatchObject({
      key: "guest_wifi",
      status: "available",
      value: { type: "yes_no_na", answer: "yes" },
      provenance: {
        contributionId: plain.contributionId,
        idKind: "contribution",
      },
    })
    expect(typeof t.revision).toBe("number")
    expect(typeof p.revision).toBe("number")
    // Nothing of a withheld answer: not its text, qualifier, detail or IDs.
    for (const leak of [
      "TEST toilets out of order",
      "TEST until Friday",
      "TEST plumber booked",
      "TEST permit only",
      "temporarily_unavailable",
      "conditional",
      "statedOn",
      "in_person",
      toilets.contributionId,
      parking.contributionId,
      w.staffA.id,
    ]) {
      expect(raw, leak).not.toContain(leak)
    }
  })

  it("lets an earlier reason win over qualified_answer (A22)", async () => {
    const sent = await yes(disputed.staffA, disputed, "guest_toilets")
    attach(sent.contributionId, "facility", {
      availability: { state: "temporarily_unavailable" },
    })
    await submit(disputed.staffB, disputed, "guest_toilets", { answer: "no" })
    const { status, raw } = await read(disputed, "guest_toilets")
    expect(status).toBe(200)
    expect(JSON.parse(raw).answers[0]).toMatchObject({
      ...WITHHELD,
      unavailable: { reason: "disputed", detail: "conflict" },
    })
  })
})
