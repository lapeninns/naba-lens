// @vitest-environment jsdom
// Me → "Needs attention": the caller's own photos whose labels the server
// kept but could not add, each with its reason, "Fix labels" (the stored
// draft against the current menu) and "Discard labels".
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FixLabelsDialogProps } from "@/app/staff/fix-labels-dialog-stub"
import type { PendingLabelItem } from "@/app/staff/needs-attention-api"
import {
  ATTENTION_COPY,
  NeedsAttention,
  attentionItems,
  attentionReason,
  type NeedsAttentionApi,
} from "@/app/staff/needs-attention"
import {
  EMPTY_LABEL_SUMMARY,
  type LabelCatalogue,
  type SaveLabelsInput,
} from "@/lib/menus/types"

vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
}))

// TODO(integration): S2's FixLabelsDialog replaces the stub; point this mock
// at "@/components/nabalens/labels" (keeping the real exports) instead.
const dialog = vi.hoisted(() => ({
  last: null as FixLabelsDialogProps | null,
}))
vi.mock("@/app/staff/fix-labels-dialog-stub", () => ({
  FixLabelsDialog: (props: FixLabelsDialogProps) => {
    dialog.last = props
    return props.open ? (
      <div role="dialog" aria-label="Fix labels">
        {props.problem?.message}
      </div>
    ) : null
  },
}))

afterEach(() => {
  cleanup()
  dialog.last = null
})

const VENUE = "00000000-0000-4000-8000-0000000000a1"
const SOUP = "00000000-0000-4000-8000-0000000000c1"

function draft(assetId: string): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: "version-1",
    contentTypes: [],
    note: null,
    items: [{ itemId: SOUP, variantId: null }],
    missingItem: null,
  }
}

function row(
  n: number,
  over: Partial<PendingLabelItem> = {}
): PendingLabelItem {
  const assetId = `7d000000-0000-4000-8000-00000000000${n}`
  return {
    assetId,
    venueId: VENUE,
    status: "needs_attention",
    code: "catalogue_changed",
    message: "Check your menu items against the updated menu.",
    input: draft(assetId),
    uploadState: "ready",
    mediaType: "image",
    thumbnailUrl: `/api/media/${assetId}/thumb`,
    updatedAt: "2026-11-07T10:00:00.000Z",
    ...over,
  }
}

const CATALOGUE: LabelCatalogue = {
  status: "active",
  venueId: VENUE,
  venueName: "The Railway",
  versionId: "version-2",
  versionTitle: "Winter",
  activatedAt: null,
  sections: [],
}

function api(items: PendingLabelItem[], over: Partial<NeedsAttentionApi> = {}) {
  return {
    load: vi.fn<NeedsAttentionApi["load"]>(async () => ({ ok: true, items })),
    discard: vi.fn<NeedsAttentionApi["discard"]>(async () => true),
    save: vi.fn<NeedsAttentionApi["save"]>(async (_venue, input) => ({
      ok: true,
      assetId: input.assetId,
      labels: { ...EMPTY_LABEL_SUMMARY, hasLabels: true, revision: 1 },
    })),
    loadContext: vi.fn<NeedsAttentionApi["loadContext"]>(async (ids) => ({
      ok: true,
      viewer: "staff",
      assets: ids.map((id) => ({
        id,
        venueId: VENUE,
        venueName: "The Railway",
        originalFilename: "soup.jpg",
        mediaType: "image",
        thumbnailUrl: null,
        labels: EMPTY_LABEL_SUMMARY,
      })),
      missing: [],
      catalogue: CATALOGUE,
      focus: null,
    })),
    loadCatalogue: vi.fn<NeedsAttentionApi["loadCatalogue"]>(async () => ({
      ok: true,
      catalogue: CATALOGUE,
    })),
    ...over,
  } satisfies NeedsAttentionApi
}

const list = () =>
  screen.getByRole("list", { name: "Photos that need attention" })

describe("Needs attention: which rows and why", () => {
  it("words each reason in the flow's own copy", () => {
    expect(attentionReason(row(1))).toBe("The menu changed. Check the dish.")
    expect(attentionReason(row(1, { code: "unavailable_items" }))).toBe(
      "The menu changed. Check the dish."
    )
    expect(attentionReason(row(1, { code: "unavailable" }))).toBe(
      "Labels not saved yet."
    )
    expect(
      attentionReason(row(1, { code: "invalid", message: "Too long" }))
    ).toBe("Too long")
    expect(
      attentionReason(row(1, { status: "pending", uploadState: "failed" }))
    ).toBe("This file can't be used.")
  })

  it("lists labels needing a fix and dead uploads, not labels still saving", () => {
    const fix = row(1)
    const saving = row(2, {
      status: "pending",
      code: null,
      uploadState: "processing",
    })
    const dead = row(3, {
      status: "pending",
      code: null,
      uploadState: "failed",
    })
    expect(attentionItems([fix, saving, dead])).toEqual([fix, dead])
  })
})

describe("NeedsAttention on Me", () => {
  it("renders nothing while nothing needs attention", async () => {
    const calls = api([
      row(1, { status: "pending", code: null, uploadState: "uploading" }),
    ])
    const { container } = render(<NeedsAttention api={calls} />)
    await waitFor(() => expect(calls.load).toHaveBeenCalledTimes(1))
    expect(container.textContent).toBe("")
  })

  it("shows each photo with its thumbnail, reason, Fix labels and Discard labels", async () => {
    render(
      <NeedsAttention
        api={api([
          row(1),
          row(2, {
            code: "unavailable",
            mediaType: "video",
            thumbnailUrl: null,
          }),
        ])}
      />
    )
    const section = await screen.findByRole("region", {
      name: /Needs attention/,
    })
    expect(within(section).getByText(ATTENTION_COPY.intro)).toBeTruthy()
    const rows = within(list()).getAllByRole("listitem")
    expect(rows).toHaveLength(2)

    expect(rows[0].querySelector("img")?.getAttribute("src")).toBe(
      `/api/media/${row(1).assetId}/thumb`
    )
    expect(within(rows[0]).getByText("Needs attention")).toBeTruthy()
    expect(rows[0].textContent).toContain("The menu changed. Check the dish.")
    const fix = within(rows[0]).getByRole("button", { name: "Fix labels" })
    // Each row's buttons are told apart by the row's reason.
    expect(
      document.getElementById(fix.getAttribute("aria-describedby")!)
        ?.textContent
    ).toBe("Photo: The menu changed. Check the dish.")
    expect(
      within(rows[0]).getByRole("button", { name: "Discard labels" })
    ).toBeTruthy()

    expect(rows[1].querySelector("img")).toBeNull()
    expect(rows[1].textContent).toContain("Labels not saved yet.")
  })

  it("offers only Discard for a file that can never be saved", async () => {
    render(
      <NeedsAttention
        api={api([
          row(1, { status: "pending", code: null, uploadState: "failed" }),
        ])}
      />
    )
    const item = (await screen.findAllByRole("listitem"))[0]
    expect(item.textContent).toContain("This file can't be used.")
    expect(item.textContent).toContain("Labels: Not saved (photo not saved)")
    expect(
      within(item).queryByRole("button", { name: "Fix labels" })
    ).toBeNull()
    expect(within(item).queryByRole("button", { name: /Retry/ })).toBeNull()
    expect(
      within(item).getByRole("button", { name: "Discard labels" })
    ).toBeTruthy()
  })

  it("discards a row's labels, and keeps the row when that fails", async () => {
    const user = userEvent.setup()
    const calls = api([row(1), row(2)])
    vi.mocked(calls.discard)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    render(<NeedsAttention api={calls} />)
    await screen.findByRole("list", { name: "Photos that need attention" })

    const first = within(list()).getAllByRole("listitem")[0]
    await user.click(
      within(first).getByRole("button", { name: "Discard labels" })
    )
    expect(calls.discard).toHaveBeenCalledWith(row(1).assetId)
    await waitFor(() =>
      expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    )

    const second = within(list()).getAllByRole("listitem")[0]
    await user.click(
      within(second).getByRole("button", { name: "Discard labels" })
    )
    expect(await within(second).findByRole("alert")).toHaveProperty(
      "textContent",
      ATTENTION_COPY.discardFailed
    )
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
  })

  it("Fix labels opens the stored draft against the current menu and saves it", async () => {
    const user = userEvent.setup()
    const onFixed = vi.fn()
    const calls = api([row(1), row(2)])
    render(<NeedsAttention api={calls} onFixed={onFixed} />)
    await screen.findByRole("list", { name: "Photos that need attention" })

    const first = within(list()).getAllByRole("listitem")[0]
    await user.click(within(first).getByRole("button", { name: "Fix labels" }))
    expect(calls.loadContext).toHaveBeenCalledWith([row(1).assetId])
    expect(
      (await screen.findByRole("dialog", { name: "Fix labels" })).textContent
    ).toBe("The menu changed. Check the dish.")
    const props = dialog.last!
    expect(props.draft).toEqual(row(1).input)
    expect(props.problem).toEqual({
      code: "catalogue_changed",
      message: "The menu changed. Check the dish.",
    })
    expect(props.catalogue).toEqual({ state: "ready", catalogue: CATALOGUE })
    expect(props.asset.id).toBe(row(1).assetId)

    // The dialog saves the corrected input (current menu version).
    const fixed = { ...row(1).input, catalogueVersionId: "version-2" }
    let result: Awaited<ReturnType<FixLabelsDialogProps["onSave"]>>
    await act(async () => {
      result = await props.onSave(fixed)
    })
    expect(result!.ok).toBe(true)
    expect(calls.save).toHaveBeenCalledWith(VENUE, fixed)
    act(() => props.onOpenChange(false))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    expect(onFixed).toHaveBeenCalledWith([row(1).assetId])
  })

  it("keeps the row and hands the problem back when the fix doesn't save", async () => {
    const user = userEvent.setup()
    const onFixed = vi.fn()
    const calls = api([row(1)], {
      save: vi.fn(async (_v: string, input: SaveLabelsInput) => ({
        ok: false as const,
        assetId: input.assetId,
        code: "unavailable_items" as const,
        message: "Soup is no longer on the menu.",
      })),
    })
    render(<NeedsAttention api={calls} onFixed={onFixed} />)
    await user.click(await screen.findByRole("button", { name: "Fix labels" }))
    await screen.findByRole("dialog", { name: "Fix labels" })
    let result: Awaited<ReturnType<FixLabelsDialogProps["onSave"]>>
    await act(async () => {
      result = await dialog.last!.onSave(row(1).input)
    })
    expect(result!).toMatchObject({ ok: false, code: "unavailable_items" })
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    expect(onFixed).not.toHaveBeenCalled()
  })

  it("says when the labels can't be opened", async () => {
    const user = userEvent.setup()
    const calls = api([row(1)], {
      loadContext: vi.fn(async () => {
        throw new Error("offline")
      }),
    })
    render(<NeedsAttention api={calls} />)
    await user.click(await screen.findByRole("button", { name: "Fix labels" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      ATTENTION_COPY.openFailed
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("re-reads after an upload finishes, and offers Try again when the read fails", async () => {
    const user = userEvent.setup()
    const calls = api([])
    vi.mocked(calls.load)
      .mockResolvedValueOnce({ ok: true, items: [] })
      .mockResolvedValueOnce({ ok: false, message: "down" })
      .mockResolvedValue({ ok: true, items: [row(1)] })
    const { rerender } = render(
      <NeedsAttention api={calls} refreshSignal={0} />
    )
    await waitFor(() => expect(calls.load).toHaveBeenCalledTimes(1))
    rerender(<NeedsAttention api={calls} refreshSignal={1} />)
    expect(await screen.findByText(ATTENTION_COPY.loadFailed)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("list", { name: "Photos that need attention" })
    ).toBeTruthy()
    expect(calls.load).toHaveBeenCalledTimes(3)
  })
})
