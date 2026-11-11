// @vitest-environment jsdom
// B03 UI design §8.1: Correct the answer.
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }),
}))

import {
  CorrectionForm,
  whatChanges,
} from "@/components/nabalens/knowledge/correction-form"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

const CHECK = "8a000000-0000-4000-8000-000000000101"
const facility = { schema: "facility" as const, places: [] }
const ok = (material: boolean) => ({
  ok: true as const,
  decisionId: "d1",
  material,
  submissionId: material ? "s2" : null,
  slotRevision: 13,
  replayed: false,
})

type Correct = React.ComponentProps<typeof CorrectionForm>["correct"]

function setup(
  correct: ReturnType<typeof vi.fn<Correct>> = vi.fn<Correct>(async () =>
    ok(true)
  )
) {
  render(
    <CorrectionForm
      checkId={CHECK}
      slotRevision={12}
      venueName="The Old Crown"
      before={{ headline: "yes", detail: { fees: { kind: "free" } } }}
      materialFields={["headline"]}
      detailForm={facility}
      correct={correct}
      doneHref="/manager/amenities/c1"
    />
  )
  return { user: userEvent.setup(), correct }
}

describe("what changes", () => {
  it("lists every differing field, the headline always material", () => {
    expect(
      whatChanges(
        { headline: "yes", detail: { fees: { kind: "free" } } },
        { headline: "no", detail: { fees: { kind: "charged" } } },
        ["headline", "detail.availability"]
      )
    ).toEqual([
      {
        field: "headline",
        label: "Answer",
        before: "Yes",
        after: "No",
        material: true,
      },
      {
        field: "fees",
        label: "Fees",
        before: "free",
        after: "charged",
        material: false,
      },
    ])
  })
})

describe("Correct the answer", () => {
  it("starts from the answer in use, marks a material change and sends it keyed with the reason", async () => {
    const { user, correct } = setup()
    expect(
      screen.getByText("You're correcting the answer in use.")
    ).toBeTruthy()
    expect(
      (screen.getByRole("radio", { name: "Yes" }) as HTMLInputElement).checked
    ).toBe(true)
    expect(screen.getByText("Nothing has changed yet.")).toBeTruthy()
    await user.click(screen.getByRole("radio", { name: "No" }))
    expect(screen.getByText("Answer · Needs confirming again")).toBeTruthy()
    expect(
      screen.getByText(
        "This change needs confirming before it's used. Until then readers are told it's awaiting confirmation."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save correction" }))
    expect(correct).not.toHaveBeenCalled()
    expect(screen.getByText("Say why you're correcting it.")).toBeTruthy()
    await user.type(
      screen.getByLabelText(/Why are you correcting it/),
      "⟨Reason⟩"
    )
    await user.click(screen.getByRole("button", { name: "Save correction" }))
    await waitFor(() =>
      expect(correct).toHaveBeenCalledWith({
        checkId: CHECK,
        slotRevision: 12,
        headline: "no",
        detail: null,
        reason: "⟨Reason⟩",
        idempotencyKey: expect.any(String),
      })
    )
    expect(
      await screen.findByText(
        "Corrected. It needs confirming before it's used."
      )
    ).toBeTruthy()
    // The form and its Save are gone: the saved notice has focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status"))
    )
    expect(document.activeElement).not.toBe(document.body)
  })

  it("says a small change keeps the confirmation", async () => {
    const { user } = setup(vi.fn<Correct>(async () => ok(false)))
    await user.click(screen.getByText("Fees", { selector: "summary" }))
    await user.click(screen.getByRole("radio", { name: "Charged" }))
    expect(
      screen.getByText("Small change: the confirmation stays.")
    ).toBeTruthy()
    await user.type(
      screen.getByLabelText(/Why are you correcting it/),
      "⟨Reason⟩"
    )
    await user.click(screen.getByRole("button", { name: "Save correction" }))
    expect(
      await screen.findByText("Corrected. The confirmation stays.")
    ).toBeTruthy()
  })

  it("saves nothing when nothing changed", async () => {
    const { user, correct } = setup()
    await user.type(
      screen.getByLabelText(/Why are you correcting it/),
      "⟨Reason⟩"
    )
    await user.click(screen.getByRole("button", { name: "Save correction" }))
    expect(correct).not.toHaveBeenCalled()
  })

  it("says only a manager account or an admin can correct, and offers Reload on a conflict", async () => {
    const refuse = (code: "not_permitted" | "revision_conflict") =>
      vi.fn(async () => ({
        ok: false as const,
        code,
        status: 403 as const,
        message: "no",
      }))
    let { user } = setup(refuse("not_permitted"))
    await user.click(screen.getByRole("radio", { name: "No" }))
    await user.type(
      screen.getByLabelText(/Why are you correcting it/),
      "⟨Reason⟩"
    )
    await user.click(screen.getByRole("button", { name: "Save correction" }))
    expect(
      await screen.findByText(
        "Only a manager account or an admin can correct answers. Nothing was changed."
      )
    ).toBeTruthy()
    cleanup()
    ;({ user } = setup(refuse("revision_conflict")))
    await user.click(screen.getByRole("radio", { name: "No" }))
    await user.type(
      screen.getByLabelText(/Why are you correcting it/),
      "⟨Reason⟩"
    )
    await user.click(screen.getByRole("button", { name: "Save correction" }))
    expect(
      await screen.findByText(
        "Someone changed this answer since you opened it. Nothing was corrected. Reload to see the latest; your changes are kept on this page."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy()
    expect(
      (
        screen.getByLabelText(
          /Why are you correcting it/
        ) as HTMLTextAreaElement
      ).value
    ).toBe("⟨Reason⟩")
  })
})
