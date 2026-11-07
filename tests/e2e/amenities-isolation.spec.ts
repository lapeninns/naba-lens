import { expect, test, type Page } from "@playwright/test"

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
  readyCheck,
  seedPhoto,
  sessionOf,
  submitArgs,
} from "./helpers/amenities-world"
import { signedInPage } from "./helpers/world"

/**
 * Two-venue isolation (plan release criterion 5): the same catalogue key holds
 * a different answer at each venue, and venue B's manager and staff cannot
 * read venue A's check, submissions or evidence, in the pages, the evidence
 * routes or their own database session. Unknown and forbidden look the same.
 */

const MANAGE = amenityHrefs("/staff/manage")

async function expectPageNotFound(page: Page, path: string, label: string) {
  const res = await page.goto(path)
  expect(res?.status(), label).toBe(404)
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
    await managerA.goto(MANAGE.check(checkA))
    await expect(
      managerA.getByRole("main").getByText(ANSWER_LABEL.yes, { exact: true })
    ).not.toHaveCount(0)
    await expect(managerA.getByText(reasonB)).toHaveCount(0)
    const managerB = await signedInPage(browser, w.managerB)
    await managerB.goto(MANAGE.check(checkB))
    await expect(managerB.getByText(reasonB)).toBeVisible()

    // Venue B's people get 404 for venue A's pages and evidence.
    const staffB = await signedInPage(browser, w.staffB)
    for (const path of [MANAGE.check(checkA), MANAGE.capture(checkA)]) {
      await expectPageNotFound(managerB, path, `manager B ${path}`)
      // Staff who manage nothing get the manager tools' plain refusal.
      await expectNoVenueAData(staffB, path, venueASecrets)
    }
    for (const [page, label] of [
      [managerB, "manager B"],
      [staffB, "staff B"],
    ] as const) {
      await expectPageNotFound(
        page,
        staffCaptureHref(checkA),
        `${label} staff capture`
      )
      for (const which of ["thumb", "preview", "stream"] as const) {
        const res = await page.request.get(evidenceHref(photo, which), {
          maxRedirects: 0,
        })
        expect(res.status(), `${label} ${which}`).toBe(404)
      }
    }
    // Staff B's own check page works, so the 404s above are about the venue.
    const own = await staffB.goto(staffCaptureHref(checkB))
    expect(own?.status()).toBe(200)

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
