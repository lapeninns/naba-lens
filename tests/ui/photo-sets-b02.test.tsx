// @vitest-environment jsdom
// B02-05: several photos of one subject make one set. Add groups them as
// they are reserved and says one notice per set; the guidance step comes
// before a dish's picker; Review shows a set as one card with each photo
// decided on its own; My contributions says "One of a set of {n}".
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refresh, supabase, uploads, sets, review } = vi.hoisted(() => ({
  refresh: vi.fn(),
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
    },
  },
  uploads: { current: null as unknown },
  sets: {
    startPhotoSet: vi.fn(),
    addToPhotoSet: vi.fn(),
    readPhotoSets: vi.fn(),
    readDeleteEvidence: vi.fn(async () => ({ status: "missing" })),
    deleteMedia: vi.fn(),
  },
  review: {
    decideMenuPhotoAction: vi.fn(),
    loadReviewPageAction: vi.fn(),
    loadMenuItemsPageAction: vi.fn(),
    loadItemEventsAction: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/staff/menu",
}))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/_media/actions", () => sets)
vi.mock("@/app/manager/actions", () => review)
vi.mock("@/app/staff/_shell/upload-label-api", () => ({
  loadUploadLabelContext: vi.fn(async () => ({
    ok: false,
    message: "The menu could not be loaded. Try again.",
  })),
  saveUploadLabels: vi.fn(),
  discardUploadLabels: vi.fn(),
  loadLabelAttention: vi.fn(),
  loadPhotoLabels: vi.fn(),
}))

import { AddHost } from "@/app/staff/_shell/add-host"
import { MyContributions } from "@/components/nabalens/knowledge/my-contributions"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewList } from "@/components/nabalens/manager/review/review-list"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { setNotices } from "@/components/nabalens/upload-dialog"
import type {
  QueueItem,
  UploadContext,
  Uploader,
} from "@/components/nabalens/upload-queue"
import { PhotoTips } from "@/components/nabalens/guide/photo-tips"
import { PHOTO_TIPS_TITLE } from "@/components/nabalens/guide/photo-tips-copy"
import {
  GUIDE_RULES,
  GUIDE_SAFETY,
  GUIDE_SUBJECT_TIPS,
} from "@/lib/guide/dish-guide"
import type { FeedPhotoItem } from "@/lib/knowledge/contract"
import type { DecisionOutcome, QueueCard } from "@/lib/server/menu-photos/types"
import type { EntryMenu } from "@/lib/work-client/entry"

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const SOUP = id(0xc1)
const GROUP = id(0x6001)

/** Reserves each file as `asset-{name}`; "bad.jpg" fails after that. */
const uploader: Uploader = async (file, context: UploadContext) => {
  const assetId = `asset-${file.name}`
  context.onReserved?.(assetId)
  if (file.name === "bad.jpg") throw new Error("The upload failed. Retry.")
  return { assetId }
}

const MENU: EntryMenu = {
  venueName: "TEST Inn",
  intents: ["dish", "photos"],
  tasks: [],
  questions: [],
  answered: [],
}

const DISH: OpenAddOptions = {
  source: "library",
  imagesOnly: true,
  preset: {
    itemId: SOUP,
    variantId: null,
    itemName: "Soup",
    variantName: null,
  },
}

function Opener({ opts, label }: { opts: OpenAddOptions; label: string }) {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.(opts)}>
      {label}
    </button>
  )
}

function host(entry: Promise<EntryMenu | null> | null, opts = DISH) {
  return render(
    <AddHost
      blocked={null}
      captchaRequired={false}
      captchaSiteKey={null}
      entry={entry}
      venueName="TEST Inn"
    >
      <Opener label="Soup photos" opts={opts} />
      <Opener label="Just photos" opts={{ source: "library" }} />
    </AddHost>
  )
}

/** Every upload in the sheet has ended (its footer says nothing is saving). */
const settledIn = (dialog: HTMLElement) =>
  waitFor(() =>
    expect(
      within(dialog)
        .getAllByRole("status")
        .map((el) => el.textContent)
        .join(" ")
    ).toMatch(/saved(?!.*saving)/)
  )

const libraryInput = () =>
  document.querySelector<HTMLInputElement>(
    'input[data-photo-source="library"]'
  )!

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  uploads.current = uploader
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  sets.startPhotoSet.mockResolvedValue({ status: "ok", groupId: GROUP })
  sets.addToPhotoSet.mockImplementation(
    async (input: { assetIds: string[] }) => ({
      status: "ok",
      members: input.assetIds.length,
    })
  )
  sets.readPhotoSets.mockResolvedValue({ status: "missing" })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("Add: a set of photos of one dish", () => {
  it("groups one pick as it is reserved and says one notice", async () => {
    const user = userEvent.setup()
    const menu = Promise.resolve(MENU)
    host(menu)
    await menu
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    await user.upload(libraryInput(), [
      jpeg("one.jpg"),
      jpeg("two.jpg"),
      jpeg("three.jpg"),
    ])
    const dialog = await screen.findByRole("dialog", {
      name: "Saving 3 photos",
    })
    expect(
      await within(dialog).findByText(ENTRY_COPY.setSaved(3, "Soup"))
    ).toBeTruthy()
    expect(sets.startPhotoSet).toHaveBeenCalledTimes(1)
    expect(sets.startPhotoSet.mock.calls[0][0]).toMatchObject({
      subject: { kind: "menu_item", id: SOUP },
    })
    await waitFor(() =>
      expect(
        sets.addToPhotoSet.mock.calls.flatMap(([input]) => input.assetIds)
      ).toEqual(["asset-one.jpg", "asset-two.jpg", "asset-three.jpg"])
    )
    // The notice is polite: focus stays where it was.
    const notice = within(dialog).getByText(ENTRY_COPY.setSaved(3, "Soup"))
    expect(notice.closest("[aria-live=polite]")).toBeTruthy()
    expect(document.activeElement).not.toBe(notice)
    // "Add more to this set" joins the same set.
    expect(
      within(dialog).getByRole("button", { name: ENTRY_COPY.addMoreToSet })
    ).toBeTruthy()
    await user.upload(
      dialog.querySelector<HTMLInputElement>('input[type="file"]')!,
      [jpeg("four.jpg")]
    )
    expect(
      await within(dialog).findByText(ENTRY_COPY.setSaved(4, "Soup"))
    ).toBeTruthy()
    await waitFor(() =>
      expect(sets.addToPhotoSet).toHaveBeenLastCalledWith({
        groupId: GROUP,
        assetIds: ["asset-four.jpg"],
      })
    )
    expect(sets.startPhotoSet).toHaveBeenCalledTimes(1)
  })

  it("lists a file that didn't finish, and never fails an upload for its group", async () => {
    sets.startPhotoSet.mockResolvedValue({ status: "failed", retry: false })
    const user = userEvent.setup()
    const menu = Promise.resolve(MENU)
    host(menu)
    await menu
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    await user.upload(libraryInput(), [jpeg("good.jpg"), jpeg("bad.jpg")])
    const dialog = await screen.findByRole("dialog")
    expect(
      await within(dialog).findByText(ENTRY_COPY.setSaved(1, "Soup"))
    ).toBeTruthy()
    expect(
      within(dialog).getByText("bad.jpg: The upload failed. Retry.")
    ).toBeTruthy()
    expect(sets.addToPhotoSet).not.toHaveBeenCalled()
  })

  it("keeps today's single-file acknowledgement and plain Just photos", async () => {
    const user = userEvent.setup()
    const menu = Promise.resolve(MENU)
    host(menu)
    await menu
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    await user.upload(libraryInput(), [jpeg("one.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Saving 1 photo",
    })
    await settledIn(dialog)
    expect(within(dialog).queryByText(/Each is reviewed on its own/)).toBeNull()
    expect(sets.startPhotoSet).not.toHaveBeenCalled()
  })

  it("is today's Add with the entry off (b01) or groups missing", async () => {
    const user = userEvent.setup()
    host(null)
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    await user.upload(libraryInput(), [jpeg("one.jpg"), jpeg("two.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Saving 2 photos",
    })
    await settledIn(dialog)
    expect(within(dialog).queryByText(/Each is reviewed on its own/)).toBeNull()
    expect(
      within(dialog).getByRole("button", { name: "Add more" })
    ).toBeTruthy()
    expect(sets.startPhotoSet).not.toHaveBeenCalled()
    cleanup()

    sets.startPhotoSet.mockResolvedValue({ status: "missing" })
    const menu = Promise.resolve(MENU)
    host(menu)
    await menu
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    await user.upload(libraryInput(), [jpeg("one.jpg"), jpeg("two.jpg")])
    const again = await screen.findByRole("dialog")
    await waitFor(() => expect(sets.startPhotoSet).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        within(again).getByRole("button", { name: "Add more" })
      ).toBeTruthy()
    )
    expect(within(again).queryByText(/Each is reviewed on its own/)).toBeNull()
  })

  it("never starts a set for an account that can't upload (R8)", async () => {
    const user = userEvent.setup()
    const menu = Promise.resolve({ ...MENU, intents: ["question" as const] })
    host(menu)
    await menu
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    await user.upload(libraryInput(), [jpeg("one.jpg"), jpeg("two.jpg")])
    await screen.findByRole("dialog", { name: "Saving 2 photos" })
    expect(sets.startPhotoSet).not.toHaveBeenCalled()
  })
})

describe("Photo tips are optional (D8)", () => {
  it("opens the dish's picker straight away, with no step in between", () => {
    const menu = Promise.resolve(MENU)
    host(menu, { ...DISH, source: "camera" })
    const camera = document.querySelector<HTMLInputElement>(
      'input[data-photo-source="camera"]'
    )!
    const click = vi.spyOn(camera, "click")
    fireEvent.click(screen.getByRole("button", { name: "Soup photos" }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("keeps the tips closed until asked, with the guide's words, the subject tips and the safety line", async () => {
    const user = userEvent.setup()
    render(<PhotoTips guideHref="/staff/tasks/guide" />)
    const summary = screen.getByText(PHOTO_TIPS_TITLE)
    const details = summary.closest("details")!
    expect(details.open).toBe(false)
    await user.click(summary)
    expect(details.open).toBe(true)
    for (const rule of GUIDE_RULES)
      expect(within(details).getByText(rule)).toBeTruthy()
    expect(GUIDE_SUBJECT_TIPS.map((tip) => tip.title)).toEqual([
      "Tandoor and grilled dishes",
      "Bread",
      "Drinks",
    ])
    for (const tip of GUIDE_SUBJECT_TIPS) {
      expect(
        within(details).getByRole("heading", { name: tip.title })
      ).toBeTruthy()
      expect(within(details).getByText(tip.text)).toBeTruthy()
    }
    expect(within(details).getByText(GUIDE_SAFETY)).toBeTruthy()
    expect(
      within(details)
        .getByRole("link", { name: "See the full photo guide" })
        .getAttribute("href")
    ).toBe("/staff/tasks/guide")
  })

  it("makes no claim beyond the tips", () => {
    const words = GUIDE_SUBJECT_TIPS.map((tip) => tip.text).join(" ")
    expect(words).not.toMatch(
      /allergen|ingredient|available|price|policy|review|credit|count|must|at least/i
    )
  })
})

describe("setNotices", () => {
  const item = (
    name: string,
    status: QueueItem["status"],
    error: string | null = null
  ): QueueItem => ({
    id: name,
    file: jpeg(name),
    kind: "image",
    status,
    progress: 1,
    error,
    attempts: 1,
  })
  const setOf = (file: File) =>
    file.name.startsWith("s") ? { id: "set-1", subject: "Naan" } : null

  it("waits for every file of a set, and skips single files", () => {
    const detail = (i: QueueItem) => i.error
    expect(
      setNotices([item("s1", "done"), item("s2", "uploading")], setOf, detail)
    ).toEqual([])
    expect(setNotices([item("s1", "done")], setOf, detail)).toEqual([])
    expect(
      setNotices(
        [
          item("s1", "done"),
          item("s2", "failed", "Try again."),
          item("x", "done"),
        ],
        setOf,
        detail
      )
    ).toEqual([
      {
        id: "set-1",
        text: "1 photo of Naan saved. Each is reviewed on its own.",
        unfinished: ["s2: Try again."],
      },
    ])
  })
})

// ---- Review -------------------------------------------------------------------------

function card(n: number, over: Partial<QueueCard> = {}): QueueCard {
  const assetId = id(0xa00 + n)
  return {
    key: id(0x100 + n),
    kind: "labelled",
    labelId: id(0x100 + n),
    photoId: null,
    asset: {
      assetId,
      thumbnailUrl: `/api/menu-photos/${assetId}/thumb`,
      previewUrl: `/api/menu-photos/${assetId}/preview`,
      width: 320,
      height: 240,
    },
    uploadedAt: "2026-11-04T12:00:00.000Z",
    labelledAt: "2026-11-04T12:05:00.000Z",
    contributor: {
      id: id(0xf1),
      name: "TEST Sam Lee",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: SOUP,
      name: "Soup",
      sectionId: id(0x5),
      sectionName: "Starters",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [
      {
        itemId: SOUP,
        variantId: null,
        itemName: "Soup",
        variantName: null,
        onMenu: true,
      },
    ],
    state: null,
    isPrimary: false,
    isEffectivePrimary: false,
    basis: null,
    reason: null,
    recheckKind: null,
    correctsItemId: null,
    correctsVariantId: null,
    correctsItemName: null,
    itemRevision: 3,
    groupCount: 2,
    ...over,
  }
}

function reviewList(cards: QueueCard[]) {
  return render(
    <ReviewList
      initial={{ items: cards, nextCursor: null }}
      view={{
        status: "pending",
        sectionId: null,
        contributorId: null,
        itemId: null,
      }}
      scope={{ kind: "manager" }}
      venueName="The Railway"
      now="2026-11-07T12:00:00.000Z"
    />
  )
}

const cardEl = (key: string) =>
  document.querySelector<HTMLElement>(`[data-card-key="${key}"]`)!

describe("Review: a set as one card", () => {
  it("groups adjacent photos of a set, each decided on its own", async () => {
    const [a, b, c] = [card(1), card(2), card(3)]
    sets.readPhotoSets.mockResolvedValue({
      status: "ok",
      groups: [
        { assetId: a.asset.assetId, groupId: GROUP },
        { assetId: b.asset.assetId, groupId: GROUP },
      ],
    })
    const user = userEvent.setup()
    reviewList([a, b, c])
    const label = await screen.findByText(REVIEW_COPY.set(2))
    const set = label.closest("section")!
    expect(set.getAttribute("aria-labelledby")).toBe(label.id)
    expect(
      within(set).getAllByRole("button", { name: REVIEW_COPY.accept })
    ).toHaveLength(2)
    expect(set.contains(cardEl(c.key))).toBe(false)
    // The item heading still counts every photo of the item.
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: REVIEW_COPY.groupHeading("Soup", 3),
      })
    ).toBeTruthy()
    expect(sets.readPhotoSets).toHaveBeenCalledWith({
      assetIds: [a.asset.assetId, b.asset.assetId, c.asset.assetId],
    })

    review.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      outcome: {
        action: "accept",
        itemId: SOUP,
        itemRevision: 4,
        replayed: false,
        itemCovered: true,
        preferredAssetId: a.asset.assetId,
        cards: [],
      } satisfies DecisionOutcome,
    })
    await user.click(
      within(cardEl(a.key)).getByRole("button", { name: REVIEW_COPY.accept })
    )
    // Focus follows the usual rule: the next photo, here in the same set.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(cardEl(b.key)).getByRole("button", { name: REVIEW_COPY.accept })
      )
    )
    expect(review.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
  })

  it("shows today's cards when the lookup is missing or fails", async () => {
    sets.readPhotoSets.mockRejectedValue(new Error("offline"))
    reviewList([card(1), card(2)])
    await waitFor(() => expect(sets.readPhotoSets).toHaveBeenCalled())
    expect(screen.queryByText(REVIEW_COPY.set(2))).toBeNull()
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: REVIEW_COPY.groupHeading("Soup", 3),
      })
    ).toBeTruthy()
  })
})

// ---- My contributions -----------------------------------------------------------

function photo(n: number, groupId: string | null): FeedPhotoItem {
  return {
    type: "photo",
    key: `p:${n}`,
    at: "2026-11-06T10:00:00.000Z",
    assetId: `a${n}`,
    venueId: "v1",
    venueName: "TEST Inn",
    mediaType: "image",
    uploadState: n === 2 ? "failed" : "ready",
    sentAt: `2026-11-06T10:0${n}:00.000Z`,
    labels: { hasLabels: true, needsLabels: false, needsAttention: false },
    menuDecisions: [],
    menuUseAccepted: false,
    groupId,
  }
}

describe("My contributions: one of a set", () => {
  it("says it on adjacent rows of one group, keeping each row's own lines", () => {
    render(
      <MyContributions
        initial={{
          items: [
            photo(1, GROUP),
            photo(2, GROUP),
            photo(3, null),
            photo(4, GROUP),
          ],
          nextCursor: null,
        }}
        drafts={[]}
        venue={{ id: "v1", name: "TEST Inn" }}
        loadMore={vi.fn()}
      />
    )
    const rows = within(screen.getByRole("list", { name: "My contributions" }))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.closest("li")!)
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByText("One of a set of 2")).toBeTruthy()
    expect(within(rows[0]).getByText("Upload: Saved")).toBeTruthy()
    expect(within(rows[1]).getByText("One of a set of 2")).toBeTruthy()
    expect(within(rows[1]).getByText("Upload: Didn't finish")).toBeTruthy()
    expect(within(rows[2]).queryByText(/One of a set/)).toBeNull()
    // Not next to the others: no count from rows it isn't beside.
    expect(within(rows[3]).queryByText(/One of a set/)).toBeNull()
  })
})
