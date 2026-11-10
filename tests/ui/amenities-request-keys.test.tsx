// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AmenitiesOverview,
  AmenityCheckDetail,
  CONFLICT_TEXT,
  NETWORK_ERROR,
  type AmenitiesOverviewHandlers,
  type CheckDetailHandlers,
} from "@/components/nabalens/amenities/manage"
import { UI_TEXT, type AmenityFailure } from "@/lib/amenities/contract"

import {
  ARCHIVED,
  BASE,
  CATALOGUE,
  WIFI_CHECK,
  detail,
  view,
} from "./amenities-manage-fixtures"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/staff/manage/amenities",
}))

afterEach(cleanup)
beforeEach(() => {
  refresh.mockReset()
  sessionStorage.clear()
})

const lost = () => Promise.reject(new TypeError("Failed to fetch"))
const replayed = async () => ({
  ok: true as const,
  revision: 5,
  replayed: true,
})
const ok = async () => ({ ok: true as const, revision: 5 })

/** First call's reply is lost; the retry replays. */
const lostThenReplayed = () =>
  vi.fn<(input: { idempotencyKey: string }) => Promise<never>>()
    .mockImplementationOnce(lost)
    .mockImplementationOnce(replayed as never)

function handlers(overrides: Partial<CheckDetailHandlers> = {}) {
  return {
    assign: vi.fn(ok),
    setNotes: vi.fn(ok),
    archive: vi.fn(ok),
    restore: vi.fn(ok),
    reopen: vi.fn(ok),
    ...overrides,
  } as CheckDetailHandlers
}

const keyOf = (fn: unknown, call: number) =>
  (fn as ReturnType<typeof vi.fn>).mock.calls[call][0].idempotencyKey as string

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function expectReplayed(fn: unknown, success: string) {
  expect(await screen.findByText(success)).toBeTruthy()
  expect(screen.queryByText(/Someone else changed this check/)).toBeNull()
  const calls = (fn as ReturnType<typeof vi.fn>).mock.calls
  expect(calls).toHaveLength(2)
  expect(keyOf(fn, 0)).toMatch(UUID)
  expect(keyOf(fn, 1)).toBe(keyOf(fn, 0))
}

describe("MG-01: a retry after a lost reply replays", () => {
  it("assign", async () => {
    const user = userEvent.setup()
    const h = handlers({ assign: lostThenReplayed() })
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.click(screen.getByLabelText("Assignee"))
    await user.click((await screen.findAllByRole("option"))[1])
    await user.click(screen.getByRole("button", { name: UI_TEXT.assign }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.assign }))
    await expectReplayed(h.assign, "Assigned to TEST Manager.")
  })

  it("unassign", async () => {
    const user = userEvent.setup()
    const h = handlers({ assign: lostThenReplayed() })
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.click(screen.getByRole("button", { name: UI_TEXT.unassign }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.unassign }))
    await expectReplayed(h.assign, "Unassigned.")
  })

  it("notes", async () => {
    const user = userEvent.setup()
    const h = handlers({ setNotes: lostThenReplayed() })
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.type(screen.getByLabelText(/Notes for this venue/), "Key at bar")
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    await expectReplayed(h.setNotes, "Notes saved.")
  })

  it("archive", async () => {
    const user = userEvent.setup()
    const h = handlers({ archive: lostThenReplayed() })
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    await expectReplayed(
      h.archive,
      "Archived. Restore it from the Archived list at any time."
    )
  })

  it("restore on the check", async () => {
    const user = userEvent.setup()
    const h = handlers({ restore: lostThenReplayed() })
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
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    await expectReplayed(h.restore, "Restored.")
  })

  it("reopen, from its dialog", async () => {
    const user = userEvent.setup()
    const h = handlers({ reopen: lostThenReplayed() })
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.click(screen.getByRole("button", { name: UI_TEXT.reopen }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("radio", { name: "Wrong area" }))
    await user.click(within(dialog).getByRole("button", { name: UI_TEXT.reopen }))
    expect(await within(dialog).findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: UI_TEXT.reopen }))
    await expectReplayed(h.reopen, "Reopened: staff will see it as Needs recheck.")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("restore on the overview", async () => {
    const user = userEvent.setup()
    const h: AmenitiesOverviewHandlers = {
      enable: vi.fn(),
      addChecks: vi.fn(),
      restore: lostThenReplayed(),
    }
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    await expectReplayed(h.restore, `Restored “${ARCHIVED.entry.question}”.`)
  })

  it("add from the catalogue", async () => {
    const user = userEvent.setup()
    const addChecks = vi
      .fn<AmenitiesOverviewHandlers["addChecks"]>()
      .mockImplementationOnce(lost)
      .mockImplementationOnce(async () => ({
        ok: true,
        checkIds: ["c1"],
        replayed: true,
      }))
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={{ enable: vi.fn(), addChecks, restore: vi.fn() }}
      />
    )
    await user.click(
      screen.getByRole("button", { name: UI_TEXT.addFromCatalogue })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Is there a pool table?" })
    )
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.addSelected })
    )
    expect(await within(dialog).findByText(NETWORK_ERROR)).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.addSelected })
    )
    expect(await screen.findByText("1 check added.")).toBeTruthy()
    expect(screen.queryByText(/Someone else changed this check/)).toBeNull()
    expect(addChecks.mock.calls[0][1]).toMatch(UUID)
    expect(addChecks.mock.calls[1][1]).toBe(addChecks.mock.calls[0][1])
  })
})

describe("MG-01: keys per intent", () => {
  const conflict: AmenityFailure = {
    ok: false,
    code: "revision_conflict",
    status: 409,
    message: "Stale.",
    currentRevision: 6,
  }

  it("uses a new key after success, and a genuine conflict under it still says so", async () => {
    const user = userEvent.setup()
    const archive = vi
      .fn<CheckDetailHandlers["archive"]>()
      .mockImplementationOnce(ok)
      .mockImplementationOnce(async () => conflict)
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers({ archive })}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    expect(await screen.findByText(/^Archived\./)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    expect(await screen.findByText(CONFLICT_TEXT)).toBeTruthy()
    expect(keyOf(archive, 1)).not.toBe(keyOf(archive, 0))
  })

  it("uses a new key when the person changes the input after a lost reply", async () => {
    const user = userEvent.setup()
    const setNotes = vi
      .fn<CheckDetailHandlers["setNotes"]>()
      .mockImplementationOnce(lost)
      .mockImplementationOnce(ok)
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers({ setNotes })}
      />
    )
    const notes = screen.getByLabelText(/Notes for this venue/)
    await user.type(notes, "First")
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(await screen.findByText(NETWORK_ERROR)).toBeTruthy()
    await user.type(notes, " and second")
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(await screen.findByText("Notes saved.")).toBeTruthy()
    expect(keyOf(setNotes, 1)).not.toBe(keyOf(setNotes, 0))
  })

  it("shows the reload copy for a key the server says was reused", async () => {
    const user = userEvent.setup()
    const message = "This changed since you opened it. Reload and try again."
    const archive = vi.fn(async () => ({
      ok: false as const,
      code: "state_conflict" as const,
      status: 409 as const,
      message,
    }))
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers({ archive })}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe("MG-08: Reopen keeps its draft on a conflict", () => {
  it("brings back the preset and details when Reopen is opened again", async () => {
    const user = userEvent.setup()
    const reopen = vi.fn(async () => ({
      ok: false as const,
      code: "revision_conflict" as const,
      status: 409 as const,
      message: "Stale.",
    }))
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={handlers({ reopen })}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.reopen }))
    let dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("radio", { name: "Other" }))
    await user.type(within(dialog).getByLabelText(/Details/), "Sign moved")
    await user.click(within(dialog).getByRole("button", { name: UI_TEXT.reopen }))
    expect(await screen.findByText(CONFLICT_TEXT)).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()

    await user.click(screen.getByRole("button", { name: UI_TEXT.reopen }))
    dialog = await screen.findByRole("dialog")
    expect(
      (within(dialog).getByRole("radio", { name: "Other" }) as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(
      (within(dialog).getByLabelText(/Details/) as HTMLTextAreaElement).value
    ).toBe("Sign moved")
  })
})

describe("MG-09: notes drafts per check", () => {
  const NOTES = () =>
    screen.getByLabelText(/Notes for this venue/) as HTMLTextAreaElement

  it("brings unsaved notes back after a reload, and forgets them once saved", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.type(NOTES(), "Key at bar")
    cleanup()

    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    expect(NOTES().value).toBe("Key at bar")
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(await screen.findByText("Notes saved.")).toBeTruthy()
    cleanup()

    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    expect(NOTES().value).toBe(WIFI_CHECK.notes ?? "")
  })

  it("keeps each check's draft to that check", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(<AmenityCheckDetail detail={detail()} basePath={BASE} handlers={h} />)
    await user.type(NOTES(), "Wi-Fi note")
    cleanup()
    render(
      <AmenityCheckDetail
        detail={detail({ check: { ...ARCHIVED, status: "active" } })}
        basePath={BASE}
        handlers={h}
      />
    )
    expect(NOTES().value).toBe(ARCHIVED.notes ?? "")
  })
})
