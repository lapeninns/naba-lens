import { expect, test, type Locator, type Page } from "@playwright/test"

import { MANAGER_COPY } from "../../components/nabalens/manager/copy"
import {
  amenityHrefs,
  ANSWER_LABEL,
  evidenceHref,
  staffCaptureHref,
} from "../../lib/amenities/contract"
import {
  amenityOk,
  amenityRpc,
  checkId,
  checkState,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  sessionOf,
  submitArgs,
} from "./helpers/amenities-world"
import { signedInPage } from "./helpers/world"

/**
 * Two-venue isolation (plan release criterion 5): the same catalogue key holds
 * a different answer at each venue, and venue B's manager (a venue manager
 * account, in the /manager workspace) and staff cannot read venue A's check,
 * submissions or evidence, in the pages, the evidence routes or their own
 * database session. Unknown and forbidden look the same.
 */

const MANAGER = amenityHrefs("/manager")
const LEGACY_MANAGE = amenityHrefs("/staff/manage")

/**
 * The route's not-found screen, with nothing of venue A on it. These pages
 * have a loading boundary, so Next streams a 200 first and then renders the
 * segment's not-found.tsx: assert the screen, not the status.
 */
const NOT_FOUND_HEADING = {
  // app/staff/manage/amenities/[checkId]/not-found.tsx (also wraps /capture);
  // the /manager amenity pages share the screen inside the workspace layout.
  manage: "This check isn't here",
  // app/staff/tasks/amenities/[checkId]/not-found.tsx
  staff: "This check isn't yours",
} as const

/**
 * The /manager check's not-found screen: the shared "This check isn't here"
 * (its heading level inside the workspace shell is the page's choice), or the
 * workspace's own not-found (app/manager/not-found.tsx) if the segment lets
 * notFound() bubble up.
 */
const managerNotFound = (page: Page): Locator =>
  page
    .getByRole("heading", { name: NOT_FOUND_HEADING.manage, exact: true })
    .or(page.getByText(MANAGER_COPY.notFound.title, { exact: true }))
    .first()

async function expectPageNotFound(
  page: Page,
  path: string,
  screen: string | ((page: Page) => Locator),
  venueASecrets: string[],
  label: string
) {
  const res = await page.goto(path)
  expect([200, 404], label).toContain(res?.status())
  await expect(
    typeof screen === "string"
      ? page.getByRole("heading", { level: 1, name: screen, exact: true })
      : screen(page),
    label
  ).toBeVisible()
  const html = await page.content()
  for (const secret of venueASecrets) {
    expect(html, `${label} leaks ${secret}`).not.toContain(secret)
  }
}

/** A refusal page, whatever its status, carries nothing of venue A. */
async function expectNoVenueAData(
  page: Page,
  path: string,
  venueASecrets: string[]
) {
  const res = await page.goto(path)
  expect(res?.status(), path).toBeLessThan(500)
  const html = await page.content()
  for (const secret of venueASecrets) {
    expect(html, `${path} leaks ${secret}`).not.toContain(secret)
  }
}

test.describe("amenity two-venue isolation", () => {
  test.setTimeout(240_000)

  test("same key, different answers; venue B cannot see venue A's check or evidence", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const checkA = await readyCheck(w, w.venueA, "guest_toilets", w.staffA)
    const checkB = await readyCheck(w, w.venueB, "guest_toilets", w.staffB)
    expect(checkA).not.toBe(checkB)

    const photo = await seedPhoto(w.staffA, w.venueA, `toilets-${w.tag}`)
    const venueASecrets = [w.venueA.name, photo, w.staffA.name]
    await amenityOk(
      await sessionOf(w.staffA),
      "amenity_submit_finding",
      submitArgs(checkA, "yes", [photo])
    )
    const reasonB = `Customers use the hotel's toilets next door ${w.tag}`
    await amenityOk(
      await sessionOf(w.staffB),
      "amenity_submit_finding",
      submitArgs(checkB, "no", [], { p_reason: reasonB })
    )
    expect(checkState(checkA).answer).toBe("yes")
    expect(checkState(checkB).answer).toBe("no")
    expect(checkId(w.venueA, "guest_toilets")).toBe(checkA)

    // Each venue's manager sees its own answer.
    const managerA = await signedInPage(browser, w.managerA)
    await managerA.goto(MANAGER.check(checkA))
    await expect(
      managerA.getByRole("main").getByText(ANSWER_LABEL.yes, { exact: true })
    ).not.toHaveCount(0)
    await expect(managerA.getByText(reasonB)).toHaveCount(0)
    const managerB = await signedInPage(browser, w.managerB)
    await managerB.goto(MANAGER.check(checkB))
    // Scoped by role: a hidden streamed copy of the page can briefly match text.
    await expect(managerB.getByRole("article").getByText(reasonB)).toBeVisible()

    // Venue B's people get the not-found screen for venue A's pages and a 404
    // for its evidence.
    const staffB = await signedInPage(browser, w.staffB)
    for (const path of [MANAGER.check(checkA), MANAGER.capture(checkA)]) {
      await expectPageNotFound(
        managerB,
        path,
        managerNotFound,
        venueASecrets,
        `manager B ${path}`
      )
    }
    // Staff who manage nothing get the manager tools' plain refusal.
    for (const path of [
      LEGACY_MANAGE.check(checkA),
      LEGACY_MANAGE.capture(checkA),
    ]) {
      await expectNoVenueAData(staffB, path, venueASecrets)
    }
    await expectPageNotFound(
      staffB,
      staffCaptureHref(checkA),
      NOT_FOUND_HEADING.staff,
      venueASecrets,
      "staff B staff capture"
    )
    // A manager account opening a staff page goes to its own Overview.
    await expectNoVenueAData(managerB, staffCaptureHref(checkA), venueASecrets)
    await expect(managerB).toHaveURL(/\/manager$/)
    for (const [page, label] of [
      [managerB, "manager B"],
      [staffB, "staff B"],
    ] as const) {
      for (const which of ["thumb", "preview", "stream"] as const) {
        const res = await page.request.get(evidenceHref(photo, which), {
          maxRedirects: 0,
        })
        expect(res.status(), `${label} ${which}`).toBe(404)
      }
    }
    // Staff B's own check page works, so the refusals above are about the venue.
    const own = await staffB.goto(staffCaptureHref(checkB))
    expect(own?.status()).toBe(200)
    await expect(
      staffB.getByRole("heading", { name: NOT_FOUND_HEADING.staff })
    ).toHaveCount(0)
    await expect(
      staffB.getByRole("heading", {
        level: 1,
        name: question("guest_toilets"),
        exact: true,
      })
    ).toBeVisible()

    // Nor in their own database sessions.
    for (const person of [w.managerB, w.staffB]) {
      const db = await sessionOf(person)
      for (const name of [
        "amenity_check",
        "amenity_check_submissions",
        "amenity_check_submission_assets",
        "amenity_check_events",
      ] as const) {
        const { data, error } = await amenityRpc(db, name, {
          p_check_id: checkA,
        })
        expect(
          error !== null || (data ?? []).length === 0,
          `${person.name} ${name}`
        ).toBe(true)
      }
      const { data: asset, error } = await amenityRpc(
        db,
        "amenity_evidence_asset",
        { p_asset_id: photo }
      )
      expect(error !== null || (asset ?? []).length === 0).toBe(true)
    }
  })
})
