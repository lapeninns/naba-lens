// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  MediaViewer,
  PREVIEW_UNAVAILABLE,
  type MediaItem,
} from "@/components/nabalens"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

afterEach(cleanup)

const photo: MediaItem = {
  id: "m1",
  mediaType: "image",
  uploadState: "ready",
  thumbnailUrl: null,
  previewUrl: "https://example.invalid/preview.webp",
  mimeType: "image/jpeg",
  originalFilename: null,
  createdAt: "2026-11-02T14:02:00.000Z",
  contributorId: "s1",
  contributorName: "Ellie Morgan",
  venueName: "The Barley Mow",
}

const actionNames = () =>
  Array.from(
    screen
      .getByRole("complementary", { name: "Details" })
      .querySelectorAll("a, button")
  ).map((el) => el.textContent?.trim())

describe("S12 photo viewer", () => {
  it("offers a colleague only Open profile", () => {
    render(
      <MediaViewer
        item={photo}
        open
        onOpenChange={() => {}}
        getPortfolioHref={() => "/staff/people/s1"}
      />
    )
    const details = screen.getByRole("complementary", { name: "Details" })
    expect(within(details).getByText("Ellie Morgan")).toBeTruthy()
    expect(within(details).getByText("Venue at upload")).toBeTruthy()
    expect(within(details).getByText("The Barley Mow")).toBeTruthy()
    expect(within(details).getByText("2 Nov 2026, 14:02")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open profile" }).getAttribute("href")
    ).toBe("/staff/people/s1")
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /labels/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull()
  })

  it("offers the owner Add labels and Delete for an unlabelled photo", async () => {
    const onDelete = vi.fn()
    render(
      <MediaViewer
        item={{ ...photo, labels: EMPTY_LABEL_SUMMARY }}
        open
        onOpenChange={() => {}}
        showAttribution={false}
        onEditLabels={() => {}}
        onDelete={onDelete}
      />
    )
    expect(screen.getByText("None yet. Labels are optional.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add labels" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it("orders the admin actions with Download original first", () => {
    render(
      <MediaViewer
        item={{ ...photo, originalFilename: "IMG_2041.HEIC" }}
        open
        onOpenChange={() => {}}
        getDownloadHref={() => "/download/m1"}
        getPortfolioHref={() => "/admin/staff/s1"}
        onEditLabels={() => {}}
        onDelete={() => {}}
      />
    )
    expect(actionNames()).toEqual([
      "Download original",
      "Add labels",
      "Open profile",
      "Delete",
    ])
  })

  it("shows processing on the dark stage with only Delete for the owner", () => {
    render(
      <MediaViewer
        item={{ ...photo, uploadState: "processing", previewUrl: null }}
        open
        onOpenChange={() => {}}
        showAttribution={false}
        onEditLabels={() => {}}
        onDelete={() => {}}
      />
    )
    expect(
      screen.getByText("Processing. It appears here in a moment.")
    ).toBeTruthy()
    expect(screen.getByText("None yet")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /labels/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("says a video cannot play in this browser", () => {
    render(
      <MediaViewer
        item={{ ...photo, mediaType: "video", previewUrl: null }}
        open
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByText(PREVIEW_UNAVAILABLE)).toBeTruthy()
  })

  it("keeps a photo removed elsewhere on screen with only Close", () => {
    render(
      <MediaViewer
        item={photo}
        open
        onOpenChange={() => {}}
        removed
        getDownloadHref={() => "/download/m1"}
        getPortfolioHref={() => "/staff/people/s1"}
        onEditLabels={() => {}}
        onDelete={() => {}}
      />
    )
    expect(screen.getByRole("status").textContent).toBe(
      "Ellie removed this photo a moment ago."
    )
    expect(actionNames()).toEqual(["Close"])
  })
})
