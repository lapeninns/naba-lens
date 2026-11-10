// B03-e freshness and rechecks (docs/knowledge/b03-design.md §7, A10, A11,
// A24, A29, A31). No registry version names a freshness policy (OD-15), so
// every answer reads unrated as in B01; the per-use computation is tested
// directly. A temporarily unavailable answer whose until has passed opens one
// recheck through the job, listed to its assignee and the manager, and
// closes when a current answer replaces it, in the decision's
// rechecksClosed. Real signed-in identities through PostgREST; psql builds
// fixtures (detail rows; versions cannot be added to a shared database).
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  service,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const entry = (sql: string) =>
  JSON.parse(
    psql(`select private.knowledge_freshness_entry(${sql})`)
  ) as unknown

describe("per-use freshness (§7.2, §7.3)", () => {
  it("reads unrated without a policy, basis_missing without a date, and current, due_soon or expired by the due date", () => {
    expect(
      entry(`'internal', null, null, null, null, null, now(), 'Europe/London'`)
    ).toEqual({
      use: "internal",
      state: "unrated",
      nextCheckDue: null,
      basis: null,
      basisDate: null,
    })
    expect(
      entry(
        `'public', '90 days', '14 days', 'observed_on', null, null, now(), 'Europe/London'`
      )
    ).toEqual({
      use: "public",
      state: "basis_missing",
      nextCheckDue: null,
      basis: "observed_on",
      basisDate: null,
    })
    const at = (now: string) =>
      entry(
        `'internal', '90 days', '14 days', 'observed_on', '2026-01-01', null, '${now}', 'Europe/London'`
      ) as {
        state: string
        nextCheckDue: string
      }
    // Due is local midnight of the basis date plus the age: 1 April, BST.
    expect(at("2026-03-01T00:00:00Z")).toMatchObject({ state: "current" })
    expect(at("2026-03-18T23:00:00Z")).toMatchObject({ state: "due_soon" })
    expect(at("2026-03-31T22:59:59Z")).toMatchObject({ state: "due_soon" })
    expect(at("2026-03-31T23:00:00Z")).toMatchObject({ state: "expired" })
    expect(
      new Date(at("2026-03-01T00:00:00Z").nextCheckDue).toISOString()
    ).toBe("2026-03-31T23:00:00.000Z")
    expect(
      entry(
        `'internal', null, null, 'event_end', '2026-11-14', '2026-11-14T19:00:00Z', '2026-11-14T19:00:00Z', 'Europe/London'`
      )
    ).toMatchObject({
      state: "expired",
      basis: "event_end",
      basisDate: "2026-11-14",
    })
  })

  it("leaves every key unrated with no policy row and none named", async () => {
    expect(
      psql(
        `select count(*) from public.knowledge_freshness_policies where left(id, 5) <> 'test_'`
      )
    ).toBe("0")
    expect(
      psql(`select count(*) from public.knowledge_question_versions
        where freshness <> '{"internal": null, "public": null}'::jsonb`)
    ).toBe("0")
    const w = await world("kn-b03-fresh-parity")
    await yes(w.staffA, w, "guest_toilets")
    const [row] = await json<
      {
        status: string
        freshness_state: string
        next_check_due: string | null
      }[]
    >({ client: service }, "knowledge_reader_answers_v1", {
      p_venue_id: w.venue,
      p_keys: ["guest_toilets"],
    })
    expect(row).toMatchObject({
      status: "available",
      freshness_state: "unrated",
      next_check_due: null,
    })
    const check = await json<{ freshness: { state: string }[] }>(
      w.staffA,
      "knowledge_check",
      {
        p_check_id: w.checks.guest_toilets,
      }
    )
    expect(check.freshness.map((f) => f.state)).toEqual(["unrated", "unrated"])
  })
})

describe("freshness as it read at a time (B08 M1)", () => {
  it("applies the policy and registry version in force then, so a mid-month change never rewrites the past", async () => {
    const id = `test_${randomUUID().replace(/-/g, "").slice(0, 20)}`
    // Unused by any version, so inert for every other read.
    psql(`insert into public.knowledge_freshness_policies (id, version, claim_class, use, max_age, recheck_lead, basis, created_at)
      values ('${id}', 1, 'offering', 'internal', interval '90 days', interval '14 days', 'observed_on', now() - interval '10 days'),
             ('${id}', 2, 'offering', 'internal', interval '3 days', interval '1 day', 'observed_on', now() - interval '1 day')`)
    const asOf = (at: string) =>
      psql(
        `select coalesce((private.knowledge_policy_as_of('${id}', 'internal', ${at})).version::text, 'none')`
      )
    expect(asOf("now() - interval '20 days'")).toBe("none")
    expect(asOf("now() - interval '2 days'")).toBe("1")
    expect(asOf("now()")).toBe("2")
    const state = (at: string) =>
      psql(`with p as (select (private.knowledge_policy_as_of('${id}', 'internal', ${at})).*)
        select private.knowledge_freshness_entry('internal', p.max_age, p.recheck_lead, p.basis,
          current_date - 5, null, ${at}, 'Europe/London') ->> 'state' from p`)
    expect(state("now() - interval '2 days'")).toBe("current")
    expect(state("now()")).toBe("expired")
    // Registry versions too: none in force before the registry existed.
    expect(
      psql(
        `select coalesce((private.knowledge_version_as_of('guest_toilets', '2026-01-01'::timestamptz)).version::text, 'none')`
      )
    ).toBe("none")
  })

  it("puts freshness and the registry version on the answer at a time, for managers and for B08's definer read", async () => {
    const w = await world("kn-b03-history-at")
    await yes(w.staffA, w, "guest_toilets")
    type At = {
      answerInUse: {
        registryVersion: number | null
        freshness: { use: string; state: string }[]
      }
    }
    const viaManager = await json<At>(w.manager, "knowledge_slot_history", {
      p_check_id: w.checks.guest_toilets,
      p_at: new Date().toISOString(),
    })
    expect(viaManager.answerInUse.registryVersion).toBe(1)
    expect(
      viaManager.answerInUse.freshness.map((f) => [f.use, f.state])
    ).toEqual([
      ["internal", "unrated"],
      ["public", "unrated"],
    ])
    const viaDefiner = JSON.parse(
      psql(
        `select private.knowledge_answer_at('${w.checks.guest_toilets}', now())`
      )
    ) as At
    expect(viaDefiner.answerInUse.freshness).toEqual(
      viaManager.answerInUse.freshness
    )
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.knowledge_answer_at(uuid,timestamptz)', 'execute')`
      )
    ).toBe("f")
  })

  it("dates a schema_changed recheck from the version in force, not the latest (review R-L1)", () => {
    // Reads only: a new registry version would be permanent on the shared stack.
    expect(
      psql(`select private.knowledge_schema_change_due('guest_toilets', now())
        = (select greatest(v.created_at, coalesce(v.effective_from, v.created_at))
           from public.knowledge_question_versions v where v.key = 'guest_toilets' and v.version = 1)`)
    ).toBe("t")
    expect(
      psql(
        `select private.knowledge_schema_change_due('guest_toilets', '2026-01-01'::timestamptz) is null`
      )
    ).toBe("t")
    expect(
      psql(`select position('knowledge_schema_change_due(v_row.question_key, p_now)'
        in pg_get_functiondef('private.knowledge_open_rechecks(timestamptz)'::regprocedure)) > 0`)
    ).toBe("t")
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.knowledge_schema_change_due(text,timestamptz)', 'execute')`
      )
    ).toBe("f")
  })

  it("dates a schema_changed task from a future-effective version only once it is in force (review L1)", async () => {
    const w = await world("kn-b03-schema-due")
    await yes(w.staffA, w, "guest_toilets")
    const check = w.checks.guest_toilets
    // One transaction, rolled back: the new version never reaches the shared
    // stack. Version 2 replaces the schema and takes effect in 10 days.
    const out = psql(`begin;
insert into public.knowledge_question_versions
select (jsonb_populate_record(null::public.knowledge_question_versions, to_jsonb(v) || jsonb_build_object(
  'version', (select max(m.version) + 1 from public.knowledge_question_versions m where m.key = v.key),
  'value_schema', case when v.value_schema = 'presence' then 'facility' else 'presence' end,
  'change_kind', 'schema', 'change_note', 'R-L1 fixture', 'upgrade_rules', '{}'::jsonb,
  'created_at', now(), 'effective_from', now() + interval '10 days', 'created_by', null))).*
from public.knowledge_question_versions v where v.key = 'guest_toilets' and v.version = 1;
create temp table l1_before on commit drop as select private.knowledge_open_rechecks(now()) as opened,
  private.knowledge_schema_change_due('guest_toilets', now()) as due_now;
create temp table l1_after on commit drop as select private.knowledge_open_rechecks(now() + interval '20 days') as opened;
select concat_ws('|',
  (select due_now = (select greatest(v.created_at, coalesce(v.effective_from, v.created_at))
     from public.knowledge_question_versions v where v.key = 'guest_toilets' and v.version = 1) from l1_before),
  private.knowledge_schema_change_due('guest_toilets', now() + interval '20 days') = now() + interval '10 days',
  (select count(*) from public.knowledge_recheck_tasks t where t.check_id = '${check}' and t.cause = 'schema_changed'),
  (select bool_and(t.due_at = now() + interval '10 days') from public.knowledge_recheck_tasks t
     where t.check_id = '${check}' and t.cause = 'schema_changed'));
rollback;`)
    // Before it takes effect version 1 is in force: no schema change, and the
    // due date is version 1's. Once in force the one task is due from when
    // version 2 took effect, not when it was written.
    expect(out.split("\n").pop()).toBe("true|true|1|true")
    expect(
      psql(
        `select count(*) from public.knowledge_question_versions where key = 'guest_toilets' and change_note = 'R-L1 fixture'`
      )
    ).toBe("0")
  })

  it("labels the answer at a time as the history read, not B08 R2 (review R-L2)", () => {
    expect(
      psql(
        `select left(obj_description('private.knowledge_answer_at(uuid,timestamptz)'::regprocedure, 'pg_proc'), 12)`
      )
    ).toBe("History read")
  })
})

describe("recheck tasks (§7.4, A11, A24)", () => {
  let w: World
  let taskId: string

  beforeAll(async () => {
    w = await world("kn-b03-rechecks")
    const sent = await yes(w.staffA, w, "guest_toilets")
    psql(`insert into public.knowledge_contribution_details
        (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
      select x.id, x.venue_id, 1, 'facility', 1,
        jsonb_build_object('availability', jsonb_build_object('state', 'temporarily_unavailable',
          'until', to_char((now() at time zone 'Europe/London')::date - 2, 'YYYY-MM-DD'))),
        encode(sha256(x.id::text::bytea), 'hex')
      from public.knowledge_contributions x where x.id = '${sent.contributionId}'`)
  })

  it("open once through the service-role job, for a temporary outage past its until", async () => {
    const first = await json<{ opened: number; closed: number }>(
      { client: service },
      "knowledge_run_rechecks"
    )
    expect(first.opened).toBeGreaterThanOrEqual(1)
    await json({ client: service }, "knowledge_run_rechecks")
    expect(
      psql(`select count(*) || ':' || min(cause) || ':' || min(use) from public.knowledge_recheck_tasks
        where check_id = '${w.checks.guest_toilets}'`)
    ).toBe("1:temporary_until_passed:internal")
    taskId = psql(
      `select id from public.knowledge_recheck_tasks where check_id = '${w.checks.guest_toilets}'`
    )
    for (const who of [w.staffA, w.manager, w.admin]) {
      const { error } = await call(who, "knowledge_run_rechecks")
      expect(error, who.id).not.toBeNull()
    }
  })

  it("list to the assignee and the manager; other staff see the count only; triage counts them", async () => {
    const revision = psql(
      `select revision from public.venue_amenity_checks where id = '${w.checks.guest_toilets}'`
    )
    await json(w.manager, "amenity_assign_check", {
      p_check_id: w.checks.guest_toilets,
      p_assignee_id: w.staffA.id,
      p_revision: Number(revision),
    })
    expect(
      (
        await json<{ items: { taskId: string }[] }>(w.staffA, "my_rechecks")
      ).items.map((t) => t.taskId)
    ).toEqual([taskId])
    expect(
      (await json<{ items: unknown[] }>(w.staffB, "my_rechecks")).items
    ).toEqual([])
    expect(
      await json(w.staffB, "knowledge_check_rechecks", {
        p_check_id: w.checks.guest_toilets,
      })
    ).toEqual({ count: 1, items: [] })
    expect(
      await json<{ count: number; items: { cause: string }[] }>(
        w.manager,
        "knowledge_check_rechecks",
        {
          p_check_id: w.checks.guest_toilets,
        }
      )
    ).toMatchObject({ count: 1, items: [{ cause: "temporary_until_passed" }] })
    const triage = await json<
      { queue: string; available: boolean; waiting: number }[]
    >(w.manager, "manager_triage_summary", { p_venue_id: null })
    expect(triage.find((q) => q.queue === "rechecks")).toMatchObject({
      available: true,
      waiting: 1,
    })
    expect(
      (
        await json<{ queue: string; available: boolean }[]>(
          w.staffA,
          "manager_triage_summary",
          {
            p_venue_id: null,
          }
        )
      ).find((q) => q.queue === "rechecks")
    ).toMatchObject({ available: false })
  })

  it("stay open while the new answer waits, and close when it is confirmed (M4)", async () => {
    const sent = await yes(w.staffA, w, "guest_toilets")
    expect(sent.outcome).toBe("awaiting_confirmation")
    expect(
      psql(
        `select state from public.knowledge_recheck_tasks where id = '${taskId}'`
      )
    ).toBe("open")
    const { data, error } = await decide(
      w.manager,
      w,
      "guest_toilets",
      {
        type: "contribution",
        id: sent.contributionId,
      },
      "confirm"
    )
    expect(error).toBeNull()
    expect((data as { rechecksClosed: unknown[] }).rechecksClosed).toEqual([
      { taskId, use: "internal" },
    ])
    expect(
      psql(
        `select state || ':' || (closed_decision_id is not null) from public.knowledge_recheck_tasks where id = '${taskId}'`
      )
    ).toBe("done:true")
  })

  it("return an empty rechecksClosed when nothing closes, on every command that reports it", async () => {
    const v = await world("kn-b03-rechecks-empty")
    const first = await submit(v.staffA, v, "onsite_parking", {
      answer: "unknown",
    })
    expect(first).not.toHaveProperty("rechecksClosed")
    const sent = await yes(v.staffA, v, "step_free_entrance")
    const { data } = await decide(
      v.manager,
      v,
      "step_free_entrance",
      {
        type: "contribution",
        id: sent.contributionId,
      },
      "confirm"
    )
    expect((data as { rechecksClosed: unknown[] }).rechecksClosed).toEqual([])
  })

  it("keep the tasks table closed to clients, never deleted, closed only once", () => {
    for (const sql of [
      `delete from public.knowledge_recheck_tasks where id = '${taskId}'`,
      `update public.knowledge_recheck_tasks set state = 'open', closed_at = null where id = '${taskId}'`,
      `update public.knowledge_recheck_tasks set due_at = now() where id = '${taskId}'`,
    ])
      expect(() => psql(sql), sql).toThrow()
  })

  it("keep task times write-once for scoring history (B08 §6.2a)", () => {
    const id = psql(`insert into public.knowledge_recheck_tasks
        (venue_id, check_id, question_key, cause, use, due_at, created_at)
      values ('${w.venue}', '${w.checks.onsite_parking}', 'onsite_parking', 'scope_changed', 'internal',
        '2026-10-01 00:00+00', '2026-10-01 00:00+00')
      returning id`)
    const times = () =>
      psql(
        `select created_at || '|' || state || '|' || coalesce(closed_at::text, '') from public.knowledge_recheck_tasks where id = '${id}'`
      )
    const opened = times()
    // An open task: only the closing columns may change.
    for (const sql of [
      `update public.knowledge_recheck_tasks set created_at = now() where id = '${id}'`,
      `update public.knowledge_recheck_tasks set due_at = now() where id = '${id}'`,
      `delete from public.knowledge_recheck_tasks where id = '${id}'`,
    ])
      expect(() => psql(sql), sql).toThrow()
    expect(times()).toBe(opened)
    psql(
      `update public.knowledge_recheck_tasks set state = 'cancelled', closed_at = '2026-10-15 00:00+00' where id = '${id}'`
    )
    const closed = times()
    expect(closed.split("|")[0]).toBe(opened.split("|")[0])
    // A closed task never changes again and is never removed.
    for (const sql of [
      `update public.knowledge_recheck_tasks set state = 'done' where id = '${id}'`,
      `update public.knowledge_recheck_tasks set closed_at = now() where id = '${id}'`,
      `update public.knowledge_recheck_tasks set created_at = now() where id = '${id}'`,
      `update public.knowledge_recheck_tasks set state = 'open', closed_at = null where id = '${id}'`,
      `delete from public.knowledge_recheck_tasks where id = '${id}'`,
      `truncate public.knowledge_recheck_tasks`,
    ])
      expect(() => psql(sql), sql).toThrow()
    expect(times()).toBe(closed)
  })
})

describe("the venue's open rechecks (A41)", () => {
  it("list what triage counts, oldest due first, to managers and admins only, without archived checks", async () => {
    const v = await world("kn-b03-venue-rechecks")
    // Direct tasks on checks with no answer: the job never closes them.
    const task = (key: string, due: string) =>
      psql(`insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
        values ('${v.venue}', '${v.checks[key]}', '${key}', 'scope_changed', 'internal', '${due}')
        returning id`)
    const later = task("onsite_parking", "2026-10-02 00:00+00")
    const sooner = task("step_free_entrance", "2026-10-01 00:00+00")
    const archived = task("guest_wifi", "2026-09-01 00:00+00")
    const revision = psql(
      `select revision from public.venue_amenity_checks where id = '${v.checks.guest_wifi}'`
    )
    await json(v.manager, "amenity_archive_check", {
      p_check_id: v.checks.guest_wifi,
      p_revision: Number(revision),
      p_idempotency_key: randomUUID(),
    })
    type Listed = {
      venueId: string
      count: number
      items: { taskId: string; dueAt: string }[]
    }
    const list = await json<Listed>(v.manager, "knowledge_venue_rechecks", {
      p_venue_id: null,
    })
    expect(list.venueId).toBe(v.venue)
    expect(list.items.map((t) => t.taskId)).toEqual([sooner, later])
    expect(list.items.map((t) => t.taskId)).not.toContain(archived)
    expect(list.count).toBe(2)
    expect(Object.keys(list.items[0]!).sort()).toEqual(
      [
        "taskId",
        "checkId",
        "venueId",
        "questionKey",
        "question",
        "cause",
        "use",
        "dueAt",
      ].sort()
    )
    const triage = await json<
      { queue: string; waiting: number; oldest_waiting_at: string }[]
    >(v.manager, "manager_triage_summary", { p_venue_id: null })
    const row = triage.find((q) => q.queue === "rechecks")!
    expect(row.waiting).toBe(list.count)
    expect(new Date(row.oldest_waiting_at).getTime()).toBe(
      new Date(list.items[0]!.dueAt).getTime()
    )
    // Admins name the venue; a legacy grant keeps its manager reads.
    expect(
      await json<Listed>(v.admin, "knowledge_venue_rechecks", {
        p_venue_id: v.venue,
      })
    ).toEqual(list)
    expect(
      (
        await json<Listed>(v.staffManager, "knowledge_venue_rechecks", {
          p_venue_id: null,
        })
      ).count
    ).toBe(2)
    expect(
      (
        await call(v.admin, "knowledge_venue_rechecks", {
          p_venue_id: null,
        })
      ).error?.message
    ).toBe("venue_required")
    for (const who of [v.staffA, v.staffB]) {
      const { error } = await call(who, "knowledge_venue_rechecks", {
        p_venue_id: null,
      })
      expect(error?.message, who.id).toBe("not_venue_manager")
    }
    const other = await world("kn-b03-venue-rechecks-other")
    expect(
      (
        await call(other.manager, "knowledge_venue_rechecks", {
          p_venue_id: v.venue,
        })
      ).error?.message
    ).toBe("wrong_venue")
  })
})

describe("freshness policies (A42)", () => {
  it("list each policy's latest version per use to admins, in ISO 8601", async () => {
    const id = `test_${randomUUID().replace(/-/g, "").slice(0, 20)}`
    // Unused by any version, so inert for every other read.
    psql(`insert into public.knowledge_freshness_policies (id, version, claim_class, use, max_age, recheck_lead, basis, note)
      values ('${id}', 1, 'offering', 'internal', interval '90 days', interval '14 days', 'observed_on', null),
             ('${id}', 2, 'offering', 'internal', interval '3 days', interval '1 day', 'observed_on', 'TEST shorter'),
             ('${id}', 3, 'offering', 'public', interval '60 days', null, 'observed_on', null)`)
    const w = await world("kn-b03-policy-list")
    const { items } = await json<{
      items: { policyId: string; use: string }[]
    }>(w.admin, "knowledge_freshness_policies")
    expect(items.filter((p) => p.policyId === id)).toEqual([
      {
        policyId: id,
        version: 2,
        claimClass: "offering",
        use: "internal",
        maxAge: "P3D",
        recheckLead: "P1D",
        basis: "observed_on",
        note: "TEST shorter",
        createdAt: expect.any(String),
      },
      {
        policyId: id,
        version: 3,
        claimClass: "offering",
        use: "public",
        maxAge: "P60D",
        recheckLead: null,
        basis: "observed_on",
        note: null,
        createdAt: expect.any(String),
      },
    ])
    for (const who of [w.manager, w.staffManager, w.staffA]) {
      const { error } = await call(who, "knowledge_freshness_policies")
      expect(error?.message, who.id).toBe("not_active_admin")
    }
  })
})

describe("WS4 asks (A29, A31)", () => {
  it("K2: no version allows public media yet, and a redaction key never does", async () => {
    const w = await world("kn-b03-k2")
    await yes(w.staffA, w, "onsite_parking")
    expect(
      JSON.parse(
        psql(
          `select private.knowledge_public_media_eligible('${w.venue}', 'onsite_parking')`
        )
      )
    ).toEqual({ eligible: false, reason: "not_publishable" })
    expect(
      JSON.parse(
        psql(
          `select private.knowledge_public_media_eligible('${w.venue}', 'guest_wifi')`
        )
      )
    ).toEqual({ eligible: false, reason: "redaction_key" })
    expect(
      psql(`select count(*) from private.knowledge_public_media_eligible_set(
        jsonb_build_array(jsonb_build_object('venueId', '${w.venue}', 'questionKey', 'onsite_parking'),
          jsonb_build_object('venueId', '${w.venue}', 'questionKey', 'darts'))) where not eligible`)
    ).toBe("2")
  })

  it("K4: an asset's evidence history names both the knowledge and the legacy events", async () => {
    const w = await world("kn-b03-k4")
    const sent = await yes(w.staffA, w, "guest_toilets")
    const asset =
      psql(`select asset_id from public.knowledge_contribution_assets
      where contribution_id = '${sent.contributionId}' limit 1`)
    psql(
      `update public.media_assets set deleted_at = now() where id = '${asset}'`
    )
    const events = JSON.parse(
      psql(`select private.asset_evidence_events('${asset}')`)
    ) as {
      kind: string
      venueId: string
      questionKey: string
    }[]
    expect(events.map((e) => e.kind).sort()).toEqual([
      "evidence_lost",
      "evidence_withdrawn",
    ])
    for (const e of events)
      expect(e).toMatchObject({
        venueId: w.venue,
        questionKey: "guest_toilets",
      })
    expect(events[0]).not.toHaveProperty("actor")
  })
})

describe("guards", () => {
  it("keep the new private functions from clients", () => {
    for (const fn of [
      "private.knowledge_open_rechecks(timestamptz)",
      "private.knowledge_close_rechecks(uuid,uuid)",
      "private.knowledge_public_media_eligible(uuid,text,timestamptz)",
      "private.asset_evidence_events(uuid)",
      "private.knowledge_slot_state_b03(uuid,text[],timestamptz)",
      "private.knowledge_venue_open_rechecks(uuid)",
    ])
      expect(
        psql(
          `select has_function_privilege('authenticated', '${fn}', 'execute')`
        ),
        fn
      ).toBe("f")
    expect(
      psql(
        `select has_function_privilege('authenticated', 'public.knowledge_run_rechecks()', 'execute')`
      )
    ).toBe("f")
    for (const fn of [
      "public.knowledge_venue_rechecks(uuid)",
      "public.knowledge_freshness_policies()",
    ])
      expect(
        psql(
          `select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
            has_function_privilege('authenticated', '${fn}', 'execute')`
        ),
        fn
      ).toBe("false:true")
  })

  it("leave the credit function, both evidence triggers and the B01 resolver byte-identical", () => {
    expect(
      psql(
        `select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`
      )
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
    expect(
      psql(`select string_agg(md5(pg_get_functiondef(t.tgfoid)), ',' order by t.tgname)
        from pg_trigger t where t.tgname in
          ('media_assets_amenity_evidence_lost', 'media_assets_knowledge_evidence_withdrawn')`)
    ).toBe("6c156e9d55c5058e331d904cb6b6eca7,af720155bd3b5945954060520619f7d0")
    expect(
      psql(
        `select md5(pg_get_functiondef('private.knowledge_slot_state(uuid,text[])'::regprocedure))`
      )
    ).toBe("cdcd2a00eb77d64e9ff9306b042a05d4")
  })
})
