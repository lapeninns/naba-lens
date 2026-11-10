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
  service,
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
let imported: World
let importedNa: World
let importedLegacy: World
let staffReason: World

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
  ;[
    w,
    disputed,
    withdrawnAt,
    delisted,
    lapsed,
    corrected,
    imported,
    importedNa,
    importedLegacy,
    staffReason,
  ] = await Promise.all([
    world("kn-b03-api"),
    world("kn-b03-api-dispute"),
    world("kn-b03-api-withdraw"),
    world("kn-b03-api-delisted"),
    world("kn-b03-api-lapsed"),
    world("kn-b03-api-correct"),
    world("kn-b03-api-import"),
    world("kn-b03-api-import-na"),
    world("kn-b03-api-import-legacy"),
    world("kn-b03-api-staff-reason"),
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
          imported.venue,
          importedNa.venue,
          importedLegacy.venue,
          staffReason.venue,
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

// B03-f imports (review lows 2 and 3, b03-defg-implementation-review.md): an
// adopted import's excerpt is the source's own words and stays in its
// internal provenance, never in reader output; and the reader reports where
// the answer came from. An imported No or Not applicable is stored with the
// reason 'Imported from <source label>' (legacy and external alike); the
// reader withholds that reason by the import's source row
// (20261110171000), so the label never reaches a condition. Assertions name
// the field or sentinel, never the whole response.
type ReaderRow = {
  status: string
  value: string | null
  reason_text: string | null
  source_origin: string | null
}

const projection = (at: World, key: string) =>
  json<ReaderRow[]>({ client: service }, "knowledge_reader_answers_v1", {
    p_venue_id: at.venue,
    p_keys: [key],
  }).then((rows) => rows[0])

/** Field paths of every string in a JSON value that contains the needle. */
function pathsWith(value: unknown, needle: string, at = "$"): string[] {
  if (typeof value === "string") return value.includes(needle) ? [at] : []
  if (Array.isArray(value))
    return value.flatMap((v, i) => pathsWith(v, needle, `${at}.${i}`))
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      pathsWith(v, needle, `${at}.${k}`)
    )
  return []
}

/** The stored import reason and its submission copy are kept, unread. */
function storedImportReason(at: World, key: string) {
  return psql(`select (x.reason = left('Imported from ' || ks.source_label, 500))
      || ':' || (s.reason is not distinct from x.reason)
    from public.venue_amenity_checks c
    join public.amenity_submissions s on s.id = c.current_submission_id
    join public.knowledge_contributions x on x.id = s.source_contribution_id
    join public.knowledge_contribution_sources ks on ks.contribution_id = x.id
    where c.id = '${at.checks[key]}'`)
}

async function confirmImport(v: World, key: string) {
  const id = psql(
    `select x.id from public.knowledge_contributions x where x.check_id = '${v.checks[key]}'`
  )
  const decided = await call(v.manager, "knowledge_decide", {
    p_target_type: "contribution",
    p_target_id: id,
    p_decision: "confirm",
    p_slot_revision: slotRevision(v.venue, key),
    p_idempotency_key: crypto.randomUUID(),
    p_note: null,
  })
  expect(decided.error).toBeNull()
}

async function adoptedExternal(
  v: World,
  headline: "no" | "not_applicable",
  label: string,
  excerpt: string
) {
  const source = await json<{ sourceId: string }>(
    v.admin,
    "knowledge_source_declare",
    {
      p_kind: "venue_website",
      p_label: label,
      p_venue_id: v.venue,
      p_idempotency_key: crypto.randomUUID(),
    }
  )
  await json(v.admin, "knowledge_source_import", {
    p_source_id: source.sourceId,
    p_source_revision: "r1",
    p_retrieved_at: new Date(Date.now() - 3_600_000).toISOString(),
    p_assertions: [
      { venueId: v.venue, questionKey: "guest_toilets", headline, excerpt },
    ],
    p_idempotency_key: crypto.randomUUID(),
  })
  for (const mode of ["dry_run", "apply"])
    await json(v.admin, "knowledge_reconcile", {
      p_kind: "external",
      p_mode: mode,
      p_venue_id: v.venue,
    })
  await confirmImport(v, "guest_toilets")
  return one(v, "guest_toilets")
}

// The legacy path: an absent Coverage fact with an exact mapping imports No.
async function adoptedLegacy(v: World, excerpt: string) {
  const fact = crypto.randomUUID()
  psql(`insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence, facts) values
    ('${fact}', '${v.venue}', 'toilets', 'absent', '${excerpt.replace(/'/g, "''")}')`)
  await json(v.admin, "knowledge_mapping_review", {
    p_legacy_fact_id: fact,
    p_legacy_revision: 1,
    p_question_key: "guest_toilets",
    p_kind: "exact",
    p_reason: "TEST reviewed",
    p_idempotency_key: crypto.randomUUID(),
  })
  for (const mode of ["dry_run", "apply"])
    await json(v.admin, "knowledge_reconcile", {
      p_kind: "legacy",
      p_mode: mode,
      p_venue_id: v.venue,
    })
  await confirmImport(v, "guest_toilets")
  return one(v, "guest_toilets")
}

describe("internal reader over adopted B03-f imports", () => {
  const EXCERPT = "TEST excerpt: no customer toilets, ask at the bar"
  const LABEL = "TEST website B03 reader sentinel"
  const NA_EXCERPT = "TEST excerpt: toilets not applicable here"
  const NA_LABEL = "TEST website B03 reader na sentinel"
  const LEGACY_EXCERPT = "TEST legacy excerpt: no toilets on site"
  const LEGACY_LABEL = "Coverage (legacy record)"

  type Read = Awaited<ReturnType<typeof one>>
  let adopted: Read
  let adoptedNa: Read
  let legacy: Read

  beforeAll(async () => {
    ;[adopted, adoptedNa, legacy] = await Promise.all([
      adoptedExternal(imported, "no", LABEL, EXCERPT),
      adoptedExternal(importedNa, "not_applicable", NA_LABEL, NA_EXCERPT),
      adoptedLegacy(importedLegacy, LEGACY_EXCERPT),
    ])
  })

  const cases = () =>
    [
      [
        "external No",
        imported,
        adopted,
        "no",
        "external_source",
        LABEL,
        EXCERPT,
      ],
      [
        "external Not applicable",
        importedNa,
        adoptedNa,
        "not_applicable",
        "external_source",
        NA_LABEL,
        NA_EXCERPT,
      ],
      [
        "legacy No",
        importedLegacy,
        legacy,
        "no",
        "legacy_fact",
        LEGACY_LABEL,
        LEGACY_EXCERPT,
      ],
    ] as const

  it("reads the structured answer and its origin, with no conditions", () => {
    for (const [name, , read, answer, origin] of cases()) {
      expect(read.answer.status, name).toBe("available")
      expect(read.answer.value, name).toEqual({ type: "yes_no_na", answer })
      expect(read.answer.provenance?.sourceKind, name).toBe(origin)
      expect(read.answer.conditions, name).toEqual([])
    }
  })

  it("never returns the source's label, excerpt or generated reason over HTTP", () => {
    for (const [name, , read, , , label, excerpt] of cases()) {
      const body = JSON.parse(read.raw)
      for (const needle of [label, excerpt, "Imported from"])
        expect(pathsWith(body, needle), `${name}: ${needle}`).toEqual([])
    }
  })

  it("withholds the generated reason in the service-only projection", async () => {
    for (const [name, at, , answer, origin, label, excerpt] of cases()) {
      const row = await projection(at, "guest_toilets")
      expect(row.status, name).toBe("available")
      expect(row.value, name).toBe(answer)
      expect(row.source_origin, name).toBe(origin)
      expect(row.reason_text, name).toBeNull()
      for (const needle of [label, excerpt, "Imported from"])
        expect(pathsWith(row, needle), `${name}: ${needle}`).toEqual([])
    }
  })

  it("keeps the stored import reason and its submission copy", () => {
    for (const [name, at] of cases())
      expect(storedImportReason(at, "guest_toilets"), name).toBe("true:true")
  })

  it("still reads an ordinary staff No's reason as a condition", async () => {
    const REASON = "TEST staff reason: checked every floor"
    const sent = await submit(
      staffReason.staffA,
      staffReason,
      "guest_toilets",
      {
        answer: "no",
        reason: REASON,
      }
    )
    const row = await projection(staffReason, "guest_toilets")
    expect(row.status).toBe("available")
    expect(row.source_origin).toBeNull()
    expect(row.reason_text).toBe(REASON)
    const { answer } = await one(staffReason, "guest_toilets")
    expect(answer.value).toEqual({ type: "yes_no_na", answer: "no" })
    expect(answer.provenance?.contributionId).toBe(sent.contributionId)
    expect(answer.conditions).toEqual([{ kind: "reason", text: REASON }])
  })
})
