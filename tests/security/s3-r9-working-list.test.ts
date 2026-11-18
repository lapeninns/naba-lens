// S3-R9: regression tests for W5 / the D4 gap in the Sprint 3 repair review
// (docs/plans/full-app-v1/reviews/S3-repair-review.md). A question a manager
// adds at a venue on the knowledge layer joins the venue's working list, so a
// pool table Yes with a photo has a counted Facilities slot with no admin
// step; the venue template brings an active check that was never on the list
// into coverage. Fixed in supabase/migrations/20261118127000. Real signed-in
// identities through PostgREST; psql (as the owner) only reads state.
import { describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  json,
  refused,
  submit,
  photo,
  world as knowledgeWorld,
  type World,
} from "./knowledge-fixtures"

const checkOf = (venue: string, key: string) =>
  psql(
    `select id from public.venue_amenity_checks
     where venue_id = '${venue}' and template_key = '${key}'`
  )

const onList = (venue: string, key: string) =>
  psql(
    `select count(*) from public.knowledge_working_list
     where venue_id = '${venue}' and question_key = '${key}' and disabled_at is null`
  )

const slotOf = (venue: string, checkId: string) =>
  psql(
    `select coalesce((select r.category || ':' || r.required || ':' || r.state
      from private.coverage_slot_rows('${venue}') r
      where r.slot_id = '${checkId}'), 'none')`
  )

async function managerAdds(w: World, keys: string[]) {
  await json(w.manager, "amenity_add_checks", {
    p_venue_id: w.venue,
    p_keys: keys,
  })
  for (const k of keys) w.checks[k] = checkOf(w.venue, k)
}

describe("W5: a check a manager adds joins the venue's open working list", () => {
  it("gives a pool table Yes with a photo a counted Facilities slot, with no admin step", async () => {
    // The venue is on the knowledge layer: its pilot keys are on the list.
    const w = await knowledgeWorld("s3r9-add")
    await managerAdds(w, ["pool_table"])
    const id = w.checks.pool_table

    expect(onList(w.venue, "pool_table")).toBe("1")
    expect(
      psql(
        `select e.kind || ':' || coalesce(e.actor_id::text, '') from public.knowledge_events e
         where e.check_id = '${id}' and e.kind = 'working_list_enabled'`
      )
    ).toBe(`working_list_enabled:${w.manager.id}`)
    expect(slotOf(w.venue, id)).toBe("facilities:true:missing")

    // Staff answer Yes with a photo on the knowledge path (the capture
    // page's form for a working-list question).
    const asset = await photo(w.staffA.id, w.venue)
    const sent = await submit(w.staffA, w, "pool_table", {
      answer: "yes",
      assets: [asset],
    })
    expect(sent.submissionId).not.toBeNull()
    expect(slotOf(w.venue, id)).toMatch(/^facilities:true:(pending|missing)$/)
    expect(
      psql(
        `select r.pending_count from private.coverage_slot_rows('${w.venue}') r
         where r.slot_id = '${id}'`
      )
    ).toBe("1")
  })

  it("moves the added check onto the knowledge path: the legacy submit is refused", async () => {
    const w = await knowledgeWorld("s3r9-path")
    await managerAdds(w, ["darts"])
    // The manager may capture an unassigned check (Capture myself).
    const asset = await photo(w.manager.id, w.venue)
    await refused(
      w.manager,
      "amenity_submit_finding",
      {
        p_check_id: w.checks.darts,
        p_revision: Number(
          psql(
            `select revision from public.venue_amenity_checks where id = '${w.checks.darts}'`
          )
        ),
        p_idempotency_key: crypto.randomUUID(),
        p_answer: "yes",
        p_finding: null,
        p_limitations: null,
        p_reason: null,
        p_asset_ids: [asset],
        p_internal_metadata: null,
        p_redaction_confirmed: false,
      },
      "knowledge_path_required"
    )
  })

  it("joins a restored check and an already active one too", async () => {
    const w = await knowledgeWorld("s3r9-restore", { extra: ["arcade"] })
    // arcade was added before the venue had a list: active, not on it.
    expect(onList(w.venue, "arcade")).toBe("0")
    await managerAdds(w, ["arcade"])
    expect(onList(w.venue, "arcade")).toBe("1")
  })

  it("leaves a venue with no open working list on the legacy path", async () => {
    const w = await knowledgeWorld("s3r9-legacy", { enable: false })
    await managerAdds(w, ["pool_table"])
    expect(onList(w.venue, "pool_table")).toBe("0")
    expect(
      psql(
        `select count(*) from public.knowledge_working_list where venue_id = '${w.venue}'`
      )
    ).toBe("0")
    expect(slotOf(w.venue, w.checks.pool_table)).toBe("none")
  })

  it("does not put back a question an admin took off the list", async () => {
    const w = await knowledgeWorld("s3r9-off", {
      extra: ["darts"],
      inScope: ["darts"],
    })
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["darts"],
      p_enabled: false,
      p_reason: "TEST not counted here",
    })
    // Adding it again (it is still active) leaves it off.
    await managerAdds(w, ["darts"])
    expect(onList(w.venue, "darts")).toBe("0")
  })

  it("is not callable directly", async () => {
    const w = await knowledgeWorld("s3r9-direct", { enable: false })
    const { error } = await call(w.manager, "knowledge_working_list_join", {
      p_venue_id: w.venue,
      p_question_key: "darts",
      p_check_id: null,
      p_by: w.manager.id,
      p_reason: "TEST",
    })
    expect(error).not.toBeNull()
  })
})

describe("W5: the venue template brings an active check into coverage", () => {
  it("offers and lists an active check that was never on the working list", async () => {
    // amenity_enable_venue made the core checks; no working list yet.
    const w = await knowledgeWorld("s3r9-tpl", { enable: false })
    const before = checkOf(w.venue, "guest_wifi")
    const preview = await json<{ questions: { key: string }[] }>(
      w.admin,
      "admin_venue_template_preview",
      { p_venue_id: w.venue }
    )
    expect(preview.questions.map((q) => q.key)).toContain("guest_wifi")

    const applied = await json<{ questions: number }>(
      w.admin,
      "admin_venue_apply_template",
      {
        p_venue_id: w.venue,
        p_source_venue_id: null,
        p_reason: "TEST bring core checks into coverage",
      }
    )
    expect(applied.questions).toBe(preview.questions.length)
    expect(onList(w.venue, "guest_wifi")).toBe("1")
    // The same check, not a new one.
    expect(checkOf(w.venue, "guest_wifi")).toBe(before)

    // Nothing left to offer; then a manager-added check joins on its own.
    const again = await json<{ questions: { key: string }[] }>(
      w.admin,
      "admin_venue_template_preview",
      { p_venue_id: w.venue }
    )
    expect(again.questions).toHaveLength(0)
    await managerAdds(w, ["pool_table"])
    expect(slotOf(w.venue, w.checks.pool_table)).toBe("facilities:true:missing")
  })

  it("does not offer a question an admin took off the list", async () => {
    const w = await knowledgeWorld("s3r9-tpl-off")
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["guest_wifi"],
      p_enabled: false,
      p_reason: "TEST not counted here",
    })
    const preview = await json<{ questions: { key: string }[] }>(
      w.admin,
      "admin_venue_template_preview",
      { p_venue_id: w.venue }
    )
    expect(preview.questions.map((q) => q.key)).not.toContain("guest_wifi")
  })
})
