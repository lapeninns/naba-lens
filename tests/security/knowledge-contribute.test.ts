// Knowledge contributions (docs/knowledge/b01-design.md §4, §8, §9.3, §11, §17
// T1 to T4, T7, T12, T13). Every write runs as a signed-in identity through
// knowledge_submit; the service role and psql only build fixtures and read
// state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { anonClient, createIdentity, createVenue } from "../support/identities"
import { insertAsset, ok, psql } from "./coverage-fixtures"
import {
  call,
  count,
  json,
  photo,
  refused,
  service,
  slot,
  slotRevision,
  submit,
  submitArgs,
  video,
  wifiNotes,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

let w: World

beforeAll(async () => {
  w = await world("kn-contrib", { extra: ["darts"] })
})

function submissions(check: string) {
  return count(
    `select count(*) from public.amenity_submissions where check_id = '${check}'`
  )
}
function checkEvents(check: string, kind: string) {
  return count(
    `select count(*) from public.amenity_check_events where check_id = '${check}' and kind = '${kind}'`
  )
}

describe("who may contribute (T1)", () => {
  it("lets unassigned staff answer an open confirmation-free slot, which becomes current", async () => {
    const before = submissions(w.checks.onsite_parking!)
    const r = await yes(w.staffA, w, "onsite_parking", {
      limitations: "TEST two bays",
    })
    expect(r.outcome).toBe("current")
    expect(r.submissionId).not.toBeNull()
    expect(submissions(w.checks.onsite_parking!)).toBe(before + 1)
    const row = JSON.parse(
      psql(
        `select row_to_json(s) from public.amenity_submissions s where s.id = '${r.submissionId}'`
      )
    )
    expect(row).toMatchObject({
      submitted_by: w.staffA.id,
      source_contribution_id: r.contributionId,
      submitter_basis: "staff",
      answer: "yes",
    })
    const s = slot(w.venue, "onsite_parking")
    expect(s).toMatchObject({
      status: "available",
      value: "yes",
      contribution_kind: "contribution",
      current_contribution_id: r.contributionId,
      source_basis: "staff",
      limitations: "TEST two bays",
      observed_at: null,
    })
  })

  it("refuses staff of another venue, including a venue with a similar name (V02)", async () => {
    const twin = await world("kn-contrib", {})
    await refused(
      twin.staffA,
      "knowledge_submit",
      submitArgs(w, "guest_toilets", { answer: "no" }),
      "amenity_check_not_found",
      "P0002"
    )
    // The same question at the two venues keeps its own answer.
    await submit(twin.staffA, twin, "guest_toilets", { answer: "no" })
    expect(slot(w.venue, "guest_toilets").current_answer).not.toBe("no")
    expect(slot(twin.venue, "guest_toilets").current_answer).toBe("no")
  })

  it("refuses a slot that is not on the working list", async () => {
    await refused(
      w.staffA,
      "knowledge_submit",
      submitArgs(w, "darts", { answer: "no" }),
      "knowledge_slot_out_of_scope",
      "NLK02"
    )
  })

  it("applies the role matrix (V01)", async () => {
    const anon = { client: anonClient() }
    const { error: anonError } = await call(
      anon,
      "knowledge_submit",
      submitArgs(w, "guest_toilets", { answer: "no" })
    )
    expect(anonError).not.toBeNull()
    const gone = await createIdentity(service, {
      label: "kn-contrib-gone",
      role: "staff",
      venueId: w.venue,
      active: false,
    })
    await refused(
      gone,
      "knowledge_submit",
      submitArgs(w, "guest_toilets", { answer: "no" }),
      "not_active_user"
    )
    const { error: serviceError } = await call(
      { client: service },
      "knowledge_submit",
      submitArgs(w, "guest_toilets", { answer: "no" })
    )
    expect(serviceError?.code).toBe("42501")

    const fresh = await world("kn-roles")
    const viaManager = await submit(fresh.manager, fresh, "guest_toilets", {
      answer: "no",
    })
    expect(viaManager.outcome).toBe("current")
    expect(slot(fresh.venue, "guest_toilets").source_basis).toBe(
      "venue_manager"
    )
    const viaStaffManager = await submit(
      fresh.staffManager,
      fresh,
      "onsite_parking",
      { answer: "no" }
    )
    expect(viaStaffManager.outcome).toBe("current")
    expect(slot(fresh.venue, "onsite_parking").source_basis).toBe(
      "venue_manager"
    )
    const viaAdmin = await submit(fresh.admin, fresh, "guest_wifi", {
      answer: "no",
    })
    expect(viaAdmin.outcome).toBe("current")
    expect(slot(fresh.venue, "guest_wifi").source_basis).toBe("admin")
  })
})

describe("evidence and conditions (T2)", () => {
  it("needs the rule's evidence for Yes", async () => {
    const v = await world("kn-evidence")
    await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "step_free_entrance", {
        assets: [await photo(v.staffA.id, v.venue)],
      }),
      "evidence_rule_unmet"
    )
    await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_wifi", {
        assets: [await photo(v.staffA.id, v.venue)],
        metadata: wifiNotes(),
        redaction: true,
      }),
      "evidence_rule_unmet"
    )
  })

  it("stores the Wi-Fi redaction tick and refuses a photo without it", async () => {
    const v = await world("kn-wifi")
    await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_wifi", {
        assets: [
          await photo(v.staffA.id, v.venue),
          await video(v.staffA.id, v.venue),
        ],
        metadata: wifiNotes(),
        redaction: false,
      }),
      "redaction_not_confirmed"
    )
    const r = await yes(v.staffA, v, "guest_wifi")
    expect(r.outcome).toBe("current")
    expect(
      psql(
        `select redaction_confirmed from public.amenity_submissions where id = '${r.submissionId}'`
      )
    ).toBe("t")
    expect(slot(v.venue, "guest_wifi")).toMatchObject({
      redaction_proof: "recorded",
      finding: null,
    })
  })

  it("reports a Wi-Fi answer saved before the tick was stored as not recorded", async () => {
    const v = await world("kn-wifi-old", { enable: false })
    const assets = [
      await photo(v.staffManager.id, v.venue),
      await video(v.staffManager.id, v.venue),
    ]
    const revision = count(
      `select revision from public.venue_amenity_checks where id = '${v.checks.guest_wifi}'`
    )
    const [row] = (await ok(
      v.staffManager.client.rpc("amenity_submit_finding", {
        p_check_id: v.checks.guest_wifi!,
        p_revision: revision,
        p_idempotency_key: randomUUID(),
        p_answer: "yes",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: null as unknown as string,
        p_asset_ids: assets,
        p_internal_metadata: wifiNotes(),
        p_redaction_confirmed: true,
      })
    )) as { submission_id: string }[]
    // A row as saved before B01 stored the tick.
    psql(`set session_replication_role = replica;
      update public.amenity_submissions set redaction_confirmed = null where id = '${row!.submission_id}';`)
    await json(v.admin, "knowledge_set_working_list", {
      p_venue_id: v.venue,
      p_keys: ["guest_wifi"],
      p_enabled: true,
      p_reason: "TEST",
    })
    expect(slot(v.venue, "guest_wifi")).toMatchObject({
      status: "available",
      redaction_proof: "not_recorded",
      contribution_kind: "submission",
      source_basis: "venue_manager",
    })
  })

  it("refuses another person's or another venue's evidence", async () => {
    const v = await world("kn-assets")
    const other = await createVenue(service, "kn-assets-other")
    const notMine = await photo(v.staffB.id, v.venue)
    const elsewhere = await photo(v.staffA.id, other.id)
    const e1 = await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_toilets", { assets: [notMine] }),
      "evidence_not_eligible"
    )
    expect(JSON.parse(e1.details!)).toMatchObject({ reason: "not_own" })
    const e2 = await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_toilets", { assets: [elsewhere] }),
      "evidence_not_eligible"
    )
    expect(JSON.parse(e2.details!)).toMatchObject({ reason: "not_found" })
  })
})

describe("drafts (T3)", () => {
  it("saves, reads and discards an owner-only draft with a revision check", async () => {
    const v = await world("kn-drafts")
    const check = v.checks.guest_toilets!
    const first = await json<{ draftRevision: number }>(
      v.staffA,
      "knowledge_save_draft",
      {
        p_check_id: check,
        p_draft_revision: null,
        p_payload: { answer: "yes" },
        p_asset_ids: [],
        p_idempotency_key: randomUUID(),
      }
    )
    expect(first.draftRevision).toBe(1)
    await refused(
      v.staffA,
      "knowledge_save_draft",
      {
        p_check_id: check,
        p_draft_revision: null,
        p_payload: {},
        p_asset_ids: [],
        p_idempotency_key: null,
      },
      "draft_conflict",
      "NLK05"
    )
    const second = await json<{ draftRevision: number }>(
      v.staffA,
      "knowledge_save_draft",
      {
        p_check_id: check,
        p_draft_revision: 1,
        p_payload: { answer: "no" },
        p_asset_ids: [],
        p_idempotency_key: null,
      }
    )
    expect(second.draftRevision).toBe(2)
    const mine = await json<{ payload: { answer: string } }>(
      v.staffA,
      "knowledge_get_draft",
      { p_check_id: check }
    )
    expect(mine.payload.answer).toBe("no")
    expect(
      await json(v.staffB, "knowledge_get_draft", { p_check_id: check })
    ).toBeNull()
    expect(
      await json(v.staffA, "knowledge_discard_draft", { p_check_id: check })
    ).toBe(true)
    expect(
      await json(v.staffA, "knowledge_get_draft", { p_check_id: check })
    ).toBeNull()
  })

  it("refuses evidence that is not ready", async () => {
    const v = await world("kn-notready")
    const pending = (
      await insertAsset(service, {
        uploader: v.staffA.id,
        venue: v.venue,
        ready: false,
      })
    ).id
    const e = await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_toilets", { assets: [pending] }),
      "evidence_not_eligible"
    )
    expect(JSON.parse(e.details!)).toMatchObject({ reason: "not_ready" })
  })

  it("replays a draft finished on a second device with the same key, and deletes the draft", async () => {
    const v = await world("kn-draftkey")
    const key = randomUUID()
    await json(v.staffA, "knowledge_save_draft", {
      p_check_id: v.checks.guest_toilets!,
      p_draft_revision: null,
      p_payload: { answer: "no" },
      p_asset_ids: [],
      p_idempotency_key: key,
    })
    const args = submitArgs(v, "guest_toilets", { answer: "no", key })
    const first = await json<{ contributionId: string; replayed: boolean }>(
      v.staffA,
      "knowledge_submit",
      args
    )
    const again = await json<{ contributionId: string; replayed: boolean }>(
      v.staffA,
      "knowledge_submit",
      args
    )
    expect(again).toMatchObject({
      contributionId: first.contributionId,
      replayed: true,
    })
    expect(
      await json(v.staffA, "knowledge_get_draft", {
        p_check_id: v.checks.guest_toilets!,
      })
    ).toBeNull()
  })
})

describe("a send settles the sender's draft (CA-01)", () => {
  const saveDraft = (v: World, who: World["staffA"], key: string) =>
    json(who, "knowledge_save_draft", {
      p_check_id: v.checks.guest_toilets!,
      p_draft_revision: null,
      p_payload: { answer: "no" },
      p_asset_ids: [],
      p_idempotency_key: key,
    })
  const draftOf = (who: World["staffA"], check: string) =>
    json(who, "knowledge_get_draft", { p_check_id: check })

  it("deletes the sender's draft whatever key it carried, and nobody else's", async () => {
    const v = await world("kn-draft-newkey")
    const check = v.checks.guest_toilets!
    await saveDraft(v, v.staffA, randomUUID())
    await saveDraft(v, v.staffB, randomUUID())
    const sent = await submit(v.staffA, v, "guest_toilets", {
      answer: "unknown",
      key: randomUUID(),
    })
    expect(sent.replayed).toBe(false)
    expect(await draftOf(v.staffA, check)).toBeNull()
    expect(await draftOf(v.staffB, check)).not.toBeNull()
  })

  it("keeps the draft when the send is refused", async () => {
    const v = await world("kn-draft-refused")
    const check = v.checks.guest_toilets!
    await saveDraft(v, v.staffA, randomUUID())
    await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_toilets", { answer: "no", revision: 999 }),
      "amenity_conflict"
    )
    expect(await draftOf(v.staffA, check)).not.toBeNull()
  })

  it("is settled by a legacy answer after the question leaves the working list", async () => {
    const v = await world("kn-draft-legacy")
    const check = v.checks.guest_toilets!
    await saveDraft(v, v.staffA, randomUUID())
    await json(v.admin, "knowledge_set_working_list", {
      p_venue_id: v.venue,
      p_keys: ["guest_toilets"],
      p_enabled: false,
      p_reason: "TEST",
    })
    const revision = () =>
      count(
        `select revision from public.venue_amenity_checks where id = '${check}'`
      )
    await ok(
      v.manager.client.rpc("amenity_assign_check", {
        p_check_id: check,
        p_assignee_id: v.staffA.id,
        p_revision: revision(),
      })
    )
    await ok(
      v.staffA.client.rpc("amenity_submit_finding", {
        p_check_id: check,
        p_revision: revision(),
        p_idempotency_key: randomUUID(),
        p_answer: "no",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: "TEST none here",
        p_asset_ids: [],
        p_internal_metadata: null,
        p_redaction_confirmed: false,
      })
    )
    expect(await draftOf(v.staffA, check)).toBeNull()
  })
})

describe("idempotency and the slot revision (T4)", () => {
  it("records one contribution, submission and event for a key sent three times", async () => {
    const v = await world("kn-replay")
    const args = submitArgs(v, "guest_toilets", { answer: "no" })
    const results = []
    for (let i = 0; i < 3; i++)
      results.push(
        await json<{ contributionId: string; replayed: boolean }>(
          v.staffA,
          "knowledge_submit",
          args
        )
      )
    expect(results.map((r) => r.replayed)).toEqual([false, true, true])
    expect(new Set(results.map((r) => r.contributionId)).size).toBe(1)
    expect(submissions(v.checks.guest_toilets!)).toBe(1)
    expect(checkEvents(v.checks.guest_toilets!, "submitted")).toBe(1)
  })

  it("refuses a reused key with any different argument", async () => {
    const v = await world("kn-reuse")
    const args = submitArgs(v, "guest_toilets", { answer: "no" })
    await json(v.staffA, "knowledge_submit", args)
    for (const change of [
      { p_reason: "TEST different" },
      { p_confirm_own: true },
      { p_slot_revision: args.p_slot_revision + 1 },
    ]) {
      await refused(
        v.staffA,
        "knowledge_submit",
        { ...args, ...change },
        "idempotency_key_reused"
      )
    }
    await refused(v.staffB, "knowledge_submit", args, "idempotency_key_reused")
  })

  it("records one row for concurrent sends with one key", async () => {
    const v = await world("kn-concurrent")
    const args = submitArgs(v, "guest_toilets", { answer: "no" })
    const results = await Promise.all(
      [1, 2, 3].map(() => call(v.staffA, "knowledge_submit", args))
    )
    expect(results.every((r) => r.error === null)).toBe(true)
    expect(
      count(
        `select count(*) from public.knowledge_contributions where idempotency_key = '${args.p_idempotency_key}'`
      )
    ).toBe(1)
    expect(submissions(v.checks.guest_toilets!)).toBe(1)
  })

  it("refuses a stale slot revision and records nothing (G4)", async () => {
    const v = await world("kn-stale")
    const stale = slotRevision(v.venue, "guest_toilets")
    // Someone else's Couldn't establish adds a knowledge event; the check revision is unchanged.
    const checkRevision = count(
      `select revision from public.venue_amenity_checks where id = '${v.checks.guest_toilets}'`
    )
    await submit(v.staffB, v, "guest_toilets", { answer: "unknown" })
    expect(
      count(
        `select revision from public.venue_amenity_checks where id = '${v.checks.guest_toilets}'`
      )
    ).toBe(checkRevision)
    const before = count(
      `select count(*) from public.knowledge_contributions where check_id = '${v.checks.guest_toilets}'`
    )
    const e = await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_toilets", { answer: "no", revision: stale }),
      "amenity_conflict"
    )
    expect(JSON.parse(e.details!).revision).toBe(stale + 1)
    expect(
      count(
        `select count(*) from public.knowledge_contributions where check_id = '${v.checks.guest_toilets}'`
      )
    ).toBe(before)
  })
})

describe("Couldn't establish (T7)", () => {
  it("records Unknown with no submission, no check event and no credit path", async () => {
    const v = await world("kn-unknown")
    const r = await submit(v.staffA, v, "guest_toilets", {
      answer: "unknown",
      preset: "could_not_access",
    })
    expect(r.outcome).toBe("recorded")
    expect(r.submissionId).toBeNull()
    expect(submissions(v.checks.guest_toilets!)).toBe(0)
    expect(
      count(
        `select count(*) from public.amenity_check_events where check_id = '${v.checks.guest_toilets}' and kind <> 'added'`
      )
    ).toBe(0)
    expect(slot(v.venue, "guest_toilets")).toMatchObject({
      status: "unavailable",
      reason: "unknown",
      detail: "unable_to_establish",
    })
    await refused(
      v.staffA,
      "knowledge_submit",
      submitArgs(v, "guest_toilets", { answer: "unknown", tried: null }),
      "tried_text_required"
    )
  })

  it("can never be adopted, and the submission table refuses it", async () => {
    const v = await world("kn-unknown-adopt")
    const r = await submit(v.staffA, v, "guest_toilets", { answer: "unknown" })
    const { error } = await call(v.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: r.contributionId,
      p_decision: "confirm",
      p_slot_revision: slotRevision(v.venue, "guest_toilets"),
      p_idempotency_key: randomUUID(),
      p_note: null,
    })
    expect(error).toMatchObject({
      message: "knowledge_not_adoptable",
      code: "NLK07",
    })
    expect(() =>
      psql(`insert into public.amenity_submissions (check_id, venue_id, submitted_by, answer, template_version,
        evidence_rule, idempotency_key, result_revision)
        values ('${v.checks.guest_toilets}', '${v.venue}', '${v.staffA.id}', 'unknown', 1, 'photo', gen_random_uuid(), 2)`)
    ).toThrow(/amenity_submissions_answer_check/)
  })

  it("is marked as seen by a manager", async () => {
    const v = await world("kn-seen")
    const r = await submit(v.staffA, v, "guest_toilets", { answer: "unknown" })
    await json(v.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: r.contributionId,
      p_decision: "seen",
      p_slot_revision: slotRevision(v.venue, "guest_toilets"),
      p_idempotency_key: randomUUID(),
      p_note: null,
    })
    expect(
      count(
        `select count(*) from public.knowledge_decisions where contribution_id = '${r.contributionId}' and decision = 'seen'`
      )
    ).toBe(1)
  })

  it("is not changed by a legacy fact marked unknown", async () => {
    const v = await world("kn-legacy")
    psql(
      `insert into public.venue_amenity_facts (venue_id, amenity_key, presence) values ('${v.venue}', 'toilets', 'unknown')`
    )
    expect(slot(v.venue, "guest_toilets")).toMatchObject({
      reason: "unknown",
      detail: "not_checked",
    })
    psql(
      `update public.venue_amenity_facts set presence = 'present', revision = revision + 1 where venue_id = '${v.venue}' and amenity_key = 'toilets'`
    )
    expect(slot(v.venue, "guest_toilets")).toMatchObject({
      reason: "unknown",
      detail: "not_checked",
    })
  })
})

describe("one undecided finding per person and no silent overwrite (§4.2, §9.3)", () => {
  it("makes a staff finding a proposal when an answer is current, and replaces the person's own earlier one", async () => {
    const v = await world("kn-proposal")
    await submit(v.staffA, v, "guest_toilets", { answer: "no" })
    const first = await submit(v.staffB, v, "guest_toilets", {
      kind: "change_report",
      answer: "yes",
      assets: [await photo(v.staffB.id, v.venue)],
    })
    expect(first.outcome).toBe("awaiting_confirmation")
    expect(slot(v.venue, "guest_toilets").current_answer).toBe("no")
    const second = await submit(v.staffB, v, "guest_toilets", {
      kind: "change_report",
      answer: "not_applicable",
    })
    expect(second.replacedOwn).toBe(first.contributionId)
    expect(slot(v.venue, "guest_toilets").pending_count).toBe(1)
  })

  it("makes a finding on a slot assigned to someone else a proposal", async () => {
    const v = await world("kn-assigned")
    const check = v.checks.onsite_parking!
    await ok(
      v.manager.client.rpc("amenity_assign_check", {
        p_check_id: check,
        p_assignee_id: v.staffA.id,
        p_revision: count(
          `select revision from public.venue_amenity_checks where id = '${check}'`
        ),
      })
    )
    const r = await submit(v.staffB, v, "onsite_parking", { answer: "no" })
    expect(r.outcome).toBe("awaiting_confirmation")
    expect(
      psql(
        `select assignee_user_id from public.venue_amenity_checks where id = '${check}'`
      )
    ).toBe(v.staffA.id)
    expect(submissions(check)).toBe(0)
  })
})

describe("assignee visibility (T12)", () => {
  it("records and shows a closed assignment, which the assignee can dismiss", async () => {
    const v = await world("kn-closed")
    const check = v.checks.guest_toilets!
    await ok(
      v.manager.client.rpc("amenity_assign_check", {
        p_check_id: check,
        p_assignee_id: v.staffA.id,
        p_revision: count(
          `select revision from public.venue_amenity_checks where id = '${check}'`
        ),
      })
    )
    await submit(v.manager, v, "guest_toilets", { answer: "no" })
    const list = await json<{
      items: {
        questionKey: string
        closedAssignment: { eventId: number } | null
      }[]
    }>(v.staffA, "knowledge_working_list")
    const row = list.items.find((i) => i.questionKey === "guest_toilets")!
    expect(row.closedAssignment).not.toBeNull()
    expect(
      await json(v.staffB, "knowledge_dismiss_outcome", {
        p_event_id: row.closedAssignment!.eventId,
      })
    ).toBe(false)
    expect(
      await json(v.staffA, "knowledge_dismiss_outcome", {
        p_event_id: row.closedAssignment!.eventId,
      })
    ).toBe(true)
    const after = await json<{
      items: { questionKey: string; closedAssignment: unknown }[]
    }>(v.staffA, "knowledge_working_list")
    expect(
      after.items.find((i) => i.questionKey === "guest_toilets")!
        .closedAssignment
    ).toBeNull()
  })
})

describe("append-only (T13)", () => {
  it("refuses UPDATE and DELETE on the knowledge history tables", async () => {
    const v = await world("kn-append")
    const r = await submit(v.staffA, v, "guest_toilets", { answer: "unknown" })
    for (const sql of [
      `update public.knowledge_contributions set finding = 'x' where id = '${r.contributionId}'`,
      `delete from public.knowledge_contributions where id = '${r.contributionId}'`,
      `delete from public.knowledge_events where contribution_id = '${r.contributionId}'`,
      `update public.knowledge_question_rules set confirmation = 'none'`,
      `delete from public.knowledge_commands`,
    ]) {
      expect(() => psql(sql)).toThrow(/append|immutable|42501/i)
    }
  })
})
