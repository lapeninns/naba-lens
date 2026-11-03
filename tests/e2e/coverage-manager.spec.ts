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
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { provisioner, psql } from "./helpers/stack"
import { chooseOption, escape, STAFF_LANDING } from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * Manager and admin coverage journeys in the built app (owner handoff §6:
 * AC-07, AC-08, AC-09/16 retries, AC-22, AC-23, AC-28; R-M1..R-M7, R-A1,
 * R-A2). Admin and manager act only through the pages; the service role only
 * seeds photos, and the photos are sent by their authors' own sessions.
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

async function grantInUi(admin: Page, w: CoverageWorld) {
  await admin.goto("/admin/coverage/managers")
  const form = admin.getByRole("region", {
    name: "Make someone a venue manager",
  })
  // "Venue" is also a substring of the person picker's name.
  await form.getByRole("combobox", { name: "Venue", exact: true }).click()
  await admin.getByRole("option", { name: w.venue1.name, exact: true }).click()
  // Options read "Name (Job title)".
  await chooseOption(
    admin,
    form,
    "Person (active staff at that venue)",
    `${w.manager.name} (General Manager)`
  )
  await form.getByRole("button", { name: "Make venue manager" }).click()
  const managers = admin.getByRole("list", { name: "Venue managers" })
  await expect(
    managers.getByRole("listitem").filter({ hasText: w.manager.name })
  ).toContainText("In effect")
}

async function reviewJourney(
  browser: Browser,
  w: CoverageWorld,
  context: BrowserContextOptions = {}
) {
  const items = await sendMonthlyPhotos([w.staffA, w.staffB, w.manager], w)
  const admin = await signedInPage(browser, w.admin, context)
  await grantInUi(admin, w)

  const manager = await signedInPage(browser, w.manager, context)
  await expect(manager).toHaveURL(STAFF_LANDING)
  await manager.goto("/staff/manage/review")
  await expect(manager).toHaveURL(/\/staff\/manage\/review$/)
  const card = (person: Person) =>
    manager.getByRole("article", {
      name: `Monthly photo: photo by ${person.name}`,
    })

  // Accept a colleague's photo.
  await card(w.staffB).getByRole("button", { name: "Accept" }).click()
  await expect(manager.getByText(/^Accepted\. It counts for /)).toBeVisible()
  expect(itemState(items[w.staffB.id]!)).toBe("accepted:false")

  // "Needs another photo" needs a reason; without one nothing is saved.
  await card(w.staffA)
    .getByRole("button", { name: "Ask for another photo" })
    .click()
  const ask = manager.getByRole("dialog", { name: "Ask for another photo" })
  await ask.getByRole("button", { name: "Ask for another photo" }).click()
  await expect(ask).toBeVisible()
  await expect(ask.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true")
  expect(itemState(items[w.staffA.id]!)).toBe("submitted:-")
  const reason = `WS5: the pass is blurred (${w.tag})`
  await ask.getByLabel("Reason").fill(reason)
  await ask.getByRole("button", { name: "Ask for another photo" }).click()
  await expect(ask).toBeHidden()
  await expect(
    manager.getByText(`Asked ${w.staffA.name.split(" ")[0]} for another photo.`)
  ).toBeVisible()
  expect(itemState(items[w.staffA.id]!)).toBe("needs_another_photo:false")

  // The manager's own photo: allowed, recorded as self-review.
  await card(w.manager).getByRole("button", { name: "Accept" }).click()
  await expect(
    manager.getByText("Accepted your photo (recorded as self-review).")
  ).toBeVisible()
  expect(itemState(items[w.manager.id]!)).toBe("accepted:true")

  // Staff A sees the reason on Home; the admin sees the self-review.
  const staffA = await signedInPage(browser, w.staffA, context)
  await expect(
    staffA
      .getByRole("region", { name: "Needs another photo" })
      .getByText(reason)
  ).toBeVisible()
  await admin.goto("/admin/coverage")
  await expect(
    admin
      .getByRole("list", { name: "Self-reviews" })
      .getByRole("listitem")
      .filter({ hasText: w.manager.name })
  ).toBeVisible()

  for (const page of [admin, manager, staffA]) await page.context().close()
}

test.describe("coverage: manager and admin journeys (WS5)", () => {
  test.setTimeout(240_000)

  test("desktop: admin makes a manager; the manager reviews, asks for another photo with a reason and self-reviews", async ({
    browser,
  }) => {
    await reviewJourney(browser, await provisionCoverageWorld())
  })

  test("phone (Pixel 7): the same review journey at phone width", async ({
    browser,
  }) => {
    await reviewJourney(
      browser,
      await provisionCoverageWorld(),
      devices["Pixel 7"]
    )
  })

  test("targets need a reason to change; a checklist item whose save answer was lost is created once; denials and revoke apply at once", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const admin = await signedInPage(browser, w.admin)
    await grantInUi(admin, w)
    const manager = await signedInPage(browser, w.manager)

    // Team: a first target needs no reason; changing it does.
    await manager.goto("/staff/manage/team")
    await manager
      .getByRole("button", { name: `Set target for ${w.staffB.name}` })
      .click()
    let dialog = manager.getByRole("dialog")
    await dialog.getByLabel("Photos this month").fill("4")
    await expect(dialog.getByLabel("Reason for the change")).toHaveCount(0)
    await dialog.getByRole("button", { name: "Save target" }).click()
    await expect(dialog).toBeHidden()
    const target = () =>
      psql(
        `select coalesce(string_agg(target_count::text || ':' || source, ','), '') from public.monthly_targets where staff_id = '${w.staffB.id}'::uuid and venue_id = '${w.venue1.id}'::uuid`
      )
    expect(target()).toBe("4:manager")
    await manager
      .getByRole("button", { name: `Edit target for ${w.staffB.name}` })
      .click()
    dialog = manager.getByRole("dialog")
    await dialog.getByLabel("Photos this month").fill("6")
    await dialog.getByRole("button", { name: "Save target" }).click()
    await expect(dialog).toBeVisible()
    expect(target()).toBe("4:manager")
    await dialog
      .getByLabel("Reason for the change")
      .fill("WS5: busier month at the bar")
    await dialog.getByRole("button", { name: "Save target" }).click()
    await expect(dialog).toBeHidden()
    expect(target()).toBe("6:manager")

    // Checklist: the first save's answer is lost on the way back; the
    // retry reuses the request id and opens the one item that exists.
    await manager.goto("/staff/manage/checklist")
    await manager
      .getByRole("button", { name: "Add a venue-specific item" })
      .click()
    const add = manager.getByRole("dialog", { name: "Add a checklist item" })
    const title = `WS5 cellar door ${w.tag}`
    await add.getByLabel("Title").fill(title)
    await add.getByLabel("Photo target").fill("2")
    let dropped = 0
    await manager.route("**/staff/manage/checklist**", async (route) => {
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
    await expect(manager).toHaveURL(
      /\/staff\/manage\/checklist\/[0-9a-f-]{36}$/
    )
    await manager.unroute("**/staff/manage/checklist**")
    expect(
      psql(
        `select count(*) from public.coverage_requirements where venue_id = '${w.venue1.id}'::uuid and title = '${title}'`
      )
    ).toBe("1")

    // Denials: no admin pages, no other venue's items.
    const service = provisioner()
    const adminDb: Db = await signIn(service, w.admin.email)
    const [other] = await ok(
      adminDb.rpc("save_coverage_requirement", {
        p_venue_id: w.venue2.id,
        p_requirement_id: null as never,
        p_expected_revision: null as never,
        p_kind: "venue_specific",
        p_title: `WS5 other venue item ${w.tag}`,
        p_guidance: null as never,
        p_photo_target: 1,
        p_due_on: null as never,
        p_client_request_key: key(),
      })
    )
    await manager.goto("/admin/coverage")
    await expect(manager).toHaveURL(STAFF_LANDING)
    // The loading boundary streams first, so not-found arrives as the
    // not-found screen (noindex) under a 200: assert that and no leak.
    const otherTitle = `WS5 other venue item ${w.tag}`
    for (const id of [other!.requirement_id, randomUUID(), "not-a-uuid"]) {
      const res = await manager.goto(`/staff/manage/checklist/${id}`)
      expect([200, 404], id).toContain(res?.status())
      await expect(
        manager.getByRole("heading", { name: "This page could not be found." })
      ).toBeVisible()
      await expect(
        manager.locator('meta[name="robots"]').first()
      ).toHaveAttribute("content", "noindex")
      expect(await manager.content(), id).not.toContain(otherTitle)
    }
    const staffC = await signedInPage(browser, w.staffC)
    await expect(staffC.getByRole("link", { name: "Manage" })).toHaveCount(0)
    await staffC.goto("/staff/manage")
    await expect(
      staffC.getByRole("heading", { name: "Venue manager tools" })
    ).toBeVisible()
    await expect(
      staffC.getByText("These tools are for venue managers.", { exact: false })
    ).toBeVisible()

    // Revoked in the admin UI: the manager's next page load is refused.
    await admin.goto("/admin/coverage/managers")
    await admin
      .getByRole("button", { name: `Revoke ${w.manager.name}’s manager grant` })
      .click()
    const revoke = admin.getByRole("dialog")
    await revoke.getByLabel("Reason").fill("WS5: revoke check")
    await revoke.getByRole("button", { name: "Revoke" }).click()
    await expect(revoke).toBeHidden()
    await manager.goto("/staff/manage/review")
    await expect(
      manager.getByRole("heading", { name: "Venue manager tools" })
    ).toBeVisible()
    await expect(manager.getByRole("link", { name: "Manage" })).toHaveCount(0)

    for (const page of [admin, manager, staffC]) await page.context().close()
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
      adminDb.rpc("activate_menu_version", {
        p_version_id: draft as string,
        p_expected_revision: Number(
          psql(
            `select revision from public.menu_versions where id = '${draft}'::uuid`
          )
        ),
      })
    )
    await sendMonthlyPhotos([w.staffB], w)
    await seedImages(w.staffA, w.venue1, 1, { colour: "#4b7bc9" })

    // Admin: grant, then prepare this month for every venue.
    const admin = await signedInPage(browser, w.admin)
    await grantInUi(admin, w)
    await admin.goto("/admin/coverage")
    await admin
      .getByRole("button", { name: "Prepare this month for all venues" })
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

    // The manager has no admin coverage pages, for any venue.
    const manager = await signedInPage(browser, w.manager)
    for (const venue of [w.venue2, w.venue1]) {
      await manager.goto(`/admin/coverage/${venue.id}`)
      await expect(manager, venue.name).toHaveURL(STAFF_LANDING)
    }

    // An evidence link that has expired is re-signed once and loads.
    let expired = 0
    await manager.route("**/api/coverage/evidence/**/thumb*", async (route) => {
      if (!expired && !route.request().url().includes("r=")) {
        expired++
        return route.fulfill({ status: 404, body: "" })
      }
      return route.continue()
    })
    await manager.goto("/staff/manage/review")
    const evidenceImage = manager
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
    await manager.unroute("**/api/coverage/evidence/**/thumb*")

    const status = (id: string) =>
      psql(
        `select status from public.coverage_requirements where id = '${id}'::uuid`
      )
    const openItem = async (list: string) => {
      await manager.goto("/staff/manage/checklist")
      await manager
        .getByRole("list", { name: list })
        .getByRole("link")
        .first()
        .click()
      await expect(manager).toHaveURL(
        /\/staff\/manage\/checklist\/[0-9a-f-]{36}$/
      )
      return new URL(manager.url()).pathname.split("/").pop()!
    }

    // A prepared service item: confirm, assign, attach an existing photo.
    const serviceId = await openItem("Venue and service areas")
    expect(status(serviceId)).toBe("needs_setup")
    await manager.getByRole("button", { name: "Save and confirm" }).click()
    await expect(
      manager.getByText(/It now counts toward venue coverage\.$/)
    ).toBeVisible()
    expect(status(serviceId)).toBe("active")
    await manager
      .getByRole("checkbox", { name: new RegExp(escape(w.staffB.name)) })
      .check()
    await manager.getByRole("button", { name: "Save changes" }).click()
    await expect(manager.getByText("Saved. 1 person assigned.")).toBeVisible()
    expect(
      psql(
        `select coalesce(string_agg(staff_id::text, ','), '') from public.coverage_requirement_assignees where requirement_id = '${serviceId}'::uuid and ended_at is null`
      )
    ).toBe(w.staffB.id)
    await manager
      .getByRole("button", { name: "Attach existing photos" })
      .click()
    const attach = manager.getByRole("dialog")
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
      manager.getByText("Attached", { exact: true }).first()
    ).toBeVisible()
    expect(
      psql(
        `select count(*) || ':' || coalesce(bool_and(a.media_type = 'image' and p.active), false)::text from public.coverage_submission_items i join public.media_assets a on a.id = i.asset_id join public.profiles p on p.id = a.uploader_id where i.requirement_id = '${serviceId}'::uuid and i.origin = 'attached' and i.archived_at is null`
      )
    ).toBe("1:true")

    // An amenity with unknown presence cannot be confirmed until it is checked.
    const amenityId = await openItem("Amenities")
    const confirm = manager.getByRole("button", { name: "Save and confirm" })
    await expect(confirm).toBeDisabled()
    await expect(
      manager.getByText("Can't confirm yet: Needs verification.")
    ).toBeVisible()
    await manager.getByRole("button", { name: "Record facts" }).click()
    const facts = manager.getByRole("dialog")
    await facts.getByRole("radio", { name: /^Present/ }).click()
    await facts
      .getByRole("checkbox", { name: /I have checked this at the venue/ })
      .check()
    await facts.getByRole("button", { name: "Save facts" }).click()
    await expect(
      manager.getByText("Facts saved: Present. You can confirm the item now.")
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
    await manager.goto("/staff/manage/menu")
    await manager.getByRole("button", { name: "Start from this menu" }).click()
    await expect(
      manager.getByText("Menu sections added. Set each one up, then confirm.")
    ).toBeVisible()
    await expect(
      manager.getByRole("heading", { name: "New menu plan (not confirmed)" })
    ).toBeVisible()
    await expect(
      manager.getByRole("button", { name: "Confirm menu coverage" })
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

    for (const page of [admin, manager]) await page.context().close()
  })
})
