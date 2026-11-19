import { expect, type Page } from "@playwright/test"

/**
 * Album parts for the Full App acceptance specs (slice 6). A part
 * (DESIGN.md §5d "A part") shows its shelves as folders; a shelf opened with
 * `?shelf=` shows its slot tiles (`AlbumSlotTile`) on All. The manager world's
 * menu (helpers/manager-world.ts) puts Soup and Salad on `food.starters`,
 * Pie on `food.mains` and Lager on `drinks.more` (lib/album/shelves.ts).
 */
export type MenuShelf = "food.starters" | "food.mains" | "drinks.more"

export function menuShelfPath(shelf: MenuShelf) {
  const kind = shelf.split(".")[0]!
  return `/staff/album/menu?kind=${kind}&shelf=${shelf}`
}

/** Opens Album's Menu on one shelf, its slot tiles on screen. */
export async function openMenuShelf(page: Page, shelf: MenuShelf) {
  await page.goto(menuShelfPath(shelf))
  await expect(page.locator('[data-slot="album-part"]')).toBeVisible()
}

/** Opens Album's Menu part: its shelves as folders and its "n still empty of N". */
export async function openMenuPart(page: Page) {
  await page.goto("/staff/album/menu")
  await expect(page.locator('[data-slot="album-part"]')).toBeVisible()
}

/** A part's or shelf's "n still empty of N" (one slot at least still empty). */
export async function partCount(
  page: Page
): Promise<{ empty: number; total: number }> {
  const line = page
    .locator('[data-slot="album-part"]')
    .getByText(/^\d+ still empty of \d+$/)
    .first()
  await expect(line).toBeVisible()
  const m = /(\d+) still empty of (\d+)/.exec((await line.textContent()) ?? "")!
  return { empty: Number(m[1]), total: Number(m[2]) }
}
