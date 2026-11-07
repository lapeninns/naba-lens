// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MediaItem } from "@/components/nabalens/types"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/_media/actions", () => ({
  logout: vi.fn(),
  deleteMedia: vi.fn(),
}))
vi.mock("@/app/staff/actions", () => ({ loadMyMedia: vi.fn() }))
const gallery = vi.hoisted(() => ({ signals: [] as number[] }))
vi.mock("@/app/_media/media-gallery", () => ({
  MediaGallery: ({
    label,
    refreshSignal,
  }: {
    label: string
    refreshSignal?: number
  }) => {
    gallery.signals.push(refreshSignal ?? 0)
    return <section aria-label={label} />
  },
}))
type HostProps = {
  assetIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (results: { ok: boolean; assetId: string }[]) => void
}
const host = vi.hoisted(() => ({ last: null as HostProps | null }))
vi.mock("@/app/_labels/label-editor-host", () => ({
  LabelEditorHost: (props: HostProps) => {
    host.last = props
    return props.open ? (
      <div role="dialog" aria-label="Labels">
        {props.assetIds.join(",")}
      </div>
    ) : null
  },
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    avatarUrl,
    todoCount,
  }: {
    children: React.ReactNode
    avatarUrl?: string | null
    todoCount?: number
  }) => (
    <div data-avatar={avatarUrl ?? ""} data-todo={todoCount ?? ""}>
      {children}
    </div>
  ),
}))

const me = vi.hoisted(() => ({
  profile: {
    id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
    displayName: "Anil Thapa",
    jobTitle: "Bar supervisor",
    department: "foh",
    venueId: "v1",
    venue: { id: "v1", name: "The Railway", active: true },
    avatarPath: "7c2e/a.webp",
    work: null as null | Record<string, unknown>,
  },
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => me.profile),
  uploadBlockReason: () => null,
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({ ok: true, actor: {} })),
}))

function item(id: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: `https://storage.test/${id}.webp`,
    previewUrl: null,
    mimeType: "image/webp",
    originalFilename: null,
    createdAt: "2026-11-06T10:00:00.000Z",
    contributorId: "me",
    contributorName: "Anil Thapa",
    venueName: "The Railway",
    labels: EMPTY_LABEL_SUMMARY,
    ...overrides,
  }
}
const LABELLED = { ...EMPTY_LABEL_SUMMARY, hasLabels: true, revision: 1 }

const library = vi.hoisted(() => ({
  items: [] as MediaItem[],
  byId: [] as MediaItem[],
  listOwnMediaByIds: vi.fn(),
}))
vi.mock("@/lib/server/media/library", () => ({
  listOwnMedia: vi.fn(async () => ({
    ok: true,
    items: library.items,
    nextCursor: null,
  })),
  listOwnMediaByIds: library.listOwnMediaByIds,
  avatarUrl: () => "/api/avatars/me",
}))
vi.mock("@/app/staff/can-manage", () => ({
  canManageVenue: vi.fn(async () => false),
}))
const coverage = vi.hoisted(() => ({
  getManagerReviewCount: vi.fn(),
  getMyTasks: vi.fn(),
  listMyMenuPhotoDecisions: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)

import {
  photoMilestone,
  photosNeedingLabels,
} from "@/app/staff/staff-portfolio"
import StaffPage from "@/app/staff/page"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  gallery.signals = []
  library.byId = []
  me.profile.work = null
})

library.listOwnMediaByIds.mockImplementation(
  async (_actor: unknown, ids: string[]) => ({
    ok: true,
    items: ids.flatMap((id) => library.byId.filter((m) => m.id === id)),
  })
)

describe("Me: work details and the guide", () => {
  it("shows the self-described role with the venue and both rows", async () => {
    me.profile.work = {
      roleKey: "other",
      roleTitle: "Pot wash",
      workAreas: [],
      welcomeDismissedAt: null,
    }
    library.items = []
    render(await StaffPage())
    expect(screen.getByText("Pot wash at The Railway")).toBeTruthy()
    const rows = within(screen.getByRole("navigation", { name: "Your work" }))
    expect(
      rows
        .getByRole("link", { name: /^Edit work details/ })
        .getAttribute("href")
    ).toBe("/staff/profile?next=/staff")
    expect(
      rows
        .getByRole("link", { name: /^How Naba-Lens works/ })
        .getAttribute("href")
    ).toBe("/staff/tasks/welcome?from=me")
  })

  it("passes the avatar and Home's To do count to the shell", async () => {
    library.items = []
    const { tasksView } = await import("./tasks-fixtures")
    coverage.getMyTasks.mockResolvedValueOnce({ ok: true, tasks: tasksView() })
    const { container } = render(await StaffPage())
    const shell = container.firstElementChild as HTMLElement
    expect(shell.dataset.avatar).toBe("/api/avatars/me")
    expect(shell.dataset.todo).not.toBe("")
  })

  it("still renders when the task and menu reads fail", async () => {
    library.items = [item("a1")]
    coverage.getMyTasks.mockRejectedValueOnce(new Error("down"))
    coverage.listMyMenuPhotoDecisions.mockRejectedValueOnce(new Error("down"))
    const { container } = render(await StaffPage())
    expect((container.firstElementChild as HTMLElement).dataset.todo).toBe("")
    expect(
      screen.getByRole("link", { name: /^Edit work details/ })
    ).toBeTruthy()
  })

  it("opens Edit profile straight away from ?edit=profile", async () => {
    library.items = []
    render(
      await StaffPage({ searchParams: Promise.resolve({ edit: "profile" }) })
    )
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeTruthy()
  })

  it("drops ?edit=profile when Edit profile closes, so Back does not reopen it", async () => {
    library.items = []
    window.history.replaceState(null, "", "/staff?edit=profile&x=1")
    render(
      await StaffPage({ searchParams: Promise.resolve({ edit: "profile" }) })
    )
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Edit profile" }), {
      key: "Escape",
    })
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/staff?x=1"
    )
    window.history.replaceState(null, "", "/")
  })
})

describe("Me: Needs labels and milestones", () => {
  it("lists ready photos without labels and labels them in one batch", async () => {
    library.items = [
      item("a1"),
      item("a2", { labels: LABELLED }),
      item("a3"),
      item("a4", { uploadState: "processing", labels: undefined }),
    ]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [],
    })
    render(await StaffPage())
    const section = screen.getByRole("region", { name: /Needs labels/ })
    const tiles = within(
      within(section).getByRole("list", { name: "Photos that need labels" })
    ).getAllByRole("listitem")
    expect(tiles).toHaveLength(2)
    expect(tiles[0].textContent).toContain("Ready to label")

    fireEvent.click(
      within(section).getByRole("button", { name: "Label these 2 photos" })
    )
    expect(screen.getByRole("dialog", { name: "Labels" }).textContent).toBe(
      "a1,a3"
    )
    const before = gallery.signals.at(-1)
    act(() => {
      host.last?.onSaved?.([
        { ok: true, assetId: "a1" },
        { ok: false, assetId: "a3" },
      ])
      host.last?.onOpenChange(false)
    })
    // a1 is labelled now; the gallery refreshes so its badges catch up.
    expect(
      within(
        screen.getByRole("list", { name: "Photos that need labels" })
      ).getAllByRole("listitem")
    ).toHaveLength(1)
    expect(gallery.signals.at(-1)).toBe((before ?? 0) + 1)
  })

  it("shows Accepted for menu use with the dish, even beyond the newest page", async () => {
    // a1 is older than the newest gallery page (not in library.items).
    library.items = [item("a2")]
    library.byId = [item("a1", { labels: LABELLED })]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [
        {
          photoId: "p1",
          assetId: "a1",
          itemId: "i1",
          itemName: "Lamb rogan josh",
          variantId: null,
          variantName: null,
          state: "accepted",
          isPrimary: true,
          reason: null,
        },
      ],
    })
    render(await StaffPage())
    expect(library.listOwnMediaByIds).toHaveBeenCalledWith({}, ["a1"])
    const accepted = within(
      screen.getByRole("list", { name: "Photos accepted for menu use" })
    ).getAllByRole("listitem")
    expect(accepted).toHaveLength(1)
    expect(accepted[0].textContent).toContain("Accepted for menu use")
    expect(accepted[0].textContent).toContain("Lamb rogan josh")
  })

  it("shows a better photo request with the reviewer's reason", async () => {
    library.items = []
    library.byId = [item("b1", { labels: LABELLED })]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [
        {
          photoId: "p2",
          assetId: "b1",
          itemId: "i2",
          itemName: "Chicken curry",
          variantId: null,
          variantName: null,
          state: "better_photo_requested",
          isPrimary: false,
          reason: "Too dark, shoot near the pass",
        },
      ],
    })
    render(await StaffPage())
    const tiles = within(
      screen.getByRole("list", {
        name: "Photos with a better photo requested",
      })
    ).getAllByRole("listitem")
    expect(tiles).toHaveLength(1)
    expect(tiles[0].textContent).toContain("Better photo requested")
    expect(tiles[0].textContent).toContain(
      "Chicken curry: Too dark, shoot near the pass"
    )
    expect(
      screen.queryByRole("list", { name: "Photos accepted for menu use" })
    ).toBeNull()
  })

  it("words each photo's milestone", () => {
    const accepted = new Set(["a3"])
    expect(photoMilestone(item("a1"), accepted)).toBe("label")
    expect(photoMilestone(item("a2", { labels: LABELLED }), accepted)).toBe(
      "saved"
    )
    expect(photoMilestone(item("a3", { labels: LABELLED }), accepted)).toBe(
      "accepted"
    )
    expect(
      photoMilestone(item("a4", { uploadState: "failed" }), accepted)
    ).toBeNull()
    // At most one label batch at a time.
    expect(
      photosNeedingLabels(Array.from({ length: 14 }, (_, i) => item(`x${i}`)))
    ).toHaveLength(10)
  })
})
