import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import {
  attachShot,
  labelContentTypes,
  seedReadyVideo,
} from "../fixtures/menus/journey-helpers"
import { requireIsolatedStack } from "../e2e/helpers/stack"
import { portfolioList } from "../e2e/helpers/ui"
import {
  provisionWorld,
  seedReadyAssets,
  signedInPage,
} from "../e2e/helpers/world"

/**
 * Journey menus.d1-video-tile-name (MENUS-D1, docs/qa/menus-qa-report.md §4):
 * staff portfolio tiles must keep their visible text (duration, label badge)
 * inside their accessible name (WCAG 2.5.3 Label in Name). Asserts the correct
 * behaviour, so it fails while the defect exists.
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
  await page.goto("/staff")
  const list = portfolioList(page)
  // Not vacuous: both video tiles and the photo tile must be on the page.
  await expect(
    list.getByRole("button", { name: /^Video, jr-d1-/ })
  ).toHaveCount(2)
  await expect(
    list.getByRole("button", { name: /^Photo, jr-d1-/ })
  ).toHaveCount(1)
  await attachShot(testInfo, "staff-portfolio", page)

  await test.step("axe: no label-content-name-mismatch on any tile", async () => {
    const result = await new AxeBuilder({ page })
      .include('ul[aria-label="Your portfolio"]')
      .withRules(["label-content-name-mismatch"])
      .analyze()
    expect(
      result.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))
    ).toEqual([])
  })

  await test.step("every visible line of a tile is part of its accessible name", async () => {
    const tiles = await list.locator("figure").evaluateAll((figures) =>
      figures.map((figure) => ({
        name: figure.querySelector("button")?.getAttribute("aria-label") ?? "",
        visible: (figure as HTMLElement).innerText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }))
    )
    expect(tiles).toHaveLength(3)
    for (const { name, visible } of tiles) {
      for (const line of visible) {
        expect(name.toLowerCase(), `"${line}" in "${name}"`).toContain(
          line.toLowerCase()
        )
      }
    }
    const video = tiles.find((t) => t.name.includes(`jr-d1-labelled-${tag}`))!
    expect(video.visible).toEqual(expect.arrayContaining(["<0:01"]))
    expect(video.name).toMatch(/duration <0:01, 2 labels$/)
    const needs = tiles.find((t) => t.name.includes(`jr-d1-needs-${tag}`))!
    expect(needs.name).toMatch(/duration 1:15, Needs labels$/)
  })
})
