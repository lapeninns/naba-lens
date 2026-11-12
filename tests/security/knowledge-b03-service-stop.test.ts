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
//
// Review gate (A40 item 3, review P1): the cases under "in a rollback-scoped
// service version" run one psql transaction that adds a service.v1 registry
// version (and a freshness policy) for the key, acts as signed-in callers
// (role authenticated with their JWT claims) through the real send,
// confirmation, correction and import RPCs, and always rolls back, so the
// shared stack gains no permanent registry version.
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { MONTHLY_COMPLETION_COUNTS_HASH, psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  londonToday,
  photo,
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

  type Occurrence = [string, string, string, string]
  const occurrences = async (w: World) =>
    (
      await json<
        {
          local_date: string
          starts_at: string
          ends_at: string
          state: string
        }[]
      >(w.staffB, "knowledge_occurrences", {
        p_check_id: w.checks.guest_toilets,
        p_from: "2026-11-01",
        p_to: "2026-12-13",
      })
    ).map((r): Occurrence => [
      r.local_date,
      new Date(r.starts_at).toISOString(),
      new Date(r.ends_at).toISOString(),
      r.state,
    ])

  it("keep the based-on chain for a stop before an upcoming version starts (review P2)", async () => {
    const w = await world("kn-b03-a40-occ-upcoming")
    const november = {
      effectiveFrom: "2026-11-01",
      recurrence: { kind: "weekly", days: ["sun"] },
      windows: [{ start: "22:00", end: "02:00" }],
    }
    const first = await answer(w, "guest_toilets", { schedule: november })
    const s1 = psql(`select id from public.knowledge_schedules
      where contribution_id = '${first.contributionId}'`)
    expect(
      (
        await call(w.manager, "knowledge_schedule_exception", {
          p_check_id: w.checks.guest_toilets,
          p_slot_revision: slotRevision(w.venue, "guest_toilets"),
          p_idempotency_key: randomUUID(),
          p_schedule_id: s1,
          p_local_date: "2026-11-15",
          p_kind: "cancelled",
          p_windows: null,
          p_note: null,
        })
      ).error
    ).toBeNull()
    // An upcoming version from 1 December supersedes the November one.
    const upcoming = await answer(w, "guest_toilets", {
      schedule: {
        effectiveFrom: "2026-12-01",
        recurrence: { kind: "weekly", days: ["sun"] },
        windows: [{ start: "12:00", end: "15:00" }],
      },
    })
    expect(
      psql(`select s.supersedes = '${s1}' from public.knowledge_schedules s
        where s.contribution_id = '${upcoming.contributionId}'`)
    ).toBe("t")
    const november1To22: Occurrence[] = [
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
    ]
    const before = await occurrences(w)
    expect(before.slice(0, 3)).toEqual(november1To22)
    expect(before.map((o) => o[0])).toEqual([
      "2026-11-01",
      "2026-11-08",
      "2026-11-15",
      "2026-11-22",
      "2026-11-29",
      "2026-12-06",
      "2026-12-13",
    ])
    // The stop (last day Sunday 22 November) falls before 1 December, so it is
    // sent without a schedule, as the From control sends it.
    const stop = await answer(w, "guest_toilets", {
      lastDayOffered: "2026-11-22",
    })
    expect(
      psql(`select count(*) from public.knowledge_schedules
        where contribution_id = '${stop.contributionId}'`)
    ).toBe("0")
    expect(await occurrences(w)).toEqual([
      ...november1To22,
      // The last overnight window ends at the stop's local midnight.
      [
        "2026-11-22",
        "2026-11-22T22:00:00.000Z",
        "2026-11-23T00:00:00.000Z",
        "scheduled",
      ],
    ])
    // The stop moves to 30 November (last day Sunday 29 November), still before
    // 1 December, so it too is sent without a schedule. It is based on the
    // first stop, which has none either; the walk goes on to the upcoming one.
    const moved = await answer(w, "guest_toilets", {
      lastDayOffered: "2026-11-29",
    })
    expect(
      psql(`select count(*) from public.knowledge_schedules
        where contribution_id = '${moved.contributionId}'`)
    ).toBe("0")
    expect(
      psql(`select x.based_on_submission_id = s.id
        from public.knowledge_contributions x, public.amenity_submissions s
        where x.id = '${moved.contributionId}'
          and s.source_contribution_id = '${stop.contributionId}'`)
    ).toBe("t")
    expect(await occurrences(w)).toEqual([
      ...november1To22,
      // 22 November ends at its own 02:00 again; only this stop's cutoff applies.
      [
        "2026-11-22",
        "2026-11-22T22:00:00.000Z",
        "2026-11-23T02:00:00.000Z",
        "scheduled",
      ],
      [
        "2026-11-29",
        "2026-11-29T22:00:00.000Z",
        "2026-11-30T00:00:00.000Z",
        "scheduled",
      ],
    ])
  })

  it("never fall back to another schedule of the check when the based-on submission had none (review P2)", async () => {
    const w = await world("kn-b03-a40-occ-no-base")
    await answer(w, "guest_toilets", {
      schedule: {
        effectiveFrom: "2026-11-01",
        recurrence: { kind: "weekly", days: ["sun"] },
        windows: [{ start: "12:00", end: "15:00" }],
      },
    })
    // The answer the stop is based on has no schedule.
    await answer(w, "guest_toilets", { fees: { kind: "free" } })
    expect(await occurrences(w)).toEqual([])
    await answer(w, "guest_toilets", { lastDayOffered: "2026-11-22" })
    expect(await occurrences(w)).toEqual([])
    // A moved stop walks back through the first stop only as far as the
    // ordinary answer, never to the older schedule behind it.
    await answer(w, "guest_toilets", { lastDayOffered: "2026-11-29" })
    expect(await occurrences(w)).toEqual([])
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
      "private.knowledge_recheck_obsolete(text,jsonb)",
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
    ).toBe(MONTHLY_COMPLETION_COUNTS_HASH)
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

describe("obsolete recheck causes (A40 review P1)", () => {
  it("name only a schedule_ended task without that end in effect and a temporary task after a stop in effect", () => {
    const obsolete = (cause: string, end: object | null) =>
      psql(
        `select private.knowledge_recheck_obsolete('${cause}', ${end ? `'${JSON.stringify(end)}'::jsonb` : "null"})`
      )
    const ended = (inEffect: boolean) => ({ kind: "schedule_ended", inEffect })
    const stopped = (inEffect: boolean) => ({ kind: "stopped", inEffect })
    expect(
      [
        obsolete("schedule_ended", ended(true)),
        obsolete("schedule_ended", ended(false)),
        obsolete("schedule_ended", stopped(true)),
        obsolete("schedule_ended", stopped(false)),
        obsolete("schedule_ended", null),
        obsolete("temporary_until_passed", stopped(true)),
        obsolete("temporary_until_passed", stopped(false)),
        obsolete("temporary_until_passed", ended(true)),
        obsolete("temporary_until_passed", null),
      ].join(",")
    ).toBe("f,t,t,t,t,t,f,f,f")
    for (const cause of [
      "due_soon",
      "expired",
      "basis_missing",
      "schema_changed",
      "evidence_lost",
      "scope_changed",
    ])
      expect(obsolete(cause, stopped(true)), cause).toBe("f")
  })
})

// ---------------------------------------------------------------------------
// In a rollback-scoped service version (review gate, item 3)
// ---------------------------------------------------------------------------

type Identity = World["manager"]

/** One psql script on the owned local stack; returns its printed lines. */
function psqlScript(sql: string): string[] {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return execFileSync("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8",
    input: sql,
  })
    .split("\n")
    .filter((line) => line.length > 0)
}

const lit = (value: unknown) =>
  value === null || value === undefined
    ? "null"
    : `'${(typeof value === "string" ? value : JSON.stringify(value)).replace(/'/g, "''")}'`

/**
 * Runs `steps` in one transaction that first adds a service.v1 registry
 * version for `key` (copying its latest version, with an internal freshness
 * policy on observed_on of `policy` days and lead when given) and always
 * rolls back. Each read step prints one JSON line; they are returned in order.
 */
function inServiceVersion(
  key: string,
  steps: string[],
  policy?: { maxAgeDays: number; leadDays: number }
): unknown[] {
  const id = `test_${randomUUID().replace(/-/g, "").slice(0, 20)}`
  const lines = psqlScript(`begin;
${
  policy
    ? `insert into public.knowledge_freshness_policies (id, version, claim_class, use, max_age, recheck_lead, basis, note)
values ('${id}', 1, 'offering', 'internal', interval '${policy.maxAgeDays} days', interval '${policy.leadDays} days',
  'observed_on', 'TEST A40 rollback-scoped');`
    : ""
}
insert into public.knowledge_question_versions (key, version, catalogue_version, rule_version, value_schema,
  value_schema_version, guidance, evidence_rule, confirmation, self_confirmation_allowed, sensitivity, freshness,
  publishable_fields, material_fields, requires_zones, lifecycle, change_kind, change_note, family, subject_type,
  owner_role, features, public_media, upgrade_rules)
select v.key, v.version + 1, v.catalogue_version, v.rule_version, 'service', 1, v.guidance, v.evidence_rule,
  v.confirmation, v.self_confirmation_allowed, v.sensitivity,
  jsonb_build_object('internal', ${policy ? `'${id}'` : "null"}, 'public', null),
  v.publishable_fields, v.material_fields, v.requires_zones, v.lifecycle, 'schema',
  'TEST A40 rollback-scoped service version', 'service', v.subject_type, v.owner_role, v.features, v.public_media,
  v.upgrade_rules
from public.knowledge_question_versions v where v.key = '${key}' order by v.version desc limit 1;
${steps.join("\n")}
rollback;
`)
  return lines.map((line) => JSON.parse(line) as unknown)
}

/** Switches the transaction to a signed-in caller (role authenticated). */
const as = (who: Identity) => `reset role;
set local "request.jwt.claims" to ${lit({ sub: who.id, role: "authenticated" })};
set local role authenticated;`

/** Stores the slot revision in a40.rev, as the owner. */
const revision = (w: World, key: string) => `reset role;
do $$ begin perform set_config('a40.rev', private.knowledge_slot_revision('${w.venue}', '${key}')::text, true); end $$;`

/**
 * A real send of a Yes with this detail by `who` (with a photo `asset`),
 * confirmed by the manager if it waits. a40.<name> holds the contribution.
 * With `refusal`, the call is caught and a40.err holds { message, detail }.
 */
function send(
  w: World,
  who: Identity,
  key: string,
  name: string,
  asset: string,
  detail: object,
  observedOn: string | null,
  refusal = false
) {
  const callSql = `public.knowledge_submit(p_check_id => '${w.checks[key]}',
    p_slot_revision => current_setting('a40.rev')::bigint, p_idempotency_key => gen_random_uuid(),
    p_kind => 'finding', p_answer => 'yes', p_finding => null, p_limitations => null, p_reason => null,
    p_unknown_preset => null, p_tried_text => null, p_change_reason => null, p_responds_to => null,
    p_asset_ids => array['${asset}']::uuid[], p_internal_metadata => null, p_redaction_confirmed => null,
    p_confirm_own => false, p_detail => ${lit(detail)}::jsonb, p_observed_on => ${lit(observedOn)}::date,
    p_observed_on_source => ${observedOn ? "'chosen'" : "null"})`
  if (refusal)
    return `${revision(w, key)}
${as(who)}
do $$ declare d text; begin
  perform ${callSql};
  perform set_config('a40.err', 'null', true);
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  perform set_config('a40.err', json_build_object('message', sqlerrm, 'detail', d::json)::text, true);
end $$;
reset role;`
  return `${revision(w, key)}
${as(who)}
do $$ declare r jsonb; begin
  r := ${callSql};
  perform set_config('a40.${name}', r ->> 'contributionId', true);
  perform set_config('a40.waits', (r ->> 'outcome' = 'awaiting_confirmation')::text, true);
end $$;
reset role;
select current_setting('a40.waits')::boolean as waits \\gset
\\if :waits
${revision(w, key)}
${as(w.manager)}
do $$ begin
  perform public.knowledge_decide('contribution', current_setting('a40.${name}')::uuid, 'confirm',
    current_setting('a40.rev')::bigint, gen_random_uuid(), null);
end $$;
reset role;
\\endif`
}

/** A real manager correction; a40.<name> holds its result. */
const correct = (
  w: World,
  key: string,
  name: string,
  detail: object
) => `${revision(w, key)}
${as(w.manager)}
do $$ begin
  perform set_config('a40.${name}', public.knowledge_correct('${w.checks[key]}', current_setting('a40.rev')::bigint,
    gen_random_uuid(), 'yes', ${lit(detail)}::jsonb, 'TEST corrected')::text, true);
end $$;
reset role;`

/** The hourly job at an SQL instant, as the owner. */
const job = (at: string) => `reset role;
do $$ begin perform private.knowledge_open_rechecks(${at}); end $$;`

/** Prints the check's tasks as cause:state:due-in-days-from-today-midnight. */
const printTasks = (w: World, key: string) => `reset role;
select to_json(coalesce(string_agg(t.cause || ':' || t.state || ':'
    || to_char(t.due_at at time zone 'Europe/London', 'YYYY-MM-DD"T"HH24:MI'), ',' order by t.cause, t.due_at), ''))
from public.knowledge_recheck_tasks t where t.check_id = '${w.checks[key]}';`

/** SQL for venue-local midnight of today + n days. */
const midnight = (n: number) =>
  `((private.london_today() + ${n})::timestamp at time zone 'Europe/London')`

const local = (n: number) => `${addDays(londonToday(), n)}T00:00`

describe("rechecks after a deliberate stop, with a real freshness policy (A40 review P1)", () => {
  const POLICY = { maxAgeDays: 10, leadDays: 5 }

  it("closes the replaced schedule_ended task while a missing basis keeps its own task", async () => {
    const w = await world("kn-b03-a40-p1-missing")
    const today = londonToday()
    const a1 = await photo(w.staffA.id, w.venue)
    const out = inServiceVersion(
      "guest_toilets",
      [
        // No observed date: the internal policy's basis is missing.
        send(
          w,
          w.staffA,
          "guest_toilets",
          "c1",
          a1,
          {
            schedule: { effectiveFrom: today, effectiveTo: today, ...WEEKLY },
          },
          null
        ),
        job(`${midnight(1)} + interval '1 hour'`),
        printTasks(w, "guest_toilets"),
        correct(w, "guest_toilets", "r1", { lastDayOffered: today }),
        printTasks(w, "guest_toilets"),
        job(`${midnight(1)} + interval '2 hours'`),
        printTasks(w, "guest_toilets"),
      ],
      POLICY
    )
    expect(out[0]).toMatch(
      new RegExp(`^basis_missing:open:[^,]+,schedule_ended:open:${local(1)}$`)
    )
    // The correction closes the obsolete task although the slot is stale.
    expect(out[1]).toMatch(
      new RegExp(`^basis_missing:open:[^,]+,schedule_ended:done:${local(1)}$`)
    )
    expect(out[2]).toBe(out[1])
  })

  it("closes the replaced schedule_ended task while the new answer is due soon", async () => {
    const w = await world("kn-b03-a40-p1-due-soon")
    const today = londonToday()
    const a1 = await photo(w.staffA.id, w.venue)
    const out = inServiceVersion(
      "guest_toilets",
      [
        // Observed six days ago: due at midnight in four days, due soon now.
        send(
          w,
          w.staffA,
          "guest_toilets",
          "c1",
          a1,
          {
            schedule: { effectiveFrom: today, effectiveTo: today, ...WEEKLY },
          },
          addDays(today, -6)
        ),
        job(`${midnight(1)} + interval '1 hour'`),
        printTasks(w, "guest_toilets"),
        correct(w, "guest_toilets", "r1", { lastDayOffered: today }),
        job(`${midnight(1)} + interval '2 hours'`),
        printTasks(w, "guest_toilets"),
      ],
      POLICY
    )
    expect(out[0]).toBe(
      `due_soon:open:${local(4)},schedule_ended:open:${local(1)}`
    )
    expect(out[1]).toBe(
      `due_soon:open:${local(4)},schedule_ended:done:${local(1)}`
    )
  })

  it("lets an expired task open at the same due time as an obsolete schedule_ended task, and closes that task", async () => {
    const w = await world("kn-b03-a40-p1-shared-due")
    const today = londonToday()
    const a1 = await photo(w.staffA.id, w.venue)
    const out = inServiceVersion(
      "guest_toilets",
      [
        // Freshness due and the schedule's end are both midnight in four days.
        send(
          w,
          w.staffA,
          "guest_toilets",
          "c1",
          a1,
          {
            schedule: {
              effectiveFrom: today,
              effectiveTo: addDays(today, 3),
              ...WEEKLY,
            },
          },
          addDays(today, -6)
        ),
        correct(w, "guest_toilets", "r1", {
          lastDayOffered: addDays(today, 3),
        }),
        // A schedule_ended task left open with that due time (as one opened
        // before the stop and not yet closed would be).
        `reset role;
insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
values ('${w.venue}', '${w.checks.guest_toilets}', 'guest_toilets', 'schedule_ended', 'internal', ${midnight(4)});`,
        job(`${midnight(4)} + interval '1 hour'`),
        printTasks(w, "guest_toilets"),
      ],
      POLICY
    )
    expect(out[0]).toBe(
      `expired:open:${local(4)},schedule_ended:done:${local(4)}`
    )
  })

  it("keeps a temporary outage task before the stop and closes it once the stop is in effect", async () => {
    const w = await world("kn-b03-a40-p1-temporary")
    const today = londonToday()
    const a1 = await photo(w.staffA.id, w.venue)
    const out = inServiceVersion(
      "guest_toilets",
      [
        send(
          w,
          w.staffA,
          "guest_toilets",
          "c1",
          a1,
          {
            lastDayOffered: addDays(today, 1),
            availability: { state: "temporarily_unavailable", until: today },
          },
          addDays(today, -6)
        ),
        job(`${midnight(1)} + interval '1 hour'`),
        printTasks(w, "guest_toilets"),
        job(`${midnight(2)} + interval '1 hour'`),
        printTasks(w, "guest_toilets"),
      ],
      POLICY
    )
    // Before the stop the outage still needs checking.
    expect(out[0]).toBe(
      `due_soon:open:${local(4)},temporary_until_passed:open:${local(1)}`
    )
    // From the stop, the outage is gone; the freshness task stays.
    expect(out[1]).toBe(
      `due_soon:open:${local(4)},temporary_until_passed:done:${local(1)}`
    )
  })
})

describe("real send, correction and import of a stop (A40 review gate, item 3)", () => {
  it("checks the stop date against the venue day at send", async () => {
    const w = await world("kn-b03-a40-gate-send")
    const today = londonToday()
    const [a1, a2] = await Promise.all([
      photo(w.staffA.id, w.venue),
      photo(w.staffA.id, w.venue),
    ])
    const out = inServiceVersion("guest_toilets", [
      send(
        w,
        w.staffA,
        "guest_toilets",
        "c1",
        a1,
        {
          lastDayOffered: addDays(today, -1),
        },
        null,
        true
      ),
      `select current_setting('a40.err')::json;`,
      send(
        w,
        w.staffA,
        "guest_toilets",
        "c2",
        a2,
        { lastDayOffered: today },
        null
      ),
      `reset role;
select json_build_object('lastDayOffered', d.detail ->> 'lastDayOffered', 'schema', d.value_schema)
from public.knowledge_contribution_details d where d.contribution_id = current_setting('a40.c2')::uuid;`,
    ])
    expect(out[0]).toEqual({
      message: "invalid_value",
      detail: {
        fields: [{ path: "detail.lastDayOffered", problem: "out_of_range" }],
      },
    })
    expect(out[1]).toEqual({ lastDayOffered: today, schema: "service" })
  })

  it("makes a changed or cancelled stop a new contribution and submission", async () => {
    const w = await world("kn-b03-a40-gate-correct")
    const today = londonToday()
    const a1 = await photo(w.staffA.id, w.venue)
    const current = `reset role;
select json_build_object('submission', c.current_submission_id, 'contribution', s.source_contribution_id,
  'lastDayOffered', private.knowledge_effective_detail(s.source_contribution_id) ->> 'lastDayOffered')
from public.venue_amenity_checks c join public.amenity_submissions s on s.id = c.current_submission_id
where c.id = '${w.checks.guest_toilets}';`
    const out = inServiceVersion("guest_toilets", [
      send(
        w,
        w.staffA,
        "guest_toilets",
        "c1",
        a1,
        {
          lastDayOffered: addDays(today, 5),
        },
        null
      ),
      current,
      correct(w, "guest_toilets", "changed", {
        lastDayOffered: addDays(today, 6),
      }),
      `select current_setting('a40.changed')::json;`,
      current,
      correct(w, "guest_toilets", "cancelled", { fees: { kind: "free" } }),
      `select current_setting('a40.cancelled')::json;`,
      current,
    ]) as [
      {
        submission: string
        contribution: string
        lastDayOffered: string | null
      },
      { material: boolean; submissionId: string },
      {
        submission: string
        contribution: string
        lastDayOffered: string | null
      },
      { material: boolean; submissionId: string },
      {
        submission: string
        contribution: string
        lastDayOffered: string | null
      },
    ]
    expect(out[0].lastDayOffered).toBe(addDays(today, 5))
    expect(out[1].material).toBe(true)
    expect(out[2]).toMatchObject({
      submission: out[1].submissionId,
      lastDayOffered: addDays(today, 6),
    })
    expect(out[2].submission).not.toBe(out[0].submission)
    expect(out[2].contribution).not.toBe(out[0].contribution)
    expect(out[3].material).toBe(true)
    expect(out[4]).toMatchObject({
      submission: out[3].submissionId,
      lastDayOffered: null,
    })
    expect(out[4].submission).not.toBe(out[2].submission)
    expect(out[4].contribution).not.toBe(out[2].contribution)
  })

  it("refuses a stop date on an external assertion and still imports an ordinary service assertion", async () => {
    const w = await world("kn-b03-a40-gate-import")
    const importSql = (
      name: string,
      revisionLabel: string,
      detail: object
    ) => `${as(w.admin)}
do $$ declare d text; begin
  perform set_config('a40.${name}', public.knowledge_source_import(current_setting('a40.source')::uuid,
    '${revisionLabel}', now() - interval '1 hour',
    jsonb_build_array(jsonb_build_object('venueId', '${w.venue}', 'questionKey', 'guest_toilets',
      'headline', 'yes', 'detail', ${lit(detail)}::jsonb)), gen_random_uuid())::text, true);
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  perform set_config('a40.${name}', json_build_object('message', sqlerrm, 'detail', d::json)::text, true);
end $$;
reset role;
select current_setting('a40.${name}')::json;`
    const out = inServiceVersion("guest_toilets", [
      `${as(w.admin)}
do $$ begin
  perform set_config('a40.source', public.knowledge_source_declare('venue_website', 'TEST website', '${w.venue}',
    gen_random_uuid()) ->> 'sourceId', true);
end $$;`,
      importSql("stop", "r1", {
        lastDayOffered: addDays(londonToday(), 5),
      }),
      importSql("ordinary", "r2", { fees: { kind: "free" } }),
    ])
    expect(out[0]).toEqual({
      message: "invalid_value",
      detail: {
        fields: [
          {
            path: "assertions[0].detail.lastDayOffered",
            problem: "not_allowed",
          },
        ],
      },
    })
    expect(out[1]).toMatchObject({ imported: 1, replayed: false })
  })
})
