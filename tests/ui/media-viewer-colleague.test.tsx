// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { MediaViewer, type MediaItem } from "@/components/nabalens"

afterEach(cleanup)

const photo: MediaItem = {
  id: "m1",
  mediaType: "image",
  uploadState: "ready",
  thumbnailUrl: null,
  previewUrl: "https://example.invalid/preview.webp",
  mimeType: "image/jpeg",
  originalFilename: "Private family party.jpg",
  createdAt: "2026-11-02T14:02:00.000Z",
  contributorId: "s1",
  contributorName: "Sam Lee",
  venueName: "Test venue",
  sizeBytes: 4_089_446,
}

describe("MediaViewer filenames", () => {
  it("shows a colleague's item with a neutral title and no file row", () => {
    render(
      <MediaViewer
        item={{ ...photo, originalFilename: null }}
        open
        onOpenChange={() => {}}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Photo by Sam Lee" })
    ).toBeTruthy()
    expect(screen.getByRole("img").getAttribute("alt")).toBe(
      "Photo by Sam Lee, Test venue, uploaded 2 Nov 2026, 14:02"
    )
    expect(screen.queryByText("Original file")).toBeNull()
    expect(screen.queryByText("File")).toBeNull()
    expect(document.body.textContent).not.toContain("Private family party")
  })

  it("titles a colleague's video neutrally, even without attribution", () => {
    render(
      <MediaViewer
        item={{
          ...photo,
          mediaType: "video",
          mimeType: "video/mp4",
          originalFilename: null,
        }}
        open
        onOpenChange={() => {}}
        showAttribution={false}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Video by Sam Lee" })
    ).toBeTruthy()
    expect(screen.queryByText("Original file")).toBeNull()
  })

  it("keeps the original file name out of the owner's own view", () => {
    render(
      <MediaViewer
        item={photo}
        open
        onOpenChange={() => {}}
        showAttribution={false}
        onDelete={() => {}}
        onEditLabels={() => {}}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Photo by Sam Lee" })
    ).toBeTruthy()
    expect(screen.getByText("You")).toBeTruthy()
    expect(screen.queryByText("Original file")).toBeNull()
    expect(document.body.textContent).not.toContain("Private family party")
    expect(screen.getByRole("img").getAttribute("alt")).not.toContain(
      "Private family party"
    )
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull()
  })

  it("shows the original file only beside the admin download", () => {
    render(
      <MediaViewer
        item={photo}
        open
        onOpenChange={() => {}}
        getDownloadHref={() => "/download/m1"}
      />
    )
    expect(screen.getByText("Original file")).toBeTruthy()
    expect(screen.getByText("Private family party.jpg · 3.9 MB")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Download original" })).toBeTruthy()
  })
})
