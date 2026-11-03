// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VersionEditor } from "@/app/admin/menus/version-editor"
import { saveDraftAction } from "@/app/admin/menus/actions"
import type {
  MenuDiff,
  MenuDocument,
  MenuVersionDetail,
} from "@/lib/menus/types"

const router = { refresh: vi.fn(), push: vi.fn() }
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/app/admin/menus/actions", () => ({
  activateVersionAction: vi.fn(),
  createDraftFromActiveAction: vi.fn(),
  discardDraftAction: vi.fn(),
  retireVersionAction: vi.fn(),
  saveDraftAction: vi.fn(),
  setItemArchivedAction: vi.fn(),
}))

const ITEM = "00000000-0000-4000-8000-000000000001"
const document: MenuDocument = {
  title: "Autumn menu",
  sections: [
    {
      slug: "mains",
      name: "Mains",
      kind: "food",
      items: [
        {
          itemId: null,
          sourceKey: "mains--pie",
          name: "Pie",
          description: null,
          aliases: [],
          sourceMeta: {},
          variants: [],
          review: { candidates: [ITEM], reason: "Same name" },
        },
      ],
    },
  ],
}
const reviewBase: MenuDocument = {
  ...document,
  sections: document.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      itemId: ITEM,
      review: null,
    })),
  })),
}
const diff: MenuDiff = {
  added: [],
  changed: [],
  removed: [],
  unchangedCount: 0,
  uncertain: [
    {
      sourceKey: "mains--pie",
      itemId: null,
      name: "Pie",
      sectionName: "Mains",
      reason: "Same name",
      candidates: [
        {
          sourceKey: "mains--pie",
          itemId: ITEM,
          name: "Pie",
          sectionName: "Mains",
        },
      ],
    },
  ],
}
const version: MenuVersionDetail = {
  id: "00000000-0000-4000-8000-000000000002",
  venueId: "00000000-0000-4000-8000-000000000003",
  venueName: "Test venue",
  status: "draft",
  title: document.title,
  revision: 1,
  source: {
    kind: "manual",
    label: null,
    sha256: null,
    revision: null,
    capturedAt: null,
    notes: null,
  },
  itemCount: 1,
  sectionCount: 1,
  needsReviewCount: 1,
  createdAt: "2026-10-30T12:00:00Z",
  createdByName: "Admin",
  updatedAt: "2026-10-30T12:00:00Z",
  reviewedAt: null,
  activatedAt: null,
  activatedByName: null,
  retiredAt: null,
  document,
  archivedItemIds: [],
  labelCounts: {},
}

function editor(
  next = version,
  active: { id: string; title: string } | null = null
) {
  return (
    <VersionEditor
      version={next}
      diff={diff}
      active={active}
      reviewBase={reviewBase}
    />
  )
}
function match() {
  return screen.getByRole("group", { name: "Pie in Mains" })
}
function deferredSave() {
  let resolve!: (result: Awaited<ReturnType<typeof saveDraftAction>>) => void
  const result = new Promise<Awaited<ReturnType<typeof saveDraftAction>>>(
    (done) => {
      resolve = done
    }
  )
  vi.mocked(saveDraftAction).mockReturnValueOnce(result)
  return resolve
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("draft review while saving", () => {
  it("locks decisions through the save and saved-revision refresh, then accepts a decision", async () => {
    const user = userEvent.setup()
    const resolve = deferredSave()
    const { rerender } = render(editor())
    await user.type(
      screen.getByRole("textbox", { name: "Menu title" }),
      " updated"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(match().hasAttribute("disabled")).toBe(true)
    expect(
      (
        within(match()).getByRole("button", {
          name: "Same item as Pie (Mains)",
        }) as HTMLButtonElement
      ).matches(":disabled")
    ).toBe(true)
    expect(vi.mocked(saveDraftAction).mock.calls[0][0]).toMatchObject({
      document: {
        title: "Autumn menu updated",
        sections: [{ items: [{ review: { candidates: [ITEM] } }] }],
      },
    })

    await act(async () => resolve({ ok: true, revision: 2 }))
    expect(screen.getByText("Saved. Loading the saved draft…")).toBeTruthy()
    expect(match().hasAttribute("disabled")).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)

    const savedDocument = { ...document, title: "Autumn menu updated" }
    rerender(
      editor({
        ...version,
        revision: 2,
        title: savedDocument.title,
        document: savedDocument,
      })
    )
    expect(match().hasAttribute("disabled")).toBe(false)
    await user.click(
      within(match()).getByRole("button", { name: "Same item as Pie (Mains)" })
    )
    expect(
      within(match()).getByText(
        "Same item as Pie (Mains). Labels stay with it."
      )
    ).toBeTruthy()
    vi.mocked(saveDraftAction).mockResolvedValueOnce({ ok: true, revision: 3 })
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(vi.mocked(saveDraftAction).mock.calls[1][0]).toMatchObject({
      expectedRevision: 2,
      document: { sections: [{ items: [{ itemId: ITEM, review: null }] }] },
    })
  })

  it("unlocks decisions after a failed save and keeps the unsaved document", async () => {
    const user = userEvent.setup()
    const resolve = deferredSave()
    render(editor())
    await user.type(
      screen.getByRole("textbox", { name: "Menu title" }),
      " updated"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(match().hasAttribute("disabled")).toBe(true)
    await act(async () => resolve({ ok: false, error: "Please retry" }))
    expect(match().hasAttribute("disabled")).toBe(false)
    expect(
      (screen.getByRole("textbox", { name: "Menu title" }) as HTMLInputElement)
        .value
    ).toBe("Autumn menu updated")
    await user.click(
      within(match()).getByRole("button", { name: "Same item as Pie (Mains)" })
    )
    expect(
      within(match()).getByText(
        "Same item as Pie (Mains). Labels stay with it."
      )
    ).toBeTruthy()
  })
})

describe("menu version page", () => {
  it("offers Review while an item needs a decision, then Activate for labelling", async () => {
    const user = userEvent.setup()
    render(editor(version, { id: "v-active", title: "Food · version 4" }))
    expect(
      screen.getByRole("heading", { level: 1, name: "Autumn menu" })
    ).toBeTruthy()
    expect(screen.getByText("Draft")).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Before you activate" })
    ).toBeTruthy()
    expect(screen.getByText("1 item needs a decision")).toBeTruthy()
    expect(
      screen.getByText(
        "Pie needs a decision. Activation stays unavailable until it is decided."
      )
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Activate for labelling" })
    ).toBeNull()
    await user.click(screen.getByRole("button", { name: "Review 1 item" }))
    expect(window.document.activeElement).toBe(
      screen.getByRole("region", { name: "Needs a decision" })
    )

    await user.click(
      within(match()).getByRole("button", { name: "Same item as Pie (Mains)" })
    )
    expect(
      screen.getByRole("button", { name: "Activate for labelling" })
    ).toBeTruthy()
    // Deciding is an unsaved edit, so activation still waits for a save.
    expect(screen.getByText("Save the draft first.")).toBeTruthy()
  })

  it("reports a save made elsewhere and keeps the edits until Reload", async () => {
    const user = userEvent.setup()
    vi.mocked(saveDraftAction).mockResolvedValueOnce({
      ok: false,
      error: "This changed elsewhere.",
      conflict: true,
    })
    render(editor())
    await user.type(
      screen.getByRole("textbox", { name: "Menu title" }),
      " updated"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    const notice = screen.getByRole("alert")
    expect(notice.textContent).toContain("Someone else saved first")
    expect(
      (screen.getByRole("textbox", { name: "Menu title" }) as HTMLInputElement)
        .value
    ).toBe("Autumn menu updated")
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    await user.click(within(notice).getByRole("button", { name: "Reload" }))
    expect(router.refresh).toHaveBeenCalled()
    expect(
      (screen.getByRole("textbox", { name: "Menu title" }) as HTMLInputElement)
        .value
    ).toBe("Autumn menu")
  })

  it("says what was saved", async () => {
    const user = userEvent.setup()
    vi.mocked(saveDraftAction).mockResolvedValueOnce({ ok: true, revision: 2 })
    render(editor())
    await user.type(screen.getByRole("textbox", { name: "Menu title" }), "!")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByText("Saved. 1 item in 1 section.")).toBeTruthy()
  })

  it("asks before an in-app link drops unsaved edits", async () => {
    const user = userEvent.setup()
    render(
      <>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- stands in for the shell's <Link>, which renders this anchor */}
        <a href="/admin/menus">Menus</a>
        {editor()}
      </>
    )
    await user.type(screen.getByRole("textbox", { name: "Menu title" }), "!")
    await user.click(screen.getByRole("link", { name: "Menus" }))
    const dialog = screen.getByRole("alertdialog", {
      name: "Leave without saving?",
    })
    expect(dialog.textContent).toContain("Your changes aren't saved yet.")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" })
    )
    expect(router.push).not.toHaveBeenCalled()
    await user.click(screen.getByRole("link", { name: "Menus" }))
    await user.click(screen.getByRole("button", { name: "Discard changes" }))
    expect(router.push).toHaveBeenCalledWith("/admin/menus")
  })

  it("shows an active version read-only with Start a draft and Retire", async () => {
    const user = userEvent.setup()
    render(
      editor({
        ...version,
        status: "active",
        activatedAt: "2026-11-01T09:30:00Z",
        activatedByName: "Sam Rai",
        document: reviewBase,
      })
    )
    expect(screen.getByText("Active · for labelling only")).toBeTruthy()
    expect(
      screen.getByText(
        "Active versions are read-only. Start a draft to change items."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Menu title" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Start a draft from this version" })
    ).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "More actions for Autumn menu" })
    )
    await user.click(await screen.findByRole("menuitem", { name: "Retire" }))
    expect(
      screen.getByRole("alertdialog", {
        name: "Retire Test venue's active menu?",
      })
    ).toBeTruthy()
  })

  it("keeps a discarded draft for history", () => {
    render(editor({ ...version, status: "discarded" }))
    expect(
      screen
        .getAllByText("Discarded")
        .some((el) => el.dataset.slot === "status-chip")
    ).toBe(true)
    expect(
      screen.getByText(
        "Kept for history. It was never active, so no labels use it."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /More actions/ })).toBeNull()
  })
})
