// S3-R14: regression test for X3 (D4 residual) in the Sprint 3 round 2
// review (docs/plans/full-app-v1/reviews/S3-round2-review.md). A non-core
// check a manager added before the venue had a working list joins the list
// when an admin applies the group catalogue template (no source venue), so a
// staff Yes with a photo has a counted Facilities slot. Fixed in
// supabase/migrations/20261118132000. Real signed-in identities through
// PostgREST; psql (as the owner) only reads state.
import { describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  json,
  photo,
  submit,
  world as knowledgeWorld,
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

type Preview = { questions: { key: string }[] }

describe("X3: the source-less template brings a check added before the list into coverage", () => {
  it("offers, lists and counts a non-core check added on the legacy path", async () => {
    const w = await knowledgeWorld("s3r14-tpl", { enable: false })
    // A manager adds Pool table while the venue has no working list: the
    // legacy path, so it does not join anything.
    await json(w.manager, "amenity_add_checks", {
      p_venue_id: w.venue,
      p_keys: ["pool_table"],
    })
    const pool = checkOf(w.venue, "pool_table")
    w.checks.pool_table = pool
    expect(
      psql(
        `select is_core from public.amenity_catalogue where key = 'pool_table'`
      )
    ).toBe("f")
    expect(onList(w.venue, "pool_table")).toBe("0")
    expect(slotOf(w.venue, pool)).toBe("none")

    // The group catalogue (no source venue) offers it with the core checks.
    const preview = await json<Preview>(
      w.admin,
      "admin_venue_template_preview",
      {
        p_venue_id: w.venue,
      }
    )
    const keys = preview.questions.map((q) => q.key)
    expect(keys).toContain("pool_table")
    expect(keys).toContain("guest_wifi")

    await json(w.admin, "admin_venue_apply_template", {
      p_venue_id: w.venue,
      p_source_venue_id: null,
      p_reason: "TEST open the working list",
    })
    expect(onList(w.venue, "pool_table")).toBe("1")
    // The same check, not a new one.
    expect(checkOf(w.venue, "pool_table")).toBe(pool)
    expect(slotOf(w.venue, pool)).toBe("facilities:true:missing")

    // A staff Yes with a photo now waits in the counted slot.
    const asset = await photo(w.staffA.id, w.venue)
    const sent = await submit(w.staffA, w, "pool_table", {
      answer: "yes",
      assets: [asset],
    })
    expect(sent.submissionId).not.toBeNull()
    expect(
      psql(
        `select r.pending_count from private.coverage_slot_rows('${w.venue}') r
         where r.slot_id = '${pool}'`
      )
    ).toBe("1")

    // Nothing left to offer.
    const again = await json<Preview>(w.admin, "admin_venue_template_preview", {
      p_venue_id: w.venue,
    })
    expect(again.questions).toHaveLength(0)
  })

  it("still leaves out a non-core check an admin took off the list", async () => {
    const w = await knowledgeWorld("s3r14-tpl-off", {
      extra: ["darts"],
      inScope: ["darts"],
    })
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["darts"],
      p_enabled: false,
      p_reason: "TEST not counted here",
    })
    const preview = await json<Preview>(
      w.admin,
      "admin_venue_template_preview",
      {
        p_venue_id: w.venue,
      }
    )
    expect(preview.questions.map((q) => q.key)).not.toContain("darts")
  })

  it("does not offer a non-core check that is not active at the venue", async () => {
    const w = await knowledgeWorld("s3r14-tpl-none", { enable: false })
    const preview = await json<Preview>(
      w.admin,
      "admin_venue_template_preview",
      {
        p_venue_id: w.venue,
      }
    )
    expect(preview.questions.map((q) => q.key)).not.toContain("pool_table")
  })
})
