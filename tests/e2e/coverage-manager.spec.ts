import { randomUUID } from "node:crypto"

import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import {
  legacyStaffGrant,
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { convertToManager } from "./helpers/manager-world"
import { provisioner, psql } from "./helpers/stack"
import { escape, STAFF_LANDING, STAFF_TABS } from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * Manager and admin coverage journeys in the built app (owner handoff §6:
 * AC-07, AC-08, AC-09/16 retries, AC-22, AC-23, AC-28; R-M1..R-M7, R-A1,
 * R-A2). Admin and manager act only through the pages; the service role only
 * seeds photos, and the photos are sent by their authors' own sessions.
 *
 * Decision D3 retired the staff-side Manage (DESIGN.md §15): venue managers
 * are manager accounts working in /manager, which has no coverage review,
 * checklist or coverage menu screen. Those screens now open only from the
 * admin's venue coverage (/admin/coverage/[venueId]/...), so the review,
 * target, checklist and menu journeys run there; the manager account's
 * denials and revoke run against /manager.
 */

type RpcResult<T> = {
  data: T | null
  error: { code: string; message: string; details?: string | null } | null
}

async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

const key = () => `ws5-${randomUUID()}`

/** Each person sends one monthly photo of their own, as themselves. */
async function sendMonthlyPhotos(people: Person[], w: CoverageWorld) {
  const items: Record<string, string> = {}
  for (const person of people) {
    const db: Db = await signIn(provisioner(), person.email)
    const [asset] = await seedImages(person, w.venue1, 1)
    const [item] = await ok(
      db.rpc("submit_coverage_photos", {
        p_asset_ids: [asset!],
        p_client_request_key: key(),
      })
    )
    items[person.id] = item!.item_id
  }
  return items
}

const itemState = (itemId: string) =>
  psql(
    `select state || ':' || coalesce(self_review::text, '-') from public.coverage_submission_items where id = '${itemId}'::uuid`
  )

/**
 * The manager is a venue manager account (convert_account_to_manager, as the
 * admin). The admin sees the grant in effect on the managers page.
 */
async function makeManager(admin: Page, w: CoverageWorld) {
  const adminDb: Db = await signIn(provisioner(), w.admin.email)
  await convertToManager(adminDb, w.manager, w.venue1)
  await admin.goto("/admin/coverage/managers")
  const row = admin
    .getByRole("table", { name: "Current grants" })
    .getByRole("row")
    .filter({ hasText: w.manager.name })
  await expect(row).toContainText(w.venue1.name)
  // A grant that is not in effect carries a "Not in effect: …" chip.
  await expect(row).not.toContainText("Not in effect")
  await expect(row).not.toContainText("Legacy staff grant")
  await expect(
    row.getByRole("button", { name: `More actions for ${w.manager.name}` })
  ).toBeVisible()
}

/** The admin's venue coverage pages for venue 1. */
const venuePath = (w: CoverageWorld, section: string) =>
  `/admin/coverage/${w.venue1.id}/${section}`

async function reviewJourney(
  browser: Browser,
  w: CoverageWorld,
  context: BrowserContextOptions = {}
) {
  const items = await sendMonthlyPhotos([w.staffA, w.staffB], w)
  const admin = await signedInPage(browser, w.admin)
  await admin.goto(venuePath(w, "review"))
  const card = (person: Person) =>
    admin.getByRole("article", {
      name: `Monthly photo: photo by ${person.name}`,
    })

  // Accept one photo.
  await card(w.staffB).getByRole("button", { name: "Accept" }).click()
  await expect(admin.getByText(/^Accepted\. It counts for /)).toBeVisible()
  expect(itemState(items[w.staffB.id]!)).toBe("accepted:false")

  // "Needs another photo" needs a reason; without one nothing is saved.
  await card(w.staffA)
    .getByRole("button", { name: "Ask for another photo" })
    .click()
  const ask = admin.getByRole("dialog", { name: "Ask for another photo" })
  await ask.getByRole("button", { name: "Ask for another photo" }).click()
  await expect(ask).toBeVisible()
  await expect(ask.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true")
  expect(itemState(items[w.staffA.id]!)).toBe("submitted:-")
  const reason = `WS5: the pass is blurred (${w.tag})`
  await ask.getByLabel("Reason").fill(reason)
  await ask.getByRole("button", { name: "Ask for another photo" }).click()
  await expect(ask).toBeHidden()
  await expect(
    admin.getByText(`Asked ${w.staffA.name.split(" ")[0]} for another photo.`)
  ).toBeVisible()
  expect(itemState(items[w.staffA.id]!)).toBe("needs_another_photo:false")

  // Staff A sees the reason on Your month, the Me row (DESIGN.md §5b).
  const staffA = await signedInPage(browser, w.staffA, context)
  await staffA.goto(STAFF_TABS.me)
  await staffA.locator('[data-slot="me-month"]').click()
  await expect(staffA).toHaveURL(/\/staff\/tasks\/month$/)
  await expect(
    staffA
      .getByRole("region", { name: "What your reviewer asked for" })
      .getByText(reason)
  ).toBeVisible()

  for (const page of [admin, staffA]) await page.context().close()
}

test.describe("coverage: manager and admin journeys (WS5)", () => {
  test.setTimeout(240_000)

  test("desktop: the admin accepts a monthly photo and asks for another with a reason; the author reads it on Your month", async ({
    browser,
  }) => {
    await reviewJourney(browser, await provisionCoverageWorld())
  })

  test("phone (Pixel 7): the author reads the reason on Your month at phone width", async ({
    browser,
  }) => {
    await reviewJourney(
      browser,
      await provisionCoverageWorld(),
      devices["Pixel 7"]
    )
  })

  test("targets need a reason to change; a checklist item whose save answer was lost is created once; a manager account's denials and revoke apply at once", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const admin = await signedInPage(browser, w.admin)
    await makeManager(admin, w)
    const manager = await signedInPage(browser, w.manager)

    // Team (admin venue coverage): a first target needs no reason; changing it does.
    await admin.goto(venuePath(w, "team"))
    const target = () =>
      psql(
        `select coalesce(string_agg(target_count::text || ':' || source, ','), '') from public.monthly_targets where staff_id = '${w.staffB.id}'::uuid and venue_id = '${w.venue1.id}'::uuid`
      )
    const targetBox = admin.getByRole("textbox", {
      name: `${w.staffB.name}'s photo target`,
    })
    const targetReason = admin.getByLabel(/^Reason for changing .+'s target$/)
    const saveTargets = admin.getByRole("button", { name: "Save targets" })
    await targetBox.fill("4")
    await expect(targetReason).toHaveCount(0)
    await saveTargets.click()
    await expect(saveTargets).toHaveCount(0)
    await expect.poll(target).toBe("4:manager")
    // The saved value comes back with the refreshed row; edit after that.
    await expect(targetBox).toHaveValue("4")
    await targetBox.fill("6")
    await expect(targetReason).toBeVisible()
    await saveTargets.click()
    await expect(targetReason).toHaveAttribute("aria-invalid", "true")
    expect(target()).toBe("4:manager")
    await targetReason.fill("WS5: busier month at the bar")
    await saveTargets.click()
    await expect(saveTargets).toHaveCount(0)
    await expect.poll(target).toBe("6:manager")

    // Checklist: the first save's answer is lost on the way back; the
    // retry reuses the request id and opens the one item that exists.
    await admin.goto(venuePath(w, "checklist"))
    await admin
      .getByRole("button", { name: "Add a venue-specific item" })
      .click()
    const add = admin.getByRole("dialog", { name: "Add a checklist item" })
    const title = `WS5 cellar door ${w.tag}`
    await add.getByLabel("Title").fill(title)
    await add.getByLabel("Photo target").fill("2")
    let dropped = 0
    const checklistGlob = `**${venuePath(w, "checklist")}**`
    await admin.route(checklistGlob, async (route) => {
      const req = route.request()
      if (req.method() === "POST" && req.headers()["next-action"] && !dropped) {
        dropped++
        await route.fetch()
        return route.abort("connectionreset")
      }
      return route.continue()
    })
    await add.getByRole("button", { name: "Add item" }).click()
    await expect.poll(() => dropped).toBe(1)
    await expect(add.getByRole("alert")).toBeVisible()
    await add.getByRole("button", { name: "Add item" }).click()
    await expect(admin).toHaveURL(
      new RegExp(`${escape(venuePath(w, "checklist"))}/[0-9a-f-]{36}$`)
    )
    await admin.unroute(checklistGlob)
    expect(
      psql(
        `select count(*) from public.coverage_requirements where venue_id = '${w.venue1.id}'::uuid and title = '${title}'`
      )
    ).toBe("1")

    // Denials: no admin pages; staff of another venue have no workspace.
    await manager.goto("/admin/coverage")
    await expect(manager).toHaveURL(/\/manager$/)
    await manager.goto(venuePath(w, "checklist"))
    await expect(manager).toHaveURL(/\/manager$/)
    const staffC = await signedInPage(browser, w.staffC)
    await expect(staffC.locator('a[href="/manager"]')).toHaveCount(0)
    await staffC.goto("/manager")
    await expect(staffC).toHaveURL(STAFF_LANDING)

    // Revoked in the admin UI: the manager's next page load is refused.
    await admin.goto("/admin/coverage/managers")
    await admin
      .getByRole("button", { name: `More actions for ${w.manager.name}` })
      .click()
    await admin.getByRole("menuitem", { name: "Revoke grant" }).click()
    const revoke = admin.getByRole("dialog")
    await revoke.getByLabel("Reason").fill("WS5: revoke check")
    await revoke.getByRole("button", { name: "Revoke grant" }).click()
    await expect(revoke).toBeHidden()
    await manager.goto("/manager/review")
    await expect(
      manager.getByRole("heading", {
        level: 1,
        name: "Venue access unavailable",
      })
    ).toBeVisible()
    await expect(manager.locator("body")).not.toContainText(w.staffA.name)

    for (const page of [admin, manager, staffC]) await page.context().close()
  })

  test("revoke whose reply is lost: says it can't confirm, the grant really ended, and a reload shows it", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const grantId = await legacyStaffGrant(w.admin, w.manager, w.venue1)
    const admin = await signedInPage(browser, w.admin)
    await admin.goto("/admin/coverage/managers")
    const current = admin.getByRole("table", { name: "Current grants" })
    await expect(current.getByText(w.manager.name)).toBeVisible()

    // The Revoke POST reaches the server; only its reply is dropped. One
    // stable matcher and no unroute, so later requests pass through.
    const isManagersPage = (url: URL) =>
      url.pathname === "/admin/coverage/managers"
    let dropped = 0
    await admin.route(isManagersPage, async (route) => {
      const request = route.request()
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        dropped === 0
      ) {
        dropped++
        await route.fetch()
        return route.abort("connectionreset")
      }
      return route.continue()
    })

    await admin
      .getByRole("button", { name: `More actions for ${w.manager.name}` })
      .click()
    await admin.getByRole("menuitem", { name: "Revoke grant" }).click()
    const revoke = admin.getByRole("dialog")
    await revoke.getByLabel("Reason").fill("F-1: lost reply")
    await revoke.getByRole("button", { name: "Revoke grant" }).click()
    await expect(revoke.getByRole("alert")).toHaveText(
      new RegExp(
        `^We couldn't confirm .+ is no longer ${escape(w.venue1.name)}'s venue manager\\. Check your connection, then refresh to see\\.$`
      )
    )
    await expect(revoke.getByText(/Nothing changed/)).toHaveCount(0)
    expect(dropped).toBe(1)
    // The server did revoke it: the uncertain copy was the truthful one.
    expect(
      psql(
        `select revoked_at is not null from public.venue_manager_grants where id = '${grantId}'::uuid`
      )
    ).toBe("t")

    await revoke.getByRole("button", { name: "Cancel" }).click()
    await admin.reload()
    await expect(
      admin
        .getByRole("table", { name: "Current grants" })
        .getByText(w.manager.name)
    ).toHaveCount(0)
    await admin.context().close()
  })

  test("set-up: prepare all venues; confirm, assign and attach on a checklist item; an unknown amenity blocks confirm; start a menu plan; an expired evidence link re-signs once", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const v1 = `'${w.venue1.id}'::uuid`
    const adminDb: Db = await signIn(provisioner(), w.admin.email)
    // An active two-section menu at venue 1, published as the Menus admin does.
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
    const draft = await ok(
      adminDb.rpc("create_menu_draft", {
        p_venue_id: w.venue1.id,
        p_title: `WS5 menu ${w.tag}`,
        p_source: {
          kind: "json",
          label: "DEV FIXTURE menu.json",
          sha256: "a".repeat(64),
          revision: null,
          capturedAt: "2026-11-01T10:00:00Z",
          notes: null,
        } as never,
        p_document: {
          title: `WS5 menu ${w.tag}`,
          sections: [
            {
              slug: "starters",
              name: "Starters",
              kind: "food",
              items: [menuItem("starters--soup", "Soup")],
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
    )
    await ok(
      adminDb.rpc("activate_menu_version_confirmed", {
        p_version_id: draft as string,
        p_expected_revision: Number(
          psql(
            `select revision from public.menu_versions where id = '${draft}'::uuid`
          )
        ),
        // AC28: confirm exactly the items this activation retires.
        p_retirements: Number(
          psql(`select private.menu_retired_count('${draft}'::uuid)`)
        ),
      })
    )
    await sendMonthlyPhotos([w.staffB], w)
    await seedImages(w.staffA, w.venue1, 1, { colour: "#4b7bc9" })

    // Admin: a manager account for venue 1, then prepare this month for
    // every venue.
    const admin = await signedInPage(browser, w.admin)
    await makeManager(admin, w)
    await admin.goto("/admin/coverage")
    // Monthly preparation is a closed disclosure (second handoff); open it
    // so its own Prepare button is reachable when the header has none.
    const preparation = admin.locator("#preparation summary")
    if (await preparation.count()) await preparation.click()
    // "Prepare again" once every venue is prepared; both run for all venues.
    await admin
      .getByRole("button", { name: /^Prepare (this month|again)$/ })
      .first()
      .click()
    await expect(admin.getByText(/^This month is prepared: /)).toBeVisible({
      timeout: 90_000,
    })
    expect(
      psql(
        `select count(*) from public.coverage_preparation_runs where run_trigger = 'manual' and scope_venue_id is null and requested_by = '${w.admin.id}'::uuid and status = 'succeeded'`
      )
    ).toBe("1")
    expect(
      Number(
        psql(
          `select count(*) from public.coverage_requirements where venue_id = ${v1} and kind in ('service', 'amenity') and status = 'needs_setup'`
        )
      )
    ).toBeGreaterThan(0)

    // The manager account has no admin coverage pages, for any venue.
    const manager = await signedInPage(browser, w.manager)
    for (const venue of [w.venue2, w.venue1]) {
      await manager.goto(`/admin/coverage/${venue.id}`)
      await expect(manager, venue.name).toHaveURL(/\/manager$/)
    }
    await manager.context().close()

    // An evidence link that has expired is re-signed once and loads.
    let expired = 0
    await admin.route("**/api/coverage/evidence/**/thumb*", async (route) => {
      if (!expired && !route.request().url().includes("r=")) {
        expired++
        return route.fulfill({ status: 404, body: "" })
      }
      return route.continue()
    })
    await admin.goto(venuePath(w, "review"))
    const evidenceImage = admin
      .getByRole("article", {
        name: `Monthly photo: photo by ${w.staffB.name}`,
      })
      .locator('img[src*="/api/coverage/evidence/"]')
      .first()
    await expect(evidenceImage).toHaveAttribute("src", /[?&]r=1\b/)
    await expect
      .poll(() =>
        evidenceImage.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
        )
      )
      .toBe(true)
    expect(expired).toBe(1)
    await admin.unroute("**/api/coverage/evidence/**/thumb*")

    const status = (id: string) =>
      psql(
        `select status from public.coverage_requirements where id = '${id}'::uuid`
      )
    const openItem = async (list: string) => {
      await admin.goto(venuePath(w, "checklist"))
      await admin
        .getByRole("list", { name: list })
        .getByRole("link")
        .first()
        .click()
      await expect(admin).toHaveURL(
        new RegExp(`${escape(venuePath(w, "checklist"))}/[0-9a-f-]{36}$`)
      )
      return new URL(admin.url()).pathname.split("/").pop()!
    }

    // A prepared service item: confirm, assign, attach an existing photo.
    const serviceId = await openItem("Venue and service areas")
    expect(status(serviceId)).toBe("needs_setup")
    await admin.getByRole("button", { name: "Save and confirm" }).click()
    await expect(
      admin.getByText(/It now counts toward venue coverage\.$/)
    ).toBeVisible()
    expect(status(serviceId)).toBe("active")
    await admin
      .getByRole("checkbox", { name: new RegExp(escape(w.staffB.name)) })
      .check()
    await admin.getByRole("button", { name: "Save changes" }).click()
    await expect(admin.getByText("Saved. 1 person assigned.")).toBeVisible()
    expect(
      psql(
        `select coalesce(string_agg(staff_id::text, ','), '') from public.coverage_requirement_assignees where requirement_id = '${serviceId}'::uuid and ended_at is null`
      )
    ).toBe(w.staffB.id)
    await admin.getByRole("button", { name: "Attach existing photos" }).click()
    const attach = admin.getByRole("dialog")
    await expect(
      attach.getByRole("list", { name: "Venue photos" })
    ).toBeVisible()
    await attach
      .locator('input[type="checkbox"]:not([disabled])')
      .first()
      .check()
    await attach.getByRole("button", { name: /^Attach 1 photo/ }).click()
    await expect(attach).toBeHidden()
    await expect(
      admin.getByText("Attached", { exact: true }).first()
    ).toBeVisible()
    expect(
      psql(
        `select count(*) || ':' || coalesce(bool_and(a.media_type = 'image' and p.active), false)::text from public.coverage_submission_items i join public.media_assets a on a.id = i.asset_id join public.profiles p on p.id = a.uploader_id where i.requirement_id = '${serviceId}'::uuid and i.origin = 'attached' and i.archived_at is null`
      )
    ).toBe("1:true")

    // An amenity with unknown presence cannot be confirmed until it is checked.
    const amenityId = await openItem("Amenities")
    const confirm = admin.getByRole("button", { name: "Save and confirm" })
    await expect(confirm).toBeDisabled()
    await expect(
      admin.getByText("Can't confirm yet: Needs verification.")
    ).toBeVisible()
    await admin.getByRole("button", { name: "Record facts" }).click()
    const facts = admin.getByRole("dialog")
    await facts.getByRole("radio", { name: /^Present/ }).click()
    await facts
      .getByRole("checkbox", { name: /I have checked this at the venue/ })
      .check()
    await facts.getByRole("button", { name: "Save facts" }).click()
    await expect(
      admin.getByText("Facts saved: Present. You can confirm the item now.")
    ).toBeVisible()
    await expect(facts).toBeHidden()
    await expect(confirm).toBeEnabled()
    expect(
      psql(
        `select f.presence || ':' || (f.confirmed_at is not null)::text from public.venue_amenity_facts f join public.coverage_requirements r on r.venue_id = f.venue_id and r.amenity_key = f.amenity_key where r.id = '${amenityId}'::uuid`
      )
    ).toBe("present:true")
    expect(status(amenityId)).toBe("needs_setup")

    // Menu: start from the active menu; the plan stays a draft to set up.
    await admin.goto(venuePath(w, "menu"))
    await admin.getByRole("button", { name: "Start from this menu" }).click()
    await expect(
      admin.getByText("Menu sections added. Set each one up, then confirm.")
    ).toBeVisible()
    await expect(
      admin.getByRole("heading", { name: "New menu plan (not confirmed)" })
    ).toBeVisible()
    await expect(
      admin.getByRole("button", { name: "Confirm menu coverage" })
    ).toBeDisabled()
    expect(
      psql(
        `select string_agg(status, ',') from public.menu_coverage_plans where venue_id = ${v1}`
      )
    ).toBe("draft")
    expect(
      psql(
        `select count(*) from public.coverage_requirements where venue_id = ${v1} and kind = 'menu_section' and status = 'needs_setup'`
      )
    ).toBe("2")

    await admin.context().close()
  })
})
