import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { provisioner, psql } from "./helpers/stack"
import { chooseOption, STAFF_LANDING } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Owner handoff §6 cases that need the menu, venue-completion and lifecycle
 * rules end to end (AC-04, AC-11, AC-12, AC-17, AC-19, AC-23, AC-24, AC-25,
 * AC-29, D11; R-A3). Every decision is made by a real signed-in admin,
 * manager or staff member through PostgREST or the built pages; the service
 * role and psql only seed photos and read results back.
 */

type RpcError = { code: string; message: string; details?: string | null }
type RpcResult<T> = { data: T | null; error: RpcError | null }

async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

async function refused(
  call: PromiseLike<RpcResult<unknown>>,
  message: string,
  code: string
) {
  const { data, error } = await call
  expect({ message: error?.message, code: error?.code }, message).toEqual({
    message,
    code,
  })
  expect(data ?? null).toBeNull()
}

const key = () => `ws5-${randomUUID()}`
const none = null as never

type Progress = {
  requirement_id: string
  kind: string
  title: string
  photo_target: number
  status: string
  status_reason: string | null
  menu_plan_id: string | null
  accepted_count: number
  pending_count: number
  satisfied: boolean
  overdue: boolean
  needs_reassignment: boolean
}
type Summary = {
  applicable_count: number
  satisfied_count: number
  needs_setup_count: number
  not_applicable_count: number
  menu_state: string
  pending_reconciliation_count: number
  complete: boolean
}
type SubmitRow = { item_id: string; asset_id: string; revision: number }

async function people(w: CoverageWorld) {
  const service = provisioner()
  const admin = await signIn(service, w.admin.email)
  const manager = await signIn(service, w.manager.email)
  const staffA = await signIn(service, w.staffA.email)
  const staffB = await signIn(service, w.staffB.email)
  await ok(
    admin.rpc("grant_venue_manager", {
      p_staff_id: w.manager.id,
      p_venue_id: w.venue1.id,
    })
  )
  return { admin, manager, staffA, staffB }
}

const progressOf = async (db: Db, venueId: string) =>
  (await ok(
    db.rpc("coverage_requirement_progress", {
      p_venue_id: venueId,
      p_include_closed: true,
    })
  )) as unknown as Progress[]

const summaryOf = async (db: Db, venueId: string) =>
  (
    (await ok(
      db.rpc("venue_coverage_summary", { p_venue_id: venueId })
    )) as unknown as Summary[]
  )[0]!

type StaffProgress = {
  staff_id: string
  accepted_count: number
  is_current_member: boolean
}

/** One person's monthly progress at a venue, read as the admin. */
const staffProgress = async (admin: Db, venueId: string, staffId: string) =>
  (
    (await ok(
      admin.rpc("coverage_staff_progress", {
        p_venue_id: venueId,
        p_period_month: months().current,
        p_staff_id: staffId,
      })
    )) as unknown as StaffProgress[]
  )[0]

const revisionOf = (requirementId: string) =>
  Number(
    psql(
      `select revision from public.coverage_requirements where id = '${requirementId}'::uuid`
    )
  )

/** Sets a requirement's photo target, then confirms it applies (active). */
async function confirmApplies(db: Db, row: Progress, photoTarget: number) {
  await ok(
    db.rpc("save_coverage_requirement", {
      p_venue_id: none,
      p_requirement_id: row.requirement_id,
      p_expected_revision: revisionOf(row.requirement_id),
      p_kind: none,
      p_title: row.title,
      p_guidance: none,
      p_photo_target: photoTarget,
      p_due_on: none,
      p_client_request_key: none,
    })
  )
  await ok(
    db.rpc("set_coverage_requirement_status", {
      p_requirement_id: row.requirement_id,
      p_expected_revision: revisionOf(row.requirement_id),
      p_status: "active",
    })
  )
}

const menuItem = (sourceKey: string, name: string) => ({
  itemId: null,
  sourceKey,
  name,
  description: null,
  aliases: [],
  sourceMeta: {},
  variants: [],
  review: null,
})

/** Publishes a menu version as the Menus admin does; returns its id. */
async function publishMenu(admin: Db, venueId: string, title: string) {
  const id = (await ok(
    admin.rpc("create_menu_draft", {
      p_venue_id: venueId,
      p_title: title,
      p_source: {
        kind: "json",
        label: "DEV FIXTURE menu.json",
        sha256: "a".repeat(64),
        revision: null,
        capturedAt: "2026-11-01T10:00:00Z",
        notes: null,
      } as never,
      p_document: {
        title,
        sections: [
          {
            slug: "starters",
            name: "Starters",
            kind: "food",
            items: [
              menuItem("starters--soup", "Soup"),
              menuItem("starters--salad", "Salad"),
            ],
          },
          {
            slug: "mains",
            name: "Mains",
            kind: "food",
            items: [menuItem("mains--pie", "Pie")],
          },
        ],
      } as never,
    })
  )) as string
  await ok(
    admin.rpc("activate_menu_version", {
      p_version_id: id,
      p_expected_revision: Number(
        psql(
          `select revision from public.menu_versions where id = '${id}'::uuid`
        )
      ),
    })
  )
  return id
}

async function accept(db: Db, item: { item_id: string; revision: number }) {
  return ok(
    db.rpc("review_coverage_item", {
      p_item_id: item.item_id,
      p_expected_revision: item.revision,
      p_decision: "accepted",
      p_client_request_key: key(),
    })
  )
}

async function attachAccepted(db: Db, requirementId: string, ids: string[]) {
  return ok(
    db.rpc("attach_coverage_evidence", {
      p_requirement_id: requirementId,
      p_asset_ids: ids,
      p_client_request_key: key(),
      p_accept: true,
    })
  )
}

/** The current London month and the one before, as 'YYYY-MM-01' and 'YYYY-MM'. */
function months() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date())
  const year = Number(parts.find((p) => p.type === "year")!.value)
  const month = Number(parts.find((p) => p.type === "month")!.value)
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    current: `${year}-${pad(month)}-01`,
    previous: `${prevYear}-${pad(prevMonth)}-01`,
    previousKey: `${prevYear}-${pad(prevMonth)}`,
  }
}

/** Yesterday's London date ('YYYY-MM-DD'). */
function londonYesterday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() - 24 * 3600 * 1000))
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

async function newTask(
  manager: Db,
  w: CoverageWorld,
  title: string,
  assignees: string[],
  dueOn: string | null = null,
  photoTarget = 1
) {
  const [row] = await ok(
    manager.rpc("save_coverage_requirement", {
      p_venue_id: w.venue1.id,
      p_requirement_id: none,
      p_expected_revision: none,
      p_kind: "venue_specific",
      p_title: title,
      p_guidance: none,
      p_photo_target: photoTarget,
      p_due_on: (dueOn ?? null) as never,
      p_client_request_key: key(),
    })
  )
  await ok(
    manager.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: row!.requirement_id,
      p_staff_ids: assignees,
    })
  )
  return row!.requirement_id
}

const REVIEW_CONFLICT = "a moment ago. The latest decision is shown."
const EDIT_CONFLICT = "Someone else changed this a moment ago."

/**
 * D21: after a conflict the dialog is gone, the page notice (a focusable
 * `role="status"` CoverageNotice) is the one place the message appears, no
 * `role="alert"` repeats it, and focus is on the notice.
 */
async function expectConflictNotice(page: Page, conflict = REVIEW_CONFLICT) {
  await expect(
    page.getByRole("status").filter({ hasText: conflict })
  ).toHaveCount(1)
  await expect(
    page.getByRole("alert").filter({ hasText: conflict })
  ).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate((text) => {
        const notice = document.activeElement?.closest('[data-slot="notice"]')
        return !!notice && (notice.textContent ?? "").includes(text)
      }, conflict)
    )
    .toBe(true)
}

test.describe("coverage acceptance: menus, completion and lifecycle (WS5)", () => {
  test.setTimeout(240_000)

  test("menu sections complete by accepted photo count; a new menu needs explicit reconciliation, and the venue is complete only after it (AC-04, AC-11, AC-12, AC-17, AC-19, D11)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { admin, manager, staffA } = await people(w)
    const v1 = w.venue1.id
    await ok(manager.rpc("prepare_coverage_month", { p_venue_id: v1 }))
    const prepared = await summaryOf(manager, v1)
    expect(prepared).toMatchObject({ menu_state: "no_menu", complete: false })
    expect(prepared.needs_setup_count).toBeGreaterThan(0)

    // AC-12: excluding a checklist item needs a reason; it stays listed with
    // that reason and leaves the applicable count.
    const templates = (await progressOf(manager, v1)).filter(
      (r) =>
        (r.kind === "service" || r.kind === "amenity") &&
        r.status === "needs_setup"
    )
    expect(templates.length).toBeGreaterThan(1)
    await refused(
      manager.rpc("set_coverage_requirement_status", {
        p_requirement_id: templates[0]!.requirement_id,
        p_expected_revision: revisionOf(templates[0]!.requirement_id),
        p_status: "not_applicable",
      }),
      "reason_required",
      "22023"
    )
    const before = await summaryOf(manager, v1)
    for (const [i, t] of templates.entries()) {
      await ok(
        manager.rpc("set_coverage_requirement_status", {
          p_requirement_id: t.requirement_id,
          p_expected_revision: revisionOf(t.requirement_id),
          p_status: "not_applicable",
          p_reason: `WS5: not at this venue (${i})`,
        })
      )
      if (i === 0) {
        const after = await summaryOf(manager, v1)
        expect(after.applicable_count).toBe(before.applicable_count - 1)
        expect(after.not_applicable_count).toBe(before.not_applicable_count + 1)
      }
    }
    const excluded = (await progressOf(manager, v1)).find(
      (r) => r.requirement_id === templates[0]!.requirement_id
    )
    expect(excluded).toMatchObject({
      status: "not_applicable",
      status_reason: "WS5: not at this venue (0)",
    })
    // Nothing applicable left: a venue with no checklist is never complete.
    expect(await summaryOf(manager, v1)).toMatchObject({
      applicable_count: 0,
      complete: false,
    })

    // Menu v1: one checklist item per section, not per dish.
    const menu1 = await publishMenu(admin, v1, `WS5 menu one ${w.tag}`)
    expect((await summaryOf(manager, v1)).menu_state).toBe("needs_setup")
    const [plan1] = (await ok(
      manager.rpc("start_menu_coverage_plan", {
        p_venue_id: v1,
        p_menu_version_id: menu1,
      })
    )) as unknown as { plan_id: string; revision: number }[]
    const sections1 = (await progressOf(manager, v1)).filter(
      (r) => r.menu_plan_id === plan1!.plan_id
    )
    expect(sections1.map((r) => r.title).sort()).toEqual(["Mains", "Starters"])
    const starters1 = sections1.find((r) => r.title === "Starters")!
    const mains1 = sections1.find((r) => r.title === "Mains")!
    await confirmApplies(manager, starters1, 2)
    await confirmApplies(manager, mains1, 1)
    await ok(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: starters1.requirement_id,
        p_staff_ids: [w.staffA.id],
      })
    )
    await ok(
      manager.rpc("confirm_menu_coverage_plan", {
        p_plan_id: plan1!.plan_id,
        p_expected_revision: Number(
          psql(
            `select revision from public.menu_coverage_plans where id = '${plan1!.plan_id}'::uuid`
          )
        ),
      })
    )
    expect((await summaryOf(manager, v1)).menu_state).toBe("current")

    // AC-04: the section completes on accepted photos alone; pending photos
    // do not count, and no photo carries a dish label.
    const starterPhotos = await seedImages(w.staffA, w.venue1, 2)
    const sent = (await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: starterPhotos,
        p_requirement_id: starters1.requirement_id,
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]
    const starters = async () =>
      (await progressOf(manager, v1)).find(
        (r) => r.requirement_id === starters1.requirement_id
      )!
    expect(await starters()).toMatchObject({
      pending_count: 2,
      accepted_count: 0,
      satisfied: false,
    })
    await accept(manager, sent[0]!)
    expect(await starters()).toMatchObject({
      accepted_count: 1,
      satisfied: false,
    })
    await accept(manager, sent[1]!)
    expect(await starters()).toMatchObject({
      accepted_count: 2,
      satisfied: true,
    })
    expect(
      psql(
        `select count(*) from public.media_label_items where asset_id in (${starterPhotos.map((id) => `'${id}'::uuid`).join(", ")})`
      )
    ).toBe("0")
    await attachAccepted(
      manager,
      mains1.requirement_id,
      await seedImages(w.staffB, w.venue1, 1)
    )
    // AC-17: every applicable item satisfied, menu current → complete.
    expect(await summaryOf(manager, v1)).toMatchObject({
      applicable_count: 2,
      satisfied_count: 2,
      needs_setup_count: 0,
      menu_state: "current",
      complete: true,
    })

    // AC-19: participation is separate: the venue is complete while nobody
    // has a target, so participation is not.
    const [group] = (
      (await ok(admin.rpc("coverage_group_overview", {}))) as unknown as Record<
        string,
        unknown
      >[]
    ).filter((r) => r.venue_id === v1)
    // `participation_complete` counts the people who met their target.
    expect(group).toMatchObject({
      coverage_complete: true,
      participation_complete: 0,
    })
    expect(Number(group!.staff_count)).toBeGreaterThan(0)
    const adminPage = await signedInPage(browser, w.admin)
    await adminPage.goto("/admin/coverage")
    // One row per venue, with coverage and participation as separate figures.
    const venueRow = adminPage
      .getByRole("list", { name: "Venues" })
      .getByRole("listitem")
      .filter({ hasText: w.venue1.name })
    await expect(venueRow).toBeVisible()
    await expect(venueRow).toContainText("Venue coverage")
    await expect(venueRow).toContainText("Staff participation")
    test.info().annotations.push({
      type: "AC-19 admin rows",
      description: await venueRow.innerText(),
    })

    // D11 setup: one more photo waits for review on the v1 section.
    const [waiting] = (await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: await seedImages(w.staffA, w.venue1, 1),
        p_requirement_id: starters1.requirement_id,
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]

    // AC-11: a new menu version with the same section names has new section
    // ids; nothing is matched by name.
    const menu2 = await publishMenu(admin, v1, `WS5 menu two ${w.tag}`)
    expect(await summaryOf(manager, v1)).toMatchObject({
      menu_state: "menu_changed",
      complete: false,
    })
    await refused(
      manager.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: starters1.requirement_id,
        p_target_requirement_id: none,
        p_item_ids: [],
        p_reason: "WS5: too early",
      }),
      "plan_not_superseded",
      "P0001"
    )
    const [plan2] = (await ok(
      manager.rpc("start_menu_coverage_plan", {
        p_venue_id: v1,
        p_menu_version_id: menu2,
      })
    )) as unknown as { plan_id: string }[]
    const sections2 = (await progressOf(manager, v1)).filter(
      (r) => r.menu_plan_id === plan2!.plan_id
    )
    const starters2 = sections2.find((r) => r.title === "Starters")!
    const mains2 = sections2.find((r) => r.title === "Mains")!
    expect(starters2.requirement_id).not.toBe(starters1.requirement_id)
    expect(mains2.requirement_id).not.toBe(mains1.requirement_id)
    expect([starters2.accepted_count, mains2.accepted_count]).toEqual([0, 0])
    await confirmApplies(manager, starters2, 2)
    await confirmApplies(manager, mains2, 1)
    const [confirmed2] = (await ok(
      manager.rpc("confirm_menu_coverage_plan", {
        p_plan_id: plan2!.plan_id,
        p_expected_revision: Number(
          psql(
            `select revision from public.menu_coverage_plans where id = '${plan2!.plan_id}'::uuid`
          )
        ),
      })
    )) as unknown as {
      reconciliation_required: boolean
      auto_retired: number
    }[]
    expect(confirmed2).toMatchObject({
      reconciliation_required: true,
      auto_retired: 0,
    })
    expect(await summaryOf(manager, v1)).toMatchObject({
      menu_state: "reconciliation_pending",
      pending_reconciliation_count: 2,
      complete: false,
    })
    const managerPage = await signedInPage(browser, w.manager)
    await managerPage.goto("/staff/manage/menu")
    await expect(
      managerPage.getByRole("heading", {
        name: "Carry photos from the previous menu",
      })
    ).toBeVisible()
    await expect(
      managerPage.getByText("Nothing is matched by name.", { exact: false })
    ).toBeVisible()

    // D11: the superseded section takes no new photos, but the waiting one
    // can still be reviewed.
    await refused(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: await seedImages(w.staffA, w.venue1, 1),
        p_requirement_id: starters1.requirement_id,
        p_client_request_key: key(),
      }),
      "requirement_not_open",
      "P0001"
    )
    await accept(manager, waiting!)

    // AC-17: the new sections are satisfied, yet the venue stays incomplete
    // while reconciliation is pending.
    await attachAccepted(
      manager,
      starters2.requirement_id,
      await seedImages(w.staffB, w.venue1, 2)
    )
    await attachAccepted(
      manager,
      mains2.requirement_id,
      await seedImages(w.staffB, w.venue1, 1)
    )
    expect(await summaryOf(manager, v1)).toMatchObject({
      applicable_count: 2,
      satisfied_count: 2,
      needs_setup_count: 0,
      menu_state: "reconciliation_pending",
      complete: false,
    })

    // Reconciliation is explicit per requirement, to a current target only.
    await refused(
      manager.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: starters1.requirement_id,
        p_target_requirement_id: mains1.requirement_id,
        p_item_ids: none,
        p_reason: "WS5: not a current target",
      }),
      "requirement_not_open",
      "P0001"
    )
    const creditBefore = (await staffProgress(admin, v1, w.staffA.id))
      ?.accepted_count
    const [carried] = (await ok(
      manager.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: starters1.requirement_id,
        p_target_requirement_id: starters2.requirement_id,
        p_item_ids: none,
        p_reason: "WS5: same dishes",
      })
    )) as unknown as { carried: number; reconciliation_complete: boolean }[]
    expect(carried).toEqual({ carried: 3, reconciliation_complete: false })
    expect((await summaryOf(manager, v1)).complete).toBe(false)
    const [dropped] = (await ok(
      manager.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: mains1.requirement_id,
        p_target_requirement_id: none,
        p_item_ids: [],
        p_reason: "WS5: the pie is off the menu",
      })
    )) as unknown as { carried: number; reconciliation_complete: boolean }[]
    expect(dropped).toEqual({ carried: 0, reconciliation_complete: true })
    expect(await summaryOf(manager, v1)).toMatchObject({
      menu_state: "current",
      pending_reconciliation_count: 0,
      complete: true,
    })
    expect(
      psql(
        `select count(*) || ':' || bool_and(state = 'accepted') from public.coverage_submission_items where requirement_id = '${starters2.requirement_id}'::uuid and origin = 'reconciled' and archived_at is null`
      )
    ).toBe("3:true")
    // Carried photos earn no new monthly credit.
    expect((await staffProgress(admin, v1, w.staffA.id))?.accepted_count).toBe(
      creditBefore
    )
    expect(
      psql(
        `select string_agg(status || ':' || coalesce(retire_kind, '-'), ',' order by title) from public.coverage_requirements where id in ('${starters1.requirement_id}'::uuid, '${mains1.requirement_id}'::uuid)`
      )
    ).toBe("retired:reconciled,retired:reconciled")
    for (const page of [adminPage, managerPage]) await page.context().close()
  })

  test("historical target corrections are admin-only, need a reason and are audited (AC-23, R-A3)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { admin, manager } = await people(w)
    const { previous, previousKey } = months()
    const target = (db: Db, reason?: string) =>
      db.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: previous,
        p_target_count: 3,
        ...(reason ? { p_reason: reason } : {}),
      })
    await refused(
      target(manager, "WS5: manager tries"),
      "historical_admin_only",
      "42501"
    )
    await refused(target(admin), "reason_required", "22023")
    const pastRow = () =>
      psql(
        `select coalesce(string_agg(target_count::text || ':' || source, ','), '') from public.monthly_targets where staff_id = '${w.staffA.id}'::uuid and venue_id = '${w.venue1.id}'::uuid and period_month = '${previous}'::date`
      )
    expect(pastRow()).toBe("")

    // The manager's team page shows past months read-only.
    const managerPage = await signedInPage(browser, w.manager)
    await managerPage.goto(`/staff/manage/team?period=${previousKey}`)
    await expect(managerPage.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(
      managerPage.getByText(`${w.staffA.name}`, { exact: false }).first()
    ).toBeVisible()
    await expect(
      managerPage.getByRole("button", {
        name: /^(Correct .+ target|(Decrease|Increase) .+ photo target)$/,
      })
    ).toHaveCount(0)
    await expect(
      managerPage.getByRole("button", { name: "Save targets" })
    ).toHaveCount(0)

    // R-A3: the admin corrects last month in the UI, with a reason.
    const adminPage = await signedInPage(browser, w.admin)
    await adminPage.goto(
      `/admin/coverage/${w.venue1.id}/team?period=${previousKey}`
    )
    await adminPage
      .getByRole("button", {
        name: new RegExp(`^Correct target for ${w.staffA.name}, \\w+$`),
      })
      .click()
    const dialog = adminPage.getByRole("dialog")
    await expect(
      dialog.getByText("Venue coverage isn't affected.")
    ).toBeVisible()
    await dialog
      .getByRole("textbox", {
        name: new RegExp(`^${w.staffA.name}'s \\w+ target$`),
      })
      .fill("3")
    await dialog.getByRole("button", { name: "Save correction" }).click()
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText("Add a reason.", { exact: false })
    ).toBeVisible()
    expect(pastRow()).toBe("")
    const reason = `WS5: corrected after the stock count (${w.tag})`
    await dialog.getByLabel("Reason", { exact: true }).fill(reason)
    await dialog.getByRole("button", { name: "Save correction" }).click()
    await expect(dialog).toBeHidden()
    expect(pastRow()).toBe("3:admin_correction")
    expect(
      psql(
        `select string_agg(actor_role || ':' || historical::text || ':' || coalesce(reason, '-'), ',') from public.coverage_audit_events where entity = 'monthly_target' and actor_id = '${w.admin.id}'::uuid`
      )
    ).toBe(`admin:true:${reason}`)
    for (const page of [managerPage, adminPage]) await page.context().close()
  })

  test("a transfer blocks old-venue tasks and photos, keeps past credit, and never grants the new venue (AC-24)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { admin, manager, staffA } = await people(w)
    const task = await newTask(manager, w, `WS5 transfer task ${w.tag}`, [
      w.staffA.id,
    ])
    await ok(
      manager.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: months().current,
        p_target_count: 2,
      })
    )
    const [credited] = (await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: await seedImages(w.staffA, w.venue1, 1),
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]
    await accept(manager, credited!)
    const [oldPhoto] = await seedImages(w.staffA, w.venue1, 1)
    const staffPage = await signedInPage(browser, w.staffA)
    await expect(staffPage).toHaveURL(STAFF_LANDING)
    await expect(
      staffPage.getByRole("link", { name: `WS5 transfer task ${w.tag}` })
    ).toBeVisible()

    // The admin moves staff A and the manager to venue 2 in the UI.
    const adminPage = await signedInPage(browser, w.admin)
    for (const person of [w.staffA, w.manager]) {
      await adminPage.goto(`/admin/staff/${person.id}`)
      await adminPage.getByRole("button", { name: "Edit details" }).click()
      const edit = adminPage.getByRole("dialog")
      await chooseOption(adminPage, edit, "Venue", w.venue2.name)
      await edit.getByRole("button", { name: "Save changes" }).click()
      await expect(edit).toBeHidden()
    }

    await staffPage.goto("/staff/tasks")
    await expect(
      staffPage.getByRole("link", { name: `WS5 transfer task ${w.tag}` })
    ).toHaveCount(0)
    await staffPage.goto(`/staff/tasks/${task}`)
    await expect(
      staffPage.getByRole("heading", { name: "This task isn't yours" })
    ).toBeVisible()
    await refused(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [oldPhoto!],
        p_client_request_key: key(),
      }),
      "evidence_not_eligible",
      "P0001"
    )
    expect(
      psql(
        `select string_agg(end_kind, ',') from public.coverage_requirement_assignees where requirement_id = '${task}'::uuid`
      )
    ).toBe("transferred")
    // Past venue and credit stay with the photo and the old venue's month.
    expect(
      psql(
        `select venue_id::text || ':' || state from public.coverage_submission_items where id = '${credited!.item_id}'::uuid`
      )
    ).toBe(`${w.venue1.id}:accepted`)
    expect(await staffProgress(admin, w.venue1.id, w.staffA.id)).toMatchObject({
      accepted_count: 1,
      is_current_member: false,
    })

    // The transferred manager is no manager at the new venue.
    expect(
      psql(
        `select string_agg(coalesce(revoke_kind, 'open'), ',') from public.venue_manager_grants where staff_id = '${w.manager.id}'::uuid`
      )
    ).toBe("venue_changed")
    const managerPage = await signedInPage(browser, w.manager)
    await managerPage.goto("/staff/manage")
    await expect(
      managerPage.getByRole("heading", { name: "Manage isn't available" })
    ).toBeVisible()
    await expect(managerPage.getByRole("link", { name: "Manage" })).toHaveCount(
      0
    )
    for (const page of [staffPage, adminPage, managerPage])
      await page.context().close()
  })

  test("deactivation ends access and the assignment, shows the reassignment need, and keeps accepted evidence for reviewers (AC-25)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { manager, staffB } = await people(w)
    const title = `WS5 leaver task ${w.tag}`
    const task = await newTask(manager, w, title, [w.staffB.id])
    const [photo] = await seedImages(w.staffB, w.venue1, 1)
    const [monthly] = (await ok(
      staffB.rpc("submit_coverage_photos", {
        p_asset_ids: [photo!],
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]
    await accept(manager, monthly!)
    const leaver = await signedInPage(browser, w.staffB)
    await expect(leaver).toHaveURL(STAFF_LANDING)

    const adminPage = await signedInPage(browser, w.admin)
    await adminPage.goto(`/admin/staff/${w.staffB.id}`)
    await adminPage
      .getByRole("button", { name: `More actions for ${w.staffB.name}` })
      .click()
    await adminPage.getByRole("menuitem", { name: "Deactivate" }).click()
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Deactivate" })
      .click()
    await expect(adminPage.getByText(/is inactive\./)).toBeVisible()

    await leaver.goto("/staff/tasks")
    await expect(leaver).toHaveURL(/\/auth\/blocked$/)
    expect(
      psql(
        `select string_agg(end_kind, ',') from public.coverage_requirement_assignees where requirement_id = '${task}'::uuid`
      )
    ).toBe("deactivated")
    const row = (await progressOf(manager, w.venue1.id)).find(
      (r) => r.requirement_id === task
    )
    expect(row).toMatchObject({ needs_reassignment: true })

    const managerPage = await signedInPage(browser, w.manager)
    await managerPage.goto("/staff/manage/checklist")
    await expect(
      managerPage
        .getByRole("listitem")
        .filter({ hasText: title })
        .getByText("Needs reassignment")
    ).toBeVisible()
    // The leaver's accepted photo stays reviewable evidence.
    const evidence = await managerPage.request.get(
      `/api/coverage/evidence/${photo}/thumb`,
      { maxRedirects: 0 }
    )
    expect(evidence.status()).toBe(302)
    for (const page of [leaver, adminPage, managerPage])
      await page.context().close()
  })

  test("an overdue task is shown for follow-up and still takes photos to completion (AC-29)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { manager, staffA } = await people(w)
    const title = `WS5 overdue task ${w.tag}`
    const task = await newTask(
      manager,
      w,
      title,
      [w.staffA.id],
      londonYesterday()
    )
    const staffPage = await signedInPage(browser, w.staffA)
    await expect(staffPage).toHaveURL(STAFF_LANDING)
    // Home also raises it on the To do card; the task list row must carry it.
    const listed = staffPage
      .getByRole("list", { name: "Assigned tasks" })
      .getByRole("listitem")
      .filter({ hasText: title })
    await expect(listed.getByText("Overdue", { exact: true })).toBeVisible()
    await staffPage.goto(`/staff/tasks/${task}`)
    await expect(staffPage.getByText("Overdue", { exact: true })).toBeVisible()
    await expect(
      staffPage.getByRole("button", { name: "Take a photo" })
    ).toBeEnabled()

    const [sent] = (await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: await seedImages(w.staffA, w.venue1, 1),
        p_requirement_id: task,
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]
    const progress = async () =>
      (await progressOf(manager, w.venue1.id)).find(
        (r) => r.requirement_id === task
      )!
    expect(await progress()).toMatchObject({ overdue: true, satisfied: false })
    await accept(manager, sent!)
    expect(await progress()).toMatchObject({ overdue: false, satisfied: true })
    await staffPage.reload()
    await expect(staffPage.getByText("Overdue", { exact: true })).toHaveCount(0)
    await staffPage.context().close()
  })

  test("a shared task's assignees meet one target together; each photo counts once for its author and once for one task (AC-32)", async () => {
    const w = await provisionCoverageWorld()
    const { admin, manager, staffA, staffB } = await people(w)
    const shared = await newTask(
      manager,
      w,
      `WS5 shared task ${w.tag}`,
      [w.staffA.id, w.staffB.id],
      null,
      2
    )
    const other = await newTask(manager, w, `WS5 other task ${w.tag}`, [
      w.staffA.id,
    ])
    const submit = async (db: Db, who: typeof w.staffA) =>
      (
        (await ok(
          db.rpc("submit_coverage_photos", {
            p_asset_ids: await seedImages(who, w.venue1, 1),
            p_requirement_id: shared,
            p_client_request_key: key(),
          })
        )) as unknown as SubmitRow[]
      )[0]!
    const fromA = await submit(staffA, w.staffA)
    const fromB = await submit(staffB, w.staffB)
    const sharedRow = async () =>
      (await progressOf(manager, w.venue1.id)).find(
        (r) => r.requirement_id === shared
      )!
    await accept(manager, fromA)
    expect(await sharedRow()).toMatchObject({
      accepted_count: 1,
      satisfied: false,
    })
    await accept(manager, fromB)
    expect(await sharedRow()).toMatchObject({
      accepted_count: 2,
      satisfied: true,
    })
    for (const person of [w.staffA, w.staffB]) {
      expect(
        (await staffProgress(admin, w.venue1.id, person.id))?.accepted_count,
        person.name
      ).toBe(1)
    }
    // The accepted photo cannot also count for another task.
    await refused(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [fromA.asset_id],
        p_requirement_id: other,
        p_client_request_key: key(),
      }),
      "asset_already_submitted",
      "P0001"
    )
  })

  test("validation limits are the database limits at their boundary values (AC-35, D8)", async () => {
    const w = await provisionCoverageWorld()
    const { manager, staffA } = await people(w)
    const create = (title: string, photoTarget = 1, guidance?: string) =>
      manager.rpc("save_coverage_requirement", {
        p_venue_id: w.venue1.id,
        p_requirement_id: none,
        p_expected_revision: none,
        p_kind: "venue_specific",
        p_title: title,
        p_guidance: (guidance ?? null) as never,
        p_photo_target: photoTarget,
        p_due_on: none,
        p_client_request_key: key(),
      })
    const passes = async (
      call: PromiseLike<RpcResult<unknown>>,
      label: string
    ) => expect((await call).error, label).toBeNull()
    await refused(create(""), "invalid_title", "22023")
    await passes(create("x"), "title 1")
    await passes(create("t".repeat(120)), "title 120")
    await refused(create("t".repeat(121)), "invalid_title", "22023")
    await refused(create("WS5 target 0", 0), "invalid_photo_target", "22023")
    await passes(create("WS5 target 1", 1), "photo target 1")
    await passes(create("WS5 target 200", 200), "photo target 200")
    await refused(
      create("WS5 target 201", 201),
      "invalid_photo_target",
      "22023"
    )
    await passes(
      create("WS5 guidance 2000", 1, "g".repeat(2000)),
      "guidance 2000"
    )
    await refused(
      create("WS5 guidance 2001", 1, "g".repeat(2001)),
      "invalid_guidance",
      "22023"
    )

    const target = (count: number) =>
      manager.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: months().current,
        p_target_count: count,
      })
    await refused(target(0), "invalid_target_count", "22023")
    await refused(target(501), "invalid_target_count", "22023")
    await passes(target(500), "target 500")
    await passes(
      manager.rpc("set_monthly_target", {
        p_staff_id: w.staffA.id,
        p_venue_id: w.venue1.id,
        p_period_month: months().current,
        p_target_count: 1,
        p_reason: "WS5: boundary check",
        p_expected_revision: Number(
          psql(
            `select revision from public.monthly_targets where staff_id = '${w.staffA.id}'::uuid and period_month = '${months().current}'::date`
          )
        ),
      }),
      "target 1"
    )

    const photos = await seedImages(w.staffA, w.venue1, 11)
    const send = (ids: string[]) =>
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: ids,
        p_client_request_key: key(),
      })
    await refused(send([]), "invalid_asset_list", "22023")
    await refused(send(photos), "invalid_asset_list", "22023")
    await passes(send(photos.slice(0, 1)), "batch 1")
    await passes(send(photos.slice(1, 11)), "batch 10")

    const [task] = (await ok(create("WS5 assignee limit"))) as unknown as {
      requirement_id: string
    }[]
    const strangers = (n: number) =>
      Array.from({ length: n }, () => randomUUID())
    await refused(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: task!.requirement_id,
        p_staff_ids: [w.staffA.id, ...strangers(50)],
      }),
      "invalid_staff_list",
      "22023"
    )
    // Fifty passes the size check; unknown people are then refused for who they are.
    const fifty = await manager.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: task!.requirement_id,
      p_staff_ids: [w.staffA.id, ...strangers(49)],
    })
    expect(fifty.error?.message).not.toBe("invalid_staff_list")
  })

  test("a manager gets no admin powers, and manager pages and responses carry no email addresses (AC-15, AC-28)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { manager, staffB } = await people(w)
    const [colleaguePhoto] = await seedImages(w.staffB, w.venue1, 1)
    await ok(
      staffB.rpc("submit_coverage_photos", {
        p_asset_ids: [colleaguePhoto!],
        p_client_request_key: key(),
      })
    )
    const draft = await manager.rpc("create_menu_draft", {
      p_venue_id: w.venue1.id,
      p_title: "WS5 manager menu",
      p_source: {
        kind: "json",
        label: "DEV FIXTURE menu.json",
        sha256: "a".repeat(64),
        revision: null,
        capturedAt: "2026-11-01T10:00:00Z",
        notes: null,
      } as never,
      p_document: { title: "WS5 manager menu", sections: [] } as never,
    })
    expect(draft.error?.code).toBe("42501")
    await refused(
      manager.rpc("delete_media_asset", { p_asset_id: colleaguePhoto! }),
      "media_asset_not_found",
      "P0002"
    )
    const edit = await manager
      .from("profiles")
      .update({ role: "admin", venue_id: w.venue2.id, department: "boh" })
      .eq("id", w.staffB.id)
      .select("id")
    expect(edit.data ?? []).toEqual([])
    expect(
      psql(
        `select role || ':' || venue_id || ':' || department || ':' || active from public.profiles where id = '${w.staffB.id}'::uuid`
      )
    ).toBe(`staff:${w.venue1.id}:foh:true`)

    const page = await signedInPage(browser, w.manager)
    for (const path of [
      "/admin/staff",
      `/admin/staff/${w.staffB.id}`,
      "/admin/menus",
      "/admin/coverage/managers",
    ]) {
      await page.goto(path)
      await expect(page, path).toHaveURL(STAFF_LANDING)
    }
    const download = await page.request.get(
      `/api/media/${colleaguePhoto}/download`,
      { maxRedirects: 0 }
    )
    expect([403, 404]).toContain(download.status())

    // AC-15: neither the HTML (with its inline RSC payload) nor the RSC
    // response of any manager page carries an email address.
    const emails = [w.admin, w.manager, w.staffA, w.staffB, w.joiner].map(
      (p) => p.email
    )
    for (const path of [
      "/staff/manage",
      "/staff/manage/review",
      "/staff/manage/team",
      `/staff/manage/team?staff=${w.staffB.id}`,
      "/staff/manage/checklist",
    ]) {
      await page.goto(path)
      await expect(
        page.getByRole("heading", { level: 1 }).first()
      ).toBeVisible()
      const html = await page.content()
      const rsc = await (
        await page.request.get(path, { headers: { RSC: "1" } })
      ).text()
      for (const body of [html, rsc]) {
        for (const email of emails) expect(body, path).not.toContain(email)
        expect(body, path).not.toMatch(/"email"\s*:/)
      }
    }
    await page.context().close()
  })

  test("a stale review shows the conflict and keeps the first decision (AC-16)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { staffB } = await people(w)
    const [sent] = (await ok(
      staffB.rpc("submit_coverage_photos", {
        p_asset_ids: await seedImages(w.staffB, w.venue1, 1),
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]
    const first = await signedInPage(browser, w.manager)
    const second = await signedInPage(browser, w.manager)
    for (const page of [first, second]) await page.goto("/staff/manage/review")
    const card = (page: typeof first) =>
      page.getByRole("article", {
        name: `Monthly photo: photo by ${w.staffB.name}`,
      })
    await card(first).getByRole("button", { name: "Accept" }).click()
    await expect(first.getByText(/^Accepted\. It counts for /)).toBeVisible()
    await card(second)
      .getByRole("button", { name: "Ask for another photo" })
      .click()
    const ask = second.getByRole("dialog", { name: "Ask for another photo" })
    await ask.getByLabel("Reason").fill("WS5: decided in another tab")
    await ask.getByRole("button", { name: "Ask for another photo" }).click()
    await expect(ask).toBeHidden()
    await expectConflictNotice(second)
    await expect(card(second)).toHaveCount(0)
    expect(
      psql(
        `select state from public.coverage_submission_items where id = '${sent!.item_id}'::uuid`
      )
    ).toBe("accepted")
    for (const page of [first, second]) await page.context().close()
  })

  test("a stale Accept focuses the conflict notice and keeps the first decision (D21)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { staffB } = await people(w)
    const [sent] = (await ok(
      staffB.rpc("submit_coverage_photos", {
        p_asset_ids: await seedImages(w.staffB, w.venue1, 1),
        p_client_request_key: key(),
      })
    )) as unknown as SubmitRow[]
    const first = await signedInPage(browser, w.manager)
    const second = await signedInPage(browser, w.manager)
    for (const page of [first, second]) await page.goto("/staff/manage/review")
    const card = (page: typeof first) =>
      page.getByRole("article", {
        name: `Monthly photo: photo by ${w.staffB.name}`,
      })
    await card(first)
      .getByRole("button", { name: "Ask for another photo" })
      .click()
    const ask = first.getByRole("dialog", { name: "Ask for another photo" })
    await ask.getByLabel("Reason").fill("WS5: decided first in this tab")
    await ask.getByRole("button", { name: "Ask for another photo" }).click()
    await expect(
      first.getByText(`Asked ${w.staffB.name.split(" ")[0]} for another photo.`)
    ).toBeVisible()
    await card(second).getByRole("button", { name: "Accept" }).click()
    await expectConflictNotice(second)
    expect(
      psql(
        `select state from public.coverage_submission_items where id = '${sent!.item_id}'::uuid`
      )
    ).toBe("needs_another_photo")
    for (const page of [first, second]) await page.context().close()
  })

  test('a stale "does not apply" closes its dialog and focuses the one conflict notice (D21)', async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { manager } = await people(w)
    const title = `WS5 stale exclusion ${w.tag}`
    const task = await newTask(manager, w, title, [w.staffA.id])
    const page = await signedInPage(browser, w.manager)
    await page.goto(`/staff/manage/checklist/${task}`)
    await expect(page.getByRole("heading", { name: title })).toBeVisible()
    // The same item changes elsewhere after this page loaded.
    await ok(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: none,
        p_requirement_id: task,
        p_expected_revision: revisionOf(task),
        p_kind: none,
        p_title: `${title} (renamed)`,
        p_guidance: none,
        p_photo_target: 1,
        p_due_on: none,
        p_client_request_key: none,
      })
    )
    await page.getByRole("radio", { name: "Does not apply" }).click()
    const dialog = page.getByRole("dialog", { name: "Mark as not applicable" })
    await expect(dialog.getByText(title, { exact: true })).toBeVisible()
    await dialog.getByLabel("Reason").fill("WS5: changed in another tab")
    await dialog.getByRole("button", { name: "Mark as not applicable" }).click()
    await expect(dialog).toBeHidden()
    await expectConflictNotice(page, EDIT_CONFLICT)
    expect(
      psql(
        `select status from public.coverage_requirements where id = '${task}'::uuid`
      )
    ).toBe("active")
    await page.context().close()
  })

  test("a month nobody prepared shows as not prepared until it is prepared (AC-26)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { admin } = await people(w)
    const page = await signedInPage(browser, w.admin)
    const venueRow = () =>
      page
        .getByRole("table", { name: "Preparation by venue" })
        .getByRole("row")
        .filter({ hasText: w.venue1.name })
    await page.goto("/admin/coverage")
    await expect(venueRow()).toContainText("Not prepared yet")
    await ok(admin.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }))
    await page.reload()
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await expect(venueRow()).toBeVisible()
    await expect(venueRow()).not.toContainText("Not prepared yet")
    await page.context().close()
  })

  test("a manager whose venue is deactivated is no longer a manager (R-M5)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { manager } = await people(w)
    const paused = await provisioner()
      .from("venues")
      .update({ active: false })
      .eq("id", w.venue1.id)
    if (paused.error) throw paused.error
    const [scope] = (await ok(
      manager.rpc("coverage_access_scope")
    )) as unknown as {
      venue_active: boolean
      manager_venue_id: string | null
    }[]
    expect(scope).toMatchObject({ venue_active: false, manager_venue_id: null })
    await refused(
      manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }),
      "not_venue_manager",
      "42501"
    )
    const page = await signedInPage(browser, w.manager)
    await page.goto("/staff/manage")
    await expect(
      page.getByRole("heading", { name: "Manage isn't available" })
    ).toBeVisible()
    await expect(page.getByRole("link", { name: "Manage" })).toHaveCount(0)
    await page.context().close()
  })
})
