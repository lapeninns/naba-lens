import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import {
  attachShot,
  labelContentTypes,
  seedReadyVideo,
} from "../fixtures/menus/journey-helpers"
import { requireIsolatedStack } from "../e2e/helpers/stack"
import { myPhotoTiles } from "../e2e/helpers/s3-upload"
import { openMyPhotos } from "../e2e/helpers/ui"
import {
  provisionWorld,
  seedReadyAssets,
  signedInPage,
} from "../e2e/helpers/world"

/**
 * Journey menus.d1-video-tile-name (MENUS-D1, docs/qa/menus-qa-report.md §4):
 * a staff member's own photo tiles must keep any visible text inside their
 * accessible name (WCAG 2.5.3 Label in Name). Me's portfolio, where the
 * defect was found, was replaced by My photos (DESIGN.md §5e, D19): its tiles
 * are links named by what the photo is and its mark ("Video, Waiting"), and
 * never by file name.
 */

test.beforeAll(() => requireIsolatedStack())

test("menus.d1-video-tile-name: video and photo tiles name what they show", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const world = await provisionWorld()
  const tag = world.tag
  const labelled = await seedReadyVideo(
    world.staffA.id,
    world.venue1.id,
    `jr-d1-labelled-${tag}.mp4`,
    0.4
  )
  await seedReadyVideo(
    world.staffA.id,
    world.venue1.id,
    `jr-d1-needs-${tag}.mp4`,
    75
  )
  const [photo] = await seedReadyAssets(
    world.staffA.id,
    world.venue1.id,
    1,
    "image",
    `jr-d1-photo-${tag}`
  )
  await labelContentTypes(world.staffA, labelled, ["dish", "venue"])
  await labelContentTypes(world.staffA, photo, ["dish"])

  const page = await signedInPage(browser, world.staffA)
  await openMyPhotos(page)
  const tiles = myPhotoTiles(page)
  // Not vacuous: both video tiles and the photo tile must be on the page.
  await expect(tiles).toHaveCount(3)
  await attachShot(testInfo, "staff-my-photos", page)

  await test.step("axe: no label-content-name-mismatch on any tile", async () => {
    const result = await new AxeBuilder({ page })
      .include('[data-slot="my-photos"]')
      .withRules(["label-content-name-mismatch"])
      .analyze()
    expect(
      result.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))
    ).toEqual([])
  })

  await test.step("every visible line of a tile is part of its accessible name", async () => {
    const named = await tiles.evaluateAll((links) =>
      links.map((link) => ({
        name: link.getAttribute("aria-label") ?? "",
        visible: (link as HTMLElement).innerText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }))
    )
    expect(named).toHaveLength(3)
    for (const { name, visible } of named) {
      expect(name, "every tile has a name").not.toBe("")
      for (const line of visible) {
        expect(name.toLowerCase(), `"${line}" in "${name}"`).toContain(
          line.toLowerCase()
        )
      }
    }
    // Staff tile names leave out file names.
    expect(
      named.every((t) => !t.name.includes("jr-d1-")),
      "no tile name carries a file name"
    ).toBe(true)
    // Each name says what it is and its mark (§5e step 6).
    for (const { name } of named)
      expect(name).toMatch(
        /, (Needs you|Waiting|In the album|Not in the album)$/
      )
  })
})
