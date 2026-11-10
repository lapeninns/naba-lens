// @vitest-environment jsdom
// A manager account's My uploads (B02 UI design §5.6, §6.1; B02-c): its own
// photo rows from the R5 feed, labelled later through the label editor, with
// the same switches as manager Add, and the overview's R1 line.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/manager/uploads",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

const auth = vi.hoisted(() => ({
  requireManagerVenue: vi.fn(),
  getManagerWorkspace: vi.fn(),
}))
vi.mock("@/lib/auth/manager", () => auth)

const media = vi.hoisted(() => ({ getMediaActor: vi.fn() }))
vi.mock("@/lib/server/media/context", () => media)

const work = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getContributions: vi.fn(),
  getLabelWork: vi.fn(),
}))
vi.mock("@/lib/work-client/services", () => ({ workServices: work }))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: { getWorkingList: vi.fn() },
}))
vi.mock("@/app/_knowledge/actions", () => ({
  loadMoreContributionsAction: vi.fn(),
}))

// The editor itself is covered by the labels host tests; here it saves at
// once so the row can be seen to change.
const editor = vi.hoisted(() => ({ opened: [] as string[][] }))
vi.mock("@/app/_labels/label-editor-host", () => ({
  LabelEditorHost: (props: {
    assetIds: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved?: (results: unknown[]) => void
  }) => {
    if (!props.open) return null
    editor.opened.push(props.assetIds)
    return (
      <div role="dialog" aria-label="Labels">
        <button
          type="button"
          onClick={() => {
            props.onSaved?.(
              props.assetIds.map((assetId) => ({
                ok: true,
                assetId,
                labels: { hasLabels: true },
              }))
            )
            props.onOpenChange(false)
          }}
        >
          Save labels
        </button>
      </div>
    )
  },
}))

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { OverviewBody } from "@/components/nabalens/manager/overview/overview-body"
import { managerNeedsLabels, managerUploadsOn } from "@/app/manager/entry"
import ManagerUploadsPage from "@/app/manager/uploads/page"
import { MyUploads } from "@/app/manager/uploads/my-uploads"
import type {
  ContributionsFeedPage,
  FeedPhotoItem,
  FeedTaskSendItem,
} from "@/lib/knowledge/contract"
import type { ManagerOverview } from "@/lib/server/menu-photos/types"
import { parseContributionsPage } from "@/lib/work-client/parse"

const VENUE = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "The Railway",
}
const ACTOR = { profile: { id: "m1", role: "manager" } }
const copy = MANAGER_COPY.uploads

function photo(over: Partial<FeedPhotoItem> = {}): FeedPhotoItem {
  return {
    type: "photo",
    key: "p:a1",
    at: "2026-11-06T10:00:00.000Z",
    assetId: "a1",
    venueId: VENUE.id,
    venueName: VENUE.name,
    mediaType: "image",
    uploadState: "ready",
    sentAt: "2026-11-06T10:00:00.000Z",
    labels: { hasLabels: false, needsLabels: true, needsAttention: false },
    menuDecisions: [],
    menuUseAccepted: false,
    ...over,
  }
}

const taskSend = {
  type: "task_send",
  key: "t:s1",
  at: "2026-11-06T09:00:00.000Z",
  itemId: "s1",
  submissionId: "sub1",
  requirementId: "r1",
  requirementTitle: "Bar at opening",
  venueId: VENUE.id,
  venueName: VENUE.name,
  sentAt: "2026-11-06T09:00:00.000Z",
  state: "submitted",
  reason: null,
  revision: 1,
  replacesSentAt: null,
} as unknown as FeedTaskSendItem

const finding = {
  type: "finding",
  key: "c:f1",
  at: "2026-11-06T08:00:00.000Z",
} as unknown as ContributionsFeedPage["items"][number]

const page = (
  items: ContributionsFeedPage["items"],
  nextCursor: string | null = null
): ContributionsFeedPage => ({ items, nextCursor }) as ContributionsFeedPage

const capabilities = (canUpload: boolean) => ({
  status: "ok",
  value: { venueId: VENUE.id, canUpload },
})

beforeEach(() => {
  vi.clearAllMocks()
  editor.opened = []
  delete process.env.NABALENS_CONTRIBUTION_ENTRY
  delete process.env.NABALENS_CONTRIBUTION_ENTRY_B01_VENUES
  auth.requireManagerVenue.mockResolvedValue({ venue: VENUE })
  media.getMediaActor.mockResolvedValue({ ok: true, actor: ACTOR })
  work.getCapabilities.mockResolvedValue(capabilities(true))
  work.getContributions.mockResolvedValue({ status: "ok", value: page([]) })
  work.getLabelWork.mockResolvedValue({
    status: "ok",
    value: { needsLabels: 3, needsAttention: 0 },
  })
})
afterEach(cleanup)

describe("My uploads list", () => {
  it("lists the photo rows in server order with their lines, and leaves task sends and findings out", () => {
    render(
      <MyUploads
        initial={page([
          photo({
            key: "p:a2",
            assetId: "a2",
            labels: {
              hasLabels: true,
              needsLabels: false,
              needsAttention: false,
            },
            menuDecisions: [
              {
                photoId: null,
                itemId: "i1",
                itemName: "Fish pie",
                variantName: null,
                state: "waiting",
                reason: null,
                decidedAt: null,
              },
            ],
          }),
          taskSend,
          finding,
          photo({
            key: "p:a1",
            assetId: "a1",
            menuUseAccepted: true,
            menuDecisions: [
              {
                photoId: "ph1",
                itemId: "i2",
                itemName: "Burger",
                variantName: null,
                state: "accepted",
                reason: null,
                decidedAt: "2026-11-06T12:00:00.000Z",
              },
            ],
          }),
        ])}
        venue={VENUE}
        loadMore={vi.fn()}
      />
    )
    const list = screen.getByRole("list", { name: copy.title })
    const rows = within(list)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === list)
    expect(rows.map((r) => within(r).getByRole("heading").textContent)).toEqual(
      ["Fish pie", "Burger"]
    )
    expect(within(rows[0]).getByText("Labels: Labelled")).toBeTruthy()
    expect(within(rows[0]).getByText("Fish pie: Waiting")).toBeTruthy()
    expect(within(rows[1]).getByText("Labels: Needs labels")).toBeTruthy()
    expect(
      within(rows[1]).getByText("Burger: Accepted for menu use")
    ).toBeTruthy()
    expect(within(rows[1]).getByText("Accepted for menu use")).toBeTruthy()
    expect(screen.queryByText(/Bar at opening/)).toBeNull()
    // The thumbnail goes through the own-media route.
    expect(rows[1].querySelector("img")?.getAttribute("src")).toBe(
      "/api/media/a1/thumb"
    )
    expect(
      within(rows[0]).getByRole("button", { name: copy.editLabels })
    ).toBeTruthy()
    expect(
      within(rows[1]).getByRole("button", { name: copy.addLabels })
    ).toBeTruthy()
  })

  it("offers no delete anywhere", () => {
    render(
      <MyUploads
        initial={page([photo(), photo({ key: "p:a3", assetId: "a3" })])}
        venue={VENUE}
        loadMore={vi.fn()}
      />
    )
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull()
    expect(screen.queryByText(/delete/i)).toBeNull()
  })

  it("offers labels only once the upload is saved", () => {
    render(
      <MyUploads
        initial={page([photo({ uploadState: "processing" })])}
        venue={VENUE}
        loadMore={vi.fn()}
      />
    )
    expect(screen.getByText("Upload: Saving")).toBeTruthy()
    expect(screen.queryByRole("button", { name: copy.addLabels })).toBeNull()
  })

  it("opens the label editor for that photo and updates the row after a save", () => {
    render(
      <MyUploads
        initial={page([
          photo({ key: "p:a2", assetId: "a2" }),
          photo({ key: "p:a1", assetId: "a1" }),
        ])}
        venue={VENUE}
        loadMore={vi.fn()}
      />
    )
    const rows = screen.getAllByRole("button", { name: copy.addLabels })
    fireEvent.click(rows[1])
    expect(editor.opened.at(-1)).toEqual(["a1"])
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getAllByText("Labels: Needs labels")).toHaveLength(1)
    expect(screen.getAllByText("Labels: Labelled")).toHaveLength(1)
    expect(
      screen.getAllByRole("button", { name: copy.editLabels })
    ).toHaveLength(1)
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })

  it("pages with Show more, keeping focus on it while loading and moving it to the first new photo", async () => {
    let resolve!: (value: unknown) => void
    const loadMore = vi.fn(
      () => new Promise((r) => (resolve = r))
    ) as unknown as Parameters<typeof MyUploads>[0]["loadMore"]
    render(
      <MyUploads
        initial={page([photo()], "2026-11-06T10:00:00.000000Z|p:a1")}
        venue={VENUE}
        loadMore={loadMore}
      />
    )
    const more = screen.getByRole("button", { name: "Show more" })
    more.focus()
    fireEvent.click(more)
    expect(more.getAttribute("aria-disabled")).toBe("true")
    expect(document.activeElement).toBe(more)
    expect(loadMore).toHaveBeenCalledWith({
      cursor: "2026-11-06T10:00:00.000000Z|p:a1",
    })
    await act(async () =>
      resolve({
        ok: true,
        page: page([taskSend, photo({ key: "p:a0", assetId: "a0" })]),
      })
    )
    const heading = screen.getAllByRole("heading")[1]
    expect(document.activeElement).toBe(heading)
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull()
  })

  it("says so when the first page can't be read", () => {
    render(<MyUploads initial={null} venue={VENUE} loadMore={vi.fn()} />)
    expect(screen.getByText(copy.failed)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href")
    ).toBe(managerHrefs.uploads)
  })

  // WS1 c1f96273 leaves a manager's staff-era uploads out of its feed and
  // says each photo's recorded role; the view also never lists one marked
  // otherwise (default 13).
  it("lists only manager-era uploads", () => {
    const parsed = parseContributionsPage({
      items: [
        photo({ key: "p:m1", assetId: "m1", uploaderRole: "manager" }),
        photo({ key: "p:s1", assetId: "s1", uploaderRole: "staff" }),
        photo({ key: "p:n1", assetId: "n1", uploaderRole: null }),
        photo({ key: "p:u1", assetId: "u1" }),
      ],
      nextCursor: null,
    })
    expect(parsed).not.toBeNull()
    render(<MyUploads initial={parsed} venue={VENUE} loadMore={vi.fn()} />)
    const shown = [...document.querySelectorAll("img")]
      .map((img) => img.getAttribute("src") ?? "")
      .join(" ")
    expect(shown).toContain("/api/media/m1/thumb")
    expect(shown).not.toContain("/api/media/s1/thumb")
    expect(shown).not.toContain("/api/media/n1/thumb")
    expect(shown).toContain("/api/media/u1/thumb")
  })
})
describe("My uploads page gating", () => {
  async function renderPage() {
    render(await ManagerUploadsPage())
  }

  it("shows the caller's photos when the entry is b02 and R8 says canUpload", async () => {
    work.getContributions.mockResolvedValue({
      status: "ok",
      value: page([photo()]),
    })
    await renderPage()
    expect(
      screen.getByRole("heading", { level: 1, name: copy.title })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: copy.addLabels })).toBeTruthy()
  })

  it("is not found with the entry on b01 for the venue", async () => {
    process.env.NABALENS_CONTRIBUTION_ENTRY_B01_VENUES = VENUE.id
    await expect(ManagerUploadsPage()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(work.getContributions).not.toHaveBeenCalled()
  })

  it("is not found when R8 says the account can't upload", async () => {
    work.getCapabilities.mockResolvedValue(capabilities(false))
    await expect(ManagerUploadsPage()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("is not found when R8 fails or names another venue", async () => {
    work.getCapabilities.mockResolvedValue({
      status: "failed",
      failure: { ok: false, code: "unavailable", status: 503, message: "x" },
    })
    await expect(ManagerUploadsPage()).rejects.toThrow("NEXT_NOT_FOUND")
    work.getCapabilities.mockResolvedValue({
      status: "ok",
      value: { venueId: "other", canUpload: true },
    })
    await expect(ManagerUploadsPage()).rejects.toThrow("NEXT_NOT_FOUND")
    work.getCapabilities.mockRejectedValue(new Error("down"))
    await expect(ManagerUploadsPage()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("says it can't show uploads yet when the feed is missing", async () => {
    work.getContributions.mockResolvedValue({ status: "missing" })
    await renderPage()
    expect(screen.getByText(copy.missing)).toBeTruthy()
    expect(screen.queryByRole("list", { name: copy.title })).toBeNull()
  })

  it("says the list failed when the feed read fails", async () => {
    work.getContributions.mockResolvedValue({
      status: "failed",
      failure: { ok: false, code: "unavailable", status: 503, message: "x" },
    })
    await renderPage()
    expect(screen.getByText(copy.failed)).toBeTruthy()
  })
})

describe("Overview: photos that need labels (R1)", () => {
  it("reads R1 only while uploads are on, and a failed read is null", async () => {
    await expect(managerUploadsOn(VENUE.id)).resolves.toBe(true)
    await expect(managerNeedsLabels(VENUE.id)).resolves.toBe(3)

    work.getLabelWork.mockResolvedValue({
      status: "failed",
      failure: { ok: false, code: "unavailable", status: 503, message: "x" },
    })
    await expect(managerNeedsLabels(VENUE.id)).resolves.toBeNull()
    work.getLabelWork.mockRejectedValue(new Error("down"))
    await expect(managerNeedsLabels(VENUE.id)).resolves.toBeNull()

    work.getLabelWork.mockResolvedValue({
      status: "ok",
      value: { needsLabels: 3, needsAttention: 0 },
    })
    work.getCapabilities.mockResolvedValue(capabilities(false))
    await expect(managerNeedsLabels(VENUE.id)).resolves.toBeNull()
    work.getCapabilities.mockResolvedValue(capabilities(true))
    process.env.NABALENS_CONTRIBUTION_ENTRY = "b01"
    await expect(managerNeedsLabels(VENUE.id)).resolves.toBeNull()
  })

  function overview(): ManagerOverview {
    return {
      venueId: VENUE.id,
      venueName: VENUE.name,
      menuState: "no_menu",
    } as ManagerOverview
  }

  it("shows the count as a link to My uploads, in plural-aware words", () => {
    render(
      <OverviewBody
        overview={overview()}
        now="2026-11-10T10:00:00.000Z"
        needsLabels={3}
      />
    )
    const link = screen.getByRole("link", { name: "3 photos need labels" })
    expect(link.getAttribute("href")).toBe("/manager/uploads")
    cleanup()
    render(
      <OverviewBody
        overview={overview()}
        now="2026-11-10T10:00:00.000Z"
        needsLabels={1}
      />
    )
    expect(
      screen.getByRole("link", { name: "1 photo needs labels" })
    ).toBeTruthy()
  })

  it("is hidden at zero and when the read failed", () => {
    render(
      <OverviewBody
        overview={overview()}
        now="2026-11-10T10:00:00.000Z"
        needsLabels={0}
      />
    )
    expect(screen.queryByRole("link", { name: /need(s)? labels/ })).toBeNull()
    cleanup()
    render(
      <OverviewBody
        overview={overview()}
        now="2026-11-10T10:00:00.000Z"
        needsLabels={null}
      />
    )
    expect(screen.queryByRole("link", { name: /need(s)? labels/ })).toBeNull()
  })
})
