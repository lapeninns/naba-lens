import { execFileSync } from "node:child_process"

import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Page,
  type Route,
} from "@playwright/test"

import { ENTRY_COPY } from "../../components/nabalens/shell/entry-copy"
import { signIn } from "../support/identities"
import { provisionCoverageWorld } from "./helpers/coverage-world"
import { activateMenu, createMenuDraft, ok } from "./helpers/menus"
import { provisioner, psql, requireIsolatedStack } from "./helpers/stack"
import { signedInPage } from "./helpers/world"

/**
 * B05-01 tandoor journey (B02 UI design §9; contracts/b05-01-grouping-scope.md
 * slice B), at phone width in Chromium: Our menu → a dish → three photos, one
 * the server can't process → Replace it with a different photo. The set's one
 * acknowledgement is worded from contribution_group: two saved and a line for
 * the failed photo, then three saved and no line once the replacement is
 * ready. contribution_group reads 3 ready and 1 replaced, and finished only
 * after the replacement is ready. The service role and psql only seed the
 * menu and read state back; every write goes through the app.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium",
    "The tandoor journey runs once, at phone width in Chromium"
  )
})

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}

type Fixtures = { dir: string; files: Record<string, string> }
const fixtures = JSON.parse(
  execFileSync(process.execPath, ["tests/fixtures/uploads/generate.mjs"], {
    encoding: "utf8",
  })
) as Fixtures
const file = (name: string) => {
  const path = fixtures.files[name.replace(/[.-]/g, "_")]
  if (!path) throw new Error(`fixture ${name} missing`)
  return path
}

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

/** Streaming shows the loading shell first; wait until React swaps the page in. */
async function settled(page: Page) {
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0)
}

/** Clicks `trigger`, which opens the system file picker, and picks `paths`. */
async function pick(page: Page, trigger: () => Promise<void>, paths: string[]) {
  const chooser = page.waitForEvent("filechooser")
  await trigger()
  await (await chooser).setFiles(paths)
}

type Summary = {
  live: number
  ready: number
  inProgress: number
  failed: number
  removed: number
  replaced: number
  finished: boolean
}

test("tandoor set: one forced failure, replaced; one acknowledgement from the server", async ({
  browser,
}) => {
  const w = await provisionCoverageWorld()
  const admin = await signIn(provisioner(), w.admin.email)
  await activateMenu(
    admin,
    await createMenuDraft(admin, w.venue1.id, `Tandoor ${w.tag}`)
  )
  // Pie stands in for the tandoor item: any dish of the active menu.
  const dish = "Pie"

  const page = await signedInPage(browser, w.staffA, PHONE)
  await page.goto("/staff/menu")
  await settled(page)
  const row = page.getByRole("article", { name: dish })
  await pick(
    page,
    () => row.getByRole("button", { name: "Choose from photos" }).click(),
    [file("photo.jpg"), file("photo.png"), file("corrupt.jpg")]
  )

  // The server fails the damaged photo; the notice comes from its read.
  // "Saving 4 photos" while the replacement is listed beside the old row.
  const dialog = page.getByRole("dialog", { name: /^Saving \d photos$/ })
  await expect(dialog).toBeVisible()
  const notices = dialog.locator("div[aria-live=polite]")
  await expect(notices).toContainText(ENTRY_COPY.setSaved(2, dish), {
    timeout: 90_000,
  })
  await expect(notices).toContainText("corrupt.jpg: This file can't be used")

  const group =
    psql(`select m.group_id from public.media_contribution_group_members m
    join public.media_assets a on a.id = m.asset_id
    where a.uploader_id = ${sql(w.staffA.id)} and a.original_filename = 'photo.jpg'`)
  expect(group).toMatch(/^[0-9a-f-]{36}$/)
  expect(
    psql(`select string_agg(a.original_filename || ':' || a.upload_state, ',' order by m.position)
      from public.media_contribution_group_members m
      join public.media_assets a on a.id = m.asset_id where m.group_id = ${sql(group)}`)
  ).toBe("photo.jpg:ready,photo.png:ready,corrupt.jpg:failed")

  // Hold the replacement's bytes, to read the set before it is ready.
  const held: Route[] = []
  await page.route(SIGNED_PUT, (route) => {
    held.push(route)
  })
  await pick(
    page,
    () =>
      dialog
        .getByRole("button", {
          name: ENTRY_COPY.replaceLabel("corrupt.jpg"),
        })
        .click(),
    [file("extra.jpg")]
  )
  // Swapped in at reservation: one link, the old member kept.
  await expect
    .poll(() =>
      psql(
        `select count(*) from public.media_asset_links where group_id = ${sql(group)}`
      )
    )
    .toBe("1")
  await expect.poll(() => held.length).toBeGreaterThan(0)

  const staff = await signIn(provisioner(), w.staffA.email)
  const read = async () =>
    (await ok(
      staff.rpc("contribution_group" as never, { p_group_id: group } as never)
    )) as { summary: Summary }
  expect((await read()).summary).toEqual({
    live: 3,
    ready: 2,
    inProgress: 1,
    failed: 0,
    removed: 0,
    replaced: 1,
    finished: false,
  })

  // Release the held bytes before unrouting: unroute settles pending routes.
  for (const route of held.splice(0)) await route.continue()
  await page.unroute(SIGNED_PUT)

  // One acknowledgement: three saved, no line for the replaced photo.
  await expect(notices).toContainText(ENTRY_COPY.setSaved(3, dish), {
    timeout: 90_000,
  })
  await expect(notices).not.toContainText("corrupt.jpg")
  await expect(notices.getByText(/Each is reviewed on its own/)).toHaveCount(1)
  await expect(
    dialog.getByRole("list", { name: "Files" }).getByText("corrupt.jpg")
  ).toHaveCount(0)
  expect((await read()).summary).toEqual({
    live: 3,
    ready: 3,
    inProgress: 0,
    failed: 0,
    removed: 0,
    replaced: 1,
    finished: true,
  })
  expect(
    psql(`select string_agg(a.original_filename || ':' || a.upload_state, ',' order by m.position)
      from public.media_contribution_group_members m
      join public.media_assets a on a.id = m.asset_id where m.group_id = ${sql(group)}`)
  ).toBe("photo.jpg:ready,photo.png:ready,corrupt.jpg:failed,extra.jpg:ready")

  await page.context().close()
})
