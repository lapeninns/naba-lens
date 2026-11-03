import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../support/identities"
import {
  provisionCoverageWorld,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { provisioner, psql } from "./helpers/stack"
import { escape } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Manage · Checklist (M9), item setup (M10), amenity facts (M11) and "does
 * not apply" (M12) in the built app. The admin grants and the manager
 * prepares the month through PostgREST as themselves; every checked decision
 * is made on the pages and read back with psql.
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

type Item = { id: string; title: string }

/** A granted manager with venue 1's month prepared, on a signed-in page. */
async function preparedVenue(browser: Parameters<typeof signedInPage>[0]) {
  const w = await provisionCoverageWorld()
  const service = provisioner()
  const admin = await signIn(service, w.admin.email)
  const manager = await signIn(service, w.manager.email)
  await ok(
    admin.rpc("grant_venue_manager", {
      p_staff_id: w.manager.id,
      p_venue_id: w.venue1.id,
    })
  )
  await ok(manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }))
  const page = await signedInPage(browser, w.manager)
  return { w, page }
}

/** Needs-setup items of one kind at venue 1, by title. */
function itemsOf(w: CoverageWorld, kind: "amenity" | "service"): Item[] {
  const rows = psql(
    `select id || '|' || title from public.coverage_requirements where venue_id = '${w.venue1.id}'::uuid and kind = '${kind}' and status = 'needs_setup' order by title`
  )
  return rows
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [id, title] = row.split("|")
      return { id: id!, title: title! }
    })
}

const statusOf = (id: string) =>
  psql(
    `select status || ':' || coalesce(status_reason, '-') from public.coverage_requirements where id = '${id}'::uuid`
  )

/** "presence:confirmed:confirmed by" for the amenity behind a requirement. */
const factOf = (id: string) =>
  psql(
    `select f.presence || ':' || (f.confirmed_at is not null)::text || ':' || coalesce(f.confirmed_by::text, '-') from public.venue_amenity_facts f join public.coverage_requirements r on r.venue_id = f.venue_id and r.amenity_key = f.amenity_key where r.id = '${id}'::uuid`
  )

async function recordFacts(
  page: Page,
  item: Item,
  presence: RegExp,
  checked: boolean
) {
  await page.getByRole("button", { name: "Record facts" }).click()
  const facts = page.getByRole("dialog", { name: `${item.title} facts` })
  await facts.getByRole("radio", { name: presence }).click()
  const check = facts.getByRole("checkbox", {
    name: /I have checked this at the venue/,
  })
  await expect(check).toBeEnabled()
  await check.setChecked(checked)
  await facts.getByRole("button", { name: "Save facts" }).click()
  await expect(facts).toBeHidden()
}

test.describe("Manage · Checklist M9–M12", () => {
  test.setTimeout(180_000)

  test("M9 lists every item with amenities first; M11 confirms an amenity only after the explicit check; M10 then confirms the item", async ({
    browser,
  }) => {
    const { w, page } = await preparedVenue(browser)
    const [amenity] = itemsOf(w, "amenity")
    expect(amenity, "a prepared amenity").toBeDefined()

    // M9: the list, in the copy deck's words, amenities before the rest.
    await page.goto("/staff/manage/checklist")
    await expect(
      page.getByRole("heading", { name: "Checklist", exact: true })
    ).toBeVisible()
    await expect(
      page
        .getByRole("main")
        .getByText(
          `Every item ${w.venue1.name} photographs this month. Items needing setup come first. Not applicable and retired items stay listed and aren't counted.`,
          { exact: true }
        )
    ).toBeVisible()
    const amenities = page.getByRole("list", { name: "Amenities" })
    const services = page.getByRole("list", { name: "Venue and service areas" })
    await expect(amenities).toBeVisible()
    await expect(services).toBeVisible()
    expect(
      await amenities.evaluate(
        (a, s) =>
          !!s &&
          (a.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        await services.elementHandle()
      )
    ).toBe(true)
    await expect(
      page.getByRole("button", { name: "Add a venue-specific item" })
    ).toBeVisible()
    const row = amenities
      .getByRole("listitem")
      .filter({ hasText: amenity!.title })
    await expect(row).toContainText("Needs setup")
    await row.getByRole("link", { name: amenity!.title }).click()
    await expect(page).toHaveURL(
      new RegExp(`/staff/manage/checklist/${amenity!.id}$`)
    )

    // M10/M11: unknown presence blocks confirming and "Does not apply".
    await expect(
      page.getByRole("heading", { name: amenity!.title, exact: true })
    ).toBeVisible()
    await expect(
      page.getByText(
        "Needs verification blocks confirming this item. Record whether it is present."
      )
    ).toBeVisible()
    await expect(
      page.getByText(
        "A photo never proves a claim. Facts are recorded separately, by you."
      )
    ).toBeVisible()
    const confirm = page.getByRole("button", { name: "Save and confirm" })
    await expect(confirm).toBeDisabled()
    await expect(
      page.getByText("Can't confirm yet: Needs verification.")
    ).toBeVisible()
    await expect(
      page.getByRole("radio", { name: "Does not apply" })
    ).toBeDisabled()
    await expect(
      page.getByRole("button", {
        name: `Decrease ${amenity!.title} photo target`,
      })
    ).toBeVisible()
    await expect(
      page.getByRole("button", {
        name: `Increase ${amenity!.title} photo target`,
      })
    ).toBeVisible()

    // Needs verification can never carry the check.
    await page.getByRole("button", { name: "Record facts" }).click()
    const facts = page.getByRole("dialog", { name: `${amenity!.title} facts` })
    await expect(
      facts.getByRole("radio", { name: /^Needs verification/ })
    ).toBeChecked()
    await expect(
      facts.getByRole("checkbox", { name: /I have checked this at the venue/ })
    ).toBeDisabled()
    await expect(
      facts.getByText(
        "While it needs verification, the item can't be confirmed. Staff can still send photos."
      )
    ).toBeVisible()
    await facts.getByRole("button", { name: "Cancel" }).click()
    await expect(facts).toBeHidden()

    // Present without the check is saved, but not confirmed.
    await recordFacts(page, amenity!, /^Present/, false)
    await expect(
      page.getByText("Facts saved: Present, not checked yet.")
    ).toBeVisible()
    expect(factOf(amenity!.id)).toBe("present:false:-")
    await expect(confirm).toBeDisabled()
    await expect(page.getByText("Not confirmed yet")).toBeVisible()

    // With the check, the manager is recorded as the person who checked it.
    await recordFacts(page, amenity!, /^Present/, true)
    await expect(
      page.getByText("Facts saved: Present. You can confirm the item now.")
    ).toBeVisible()
    expect(factOf(amenity!.id)).toBe(`present:true:${w.manager.id}`)
    await expect(page.getByText(/^Confirmed by you · /)).toBeVisible()
    await expect(confirm).toBeEnabled()
    await expect(page.getByText("Ready to confirm")).toHaveCount(0)
    expect(statusOf(amenity!.id)).toBe("needs_setup:-")

    // M10: confirming makes it count.
    await confirm.click()
    await expect(
      page.getByText(/It now counts toward venue coverage\.$/)
    ).toBeVisible()
    expect(statusOf(amenity!.id)).toBe("active:-")

    await page.context().close()
  })

  test("M11/M12: a checked Not present amenity cannot be confirmed; Does not apply needs a reason, and the item stays listed and uncounted", async ({
    browser,
  }) => {
    const { w, page } = await preparedVenue(browser)
    const [, amenity] = itemsOf(w, "amenity")
    expect(amenity, "a second prepared amenity").toBeDefined()

    await page.goto(`/staff/manage/checklist/${amenity!.id}`)
    await recordFacts(page, amenity!, /^Not present/, true)
    await expect(page.getByText("Facts saved: Not present.")).toBeVisible()
    expect(factOf(amenity!.id)).toBe(`absent:true:${w.manager.id}`)
    await expect(
      page.getByRole("button", { name: "Save and confirm" })
    ).toBeDisabled()
    await expect(
      page.getByText("Can't confirm yet: Not present.")
    ).toBeVisible()

    // M12: a blank reason is refused on the page; nothing changes.
    const doesNotApply = page.getByRole("radio", { name: "Does not apply" })
    await expect(doesNotApply).toBeEnabled()
    await doesNotApply.click()
    const dialog = page.getByRole("dialog", { name: "Mark as not applicable" })
    await expect(
      dialog.getByText(amenity!.title, { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByText(
        "Shown on the checklist with the item. Admins can see it."
      )
    ).toBeVisible()
    await expect(
      dialog.getByText(
        "The item stays on the checklist and isn't counted. Photos already sent stay in Photos."
      )
    ).toBeVisible()
    const mark = dialog.getByRole("button", { name: "Mark as not applicable" })
    await mark.click()
    await expect(
      dialog.getByText(
        "Add a reason. It's shown with the item on the checklist."
      )
    ).toBeVisible()
    await expect(dialog.getByLabel("Reason")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(statusOf(amenity!.id)).toBe("needs_setup:-")

    const reason = `No ${amenity!.title.toLowerCase()} here (${w.tag})`
    await dialog.getByLabel("Reason").fill(reason)
    await mark.click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByText(
        "Marked as not applicable. It stays on the checklist and isn't counted."
      )
    ).toBeVisible()
    expect(statusOf(amenity!.id)).toBe(`not_applicable:${reason}`)
    await expect(page.getByText(reason)).toBeVisible()
    await expect(
      page.getByText(
        "It stays on the checklist so everyone can see why. Choose Applies to set it up again."
      )
    ).toBeVisible()

    // Still on the checklist, with its reason, and outside the count.
    await page.goto("/staff/manage/checklist")
    const row = page
      .getByRole("list", { name: "Amenities" })
      .getByRole("listitem")
      .filter({ hasText: amenity!.title })
    await expect(row).toContainText("Not applicable")
    await expect(row).toContainText(
      new RegExp(`${escape(reason)}\\. Not counted\\.`)
    )
    await expect(page.getByText(/· 1 not applicable/).first()).toBeVisible()

    await page.context().close()
  })

  test("M12 then M10: a not-applicable service item is set up again with Applies and confirmed", async ({
    browser,
  }) => {
    const { w, page } = await preparedVenue(browser)
    const [item] = itemsOf(w, "service")
    expect(item, "a prepared service item").toBeDefined()

    await page.goto(`/staff/manage/checklist/${item!.id}`)
    await page.getByRole("radio", { name: "Does not apply" }).click()
    const dialog = page.getByRole("dialog", { name: "Mark as not applicable" })
    await dialog.getByLabel("Reason").fill(`Closed for refit (${w.tag})`)
    await dialog.getByRole("button", { name: "Mark as not applicable" }).click()
    await expect(dialog).toBeHidden()
    expect(statusOf(item!.id)).toBe(
      `not_applicable:Closed for refit (${w.tag})`
    )

    await page.getByRole("radio", { name: "Applies" }).click()
    await page.getByRole("button", { name: "Save and confirm" }).click()
    await expect(
      page.getByText(/It now counts toward venue coverage\.$/)
    ).toBeVisible()
    expect(statusOf(item!.id)).toMatch(/^active:/)

    await page.context().close()
  })
})
