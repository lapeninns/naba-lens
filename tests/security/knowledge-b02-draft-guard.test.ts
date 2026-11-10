// The draft-save guard and the caller's latest send (docs/knowledge/
// b02-design.md R11). Every write runs as a signed-in identity through
// PostgREST; the service role and psql only build fixtures and read state back.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { ok, psql } from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  json,
  refused,
  sessionAs,
  sleep,
  submitArgs,
  world,
  yes,
  type SubmitOpts,
  type World,
} from "./knowledge-fixtures"

type Who = World["staffA"]
type Saved = { draftRevision: number; savedAt: string }
type Sent = { contributionId: string; replayed: boolean; sentAt: string }
type AlreadySent = { reason: "key_sent" | "newer_send"; sentAt: string }

const Q = "guest_toilets"

function saveArgs(
  v: World,
  key: string | null,
  base: string | null,
  draftRevision: number | null = null
) {
  return {
    p_check_id: v.checks[Q],
    p_draft_revision: draftRevision,
    p_payload: { answer: "no" },
    p_asset_ids: [],
    p_idempotency_key: key,
    p_base_sent_at: base,
  }
}

const save = (
  who: Who,
  v: World,
  key: string | null,
  base: string | null,
  draftRevision: number | null = null
) =>
  json<Saved>(
    who,
    "knowledge_save_draft",
    saveArgs(v, key, base, draftRevision)
  )

/** The 5-argument signature, which has no base. */
function saveOld(who: Who, v: World, key: string | null) {
  return call(who, "knowledge_save_draft", {
    p_check_id: v.checks[Q],
    p_draft_revision: null,
    p_payload: { answer: "no" },
    p_asset_ids: [],
    p_idempotency_key: key,
  })
}

async function alreadySent(
  who: Who,
  fn: string,
  args: object
): Promise<AlreadySent> {
  const e = await refused(who, fn, args, "draft_already_sent", "NLK09")
  return JSON.parse(e.details!) as AlreadySent
}

const send = (who: Who, v: World, o: SubmitOpts = {}) =>
  json<Sent>(
    who,
    "knowledge_submit",
    submitArgs(v, Q, { answer: "unknown", ...o })
  )

async function mySentAt(who: Who, v: World, key = Q) {
  return (
    await json<{ mySentAt: string | null }>(who, "knowledge_check", {
      p_check_id: v.checks[key],
    })
  ).mySentAt
}

const drafts = (who: Who, v: World) =>
  count(
    `select count(*) from public.knowledge_drafts where user_id = '${who.id}' and check_id = '${v.checks[Q]}'`
  )

/** Compares two database times to the microsecond, whatever their format. */
function sameTime(a: string | null, b: string | null) {
  expect(a).not.toBeNull()
  expect(b).not.toBeNull()
  expect(psql(`select '${a}'::timestamptz = '${b}'::timestamptz`)).toBe("t")
}

describe("a late save after a send (R11 L-b)", () => {
  it("is refused as newer_send and leaves no draft", async () => {
    const v = await world("kn-guard-lb")
    const draftKey = randomUUID()
    expect((await save(v.staffA, v, draftKey, null)).draftRevision).toBe(1)
    const sent = await send(v.staffA, v, { key: randomUUID() })
    expect(drafts(v.staffA, v)).toBe(0)
    const d = await alreadySent(
      v.staffA,
      "knowledge_save_draft",
      saveArgs(v, draftKey, null)
    )
    expect(d.reason).toBe("newer_send")
    sameTime(d.sentAt, sent.sentAt)
    expect(drafts(v.staffA, v)).toBe(0)
  })

  it("answers draft_already_sent before draft_conflict", async () => {
    const v = await world("kn-guard-order")
    const draftKey = randomUUID()
    await save(v.staffA, v, draftKey, null)
    await send(v.staffA, v)
    for (const stale of [1, 7]) {
      const d = await alreadySent(
        v.staffA,
        "knowledge_save_draft",
        saveArgs(v, draftKey, null, stale)
      )
      expect(d.reason).toBe("newer_send")
    }
    expect(drafts(v.staffA, v)).toBe(0)
  })
})

describe("a save carrying the send's own key (R11 key_sent)", () => {
  it("is refused through both signatures; the old one checks nothing else", async () => {
    const v = await world("kn-guard-key")
    const key = randomUUID()
    await save(v.staffA, v, key, null)
    const sent = await send(v.staffA, v, { key })
    const d = await alreadySent(
      v.staffA,
      "knowledge_save_draft",
      saveArgs(v, key, sent.sentAt)
    )
    expect(d.reason).toBe("key_sent")
    sameTime(d.sentAt, sent.sentAt)

    const { error } = await saveOld(v.staffA, v, key)
    expect(error).toMatchObject({
      message: "draft_already_sent",
      code: "NLK09",
    })
    expect(JSON.parse(error!.details!)).toMatchObject({ reason: "key_sent" })
    expect(drafts(v.staffA, v)).toBe(0)

    // No base on the old signature, so a newer send does not stop it.
    const old = await saveOld(v.staffA, v, randomUUID())
    expect(old.error).toBeNull()
    expect((old.data as Saved).draftRevision).toBe(1)
  })
})

describe("starting again after a send (R11)", () => {
  it("allows a new draft based on the send's sentAt", async () => {
    const v = await world("kn-guard-new")
    const sent = await send(v.staffA, v)
    expect(sent.replayed).toBe(false)
    const first = await save(v.staffA, v, randomUUID(), sent.sentAt)
    expect(first.draftRevision).toBe(1)
    const second = await save(v.staffA, v, randomUUID(), sent.sentAt, 1)
    expect(second.draftRevision).toBe(2)
  })

  it("counts equal times as not newer", async () => {
    const v = await world("kn-guard-equal")
    const sent = await send(v.staffA, v)
    const earlier = psql(
      `select to_jsonb('${sent.sentAt}'::timestamptz - interval '1 microsecond') #>> '{}'`
    )
    const d = await alreadySent(
      v.staffA,
      "knowledge_save_draft",
      saveArgs(v, randomUUID(), earlier)
    )
    expect(d.reason).toBe("newer_send")
    sameTime(d.sentAt, sent.sentAt)
    expect(
      (await save(v.staffA, v, randomUUID(), sent.sentAt)).draftRevision
    ).toBe(1)
  })

  it("refuses the other device's form with that send's time, then allows a retry from it", async () => {
    const v = await world("kn-guard-device")
    const deviceKey = randomUUID()
    await save(v.staffA, v, deviceKey, null)
    // The second device sends with its own key.
    const sent = await send(v.staffA, v, { key: randomUUID() })
    const d = await alreadySent(
      v.staffA,
      "knowledge_save_draft",
      saveArgs(v, deviceKey, null, 1)
    )
    expect(d.reason).toBe("newer_send")
    sameTime(d.sentAt, sent.sentAt)
    const retry = await save(v.staffA, v, randomUUID(), d.sentAt)
    expect(retry.draftRevision).toBe(1)
  })

  it("is not blocked by a colleague's send", async () => {
    const v = await world("kn-guard-others")
    await send(v.staffB, v)
    expect(await mySentAt(v.staffA, v)).toBeNull()
    expect((await save(v.staffA, v, randomUUID(), null)).draftRevision).toBe(1)
  })
})

describe("what counts as a send (R11)", () => {
  it("counts a legacy answer, whose time is a base for a new draft", async () => {
    const v = await world("kn-guard-legacy")
    const check = v.checks[Q]!
    await json(v.admin, "knowledge_set_working_list", {
      p_venue_id: v.venue,
      p_keys: [Q],
      p_enabled: false,
      p_reason: "TEST",
    })
    const revision = () =>
      count(
        `select revision from public.venue_amenity_checks where id = '${check}'`
      )
    await ok(
      call(v.manager, "amenity_assign_check", {
        p_check_id: check,
        p_assignee_id: v.staffA.id,
        p_revision: revision(),
      })
    )
    await ok(
      call(v.staffA, "amenity_submit_finding", {
        p_check_id: check,
        p_revision: revision(),
        p_idempotency_key: randomUUID(),
        p_answer: "no",
        p_finding: null,
        p_limitations: null,
        p_reason: "TEST none here",
        p_asset_ids: [],
        p_internal_metadata: null,
        p_redaction_confirmed: false,
      })
    )
    const legacyAt = psql(
      `select to_jsonb(created_at) #>> '{}' from public.amenity_submissions where check_id = '${check}' and submitted_by = '${v.staffA.id}' and source_contribution_id is null`
    )
    sameTime(await mySentAt(v.staffA, v), legacyAt)
    const d = await alreadySent(
      v.staffA,
      "knowledge_save_draft",
      saveArgs(v, randomUUID(), null)
    )
    expect(d.reason).toBe("newer_send")
    sameTime(d.sentAt, legacyAt)
    expect(
      (await save(v.staffA, v, randomUUID(), legacyAt)).draftRevision
    ).toBe(1)
  })

  it("does not count a manager adopting the person's proposal (M2)", async () => {
    const v = await world("kn-guard-adopt")
    const key = "step_free_entrance"
    const check = v.checks[key]!
    const proposal = (await yes(v.staffA, v, key)) as Awaited<
      ReturnType<typeof yes>
    > & { sentAt: string }
    expect(proposal.outcome).toBe("awaiting_confirmation")
    const adopted = (await ok(
      decide(
        v.manager,
        v,
        key,
        { type: "contribution", id: proposal.contributionId },
        "confirm"
      )
    )) as { submissionId: string }
    expect(
      JSON.parse(
        psql(
          `select row_to_json(s) from (select submitted_by, source_contribution_id from public.amenity_submissions where id = '${adopted.submissionId}') s`
        )
      )
    ).toEqual({
      submitted_by: v.staffA.id,
      source_contribution_id: proposal.contributionId,
    })
    // The adoption's row is newer than the proposal, so only its exclusion
    // keeps mySentAt at the proposal's time.
    expect(
      psql(
        `select s.created_at > x.created_at from public.amenity_submissions s, public.knowledge_contributions x where s.id = '${adopted.submissionId}' and x.id = '${proposal.contributionId}'`
      )
    ).toBe("t")
    sameTime(await mySentAt(v.staffA, v, key), proposal.sentAt)
    const saved = await json<Saved>(v.staffA, "knowledge_save_draft", {
      p_check_id: check,
      p_draft_revision: null,
      p_payload: { answer: "yes" },
      p_asset_ids: [],
      p_idempotency_key: randomUUID(),
      p_base_sent_at: proposal.sentAt,
    })
    expect(saved.draftRevision).toBe(1)
  })
})

describe("mySentAt and sentAt (R11)", () => {
  it("shows only the caller's own newest send", async () => {
    const v = await world("kn-guard-mine")
    expect(await mySentAt(v.staffA, v)).toBeNull()
    const first = await send(v.staffA, v)
    sameTime(await mySentAt(v.staffA, v), first.sentAt)
    const other = await send(v.staffB, v)
    sameTime(await mySentAt(v.staffA, v), first.sentAt)
    sameTime(await mySentAt(v.staffB, v), other.sentAt)
    const second = await send(v.staffA, v, { answer: "no" })
    expect(
      psql(
        `select '${second.sentAt}'::timestamptz > '${first.sentAt}'::timestamptz`
      )
    ).toBe("t")
    sameTime(await mySentAt(v.staffA, v), second.sentAt)
    sameTime(await mySentAt(v.staffB, v), other.sentAt)
  })

  it("returns the contribution's time on a replayed send too", async () => {
    const v = await world("kn-guard-replay")
    const args = submitArgs(v, Q, { answer: "unknown", key: randomUUID() })
    const first = await json<Sent>(v.staffA, "knowledge_submit", args)
    const again = await json<Sent>(v.staffA, "knowledge_submit", args)
    expect(first.replayed).toBe(false)
    expect(again).toMatchObject({
      contributionId: first.contributionId,
      replayed: true,
      sentAt: first.sentAt,
    })
    sameTime(
      again.sentAt,
      psql(
        `select to_jsonb(created_at) #>> '{}' from public.knowledge_contributions where id = '${first.contributionId}'`
      )
    )
    sameTime(await mySentAt(v.staffA, v), first.sentAt)
  })
})

function submitSql(args: Record<string, unknown>) {
  const lit = (v: unknown) =>
    v === null || v === undefined
      ? "null"
      : Array.isArray(v)
        ? v.length
          ? `array['${v.join("','")}']::uuid[]`
          : "'{}'::uuid[]"
        : typeof v === "boolean" || typeof v === "number"
          ? String(v)
          : typeof v === "object"
            ? `'${JSON.stringify(v)}'::jsonb`
            : `'${String(v).replace(/'/g, "''")}'`
  const order = [
    "p_check_id",
    "p_slot_revision",
    "p_idempotency_key",
    "p_kind",
    "p_answer",
    "p_finding",
    "p_limitations",
    "p_reason",
    "p_unknown_preset",
    "p_tried_text",
    "p_change_reason",
    "p_responds_to",
    "p_asset_ids",
    "p_internal_metadata",
    "p_redaction_confirmed",
    "p_confirm_own",
  ]
  return `select public.knowledge_submit(${order.map((k) => lit(args[k])).join(", ")});`
}

describe("a save overlapping a send (R11, two sessions)", () => {
  it("waits for the send's check lock, then is refused newer_send", async () => {
    const v = await world("kn-guard-overlap")
    // The form loaded before any send, so its base is null.
    await save(v.staffA, v, randomUUID(), null)
    const args = submitArgs(v, Q, { answer: "unknown", key: randomUUID() })
    // The send holds the check row FOR UPDATE until it commits.
    const sending = sessionAs(
      v.staffA.id,
      `${submitSql(args)}\nselect pg_sleep(1.5);`
    )
    await sleep(400)
    const started = Date.now()
    const late = await call(
      v.staffA,
      "knowledge_save_draft",
      saveArgs(v, randomUUID(), null, 1)
    )
    const waited = Date.now() - started
    const sent = await sending
    expect(sent.code, sent.err).toBe(0)
    expect(waited).toBeGreaterThan(700)
    expect(late.error?.message).toBe("draft_already_sent")
    expect(late.error?.code).toBe("NLK09")
    const detail = JSON.parse(late.error!.details!) as AlreadySent
    expect(detail.reason).toBe("newer_send")
    sameTime(
      detail.sentAt,
      psql(
        `select to_jsonb(created_at) #>> '{}' from public.knowledge_contributions where idempotency_key = '${args.p_idempotency_key}'`
      )
    )
    // The send deleted the draft and the late save wrote nothing.
    expect(
      count(
        `select count(*) from public.knowledge_drafts where user_id = '${v.staffA.id}' and check_id = '${v.checks[Q]}'`
      )
    ).toBe(0)
  })
})
