// @vitest-environment jsdom
// Writes whose reply was lost (the call threw: offline, or the response never
// arrived) must say the outcome couldn't be confirmed, never that it failed or
// that nothing changed; the server may have applied it. A refusal from the
// server keeps its definite wording and reason. Each test makes its own
// vi.fn() spy, so call counts never carry over between tests.
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AmenityFactForm,
  AttachPhotosDialog,
  type SubmittablePhoto,
} from "@/components/nabalens/coverage"
import { useAmenityAction } from "@/components/nabalens/amenities/manage/use-amenity-action"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"

import { MANAGER_ID, STAFF_ID, amenityFact } from "./coverage-fixtures"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))

afterEach(cleanup)

type ConfirmHandler = Parameters<typeof ReasonDialog>[0]["onConfirm"]
type AttachHandler = Parameters<typeof AttachPhotosDialog>[0]["onAttach"]
type SaveFactsHandler = Parameters<typeof AmenityFactForm>[0]["onSave"]

/** A fresh spy that rejects like a Server Action whose reply never arrives. */
const lostReply = () =>
  vi.fn(async (): Promise<never> => {
    throw new TypeError("Failed to fetch")
  })

describe("ReasonDialog", () => {
  async function confirm(onConfirm: ConfirmHandler) {
    render(
      <ReasonDialog
        open
        onOpenChange={() => {}}
        title="Ask for another photo"
        label="Reason"
        confirmLabel="Send"
        pendingLabel="Sending…"
        onConfirm={onConfirm}
      />
    )
    const user = userEvent.setup()
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Reason"), "Too dark")
    await user.click(within(dialog).getByRole("button", { name: "Send" }))
    return within(dialog).findByRole("alert")
  }

  it("a lost reply says it couldn't confirm the save", async () => {
    const onConfirm = lostReply()
    const alert = await confirm(onConfirm)
    expect(alert.textContent).toBe(
      "We couldn't confirm this was saved. Check your connection, then try again or refresh to see if it was."
    )
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Too dark")
  })

  it("a refusal shows the caller's definite wording", async () => {
    const onConfirm = vi.fn<ConfirmHandler>(async () => ({
      ok: false,
      error: "Nothing changed. Use up to 500 characters.",
    }))
    const alert = await confirm(onConfirm)
    expect(alert.textContent).toBe("Nothing changed. Use up to 500 characters.")
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe("AttachPhotosDialog", () => {
  const photo: SubmittablePhoto = {
    assetId: "asset-1",
    thumbnailUrl: "/api/media/asset-1/thumb",
    previewUrl: "/api/media/asset-1/preview",
    width: 100,
    height: 100,
    uploadedAt: "2026-10-20T10:00:00.000Z",
    uploadedPeriod: "2026-10",
    uploader: { id: STAFF_ID, displayName: "TEST Sam", active: true },
    countsTowardMonthly: false,
    live: null,
    eligible: true,
    reason: null,
  }

  async function attach(onAttach: AttachHandler) {
    render(
      <AttachPhotosDialog
        requirementTitle="Bar area"
        viewerId={MANAGER_ID}
        onLoad={async () => ({ ok: true, items: [photo], nextCursor: null })}
        onAttach={onAttach}
      />
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Attach existing photos" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      await within(dialog).findByRole("checkbox", { name: /TEST Sam/ })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Attach 1 photo" })
    )
    return dialog
  }

  it("a lost reply says it couldn't confirm the photos were attached", async () => {
    const onAttach = lostReply()
    const dialog = await attach(onAttach)
    expect(
      await within(dialog).findByText(
        "We couldn't confirm the photos were attached. Check your connection, then try again or refresh to see if they were. They won't be attached twice."
      )
    ).toBeTruthy()
    expect(onAttach).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ assetIds: ["asset-1"] })
    )
  })

  it("a refusal gives the server's reason", async () => {
    const onAttach = vi.fn<AttachHandler>(async () => ({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "Choose up to 20 photos.",
    }))
    const dialog = await attach(onAttach)
    expect(
      await within(dialog).findByText("Choose up to 20 photos.")
    ).toBeTruthy()
    expect(onAttach).toHaveBeenCalledTimes(1)
  })
})

describe("AmenityFactForm", () => {
  async function save(onSave: SaveFactsHandler) {
    render(
      <AmenityFactForm
        fact={amenityFact()}
        candidates={[]}
        onSave={onSave}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("radio", { name: "Present" }))
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    return screen.findByRole("alert")
  }

  it("a lost reply's title doesn't claim the save failed", async () => {
    const onSave = lostReply()
    const alert = await save(onSave)
    expect(
      within(alert).getByText("We couldn't confirm the facts were saved")
    ).toBeTruthy()
    expect(alert.textContent).not.toContain("We couldn't save the facts")
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ presence: "present" })
    )
  })

  it("a refusal says it couldn't save, with the server's reason", async () => {
    const onSave = vi.fn<SaveFactsHandler>(async () => ({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "Describe the facts in 500 characters or fewer.",
    }))
    const alert = await save(onSave)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(within(alert).getByText("We couldn't save the facts")).toBeTruthy()
    expect(
      within(alert).getByText("Describe the facts in 500 characters or fewer.")
    ).toBeTruthy()
  })
})

describe("useAmenityAction", () => {
  it("a lost reply says the change couldn't be confirmed", async () => {
    const { result } = renderHook(() => useAmenityAction())
    const call = lostReply()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run(call, "Saved.")
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ ok: false, code: "network" })
    expect(result.current.notice).toEqual({
      tone: "error",
      text: "We couldn't confirm your change was saved. Check your connection, then try again or refresh to see if it was.",
    })
  })

  it("a refusal shows the server's reason", async () => {
    const { result } = renderHook(() => useAmenityAction())
    await act(async () => {
      await result.current.run(
        async () => ({
          ok: false as const,
          code: "invalid_input" as const,
          status: 400 as const,
          message: "Add a note of up to 500 characters.",
        }),
        "Saved."
      )
    })
    expect(result.current.notice).toEqual({
      tone: "error",
      text: "Add a note of up to 500 characters.",
    })
  })
})
