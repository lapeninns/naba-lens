// @vitest-environment jsdom
// Library cards (admin library and folders, Me's grid) name the dishes a
// file is labelled with, not just a label count (audit finding 13).
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { MediaGrid } from "@/components/nabalens/media-grid"
import { MediaTile, labelDishNames } from "@/components/nabalens/media-tile"
import type { MediaItem } from "@/components/nabalens/types"
import {
  EMPTY_LABEL_SUMMARY,
  type MediaLabelItemView,
  type MediaLabelSummary,
} from "@/lib/menus/types"

afterEach(cleanup)

function dish(
  name: string,
  variantName: string | null = null
): MediaLabelItemView {
  return {
    itemId: `11111111-1111-4111-8111-${name.length.toString().padStart(12, "0")}`,
    variantId: variantName ? "44444444-4444-4444-8444-444444444444" : null,
    name,
    variantName,
    sectionName: "Starters",
    labelledAs: null,
    state: "current",
  }
}

function labels(items: MediaLabelItemView[]): MediaLabelSummary {
  return {
    ...EMPTY_LABEL_SUMMARY,
    revision: 1,
    contentTypes: ["dish"],
    items,
    hasLabels: true,
  }
}

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: null,
    previewUrl: null,
    mimeType: "image/jpeg",
    originalFilename: "IMG_0042.jpg",
    createdAt: "2026-10-30T09:00:00+00:00",
    contributorId: "33333333-3333-4333-8333-333333333333",
    contributorName: "TEST Staff",
    venueName: "TEST Venue",
    labels: labels([dish("Onion Bhaji"), dish("Momo", "Veg")]),
    ...overrides,
  }
}

describe("library cards show dish names", () => {
  it("names each dish, with its variant", () => {
    expect(labelDishNames(item().labels)).toBe("Onion Bhaji, Momo (Veg)")
    expect(labelDishNames(EMPTY_LABEL_SUMMARY)).toBeNull()
    expect(labelDishNames(null)).toBeNull()
    expect(labelDishNames(undefined)).toBeNull()
  })

  it("shows the dishes on an admin library card above who took it", () => {
    render(
      <MediaTile
        item={item()}
        onOpen={() => {}}
        showAttribution
        showLabelBadge
        showFileName
      />
    )
    const caption = screen.getByRole("figure").querySelector("figcaption")!
    const lines = Array.from(caption.children).map((el) => el.textContent)
    expect(lines).toEqual([
      "Labelled: Onion Bhaji, Momo (Veg)",
      "TEST Staff",
      expect.stringContaining("TEST Venue"),
    ])
    // The badge and the button's name are unchanged (count, not names).
    expect(screen.getByText("3 labels")).toBeTruthy()
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(
      /IMG_0042\.jpg.*, 3 labels$/
    )
    // A long list truncates but stays readable in full on hover.
    const line = caption.querySelector('[data-slot="tile-dishes"]')!
    expect(line.getAttribute("title")).toBe("Onion Bhaji, Momo (Veg)")
  })

  it("shows the dishes on Me's grid, which has no attribution", () => {
    render(<MediaTile item={item()} onOpen={() => {}} showLabelBadge />)
    expect(screen.getByRole("figure").textContent).toContain(
      "Onion Bhaji, Momo (Veg)"
    )
  })

  it("shows no dish line without labels, before the file is ready, or where badges are off", () => {
    const cases: [Partial<MediaItem>, boolean][] = [
      [{ labels: EMPTY_LABEL_SUMMARY }, true],
      [{ labels: labels([]) }, true],
      [{ labels: null }, true],
      [{ uploadState: "processing" }, true],
      [{}, false],
    ]
    for (const [over, badge] of cases) {
      render(
        <MediaTile item={item(over)} onOpen={() => {}} showLabelBadge={badge} />
      )
      expect(
        document.querySelector('[data-slot="tile-dishes"]'),
        JSON.stringify(over)
      ).toBeNull()
      expect(screen.getByRole("figure").querySelector("figcaption")).toBeNull()
      cleanup()
    }
  })

  it("names the dishes on every card of a grid", () => {
    render(
      <MediaGrid
        label="Library"
        items={[
          item(),
          item({
            id: "22222222-2222-4222-8222-222222222223",
            labels: labels([dish("Soup")]),
          }),
        ]}
        onOpen={() => {}}
        showLabelBadge
      />
    )
    const figures = screen.getAllByRole("figure")
    expect(within(figures[0]).getByText("Onion Bhaji, Momo (Veg)")).toBeTruthy()
    expect(within(figures[1]).getByText("Soup")).toBeTruthy()
  })
})
