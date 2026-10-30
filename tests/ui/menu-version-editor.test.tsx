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

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/admin/menus/actions", () => ({
  activateVersionAction: vi.fn(),
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

function editor(next = version) {
  return (
    <VersionEditor
      version={next}
      diff={diff}
      active={null}
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
    await user.click(
      within(match()).getByRole("radio", { name: /Same item as/ })
    )
    await user.type(
      screen.getByRole("textbox", { name: "Menu title" }),
      " updated"
    )
    await user.click(screen.getByRole("button", { name: "Save draft" }))

    expect(match().hasAttribute("disabled")).toBe(true)
    expect(
      within(match()).queryByRole("button", { name: /Confirm decision/ })
    ).toBeNull()
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
      (screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement)
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
      within(match()).getByRole("button", { name: "Confirm decision for Pie" })
    )
    expect(
      within(match()).getByText("Resolved: same item as “Pie”")
    ).toBeTruthy()
    vi.mocked(saveDraftAction).mockResolvedValueOnce({ ok: true, revision: 3 })
    await user.click(screen.getByRole("button", { name: "Save draft" }))
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
    await user.click(screen.getByRole("button", { name: "Save draft" }))
    expect(match().hasAttribute("disabled")).toBe(true)
    await act(async () => resolve({ ok: false, error: "Please retry" }))
    expect(match().hasAttribute("disabled")).toBe(false)
    expect(
      (screen.getByRole("textbox", { name: "Menu title" }) as HTMLInputElement)
        .value
    ).toBe("Autumn menu updated")
    await user.click(
      within(match()).getByRole("radio", { name: /Same item as/ })
    )
    await user.click(
      within(match()).getByRole("button", { name: "Confirm decision for Pie" })
    )
    expect(
      within(match()).getByText("Resolved: same item as “Pie”")
    ).toBeTruthy()
  })
})
