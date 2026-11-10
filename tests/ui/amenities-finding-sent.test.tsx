// @vitest-environment jsdom
// After a finding is sent from Home's amenity check, Home names the check in a
// notice that stays until dismissed: the capture form itself is unmounted by
// the navigation, so its own "Finding sent" is never seen.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CheckSummary } from "@/lib/amenities/contract"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/staff/tasks/amenities/check/capture",
}))
vi.mock("@/app/_amenities/actions", () => ({
  listSubmittableAssetsAction: vi.fn(),
  submitFindingAction: vi.fn(),
}))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => null,
}))
vi.mock("@/components/nabalens/shell/add-context", () => ({
  useAddQueue: () => null,
  useAddRefreshSignal: () => 0,
}))
vi.mock("@/components/nabalens/amenities/capture", () => ({
  // Stands in for a successful send: the real form calls onDone after it.
  CaptureForm: ({ onDone }: { onDone: () => void }) => (
    <button type="button" onClick={onDone}>
      Send
    </button>
  ),
}))

import { CaptureClient } from "@/app/staff/tasks/amenities/_capture/capture-client"
import {
  FINDING_SENT_PARAM,
  findingSentHref,
} from "@/components/nabalens/amenities/capture/finding-sent"
import { FindingSentNotice } from "@/components/nabalens/amenities/capture/finding-sent-notice"

const CHECK_ID = "3f0c9a52-6b1d-4e2a-9c7f-1d2e3f4a5b6c"
const CHECK = { id: CHECK_ID } as CheckSummary

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, "", "/")
})

function sendFrom(doneHref: string) {
  render(
    <CaptureClient
      check={CHECK}
      viewerId="me"
      initialAssets={{ ok: true, assets: [] }}
      canUpload={false}
      canAttachLegacy={false}
      doneHref={doneHref}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
}

describe("capture: after a successful send", () => {
  it("goes back to Home naming the check that was sent", () => {
    sendFrom("/staff/tasks")
    expect(push).toHaveBeenCalledWith(
      `/staff/tasks?${FINDING_SENT_PARAM}=${CHECK_ID}`
    )
  })

  it("returns a manager or admin to the check page naming the check (CA-15)", () => {
    sendFrom(`/manager/amenities/${CHECK_ID}`)
    expect(push).toHaveBeenCalledWith(
      `/manager/amenities/${CHECK_ID}?${FINDING_SENT_PARAM}=${CHECK_ID}`
    )
  })

  it("goes back to another `from` origin as it is", () => {
    render(
      <CaptureClient
        check={CHECK}
        viewerId="me"
        initialAssets={{ ok: true, assets: [] }}
        canUpload={false}
        canAttachLegacy={false}
        doneHref="/staff/menu"
        announceSent={false}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(push).toHaveBeenCalledWith("/staff/menu")
  })

  it("keeps any query and hash on the href", () => {
    expect(findingSentHref("/staff/tasks?x=1#top", "a b")).toBe(
      "/staff/tasks?x=1&finding_sent=a%20b#top"
    )
  })
})

describe("Home: Finding sent notice", () => {
  it("is a focused polite status naming the check", () => {
    render(
      <FindingSentNotice
        question="Is there step-free access?"
        returnFocusId="todo-heading"
      />
    )
    const notice = screen.getByRole("status")
    // Focus on arrival announces it; a second live region would repeat it.
    expect(notice.getAttribute("aria-live")).toBeNull()
    expect(notice.textContent).toContain("Finding sent")
    expect(notice.textContent).toContain("Is there step-free access?")
    expect(notice.textContent).toContain("The check is complete.")
    expect(document.activeElement).toBe(notice)
  })

  it("stays until dismissed, and a reload after Dismiss does not bring it back", () => {
    window.history.replaceState(
      null,
      "",
      `/staff/tasks?${FINDING_SENT_PARAM}=${CHECK_ID}&x=1`
    )
    render(
      <>
        <FindingSentNotice
          question="Is there step-free access?"
          returnFocusId="todo-heading"
        />
        <h2 id="todo-heading" tabIndex={-1}>
          To do
        </h2>
      </>
    )
    const dismiss = screen.getByRole("button", { name: "Dismiss" })
    dismiss.focus()
    fireEvent.click(dismiss)
    expect(screen.queryByRole("status")).toBeNull()
    // Focus lands on To do, not on the page body.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "To do" })
    )
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/staff/tasks?x=1"
    )
  })
})
