// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AmenityFactForm,
  AssigneePicker,
  NewRequirementDialog,
  RequirementList,
  RequirementSetup,
  type CreateRequirementHandler,
  type SetAmenityFactHandler,
  type SetRequirementStatusHandler,
  type UpdateRequirementHandler,
} from "@/components/nabalens/coverage"

import { amenityFact, person, requirement, STAFF_ID } from "./coverage-fixtures"

afterEach(cleanup)
// Pending request ids persist per tab; each test starts with none.
beforeEach(() => window.sessionStorage.clear())

const ok = (revision: number) => ({ ok: true as const, revision })

function setup(overrides: Parameters<typeof requirement>[0] = {}) {
  const onUpdate = vi.fn<UpdateRequirementHandler>(async () => ok(4))
  const onSetStatus = vi.fn<SetRequirementStatusHandler>(async () => ok(5))
  const onStale = vi.fn()
  render(
    <RequirementSetup
      requirement={requirement(overrides)}
      onUpdate={onUpdate}
      onSetStatus={onSetStatus}
      onStale={onStale}
    />
  )
  return { onUpdate, onSetStatus, onStale }
}

describe("RequirementSetup", () => {
  it("confirms a template item applies with the revision shown", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus } = setup()
    expect(
      screen.getByText("Confirm whether this applies and its photo target")
    ).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Confirm: applies, 1 photo" })
    )
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSetStatus).toHaveBeenCalledWith({
      requirementId: requirement().id,
      expectedRevision: 3,
      status: "active",
    })
    expect(await screen.findByText(/Confirmed: 1 photo needed/)).toBeTruthy()
  })

  it("saves an edited target first, then confirms with the new revision", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus } = setup()
    const target = screen.getByLabelText("Photo target")
    await user.clear(target)
    await user.type(target, "4")
    await user.click(
      screen.getByRole("button", { name: "Confirm: applies, 4 photos" })
    )
    expect(onUpdate).toHaveBeenCalledWith({
      requirementId: requirement().id,
      expectedRevision: 3,
      patch: { photoTarget: 4 },
    })
    expect(onSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 4, status: "active" })
    )
  })

  it("rejects a photo target outside 1–200 before calling the server", async () => {
    const user = userEvent.setup()
    const { onUpdate, onSetStatus } = setup()
    const target = screen.getByLabelText("Photo target")
    await user.clear(target)
    await user.type(target, "201")
    await user.click(screen.getByRole("button", { name: /Confirm: applies/ }))
    expect(screen.getByText("Enter a whole number from 1 to 200.")).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSetStatus).not.toHaveBeenCalled()
  })

  it("needs a reason to mark an item not applicable", async () => {
    const user = userEvent.setup()
    const { onSetStatus } = setup()
    await user.click(screen.getByRole("button", { name: "Does not apply" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Mark not applicable" })
    )
    expect(within(dialog).getByText("Give a reason.")).toBeTruthy()
    await user.type(within(dialog).getByLabelText("Reason"), "No bar here")
    await user.click(
      within(dialog).getByRole("button", { name: "Mark not applicable" })
    )
    expect(onSetStatus).toHaveBeenCalledWith({
      requirementId: requirement().id,
      expectedRevision: 3,
      status: "not_applicable",
      reason: "No bar here",
    })
  })

  it("keeps an unknown amenity in verification: no confirm, no exclusion", () => {
    setup({
      kind: "amenity",
      templateKey: "dog_facilities",
      setupIssues: ["fact_unknown"],
      amenity: { presence: "unknown", confirmed: false },
    })
    expect(
      screen.getByText(/Needs verification: record whether it is present/, {
        selector: "p",
      })
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: /Confirm: applies/ })
        .hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen
        .getByRole("button", { name: "Does not apply" })
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
    expect(
      screen
        .getByRole("button", { name: /Confirm: applies/ })
        .hasAttribute("disabled")
    ).toBe(false)
  })

  it("shows a not-applicable reason and offers to include it again", () => {
    setup({
      status: "not_applicable",
      statusReason: "No garden",
      setupIssues: [],
    })
    expect(screen.getByText("No garden")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "It applies after all" })
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
    await user.click(screen.getByRole("button", { name: /Confirm: applies/ }))
    expect(
      await screen.findByText(/Someone else changed this a moment ago/)
    ).toBeTruthy()
    expect(onStale).toHaveBeenCalledTimes(1)
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
  it("cannot confirm unknown, and confirms a known presence", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true as const, revision: 1 }))
    render(
      <AmenityFactForm fact={amenityFact()} candidates={[]} onSave={onSave} />
    )
    const confirm = screen.getByRole("checkbox", {
      name: /I have checked this at the venue/,
    })
    expect(confirm.hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(/never establish accessibility or/)).toBeTruthy()

    await user.click(screen.getByRole("radio", { name: /^Present/ }))
    expect(confirm.hasAttribute("disabled")).toBe(false)
    await user.click(confirm)
    await user.type(
      screen.getByLabelText("Policy (optional)"),
      "Dogs welcome in the bar"
    )
    await user.click(screen.getByRole("button", { name: "Save and confirm" }))
    expect(onSave).toHaveBeenCalledWith({
      templateKey: "dog_facilities",
      expectedRevision: null,
      presence: "present",
      facts: null,
      policy: "Dogs welcome in the bar",
      confirm: true,
      supportingAssetIds: null,
    })
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
      screen.getByText(/Confirmed by TEST Manager on 2 Nov 2026/)
    ).toBeTruthy()
  })
})

describe("AssigneePicker", () => {
  it("treats teams as suggestions and saves the full set", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true as const }))
    render(
      <AssigneePicker
        requirement={requirement({ status: "active" })}
        roster={[
          person(),
          person({ id: "p-boh", displayName: "TEST Kim", department: "boh" }),
          person({ id: "p-none", displayName: "TEST Lee", department: null }),
        ]}
        onSave={onSave}
      />
    )
    expect(screen.getByText(/only suggest who to assign/)).toBeTruthy()
    expect(screen.getByText(/· suggested/)).toBeTruthy()
    await user.click(screen.getByRole("checkbox", { name: /TEST Kim/ }))
    await user.click(screen.getByRole("checkbox", { name: /TEST Sam/ }))
    await user.click(screen.getByRole("button", { name: "Save assignees" }))
    expect(onSave).toHaveBeenCalledWith(["p-boh", STAFF_ID])
  })
})

describe("unsaved edits survive a refresh", () => {
  it("keeps an assignee choice when the page re-renders with the same saved set", async () => {
    const user = userEvent.setup()
    const roster = [person(), person({ id: "p-2", displayName: "TEST Kim" })]
    const props = { roster, onSave: vi.fn() }
    const { rerender } = render(
      <AssigneePicker
        requirement={requirement({ status: "active" })}
        {...props}
      />
    )
    await user.click(screen.getByRole("checkbox", { name: /TEST Kim/ }))
    // A Server Action response re-renders the page with new, equal props.
    rerender(
      <AssigneePicker
        requirement={requirement({ status: "active" })}
        {...props}
      />
    )
    expect(
      (screen.getByRole("checkbox", { name: /TEST Kim/ }) as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(screen.getByText("1 person selected")).toBeTruthy()
    // A changed saved set (someone else saved) replaces the choice.
    rerender(
      <AssigneePicker
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
    await user.type(screen.getByLabelText("Guidance for staff"), "Wide shot")
    rerender(<RequirementSetup requirement={requirement()} {...handlers} />)
    expect(
      (screen.getByLabelText("Guidance for staff") as HTMLTextAreaElement).value
    ).toBe("Wide shot")
    rerender(
      <RequirementSetup
        requirement={requirement({ revision: 4, guidance: "Saved elsewhere" })}
        {...handlers}
      />
    )
    expect(
      (screen.getByLabelText("Guidance for staff") as HTMLTextAreaElement).value
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
