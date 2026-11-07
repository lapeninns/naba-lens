// @vitest-environment jsdom
// Me → "Needs attention": the caller's own photos whose labels the server
// kept but could not add, each with its reason, "Fix labels" (the stored
// draft against the current menu) and "Discard labels" (after a confirm).
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

import type { FixLabelsDialogProps } from "@/components/nabalens/labels"
import {
  ATTENTION_COPY,
  NeedsAttention,
  attentionItems,
  attentionReason,
  type NeedsAttentionApi,
} from "@/app/staff/needs-attention"
import type { DiscardResult } from "@/app/staff/needs-attention-api"
import {
  EMPTY_LABEL_SUMMARY,
  type LabelCatalogue,
  type MediaLabelSummary,
  type PendingLabelItem,
  type SaveLabelsInput,
} from "@/lib/menus/types"

vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
}))

// The real FixLabelsDialog is covered in labels-fix-dialog.test.tsx; here it
// only records what Me hands it.
const dialog = vi.hoisted(() => ({
  last: null as FixLabelsDialogProps | null,
}))
vi.mock("@/components/nabalens/labels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/nabalens/labels")>()),
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
    retryable: false,
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
    discard: vi.fn<NeedsAttentionApi["discard"]>(async () => ({
      ok: true,
      state: "discarded",
    })),
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

/** Discard labels on a row, then confirm it in the alert dialog. */
async function discardRow(
  user: ReturnType<typeof userEvent.setup>,
  item: HTMLElement
) {
  await user.click(within(item).getByRole("button", { name: "Discard labels" }))
  const confirm = await screen.findByRole("alertdialog")
  await user.click(
    within(confirm).getByRole("button", { name: "Discard labels" })
  )
}

const DISCARDED: DiscardResult = { ok: true, state: "discarded" }

function deferredMenu() {
  let resolve!: (
    value: Awaited<ReturnType<NeedsAttentionApi["loadCatalogue"]>>
  ) => void
  const promise = new Promise<
    Awaited<ReturnType<NeedsAttentionApi["loadCatalogue"]>>
  >((r) => (resolve = r))
  return { promise, resolve }
}

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
    // The list carries no reason for a failed upload: say so plainly.
    expect(
      attentionReason(row(1, { status: "pending", uploadState: "failed" }))
    ).toBe("This file can't be used: no reason was given.")
    // A temporary failure keeps its labels for a Retry: not "can't be used".
    expect(
      attentionReason(
        row(1, { status: "pending", uploadState: "failed", retryable: true })
      )
    ).toBe("Labels not saved yet.")
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
    const retrying = row(4, {
      status: "pending",
      code: null,
      uploadState: "failed",
      retryable: true,
    })
    expect(attentionItems([fix, saving, dead, retrying])).toEqual([
      fix,
      dead,
      retrying,
    ])
  })

  it("keeps labels on a ready photo that are still waiting off the list", () => {
    // upload_state is uploading | processing | ready | failed, and a removed
    // photo's stored labels go with it: only failed is a dead upload.
    expect(
      attentionItems([
        row(1, { status: "pending", code: null, uploadState: "ready" }),
        row(2, { status: "pending", code: null, uploadState: "uploading" }),
      ])
    ).toEqual([])
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
    ).toBe("Photo 1 of 2: The menu changed. Check the dish.")
    // Rows with the same reason are still told apart by ear.
    expect(rows[1].getAttribute("aria-labelledby")).not.toBe(
      rows[0].getAttribute("aria-labelledby")
    )
    expect(
      document.getElementById(rows[1].getAttribute("aria-labelledby")!)
        ?.textContent
    ).toBe("Video 2 of 2: Labels not saved yet.")
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
    expect(item.textContent).toContain(
      "This file can't be used: no reason was given."
    )
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
    const onDiscarded = vi.fn()
    const calls = api([row(1), row(2)])
    vi.mocked(calls.discard)
      .mockResolvedValueOnce(DISCARDED)
      .mockResolvedValueOnce({ ok: false })
    render(<NeedsAttention api={calls} onDiscarded={onDiscarded} />)
    await screen.findByRole("list", { name: "Photos that need attention" })

    const first = within(list()).getAllByRole("listitem")[0]
    await discardRow(user, first)
    expect(calls.discard).toHaveBeenCalledWith(row(1).assetId)
    await waitFor(() =>
      expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    )
    expect(onDiscarded).toHaveBeenCalledWith([row(1).assetId])

    const second = within(list()).getAllByRole("listitem")[0]
    await discardRow(user, second)
    expect(await within(second).findByRole("alert")).toHaveProperty(
      "textContent",
      ATTENTION_COPY.discardFailed
    )
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    expect(onDiscarded).toHaveBeenCalledTimes(1)
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

  it("keeps a discarded row gone when an older read answers afterwards", async () => {
    const user = userEvent.setup()
    let answer!: (r: Awaited<ReturnType<NeedsAttentionApi["load"]>>) => void
    const calls = api([row(1), row(2)])
    const { rerender } = render(
      <NeedsAttention api={calls} refreshSignal={0} />
    )
    await screen.findByRole("list", { name: "Photos that need attention" })
    // An upload finishes: a new read starts and is answered late, with the
    // list as it was before the discard below.
    vi.mocked(calls.load).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve))
    )
    rerender(<NeedsAttention api={calls} refreshSignal={1} />)
    const first = within(list()).getAllByRole("listitem")[0]
    await discardRow(user, first)
    await waitFor(() =>
      expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    )
    await act(async () => answer({ ok: true, items: [row(1), row(2)] }))
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
  })

  it("keeps each row busy until its own action ends, and drops a fix for a row discarded meanwhile", async () => {
    const user = userEvent.setup()
    let discardDone!: (result: DiscardResult) => void
    let contextDone!: () => void
    const calls = api([row(1), row(2)])
    vi.mocked(calls.discard).mockImplementationOnce(
      () => new Promise((resolve) => (discardDone = resolve))
    )
    const realContext = calls.loadContext
    calls.loadContext = vi.fn(
      (ids: string[]) =>
        new Promise((resolve) => {
          contextDone = () => resolve(realContext(ids))
        })
    ) as typeof calls.loadContext
    render(<NeedsAttention api={calls} />)
    await screen.findByRole("list", { name: "Photos that need attention" })
    const [a, b] = within(list()).getAllByRole("listitem")
    await discardRow(user, a)
    await user.click(within(b).getByRole("button", { name: "Fix labels" }))
    // A's discard ends; B is still loading its labels, so it stays busy.
    await act(async () => discardDone(DISCARDED))
    const fixB = within(list()).getByRole("button", { name: "Fix labels" })
    expect((fixB as HTMLButtonElement).disabled).toBe(true)
    await act(async () => contextDone())
    expect(
      await screen.findByRole("dialog", { name: "Fix labels" })
    ).toBeTruthy()
  })

  it("closes an open Fix labels when a re-read no longer lists that row", async () => {
    const user = userEvent.setup()
    const calls = api([row(1)])
    const { rerender, container } = render(
      <NeedsAttention api={calls} refreshSignal={0} />
    )
    await user.click(await screen.findByRole("button", { name: "Fix labels" }))
    await screen.findByRole("dialog", { name: "Fix labels" })
    // Fixed on another device: the next read has nothing.
    vi.mocked(calls.load).mockResolvedValue({ ok: true, items: [] })
    rerender(<NeedsAttention api={calls} refreshSignal={1} />)
    await waitFor(() => expect(container.textContent).toBe(""))
    // A later row needing attention must not reopen the old dialog.
    vi.mocked(calls.load).mockResolvedValue({ ok: true, items: [row(2)] })
    rerender(<NeedsAttention api={calls} refreshSignal={2} />)
    await screen.findByRole("list", { name: "Photos that need attention" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Needs attention: honest about what is on the photo", () => {
  const APPLIED: MediaLabelSummary = {
    ...EMPTY_LABEL_SUMMARY,
    revision: 1,
    hasLabels: true,
    items: [
      {
        itemId: SOUP,
        variantId: null,
        name: "Lentil Soup",
        variantName: null,
        sectionName: "Starters",
        labelledAs: null,
        state: "current",
      },
    ],
    updatedAt: "2026-11-07T10:05:00.000Z",
  }

  it("asks before discarding, in Me's words, and Keep labels keeps them (m7)", async () => {
    const user = userEvent.setup()
    const calls = api([row(1)])
    render(<NeedsAttention api={calls} />)
    await user.click(
      await screen.findByRole("button", { name: "Discard labels" })
    )
    const confirm = await screen.findByRole("alertdialog")
    expect(
      within(confirm).getByRole("heading", { name: "Discard these labels?" })
    ).toBeTruthy()
    expect(confirm.textContent).toContain(
      "The photo isn't changed; only these labels are discarded."
    )
    expect(calls.discard).not.toHaveBeenCalled()
    await user.click(
      within(confirm).getByRole("button", { name: "Keep labels" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(calls.discard).not.toHaveBeenCalled()
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
  })

  it("shows a temporary upload failure as labels not saved yet, with Fix labels (M3)", async () => {
    const user = userEvent.setup()
    const onFixed = vi.fn()
    const retrying = row(1, {
      status: "pending",
      code: null,
      message: null,
      uploadState: "failed",
      retryable: true,
    })
    const calls = api([retrying], {
      // The photo isn't ready, so the editor context has no asset for it.
      loadContext: vi.fn<NeedsAttentionApi["loadContext"]>(async () => ({
        ok: true,
        viewer: "staff",
        assets: [],
        missing: [retrying.assetId],
        catalogue: null,
        focus: null,
      })),
      save: vi.fn<NeedsAttentionApi["save"]>(async (_venue, input) => ({
        ok: true,
        assetId: input.assetId,
        labels: EMPTY_LABEL_SUMMARY,
        pending: true,
      })),
    })
    render(<NeedsAttention api={calls} onFixed={onFixed} />)
    const item = (await screen.findAllByRole("listitem"))[0]
    expect(item.textContent).toContain("Labels not saved yet.")
    expect(item.textContent).toContain(ATTENTION_COPY.photoNotFinished)
    expect(item.textContent).not.toContain("can't be used")
    expect(item.textContent).not.toContain("Not saved (photo not saved)")
    expect(
      within(item).getByRole("button", { name: "Discard labels" })
    ).toBeTruthy()

    // Fix labels opens the kept labels against the venue's current menu.
    await user.click(within(item).getByRole("button", { name: "Fix labels" }))
    await screen.findByRole("dialog", { name: "Fix labels" })
    expect(calls.loadCatalogue).toHaveBeenCalledWith(VENUE)
    const props = dialog.last!
    expect(props.asset).toMatchObject({
      id: retrying.assetId,
      venueId: VENUE,
      venueName: "The Railway",
      labels: EMPTY_LABEL_SUMMARY,
    })
    expect(props.draft).toEqual(retrying.input)
    expect(props.catalogue).toEqual({ state: "ready", catalogue: CATALOGUE })

    // Saved on the server, not on the photo yet: the row stays, re-read.
    await act(async () => {
      await props.onSave(retrying.input)
    })
    expect(onFixed).not.toHaveBeenCalled()
    await waitFor(() => expect(calls.load).toHaveBeenCalledTimes(2))
    const [still] = within(list()).getAllByRole("listitem")
    expect(still.textContent).toContain("Labels not saved yet.")
    expect(within(still).queryByText("Saved")).toBeNull()
  })

  // A retryable row the Fix labels can't open: the menu doesn't load.
  const RETRYING = row(1, {
    status: "pending",
    code: null,
    message: null,
    uploadState: "failed",
    retryable: true,
  })
  const notReady: NeedsAttentionApi["loadContext"] = async () => ({
    ok: true,
    viewer: "staff",
    assets: [],
    missing: [RETRYING.assetId],
    catalogue: null,
    focus: null,
  })

  it("says so when the menu for a retryable fix can't be loaded", async () => {
    const user = userEvent.setup()
    const calls = api([RETRYING], {
      loadContext: vi.fn(notReady),
      loadCatalogue: vi.fn<NeedsAttentionApi["loadCatalogue"]>(async () => ({
        ok: false,
        message: "The menu could not be loaded.",
      })),
    })
    render(<NeedsAttention api={calls} />)
    const fix = await screen.findByRole("button", { name: "Fix labels" })
    await user.click(fix)
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The menu could not be loaded."
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect((fix as HTMLButtonElement).disabled).toBe(false)
  })

  it("saves a retryable row's fix on the photo once it is ready, and only then drops it", async () => {
    const user = userEvent.setup()
    const onFixed = vi.fn()
    // The default api: the photo is ready now, and the save lands on it.
    const calls = api([RETRYING])
    render(<NeedsAttention api={calls} onFixed={onFixed} />)
    await user.click(await screen.findByRole("button", { name: "Fix labels" }))
    await screen.findByRole("dialog", { name: "Fix labels" })
    expect(calls.loadCatalogue).not.toHaveBeenCalled()
    await act(async () => {
      await dialog.last!.onSave(RETRYING.input)
    })
    expect(onFixed).toHaveBeenCalledWith([RETRYING.assetId])
    act(() => dialog.last!.onOpenChange(false))
    expect(
      screen.queryByRole("list", { name: "Photos that need attention" })
    ).toBeNull()
  })

  it("opens nothing when the row leaves the list while Fix labels loads", async () => {
    const user = userEvent.setup()
    const menu = deferredMenu()
    const calls = api([RETRYING], {
      loadContext: vi.fn(notReady),
      loadCatalogue: vi.fn(() => menu.promise),
    })
    const { rerender } = render(
      <NeedsAttention api={calls} refreshSignal={0} />
    )
    await user.click(await screen.findByRole("button", { name: "Fix labels" }))
    // The photo's Retry applied the labels: the next read lists only
    // another photo.
    vi.mocked(calls.load).mockResolvedValue({ ok: true, items: [row(2)] })
    rerender(<NeedsAttention api={calls} refreshSignal={1} />)
    await waitFor(() => expect(calls.load).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(within(list()).getAllByRole("listitem")).toHaveLength(1)
    )
    await act(async () => menu.resolve({ ok: true, catalogue: CATALOGUE }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("says the labels were already saved even when the server didn't list them", async () => {
    const user = userEvent.setup()
    const onFixed = vi.fn()
    const calls = api([row(1)], {
      discard: vi.fn<NeedsAttentionApi["discard"]>(async () => ({
        ok: true,
        state: "already_applied",
        labels: null,
      })),
    })
    render(<NeedsAttention api={calls} onFixed={onFixed} />)
    await discardRow(user, (await screen.findAllByRole("listitem"))[0])
    const item = await screen.findByText(
      "These labels were already saved on the photo."
    )
    const rowEl = item.closest("li")!
    expect(within(rowEl).getByText("Saved")).toBeTruthy()
    expect(within(rowEl).queryByRole("list", { name: "Menu items" })).toBeNull()
    expect(onFixed).toHaveBeenCalledWith([row(1).assetId])
    // Fix labels opens what the photo has now, at its revision.
    await user.click(within(rowEl).getByRole("button", { name: "Fix labels" }))
    await screen.findByRole("dialog", { name: "Fix labels" })
    expect(dialog.last!.draft.expectedRevision).toBe(
      dialog.last!.asset.labels.revision
    )
    expect(dialog.last!.problem).toBeNull()
  })

  it("says the labels were already on the photo when a discard came too late (m2)", async () => {
    const user = userEvent.setup()
    const onFixed = vi.fn()
    const onDiscarded = vi.fn()
    const calls = api([row(1)], {
      discard: vi.fn<NeedsAttentionApi["discard"]>(async () => ({
        ok: true,
        state: "already_applied",
        labels: APPLIED,
      })),
      loadContext: vi.fn<NeedsAttentionApi["loadContext"]>(async (ids) => ({
        ok: true,
        viewer: "staff",
        assets: ids.map((id) => ({
          id,
          venueId: VENUE,
          venueName: "The Railway",
          originalFilename: "soup.jpg",
          mediaType: "image" as const,
          thumbnailUrl: null,
          labels: APPLIED,
        })),
        missing: [],
        catalogue: CATALOGUE,
        focus: null,
      })),
    })
    const { rerender } = render(
      <NeedsAttention
        api={calls}
        refreshSignal={0}
        onFixed={onFixed}
        onDiscarded={onDiscarded}
      />
    )
    await discardRow(user, (await screen.findAllByRole("listitem"))[0])

    // The row stays and tells the truth: nothing was discarded.
    const item = await waitFor(() => {
      const [only] = within(list()).getAllByRole("listitem")
      expect(list().children).toHaveLength(1)
      expect(only.textContent).toContain(
        "These labels were already saved on the photo."
      )
      return only
    })
    expect(within(item).getByText("Saved")).toBeTruthy()
    expect(within(item).queryByText("Needs attention")).toBeNull()
    expect(within(item).getByText("Lentil Soup")).toBeTruthy()
    expect(
      within(item).queryByRole("button", { name: "Discard labels" })
    ).toBeNull()
    expect(onFixed).toHaveBeenCalledWith([row(1).assetId])
    expect(onDiscarded).not.toHaveBeenCalled()

    // A re-read no longer lists it (nothing is stored); it stays anyway.
    vi.mocked(calls.load).mockResolvedValue({ ok: true, items: [] })
    rerender(
      <NeedsAttention
        api={calls}
        refreshSignal={1}
        onFixed={onFixed}
        onDiscarded={onDiscarded}
      />
    )
    await waitFor(() => expect(calls.load).toHaveBeenCalledTimes(2))
    // (The row's own labels are a nested list: count the rows only.)
    expect(list().children).toHaveLength(1)
    expect(list().contains(item)).toBe(true)

    // Fix labels opens the labels on the photo, at the photo's revision.
    await user.click(within(item).getByRole("button", { name: "Fix labels" }))
    await screen.findByRole("dialog", { name: "Fix labels" })
    expect(dialog.last!.problem).toBeNull()
    expect(dialog.last!.draft).toMatchObject({
      assetId: row(1).assetId,
      expectedRevision: 1,
      items: [{ itemId: SOUP, variantId: null }],
    })
    act(() => dialog.last!.onOpenChange(false))

    // Keep labels: done with it.
    await user.click(within(item).getByRole("button", { name: "Keep labels" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Photos that need attention" })
      ).toBeNull()
    )
  })

  it("settles a discard that found nothing stored as discarded", async () => {
    const user = userEvent.setup()
    const onDiscarded = vi.fn()
    const calls = api([row(1)], {
      discard: vi.fn<NeedsAttentionApi["discard"]>(async () => ({
        ok: true,
        state: "none",
      })),
    })
    const { container } = render(
      <NeedsAttention api={calls} onDiscarded={onDiscarded} />
    )
    await discardRow(user, (await screen.findAllByRole("listitem"))[0])
    await waitFor(() => expect(container.textContent).toBe(""))
    expect(onDiscarded).toHaveBeenCalledWith([row(1).assetId])
  })
})
