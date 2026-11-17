// @vitest-environment jsdom
// B02-06: staff Home and the task send panel.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SubmitPhotosPanel } from "@/components/nabalens/tasks"
import { ineligibleCopy } from "@/components/nabalens/tasks/copy"
import {
  OFFLINE_SEND,
  STILL_SENDING,
  arrivalNote,
} from "@/components/nabalens/tasks/submit-photos-panel"

import { photo } from "./tasks-fixtures"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("send panel copy (UP-20, UP-22, UP-24)", () => {
  it("says a photo was uploaded for another venue, not taken there", () => {
    expect(ineligibleCopy("wrong_venue")).toBe(
      "Uploaded for a different venue."
    )
  })

  it("counts only processing photos as waiting", () => {
    expect(
      arrivalNote({
        selected: new Set(["a"]),
        waiting: new Set(["b"]),
        blocked: new Set(["c", "d"]),
      })
    ).toBe(
      "1 new photo selected. 1 new photo isn't ready to send yet. 2 new photos can't be sent here; see the reason under each."
    )
  })

  const LIMITS = {
    maxBatchFiles: 10,
    maxParallelUploads: 2,
    maxPhotoBytes: 20 * 1024 * 1024,
    maxVideoBytes: 200 * 1024 * 1024,
  }
  const A = photo({ assetId: "7d000000-0000-4000-8000-00000000000a" })

  function panel(submit = vi.fn(async () => new Promise<never>(() => {}))) {
    return render(
      <SubmitPhotosPanel
        requirementId="6c000000-0000-4000-8000-0000000000aa"
        initialPhotos={{ ok: true, items: [A], nextCursor: null }}
        loadPhotos={vi.fn(async () => ({
          ok: true as const,
          items: [A],
          nextCursor: null,
        }))}
        submit={submit}
        uploader={async () => {}}
        limits={LIMITS}
        onReload={vi.fn()}
        signInHref="/login"
      />
    )
  }

  it("says why Send is off while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    panel()
    const note = screen.getByText(OFFLINE_SEND)
    const send = screen.getByRole("button", { name: /Select photos to send/ })
    expect(send.getAttribute("aria-describedby")).toBe(note.id)
  })

  it("says it is still sending after 15 seconds", () => {
    vi.useFakeTimers()
    panel()
    fireEvent.click(screen.getAllByRole("button", { pressed: false })[0])
    fireEvent.click(screen.getByRole("button", { name: /Send 1 photo/ }))
    expect(screen.queryByText(STILL_SENDING)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByText(STILL_SENDING)).toBeTruthy()
  })
})
