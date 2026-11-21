import { expect, test } from "@playwright/test"

import { signIn } from "../../support/identities"
import { seedImages } from "../helpers/coverage-world"
import { labelledPhoto, provisionManagerWorld } from "../helpers/manager-world"
import { provisioner, psql, requireIsolatedStack } from "../helpers/stack"
import {
  as,
  closeAll,
  evidence,
  expectNoSidewaysScroll,
  SIZES,
  sql,
} from "./helpers"

/**
 * S5-R2 (Y4, FA-52; DESIGN.md §2 principle 4, §5 Brief, §6.5): the manager
 * reviews against the brief staff were given. A manager asks for a photo of
 * the soup with a brief; a staff member's soup photo then waits on Review in
 * a thumb with that brief, not the section's. A photo of the garden, an area
 * with no request, waits with the Spaces shot template. Phone (390) and
 * desktop (1280).
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

/** The id an insert … returning id gives (psql also prints the command tag). */
const inserted = (statement: string) => psql(statement).split("\n")[0]!

for (const [size, context] of SIZES) {
  test(`S5-R2 Review shows the request's brief for a dish and the Spaces template for an area (${size})`, async ({
    browser,
  }) => {
    const w = await provisionManagerWorld()
    const asked = `Side view showing the mash (${w.tag})`

    // The manager's section brief, which the request's brief must beat.
    const mgrDb = await signIn(provisioner(), w.mgrA.email)
    const set = await mgrDb.rpc(
      "album_brief_set" as never,
      {
        p_venue_id: null,
        p_source: "menu_section",
        p_key: psql(
          `select s.slug from public.menu_items i
         join public.menu_entries e on e.item_id = i.id
         join public.menu_sections s on s.id = e.section_id
         where i.id = ${sql(w.itemsA.soup)}::uuid limit 1`
        ),
        p_brief: `Section words (${w.tag})`,
      } as never
    )
    expect(set.error).toBeNull()
    const request = await mgrDb.rpc(
      "media_request_create" as never,
      {
        p_venue_id: null,
        p_type: "missing_photo",
        p_intended_use: "public",
        p_brief: asked,
        p_slot_kind: "dish",
        p_slot_id: w.itemsA.soup,
      } as never
    )
    expect(request.error).toBeNull()

    await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])

    // A garden photo, labelled after the soup so it comes second.
    const label = `Garden ${w.tag}`
    const garden =
      inserted(`insert into public.knowledge_subjects (venue_id, kind, label, created_by)
      values (${sql(w.venueA.id)}, 'area', ${sql(label)}, ${sql(w.admin.id)}) returning id`)
    const [asset] = await seedImages(w.staffA1, w.venueA, 1, {
      prefix: `DEV-FIXTURE-garden-${w.tag}`,
      colour: "#4b9a5a",
    })
    psql(`insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by, added_at)
      values (${sql(asset!)}, ${sql(w.venueA.id)}, ${sql(garden)}, 'area', ${sql(label)}, ${sql(w.staffA1.id)}, now() + interval '1 minute')`)
    const spaces = psql(
      `select instruction from public.shot_templates where category = 'spaces'`
    )

    const mgr = await as(browser, w.mgrA, context)
    await mgr.goto("/manager/review")
    await expect(
      mgr.getByRole("heading", { level: 2, name: "Soup" })
    ).toBeVisible()
    await expect(mgr.getByText(asked)).toBeVisible()
    await expect(mgr.getByText(`Section words (${w.tag})`)).toHaveCount(0)
    await expectNoSidewaysScroll(mgr, "Review")
    await evidence(mgr, `s5-r2-${size}-dish`)

    await mgr
      .getByRole("button", { name: "Keep in the album", exact: true })
      .click()
    await expect(
      mgr.getByRole("heading", { level: 2, name: label })
    ).toBeVisible()
    await expect(mgr.getByText(spaces)).toBeVisible()
    await evidence(mgr, `s5-r2-${size}-area`)
  })
}
