// @vitest-environment jsdom
// B03 UI design §8.1: Correct the answer.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
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

type FormProps = React.ComponentProps<typeof CorrectionForm>
type Correct = FormProps["correct"]

function setup(
  correct: ReturnType<typeof vi.fn<Correct>> = vi.fn<Correct>(async () =>
    ok(true)
  ),
  {
    before = { headline: "yes", detail: { fees: { kind: "free" } } },
    detailForm = facility,
  }: Partial<Pick<FormProps, "before" | "detailForm">> = {}
) {
  render(
    <CorrectionForm
      checkId={CHECK}
      slotRevision={12}
      venueName="The Old Crown"
      before={before}
      materialFields={["headline"]}
      detailForm={detailForm}
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

describe("a deliberate service stop", () => {
  const lastDayOffered = "2099-12-20"
  const schedule = {
    windows: [{ end: "15:00", start: "12:00" }],
    recurrence: { days: ["sun"], kind: "weekly" },
    effectiveTo: lastDayOffered,
    effectiveFrom: "2099-12-01",
  }
  const service = {
    schema: "service" as const,
    timezone: "Europe/London",
    channels: false,
    broadcasters: null,
  }

  it.each([undefined, schedule])(
    "keeps the stop when saving an unrelated correction (%j)",
    async (currentSchedule) => {
      const before = {
        lastDayOffered,
        ...(currentSchedule ? { schedule: currentSchedule } : {}),
        fees: { kind: "free" },
      }
      const { user, correct } = setup(
        vi.fn<Correct>(async () => ok(false)),
        {
          before: { headline: "yes", detail: before },
          detailForm: service,
        }
      )

      expect(screen.getByText("Nothing has changed yet.")).toBeTruthy()
      expect(
        (
          screen.getByLabelText(
            "Last day offered (optional)"
          ) as HTMLInputElement
        ).value
      ).toBe(lastDayOffered)
      await user.click(screen.getByText("Fees", { selector: "summary" }))
      await user.click(screen.getByRole("radio", { name: "Charged" }))
      expect(
        screen.getByText("Small change: the confirmation stays.")
      ).toBeTruthy()
      await user.type(
        screen.getByLabelText(/Why are you correcting it/),
        "Fee added"
      )
      await user.click(screen.getByRole("button", { name: "Save correction" }))
      await waitFor(() =>
        expect(correct).toHaveBeenCalledWith(
          expect.objectContaining({
            detail: { ...before, fees: { kind: "charged" } },
          })
        )
      )
    }
  )

  it.each(["2099-12-27", ""])(
    "saves an explicit change to the scheduled stop (%j)",
    async (lastDay) => {
      const { user, correct } = setup(undefined, {
        before: { headline: "yes", detail: { lastDayOffered, schedule } },
        detailForm: service,
      })
      fireEvent.change(screen.getByLabelText("Last day offered (optional)"), {
        target: { value: lastDay },
      })
      expect(
        screen.getByText("Last day offered · Needs confirming again")
      ).toBeTruthy()
      await user.type(
        screen.getByLabelText(/Why are you correcting it/),
        "New end date"
      )
      await user.click(screen.getByRole("button", { name: "Save correction" }))
      const openSchedule = {
        effectiveFrom: schedule.effectiveFrom,
        recurrence: schedule.recurrence,
        windows: schedule.windows,
      }
      await waitFor(() =>
        expect(correct).toHaveBeenCalledWith(
          expect.objectContaining({
            detail: lastDay
              ? {
                  lastDayOffered: lastDay,
                  schedule: { ...openSchedule, effectiveTo: lastDay },
                }
              : { schedule: openSchedule },
          })
        )
      )
    }
  )
})
