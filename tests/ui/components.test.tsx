// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { formatDuration } from "@/components/nabalens/format"
import {
  ConfirmDeleteDialog,
  DELETE_CONFIRM_COPY,
  EMPTY_LIBRARY_FILTERS,
  EmptyState,
  InviteStaffDialog,
  LibraryFilters,
  LoginCard,
  MediaGrid,
  MediaViewer,
  PREVIEW_UNAVAILABLE,
  type MediaItem,
} from "@/components/nabalens"

afterEach(cleanup)

const item: MediaItem = {
  id: "m1",
  mediaType: "video",
  uploadState: "ready",
  thumbnailUrl: null,
  previewUrl: "https://example.invalid/clip.mov",
  mimeType: "video/quicktime",
  originalFilename: "clip.mov",
  createdAt: "2026-10-28T18:30:00.000Z",
  contributorId: "s1",
  contributorName: "Test contributor",
  venueName: "Test venue",
  durationSeconds: 42,
}

describe("ConfirmDeleteDialog", () => {
  it("discloses indefinite backup retention and confirms", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    const onOpenChange = vi.fn()
    render(
      <ConfirmDeleteDialog open onOpenChange={onOpenChange} fileName="a.jpg" onConfirm={onConfirm} />
    )
    expect(
      screen.getByText(
        "Remove this file from your portfolio and the admin library? When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."
      )
    ).toBeTruthy()
    expect(DELETE_CONFIRM_COPY).toContain("cannot be recalled")
    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("stays open and shows the server error", async () => {
    const onOpenChange = vi.fn()
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={() => ({ ok: false, error: "Not allowed." })}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Not allowed.")
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe("MediaGrid and EmptyState", () => {
  it("renders keyboard-focusable tiles with a video badge and opens on Enter", async () => {
    const onOpen = vi.fn()
    render(<MediaGrid label="Library" items={[item]} onOpen={onOpen} showAttribution />)
    const tile = screen.getByRole("button", { name: /Video, clip\.mov, by Test contributor, .*, duration 0:42$/ })
    expect(screen.getByText("0:42")).toBeTruthy()
    tile.focus()
    await userEvent.keyboard("{Enter}")
    expect(onOpen).toHaveBeenCalledWith(item)
  })

  it("shows the staff empty-state copy by default", () => {
    render(<EmptyState />)
    expect(
      screen.getByText("Your portfolio starts here. Upload your first photo or video.")
    ).toBeTruthy()
  })
})

describe("formatDuration", () => {
  it("never shows a real clip as 0:00", () => {
    expect(formatDuration(0.2)).toBe("<0:01")
    expect(formatDuration(0.6)).toBe("0:01")
    expect(formatDuration(42)).toBe("0:42")
    expect(formatDuration(3725)).toBe("1:02:05")
  })
})

describe("MediaViewer", () => {
  it("lets the element try a MOV even when canPlayType says no, without autoplay", () => {
    // jsdom's canPlayType returns "" for everything, as Chromium does for
    // video/quicktime although it plays H.264 MOV. No pre-rejection.
    expect(document.createElement("video").canPlayType("video/quicktime")).toBe("")
    render(<MediaViewer item={item} open onOpenChange={() => {}} />)
    const video = document.querySelector("video")!
    expect(video.getAttribute("src")).toBe(item.previewUrl)
    expect(video.querySelector("source")).toBeNull()
    expect(video.autoplay).toBe(false)
    expect(video.controls).toBe(true)
    expect(screen.getByText("Test venue")).toBeTruthy()
  })

  it("shows the explicit fallback when the element cannot decode (HEVC in Chromium)", () => {
    const hevc = { ...item, previewUrl: "https://example.invalid/clip-hevc.mp4", mimeType: "video/mp4" }
    render(<MediaViewer item={hevc} open onOpenChange={() => {}} />)
    fireEvent.error(document.querySelector("video")!)
    expect(document.querySelector("video")).toBeNull()
    expect(screen.getByText(PREVIEW_UNAVAILABLE)).toBeTruthy()
  })

  it("renders only the actions it is given", () => {
    const photo: MediaItem = { ...item, mediaType: "image", mimeType: "image/jpeg" }
    const { rerender } = render(<MediaViewer item={photo} open onOpenChange={() => {}} />)
    expect(screen.queryByRole("link", { name: /Download original/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull()

    rerender(
      <MediaViewer
        item={photo}
        open
        onOpenChange={() => {}}
        getDownloadHref={() => "/download/m1"}
        onDelete={() => {}}
      />
    )
    expect(screen.getByRole("link", { name: /Download original/ }).getAttribute("href")).toBe(
      "/download/m1"
    )
    expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy()
  })
})

describe("LibraryFilters", () => {
  it("changes the media type and clears all filters", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <LibraryFilters venues={[]} staff={[]} value={EMPTY_LIBRARY_FILTERS} onChange={onChange} />
    )
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Videos" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_LIBRARY_FILTERS, type: "video" })

    rerender(
      <LibraryFilters
        venues={[]}
        staff={[]}
        value={{ venueId: "v1", staffId: null, type: "video" }}
        onChange={onChange}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_LIBRARY_FILTERS)
  })
})

describe("LoginCard", () => {
  it("validates, sends and shows the neutral sent state", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<LoginCard onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in link" }))
    expect(screen.getByText(/Enter the email address/)).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText("Email"), "someone@example.invalid")
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in link" }))
    expect(onSubmit).toHaveBeenCalledWith("someone@example.invalid")
    expect(await screen.findByText("Check your email")).toBeTruthy()
    expect(screen.getByText(/If/).textContent).toContain("has a Naba-Lens account")
  })

  it("explains an expired link", () => {
    render(<LoginCard linkExpired onSubmit={async () => {}} />)
    expect(screen.getByText("That sign-in link has expired")).toBeTruthy()
  })
})

describe("InviteStaffDialog", () => {
  it("reports a partial failure without claiming success", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      status: "partial",
      message: "The invitation email could not be sent.",
    })
    render(
      <InviteStaffDialog
        open
        onOpenChange={() => {}}
        venues={[{ id: "v1", name: "Test venue" }]}
        onSubmit={onSubmit}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Send invitation" }))
    expect(screen.getByText("Enter their name.")).toBeTruthy()
    expect(screen.getByText("Choose a venue.")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText("Name"), "Test person")
    await user.type(screen.getByLabelText("Email"), "Test.Person@Example.invalid ")
    await user.click(screen.getByRole("combobox", { name: "Venue" }))
    await user.click(await screen.findByRole("option", { name: "Test venue" }))
    await user.click(screen.getByRole("button", { name: "Send invitation" }))

    expect(onSubmit).toHaveBeenCalledWith({
      displayName: "Test person",
      email: "test.person@example.invalid",
      jobTitle: "",
      venueId: "v1",
    })
    expect(await screen.findByText("Account created, email not sent")).toBeTruthy()
    expect(screen.getByText("The invitation email could not be sent.")).toBeTruthy()
    expect(screen.queryByText("Invitation sent")).toBeNull()
  })
})
