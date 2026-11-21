import { expect, test } from "@playwright/test"

import {
  addPhotos,
  assetNamed,
  createPlace,
  dishesOn,
  keep,
  labelBySearch,
  labelNow,
  placesOn,
  openAlbum,
  SIZES,
  uploadStateOf,
  waitPosted,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { sha256, syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { signedInPage } from "../helpers/world"

/**
 * AC05 (spec §5.4, FA-3), for posting first (D21, DESIGN.md §6.1): one
 * batch holds two dishes and the garden. All five post at once; on Label
 * photos staff tick each group and give it its own label. Nothing is
 * applied to a photo that was not ticked, and each photo ends up with its
 * group's label only.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

for (const size of ["phone", "narrow", "desktop"] as const) {
  test(`AC05 two dishes and a garden get three independent group labels (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    createPlace(w.venueA, `Garden ${w.tag}`, w.mgrA)
    const files = await Promise.all(
      ["soup-1", "soup-2", "pie-1", "pie-2", "garden"].map((n) =>
        syntheticJpeg(`ac05-${size}-${n}-${w.tag}.jpg`)
      )
    )
    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    await openAlbum(page)
    // Picked newest first: each label must follow the photo ticked, never
    // its place in the pick (S3-E2E-1 E3).
    await addPhotos(page, files.map((f) => f.path).reverse())
    await waitPosted(page, 5)
    const ids = await Promise.all(files.map((f) => assetNamed(f.name)))
    const screen = await labelNow(page)
    const toLabel = screen.getByRole("heading", { name: /^To label/ })
    await expect(toLabel).toHaveText("To label 5")

    // Group 1: photos soup-1 and soup-2 are Soup. Ticking is the choice.
    await labelBySearch(screen, [ids[0]!, ids[1]!], "soup", "Soup")
    await expect(toLabel).toHaveText("To label 3")
    // The Soup label was not carried on to the photos left.
    expect(dishesOn(ids[2]!)).toBe("")
    expect(dishesOn(ids[4]!)).toBe("")

    // Group 2: the two pies.
    await labelBySearch(screen, [ids[2]!, ids[3]!], "pie", "Pie")
    await expect(toLabel).toHaveText("To label 1")

    // Group 3: the garden, a place, alone.
    await labelBySearch(screen, [ids[4]!], "garden", `Garden ${w.tag}`)
    await expect(toLabel).toBeHidden()
    await keep(page, info, `ac05-${size}-labelled`)

    // Each photo has its own group's label, and only that one.
    const expected: [number, string, string][] = [
      [0, "Soup", ""],
      [1, "Soup", ""],
      [2, "Pie", ""],
      [3, "Pie", ""],
      [4, "", `Garden ${w.tag}`],
    ]
    // Each asset holds the bytes of the photo whose name it carries (so a
    // wrong label below is a wrong label, not a renamed file).
    await expect
      .poll(() => Promise.all(ids.map(uploadStateOf)), { timeout: 60_000 })
      .toEqual(ids.map(() => "ready"))
    const stored = await Promise.all(
      ids.map(async (id) => {
        const path = psql(
          `select original_path from public.media_assets where id = '${id}'::uuid`
        )
        const { data, error } = await provisioner()
          .storage.from("media")
          .download(path)
        if (error) throw error
        return sha256(new Uint8Array(await data.arrayBuffer()))
      })
    )
    expect
      .soft(stored, "stored bytes match the file name")
      .toEqual(files.map((f) => f.sha256))
    const want = expected
      .map(([i, dish, place]) => `${files[i]!.name}=${dish}|${place}`)
      .join("; ")
    await expect
      .poll(
        () =>
          ids
            .map((id, i) => `${files[i]!.name}=${dishesOn(id)}|${placesOn(id)}`)
            .join("; "),
        { timeout: 60_000 }
      )
      .toBe(want)
    await page.context().close()
  })
}
