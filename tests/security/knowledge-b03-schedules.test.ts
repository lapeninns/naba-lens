// B03-d schedules (docs/knowledge/b03-design.md §6, A6, A7, A8, A25, A27).
// The shared expansion agrees with the TypeScript one on the shared fixtures;
// an adopted service finding with a schedule becomes the schedule in use;
// occurrences, the preview and single-date exceptions follow their
// audiences. Every registry key is on version 1, which allows no detail, so
// the cases attach a service detail to a finding through psql (versions are
// append-only and cannot be added to a shared database). Real signed-in
// identities through PostgREST; psql reads state back.
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  refused,
  slotRevision,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const SCHEDULE = {
  effectiveFrom: "2026-11-01",
  recurrence: { kind: "weekly", days: ["sun"] },
  windows: [{ start: "12:00", end: "15:00" }],
}

function attach(contributionId: string, detail: object) {
  psql(`insert into public.knowledge_contribution_details
      (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
    select x.id, x.venue_id, 1, 'service', 1, '${JSON.stringify(detail)}'::jsonb,
      encode(sha256(x.id::text::bytea), 'hex')
    from public.knowledge_contributions x where x.id = '${contributionId}'`)
}

const scheduleOf = (contributionId: string) =>
  psql(`select coalesce((select id::text from public.knowledge_schedules
    where contribution_id = '${contributionId}'), 'none')`)

type Occ = { local_date: string; state: string }

let w: World
let scheduleId: string

beforeAll(async () => {
  w = await world("kn-b03-schedules")
  const sent = await yes(w.staffA, w, "guest_toilets")
  expect(sent.outcome).toBe("current")
  attach(sent.contributionId, { schedule: SCHEDULE })
  scheduleId = scheduleOf(sent.contributionId)
})

describe("shared expansion (A27)", () => {
  type Case = {
    name: string
    input: {
      timezone: string
      effectiveFrom: string
      effectiveTo?: string
      recurrence: unknown
      windows: unknown
      exceptions?: unknown
      from: string
      to: string
    }
    expect:
      { occurrences: unknown[] } | { reason: string } | { fields: unknown[] }
  }
  const { cases } = JSON.parse(
    readFileSync(
      join(process.cwd(), "tests/fixtures/knowledge/occurrences.json"),
      "utf8"
    )
  ) as { cases: Case[] }
  const lit = (v: unknown) =>
    v === null || v === undefined
      ? "null"
      : `'${String(v).replace(/'/g, "''")}'`
  const js = (v: unknown) =>
    v === undefined ? "null" : `${lit(JSON.stringify(v))}::jsonb`

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const p = c.input
    const sql = `select coalesce(json_agg(json_build_object(
        'localDate', to_char(o.local_date, 'YYYY-MM-DD'),
        'startsAt', to_char(o.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
        'endsAt', to_char(o.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
        'state', o.state)), '[]')
      from private.schedule_occurrences(${lit(p.timezone)}, ${lit(p.effectiveFrom)}, ${lit(p.effectiveTo)},
        ${js(p.recurrence)}, ${js(p.windows)}, ${js(p.exceptions)}, ${lit(p.from)}, ${lit(p.to)}) o`
    if ("occurrences" in c.expect) {
      expect(JSON.parse(psql(sql))).toEqual(c.expect.occurrences)
      return
    }
    let message = ""
    try {
      psql(sql)
    } catch (e) {
      message = String((e as { stderr?: string }).stderr ?? e)
    }
    if ("reason" in c.expect) expect(message).toContain(c.expect.reason)
    else {
      expect(message).toContain("invalid_value")
      const detail = /DETAIL:\s+(\{.*\})/.exec(message)?.[1]
      expect(JSON.parse(detail!)).toEqual({ fields: c.expect.fields })
    }
  })
})

describe("the schedule in use (A7, A25)", () => {
  it("is created when a finding adopted at send has its schedule stored", async () => {
    expect(scheduleId).not.toBe("none")
    const check = await json<{
      timezone: string
      answerInUse: { scheduleId: string | null }
    }>(w.staffA, "knowledge_check", { p_check_id: w.checks.guest_toilets })
    expect(check.timezone).toBe("Europe/London")
    expect(check.answerInUse.scheduleId).toBe(scheduleId)
  })

  it("is created when a waiting finding with a schedule is confirmed, not before", async () => {
    const v = await world("kn-b03-schedules-confirm")
    const sent = await yes(v.staffA, v, "step_free_entrance")
    expect(sent.outcome).toBe("awaiting_confirmation")
    attach(sent.contributionId, { schedule: SCHEDULE })
    expect(scheduleOf(sent.contributionId)).toBe("none")
    expect(
      (
        await decide(
          v.manager,
          v,
          "step_free_entrance",
          {
            type: "contribution",
            id: sent.contributionId,
          },
          "confirm"
        )
      ).error
    ).toBeNull()
    expect(scheduleOf(sent.contributionId)).not.toBe("none")
  })

  it("lists occurrences to anyone who may read the check, and none without a schedule", async () => {
    for (const who of [w.staffA, w.staffB, w.manager, w.admin]) {
      const rows = await json<Occ[]>(who, "knowledge_occurrences", {
        p_check_id: w.checks.guest_toilets,
        p_from: "2026-11-01",
        p_to: "2026-11-15",
      })
      expect(rows.map((r) => r.local_date)).toEqual([
        "2026-11-01",
        "2026-11-08",
        "2026-11-15",
      ])
    }
    expect(
      await json(w.staffA, "knowledge_occurrences", {
        p_check_id: w.checks.onsite_parking,
        p_from: "2026-11-01",
        p_to: "2026-11-15",
      })
    ).toEqual([])
    const other = await world("kn-b03-schedules-other")
    await refused(
      other.staffA,
      "knowledge_occurrences",
      {
        p_check_id: w.checks.guest_toilets,
        p_from: "2026-11-01",
        p_to: "2026-11-02",
      },
      "amenity_check_not_found",
      "P0002"
    )
    await refused(
      w.staffA,
      "knowledge_occurrences",
      {
        p_check_id: w.checks.guest_toilets,
        p_from: "2026-01-01",
        p_to: "2026-06-01",
      },
      "invalid_range",
      "22023"
    )
  })
})

describe("a changed schedule (review M1)", () => {
  it("keeps the earlier version's times and exceptions before the new one starts", async () => {
    const v = await world("kn-b03-schedules-change")
    const first = await yes(v.staffA, v, "guest_toilets")
    attach(first.contributionId, { schedule: SCHEDULE })
    const s1 = scheduleOf(first.contributionId)
    expect(
      (
        await call(v.manager, "knowledge_schedule_exception", {
          p_check_id: v.checks.guest_toilets,
          p_slot_revision: slotRevision(v.venue, "guest_toilets"),
          p_idempotency_key: randomUUID(),
          p_schedule_id: s1,
          p_local_date: "2026-11-08",
          p_kind: "cancelled",
          p_windows: null,
          p_note: null,
        })
      ).error
    ).toBeNull()
    const second = await yes(v.staffA, v, "guest_toilets")
    attach(second.contributionId, {
      schedule: {
        ...SCHEDULE,
        effectiveFrom: "2026-11-15",
        windows: [{ start: "13:00", end: "16:00" }],
      },
    })
    if (second.outcome === "awaiting_confirmation")
      expect(
        (
          await decide(
            v.manager,
            v,
            "guest_toilets",
            { type: "contribution", id: second.contributionId },
            "confirm"
          )
        ).error
      ).toBeNull()
    type Row = { local_date: string; starts_at: string; state: string }
    const rows = await json<Row[]>(v.staffA, "knowledge_occurrences", {
      p_check_id: v.checks.guest_toilets,
      p_from: "2026-11-01",
      p_to: "2026-11-22",
    })
    expect(
      rows.map((r) => [
        r.local_date,
        new Date(r.starts_at).toISOString().slice(11, 16),
        r.state,
      ])
    ).toEqual([
      ["2026-11-01", "12:00", "scheduled"],
      ["2026-11-08", "12:00", "cancelled"],
      ["2026-11-15", "13:00", "scheduled"],
      ["2026-11-22", "13:00", "scheduled"],
    ])
  })
})

describe("single-date exceptions (A7)", () => {
  const exception = (
    who: World["manager"],
    o: {
      key?: string
      revision?: number
      schedule?: string
      date?: string
      kind?: string
      windows?: unknown
    } = {}
  ) =>
    call(who, "knowledge_schedule_exception", {
      p_check_id: w.checks.guest_toilets,
      p_slot_revision: o.revision ?? slotRevision(w.venue, "guest_toilets"),
      p_idempotency_key: o.key ?? randomUUID(),
      p_schedule_id: o.schedule ?? scheduleId,
      p_local_date: o.date ?? "2026-11-08",
      p_kind: o.kind ?? "cancelled",
      p_windows: o.windows ?? null,
      p_note: "TEST closed",
    })

  it("are a manager's or admin's, keyed, once per date, and move the slot revision", async () => {
    expect((await exception(w.staffA)).error?.message).toBe("not_venue_manager")
    const before = slotRevision(w.venue, "guest_toilets")
    const key = randomUUID()
    const first = await exception(w.manager, { key, revision: before })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({
      replayed: false,
      slotRevision: before + 1,
    })
    expect(
      (await exception(w.manager, { key, revision: before })).data
    ).toMatchObject({ replayed: true })
    expect(
      (await exception(w.manager, { revision: before })).error?.message
    ).toBe("amenity_conflict")
    expect((await exception(w.admin)).error?.message).toBe(
      "schedule_exception_exists"
    )
    expect(
      (
        await exception(w.manager, {
          schedule: randomUUID(),
          date: "2026-11-15",
        })
      ).error?.message
    ).toBe("knowledge_not_current")
    const bad = await exception(w.manager, {
      date: "2026-10-01",
      kind: "moved",
    })
    expect(bad.error?.message).toBe("invalid_value")
    expect(JSON.parse(bad.error!.details!)).toEqual({
      fields: [
        { path: "kind", problem: "invalid" },
        { path: "localDate", problem: "out_of_range" },
      ],
    })
    expect(
      (
        await exception(w.admin, {
          date: "2026-11-11",
          kind: "extra",
          windows: [{ start: "18:00", end: "20:00" }],
        })
      ).error
    ).toBeNull()
    const rows = await json<Occ[]>(w.staffB, "knowledge_occurrences", {
      p_check_id: w.checks.guest_toilets,
      p_from: "2026-11-01",
      p_to: "2026-11-15",
    })
    expect(rows.map((r) => [r.local_date, r.state])).toEqual([
      ["2026-11-01", "scheduled"],
      ["2026-11-08", "cancelled"],
      ["2026-11-11", "extra"],
      ["2026-11-15", "scheduled"],
    ])
    expect(
      psql(`select string_agg(detail ->> 'kind', ',' order by id) from public.knowledge_events
        where check_id = '${w.checks.guest_toilets}' and kind = 'schedule_exception_added'`)
    ).toBe("cancelled,extra")
  })
})

describe("preview (A8)", () => {
  it("expands a schedule being written, with the send's field paths, and saves nothing", async () => {
    const rows = await json<Occ[]>(w.staffA, "knowledge_schedule_preview", {
      p_schedule: {
        ...SCHEDULE,
        recurrence: { kind: "weekly", days: ["sat", "sun"] },
      },
      p_timezone: null,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    })
    expect(rows).toHaveLength(9)
    const e = await refused(
      w.staffA,
      "knowledge_schedule_preview",
      {
        p_schedule: { recurrence: { kind: "weekly", days: [] } },
        p_timezone: null,
        p_from: "2026-11-01",
        p_to: "2026-11-30",
      },
      "invalid_value",
      "22023"
    )
    expect(JSON.parse(e.details!)).toEqual({
      fields: [
        { path: "schedule.effectiveFrom", problem: "required" },
        { path: "schedule.recurrence.days", problem: "invalid" },
        { path: "schedule.windows", problem: "required" },
      ],
    })
  })
})

describe("guards", () => {
  it("keep the schedule tables closed to clients and append-only", async () => {
    for (const table of [
      "knowledge_schedules",
      "knowledge_schedule_exceptions",
    ]) {
      const { data, error } = await (
        w.admin.client as unknown as {
          from(t: string): {
            select(
              c: string
            ): PromiseLike<{ data: unknown[] | null; error: unknown }>
          }
        }
      )
        .from(table)
        .select("*")
      expect(error !== null || (data ?? []).length === 0, table).toBe(true)
    }
    for (const sql of [
      `update public.knowledge_schedules set effective_to = effective_from where id = '${scheduleId}'`,
      `delete from public.knowledge_schedules where id = '${scheduleId}'`,
      `delete from public.knowledge_schedule_exceptions where schedule_id = '${scheduleId}'`,
    ])
      expect(() => psql(sql), sql).toThrow()
  })

  it("keep the shared helpers from clients and the reads STABLE definers", () => {
    for (const fn of [
      "private.schedule_occurrences(text,date,date,jsonb,jsonb,jsonb,date,date)",
      "private.schedule_problems(text,jsonb)",
      "private.knowledge_schedule_create(uuid)",
      "private.venue_timezone(uuid)",
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
        where n.nspname = 'public' and p.proname in ('knowledge_occurrences', 'knowledge_schedule_preview')`)
    ).toBe("knowledge_occurrences:s:true,knowledge_schedule_preview:s:true")
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
