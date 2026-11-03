// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AmenityFactForm,
  AmenityFactsSection,
  NewRequirementDialog,
  RequirementList,
  RequirementSetup,
  type CreateRequirementHandler,
  type SetAmenityFactHandler,
  type SetAssigneesHandler,
  type SetRequirementStatusHandler,
  type UpdateRequirementHandler,
} from "@/components/nabalens/coverage"

import {
  MANAGER_ID,
  STAFF_ID,
  amenityFact,
  person,
  requirement,
} from "./coverage-fixtures"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

afterEach(cleanup)
// Pending request ids persist per tab; each test starts with none.
beforeEach(() => window.sessionStorage.clear())

const ok = (revision: number) => ({ ok: true as const, revision })

const ROSTER = [
  person({
    id: "p-ward",
    displayName: "TEST Lucy Ward",
    jobTitle: "Supervisor",
  }),
  person({
    id: "p-gurung",
    displayName: "TEST Priya Gurung",
    department: "boh",
    jobTitle: "Chef de partie",
  }),
  person({ id: "p-lama", displayName: "TEST Kiran Lama", department: "boh" }),
]

function setup(
  overrides: Parameters<typeof requirement>[0] = {},
  options: { roster?: typeof ROSTER } = {}
) {
  const onUpdate = vi.fn<UpdateRequirementHandler>(async () => ok(4))
  const onSetStatus = vi.fn<SetRequirementStatusHandler>(async () => ok(5))
  const onSetAssignees = vi.fn<SetAssigneesHandler>(async () => ({
    ok: true as const,
  }))
  const onStale = vi.fn()
  render(
    <RequirementSetup
      requirement={requirement(overrides)}
      venueName="The Railway"
      month="November"
      roster={options.roster ?? ROSTER}
      onUpdate={onUpdate}
      onSetStatus={onSetStatus}
      onSetAssignees={onSetAssignees}
      onStale={onStale}
    />
  )
  return { onUpdate, onSetStatus, onSetAssignees, onStale }
}

const confirmButton = () =>
  screen.getByRole("button", { name: "Save and confirm" })

describe("RequirementSetup", () => {
  it("confirms a template item applies with the revision shown", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus, onSetAssignees } = setup()
    expect(
      screen.getByText("Confirm whether this applies and its photo target")
    ).toBeTruthy()
    expect(screen.getByText("Not confirmed yet")).toBeTruthy()
    await user.click(confirmButton())
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSetAssignees).not.toHaveBeenCalled()
    expect(onSetStatus).toHaveBeenCalledWith({
      requirementId: requirement().id,
      expectedRevision: 3,
      status: "active",
    })
    expect(await screen.findByText(/Confirmed: 1 photo needed/)).toBeTruthy()
  })

  it("saves an edited target first, then confirms with the new revision, then assignees", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus, onSetAssignees } = setup()
    await user.click(
      screen.getByRole("button", { name: "Increase Bar area photo target" })
    )
    await user.click(screen.getByRole("checkbox", { name: /TEST Kiran Lama/ }))
    expect(screen.getByText("Ready to confirm")).toBeTruthy()
    await user.click(confirmButton())
    expect(onUpdate).toHaveBeenCalledWith({
      requirementId: requirement().id,
      expectedRevision: 3,
      patch: { photoTarget: 2 },
    })
    expect(onSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 4, status: "active" })
    )
    expect(onSetAssignees).toHaveBeenCalledWith(["p-lama"])
    expect(onUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      onSetStatus.mock.invocationCallOrder[0]
    )
    expect(onSetStatus.mock.invocationCallOrder[0]).toBeLessThan(
      onSetAssignees.mock.invocationCallOrder[0]
    )
    expect(await screen.findByText(/Confirmed: 2 photos needed/)).toBeTruthy()
  })

  it("rejects a photo target outside 1–200 before calling the server", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus } = setup()
    const target = screen.getByLabelText("Photo target")
    await user.clear(target)
    await user.type(target, "201")
    await user.click(confirmButton())
    expect(screen.getByText("Enter a whole number from 1 to 200.")).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSetStatus).not.toHaveBeenCalled()
  })

  it("needs a reason to mark an item not applicable", async () => {
    const user = userEvent.setup()
    const { onSetStatus } = setup()
    expect(
      screen.getByRole("radiogroup", {
        name: "Does this apply at The Railway?",
      })
    ).toBeTruthy()
    await user.click(screen.getByRole("radio", { name: "Does not apply" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Mark as not applicable",
    })
    expect(within(dialog).getByText("Bar area")).toBeTruthy()
    expect(
      within(dialog).getByText("Venue or service area · The Railway · November")
    ).toBeTruthy()
    expect(
      within(dialog).getByText(
        "Shown on the checklist with the item. Admins can see it."
      )
    ).toBeTruthy()
    expect(
      within(dialog).getByText(
        "The item stays on the checklist and isn't counted. Photos already sent stay in Photos."
      )
    ).toBeTruthy()
    const mark = () =>
      within(dialog).getByRole("button", { name: "Mark as not applicable" })
    await user.click(mark())
    expect(
      within(dialog).getByText(
        "Add a reason. It's shown with the item on the checklist."
      )
    ).toBeTruthy()
    expect(
      within(dialog).getByLabelText("Reason").getAttribute("aria-invalid")
    ).toBe("true")
    expect(onSetStatus).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText("Reason"), "No bar here")
    await user.click(mark())
    expect(onSetStatus).toHaveBeenCalledWith({
      requirementId: requirement().id,
      expectedRevision: 3,
      status: "not_applicable",
      reason: "No bar here",
    })
    expect(
      await screen.findByText(
        "Marked as not applicable. It stays on the checklist and isn't counted."
      )
    ).toBeTruthy()
  })

  it("says Marking… while it marks the item not applicable", async () => {
    const user = userEvent.setup()
    let finish: (value: ReturnType<typeof ok>) => void = () => {}
    const onSetStatus = vi.fn<SetRequirementStatusHandler>(
      () => new Promise((resolve) => (finish = resolve))
    )
    render(
      <RequirementSetup
        requirement={requirement()}
        venueName="The Railway"
        month="November"
        onUpdate={vi.fn()}
        onSetStatus={onSetStatus}
      />
    )
    await user.click(screen.getByRole("radio", { name: "Does not apply" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Mark as not applicable",
    })
    await user.type(within(dialog).getByLabelText("Reason"), "No bar here")
    await user.click(
      within(dialog).getByRole("button", { name: "Mark as not applicable" })
    )
    const busy = within(dialog).getByRole("button", { name: "Marking…" })
    expect(busy.hasAttribute("disabled")).toBe(true)
    finish(ok(5))
    expect(
      await screen.findByText(
        "Marked as not applicable. It stays on the checklist and isn't counted."
      )
    ).toBeTruthy()
  })

  it("keeps an unknown amenity in verification: confirm disabled with its reason, no exclusion", () => {
    setup({
      kind: "amenity",
      templateKey: "dog_facilities",
      setupIssues: ["fact_unknown"],
      amenity: { presence: "unknown", confirmed: false },
    })
    expect(
      screen.getByText("Needs verification: record whether it is present")
    ).toBeTruthy()
    const status = screen.getByText("Can't confirm yet: Needs verification.")
    expect(confirmButton().hasAttribute("disabled")).toBe(true)
    expect(confirmButton().getAttribute("aria-describedby")).toBe(status.id)
    expect(
      screen
        .getByRole("radio", { name: "Does not apply" })
        .hasAttribute("disabled")
    ).toBe(true)
  })

  it("allows an amenity only once it is confirmed present", () => {
    setup({
      kind: "amenity",
      templateKey: "parking",
      setupIssues: ["unconfirmed"],
      amenity: { presence: "present", confirmed: true },
    })
    expect(confirmButton().hasAttribute("disabled")).toBe(false)
  })

  it("shows a not-applicable reason, stays uncounted, and sets it up again from Applies", async () => {
    const user = userEvent.setup()
    const { onSetStatus } = setup({
      status: "not_applicable",
      statusReason: "No garden",
      setupIssues: [],
    })
    expect(screen.getByText("No garden")).toBeTruthy()
    expect(screen.getByText("Not counted")).toBeTruthy()
    expect(
      screen.getByText(
        "It stays on the checklist so everyone can see why. Choose Applies to set it up again."
      )
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Save and confirm" })
    ).toBeNull()
    expect(screen.queryByText("Who photographs it")).toBeNull()
    await user.click(screen.getByRole("radio", { name: "Applies" }))
    expect(screen.getByLabelText("Photo target")).toBeTruthy()
    await user.click(confirmButton())
    expect(onSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", expectedRevision: 3 })
    )
  })

  it("saves changes to a confirmed item without confirming it again", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus, onSetAssignees } = setup({
      status: "active",
      setupIssues: [],
      assigneeIds: ["p-ward"],
    })
    const save = screen.getByRole("button", { name: "Save changes" })
    expect(save.hasAttribute("disabled")).toBe(true)
    await user.click(screen.getByRole("checkbox", { name: /TEST Kiran Lama/ }))
    await user.click(save)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSetStatus).not.toHaveBeenCalled()
    expect(onSetAssignees).toHaveBeenCalledWith(["p-ward", "p-lama"])
    expect(await screen.findByText("Saved. 2 people assigned.")).toBeTruthy()
  })

  it("says overdue is for follow-up and never blocks sending", () => {
    setup({
      status: "active",
      setupIssues: [],
      assigneeIds: ["p-gurung"],
      assignees: [ROSTER[1]],
      due: {
        dueOn: "2026-10-31",
        dueAt: "2026-11-01T00:00:00.000Z",
        label: "Due 31 Oct 2026",
        overdue: true,
      },
      progress: { ...requirement().progress, overdue: true },
    })
    expect(
      screen.getByText(
        "Due 31 Oct 2026. Overdue is for follow-up: TEST can still send photos, and they count once accepted."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Overdue is for follow-up. It never stops anyone sending photos."
      )
    ).toBeTruthy()
  })

  it("says a complete item is complete for the month", () => {
    setup({
      status: "active",
      setupIssues: [],
      assigneeIds: ["p-ward"],
      progress: { ...requirement().progress, accepted: 1, satisfied: true },
    })
    expect(
      screen.getByText(
        "Complete for November. Extra photos still go to Photos and can be accepted."
      )
    ).toBeTruthy()
  })

  it("lists anyone needing reassignment first, then A to Z by surname", () => {
    setup({
      status: "active",
      setupIssues: ["needs_reassignment"],
      needsReassignment: true,
      assigneeIds: ["p-gone", "p-ward"],
      assignees: [
        person({ id: "p-gone", displayName: "TEST Rina Tamang" }),
        ROSTER[0],
      ],
    })
    const names = screen
      .getAllByRole("checkbox")
      .map((box) => box.closest("label")?.textContent ?? "")
    expect(names[0]).toMatch(/^TEST Rina Tamang/)
    expect(names[0]).toContain("Can't be assigned here.")
    expect(names.slice(1).map((n) => n.split(/FOH|BOH/)[0])).toEqual([
      "TEST Priya Gurung",
      "TEST Kiran Lama",
      "TEST Lucy Ward",
    ])
    expect(
      screen.getByText(
        "Teams (FOH/BOH) only suggest who to assign. They do not give anyone extra access."
      )
    ).toBeTruthy()
  })

  it("asks for someone when no one is assigned", () => {
    setup()
    expect(
      screen.getByText("No one is assigned. Choose who photographs this.")
    ).toBeTruthy()
  })

  it("refreshes on a stale revision instead of overwriting", async () => {
    const user = userEvent.setup()
    const onSetStatus = vi.fn<SetRequirementStatusHandler>(async () => ({
      ok: false,
      code: "revision_conflict",
      status: 409,
      message: "Changed.",
      currentRevision: 7,
    }))
    const onStale = vi.fn()
    render(
      <RequirementSetup
        requirement={requirement()}
        onUpdate={vi.fn()}
        onSetStatus={onSetStatus}
        onStale={onStale}
      />
    )
    await user.click(confirmButton())
    expect(
      await screen.findByText(/Someone else changed this a moment ago/)
    ).toBeTruthy()
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("shows a retired item as history only", () => {
    setup({
      kind: "menu_section",
      templateKey: null,
      status: "retired",
      statusReason: "Retired with the old food menu",
      setupIssues: [],
    })
    expect(screen.getByText("Retired")).toBeTruthy()
    expect(screen.getByText("Not counted")).toBeTruthy()
    expect(
      screen.getByText(
        "Retired with the old food menu. Its photos stay in Photos and on people's profiles."
      )
    ).toBeTruthy()
    expect(screen.queryByText("Setup")).toBeNull()
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull()
  })

  it("lets manager-created items be retired but never menu sections", () => {
    setup({ kind: "venue_specific", templateKey: null, status: "active" })
    expect(
      screen.getByRole("button", { name: "Retire this item" })
    ).toBeTruthy()
    expect(screen.getByLabelText("Title")).toBeTruthy()
    cleanup()
    setup({
      kind: "menu_section",
      templateKey: null,
      menuSection: {
        menuPlanId: "p-1",
        menuPlanStatus: "draft",
        menuVersionId: "v-1",
        sectionName: "Starters",
        sectionSlug: "starters",
        sectionKind: "food",
        position: 0,
        itemCount: 6,
      },
    })
    expect(
      screen.queryByRole("button", { name: "Retire this item" })
    ).toBeNull()
    expect(screen.queryByLabelText("Title")).toBeNull()
  })
})

describe("RequirementList", () => {
  it("keeps not-applicable items visible with their reason, outside the count", () => {
    render(
      <RequirementList
        requirements={[
          requirement({
            id: "r-1",
            title: "Garden",
            status: "not_applicable",
            statusReason: "No garden",
            setupIssues: [],
          }),
          requirement({
            id: "r-2",
            title: "Bar area",
            status: "active",
            setupIssues: [],
            progress: {
              target: 2,
              accepted: 2,
              pending: 0,
              needsAnotherPhoto: 0,
              evidenceRemoved: 0,
              satisfied: true,
              overdue: false,
            },
            photoTarget: 2,
          }),
        ]}
        hrefFor={(id) => `/staff/manage/checklist/${id}`}
      />
    )
    expect(screen.getByText("1 of 1 applicable item complete")).toBeTruthy()
    expect(screen.getByText("Not counted. Reason: No garden")).toBeTruthy()
    expect(screen.getByText("Complete")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: /Garden/ }).getAttribute("href")
    ).toBe("/staff/manage/checklist/r-1")
  })

  it("never shows a needs-setup item as complete", () => {
    render(
      <RequirementList
        requirements={[requirement({ photoTarget: 3 })]}
        hrefFor={(id) => id}
      />
    )
    expect(screen.getByText("Needs setup")).toBeTruthy()
    expect(
      screen.getByText(/Suggested target 3 photos,\s*not confirmed yet/)
    ).toBeTruthy()
    expect(screen.queryByText("Complete")).toBeNull()
  })
})

describe("AmenityFactForm", () => {
  it("records a known presence as checked by you, never needs verification", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true as const, revision: 1 }))
    render(
      <AmenityFactForm fact={amenityFact()} candidates={[]} onSave={onSave} />
    )
    const group = screen.getByRole("radiogroup", {
      name: "Dog-related facilities and policy",
    })
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => [r.textContent, r.getAttribute("aria-checked")])
    ).toEqual([
      ["Present", "false"],
      ["Not present", "false"],
      ["Needs verification", "true"],
    ])
    expect(
      screen.getByText(
        "While it needs verification, the item can't be confirmed. Staff can still send photos."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "A photo never proves a claim. Record what you have checked yourself. Last confirmed: never."
      )
    ).toBeTruthy()
    expect(
      screen.getByText("Saved with the facts. Admins can see it.")
    ).toBeTruthy()
    const check = screen.getByRole("checkbox", {
      name: /I have checked this at the venue/,
    })
    expect(check.hasAttribute("disabled")).toBe(true)

    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave.mock.calls[0]).toEqual([
      expect.objectContaining({ presence: "unknown", confirm: false }),
    ])

    await user.click(screen.getByRole("radio", { name: "Not present" }))
    expect(
      screen.getByText(
        "Recorded as not present. Decide on the item whether it still applies; if it doesn't, mark it not applicable."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("radio", { name: "Present" }))
    expect(check.hasAttribute("disabled")).toBe(false)
    expect((check as HTMLInputElement).checked).toBe(false)
    expect(
      screen.getByText(
        "Present, not checked yet. The item can be confirmed once you have checked it."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ presence: "present", confirm: false })
    )
    expect(
      await screen.findByText("Facts saved: Present, not checked yet.")
    ).toBeTruthy()

    await user.click(check)
    expect(
      screen.getByText(
        "Recorded as present by you. You can then confirm the item."
      )
    ).toBeTruthy()
    await user.type(
      screen.getByLabelText("What you checked (optional)"),
      "Bowls by the door"
    )
    await user.type(
      screen.getByLabelText("Policy (optional)"),
      "Dogs welcome in the bar"
    )
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave).toHaveBeenLastCalledWith({
      templateKey: "dog_facilities",
      expectedRevision: null,
      presence: "present",
      facts: "Bowls by the door",
      policy: "Dogs welcome in the bar",
      confirm: true,
      supportingAssetIds: null,
    })
    expect(
      await screen.findByText(
        "Facts saved: Present. You can confirm the item now."
      )
    ).toBeTruthy()
  })

  it("unticks the check when the fact goes back to needs verification", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ok(1))
    render(
      <AmenityFactForm fact={amenityFact()} candidates={[]} onSave={onSave} />
    )
    await user.click(screen.getByRole("radio", { name: "Not present" }))
    const check = screen.getByRole("checkbox", {
      name: /I have checked this at the venue/,
    }) as HTMLInputElement
    await user.click(check)
    expect(check.checked).toBe(true)
    await user.click(screen.getByRole("radio", { name: "Needs verification" }))
    expect(check.checked).toBe(false)
    expect(check.disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ presence: "unknown", confirm: false })
    )
  })

  it("moves through the fact choices with the arrow keys", async () => {
    const user = userEvent.setup()
    render(
      <AmenityFactForm fact={amenityFact()} candidates={[]} onSave={vi.fn()} />
    )
    screen.getByRole("radio", { name: "Needs verification" }).focus()
    await user.keyboard("{ArrowRight}")
    const present = screen.getByRole("radio", { name: "Present" })
    expect(present.getAttribute("aria-checked")).toBe("true")
    expect(document.activeElement).toBe(present)
    await user.keyboard("{ArrowLeft}")
    expect(
      screen
        .getByRole("radio", { name: "Needs verification" })
        .getAttribute("aria-checked")
    ).toBe("true")
  })

  it("says it couldn't save, and that nothing is saved twice, when offline", async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onSave = vi.fn<SetAmenityFactHandler>(async () => {
      throw new Error("offline")
    })
    render(
      <AmenityFactForm
        fact={amenityFact()}
        candidates={[]}
        onSave={onSave}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    )
    await user.click(screen.getByRole("radio", { name: "Present" }))
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("We couldn't save the facts")).toBeTruthy()
    expect(
      within(alert).getByText(
        "Check your connection and try again. Nothing is saved twice."
      )
    ).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it("hands the saved text to the dialog instead of showing it", async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onCancel = vi.fn()
    render(
      <AmenityFactForm
        fact={amenityFact()}
        candidates={[]}
        onSave={vi.fn(async () => ok(1))}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    await user.click(screen.getByRole("radio", { name: "Present" }))
    await user.click(
      screen.getByRole("checkbox", { name: /I have checked this at the venue/ })
    )
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSaved).toHaveBeenCalledWith(
      "Facts saved: Present. You can confirm the item now."
    )
    expect(screen.queryByRole("status")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalled()
  })

  const linked = {
    id: "asset-gone",
    thumbnailUrl: null,
    previewUrl: null,
    width: null,
    height: null,
    available: false,
  }
  const candidate = {
    id: "asset-new",
    thumbnailUrl: "/api/coverage/evidence/asset-new/thumb",
    previewUrl: "/api/coverage/evidence/asset-new/preview",
    width: 320,
    height: 240,
    available: true,
  }
  const savedFact = () =>
    amenityFact({
      id: "fact-1",
      presence: "present",
      revision: 2,
      supportingAssets: [linked],
    })

  it("marks a linked photo it cannot show and sends photos only when they change", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SetAmenityFactHandler>(async () => ok(3))
    render(
      <AmenityFactForm
        fact={savedFact()}
        candidates={[candidate]}
        onSave={onSave}
      />
    )
    expect(
      screen.getByRole("checkbox", { name: /Photo 1\s*Not available/ })
    ).toBeTruthy()
    expect(
      screen.getByText(/deleted or taken by someone who has left/)
    ).toBeTruthy()

    await user.type(screen.getByLabelText("Policy (optional)"), "Dogs in bar")
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave.mock.calls[0][0].supportingAssetIds).toBeNull()

    await user.click(screen.getByRole("checkbox", { name: /Photo 2/ }))
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave.mock.calls[1][0].supportingAssetIds).toEqual([
      "asset-gone",
      "asset-new",
    ])
  })

  it.each([
    ["not_image", "A photo is a video.", "Only photos count."],
    [
      "uploader_inactive",
      "A photo belongs to someone who has left.",
      "The photographer is no longer active.",
    ],
  ] as const)(
    "names a photo refused as %s and unticks it",
    async (reason, message, label) => {
      const user = userEvent.setup()
      const onSave = vi.fn<SetAmenityFactHandler>(async () => ({
        ok: false,
        code: "asset_ineligible",
        status: 409,
        message,
        assetErrors: [{ assetId: "asset-new", reason }],
      }))
      render(
        <AmenityFactForm
          fact={savedFact()}
          candidates={[candidate]}
          onSave={onSave}
        />
      )
      const box = screen.getByRole("checkbox", { name: /Photo 2/ })
      await user.click(box)
      await user.click(screen.getByRole("button", { name: "Save facts" }))
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByText(`Not added: ${label}`)).toBeTruthy()
      expect((box as HTMLInputElement).checked).toBe(false)
      // The linked photo stays ticked.
      expect(
        (
          screen.getByRole("checkbox", {
            name: /Photo 1/,
          }) as HTMLInputElement
        ).checked
      ).toBe(true)
    }
  )

  it("names the one new pick when the refusal does not say which photo", async () => {
    const user = userEvent.setup()
    const message = "A photo belongs to someone who has left."
    const onSave = vi.fn<SetAmenityFactHandler>(async () => ({
      ok: false,
      code: "asset_ineligible",
      status: 409,
      message,
      assetErrors: [],
    }))
    render(
      <AmenityFactForm
        fact={savedFact()}
        candidates={[candidate]}
        onSave={onSave}
      />
    )
    const box = screen.getByRole("checkbox", { name: /Photo 2/ })
    await user.click(box)
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(await screen.findByText(`Not added: ${message}`)).toBeTruthy()
    expect((box as HTMLInputElement).checked).toBe(false)
  })

  it("unticks the new picks and reloads when one was deleted meanwhile", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const onSave = vi.fn<SetAmenityFactHandler>(async () => ({
      ok: false,
      code: "not_found",
      status: 404,
      message: "A photo could not be found. It may have been deleted.",
    }))
    render(
      <AmenityFactForm
        fact={savedFact()}
        candidates={[candidate, { ...candidate, id: "asset-other" }]}
        onSave={onSave}
        onStale={onStale}
      />
    )
    await user.click(screen.getByRole("checkbox", { name: /Photo 2/ }))
    await user.click(screen.getByRole("checkbox", { name: /Photo 3/ }))
    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(
      await screen.findByText(/A photo you just picked is no longer available/)
    ).toBeTruthy()
    expect(screen.queryByText(/Untick the photos marked/)).toBeNull()
    expect(onStale).toHaveBeenCalled()
    const ticked = screen
      .getAllByRole("checkbox", { name: /Photo \d/ })
      .map((box) => (box as HTMLInputElement).checked)
    // The linked "Not available" photo stays; only the new picks are unticked.
    expect(ticked).toEqual([true, false, false])

    await user.click(screen.getByRole("button", { name: "Save facts" }))
    expect(onSave.mock.calls[1][0].supportingAssetIds).toBeNull()
  })

  it("shows who confirmed it and when", () => {
    render(
      <AmenityFactForm
        fact={amenityFact({
          presence: "absent",
          confirmed: true,
          confirmedBy: { id: "m-1", displayName: "TEST Manager" },
          confirmedAt: "2026-11-02T10:00:00.000Z",
          revision: 2,
        })}
        candidates={[]}
        onSave={vi.fn()}
      />
    )
    expect(
      screen.getByText(/Last confirmed: 2 Nov 2026, by TEST Manager\./)
    ).toBeTruthy()
  })
})

describe("AmenityFactsSection", () => {
  it("keeps facts apart from photos and says who confirmed them", () => {
    render(
      <AmenityFactsSection
        requirement={requirement({
          kind: "amenity",
          amenity: { presence: "present", confirmed: true },
        })}
        fact={amenityFact({
          presence: "present",
          confirmed: true,
          confirmedBy: { id: MANAGER_ID, displayName: "TEST Anil" },
          confirmedAt: "2026-10-28T10:00:00.000Z",
        })}
        viewerId={MANAGER_ID}
        form={<p>Form</p>}
      />
    )
    expect(screen.getByText("Present")).toBeTruthy()
    expect(screen.getByText("Confirmed by you · 28 Oct 2026")).toBeTruthy()
    expect(
      screen.getByText(
        "A photo never proves a claim. Facts are recorded separately, by you."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Record facts" })).toBeTruthy()
  })

  it("says needs verification blocks confirming the item", async () => {
    const user = userEvent.setup()
    render(
      <AmenityFactsSection
        requirement={requirement({
          kind: "amenity",
          title: "Accessible toilet",
          amenity: { presence: "unknown", confirmed: false },
        })}
        fact={amenityFact()}
        viewerId={MANAGER_ID}
        form={<p>The facts form</p>}
      />
    )
    expect(
      screen.getByText(
        "Needs verification blocks confirming this item. Record whether it is present."
      )
    ).toBeTruthy()
    expect(screen.getByText("Not confirmed yet")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Record facts" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Accessible toilet facts",
    })
    expect(within(dialog).getByText("The facts form")).toBeTruthy()
  })

  it("closes the facts dialog after a save and says what was saved", async () => {
    const user = userEvent.setup()
    render(
      <AmenityFactsSection
        requirement={requirement({
          kind: "amenity",
          title: "Accessible toilet",
          amenity: { presence: "unknown", confirmed: false },
        })}
        fact={amenityFact()}
        viewerId={MANAGER_ID}
        form={({ onSaved, onCancel }) => (
          <>
            <button
              type="button"
              onClick={() =>
                onSaved("Facts saved: Present. You can confirm the item now.")
              }
            >
              Pretend save
            </button>
            <button type="button" onClick={onCancel}>
              Pretend cancel
            </button>
          </>
        )}
      />
    )
    await user.click(screen.getByRole("button", { name: "Record facts" }))
    await user.click(
      await screen.findByRole("button", { name: "Pretend cancel" })
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Record facts" }))
    await user.click(
      await screen.findByRole("button", { name: "Pretend save" })
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(
      screen.getByText("Facts saved: Present. You can confirm the item now.")
    ).toBeTruthy()
  })
})

describe("unsaved edits survive a refresh", () => {
  it("keeps an assignee choice when the page re-renders with the same saved set", async () => {
    const user = userEvent.setup()
    const roster = [person(), person({ id: "p-2", displayName: "TEST Kim" })]
    const props = {
      roster,
      onUpdate: vi.fn(),
      onSetStatus: vi.fn(),
      onSetAssignees: vi.fn(),
    }
    const { rerender } = render(
      <RequirementSetup
        requirement={requirement({ status: "active" })}
        {...props}
      />
    )
    await user.click(screen.getByRole("checkbox", { name: /TEST Kim/ }))
    // A Server Action response re-renders the page with new, equal props.
    rerender(
      <RequirementSetup
        requirement={requirement({ status: "active" })}
        {...props}
      />
    )
    expect(
      (screen.getByRole("checkbox", { name: /TEST Kim/ }) as HTMLInputElement)
        .checked
    ).toBe(true)
    // A changed saved set (someone else saved) replaces the choice.
    rerender(
      <RequirementSetup
        requirement={requirement({ status: "active", assigneeIds: [STAFF_ID] })}
        {...props}
      />
    )
    expect(
      (screen.getByRole("checkbox", { name: /TEST Sam/ }) as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(
      (screen.getByRole("checkbox", { name: /TEST Kim/ }) as HTMLInputElement)
        .checked
    ).toBe(false)
  })

  it("keeps typed guidance until the item's revision changes", async () => {
    const user = userEvent.setup()
    const handlers = { onUpdate: vi.fn(), onSetStatus: vi.fn() }
    const { rerender } = render(
      <RequirementSetup requirement={requirement()} {...handlers} />
    )
    await user.type(screen.getByLabelText(/^Guidance/), "Wide shot")
    rerender(<RequirementSetup requirement={requirement()} {...handlers} />)
    expect(
      (screen.getByLabelText(/^Guidance/) as HTMLTextAreaElement).value
    ).toBe("Wide shot")
    rerender(
      <RequirementSetup
        requirement={requirement({ revision: 4, guidance: "Saved elsewhere" })}
        {...handlers}
      />
    )
    expect(
      (screen.getByLabelText(/^Guidance/) as HTMLTextAreaElement).value
    ).toBe("Saved elsewhere")
  })
})

describe("NewRequirementDialog", () => {
  it("reuses one request id across retries of the same item", async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn<CreateRequirementHandler>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        requirementId: "new-1",
        replayed: true,
      })
    const onCreated = vi.fn()
    render(<NewRequirementDialog onCreate={onCreate} onCreated={onCreated} />)
    await user.click(
      screen.getByRole("button", { name: "Add a checklist item" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Title"), "Function room")
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    expect(
      await within(dialog).findByText(/Could not reach the server/)
    ).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    expect(onCreate).toHaveBeenCalledTimes(2)
    const [first, second] = onCreate.mock.calls.map(([input]) => input)
    expect(first.requestId).toBe(second.requestId)
    expect(first).toMatchObject({
      kind: "venue_specific",
      title: "Function room",
      photoTarget: 1,
      dueOn: null,
    })
    expect(onCreated).toHaveBeenCalledWith("new-1")
  })

  it("uses a new request id once the details change", async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn<CreateRequirementHandler>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        requirementId: "n-1",
        replayed: false,
      })
    render(<NewRequirementDialog onCreate={onCreate} onCreated={vi.fn()} />)
    await user.click(
      screen.getByRole("button", { name: "Add a checklist item" })
    )
    const dialog = await screen.findByRole("dialog")
    const title = within(dialog).getByLabelText("Title")
    await user.type(title, "Terrace")
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    await within(dialog).findByText(/Could not reach the server/)
    await user.type(title, " bar")
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    const [first, second] = onCreate.mock.calls.map(([input]) => input)
    expect(second.title).toBe("Terrace bar")
    expect(second.requestId).not.toBe(first.requestId)
  })

  it("mints a new request id after the server rejects a reused one", async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn<CreateRequirementHandler>()
      .mockResolvedValueOnce({
        ok: false,
        code: "state_conflict",
        status: 409,
        message: "This request was already used for a different change.",
      })
      .mockResolvedValueOnce({
        ok: true,
        requirementId: "n-2",
        replayed: false,
      })
    const onCreated = vi.fn()
    render(<NewRequirementDialog onCreate={onCreate} onCreated={onCreated} />)
    await user.click(
      screen.getByRole("button", { name: "Add a checklist item" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Title"), "Terrace")
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    expect(
      await within(dialog).findByText(
        /This request changed since it was first sent/
      )
    ).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    const [first, second] = onCreate.mock.calls.map(([input]) => input)
    expect(second.requestId).not.toBe(first.requestId)
    expect(onCreated).toHaveBeenCalledWith("n-2")
  })

  it("disables Add item while the request is in flight", async () => {
    const user = userEvent.setup()
    let finish: (
      value: Awaited<ReturnType<CreateRequirementHandler>>
    ) => void = () => {}
    const onCreate = vi.fn<CreateRequirementHandler>(
      () => new Promise((resolve) => (finish = resolve))
    )
    render(<NewRequirementDialog onCreate={onCreate} onCreated={vi.fn()} />)
    await user.click(
      screen.getByRole("button", { name: "Add a checklist item" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Title"), "Terrace")
    await user.click(within(dialog).getByRole("button", { name: "Add item" }))
    const busy = within(dialog).getByRole("button", { name: "Adding…" })
    expect(busy.hasAttribute("disabled")).toBe(true)
    await user.click(busy)
    expect(onCreate).toHaveBeenCalledTimes(1)
    finish({ ok: true, requirementId: "n-3", replayed: false })
  })

  it("keeps a pending create's request id across a reload", async () => {
    const user = userEvent.setup()
    const lost = vi
      .fn<CreateRequirementHandler>()
      .mockRejectedValue(new Error("offline"))
    const fill = async () => {
      await user.click(
        screen.getByRole("button", { name: "Add a checklist item" })
      )
      const dialog = await screen.findByRole("dialog")
      await user.type(within(dialog).getByLabelText("Title"), "Terrace")
      await user.click(within(dialog).getByRole("button", { name: "Add item" }))
      return dialog
    }
    render(<NewRequirementDialog onCreate={lost} onCreated={vi.fn()} />)
    const dialog = await fill()
    // Disabled while the request is in flight, then re-enabled for a retry.
    expect(
      within(dialog)
        .getByRole("button", { name: "Add item" })
        .hasAttribute("disabled")
    ).toBe(false)
    cleanup()

    const replay = vi.fn<CreateRequirementHandler>(async () => ({
      ok: true,
      requirementId: "new-2",
      revision: 1,
      replayed: true,
    }))
    render(<NewRequirementDialog onCreate={replay} onCreated={vi.fn()} />)
    await fill()
    expect(replay.mock.calls[0][0].requestId).toBe(
      lost.mock.calls[0][0].requestId
    )
  })
})
