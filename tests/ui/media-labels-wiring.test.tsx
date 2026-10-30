// @vitest-environment jsdom
// v0.3 wiring: tile badge (opt-in, ready only, part of the accessible name) and
// the viewer's optional Labels section.
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MediaTile } from "@/components/nabalens/media-tile"
import { MediaViewer } from "@/components/nabalens/media-viewer"
import type { MediaItem } from "@/components/nabalens/types"
import { EMPTY_LABEL_SUMMARY, type MediaLabelSummary } from "@/lib/menus/types"

afterEach(cleanup)

const LABELLED: MediaLabelSummary = {
  revision: 2,
  contentTypes: ["dish"],
  note: "Window table",
  items: [
    {
      itemId: "11111111-1111-4111-8111-111111111111",
      variantId: null,
      name: "Chicken",
      variantName: null,
      sectionName: "Korma",
      labelledAs: null,
      state: "current",
    },
  ],
  missingItem: null,
  hasLabels: true,
  updatedAt: "2026-10-30T10:00:00+00:00",
}

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: null,
    previewUrl: null,
    mimeType: "image/jpeg",
    originalFilename: "dish.jpg",
    createdAt: "2026-10-30T09:00:00+00:00",
    contributorId: "33333333-3333-4333-8333-333333333333",
    contributorName: "TEST Staff",
    venueName: "TEST Venue",
    ...overrides,
  }
}

describe("MediaTile labels badge", () => {
  it("is off by default", () => {
    render(
      <MediaTile
        item={item({ labels: EMPTY_LABEL_SUMMARY })}
        onOpen={() => {}}
      />
    )
    expect(screen.queryByText("Needs labels")).toBe(null)
  })

  it("shows Needs labels / a count and includes it in the name", () => {
    render(
      <MediaTile
        item={item({ labels: EMPTY_LABEL_SUMMARY })}
        onOpen={() => {}}
        showLabelBadge
      />
    )
    expect(screen.getByText("Needs labels")).toBeTruthy()
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(
      /Needs labels$/
    )
    cleanup()
    render(
      <MediaTile
        item={item({ labels: LABELLED })}
        onOpen={() => {}}
        showLabelBadge
      />
    )
    expect(screen.getByText("2 labels")).toBeTruthy()
  })

  it("never shows on unfinished uploads or unknown labels", () => {
    render(
      <MediaTile
        item={item({ uploadState: "processing", labels: EMPTY_LABEL_SUMMARY })}
        onOpen={() => {}}
        showLabelBadge
      />
    )
    expect(screen.queryByText("Needs labels")).toBe(null)
    cleanup()
    render(
      <MediaTile
        item={item({ labels: null })}
        onOpen={() => {}}
        showLabelBadge
      />
    )
    expect(screen.queryByText(/labels?$/)).toBe(null)
  })
})

describe("MediaViewer labels section", () => {
  it("offers Add labels for an unlabelled ready file", async () => {
    const onEditLabels = vi.fn()
    const it0 = item({ labels: EMPTY_LABEL_SUMMARY })
    render(
      <MediaViewer
        item={it0}
        open
        onOpenChange={() => {}}
        onEditLabels={onEditLabels}
      />
    )
    expect(screen.getByRole("region", { name: "Labels" })).toBeTruthy()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Add labels" }))
    expect(onEditLabels).toHaveBeenCalledWith(it0)
  })

  it("shows saved labels with Edit labels", () => {
    render(
      <MediaViewer
        item={item({ labels: LABELLED })}
        open
        onOpenChange={() => {}}
        onEditLabels={() => {}}
      />
    )
    expect(screen.getByRole("button", { name: "Edit labels" })).toBeTruthy()
    expect(screen.getByText("Chicken")).toBeTruthy()
    expect(screen.getByText("Window table")).toBeTruthy()
  })

  it("hides the section for unfinished files and when there is nothing to show", () => {
    render(
      <MediaViewer
        item={item({ uploadState: "failed", labels: LABELLED })}
        open
        onOpenChange={() => {}}
        onEditLabels={() => {}}
      />
    )
    expect(screen.queryByRole("region", { name: "Labels" })).toBe(null)
    cleanup()
    render(
      <MediaViewer item={item({ labels: null })} open onOpenChange={() => {}} />
    )
    expect(screen.queryByRole("region", { name: "Labels" })).toBe(null)
  })
})
