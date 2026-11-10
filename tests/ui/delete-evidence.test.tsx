// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MediaGallery, type LoadPage } from "@/app/_media/media-gallery"
import { ConfirmDeleteDialog } from "@/components/nabalens"
import {
  DELETE_IMPACT_UNCHECKED,
  deleteWarning,
} from "@/components/nabalens/delete-impact/copy"
import type { MediaItemView } from "@/lib/server/media/types"
import type { DeleteImpact, ImpactLine } from "@/lib/work-client/contract"

vi.mock("server-only", () => ({}))
const media = vi.hoisted(() => ({
  deleteMedia: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock("@/app/_media/actions", () => media)
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))

const ID = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const VENUE = "The Old Crown"
const QUESTION = "Is there step-free access?"
const NEUTRAL =
  "It's removed from your profile and from Photos. When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."

function line(over: Partial<ImpactLine>): ImpactLine {
  return {
    kind: "answer_in_use",
    effect: "none",
    venueName: VENUE,
    question: QUESTION,
    yours: true,
    ...over,
  }
}

const known = (...items: ImpactLine[]): DeleteImpact => ({
  status: "known",
  items,
})

function item(): MediaItemView {
  return {
    id: ID,
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: `/api/media/${ID}/thumb`,
    previewUrl: `/api/media/${ID}/preview`,
    mimeType: "image/jpeg",
    originalFilename: "01.jpg",
    createdAt: "2026-10-29T12:00:00.000000+00:00",
    contributorId: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    contributorName: "TEST Staff",
    venueName: "TEST Venue",
    width: 64,
    height: 48,
    durationSeconds: null,
    sizeBytes: 4,
    labels: null,
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => media.deleteMedia.mockClear())

function confirmButton() {
  const dialog = screen.getByRole("alertdialog")
  return within(dialog)
    .getAllByRole("button")
    .find((b) => b.textContent !== "Keep photo")!
}

describe("ConfirmDeleteDialog: venue answers (HM-04)", () => {
  const confirm = (
    props: Partial<Parameters<typeof ConfirmDeleteDialog>[0]> = {}
  ) => {
    const onConfirm = vi.fn(() => ({ ok: true as const }))
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        {...props}
      />
    )
    return onConfirm
  }

  it("lists each line on its own and asks Delete anyway when an answer loses its evidence", () => {
    const warning = deleteWarning(
      known(
        line({ effect: "withdrawn" }),
        line({ kind: "earlier_answer", effect: "none" })
      )
    )
    confirm({ evidence: warning })
    const dialog = screen.getByRole("alertdialog")
    const paragraphs = Array.from(dialog.querySelectorAll("[aria-live] p"))
    expect(paragraphs.map((p) => p.textContent)).toEqual(warning.lines)
    expect(warning.lines).toHaveLength(2)
    expect(
      within(dialog).getByRole("button", { name: "Delete anyway" })
    ).toBeTruthy()
    expect(dialog.textContent).toContain(NEUTRAL)
  })

  it("keeps Delete when nothing serious is lost", () => {
    confirm({
      evidence: deleteWarning(
        known(line({ kind: "earlier_answer", effect: "none" }))
      ),
    })
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("shows today's dialog for an empty list", () => {
    confirm({ evidence: deleteWarning(known()) })
    const dialog = screen.getByRole("alertdialog")
    expect(dialog.querySelectorAll("[aria-live] p")).toHaveLength(0)
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("says it couldn't check, with today's Delete, when the read failed", () => {
    confirm({ evidence: deleteWarning(null) })
    expect(screen.getByText(DELETE_IMPACT_UNCHECKED)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("holds Delete while checking, focusable and busy", () => {
    const onConfirm = confirm({ evidence: "checking" })
    const button = screen.getByRole("button", { name: "Checking\u2026" })
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(
      screen.getByRole("alertdialog").querySelector("[aria-live=polite]")
    ).toBeTruthy()
  })
})

describe("Me's gallery: reading the delete warning (HM-04)", () => {
  function open(read?: (id: string) => Promise<unknown>) {
    render(
      <MediaGallery
        label="Your portfolio"
        initialPage={{ items: [item()], nextCursor: null }}
        loadPage={vi.fn<LoadPage>()}
        canDelete
        readDeleteEvidence={read as never}
        empty={<p>Empty</p>}
      />
    )
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        `button[data-media-id="${ID}"]`
      )!
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    return screen.getByRole("alertdialog")
  }

  it("reads the caller's photo and shows its lines with Delete anyway", async () => {
    const read = vi.fn(async () => ({
      status: "ok" as const,
      impact: known(
        line({ effect: "needs_recheck", yours: false }),
        line({ kind: "pending_finding", effect: "pending_loses_evidence" })
      ),
    }))
    const dialog = open(read)
    expect(read).toHaveBeenCalledWith(ID)
    expect(
      await within(dialog).findByRole("button", { name: "Delete anyway" })
    ).toBeTruthy()
    expect(dialog.textContent).toContain(
      `An answer at ${VENUE} to “${QUESTION}” needs this photo as evidence.`
    )
    expect(dialog.textContent).toContain(
      `Your finding on “${QUESTION}” at ${VENUE} is waiting for a manager.`
    )
    // Only venue and question: no names from the item or the file.
    expect(dialog.textContent).not.toContain("TEST Staff")
    expect(dialog.textContent).not.toContain("01.jpg")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }))
    await act(async () => {})
    expect(media.deleteMedia).toHaveBeenCalledWith(ID)
  })

  it("holds Delete with Checking\u2026 until the read answers, keeping focus in the dialog", async () => {
    let answer!: (value: unknown) => void
    const dialog = open(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const button = within(dialog).getByRole("button", { name: "Checking\u2026" })
    expect(button.getAttribute("aria-busy")).toBe("true")
    button.focus()
    fireEvent.click(button)
    expect(media.deleteMedia).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button)
    await act(async () => {
      answer({ status: "ok", impact: known(line({ effect: "withdrawn" })) })
    })
    expect(confirmButton().textContent).toBe("Delete anyway")
    expect(confirmButton().getAttribute("aria-busy")).toBeNull()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it("keeps today's dialog when the database predates B02", async () => {
    const dialog = open(async () => ({ status: "missing" }))
    await act(async () => {})
    expect(dialog.querySelector("[aria-live]")).toBeNull()
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
    expect(dialog.textContent).toContain(NEUTRAL)
  })

  it("says it couldn't check when the read failed", async () => {
    const dialog = open(async () => ({ status: "failed" }))
    expect(await within(dialog).findByText(DELETE_IMPACT_UNCHECKED)).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("says it couldn't check when the read throws", async () => {
    const dialog = open(async () => {
      throw new TypeError("Failed to fetch")
    })
    expect(await within(dialog).findByText(DELETE_IMPACT_UNCHECKED)).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("says it couldn't check when an item can't be worded", async () => {
    const dialog = open(async () => ({
      status: "ok",
      impact: { status: "unknown" },
    }))
    expect(await within(dialog).findByText(DELETE_IMPACT_UNCHECKED)).toBeTruthy()
  })

  it("keeps today's dialog for an empty list", async () => {
    const dialog = open(async () => ({ status: "ok", impact: known() }))
    await act(async () => {})
    expect(dialog.querySelectorAll("[aria-live] p")).toHaveLength(0)
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("stops waiting for a read that never answers", async () => {
    vi.useFakeTimers()
    const dialog = open(() => new Promise(() => {}))
    expect(within(dialog).getByRole("button", { name: "Checking\u2026" })).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(within(dialog).getByText(DELETE_IMPACT_UNCHECKED)).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("adds nothing without a reader (the admin Library, OD-10)", () => {
    const dialog = open(undefined)
    expect(dialog.querySelector("[aria-live]")).toBeNull()
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy()
  })
})
