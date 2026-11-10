// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AmenityCheckControl } from "@/app/staff/manage/_shared/screens/amenities-controls"
import { EvidenceTile } from "@/components/nabalens/amenities/evidence-tile"
import {
  AmenityCheckDetail,
  OTHER_REASON_REQUIRED,
  type CheckDetailHandlers,
} from "@/components/nabalens/amenities/manage"
import {
  REOPEN_PRESETS,
  REOPEN_PRESET_LABEL,
  UI_TEXT,
  type AmenityFailure,
} from "@/lib/amenities/contract"

import {
  ARCHIVED,
  BASE,
  STAFF,
  STEP_FREE_CHECK,
  WIFI_CHECK,
  detail,
} from "./amenities-manage-fixtures"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}))

const actions = vi.hoisted(() => ({
  addChecksAction: vi.fn(),
  archiveCheckAction: vi.fn(),
  assignCheckAction: vi.fn(),
  enableAmenitiesAction: vi.fn(),
  reopenCheckAction: vi.fn(),
  restoreCheckAction: vi.fn(),
  setCheckNotesAction: vi.fn(),
}))
vi.mock("@/app/_amenities/actions", () => actions)

afterEach(cleanup)
beforeEach(() => refresh.mockReset())

const ok = async () => ({ ok: true as const, revision: 4 })

function handlers(overrides: Partial<CheckDetailHandlers> = {}) {
  return {
    assign: vi.fn(ok),
    setNotes: vi.fn(ok),
    archive: vi.fn(ok),
    restore: vi.fn(ok),
    reopen: vi.fn(ok),
    ...overrides,
  }
}

const conflict: AmenityFailure = {
  ok: false,
  code: "revision_conflict",
  status: 409,
  message: "Stale.",
  currentRevision: 5,
}

describe("AmenityCheckDetail: status and actions", () => {
  it("shows the brief, rule, progress and answer, and links Capture myself", () => {
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    expect(
      screen.getByText("Photograph the sign with the password covered.")
    ).toBeTruthy()
    const status = screen.getByRole("region", { name: "Where it stands" })
    expect(within(status).getByText("Photo and video")).toBeTruthy()
    expect(within(status).getByText("Complete")).toBeTruthy()
    expect(
      within(status).getByText("Recorded by TEST Sam on 4 Nov 2026")
    ).toBeTruthy()
    const capture = screen.getByRole("link", { name: UI_TEXT.captureMyself })
    expect(capture.getAttribute("href")).toBe(
      `/staff/manage/amenities/${WIFI_CHECK.id}/capture`
    )
  })

  it("makes Capture myself the primary action only for a viewer who can upload", () => {
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    const note = /For new ones, assign this check to staff/
    expect(
      screen.getByRole("link", { name: UI_TEXT.captureMyself }).className
    ).toContain("bg-accent")
    expect(screen.queryByText(note)).toBeNull()
    cleanup()

    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers()}
        canUpload={false}
      />
    )
    const capture = screen.getByRole("link", { name: UI_TEXT.captureMyself })
    expect(capture.className).not.toContain("bg-accent")
    expect(capture.className).toContain("bg-surface-2")
    expect(screen.getByText(note).textContent).toBe(
      `${UI_TEXT.captureMyself} attaches photos and videos already on Naba-Lens. For new ones, assign this check to staff.`
    )
  })

  it("shows the recheck reason and hides Reopen while it needs a recheck", () => {
    render(
      <AmenityCheckDetail
        detail={detail({ check: STEP_FREE_CHECK })}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    expect(screen.getByText("Conditions changed: new ramp")).toBeTruthy()
    expect(screen.getByText("Needs recheck")).toBeTruthy()
    expect(screen.queryByRole("button", { name: UI_TEXT.reopen })).toBeNull()
  })

  it("hides manager actions without permission", () => {
    render(
      <AmenityCheckDetail
        detail={detail({
          assigneeOptions: [],
          permissions: {
            canAssign: false,
            canArchive: false,
            canRestore: false,
            canReopen: false,
            canSubmit: false,
            canAttachLegacy: false,
          },
        })}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    for (const name of [UI_TEXT.reopen, UI_TEXT.archive, UI_TEXT.assign])
      expect(screen.queryByRole("button", { name })).toBeNull()
    expect(
      screen.queryByRole("link", { name: UI_TEXT.captureMyself })
    ).toBeNull()
    expect(screen.queryByRole("region", { name: "Notes" })).toBeNull()
  })

  it("archives, and restores an archived check, with the revision", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    expect(h.archive).toHaveBeenCalledWith({
      checkId: WIFI_CHECK.id,
      revision: WIFI_CHECK.revision,
    })
    cleanup()
    render(
      <AmenityCheckDetail
        detail={detail({
          check: ARCHIVED,
          permissions: { ...detail().permissions, canRestore: true },
        })}
        basePath={BASE}
        handlers={h}
      />
    )
    expect(
      screen.queryByRole("link", { name: UI_TEXT.captureMyself })
    ).toBeNull()
    expect(screen.getByText("Archived")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    expect(h.restore).toHaveBeenCalledWith({
      checkId: ARCHIVED.id,
      revision: ARCHIVED.revision,
    })
  })
})

describe("AmenityCheckDetail: assigning and notes", () => {
  it("reassigns from the options and unassigns, passing the revision", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    const assign = screen.getByRole("button", {
      name: UI_TEXT.assign,
    }) as HTMLButtonElement
    expect(assign.disabled).toBe(true)

    await user.click(screen.getByLabelText("Assignee"))
    const options = await screen.findAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual([
      "TEST Sam (Bartender)",
      "TEST Manager",
    ])
    await user.click(options[1])
    await user.click(screen.getByRole("button", { name: UI_TEXT.assign }))
    expect(h.assign).toHaveBeenCalledWith({
      checkId: WIFI_CHECK.id,
      assigneeId: "1a2b3c4d-1111-4aaa-8bbb-000000000001",
      revision: WIFI_CHECK.revision,
    })
    expect(await screen.findByText("Assigned to TEST Manager.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: UI_TEXT.unassign }))
    expect(h.assign).toHaveBeenLastCalledWith({
      checkId: WIFI_CHECK.id,
      assigneeId: null,
      revision: WIFI_CHECK.revision,
    })
  })

  it("shows a revision conflict and re-reads the page", async () => {
    const user = userEvent.setup()
    const h = handlers({ assign: vi.fn(async () => conflict) })
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.unassign }))
    expect(
      await screen.findByText(/Someone else changed this check/)
    ).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("saves notes and shows the server's field error", async () => {
    const user = userEvent.setup()
    const h = handlers({
      setNotes: vi.fn(async () => ({
        ok: false as const,
        code: "invalid_input" as const,
        status: 400 as const,
        message: "Check the notes.",
        fieldErrors: { notes: "Notes are too long." },
      })),
    })
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    await user.type(
      screen.getByLabelText(/Notes for this venue/),
      "  Key is behind the bar "
    )
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(h.setNotes).toHaveBeenCalledWith({
      checkId: WIFI_CHECK.id,
      notes: "Key is behind the bar",
      revision: WIFI_CHECK.revision,
    })
    expect(await screen.findByText("Notes are too long.")).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("AmenityCheckControl: a re-read after a write", () => {
  const NOTES = () =>
    screen.getByLabelText(/Notes for this venue/) as HTMLTextAreaElement
  const at = (revision: number, notes: string | null = null) =>
    detail({ check: { ...WIFI_CHECK, revision, notes } })

  it("keeps the success notice when the saved notes come back at a new revision", async () => {
    const user = userEvent.setup()
    actions.setCheckNotesAction.mockResolvedValueOnce({ ok: true, revision: 8 })
    const { rerender } = render(
      <AmenityCheckControl detail={at(7)} basePath={BASE} />
    )
    await user.type(NOTES(), "Key is behind the bar ")
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(await screen.findByText("Notes saved.")).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)

    // router.refresh() brings the page back at the new revision.
    rerender(
      <AmenityCheckControl
        detail={at(8, "Key is behind the bar")}
        basePath={BASE}
      />
    )
    expect(screen.getByText("Notes saved.")).toBeTruthy()
    expect(NOTES().value).toBe("Key is behind the bar")
    expect(
      (screen.getByRole("button", { name: "Save notes" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("keeps the conflict notice and the typed notes after the re-read", async () => {
    const user = userEvent.setup()
    actions.setCheckNotesAction.mockResolvedValueOnce(conflict)
    const { rerender } = render(
      <AmenityCheckControl detail={at(7)} basePath={BASE} />
    )
    await user.type(NOTES(), "My unsaved note")
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(
      await screen.findByText(/Someone else changed this check/)
    ).toBeTruthy()

    // Someone else saved other notes meanwhile.
    rerender(
      <AmenityCheckControl detail={at(9, "Their note")} basePath={BASE} />
    )
    expect(screen.getByText(/Someone else changed this check/)).toBeTruthy()
    expect(NOTES().value).toBe("My unsaved note")

    actions.setCheckNotesAction.mockResolvedValueOnce({
      ok: true,
      revision: 10,
    })
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(actions.setCheckNotesAction).toHaveBeenLastCalledWith({
      checkId: WIFI_CHECK.id,
      notes: "My unsaved note",
      revision: 9,
    })
  })

  it("shows the latest saved notes after a re-read when nothing was typed", () => {
    const { rerender } = render(
      <AmenityCheckControl detail={at(7, "Old")} basePath={BASE} />
    )
    rerender(<AmenityCheckControl detail={at(8, "New")} basePath={BASE} />)
    expect(NOTES().value).toBe("New")
  })
})

describe("AmenityCheckDetail: reopening", () => {
  it("offers the presets, requires details for Other and sends the revision", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.reopen }))
    const dialog = await screen.findByRole("dialog", {
      name: "Reopen this check",
    })
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.textContent)
    ).toEqual(REOPEN_PRESETS.map((p) => REOPEN_PRESET_LABEL[p]))

    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.reopen })
    )
    expect(
      within(dialog).getByText("Choose why it needs a recheck.")
    ).toBeTruthy()

    await user.click(within(dialog).getByRole("radio", { name: "Other" }))
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.reopen })
    )
    expect(within(dialog).getByText(OTHER_REASON_REQUIRED)).toBeTruthy()
    expect(h.reopen).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText(/Details/), "Sign moved")
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.reopen })
    )
    expect(h.reopen).toHaveBeenCalledWith({
      checkId: WIFI_CHECK.id,
      revision: WIFI_CHECK.revision,
      preset: "other",
      reason: "Sign moved",
    })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("reopens with a preset alone", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.reopen }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("radio", { name: "Password or QR visible" })
    )
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.reopen })
    )
    expect(h.reopen).toHaveBeenCalledWith({
      checkId: WIFI_CHECK.id,
      revision: WIFI_CHECK.revision,
      preset: "credentials_visible",
      reason: undefined,
    })
  })

  it("closes on a conflict and reports it on the page", async () => {
    const user = userEvent.setup()
    const h = handlers({ reopen: vi.fn(async () => conflict) })
    render(
      <AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.reopen }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("radio", { name: "Wrong area" }))
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.reopen })
    )
    expect(
      await screen.findByText(/Someone else changed this check/)
    ).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe("AmenityCheckDetail: history", () => {
  it("lists submissions with answer, finding, Wi-Fi notes, evidence and the current marker", () => {
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    const subs = screen.getByRole("region", { name: "Submissions" })
    const cards = within(subs).getAllByRole("article")
    expect(cards).toHaveLength(2)
    const current = cards[0]
    expect(within(current).getByText("Current answer")).toBeTruthy()
    expect(
      within(current).getByText(
        "Router in the back bar; signal good in the garden."
      )
    ).toBeTruthy()
    expect(within(current).getByText("Not tested upstairs.")).toBeTruthy()
    const wifi = within(current).getByRole("region", {
      name: "Wi-Fi test (internal)",
    })
    expect(within(wifi).getByText("Garden table 4")).toBeTruthy()
    expect(within(wifi).getByText("52 Mbps")).toBeTruthy()
    expect(
      within(current).getByRole("button", {
        name: "Open Photo 1 from TEST Sam",
      })
    ).toBeTruthy()
    const video = within(current).getByLabelText("Video 2 from TEST Sam")
    expect(video.tagName).toBe("VIDEO")
    expect(video.getAttribute("src")).toBe("/api/amenities/evidence/a2/stream")
    expect(
      within(current).getByRole("img", { name: "Photo no longer available" })
    ).toBeTruthy()

    const earlier = cards[1]
    expect(within(earlier).queryByText("Current answer")).toBeNull()
    expect(within(earlier).getByText("No")).toBeTruthy()
    expect(
      within(earlier).getByText("Router was broken that week.")
    ).toBeTruthy()
    expect(within(earlier).queryByRole("region")).toBeNull()
  })

  it("describes events with who and when", () => {
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    const history = screen.getByRole("region", { name: "History" })
    const items = within(history).getAllByRole("listitem")
    expect(items[0].textContent).toMatch(/Assigned to TEST Sam/)
    // MG-30: the time is named as when the change was recorded.
    expect(items[0].textContent).toMatch(
      /Recorded by TEST Manager · 3 Nov 2026/
    )
    expect(items[1].textContent).toMatch(/Added when Amenities were enabled/)
    expect(items[1].textContent).toMatch(/Recorded · \d/)
  })
})

describe("EvidenceTile", () => {
  it("shows a placeholder for a video without a stream", () => {
    render(
      <EvidenceTile
        item={{
          assetId: "a",
          kind: "video",
          available: true,
          thumbUrl: null,
          previewUrl: null,
          streamUrl: null,
        }}
        label={`Video from ${STAFF.displayName}`}
      />
    )
    expect(screen.getByRole("img", { name: "Video unavailable" })).toBeTruthy()
  })
})
