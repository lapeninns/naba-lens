// B03-c qualified answers, policy completeness and the admin rule
// (docs/knowledge/b03-design.md §3.8, §5, A5, A19, A21, A22, A28, A30, A33).
// A Conditional or temporarily unavailable Yes is withheld by the v1 reader,
// reads needs checking in the B01 fields of knowledge_check with the real
// answer in answerInUse.qualified, and is presented as needs_recheck by the
// legacy check reads while the stored row stays yes / complete. A plain Yes
// reads exactly as today. Every registry key is on version 1, which allows no
// detail, so the cases attach a detail row to an adopted finding through psql
// (registry versions are append-only and cannot be added to a shared
// database); the consumers read the detail row's own schema.
import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  refused,
  service,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

type ReaderRow = Record<string, unknown> & {
  question_key: string
  status: string
  reason: string | null
  detail: string | null
  value: string | null
}
type Check = Record<string, unknown> & {
  status: string
  reason: string | null
  detail: string | null
  answerInUse: Record<string, unknown> | null
  pending: (Record<string, unknown> & { findingRef: { id: string } })[]
}
type LegacyRow = Record<string, unknown> & {
  template_key: string
  progress: string
  recheck_reason: string | null
  qualification: string | null
}

let w: World

beforeAll(async () => {
  w = await world("kn-b03-policy")
})

function attach(contributionId: string, schema: string, detail: object) {
  psql(`insert into public.knowledge_contribution_details
      (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
    select x.id, x.venue_id, 1, '${schema}', 1, '${JSON.stringify(detail).replace(/'/g, "''")}'::jsonb,
      encode(sha256('TEST'::bytea), 'hex')
    from public.knowledge_contributions x where x.id = '${contributionId}'`)
}

const reader = (at: World, keys: string[]) =>
  json<ReaderRow[]>({ client: service }, "knowledge_reader_answers_v1", {
    p_venue_id: at.venue,
    p_keys: keys,
  })
const check = (at: World, key: string, who = at.manager) =>
  json<Check>(who, "knowledge_check", { p_check_id: at.checks[key] })
const legacy = async (at: World, key: string) =>
  (
    await json<LegacyRow[]>(at.manager, "amenity_checks_for_venue", {
      p_venue_id: at.venue,
      p_include_archived: false,
    })
  ).find((r) => r.template_key === key)!
const stored = (at: World, key: string) =>
  psql(`select progress || '|' || answer from public.venue_amenity_checks
    where id = '${at.checks[key]}'`)

describe("qualified answers (§3.8)", () => {
  it("leave a plain Yes exactly as today", async () => {
    const sent = await yes(w.staffA, w, "onsite_parking")
    expect(sent.outcome).toBe("current")
    expect((await reader(w, ["onsite_parking"]))[0]).toMatchObject({
      status: "available",
      reason: null,
      detail: null,
      value: "yes",
    })
    const c = await check(w, "onsite_parking")
    expect(c.status).toBe("available")
    expect(c.answerInUse).toMatchObject({ available: true, qualified: null })
    expect(c.answerInUse).not.toHaveProperty("policyMissing")
    expect(await legacy(w, "onsite_parking")).toMatchObject({
      progress: "complete",
      qualification: null,
    })
  })

  it("withhold a temporarily unavailable Yes from the v1 reader, show it as needs checking, and keep the stored row", async () => {
    const sent = await yes(w.staffA, w, "guest_toilets")
    expect(sent.outcome).toBe("current")
    const detail = { availability: { state: "temporarily_unavailable" } }
    attach(sent.contributionId, "facility", detail)

    const [row] = await reader(w, ["guest_toilets"])
    expect(row).toMatchObject({
      status: "unavailable",
      reason: "stale",
      detail: "qualified_answer",
      value: null,
      finding: null,
      current_submission_id: null,
    })
    const c = await check(w, "guest_toilets", w.staffA)
    expect(c).toMatchObject({
      status: "unavailable",
      reason: "stale",
      detail: "qualified_answer",
    })
    expect(c.answerInUse).toMatchObject({
      value: "yes",
      available: false,
      qualified: { qualifier: "temporarily_unavailable", detail },
    })
    expect(await legacy(w, "guest_toilets")).toMatchObject({
      progress: "needs_recheck",
      recheck_reason:
        "The answer in use is temporarily unavailable. Open the check to see until when.",
      qualification: "temporarily_unavailable",
    })
    const [one] = await json<LegacyRow[]>(w.manager, "amenity_check", {
      p_check_id: w.checks.guest_toilets,
    })
    expect(one).toMatchObject({ progress: "needs_recheck" })
    const subs = await json<{ answer: string; qualification: string | null }[]>(
      w.manager,
      "amenity_check_submissions",
      { p_check_id: w.checks.guest_toilets }
    )
    expect(subs[0]).toMatchObject({
      answer: "yes",
      qualification: "temporarily_unavailable",
    })
    expect(stored(w, "guest_toilets")).toBe("complete|yes")
  })

  it("never puts a qualified answer on the assignee's task list (A21)", async () => {
    const revision = psql(
      `select revision from public.venue_amenity_checks where id = '${w.checks.guest_toilets}'`
    )
    await json(w.manager, "amenity_assign_check", {
      p_check_id: w.checks.guest_toilets,
      p_assignee_id: w.staffA.id,
      p_revision: Number(revision),
    })
    const tasks = await json<{ id: string }[]>(w.staffA, "amenity_my_checks")
    expect(tasks.some((t) => t.id === w.checks.guest_toilets)).toBe(false)
  })

  it("lets every other reason win, keeping the qualified answer present (A22)", async () => {
    await submit(w.staffB, w, "guest_toilets", { answer: "no" })
    const [row] = await reader(w, ["guest_toilets"])
    expect(row).toMatchObject({ status: "unavailable", reason: "disputed" })
    const c = await check(w, "guest_toilets")
    expect(c.reason).toBe("disputed")
    expect(c.answerInUse).toMatchObject({
      qualified: { qualifier: "temporarily_unavailable" },
    })
  })
})

describe("policy answers (§5.2, A5)", () => {
  it("read an incomplete policy as not_confirmed / policy_incomplete, ahead of the qualifier", async () => {
    const v = await world("kn-b03-policy-incomplete")
    const sent = await yes(v.staffA, v, "onsite_parking")
    expect(sent.outcome).toBe("current")
    attach(sent.contributionId, "policy", {
      stance: "conditional",
      authority: {
        basis: "venue_manager",
        source: "in_person",
        statedOn: "2026-11-01",
      },
    })
    expect((await reader(v, ["onsite_parking"]))[0]).toMatchObject({
      status: "unavailable",
      reason: "not_confirmed",
      detail: "policy_incomplete",
      value: null,
    })
    const c = await check(v, "onsite_parking")
    expect(c.answerInUse).toMatchObject({
      available: false,
      policyMissing: ["conditions", "authority"],
      qualified: { qualifier: "conditional" },
    })
    expect(
      JSON.parse(
        psql(
          `select private.knowledge_policy_complete('${v.checks.onsite_parking}')`
        )
      )
    ).toEqual(["conditions", "authority"])
    expect(await legacy(v, "onsite_parking")).toMatchObject({
      progress: "needs_recheck",
      recheck_reason:
        "The answer in use has conditions. Open the check to see them.",
      qualification: "conditional",
    })
  })

  it("needs an admin for an organisation-scope policy; a staff photo never confirms it (§5.3, §5.4)", async () => {
    const v = await world("kn-b03-policy-org")
    const sent = await yes(v.staffA, v, "step_free_entrance")
    expect(sent.outcome).toBe("awaiting_confirmation")
    attach(sent.contributionId, "policy", {
      stance: "allowed",
      policyScope: "organisation",
      authority: {
        basis: "admin",
        source: "written_policy",
        statedOn: "2026-11-01",
      },
    })
    const target = { type: "contribution" as const, id: sent.contributionId }
    const pending = (await check(v, "step_free_entrance")).pending.find(
      (p) => p.findingRef.id === sent.contributionId
    )
    expect(pending).toMatchObject({ policyMissing: [] })
    const queue = await json<{ items: Record<string, unknown>[] }>(
      v.manager,
      "knowledge_to_confirm",
      { p_venue_id: v.venue }
    )
    expect(
      queue.items.find(
        (i) => (i.findingRef as { id: string }).id === sent.contributionId
      )
    ).toMatchObject({ policyMissing: [] })

    for (const who of [v.manager, v.staffManager]) {
      const { error } = await decide(
        who,
        v,
        "step_free_entrance",
        target,
        "confirm"
      )
      expect(error?.message).toBe("not_active_admin")
    }
    expect(
      (await decide(v.admin, v, "step_free_entrance", target, "confirm")).error
    ).toBeNull()
    expect((await check(v, "step_free_entrance")).answerInUse).toMatchObject({
      confirmed: true,
      policyMissing: [],
    })
  })

  it("adds the admin rule value without any rule using it", () => {
    expect(
      psql(`select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'knowledge_question_rules_confirmation_check'`)
    ).toContain("admin")
    expect(
      psql(
        `select count(*) from public.knowledge_question_rules where confirmation = 'admin'`
      )
    ).toBe("0")
  })
})

describe("registry and lists (A4, A30, A33)", () => {
  it("serve empty value lists to any active account, and refuse an unknown list", async () => {
    for (const list of [
      "policy_condition_types",
      "policy_exception_types",
      "broadcasters",
    ])
      expect(
        await json(w.staffA, "knowledge_value_list", { p_list: list })
      ).toEqual({
        list,
        items: [],
      })
    await refused(
      w.staffA,
      "knowledge_value_list",
      { p_list: "colours" },
      "invalid_value_list",
      "22023"
    )
    expect(() => psql(`truncate public.knowledge_value_list_items`)).toThrow()
  })

  it("give every version 1 public_media never and no features", async () => {
    expect(
      psql(`select count(*) from public.knowledge_question_versions
        where public_media <> 'never' or features <> '[]'::jsonb`)
    ).toBe("0")
    expect(
      await json(w.staffA, "knowledge_question", {
        p_key: "step_free_entrance",
        p_version: null,
      })
    ).toMatchObject({ publicMedia: "never", features: [] })
  })
})

describe("evidence for assets (A28, shape only)", () => {
  it("names each asset's role with the slot state and unrated freshness", async () => {
    const v = await world("kn-b03-evidence")
    const sent = await yes(v.staffA, v, "onsite_parking")
    const asset =
      psql(`select asset_id from public.knowledge_contribution_assets
      where contribution_id = '${sent.contributionId}' limit 1`)
    const rows = JSON.parse(
      psql(
        `select json_agg(r) from private.knowledge_evidence_for_assets(array['${asset}']::uuid[], now()) r`
      )
    ) as Record<string, unknown>[]
    expect(rows).toEqual([
      {
        asset_id: asset,
        venue_id: v.venue,
        check_id: v.checks.onsite_parking,
        question_key: "onsite_parking",
        role: "current_answer",
        slot_status: "available",
        slot_reason: null,
        freshness: ["internal", "public"].map((use) => ({
          use,
          state: "unrated",
          nextCheckDue: null,
          basis: null,
          basisDate: null,
        })),
      },
    ])
    // The same role R9 reports to the uploader.
    expect(
      psql(
        `select kind from private.asset_removal_effects('${asset}', '${v.staffA.id}')`
      )
    ).toBe("answer_in_use")
  })
})

describe("guards", () => {
  it("keep the new private functions from clients, and the reads STABLE definers (T9b)", () => {
    for (const fn of [
      "private.knowledge_slot_state_b03(uuid,text[])",
      "private.knowledge_policy_complete(uuid)",
      "private.knowledge_policy_missing_for(uuid,text,boolean)",
      "private.knowledge_evidence_for_assets(uuid[],timestamptz)",
      "private.knowledge_needs_admin(public.knowledge_question_rules,uuid)",
    ])
      expect(
        psql(
          `select has_function_privilege('authenticated', '${fn}', 'execute')`
        ),
        fn
      ).toBe("f")
    expect(
      psql(`select string_agg(p.proname || ':' || p.provolatile::text || ':' || p.prosecdef::text, ',' order by p.proname collate "C")
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'private' and p.proname in ('knowledge_slot_state_b03', 'knowledge_slot_json'))
          or (n.nspname = 'public' and p.proname in ('knowledge_reader_answers_v1', 'amenity_checks_for_venue', 'amenity_check_submissions'))`)
    ).toBe(
      "amenity_check_submissions:s:true,amenity_checks_for_venue:s:true,knowledge_reader_answers_v1:s:true,knowledge_slot_json:s:true,knowledge_slot_state_b03:s:true"
    )
    expect(
      psql(
        `select has_function_privilege('authenticated', 'public.knowledge_reader_answers_v1(uuid,text[])', 'execute')`
      )
    ).toBe("f")
  })

  it("leave the credit function, both evidence triggers and the B01 resolver byte-identical", () => {
    expect(
      psql(`select md5(pg_get_functiondef(
        'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`)
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
    expect(
      psql(`select string_agg(md5(pg_get_functiondef(t.tgfoid)), ',' order by t.tgname)
        from pg_trigger t where t.tgname in
          ('media_assets_amenity_evidence_lost', 'media_assets_knowledge_evidence_withdrawn')`)
    ).toBe("6c156e9d55c5058e331d904cb6b6eca7,af720155bd3b5945954060520619f7d0")
    // B03-c wraps the B01 resolver; it never re-creates it.
    expect(
      psql(
        `select md5(pg_get_functiondef('private.knowledge_slot_state(uuid,text[])'::regprocedure))`
      )
    ).toBe("cdcd2a00eb77d64e9ff9306b042a05d4")
  })

  it("keep the value list from the service role", async () => {
    const { error } = await call({ client: service }, "knowledge_value_list", {
      p_list: "broadcasters",
    })
    expect(error).not.toBeNull()
  })
})
