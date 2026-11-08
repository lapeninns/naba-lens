// @vitest-environment jsdom
// Writes whose reply was lost (the call threw: offline, or the response never
// arrived) must say the outcome couldn't be confirmed, never that it failed or
// that nothing changed; the server may have applied it. A refusal from the
// server keeps its definite wording and reason.
//
// Lost replies are plain async functions that throw, not vi.fn() rejections:
// Vitest's spy reports an async rejection as a test error even when the
// component catches it.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import {
  AmenityFactForm,
  AttachPhotosDialog,
  type SubmittablePhoto,
} from "@/components/nabalens/coverage"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"

import { MANAGER_ID, STAFF_ID, amenityFact } from "./coverage-fixtures"

afterEach(cleanup)

const lostReply = async (): Promise<never> => {
  throw new TypeError("Failed to fetch")
}

describe("ReasonDialog", () => {
  async function confirm(
    onConfirm: Parameters<typeof ReasonDialog>[0]["onConfirm"]
  ) {
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
    const alert = await confirm(lostReply)
    expect(alert.textContent).toBe(
      "We couldn't confirm this was saved. Check your connection, then try again or refresh to see if it was."
    )
  })

  it("a refusal shows the caller's definite wording", async () => {
    const alert = await confirm(async () => ({
      ok: false,
      error: "Nothing changed. Use up to 500 characters.",
    }))
    expect(alert.textContent).toBe("Nothing changed. Use up to 500 characters.")
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

  async function attach(
    onAttach: Parameters<typeof AttachPhotosDialog>[0]["onAttach"]
  ) {
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
    const dialog = await attach(lostReply)
    expect(
      await within(dialog).findByText(
        "We couldn't confirm the photos were attached. Check your connection, then try again or refresh to see if they were. They won't be attached twice."
      )
    ).toBeTruthy()
  })

  it("a refusal gives the server's reason", async () => {
    const dialog = await attach(async () => ({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "Choose up to 20 photos.",
    }))
    expect(
      await within(dialog).findByText("Choose up to 20 photos.")
    ).toBeTruthy()
  })
})

describe("AmenityFactForm", () => {
  async function save(onSave: Parameters<typeof AmenityFactForm>[0]["onSave"]) {
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
    const alert = await save(lostReply)
    expect(
      within(alert).getByText("We couldn't confirm the facts were saved")
    ).toBeTruthy()
    expect(alert.textContent).not.toContain("We couldn't save the facts")
  })

  it("a refusal says it couldn't save, with the server's reason", async () => {
    const alert = await save(async () => ({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "Describe the facts in 500 characters or fewer.",
    }))
    expect(within(alert).getByText("We couldn't save the facts")).toBeTruthy()
    expect(
      within(alert).getByText("Describe the facts in 500 characters or fewer.")
    ).toBeTruthy()
  })
})
