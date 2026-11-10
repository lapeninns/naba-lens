// B03-b places and structured detail (docs/knowledge/b03-design.md §4, §12
// B03-b, A1, A2, A10, A18, A20, A24, A26). Places are added and retired by
// the venue's manager or an admin and never deleted; staff read the active
// ones. Detail is refused on every registry version 1 key (inert until a
// detail version exists), observation dates are stored and replay-checked,
// and the venue checks for places and step-free entrances hold. Real
// signed-in identities through PostgREST; psql reads state back and calls
// the private venue check directly (a registry version 2 cannot be added to
// a shared database: versions are append-only).
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import type { TestIdentity } from "../support/identities"
import { psql } from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  json,
  londonToday,
  photo,
  refused,
  service,
  slotRevision,
  submit,
  submitArgs,
  video,
  world,
  type SubmitOpts,
  type World,
} from "./knowledge-fixtures"

type Place = {
  subjectId: string
  kind: string
  label: string
  active: boolean
  addedOn?: string
  addedBy?: string
  retiredOn?: string | null
}
type Places = { venueId: string; items: Place[] }

let w: World
let other: World

beforeAll(async () => {
  ;[w, other] = await Promise.all([
    world("kn-b03-places"),
    world("kn-b03-places-other"),
  ])
})

const add = (
  who: TestIdentity,
  kind: string,
  label: string,
  key = randomUUID(),
  venue: string | null = null
) =>
  call(who, "knowledge_subject_add", {
    p_venue_id: venue,
    p_kind: kind,
    p_label: label,
    p_idempotency_key: key,
  })

async function added(
  who: TestIdentity,
  kind: string,
  label: string,
  venue: string | null = null
) {
  const { data, error } = await add(who, kind, label, randomUUID(), venue)
  if (error) throw new Error(error.message)
  return (data as { subjectId: string }).subjectId
}

const retire = (
  who: TestIdentity,
  id: string,
  reason: string | null = "TEST closed"
) =>
  call(who, "knowledge_subject_retire", {
    p_subject_id: id,
    p_reason: reason,
    p_idempotency_key: randomUUID(),
  })

const list = (who: TestIdentity, venue: string | null = null) =>
  json<Places>(who, "knowledge_subjects", { p_venue_id: venue })

const firstName = (id: string) =>
  psql(`select display_name from public.profiles where id = '${id}'`)

describe("places (A2)", () => {
  it("are added by the venue's manager, trimmed, replayed by key and never duplicated", async () => {
    const key = randomUUID()
    const first = await add(w.manager, "entrance", "  Front door ", key)
    expect(first.error).toBeNull()
    const { subjectId } = first.data as { subjectId: string; replayed: boolean }
    expect(first.data).toEqual({ subjectId, replayed: false })
    expect((await add(w.manager, "entrance", "Front door", key)).data).toEqual({
      subjectId,
      replayed: true,
    })
    await refused(
      w.manager,
      "knowledge_subject_add",
      {
        p_venue_id: null,
        p_kind: "entrance",
        p_label: "Back door",
        p_idempotency_key: key,
      },
      "idempotency_key_reused"
    )
    const dup = await refused(
      w.manager,
      "knowledge_subject_add",
      {
        p_venue_id: null,
        p_kind: "entrance",
        p_label: "FRONT DOOR",
        p_idempotency_key: randomUUID(),
      },
      "place_exists",
      "NLK13"
    )
    expect(JSON.parse(dup.details!)).toEqual({ subjectId })
    // Another kind with the same label is a different place.
    await added(w.manager, "room", "Front door")
    expect(
      psql(
        `select label from public.knowledge_subjects where id = '${subjectId}'`
      )
    ).toBe("Front door")
  })

  it("refuse a bad kind or label", async () => {
    await refused(
      w.manager,
      "knowledge_subject_add",
      {
        p_venue_id: null,
        p_kind: "door",
        p_label: "X",
        p_idempotency_key: randomUUID(),
      },
      "invalid_place_kind"
    )
    for (const label of ["   ", "x".repeat(81)])
      expect((await add(w.manager, "room", label)).error?.message).toBe(
        "invalid_label"
      )
  })

  it("are listed to staff (active, no who or when) and to managers and admins (all, with who)", async () => {
    const kept = await added(w.manager, "area", "TEST garden")
    const gone = await added(w.manager, "area", "TEST terrace")
    expect((await retire(w.manager, gone)).error).toBeNull()

    const staff = await list(w.staffA)
    expect(staff.venueId).toBe(w.venue)
    expect(staff.items.find((p) => p.subjectId === kept)).toEqual({
      subjectId: kept,
      kind: "area",
      label: "TEST garden",
      active: true,
    })
    expect(staff.items.some((p) => p.subjectId === gone)).toBe(false)

    const manager = await list(w.manager)
    expect(manager.items.find((p) => p.subjectId === kept)).toMatchObject({
      active: true,
      addedBy: firstName(w.manager.id).split(" ")[0],
      addedOn: expect.any(String),
      retiredOn: null,
    })
    expect(manager.items.find((p) => p.subjectId === gone)).toMatchObject({
      active: false,
      retiredOn: expect.any(String),
    })

    await refused(
      w.admin,
      "knowledge_subjects",
      { p_venue_id: null },
      "venue_required"
    )
    const admin = await list(w.admin, w.venue)
    expect(admin.items.find((p) => p.subjectId === kept)?.addedBy).toBe(
      firstName(w.manager.id)
    )
    await refused(
      w.manager,
      "knowledge_subjects",
      { p_venue_id: other.venue },
      "wrong_venue"
    )
  })

  it("are added and retired only where canManagePlaces says so (R8)", async () => {
    for (const who of [w.manager, w.staffManager, w.staffA, w.admin]) {
      const venue = who === w.admin ? w.venue : null
      const caps = await json<{ canManagePlaces: boolean }>(
        who,
        "my_venue_capabilities",
        { p_venue_id: venue }
      )
      const { error } = await add(
        who,
        "route",
        `TEST route ${randomUUID()}`,
        randomUUID(),
        venue
      )
      expect(error === null, who.id).toBe(caps.canManagePlaces)
    }
    expect(
      (
        await json<{ canManagePlaces: boolean }>(
          w.staffA,
          "my_venue_capabilities",
          {
            p_venue_id: null,
          }
        )
      ).canManagePlaces
    ).toBe(false)
    expect((await add(w.staffA, "room", "TEST snug")).error?.message).toBe(
      "not_venue_manager"
    )
  })

  it("are retired once, with a reason, by their own venue's manager; the label can then be reused", async () => {
    const id = await added(w.manager, "facility_point", "TEST hatch")
    expect((await retire(w.manager, id, null)).error?.message).toBe(
      "reason_required"
    )
    expect((await retire(other.manager, id)).error?.message).toBe(
      "knowledge_subject_not_found"
    )
    expect((await retire(w.staffA, id)).error?.message).toBe(
      "knowledge_subject_not_found"
    )
    expect((await retire(w.manager, id)).data).toMatchObject({
      subjectId: id,
      retired: true,
      replayed: false,
    })
    const again = await added(w.manager, "facility_point", "TEST hatch")
    expect(again).not.toBe(id)
  })

  it("keep their tables closed to clients, never deleted, and changed only by retiring", async () => {
    for (const table of [
      "knowledge_subjects",
      "knowledge_write_commands",
      "knowledge_contribution_details",
    ]) {
      const { data, error } = await (
        w.manager.client as unknown as {
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
    const id = await added(w.manager, "room", "TEST cellar")
    for (const sql of [
      `delete from public.knowledge_subjects where id = '${id}'`,
      `update public.knowledge_subjects set label = 'TEST vault' where id = '${id}'`,
      `update public.knowledge_subjects set venue_id = '${other.venue}' where id = '${id}'`,
      `delete from public.knowledge_write_commands`,
      `delete from public.knowledge_contribution_details`,
    ])
      expect(() => psql(sql), sql).toThrow()
  })
})

type Sent = Record<string, unknown> & {
  contributionId: string
  outcome: string
  replayed: boolean
}

function submit19(
  who: TestIdentity,
  key: string,
  o: SubmitOpts & {
    detail?: object | null
    observedOn?: string | null
    source?: string | null
  } = {},
  at: World = w
) {
  return call(who, "knowledge_submit", {
    ...submitArgs(at, key, o),
    p_detail: o.detail ?? null,
    p_observed_on: o.observedOn ?? null,
    p_observed_on_source: o.source ?? null,
  })
}

const daysAgo = (n: number) => {
  const d = new Date(`${londonToday()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

describe("detail and observation date on knowledge_submit (A20)", () => {
  it("refuses detail on every version 1 key, recording nothing", async () => {
    const before = count(
      `select count(*) from public.knowledge_contributions where check_id = '${w.checks.guest_toilets}'`
    )
    for (const detail of [{ locations: [] }, { scope: { label: "TEST" } }]) {
      const { error } = await submit19(w.staffA, "guest_toilets", {
        answer: "unknown",
        detail,
      })
      expect(error?.message).toBe("invalid_value")
      expect(JSON.parse(error!.details!)).toEqual({
        fields: [{ path: "detail", problem: "not_allowed" }],
      })
    }
    expect(
      count(
        `select count(*) from public.knowledge_contributions where check_id = '${w.checks.guest_toilets}'`
      )
    ).toBe(before)
    // jsonb null and an empty object are no detail.
    for (const detail of [null, {}]) {
      const { error } = await submit19(w.staffB, "guest_toilets", {
        answer: "unknown",
        detail,
      })
      expect(error).toBeNull()
    }
  })

  it("stores the observation date, checks its range and both fields, and replays only the same request", async () => {
    const key = randomUUID()
    const revision = slotRevision(w.venue, "onsite_parking")
    const sent = await submit19(w.staffA, "onsite_parking", {
      answer: "unknown",
      key,
      revision,
      observedOn: daysAgo(30),
      source: "chosen",
    })
    expect(sent.error).toBeNull()
    const result = sent.data as Sent
    expect(result).toMatchObject({
      outcome: "recorded",
      replayed: false,
      detail: null,
      observedOn: daysAgo(30),
      rechecksClosed: [],
    })
    expect(
      psql(`select observed_on || '|' || observed_on_source || '|' || question_version
        from public.knowledge_contribution_details where contribution_id = '${result.contributionId}'`)
    ).toBe(`${daysAgo(30)}|chosen|1`)

    const replay = await submit19(w.staffA, "onsite_parking", {
      answer: "unknown",
      key,
      revision,
      observedOn: daysAgo(30),
      source: "chosen",
    })
    expect((replay.data as Sent | null)?.replayed).toBe(true)
    const changed = await submit19(w.staffA, "onsite_parking", {
      answer: "unknown",
      key,
      revision,
      observedOn: daysAgo(30),
      source: "form_default",
    })
    expect(changed.error?.message).toBe("idempotency_key_reused")

    for (const [o, fields] of [
      [
        { observedOn: daysAgo(31), source: "chosen" },
        [{ path: "observedOn", problem: "out_of_range" }],
      ],
      [
        { observedOn: daysAgo(-1), source: "chosen" },
        [{ path: "observedOn", problem: "out_of_range" }],
      ],
      [
        { observedOn: londonToday() },
        [{ path: "observedOnSource", problem: "required" }],
      ],
      [{ source: "chosen" }, [{ path: "observedOn", problem: "required" }]],
      [
        { observedOn: londonToday(), source: "guessed" },
        [{ path: "observedOnSource", problem: "invalid" }],
      ],
    ] as const) {
      const { error } = await submit19(w.staffB, "onsite_parking", {
        answer: "unknown",
        ...o,
      })
      expect(error?.message).toBe("invalid_value")
      expect(JSON.parse(error!.details!)).toEqual({ fields })
    }
  })

  it("shows the date on pending findings and on the answer in use, leaving B01's slot detail as it was", async () => {
    const v = await world("kn-b03-adopt")
    const asset = await photo(v.staffA.id, v.venue)
    const sent = await submit19(
      v.staffA,
      "guest_toilets",
      { assets: [asset], observedOn: londonToday(), source: "form_default" },
      v
    )
    expect(sent.error).toBeNull()
    const result = sent.data as Sent
    type Check = Record<string, unknown> & {
      answerInUse: Record<string, unknown> | null
      pending: {
        findingRef: { id: string }
        observedOn?: string | null
        detail?: unknown
      }[]
      freshness: unknown[]
    }
    if (result.outcome === "awaiting_confirmation") {
      const mine = (
        await json<Check>(v.manager, "knowledge_check", {
          p_check_id: v.checks.guest_toilets,
        })
      ).pending.find((p) => p.findingRef.id === result.contributionId)
      expect(mine).toMatchObject({ observedOn: londonToday(), detail: null })
      expect(
        (
          await decide(
            v.manager,
            v,
            "guest_toilets",
            {
              type: "contribution",
              id: result.contributionId,
            },
            "confirm"
          )
        ).error
      ).toBeNull()
    }
    const check = await json<Check>(v.staffA, "knowledge_check", {
      p_check_id: v.checks.guest_toilets,
    })
    expect(check.answerInUse).toMatchObject({
      detail: null,
      detailRecorded: true,
      observedOn: londonToday(),
    })
    expect(check.detail === null || typeof check.detail === "string").toBe(true)
    expect(check.freshness).toEqual(
      ["internal", "public"].map((use) => ({
        use,
        state: "unrated",
        nextCheckDue: null,
        basis: null,
        basisDate: null,
      }))
    )
  })

  it("leaves the 16-argument result unchanged", async () => {
    const { data, error } = await call(
      w.staffB,
      "knowledge_submit",
      submitArgs(w, "onsite_parking", { answer: "unknown" })
    )
    expect(error).toBeNull()
    expect(data).not.toHaveProperty("rechecksClosed")
    expect(data).not.toHaveProperty("observedOn")
  })
})

describe("venue checks on detail (§4.3, A18, A26)", () => {
  // As an accessibility answer would be checked (B03-b review M1: version 1
  // is presence, which gets no venue check at all).
  const problems = (venue: string, headline: string, detail: object) =>
    JSON.parse(
      psql(`select private.knowledge_detail_venue_problems_for('${venue}', 'step_free_entrance',
        'accessibility', '[]'::jsonb, '${headline}', '${JSON.stringify(detail).replace(/'/g, "''")}'::jsonb)`)
    ) as unknown

  it("needs the venue's active places and a listed step-free entrance", async () => {
    const v = await world("kn-b03-entrances", { enable: false })
    expect(problems(v.venue, "no", { entrances: [] })).toEqual([
      { path: "detail.entrances", problem: "no_entrances_listed" },
    ])
    const front = await added(v.manager, "entrance", "TEST front")
    const side = await added(v.manager, "entrance", "TEST side")
    const theirs = await added(other.manager, "entrance", "TEST theirs")
    const closed = await added(v.manager, "entrance", "TEST closed")
    expect((await retire(v.manager, closed)).error).toBeNull()

    expect(
      problems(v.venue, "no", {
        scope: { subjectId: theirs },
        locations: [{ subjectId: closed }, { label: "Somewhere else" }],
        entrances: [
          { subjectId: front, stepFree: "no" },
          { subjectId: side, stepFree: "no" },
        ],
      })
    ).toEqual([
      { path: "detail.locations[0]", problem: "unknown_subject" },
      { path: "detail.scope", problem: "unknown_subject" },
    ])
    // No: every active entrance listed as not step-free.
    expect(
      problems(v.venue, "no", {
        entrances: [{ subjectId: front, stepFree: "no" }],
      })
    ).toEqual([{ path: "detail.entrances", problem: "required" }])
    // Yes: at least one listed entrance that is step-free; a typed entrance
    // never counts (A26).
    expect(
      problems(v.venue, "yes", {
        scope: { label: "Somewhere else" },
        entrances: [],
      })
    ).toEqual([{ path: "detail.entrances", problem: "required" }])
    expect(
      problems(v.venue, "yes", {
        scope: { subjectId: front },
        entrances: [{ subjectId: front, stepFree: "yes" }],
      })
    ).toEqual([])
    // Unknown needs nothing.
    expect(problems(v.venue, "unknown", {})).toEqual([])
  })
})

describe("version 1 stays inert (B03-b review M1)", () => {
  it("sends a step-free Yes and No with no detail through the 19-argument overload exactly as through the 16-argument one", async () => {
    const [v16, v19] = await Promise.all([
      world("kn-b03-m1-16"),
      world("kn-b03-m1-19"),
    ])
    const outcomes = async (at: World, nineteen: boolean) => {
      const out: unknown[] = []
      for (const answer of ["yes", "no"] as const) {
        const o: SubmitOpts =
          answer === "yes"
            ? { answer, assets: [await video(at.staffA.id, at.venue)] }
            : { answer }
        const sent = nineteen
          ? await submit19(at.staffA, "step_free_entrance", o, at)
          : {
              data: await submit(at.staffA, at, "step_free_entrance", o),
              error: null,
            }
        expect(sent.error, `${answer} ${nineteen ? 19 : 16}`).toBeNull()
        const r = sent.data as Sent & { replacedOwn: string | null }
        out.push({
          answer,
          outcome: r.outcome,
          replacedOwn: r.replacedOwn !== null,
        })
      }
      return out
    }
    const sixteen = await outcomes(v16, false)
    expect(await outcomes(v19, true)).toEqual(sixteen)
    expect(sixteen.map((s) => (s as { outcome: string }).outcome)).toEqual([
      "awaiting_confirmation",
      "awaiting_confirmation",
    ])
    expect(
      JSON.parse(
        psql(
          `select private.knowledge_detail_venue_problems('${v19.venue}', 'step_free_entrance', 'no', null)`
        )
      )
    ).toEqual([])
  })
})

describe("guards", () => {
  it("keep the new functions private or signed-in only, and the reads STABLE (T9b)", () => {
    for (const fn of [
      "private.knowledge_safe_date(text)",
      "private.knowledge_place_ref_problem(jsonb)",
      "private.knowledge_detail_problems(text,jsonb)",
      "private.knowledge_detail_venue_problems(uuid,text,text,jsonb)",
      "private.knowledge_detail_venue_problems_for(uuid,text,text,jsonb,text,jsonb)",
      "private.knowledge_place_venue(uuid)",
      "private.knowledge_write_replay(uuid,uuid,text,text)",
    ])
      expect(
        psql(
          `select has_function_privilege('authenticated', '${fn}', 'execute')`
        ),
        fn
      ).toBe("f")
    for (const fn of [
      "public.knowledge_subjects(uuid)",
      "public.knowledge_subject_add(uuid,text,text,uuid)",
      "public.knowledge_subject_retire(uuid,text,uuid)",
      "public.knowledge_submit(uuid,bigint,uuid,text,text,text,text,text,text,text,text,uuid,uuid[],jsonb,boolean,boolean,jsonb,date,text)",
    ]) {
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute')`),
        fn
      ).toBe("f")
      expect(
        psql(
          `select has_function_privilege('authenticated', '${fn}', 'execute')`
        ),
        fn
      ).toBe("t")
    }
    expect(
      psql(`select provolatile::text || prosecdef::text from pg_proc
        where oid = 'public.knowledge_subjects(uuid)'::regprocedure`)
    ).toBe("strue")
  })

  it("leave the credit function and both evidence triggers byte-identical", () => {
    expect(
      psql(`select md5(pg_get_functiondef(
        'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`)
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
    expect(
      psql(`select string_agg(md5(pg_get_functiondef(t.tgfoid)), ',' order by t.tgname)
        from pg_trigger t where t.tgname in
          ('media_assets_amenity_evidence_lost', 'media_assets_knowledge_evidence_withdrawn')`)
    ).toBe("6c156e9d55c5058e331d904cb6b6eca7,af720155bd3b5945954060520619f7d0")
  })

  it("keeps service-role writes out of the places table too", async () => {
    const { error } = await service
      .from("knowledge_subjects" as never)
      .delete()
      .eq("venue_id", w.venue)
    expect(error).not.toBeNull()
  })
})
