import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  accept as acceptCoverage,
  currentMonth,
  fails,
  grantManager,
  insertAsset,
  lastDay,
  midMonth,
  monthOffset,
  ok,
  psql,
  submit as submitCoverage,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "completion-target-admin",
    role: "admin",
  })
})

async function world(label: string) {
  const venue = (await createVenue(service, label)).id
  const [author, colleague, manager] = await Promise.all([
    createIdentity(service, {
      label: `${label}-author`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-colleague`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-manager`,
      role: "manager",
      venueId: venue,
    }),
  ])
  await grantManager(admin, manager.id, venue)
  await ok(
    service
      .from("profiles")
      .update({ department: "boh" })
      .in("id", [author.id, colleague.id])
  )
  return { venue, author, colleague, manager }
}

function progress(
  who: TestIdentity,
  venue: string,
  staff: string,
  month = currentMonth()
) {
  return who.client.rpc("coverage_staff_progress_v2", {
    p_venue_id: venue,
    p_staff_id: staff,
    p_period_month: month,
  })
}

async function configure(venue: string, month: string, count: number | null) {
  psql(`insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
    values ('${venue}', '${month}', ${count ?? "null"})`)
}

async function revision(check: string) {
  const { data, error } = await service
    .from("venue_amenity_checks")
    .select("revision")
    .eq("id", check)
    .single()
  if (error) throw error
  return data.revision
}

async function addCheck(manager: TestIdentity, venue: string, key: string) {
  const [id] = await ok(
    manager.client.rpc("amenity_add_checks", {
      p_venue_id: venue,
      p_keys: [key],
    })
  )
  return id!
}

async function assignCheck(
  manager: TestIdentity,
  check: string,
  assignee: TestIdentity
) {
  return ok(
    manager.client.rpc("amenity_assign_check", {
      p_check_id: check,
      p_assignee_id: assignee.id,
      p_revision: await revision(check),
    })
  )
}

function submitCheck(
  who: TestIdentity,
  check: string,
  checkRevision: number,
  key = randomUUID()
) {
  return ok(
    who.client.rpc("amenity_submit_finding", {
      p_check_id: check,
      p_revision: checkRevision,
      p_idempotency_key: key,
      p_answer: "no",
      p_finding: null as unknown as string,
      p_limitations: null as unknown as string,
      p_reason: "Inspected the venue and the facility is not present",
      p_asset_ids: [],
      p_internal_metadata: null,
      p_redaction_confirmed: false,
    })
  )
}

describe("venue completion targets", () => {
  it("applies five to all staff, deduplicates work, and leaves photo counts and other venues alone", async () => {
    const { venue, author, colleague, manager } =
      await world("completion-target")
    const other = await world("legacy-photo-target")
    const month = currentMonth()
    await configure(venue, month, 5)

    const photoTarget = async (venue: string, staff: string) =>
      ok(
        admin.client.rpc("set_monthly_target", {
          p_venue_id: venue,
          p_staff_id: staff,
          p_period_month: month,
          p_target_count: 9,
        })
      )
    await photoTarget(venue, author.id)
    await photoTarget(other.venue, other.author.id)

    const row = async () => (await ok(progress(author, venue, author.id)))[0]!
    expect(await row()).toMatchObject({
      target_basis: "menu_items_and_amenities",
      target_count: 5,
      target_id: null,
      due_on: lastDay(month),
      completion_count: 0,
      complete: false,
      needs_setup: false,
    })
    const colleagueRow = (await ok(progress(manager, venue, colleague.id)))[0]!
    expect(colleagueRow).toMatchObject({ target_count: 5, completion_count: 0 })
    const roster = await ok(
      manager.client.rpc("coverage_staff_progress_v2", { p_venue_id: venue })
    )
    expect(
      roster.filter((p) => p.target_basis === "menu_items_and_amenities")
    ).toHaveLength(2)
    expect(
      (await ok(progress(admin, venue, author.id, monthOffset(1))))[0]
    ).toMatchObject({ target_count: 5, completion_count: 0 })
    expect(
      (await ok(progress(admin, venue, author.id, monthOffset(-1))))[0]
    ).toMatchObject({ target_basis: "accepted_photos", target_count: null })
    await configure(venue, monthOffset(2), null)
    expect(
      (await ok(progress(admin, venue, author.id, monthOffset(2))))[0]
    ).toMatchObject({ target_basis: "accepted_photos", target_count: null })
    const periods = [monthOffset(-1), month, monthOffset(1), monthOffset(2)]
    expect(
      await ok(
        author.client.rpc("coverage_completion_target_periods", {
          p_venue_id: venue,
          p_period_months: periods,
        })
      )
    ).toEqual([month, monthOffset(1)])
    expect(
      await ok(
        other.author.client.rpc("coverage_completion_target_periods", {
          p_venue_id: venue,
          p_period_months: periods,
        })
      )
    ).toEqual([])
    expect(
      (await ok(progress(other.author, other.venue, other.author.id)))[0]
    ).toMatchObject({ target_basis: "accepted_photos", target_count: 9 })
    await fails(
      progress(author, venue, colleague.id),
      "not_venue_manager",
      "42501"
    )
    await fails(
      progress(other.manager, venue, author.id),
      "not_venue_manager",
      "42501"
    )
    expect(
      (await anonClient().rpc("coverage_staff_progress_v2", {})).error
    ).not.toBeNull()
    expect(
      psql(`select has_table_privilege('authenticated',
        'private.venue_monthly_completion_targets', 'select,insert')`)
    ).toBe("f")

    const version = await publishMenu(
      admin,
      venue,
      menu("TEST completion targets", [
        section("mains", "Mains", [
          item("mains--pie", "Pie", { variants: ["Small", "Large"] }),
          item("mains--soup", "Soup"),
        ]),
      ])
    )
    const catalog = (await readDocument(service, version)).byKey
    const pie = catalog["mains--pie"]!
    const soup = catalog["mains--soup"]!
    const review = async (itemId: string, variantId: string | null) => {
      const { id } = await reserveReady(service, author)
      await saveOk(author, {
        asset: id,
        revision: 0,
        types: ["dish"],
        items: [{ itemId, variantId }],
        catalogue: version,
      })
      const { data: head, error: headError } = await service
        .from("menu_item_photo_heads")
        .select("revision")
        .eq("item_id", itemId)
        .maybeSingle()
      if (headError) throw headError
      const [decision] = await ok(
        manager.client.rpc("review_menu_item_photo", {
          p_asset_id: id,
          p_item_id: itemId,
          p_variant_id: variantId as string,
          p_decision: "accepted",
          p_expected_revision: head?.revision ?? 1,
        })
      )
      return decision!
    }
    await review(pie.itemId, pie.variants[0]!.variantId)
    await review(pie.itemId, pie.variants[1]!.variantId)
    const soupDecision = await review(soup.itemId, null)

    await ok(admin.client.rpc("amenity_enable_venue", { p_venue_id: venue }))
    const checkIds = []
    for (const key of ["pool_table", "darts", "fruit_machine"]) {
      const id = await addCheck(manager, venue, key)
      checkIds.push(id)
      const rev = await assignCheck(manager, id, author)
      const request = randomUUID()
      await submitCheck(author, id, rev, request)
      expect((await submitCheck(author, id, rev, request))[0]!.replayed).toBe(
        true
      )
    }
    const [photoItem] = await submitCoverage(author, [
      (await reserveReady(service, author)).id,
    ])
    await acceptCoverage(service, admin, photoItem!.item_id)
    await ok(
      service.from("profiles").update({ department: null }).eq("id", author.id)
    )

    expect(await row()).toMatchObject({
      department: null,
      menu_items_completed: 2,
      amenity_checks_completed: 3,
      completion_count: 5,
      accepted_count: 1,
      needs_setup: false,
      setup_missing: [],
      complete: true,
    })
    const group = await ok(
      admin.client.rpc("coverage_group_overview", { p_period_month: month })
    )
    expect(group.find((g) => g.venue_id === venue)).toMatchObject({
      staff_count: 2,
      targets_set: 2,
      staff_without_target: 0,
      participation_complete: 1,
      accepted_photos: 1,
    })
    const [prep] = await ok(
      admin.client.rpc("coverage_preparation_status", { p_venue_id: venue })
    )
    expect(prep).toMatchObject({
      staff_without_target: 0,
      targets_needing_setup: 0,
    })
    const old = await ok(
      author.client.rpc("coverage_staff_progress", { p_venue_id: venue })
    )
    expect(old[0]).toMatchObject({
      target_count: 9,
      accepted_count: 1,
      complete: false,
    })

    const check = checkIds[0]!
    const archivedRevision = await ok(
      manager.client.rpc("amenity_archive_check", {
        p_check_id: check,
        p_revision: await revision(check),
      })
    )
    expect(await row()).toMatchObject({
      amenity_checks_completed: 2,
      complete: false,
    })
    await ok(
      manager.client.rpc("amenity_restore_check", {
        p_check_id: check,
        p_revision: archivedRevision,
      })
    )
    expect(await row()).toMatchObject({
      amenity_checks_completed: 3,
      complete: true,
    })
    await ok(
      manager.client.rpc("amenity_reopen_check", {
        p_check_id: check,
        p_revision: await revision(check),
        p_preset: "conditions_changed",
        p_reason: null as unknown as string,
      })
    )
    const reassignedRevision = await assignCheck(manager, check, colleague)
    await submitCheck(colleague, check, reassignedRevision)
    await ok(
      manager.client.rpc("withdraw_menu_item_photo", {
        p_photo_id: soupDecision.photo_id,
        p_expected_revision: soupDecision.item_revision,
        p_reason: "Photo for a different item",
      })
    )
    expect(await row()).toMatchObject({
      menu_items_completed: 1,
      amenity_checks_completed: 2,
      completion_count: 3,
      complete: false,
    })
    expect(
      (await ok(progress(colleague, venue, colleague.id)))[0]
    ).toMatchObject({
      menu_items_completed: 0,
      amenity_checks_completed: 1,
    })

    // This staff member never had a legacy monthly target row. Moving them
    // during the month must keep their credit visible at the former venue.
    await ok(
      service
        .from("profiles")
        .update({ venue_id: other.venue })
        .eq("id", colleague.id)
    )
    expect(
      (await ok(progress(colleague, venue, colleague.id)))[0]
    ).toMatchObject({
      is_current_member: false,
      target_basis: "menu_items_and_amenities",
      target_count: 5,
      completion_count: 1,
    })
    expect((await ok(progress(manager, venue, colleague.id)))[0]).toMatchObject(
      { is_current_member: false, completion_count: 1 }
    )
    expect(
      (await ok(progress(colleague, other.venue, colleague.id)))[0]
    ).toMatchObject({
      is_current_member: true,
      target_basis: "accepted_photos",
      target_count: null,
      completion_count: 0,
    })
    expect(
      await ok(progress(colleague, venue, colleague.id, monthOffset(1)))
    ).toEqual([])
  })

  it("keeps closed-month credit as of London month end after later changes", async () => {
    const { venue, author, colleague, manager } = await world(
      "historical-completion-target"
    )
    const closed = monthOffset(-1)
    await configure(venue, closed, 5)
    expect(
      (await ok(progress(colleague, venue, colleague.id, closed)))[0]
    ).toMatchObject({
      target_basis: "accepted_photos",
      target_count: null,
      overdue: false,
    })
    const version = await publishMenu(
      admin,
      venue,
      menu("TEST historic completion", [
        section("mains", "Mains", [item("mains--dish", "Dish")]),
      ])
    )
    const itemId = (await readDocument(service, version)).byKey["mains--dish"]!
      .itemId
    const instant = midMonth(closed)
    const asset = await insertAsset(service, {
      venue,
      uploader: author.id,
      createdAt: instant,
    })
    // Backdate only fixture events against the isolated database. The actual
    // acceptance/finding RPCs stamp now, which cannot exercise a closed month.
    const photo = randomUUID()
    const check = randomUUID()
    const submission = randomUUID()
    psql(`
      begin;
      update private.completion_staff_venue_memberships set started_at = '${instant}'
      where staff_id = '${author.id}' and ended_at is null;
      insert into public.menu_item_photos
        (id, venue_id, item_id, asset_id, author_id, state, item_name, section_name,
          section_kind, menu_version_id, decided_by, decided_at, self_review, created_at)
      values ('${photo}', '${venue}', '${itemId}', '${asset.id}', '${author.id}',
        'accepted', 'Dish', 'Mains', 'food', '${version}', '${manager.id}', '${instant}', false, '${instant}');
      insert into public.menu_item_photo_events
        (photo_id, venue_id, item_id, asset_id, author_id, actor_id, actor_role,
          action, to_state, revision, item_revision, created_at)
      values ('${photo}', '${venue}', '${itemId}', '${asset.id}', '${author.id}', '${manager.id}',
        'manager', 'accepted', 'accepted', 1, 1, '${instant}');
      insert into public.venue_amenity_settings(venue_id) values ('${venue}');
      insert into public.venue_amenity_checks(id, venue_id, template_key, created_at)
      values ('${check}', '${venue}', 'darts', '${instant}');
      insert into public.amenity_submissions
        (id, check_id, venue_id, submitted_by, answer, reason, template_version,
          evidence_rule, idempotency_key, result_revision, created_at)
      values ('${submission}', '${check}', '${venue}', '${author.id}', 'not_applicable',
        'Checked with venue manager', 1, 'photo', '${randomUUID()}', 2, '${instant}');
      update public.venue_amenity_checks
      set current_submission_id = '${submission}', answered_by = '${author.id}', answered_at = '${instant}',
        answer = 'not_applicable', progress = 'complete', revision = 2
      where id = '${check}';
      insert into public.amenity_check_events(check_id, venue_id, kind, actor_id, detail, created_at)
      values ('${check}', '${venue}', 'submitted', '${author.id}',
        jsonb_build_object('submissionId', '${submission}', 'answer', 'not_applicable'), '${instant}');
      commit;
    `)
    const counts = async (month: string) =>
      (await ok(progress(author, venue, author.id, month)))[0]!
    expect(await counts(closed)).toMatchObject({
      menu_items_completed: 1,
      amenity_checks_completed: 1,
      completion_count: 2,
      overdue: true,
    })
    await ok(
      manager.client.rpc("amenity_reopen_check", {
        p_check_id: check,
        p_revision: 2,
        p_preset: "conditions_changed",
        p_reason: null as unknown as string,
      })
    )
    // A tombstone in the later month and an amenity reopen no longer change
    // closed-period credit. Earlier/current totals have no matching events.
    psql(
      `update public.media_assets set deleted_at = now() where id = '${asset.id}'`
    )
    expect(await counts(closed)).toMatchObject({
      menu_items_completed: 1,
      amenity_checks_completed: 1,
      completion_count: 2,
    })
    expect(await counts(currentMonth())).toMatchObject({
      target_count: 5,
      completion_count: 0,
    })
    expect(await counts(monthOffset(-2))).toMatchObject({
      target_basis: "accepted_photos",
      target_count: null,
    })
  })
})
