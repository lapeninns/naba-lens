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
import {
  call,
  json,
  slotRevision,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const OPS = `nlr_sec-b03_${randomBytes(32).toString("base64url")}`

let w: World
let disputed: World
let withdrawnAt: World
let delisted: World
let lapsed: World
let corrected: World

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
  ;[w, disputed, withdrawnAt, delisted, lapsed, corrected] = await Promise.all([
    world("kn-b03-api"),
    world("kn-b03-api-dispute"),
    world("kn-b03-api-withdraw"),
    world("kn-b03-api-delisted"),
    world("kn-b03-api-lapsed"),
    world("kn-b03-api-correct"),
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
        venues: [
          w.venue,
          disputed.venue,
          withdrawnAt.venue,
          delisted.venue,
          lapsed.venue,
          corrected.venue,
        ],
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

// B03-e to B03-g (b03-design §7, §9): the final resolver view's withdrawal,
// freshness and correction outcomes through the real route.
const withdraw = (at: World, key: string) =>
  call(at.manager, "knowledge_withdraw", {
    p_check_id: at.checks[key],
    p_slot_revision: slotRevision(at.venue, key),
    p_idempotency_key: crypto.randomUUID(),
    p_reason: "TEST withdrawn",
  })

const one = async (at: World, key: string) => {
  const { status, raw } = await read(at, key)
  expect(status).toBe(200)
  return { answer: JSON.parse(raw).answers[0], raw }
}

describe("internal reader over B03-e to B03-g answers", () => {
  it("reads a withdrawn answer as withdrawn / answer_withdrawn, with a higher revision and nothing of the answer", async () => {
    await yes(withdrawnAt.staffA, withdrawnAt, "onsite_parking", {
      finding: "TEST car park behind",
    })
    const before = (await one(withdrawnAt, "onsite_parking")).answer
    expect(before.status).toBe("available")
    expect((await withdraw(withdrawnAt, "onsite_parking")).error).toBeNull()
    const { answer, raw } = await one(withdrawnAt, "onsite_parking")
    expect(answer).toMatchObject({
      ...WITHHELD,
      unavailable: { reason: "withdrawn", detail: "answer_withdrawn" },
    })
    expect(answer.revision).toBeGreaterThan(before.revision)
    expect(raw).not.toContain("TEST car park behind")
    expect(raw).not.toContain("TEST withdrawn")
  })

  // Fails until WS1 fixes the not_enabled guard in knowledge_slot_state_b03
  // (B03-g compares s.reason, but the B01 resolver reports reason 'unknown',
  // detail 'not_enabled'): out of scope must hide the withdrawal.
  it("hides a withdrawal once the key leaves the working list (not_enabled first)", async () => {
    await yes(delisted.staffA, delisted, "onsite_parking")
    expect((await withdraw(delisted, "onsite_parking")).error).toBeNull()
    await json(delisted.admin, "knowledge_set_working_list", {
      p_venue_id: delisted.venue,
      p_keys: ["onsite_parking"],
      p_enabled: false,
      p_reason: "TEST",
    })
    const { answer } = await one(delisted, "onsite_parking")
    expect(answer).toMatchObject({
      ...WITHHELD,
      unavailable: { reason: "unknown", detail: "not_enabled" },
    })
  })

  it("keeps a temporarily unavailable answer past its until as qualified_answer, never a new detail", async () => {
    const sent = await yes(lapsed.staffA, lapsed, "guest_toilets")
    const until = new Date(Date.now() - 3 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    attach(sent.contributionId, "facility", {
      availability: { state: "temporarily_unavailable", until },
    })
    const { answer } = await one(lapsed, "guest_toilets")
    expect(answer).toMatchObject({
      ...WITHHELD,
      unavailable: { reason: "stale", detail: "qualified_answer" },
    })
  })

  it("reads a manager's correction as the new answer, from the correction contribution", async () => {
    await yes(corrected.staffA, corrected, "guest_toilets")
    const res = await call(corrected.manager, "knowledge_correct", {
      p_check_id: corrected.checks.guest_toilets,
      p_slot_revision: slotRevision(corrected.venue, "guest_toilets"),
      p_idempotency_key: crypto.randomUUID(),
      p_headline: "no",
      p_detail: null,
      p_reason: "TEST corrected",
    })
    expect(res.error).toBeNull()
    const { answer, raw } = await one(corrected, "guest_toilets")
    expect(answer).toMatchObject({
      status: "available",
      value: { type: "yes_no_na", answer: "no" },
      provenance: { sourceKind: "manager_observation", idKind: "contribution" },
      freshness: { observedAt: null, nextCheckDue: null, state: "unrated" },
    })
    expect(raw).not.toContain(corrected.manager.id)
  })
})
