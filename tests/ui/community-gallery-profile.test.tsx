// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MediaItemView } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/_media/actions", () => ({ deleteMedia: vi.fn() }))
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/staff/community/actions", () => ({
  loadCommunityPage: vi.fn(),
}))

import { CommunityGallery } from "@/app/staff/community/community-gallery"

afterEach(cleanup)

const SAM = "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d"

const photo: MediaItemView = {
  id: "m1",
  mediaType: "image",
  uploadState: "ready",
  thumbnailUrl: "https://example.invalid/thumb.webp",
  previewUrl: "https://example.invalid/preview.webp",
  mimeType: "image/webp",
  originalFilename: null,
  createdAt: "2026-11-02T14:02:00.000Z",
  contributorId: SAM,
  contributorName: "Sam Lee",
  venueName: "The Railway",
  width: 64,
  height: 48,
  durationSeconds: null,
  sizeBytes: 4,
  labels: null,
}

function openViewer() {
  fireEvent.click(
    screen.getAllByRole("button", { name: /Photo by Sam Lee/ })[0]
  )
  return screen.getByRole("dialog")
}

describe("Colleague photos: Open profile", () => {
  it("links each photo on Photos to its uploader's profile", () => {
    render(
      <CommunityGallery
        initialPage={{ items: [photo], nextCursor: null }}
        search={{}}
      />
    )
    const viewer = openViewer()
    const link = Array.from(viewer.querySelectorAll("a")).find(
      (a) => a.textContent === "Open profile"
    )
    expect(link?.getAttribute("href")).toBe(`/staff/people/${SAM}`)
  })

  it("offers no Open profile on that person's own profile page", () => {
    render(
      <CommunityGallery
        initialPage={{ items: [photo], nextCursor: null }}
        search={{}}
        uploaderId={SAM}
      />
    )
    const viewer = openViewer()
    expect(viewer.textContent).toContain("Sam Lee")
    expect(viewer.textContent).not.toContain("Open profile")
  })
})
