// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ACTIVE_MEANING_COPY,
  ActivateMenuDialog,
  ArchiveItemControl,
  DiscardDraftDialog,
  MenuDocumentEditor,
  MenuVenueList,
  MenuVersionStatusBadge,
  ProvenanceCard,
  RetireMenuDialog,
  SuggestionList,
  activationBlockers,
} from "@/components/nabalens/menus"
import type {
  MenuVenueSummary,
  MenuVersionSummary,
  SuggestionView,
} from "@/lib/menus/types"

afterEach(cleanup)

const READY = {
  unresolvedCount: 0,
  errorCount: 0,
  itemCount: 12,
}

describe("ActivateMenuDialog", () => {
  it("explains activation and is disabled with reasons while blocked", () => {
    render(
      <ActivateMenuDialog
        open
        onOpenChange={vi.fn()}
        versionTitle="Winter"
        currentActiveTitle="Autumn"
        unresolvedCount={2}
        errorCount={1}
        itemCount={0}
        hasUnsavedChanges
        onConfirm={vi.fn()}
      />
    )
    expect(
      screen.getByRole("alertdialog", { name: "Activate “Winter”?" })
    ).toBeTruthy()
    expect(screen.getByText(ACTIVE_MEANING_COPY)).toBeTruthy()
    expect(ACTIVE_MEANING_COPY).toContain("not a public menu")
    expect(
      screen.getByText(/The current active menu, “Autumn”, becomes retired/)
    ).toBeTruthy()
    expect(
      screen.getByText("Existing labels on photos and videos are kept.")
    ).toBeTruthy()

    const button = screen.getByRole("button", {
      name: "Activate for labelling",
    })
    expect(button.hasAttribute("disabled")).toBe(true)
    const reasons = document.getElementById(
      button.getAttribute("aria-describedby")!
    )!
    expect(
      within(reasons)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "Save the draft first.",
      "Resolve 2 uncertain matches first.",
      "Fix 1 validation error first.",
      "Add at least one item first.",
    ])
  })

  it("shows the server error and stays open; closes on success", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: "Another admin changed this draft.",
      })
      .mockResolvedValueOnce({ ok: true })
    render(
      <ActivateMenuDialog
        open
        onOpenChange={onOpenChange}
        versionTitle="Winter"
        {...READY}
        onConfirm={onConfirm}
      />
    )
    expect(
      screen.getByText(/no active menu now; this becomes its first/)
    ).toBeTruthy()
    const button = screen.getByRole("button", {
      name: "Activate for labelling",
    })
    await user.click(button)
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Another admin changed this draft."
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the pending state", async () => {
    const user = userEvent.setup()
    let resolve!: (v: { ok: true }) => void
    render(
      <ActivateMenuDialog
        open
        onOpenChange={vi.fn()}
        versionTitle="Winter"
        {...READY}
        onConfirm={() => new Promise((r) => (resolve = r))}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Activate for labelling" })
    )
    const busy = screen.getByRole("button", { name: "Activating…" })
    expect(busy.hasAttribute("disabled")).toBe(true)
    expect(busy.getAttribute("aria-busy")).toBe("true")
    resolve({ ok: true })
  })

  it("activationBlockers is empty when ready", () => {
    expect(activationBlockers(READY)).toEqual([])
  })
})

describe("Retire, discard and archive confirmations", () => {
  it("retire says labels are kept and reports errors", async () => {
    const user = userEvent.setup()
    const onConfirm = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Not allowed." })
    render(
      <RetireMenuDialog
        open
        onOpenChange={vi.fn()}
        versionTitle="Autumn"
        onConfirm={onConfirm}
      />
    )
    expect(
      screen.getByRole("alertdialog", { name: "Retire “Autumn”?" })
    ).toBeTruthy()
    expect(screen.getByText(/Existing labels .* are kept/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Retire menu" }))
    expect((await screen.findByRole("alert")).textContent).toBe("Not allowed.")
  })

  it("discard confirms and closes", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <DiscardDraftDialog
        open
        onOpenChange={onOpenChange}
        versionTitle="Draft 2"
        onConfirm={async () => ({ ok: true })}
      />
    )
    await user.click(screen.getByRole("button", { name: "Discard draft" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("archive explains labels are kept and sets archived", async () => {
    const user = userEvent.setup()
    const onSetArchived = vi.fn().mockResolvedValue({ ok: true })
    const { rerender } = render(
      <ArchiveItemControl
        itemName="Tikka"
        archived={false}
        labelCount={3}
        onSetArchived={onSetArchived}
      />
    )
    await user.click(screen.getByRole("button", { name: "Archive Tikka" }))
    const dialog = screen.getByRole("alertdialog", {
      name: "Archive “Tikka”?",
    })
    expect(dialog.textContent).toContain("can no longer add it to new labels")
    expect(dialog.textContent).toContain(
      "Its 3 labelled photos/videos keep their labels."
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Archive item" })
    )
    expect(onSetArchived).toHaveBeenCalledWith(true)

    rerender(
      <ArchiveItemControl
        itemName="Tikka"
        archived
        onSetArchived={onSetArchived}
      />
    )
    await user.click(screen.getByRole("button", { name: "Unarchive Tikka" }))
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "Unarchive “Tikka”?" })
      ).getByRole("button", { name: "Unarchive item" })
    )
    expect(onSetArchived).toHaveBeenLastCalledWith(false)
  })
})

const suggestion: SuggestionView = {
  id: "sg-1",
  venueId: "v1",
  assetId: "a1",
  assetThumbnailUrl: "https://example.invalid/t.jpg",
  suggestedName: "Mango lassi",
  status: "open",
  createdAt: "2026-10-29T10:00:00.000Z",
  createdByName: "Test staff",
  resolvedItemId: null,
  resolvedItemName: null,
  resolutionNote: null,
}

describe("SuggestionList", () => {
  it("requires an item to link, then resolves; dismiss shows errors", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn().mockResolvedValue({ ok: true })
    const onDismiss = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Already handled." })
    render(
      <SuggestionList
        suggestions={[
          suggestion,
          {
            ...suggestion,
            id: "sg-2",
            suggestedName: "Old dish",
            status: "resolved",
            resolvedItemName: "Lamb curry",
          },
        ]}
        itemOptions={[{ id: "i-lassi", name: "Lassi (Drinks)" }]}
        onResolve={onResolve}
        onDismiss={onDismiss}
      />
    )
    expect(
      screen.getAllByText("Suggested by Test staff on 29 Oct 2026")
    ).toHaveLength(2)
    expect(screen.getByText("Linked to “Lamb curry”")).toBeTruthy()

    const link = screen.getByRole("button", {
      name: "Link to item: “Mango lassi”",
    })
    await user.click(link)
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain(
      "Choose the menu item"
    )

    await user.click(
      screen.getByRole("combobox", { name: "Menu item for “Mango lassi”" })
    )
    await user.click(
      await screen.findByRole("option", { name: "Lassi (Drinks)" })
    )
    await user.click(link)
    expect(onResolve).toHaveBeenCalledWith("sg-1", "i-lassi")

    await user.click(
      screen.getByRole("button", { name: "Dismiss “Mango lassi”" })
    )
    expect(onDismiss).toHaveBeenCalledWith("sg-1")
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Already handled."
    )
  })

  it("has an empty state", () => {
    render(
      <SuggestionList
        suggestions={[]}
        itemOptions={[]}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText("No missing-item suggestions.")).toBeTruthy()
  })
})

const version: MenuVersionSummary = {
  id: "ver-1",
  venueId: "v1",
  status: "active",
  title: "Autumn",
  revision: 3,
  source: {
    kind: "json",
    label: "autumn.json",
    sha256: "a".repeat(12) + "b".repeat(52),
    revision: "abc1234",
    capturedAt: "2026-10-01T09:00:00.000Z",
    notes: "Exported from the venue site",
  },
  itemCount: 42,
  sectionCount: 5,
  needsReviewCount: 0,
  createdAt: "2026-10-02T09:00:00.000Z",
  createdByName: "Test admin",
  updatedAt: "2026-10-02T10:00:00.000Z",
  reviewedAt: "2026-10-03T09:00:00.000Z",
  activatedAt: "2026-10-03T09:00:00.000Z",
  activatedByName: "Test admin",
  retiredAt: null,
}

describe("Venue list, provenance and status", () => {
  it("lists venues with active summary or no active menu", () => {
    const venues: MenuVenueSummary[] = [
      {
        venueId: "v1",
        venueName: "The Test Arms",
        venueActive: true,
        active: version,
        draftCount: 1,
        openSuggestionCount: 2,
      },
      {
        venueId: "v2",
        venueName: "Second Venue",
        venueActive: false,
        active: null,
        draftCount: 0,
        openSuggestionCount: 0,
      },
    ]
    render(
      <MenuVenueList
        venues={venues}
        getVenueHref={(id) => `/admin/menus/${id}`}
      />
    )
    const first = screen.getByRole("link", { name: /^The Test Arms/ })
    expect(first.getAttribute("href")).toBe("/admin/menus/v1")
    expect(first.textContent).toContain("Autumn")
    expect(first.textContent).toContain("Activated 3 Oct 2026 · 42 items")
    expect(first.textContent).toContain("1 draft")
    expect(first.textContent).toContain("2 open suggestions")
    const second = screen.getByRole("link", { name: /^Second Venue/ })
    expect(second.textContent).toContain("No active menu")
    expect(second.textContent).toContain("Venue inactive")
  })

  it("shows provenance with a short hash and the full value on request", async () => {
    const user = userEvent.setup()
    render(<ProvenanceCard version={version} />)
    const card = screen.getByRole("region", { name: "Provenance" })
    expect(card.textContent).toContain("JSON file")
    expect(card.textContent).toContain("autumn.json")
    expect(card.textContent).toContain("abc1234")
    expect(card.textContent).toContain("Exported from the venue site")
    expect(card.textContent).toContain("by Test admin")
    expect(card.textContent).toContain(ACTIVE_MEANING_COPY)
    const summary = screen.getByText("aaaaaaaaaaaa…", { exact: false })
    await user.click(summary)
    expect(screen.getByText(version.source.sha256!)).toBeTruthy()
  })

  it("status badge says what active means for assistive tech", () => {
    render(<MenuVersionStatusBadge status="active" />)
    expect(screen.getByText("Active").textContent).toBe(
      "Active, available for labelling only"
    )
  })

  it("editor buttons do not submit a surrounding form", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <MenuDocumentEditor
          value={{ title: "T", sections: [] }}
          onChange={vi.fn()}
          makeSourceKey={(s, n) => `${s}--${n}`}
          slugify={(v) => v.toLowerCase()}
        />
      </form>
    )
    await user.click(screen.getByRole("button", { name: /^Expand all/ }))
    await user.type(
      screen.getByRole("textbox", { name: "New section name" }),
      "Mains{Enter}"
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
