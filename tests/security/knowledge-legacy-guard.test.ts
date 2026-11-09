// The legacy submit guard (docs/knowledge/b01-design.md §4.1, §17 T1e, T14a,
// T14b). amenity_submit_finding keeps today's rules off the working list;
// tests/security/amenities.test.ts covers that unchanged.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ok } from "./coverage-fixtures"
import {
  call,
  count,
  json,
  sessionAs,
  sleep,
  slot,
  world,
  type World,
} from "./knowledge-fixtures"

function legacyArgs(w: World, key: string, idempotencyKey = randomUUID()) {
  return {
    p_check_id: w.checks[key],
    p_revision: count(
      `select revision from public.venue_amenity_checks where id = '${w.checks[key]}'`
    ),
    p_idempotency_key: idempotencyKey,
    p_answer: "no",
    p_finding: null,
    p_limitations: null,
    p_reason: "TEST none here",
    p_asset_ids: [],
    p_internal_metadata: null,
    p_redaction_confirmed: false,
  }
}

function legacySql(w: World, key: string) {
  return `select (public.amenity_submit_finding('${w.checks[key]}',
    (select revision from public.venue_amenity_checks where id = '${w.checks[key]}'),
    gen_random_uuid(), 'no', null, null, 'TEST none here', '{}'::uuid[], null, false)).submission_id;`
}

describe("legacy amenity_submit_finding on a working-list slot (T1e)", () => {
  it("refuses the assignee, the manager and an admin with NLK01, and works off the list", async () => {
    const w = await world("kn-guard", { extra: ["darts"] })
    const check = w.checks.guest_toilets!
    await ok(
      w.manager.client.rpc("amenity_assign_check", {
        p_check_id: check,
        p_assignee_id: w.staffA.id,
        p_revision: count(
          `select revision from public.venue_amenity_checks where id = '${check}'`
        ),
      })
    )
    for (const who of [w.staffA, w.manager, w.admin]) {
      const { error } = await call(
        who,
        "amenity_submit_finding",
        legacyArgs(w, "guest_toilets")
      )
      expect(error).toMatchObject({
        message: "knowledge_path_required",
        code: "NLK01",
      })
    }
    expect(
      count(
        `select count(*) from public.amenity_submissions where check_id = '${check}'`
      )
    ).toBe(0)
    // darts is not on the working list: today's behaviour.
    const { error } = await call(
      w.manager,
      "amenity_submit_finding",
      legacyArgs(w, "darts")
    )
    expect(error).toBeNull()
  })
})

describe("replay before the guard (T14a)", () => {
  it("replays a key recorded before enablement, and refuses a new key", async () => {
    const w = await world("kn-guard-replay", { enable: false })
    const args = legacyArgs(w, "guest_toilets")
    const { data: first, error } = await call(
      w.manager,
      "amenity_submit_finding",
      args
    )
    expect(error).toBeNull()
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["guest_toilets"],
      p_enabled: true,
      p_reason: "TEST",
    })
    const { data: again, error: againError } = await call(
      w.manager,
      "amenity_submit_finding",
      args
    )
    expect(againError).toBeNull()
    expect((again as { replayed: boolean }[])[0]!.replayed).toBe(true)
    expect((again as { submission_id: string }[])[0]!.submission_id).toBe(
      (first as { submission_id: string }[])[0]!.submission_id
    )
    expect(
      count(
        `select count(*) from public.amenity_submissions where check_id = '${w.checks.guest_toilets}'`
      )
    ).toBe(1)
    const fresh = await call(
      w.manager,
      "amenity_submit_finding",
      legacyArgs(w, "guest_toilets")
    )
    expect(fresh.error).toMatchObject({ message: "knowledge_path_required" })
  })
})

describe("enablement serialises with a legacy submission (T14b)", () => {
  it("lets a submission holding the check lock commit first as a pre-scope answer", async () => {
    const w = await world("kn-guard-race-a", { enable: false })
    const holder = sessionAs(
      w.manager.id,
      `${legacySql(w, "guest_toilets")}\nselect pg_sleep(1.5);`
    )
    await sleep(400)
    const started = Date.now()
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["guest_toilets"],
      p_enabled: true,
      p_reason: "TEST",
    })
    expect(Date.now() - started).toBeGreaterThan(700)
    const result = await holder
    expect(result.code, result.err).toBe(0)
    expect(slot(w.venue, "guest_toilets")).toMatchObject({
      status: "available",
      value: "no",
      contribution_kind: "submission",
    })
  })

  it("makes a submission waiting behind an enablement meet the guard", async () => {
    const w = await world("kn-guard-race-b", { enable: false })
    const enabling = sessionAs(
      w.admin.id,
      `select public.knowledge_set_working_list('${w.venue}', array['guest_toilets'], true, 'TEST');\nselect pg_sleep(1.5);`
    )
    await sleep(400)
    const { error } = await call(
      w.manager,
      "amenity_submit_finding",
      legacyArgs(w, "guest_toilets")
    )
    expect(error).toMatchObject({
      message: "knowledge_path_required",
      code: "NLK01",
    })
    expect((await enabling).code).toBe(0)
    expect(
      count(
        `select count(*) from public.amenity_submissions where check_id = '${w.checks.guest_toilets}'`
      )
    ).toBe(0)
  })
})
