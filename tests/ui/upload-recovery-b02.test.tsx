// @vitest-environment jsdom
// B02-06 recovery: an upload that stopped (reload, tab close, Leave anyway)
// says so on the tile, the viewer and Me's Needs attention, with Open Add
// (UP-01, UP-02); Me's rows keep focus when they go (UP-12); Me's portfolio
// milestone has its own chip (HM-13); Add's closed-sheet announcement (UP-11).
import * as React from "react"
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

import {
  ATTENTION_COPY,
  NeedsAttention,
  attentionItems,
  type NeedsAttentionApi,
} from "@/app/staff/needs-attention"
import { needsAttentionWords } from "@/app/staff/_shell/add-host"
import { MediaTile } from "@/components/nabalens/media-tile"
import { MediaViewer } from "@/components/nabalens/media-viewer"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import { chipState } from "@/components/nabalens/status-chip"
import type { MediaItem } from "@/components/nabalens/types"
import { stoppedText } from "@/components/nabalens/upload-stopped"
import type { PendingLabelItem } from "@/lib/menus/types"

vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
}))

afterEach(cleanup)

const ME = "user-me"
const HOUR = 60 * 60 * 1000
const RESUMES =
  "Stopped. Choose the same photo again from Add to finish it; it continues where it stopped."
const NO_RESUME = "Stopped. Choose the same photo again from Add to finish it."

function media(extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "asset-1",
    mediaType: "image",
    uploadState: "uploading",
    thumbnailUrl: null,
    previewUrl: null,
    mimeType: null,
    originalFilename: "dish.jpg",
    createdAt: new Date(Date.now() - HOUR).toISOString(),
    contributorId: ME,
    contributorName: "Priya",
    venueName: "The Barley Mow",
    ...extra,
  }
}

function Add({
  held = [],
  openAdd = vi.fn(),
  children,
}: {
  held?: string[]
  openAdd?: () => void
  children: React.ReactNode
}) {
  return (
    <AddProvider
      value={{ openAdd, holds: { assetIds: new Set(held), account: ME } }}
    >
      {children}
    </AddProvider>
  )
}

describe("stoppedText (UP-01)", () => {
  const now = Date.parse("2026-11-10T12:00:00Z")
  it("promises it continues only while the resume key can still apply", () => {
    expect(
      stoppedText("image", new Date(now - 19 * HOUR).toISOString(), now)
    ).toBe(RESUMES)
    expect(
      stoppedText("image", new Date(now - 21 * HOUR).toISOString(), now)
    ).toBe(NO_RESUME)
    expect(stoppedText("image", null, now)).toBe(NO_RESUME)
    expect(stoppedText("video", new Date(now - HOUR).toISOString(), now)).toBe(
      "Stopped. Choose the same video again from Add to finish it; it continues where it stopped."
    )
  })
})

describe("a stopped upload on the tile (UP-01)", () => {
  it("says Stopped with Open Add once this device's queue no longer holds it", async () => {
    const user = userEvent.setup()
    const openAdd = vi.fn()
    render(
      <Add openAdd={openAdd}>
        <MediaTile item={media()} onOpen={() => {}} />
      </Add>
    )
    const tile = screen.getByRole("button", { name: /^Photo, uploaded / })
    expect(tile.getAttribute("aria-label")).toMatch(/Stopped$/)
    expect(screen.getByText(RESUMES)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Open Add" }))
    expect(openAdd).toHaveBeenCalledTimes(1)
  })

  it("drops the resume promise for an upload older than the key's 20 hours", () => {
    render(
      <Add>
        <MediaTile
          item={media({
            createdAt: new Date(Date.now() - 21 * HOUR).toISOString(),
          })}
          onOpen={() => {}}
        />
      </Add>
    )
    expect(screen.getByText(NO_RESUME)).toBeTruthy()
  })

  it("still says Uploading while the queue holds it, for someone else's, and outside the staff layout", () => {
    render(
      <>
        <Add held={["asset-1"]}>
          <MediaTile item={media()} onOpen={() => {}} />
        </Add>
        <Add>
          <MediaTile
            item={media({ id: "asset-2", contributorId: "someone-else" })}
            onOpen={() => {}}
          />
        </Add>
        <MediaTile item={media({ id: "asset-3" })} onOpen={() => {}} />
      </>
    )
    const tiles = screen.getAllByRole("button", { name: /^Photo, uploaded / })
    expect(tiles).toHaveLength(3)
    for (const tile of tiles)
      expect(tile.getAttribute("aria-label")).toMatch(/Uploading$/)
    expect(screen.queryByRole("button", { name: "Open Add" })).toBeNull()
  })
})

describe("a stopped upload in the viewer (UP-01)", () => {
  it("says what to do, and Open Add closes the viewer first", async () => {
    const user = userEvent.setup()
    const openAdd = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <Add openAdd={openAdd}>
        <MediaViewer item={media()} open onOpenChange={onOpenChange} />
      </Add>
    )
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(RESUMES)).toBeTruthy()
    expect(within(dialog).queryByText("Still uploading.")).toBeNull()
    await user.click(within(dialog).getByRole("button", { name: "Open Add" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(openAdd).toHaveBeenCalledTimes(1)
  })

  it("keeps Still uploading while this device is sending it", async () => {
    render(
      <Add held={["asset-1"]}>
        <MediaViewer item={media()} open onOpenChange={() => {}} />
      </Add>
    )
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Still uploading.")).toBeTruthy()
  })
})

function row(
  n: number,
  extra: Partial<PendingLabelItem> = {}
): PendingLabelItem {
  const assetId = `00000000-0000-4000-8000-00000000000${n}`
  return {
    assetId,
    venueId: "venue-1",
    status: "needs_attention",
    code: "catalogue_changed",
    message: null,
    input: {
      assetId,
      expectedRevision: 0,
      catalogueVersionId: "version-1",
      contentTypes: [],
      note: null,
      items: [],
      missingItem: null,
    },
    uploadState: "ready",
    retryable: false,
    mediaType: "image",
    thumbnailUrl: null,
    updatedAt: "2026-11-10T10:00:00Z",
    ...extra,
  }
}

function api(items: PendingLabelItem[]): NeedsAttentionApi {
  return {
    load: vi.fn(async () => ({ ok: true as const, items })),
    discard: vi.fn(async () => ({
      ok: true as const,
      state: "discarded" as const,
    })),
    save: vi.fn(),
    loadContext: vi.fn(),
    loadCatalogue: vi.fn(),
  } as unknown as NeedsAttentionApi
}

describe("Me's Needs attention for a stopped upload (UP-02)", () => {
  const stoppedRow = row(1, {
    status: "pending",
    code: null,
    uploadState: "uploading",
  })

  it("lists kept labels of an upload nothing is sending, with Open Add", async () => {
    const user = userEvent.setup()
    const openAdd = vi.fn()
    render(
      <Add openAdd={openAdd}>
        <NeedsAttention api={api([stoppedRow])} />
      </Add>
    )
    const list = await screen.findByRole("list", {
      name: ATTENTION_COPY.list,
    })
    const item = within(list).getByRole("listitem")
    expect(item.textContent).toContain(NO_RESUME)
    expect(item.textContent).toContain(
      "These labels are kept and go on it if you choose the same photo again from Add."
    )
    await user.click(within(item).getByRole("button", { name: "Open Add" }))
    expect(openAdd).toHaveBeenCalledTimes(1)
  })

  it("leaves them to Add while its queue is still sending the photo", async () => {
    const calls = api([stoppedRow])
    const { container } = render(
      <Add held={[stoppedRow.assetId]}>
        <NeedsAttention api={calls} />
      </Add>
    )
    await waitFor(() => expect(calls.load).toHaveBeenCalled())
    await act(async () => {})
    expect(container.textContent).toBe("")
  })

  it("offers Open Add for a temporarily failed upload too", async () => {
    render(
      <Add>
        <NeedsAttention
          api={api([row(1, { uploadState: "failed", retryable: true })])}
        />
      </Add>
    )
    const item = await screen.findByRole("listitem")
    expect(within(item).getByRole("button", { name: "Open Add" })).toBeTruthy()
    expect(item.textContent).toContain(ATTENTION_COPY.photoNotFinished)
  })

  it("attentionItems lists a pending upload only when it has stopped", () => {
    expect(attentionItems([stoppedRow])).toEqual([])
    expect(attentionItems([stoppedRow], () => true)).toEqual([stoppedRow])
  })
})

describe("Me's Needs attention keeps focus (UP-12)", () => {
  it("moves focus to the next row's first action after a discard, and says it once", async () => {
    const user = userEvent.setup()
    render(<NeedsAttention api={api([row(1), row(2)])} />)
    const list = await screen.findByRole("list", { name: ATTENTION_COPY.list })
    const [first, second] = within(list).getAllByRole("listitem")
    await user.click(
      within(first).getByRole("button", { name: ATTENTION_COPY.discard })
    )
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: ATTENTION_COPY.discard,
      })
    )
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(1)
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(second).getAllByRole("button")[0]
      )
    )
    expect(screen.getByRole("status").textContent).toBe(
      ATTENTION_COPY.discarded
    )
  })
})

describe("Me's portfolio milestone chip (HM-13)", () => {
  it("is its own key, not the knowledge draft's Saved", () => {
    const milestone = chipState("portfolio_saved")
    expect(milestone.word).toBe("Saved")
    expect(milestone.icon).toBeUndefined()
    expect(chipState("saved").icon).toBeDefined()
  })
})

describe("Add's closed-sheet announcement (UP-11)", () => {
  it("is plural-aware", () => {
    expect(needsAttentionWords(1)).toBe("1 photo needs attention. Open Add.")
    expect(needsAttentionWords(3)).toBe("3 photos need attention. Open Add.")
  })
})
