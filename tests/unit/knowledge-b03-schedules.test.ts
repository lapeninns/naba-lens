// B03-d schedules (docs/knowledge/b03-design.md §6, A7, A8, A27): the
// occurrence expansion against the fixtures the database also runs, the
// schedule services' input checks, and the error mapping. Mocked RPC client.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import { expandScheduleOccurrences } from "@/lib/server/knowledge/schedules"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))

type Case = {
  name: string
  input: Parameters<typeof expandScheduleOccurrences>[0]
  expect:
    | { occurrences: unknown[] }
    | { reason: string }
    | { fields: { path: string; problem: string }[] }
}

const { cases } = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/knowledge/occurrences.json"),
    "utf8"
  )
) as { cases: Case[] }

describe("expandScheduleOccurrences (shared fixtures)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const out = expandScheduleOccurrences(c.input)
    if ("occurrences" in c.expect)
      expect(out).toEqual({ ok: true, occurrences: c.expect.occurrences })
    else if ("reason" in c.expect)
      expect(out).toEqual({ ok: false, reason: c.expect.reason })
    else
      expect(out).toEqual({
        ok: false,
        reason: "invalid_value",
        fields: c.expect.fields,
      })
  })
})

function actorWith(handlers: Record<string, (args: object) => object>) {
  const rpc = vi.fn(async (fn: string, args: object = {}) => {
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args) as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return { actor: { db, service: db } as unknown as MediaActor, rpc }
}

const CHECK = "44444444-4444-4444-8444-444444444444"
const KEY = "11111111-1111-4111-8111-111111111111"
const SCHEDULE = "22222222-2222-4222-8222-222222222222"
const ROW = {
  local_date: "2026-11-08",
  starts_at: "2026-11-08T12:00:00+00:00",
  ends_at: "2026-11-08T15:00:00+00:00",
  state: "cancelled",
}
const SCHEDULE_SHAPE = {
  effectiveFrom: "2026-11-01",
  recurrence: { kind: "weekly", days: ["sun"] },
  windows: [{ start: "12:00", end: "15:00" }],
}

describe("schedule services", () => {
  it("read occurrences for at most 92 days, as UTC instants", async () => {
    const { actor, rpc } = actorWith({
      knowledge_occurrences: () => ({ data: [ROW] }),
    })
    expect(
      await knowledge.getOccurrences(actor, {
        checkId: CHECK,
        from: "2026-11-01",
        to: "2026-11-30",
      })
    ).toEqual({
      ok: true,
      occurrences: [
        {
          localDate: "2026-11-08",
          startsAt: "2026-11-08T12:00:00.000Z",
          endsAt: "2026-11-08T15:00:00.000Z",
          state: "cancelled",
        },
      ],
    })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_check_id: CHECK,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    })
    for (const bad of [
      { checkId: CHECK, from: "2026-01-01", to: "2026-04-03" },
      { checkId: CHECK, from: "2026-11-30", to: "2026-11-01" },
      { checkId: CHECK, from: "2026-02-30", to: "2026-03-01" },
    ])
      expect(await knowledge.getOccurrences(actor, bad)).toMatchObject({
        code: "invalid_input",
      })
    expect(
      await knowledge.getOccurrences(actor, {
        checkId: "x",
        from: "2026-11-01",
        to: "2026-11-02",
      })
    ).toMatchObject({ code: "not_found" })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("preview a schedule after the same shape check, field errors keyed by path", async () => {
    const { actor, rpc } = actorWith({
      knowledge_schedule_preview: () => ({ data: [] }),
    })
    expect(
      await knowledge.previewSchedule(actor, {
        schedule: SCHEDULE_SHAPE,
        from: "2026-11-01",
        to: "2026-11-30",
      })
    ).toEqual({ ok: true, occurrences: [] })
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_timezone: null })
    expect(
      await knowledge.previewSchedule(actor, {
        schedule: { ...SCHEDULE_SHAPE, windows: [] },
        from: "2026-11-01",
        to: "2026-11-30",
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { "schedule.windows": expect.any(String) },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("send a single-date exception only with its fields in order", async () => {
    const { actor, rpc } = actorWith({
      knowledge_schedule_exception: () => ({
        data: { exceptionId: KEY, slotRevision: 7, replayed: false },
      }),
    })
    const base = {
      checkId: CHECK,
      slotRevision: 6,
      idempotencyKey: KEY,
      scheduleId: SCHEDULE,
      localDate: "2026-11-08",
    }
    expect(
      await knowledge.addScheduleException(actor, {
        ...base,
        kind: "cancelled",
        note: " Closed for a private party ",
      })
    ).toEqual({ ok: true, exceptionId: KEY, slotRevision: 7, replayed: false })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_check_id: CHECK,
      p_slot_revision: 6,
      p_idempotency_key: KEY,
      p_schedule_id: SCHEDULE,
      p_local_date: "2026-11-08",
      p_kind: "cancelled",
      p_windows: null,
      p_note: "Closed for a private party",
    })
    for (const [extra, field] of [
      [{ kind: "moved" }, "kind"],
      [
        { kind: "cancelled", windows: [{ start: "12:00", end: "13:00" }] },
        "windows",
      ],
      [{ kind: "extra" }, "windows"],
      [
        { kind: "changed_window", windows: [{ start: "12:00", end: "12:00" }] },
        "windows",
      ],
      [{ kind: "cancelled", localDate: "2026-02-30" }, "localDate"],
      [{ kind: "cancelled", scheduleId: "x" }, "scheduleId"],
    ] as const)
      expect(
        await knowledge.addScheduleException(actor, { ...base, ...extra })
      ).toMatchObject({
        code: "invalid_input",
        fieldErrors: { [field]: expect.any(String) },
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("schedule errors", () => {
  it("map to non-retryable 4xx codes", () => {
    expect(
      knowledgeRpcFailure(
        { code: "P0001", message: "schedule_exception_exists" },
        "t"
      )
    ).toMatchObject({ code: "state_conflict", status: 409 })
    expect(
      knowledgeRpcFailure({ code: "22023", message: "invalid_range" }, "t")
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { to: expect.any(String) },
    })
    expect(
      knowledgeRpcFailure({ code: "22023", message: "invalid_timezone" }, "t")
    ).toMatchObject({ code: "invalid_input" })
    expect(
      knowledgeRpcFailure(
        { code: "NLK08", message: "knowledge_not_current" },
        "t"
      )
    ).toMatchObject({ code: "state_conflict" })
  })
})
