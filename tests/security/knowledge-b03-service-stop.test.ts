// B03 A40: a service stopped from a later date (evidence/b03-a40-pool-design.md
// with the four review corrections). A service.v1 Yes with
// detail.lastDayOffered reads Yes until local midnight of the next day and No
// from then, with no write on the day; it opens no schedule_ended or
// temporary_until_passed recheck. A schedule that ends without a stop date
// reads No and opens one schedule_ended recheck. Every registry key is on
// version 1 (presence), so the cases attach a service detail to a finding
// through psql, as the B03-d suite does; validation through a real send is
// covered by the shared value fixtures and the venue check called directly.
// Real signed-in identities through PostgREST; psql reads state back.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  londonToday,
  service,
  slotRevision,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)

const WEEKLY = {
  recurrence: { kind: "weekly", days: ["sun"] },
  windows: [{ start: "12:00", end: "15:00" }],
}

function attach(contributionId: string, detail: object, schema = "service") {
  psql(`insert into public.knowledge_contribution_details
      (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
    select x.id, x.venue_id, 1, '${schema}', 1, '${JSON.stringify(detail)}'::jsonb,
      encode(sha256(x.id::text::bytea), 'hex')
    from public.knowledge_contributions x where x.id = '${contributionId}'`)
}

/** A staff Yes with this detail, confirmed by the manager if it waits. */
async function answer(
  w: World,
  key: string,
  detail: object,
  schema = "service"
) {
  const sent = await yes(w.staffA, w, key)
  attach(sent.contributionId, detail, schema)
  if (sent.outcome === "awaiting_confirmation")
    expect(
      (
        await decide(
          w.manager,
          w,
          key,
          { type: "contribution", id: sent.contributionId },
          "confirm"
        )
      ).error
    ).toBeNull()
  return sent
}

type Stop = {
  kind: "stopped" | "schedule_ended"
  lastDayOffered: string
  notOfferedFrom: string
  notOfferedFromAt: string
  inEffect: boolean
}
type CheckView = {
  status: string
  reason: string | null
  detail: string | null
  answerInUse: {
    value: string
    qualified: unknown
    stop: Stop | null
    withdrawal: unknown
  } | null
}

const check = (w: World, key: string, who = w.staffA) =>
  json<CheckView>(who, "knowledge_check", { p_check_id: w.checks[key] })

/** The resolver at an instant (read-only). */
const stateAt = (w: World, key: string, at: string) =>
  JSON.parse(
    psql(`select json_build_object('status', s.status, 'reason', s.reason, 'detail', s.detail,
        'value', s.value, 'currentAnswer', s.current_answer, 'qualifier', s.qualifier)
      from private.knowledge_slot_state_b03('${w.venue}', array['${key}'], '${at}'::timestamptz) s`)
  ) as {
    status: string
    reason: string | null
    detail: string | null
    value: string | null
    currentAnswer: string
    qualifier: string | null
  }

const historyAt = (w: World, key: string, at: string) =>
  JSON.parse(
    psql(
      `select private.knowledge_answer_at('${w.checks[key]}', '${at}'::timestamptz)`
    )
  ) as {
    answerInUse: { answer: string; value: string; stop: Stop | null } | null
  }

const reader = async (w: World, key: string) => {
  const { data, error } = await call(
    { client: service },
    "knowledge_reader_answers_v1",
    { p_venue_id: w.venue, p_keys: [key] }
  )
  expect(error).toBeNull()
  return (data as Record<string, unknown>[])[0]!
}

const runRechecks = () => json({ client: service }, "knowledge_run_rechecks")
const tasks = (w: World, key: string) =>
  psql(`select coalesce(string_agg(t.cause || ':' || t.state || ':'
      || to_char(t.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ',' order by t.created_at, t.id), '')
    from public.knowledge_recheck_tasks t where t.check_id = '${w.checks[key]}'`)
const localMidnightUtc = (date: string) =>
  psql(
    `select to_char(('${date}'::date)::timestamp at time zone 'Europe/London' at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
  )
const minus1s = (iso: string) => new Date(Date.parse(iso) - 1000).toISOString()

describe("the end of a service (A40)", () => {
  it("is local midnight of Not offered from in both clock seasons", async () => {
    const w = await world("kn-b03-a40-dst")
    const end = (last: string, at: string) =>
      JSON.parse(
        psql(`select private.knowledge_service_end('${w.venue}', '${randomUUID()}', 'yes', 'service',
          '{"lastDayOffered": "${last}"}'::jsonb, '${at}'::timestamptz)`)
      ) as Stop
    // Autumn: BST until 01:00 UTC on 25 October 2026.
    const autumn = end("2026-10-24", "2026-10-24T22:59:59Z")
    expect(autumn).toMatchObject({
      kind: "stopped",
      lastDayOffered: "2026-10-24",
      notOfferedFrom: "2026-10-25",
      inEffect: false,
    })
    expect(new Date(autumn.notOfferedFromAt).toISOString()).toBe(
      "2026-10-24T23:00:00.000Z"
    )
    expect(end("2026-10-24", "2026-10-24T23:00:00Z").inEffect).toBe(true)
    // Spring: GMT until 01:00 UTC on 28 March 2027.
    const spring = end("2027-03-27", "2027-03-27T23:59:59Z")
    expect(new Date(spring.notOfferedFromAt).toISOString()).toBe(
      "2027-03-28T00:00:00.000Z"
    )
    expect(spring.inEffect).toBe(false)
    expect(end("2027-03-27", "2027-03-28T00:00:00Z").inEffect).toBe(true)
    // Only a service Yes has an end.
    expect(
      psql(`select coalesce(private.knowledge_service_end('${w.venue}', '${randomUUID()}', 'no', 'service',
        '{"lastDayOffered": "2026-10-24"}'::jsonb, now())::text, 'none')
        || ',' || coalesce(private.knowledge_service_end('${w.venue}', '${randomUUID()}', 'yes', 'facility',
        '{"lastDayOffered": "2026-10-24"}'::jsonb, now())::text, 'none')`)
    ).toBe("none,none")
  })
})

describe("a future stop (A40)", () => {
  it("reads Yes to the last second of the last day and No from midnight, in every read", async () => {
    const w = await world("kn-b03-a40-future")
    const last = addDays(londonToday(), 30)
    await answer(w, "guest_toilets", {
      lastDayOffered: last,
      schedule: {
        effectiveFrom: addDays(londonToday(), -7),
        effectiveTo: last,
        ...WEEKLY,
      },
    })
    const now = await check(w, "guest_toilets")
    expect(now.status).toBe("available")
    expect(now.answerInUse).toMatchObject({
      value: "yes",
      stop: {
        kind: "stopped",
        lastDayOffered: last,
        notOfferedFrom: addDays(last, 1),
        inEffect: false,
      },
    })
    const at = now.answerInUse!.stop!.notOfferedFromAt
    expect(new Date(at).toISOString().replace(".000", "")).toBe(
      localMidnightUtc(addDays(last, 1))
    )
    expect(stateAt(w, "guest_toilets", minus1s(at))).toMatchObject({
      status: "available",
      value: "yes",
    })
    expect(stateAt(w, "guest_toilets", at)).toMatchObject({
      status: "available",
      reason: null,
      value: "no",
      currentAnswer: "yes",
      qualifier: null,
    })
    expect(
      historyAt(w, "guest_toilets", minus1s(at)).answerInUse
    ).toMatchObject({ answer: "yes", value: "yes", stop: { inEffect: false } })
    expect(historyAt(w, "guest_toilets", at).answerInUse).toMatchObject({
      answer: "yes",
      value: "no",
      stop: { kind: "stopped", inEffect: true },
    })
    // Today: the reader and the old amenity rows still read Yes.
    expect(await reader(w, "guest_toilets")).toMatchObject({
      status: "available",
      value: "yes",
    })
    expect(
      psql(`select answer from private.amenity_check_rows_presented
        where id = '${w.checks.guest_toilets}'`)
    ).toBe("yes")
  })
})

describe("a stop in effect (A40)", () => {
  it("reads No in the check, the old rows and the reader, without the offer's text", async () => {
    const w = await world("kn-b03-a40-stopped")
    await answer(w, "guest_toilets", {
      lastDayOffered: addDays(londonToday(), -2),
    })
    const now = await check(w, "guest_toilets")
    expect(now.status).toBe("available")
    expect(now.answerInUse).toMatchObject({
      value: "no",
      qualified: null,
      stop: { kind: "stopped", inEffect: true },
    })
    expect(
      psql(`select answer || ':' || progress from private.amenity_check_rows_presented
        where id = '${w.checks.guest_toilets}'`)
    ).toBe("no:complete")
    expect(await reader(w, "guest_toilets")).toMatchObject({
      status: "available",
      reason: null,
      detail: null,
      value: "no",
      finding: null,
      limitations: null,
    })
    // The stored headline is unchanged: nothing was written on the day.
    expect(
      psql(`select s.answer from public.venue_amenity_checks c
        join public.amenity_submissions s on s.id = c.current_submission_id
        where c.id = '${w.checks.guest_toilets}'`)
    ).toBe("yes")
  })

  it("opens no recheck of a schedule or a temporary outage, even when the job runs twice", async () => {
    const w = await world("kn-b03-a40-no-recheck")
    const today = londonToday()
    await answer(w, "guest_toilets", {
      lastDayOffered: addDays(today, -2),
      availability: {
        state: "temporarily_unavailable",
        until: addDays(today, -5),
      },
      schedule: {
        effectiveFrom: addDays(today, -60),
        effectiveTo: addDays(today, -2),
        ...WEEKLY,
      },
    })
    await runRechecks()
    await runRechecks()
    expect(tasks(w, "guest_toilets")).toBe("")
  })

  it("is still a withdrawn answer once withdrawn", async () => {
    const w = await world("kn-b03-a40-withdrawn")
    await answer(w, "guest_toilets", {
      lastDayOffered: addDays(londonToday(), -2),
    })
    expect(
      (
        await call(w.manager, "knowledge_withdraw", {
          p_check_id: w.checks.guest_toilets,
          p_slot_revision: slotRevision(w.venue, "guest_toilets"),
          p_idempotency_key: randomUUID(),
          p_reason: "TEST withdrawn",
        })
      ).error
    ).toBeNull()
    const now = await check(w, "guest_toilets")
    expect(now).toMatchObject({
      status: "unavailable",
      reason: "withdrawn",
      detail: "answer_withdrawn",
    })
    expect(now.answerInUse?.withdrawal).toMatchObject({
      basis: "venue_manager",
    })
    expect(await reader(w, "guest_toilets")).toMatchObject({
      status: "unavailable",
      reason: "withdrawn",
      value: null,
      finding: null,
    })
  })
})

describe("a temporary outage with a later stop (A40)", () => {
  it("needs checking before the stop and reads No with no qualifier after it", async () => {
    const w = await world("kn-b03-a40-temporary")
    const today = londonToday()
    const last = addDays(today, 30)
    await answer(w, "guest_toilets", {
      lastDayOffered: last,
      availability: {
        state: "temporarily_unavailable",
        until: addDays(today, -2),
      },
    })
    expect(await check(w, "guest_toilets")).toMatchObject({
      status: "unavailable",
      reason: "stale",
      detail: "qualified_answer",
    })
    const at = localMidnightUtc(addDays(last, 1))
    expect(stateAt(w, "guest_toilets", minus1s(at))).toMatchObject({
      reason: "stale",
      qualifier: "temporarily_unavailable",
    })
    expect(stateAt(w, "guest_toilets", at)).toMatchObject({
      status: "available",
      value: "no",
      qualifier: null,
    })
  })
})

describe("a schedule that ends without a stop date (A40, §6.1)", () => {
  it("reads No and opens exactly one schedule_ended recheck at local midnight; a new schedule closes it", async () => {
    const w = await world("kn-b03-a40-ended")
    const today = londonToday()
    const last = addDays(today, -2)
    await answer(w, "guest_toilets", {
      schedule: {
        effectiveFrom: addDays(today, -60),
        effectiveTo: last,
        ...WEEKLY,
      },
    })
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "no",
      stop: { kind: "schedule_ended", lastDayOffered: last, inEffect: true },
    })
    await runRechecks()
    await runRechecks()
    expect(tasks(w, "guest_toilets")).toBe(
      `schedule_ended:open:${localMidnightUtc(addDays(last, 1))}`
    )
    const between = psql(`select clock_timestamp()`)
    await answer(w, "guest_toilets", {
      schedule: { effectiveFrom: addDays(today, -1), ...WEEKLY },
    })
    expect(tasks(w, "guest_toilets")).toMatch(/^schedule_ended:done:/)
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "yes",
      stop: null,
    })
    // History reads the schedule of the submission in use then (correction 4).
    expect(historyAt(w, "guest_toilets", between).answerInUse).toMatchObject({
      answer: "yes",
      value: "no",
      stop: { kind: "schedule_ended", lastDayOffered: last },
    })
  })

  it("closes when a deliberate stop is adopted, and when an immediate No replaces it", async () => {
    const today = londonToday()
    const ended = {
      schedule: {
        effectiveFrom: addDays(today, -60),
        effectiveTo: addDays(today, -2),
        ...WEEKLY,
      },
    }
    const w = await world("kn-b03-a40-ended-stop")
    await answer(w, "guest_toilets", ended)
    await runRechecks()
    expect(tasks(w, "guest_toilets")).toMatch(/^schedule_ended:open:/)
    const last = addDays(today, 10)
    await answer(w, "guest_toilets", {
      lastDayOffered: last,
      schedule: {
        effectiveFrom: addDays(today, -1),
        effectiveTo: last,
        ...WEEKLY,
      },
    })
    await runRechecks()
    expect(tasks(w, "guest_toilets")).toMatch(/^schedule_ended:done:[^,]+$/)

    const v = await world("kn-b03-a40-ended-no")
    await answer(v, "guest_toilets", ended)
    await runRechecks()
    expect(tasks(v, "guest_toilets")).toMatch(/^schedule_ended:open:/)
    const corrected = await call(v.manager, "knowledge_correct", {
      p_check_id: v.checks.guest_toilets,
      p_slot_revision: slotRevision(v.venue, "guest_toilets"),
      p_idempotency_key: randomUUID(),
      p_headline: "no",
      p_detail: null,
      p_reason: "TEST stopped today",
    })
    expect(corrected.error).toBeNull()
    await runRechecks()
    expect(tasks(v, "guest_toilets")).toMatch(/^schedule_ended:done:[^,]+$/)
    expect((await check(v, "guest_toilets")).answerInUse).toMatchObject({
      value: "no",
      stop: null,
    })
  })
})

describe("sending and confirming a stop (A40)", () => {
  it("leaves the reading as it was while it waits; confirmed after the date it reads No at once with no task", async () => {
    const w = await world("kn-b03-a40-waits")
    await answer(w, "guest_toilets", { fees: { kind: "free" } })
    const sent = await yes(w.staffA, w, "guest_toilets")
    expect(sent.outcome).toBe("awaiting_confirmation")
    attach(sent.contributionId, { lastDayOffered: addDays(londonToday(), -1) })
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "yes",
      stop: null,
    })
    expect(
      (
        await decide(
          w.manager,
          w,
          "guest_toilets",
          { type: "contribution", id: sent.contributionId },
          "confirm"
        )
      ).error
    ).toBeNull()
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "no",
      stop: { kind: "stopped", inEffect: true },
    })
    await runRechecks()
    expect(tasks(w, "guest_toilets")).toBe("")
  })

  it("leaves the answer as it was when declined", async () => {
    const w = await world("kn-b03-a40-declined")
    await answer(w, "guest_toilets", { fees: { kind: "free" } })
    const sent = await yes(w.staffA, w, "guest_toilets")
    expect(sent.outcome).toBe("awaiting_confirmation")
    attach(sent.contributionId, { lastDayOffered: addDays(londonToday(), -1) })
    expect(
      (
        await decide(
          w.manager,
          w,
          "guest_toilets",
          { type: "contribution", id: sent.contributionId },
          "decline",
          "TEST still open"
        )
      ).error
    ).toBeNull()
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "yes",
      stop: null,
    })
  })

  it("is cancelled by a later answer without a stop date, and history keeps the stop as it stood", async () => {
    const w = await world("kn-b03-a40-cancel")
    const last = addDays(londonToday(), 20)
    await answer(w, "guest_toilets", { lastDayOffered: last })
    const between = psql(`select clock_timestamp()`)
    await answer(w, "guest_toilets", { fees: { kind: "free" } })
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "yes",
      stop: null,
    })
    expect(historyAt(w, "guest_toilets", between).answerInUse).toMatchObject({
      value: "yes",
      stop: { kind: "stopped", lastDayOffered: last, inEffect: false },
    })
  })
})

describe("occurrences at a stop (A40, correction 1)", () => {
  it("keep earlier exceptions, clip the last overnight window at midnight and list nothing after", async () => {
    const w = await world("kn-b03-a40-occurrences")
    const overnight = {
      effectiveFrom: "2026-11-01",
      recurrence: { kind: "weekly", days: ["sun"] },
      windows: [{ start: "22:00", end: "02:00" }],
    }
    const first = await answer(w, "guest_toilets", { schedule: overnight })
    const s1 = psql(`select id from public.knowledge_schedules
      where contribution_id = '${first.contributionId}'`)
    for (const [date, kind, windows] of [
      ["2026-11-15", "cancelled", null],
      ["2026-11-25", "extra", [{ start: "18:00", end: "20:00" }]],
    ] as const)
      expect(
        (
          await call(w.manager, "knowledge_schedule_exception", {
            p_check_id: w.checks.guest_toilets,
            p_slot_revision: slotRevision(w.venue, "guest_toilets"),
            p_idempotency_key: randomUUID(),
            p_schedule_id: s1,
            p_local_date: date,
            p_kind: kind,
            p_windows: windows,
            p_note: null,
          })
        ).error
      ).toBeNull()
    const stop = await answer(w, "guest_toilets", {
      lastDayOffered: "2026-11-29",
      schedule: { ...overnight, effectiveTo: "2026-11-29" },
    })
    expect(
      psql(`select count(*) from public.knowledge_schedule_exceptions e
        join public.knowledge_schedules s on s.id = e.schedule_id
        where s.contribution_id = '${stop.contributionId}'`)
    ).toBe("2")
    type Row = {
      local_date: string
      starts_at: string
      ends_at: string
      state: string
    }
    const rows = await json<Row[]>(w.staffB, "knowledge_occurrences", {
      p_check_id: w.checks.guest_toilets,
      p_from: "2026-11-01",
      p_to: "2026-12-13",
    })
    expect(
      rows.map((r) => [
        r.local_date,
        new Date(r.starts_at).toISOString(),
        new Date(r.ends_at).toISOString(),
        r.state,
      ])
    ).toEqual([
      [
        "2026-11-01",
        "2026-11-01T22:00:00.000Z",
        "2026-11-02T02:00:00.000Z",
        "scheduled",
      ],
      [
        "2026-11-08",
        "2026-11-08T22:00:00.000Z",
        "2026-11-09T02:00:00.000Z",
        "scheduled",
      ],
      [
        "2026-11-15",
        "2026-11-15T22:00:00.000Z",
        "2026-11-16T02:00:00.000Z",
        "cancelled",
      ],
      [
        "2026-11-22",
        "2026-11-22T22:00:00.000Z",
        "2026-11-23T02:00:00.000Z",
        "scheduled",
      ],
      [
        "2026-11-25",
        "2026-11-25T18:00:00.000Z",
        "2026-11-25T20:00:00.000Z",
        "extra",
      ],
      [
        "2026-11-29",
        "2026-11-29T22:00:00.000Z",
        "2026-11-30T00:00:00.000Z",
        "scheduled",
      ],
    ])
  })
})

describe("answers that are not a service (A40)", () => {
  it("read as before, whatever their detail carries", async () => {
    const w = await world("kn-b03-a40-other")
    await answer(
      w,
      "guest_toilets",
      { lastDayOffered: addDays(londonToday(), -2) },
      "facility"
    )
    expect((await check(w, "guest_toilets")).answerInUse).toMatchObject({
      value: "yes",
      stop: null,
    })
    await answer(w, "onsite_parking", {})
    expect((await check(w, "onsite_parking")).answerInUse).toMatchObject({
      value: "yes",
      stop: null,
    })
  })
})

describe("stop date checks (A40)", () => {
  it("refuse a last day before the venue's today at send and correction, and allow today", async () => {
    const w = await world("kn-b03-a40-venue-check")
    const problems = (last: string) =>
      JSON.parse(
        psql(`select private.knowledge_detail_venue_problems_for('${w.venue}', 'guest_toilets', 'service',
          '[]'::jsonb, 'yes', '{"lastDayOffered": "${last}"}'::jsonb)`)
      ) as unknown
    expect(problems(addDays(londonToday(), -1))).toEqual([
      { path: "detail.lastDayOffered", problem: "out_of_range" },
    ])
    expect(problems(londonToday())).toEqual([])
    expect(problems(addDays(londonToday(), 1))).toEqual([])
  })

  it("make a stop or schedule change material and refuse a stop date on imports", () => {
    const has = (fn: string, text: string) =>
      psql(
        `select position('${text.replace(/'/g, "''")}' in pg_get_functiondef('${fn}'::regprocedure)) > 0`
      )
    expect(
      has(
        "public.knowledge_correct(uuid,bigint,uuid,text,jsonb,text)",
        "(v_before_detail -> 'lastDayOffered') is distinct from (v_after_detail -> 'lastDayOffered')"
      )
    ).toBe("t")
    expect(
      has(
        "public.knowledge_source_import(uuid,text,timestamptz,jsonb,uuid)",
        "'assertions[%s].detail.lastDayOffered'"
      )
    ).toBe("t")
    // A37 on imports and R-L1 are kept.
    expect(
      has(
        "public.knowledge_source_import(uuid,text,timestamptz,jsonb,uuid)",
        "'assertions[%s].detail.policyScope'"
      )
    ).toBe("t")
    expect(
      has(
        "private.knowledge_open_rechecks(timestamptz)",
        "knowledge_schema_change_due(v_row.question_key, p_now)"
      )
    ).toBe("t")
  })
})

describe("guards (A40)", () => {
  it("keep the new helpers from clients and the reader with the service role only", () => {
    for (const fn of [
      "private.knowledge_service_end(uuid,uuid,text,text,jsonb,timestamptz)",
      "private.knowledge_check_service_end(uuid,timestamptz)",
      "private.knowledge_service_stop_problems(text,jsonb)",
    ])
      for (const role of ["anon", "authenticated"])
        expect(
          psql(`select has_function_privilege('${role}', '${fn}', 'execute')`),
          `${role} ${fn}`
        ).toBe("f")
    expect(
      psql(`select has_function_privilege('authenticated', 'public.knowledge_reader_answers_v1(uuid,text[])', 'execute')
        || ',' || has_function_privilege('service_role', 'public.knowledge_reader_answers_v1(uuid,text[])', 'execute')`)
    ).toBe("false,true")
    expect(
      psql(`select string_agg(p.proname || ':' || p.provolatile::text || ':' || p.prosecdef::text, ',' order by p.proname collate "C")
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('knowledge_service_end', 'knowledge_check_service_end')`)
    ).toBe("knowledge_check_service_end:s:true,knowledge_service_end:s:true")
    expect(
      psql(
        `select obj_description('private.knowledge_answer_at(uuid,timestamptz)'::regprocedure, 'pg_proc') like 'History read%'`
      )
    ).toBe("t")
  })

  it("leave the credit function, both evidence triggers, the B01 resolver and the shared expansion as they were", () => {
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
    expect(
      psql(`select position('A40' in pg_get_functiondef(
        'private.schedule_occurrences(text,date,date,jsonb,jsonb,jsonb,date,date)'::regprocedure)) = 0`)
    ).toBe("t")
  })
})
