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
  createdAt: "2026-10-28T18:30:00.000Z",
  contributorId: "s1",
  contributorName: "Sam Lee",
  venueName: "Test venue",
}

describe("MediaViewer filenames", () => {
  it("shows a colleague's item with a neutral title and no File row", () => {
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
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Photo by Sam Lee")
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
    expect(screen.queryByText("File")).toBeNull()
  })

  it("keeps the filename in the owner's own view", () => {
    render(
      <MediaViewer
        item={photo}
        open
        onOpenChange={() => {}}
        showAttribution={false}
      />
    )
    expect(screen.getByRole("heading", { name: "Photo" })).toBeTruthy()
    expect(screen.getByText("File")).toBeTruthy()
    expect(screen.getAllByText("Private family party.jpg").length).toBe(2)
    expect(screen.getByRole("img").getAttribute("alt")).toBe(
      "Photo Private family party.jpg"
    )
  })
})
