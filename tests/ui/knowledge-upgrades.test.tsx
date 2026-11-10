// @vitest-environment jsdom
// B03 UI design §8.3: a schema upgrade, dry run first.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UpgradeControl } from "@/components/nabalens/knowledge/upgrade-control"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const counts = {
  answers: 12,
  lossless: 9,
  needsChecking: 2,
  alreadyUpgraded: 1,
  currentSchema: 0,
}

describe("schema upgrades", () => {
  it("shows the dry run's counts, then applies behind a confirmation", async () => {
    const user = userEvent.setup()
    const onRun = vi.fn(
      async ({ mode }: { key: string; mode: "dry_run" | "apply" }) =>
        mode === "dry_run"
          ? { ok: true as const, result: { runId: "r1", mode, counts } }
          : {
              ok: true as const,
              result: {
                runId: "r2",
                mode,
                counts,
                derived: 9,
                rechecksOpened: 2,
              },
            }
    )
    render(
      <UpgradeControl
        questions={[{ key: "onsite_parking", label: "⟨Parking question⟩" }]}
        onRun={onRun}
      />
    )
    expect(screen.queryByRole("button", { name: "Apply upgrade" })).toBeNull()
    await user.selectOptions(
      screen.getByLabelText("Question"),
      "⟨Parking question⟩"
    )
    await user.click(screen.getByRole("button", { name: "Start dry run" }))
    expect(onRun).toHaveBeenCalledWith({
      key: "onsite_parking",
      mode: "dry_run",
    })
    expect(
      await screen.findByText(
        "12 answers · 9 kept, with details not recorded · 2 need checking again · 1 already upgraded · 0 already on the new form"
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Apply upgrade" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Apply this upgrade?",
    })
    await user.click(within(dialog).getByRole("button", { name: "Apply" }))
    expect(onRun).toHaveBeenLastCalledWith({
      key: "onsite_parking",
      mode: "apply",
    })
    expect(
      await screen.findByText(
        "Upgraded. 9 kept, with details not recorded. 2 rechecks opened."
      )
    ).toBeTruthy()
  })

  it("asks for a question first, and says a lost apply must be dry-run again", async () => {
    const user = userEvent.setup()
    const onRun = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: { runId: "r1", mode: "dry_run", counts },
      })
      .mockRejectedValueOnce(new Error("network"))
    render(
      <UpgradeControl
        questions={[{ key: "onsite_parking", label: "⟨Parking question⟩" }]}
        onRun={onRun}
      />
    )
    await user.click(screen.getByRole("button", { name: "Start dry run" }))
    expect(screen.getByText("Choose a question.")).toBeTruthy()
    expect(onRun).not.toHaveBeenCalled()
    await user.selectOptions(
      screen.getByLabelText("Question"),
      "⟨Parking question⟩"
    )
    await user.click(screen.getByRole("button", { name: "Start dry run" }))
    await user.click(
      await screen.findByRole("button", { name: "Apply upgrade" })
    )
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Apply",
      })
    )
    expect(
      await screen.findByText(
        "We couldn't confirm the upgrade ran. Run the dry run again before applying; nothing is upgraded twice."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply upgrade" })).toBeNull()
  })
})
