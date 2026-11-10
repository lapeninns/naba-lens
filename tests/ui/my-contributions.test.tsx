// @vitest-environment jsdom
// Me's My contributions (B02 UI design §6.1, HM-06, HM-09, D13).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/staff",
}))

import {
  MY_CONTRIBUTIONS_COPY,
  MyContributions,
} from "@/components/nabalens/knowledge/my-contributions"
import type {
  ContributionsFeedPage,
  FeedPhotoItem,
  FeedTaskSendItem,
} from "@/lib/knowledge/contract"

afterEach(cleanup)

const VENUE = { id: "v1", name: "TEST Inn" }

function photo(over: Partial<FeedPhotoItem> = {}): FeedPhotoItem {
  return {
    type: "photo",
    key: "p:a1",
    at: "2026-11-06T10:00:00.000Z",
    assetId: "a1",
    venueId: "v1",
    venueName: "TEST Inn",
    mediaType: "image",
    uploadState: "ready",
    sentAt: "2026-11-06T10:00:00.000Z",
    labels: { hasLabels: true, needsLabels: false, needsAttention: false },
    menuDecisions: [],
    menuUseAccepted: false,
    ...over,
  }
}

function taskSend(over: Partial<FeedTaskSendItem> = {}): FeedTaskSendItem {
  return {
    type: "task_send",
    key: "t:s1",
    at: "2026-11-05T10:00:00.000Z",
    itemId: "s1",
    submissionId: "sub1",
    requirementId: "r1",
    requirementTitle: "Bar at opening",
    venueId: "v1",
    venueName: "TEST Inn",
    assetId: "a9",
    assetAvailable: true,
    state: "submitted",
    reason: null,
    decidedAt: null,
    archived: false,
    sentAt: "2026-11-05T10:00:00.000Z",
    replacesItemId: null,
    replacesSentAt: null,
    revision: 1,
    ...over,
  }
}

const page = (
  items: ContributionsFeedPage["items"],
  nextCursor: string | null = null
): ContributionsFeedPage => ({ items, nextCursor })

function show(
  initial: ContributionsFeedPage | null,
  extra: Partial<React.ComponentProps<typeof MyContributions>> = {}
) {
  return render(
    <MyContributions
      initial={initial}
      drafts={[]}
      venue={VENUE}
      loadMore={vi.fn()}
      {...extra}
    />
  )
}

const rowOf = (name: string) =>
  screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement

describe("My contributions: photo rows", () => {
  it("says each dimension on its own line", () => {
    show(
      page([
        photo({
          uploadState: "uploading",
          labels: {
            hasLabels: false,
            needsLabels: true,
            needsAttention: false,
          },
        }),
      ])
    )
    const row = rowOf("Photo")
    expect(within(row).getByText("Upload: Saving")).toBeTruthy()
    expect(within(row).getByText("Labels: Needs labels")).toBeTruthy()
    expect(within(row).getByText(/^Sent /)).toBeTruthy()
    expect(within(row).queryByText(MY_CONTRIBUTIONS_COPY.menuUse)).toBeNull()
  })

  it("names the menu items, one review line each, use only when accepted, never a revision", () => {
    show(
      page([
        photo({
          uploadState: "failed",
          labels: {
            hasLabels: true,
            needsLabels: false,
            needsAttention: true,
          },
          menuDecisions: [
            {
              photoId: "ph1",
              itemId: "i1",
              itemName: "Fish pie",
              variantName: null,
              state: "accepted",
              reason: null,
              decidedAt: "2026-11-06T12:00:00.000Z",
            },
            {
              photoId: "ph2",
              itemId: "i2",
              itemName: "Burger",
              variantName: null,
              state: "better_photo_requested",
              reason: "Too dark",
              decidedAt: "2026-11-06T12:00:00.000Z",
            },
            {
              photoId: "ph3",
              itemId: "i3",
              itemName: "Soup",
              variantName: null,
              state: "needs_recheck",
              reason: null,
              decidedAt: "2026-11-06T12:00:00.000Z",
            },
          ],
          menuUseAccepted: true,
        }),
      ])
    )
    const row = rowOf("Fish pie, Burger, Soup")
    expect(within(row).getByText("Upload: Didn't finish")).toBeTruthy()
    expect(within(row).getByText("Labels: Label needs attention")).toBeTruthy()
    expect(
      within(row).getByText("Fish pie: Accepted for menu use")
    ).toBeTruthy()
    expect(
      within(row).getByText("Burger: Asked for a better photo: Too dark")
    ).toBeTruthy()
    expect(within(row).getByText("Soup: Needs a recheck")).toBeTruthy()
    expect(within(row).getByText(MY_CONTRIBUTIONS_COPY.menuUse)).toBeTruthy()
    expect(within(row).queryByText(/Revision/)).toBeNull()
  })

  it("says no new photo is needed for an item off the menu, with no action (D13)", () => {
    show(
      page([
        photo({
          menuDecisions: [
            {
              photoId: "ph1",
              itemId: "i1",
              itemName: "Fish pie",
              variantName: null,
              state: "better_photo_requested",
              reason: "Blurred",
              decidedAt: "2026-11-06T12:00:00.000Z",
            },
          ],
        }),
      ]),
      { offMenuPhotoIds: ["ph1"] }
    )
    const row = rowOf("Fish pie")
    expect(within(row).getByText(MY_CONTRIBUTIONS_COPY.offMenu)).toBeTruthy()
    expect(within(row).queryByRole("link")).toBeNull()
    expect(within(row).queryByRole("button")).toBeNull()
  })
})

describe("My contributions: task sends", () => {
  it("says the review, and a revision with what it replaced only after the first send", () => {
    show(
      page([
        taskSend({
          key: "t:s2",
          requirementTitle: "Garden tables",
          state: "needs_another_photo",
          reason: "Show the whole garden",
          revision: 2,
          replacesSentAt: "2026-11-01T10:00:00.000Z",
        }),
        taskSend({ state: "accepted" }),
      ])
    )
    const replaced = rowOf("Garden tables")
    expect(
      within(replaced).getByText(
        "Review: Needs another photo: Show the whole garden"
      )
    ).toBeTruthy()
    expect(within(replaced).getByText(/^Revision 2/)).toBeTruthy()
    expect(
      within(replaced).getByText(/^Replaces your photo sent 1 Nov/)
    ).toBeTruthy()
    const first = rowOf("Bar at opening")
    expect(within(first).getByText("Review: Accepted")).toBeTruthy()
    expect(within(first).queryByText(/Revision/)).toBeNull()
  })
})

describe("My contributions: paging (HM-06, HM-09)", () => {
  it("shows more with aria-disabled while loading, then focuses the first new row", async () => {
    let release: (value: unknown) => void = () => {}
    const loadMore = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    show(page([photo()], "c1"), {
      loadMore: loadMore as never,
    })
    const more = screen.getByRole("button", { name: "Show more" })
    fireEvent.click(more)
    expect(loadMore).toHaveBeenCalledWith({ cursor: "c1" })
    const busy = screen.getByRole("button", {
      name: MY_CONTRIBUTIONS_COPY.loading,
    })
    expect(busy.getAttribute("aria-disabled")).toBe("true")
    await act(async () => {
      release({ ok: true, page: page([taskSend()]) })
    })
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 3, name: "Bar at opening" })
    )
  })

  it("keeps what is loaded and focuses Try again when the next page fails", async () => {
    const loadMore = vi.fn(async () => ({ ok: false, message: "down" }))
    show(page([photo()], "c1"), { loadMore: loadMore as never })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    })
    const retry = screen.getByRole("button", { name: "Try again" })
    expect(document.activeElement).toBe(retry)
    expect(rowOf("Photo")).toBeTruthy()
  })

  it("re-seeds when the server's first page changes", () => {
    const { rerender } = show(page([photo()]))
    expect(rowOf("Photo")).toBeTruthy()
    rerender(
      <MyContributions
        initial={page([taskSend()])}
        drafts={[]}
        venue={VENUE}
        loadMore={vi.fn()}
      />
    )
    expect(
      screen.queryByRole("heading", { level: 3, name: "Photo" })
    ).toBeNull()
    expect(rowOf("Bar at opening")).toBeTruthy()
  })

  it("says the list couldn't be loaded, never that nothing was sent", () => {
    show(null)
    expect(screen.getByText(MY_CONTRIBUTIONS_COPY.failed)).toBeTruthy()
    expect(screen.queryByText(MY_CONTRIBUTIONS_COPY.empty)).toBeNull()
  })
})

describe("My contributions: labelled photos still waiting (R5)", () => {
  it("says {item}: Waiting beside the decided lines", () => {
    show(
      page([
        photo({
          menuDecisions: [
            {
              photoId: "ph1",
              itemId: "i1",
              itemName: "Fish pie",
              variantName: null,
              state: "accepted",
              reason: null,
              decidedAt: "2026-11-06T12:00:00.000Z",
            },
            {
              photoId: null,
              itemId: "i2",
              itemName: "Burger",
              variantName: null,
              state: "waiting",
              reason: null,
              decidedAt: null,
            },
          ],
        }),
      ])
    )
    const row = rowOf("Fish pie, Burger")
    expect(within(row).getByText("Burger: Waiting")).toBeTruthy()
    expect(
      within(row).getByText("Fish pie: Accepted for menu use")
    ).toBeTruthy()
  })
})
