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
import { AddProvider } from "@/components/nabalens/shell/add-context"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/_media/actions", () => ({
  deleteMedia: vi.fn(),
}))
vi.mock("@/app/staff/actions", () => ({ loadMyMedia: vi.fn() }))
const gallery = vi.hoisted(() => ({
  signals: [] as number[],
  impact: undefined as ((item: MediaItem) => unknown) | undefined,
}))
vi.mock("@/app/_media/media-gallery", () => ({
  MediaGallery: ({
    label,
    refreshSignal,
    getDeleteImpact,
  }: {
    label: string
    refreshSignal?: number
    getDeleteImpact?: (item: MediaItem) => unknown
  }) => {
    gallery.signals.push(refreshSignal ?? 0)
    gallery.impact = getDeleteImpact
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
vi.mock("@/lib/server/amenities", () => ({
  getMyAmenityTasks: vi.fn(async () => ({ ok: true, tasks: [] })),
}))

import {
  betterPhotoRequests,
  photoMilestone,
  photosNeedingLabels,
  PROFILE_SAVE_COPY,
  saveProfile,
  StaffPortfolio,
  uploadsNoun,
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
    expect(
      rows.getByRole("link", { name: /^Photo guide/ }).getAttribute("href")
    ).toBe("/staff/tasks/guide")
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

  it("logs out on phones with a form POST to /auth/logout, which works after the session ended", async () => {
    library.items = []
    const { container } = render(await StaffPage())
    const form = container.querySelector("form[data-logout]")
    expect(form?.getAttribute("action")).toBe("/auth/logout")
    expect(form?.getAttribute("method")).toBe("post")
    expect(
      within(form as HTMLElement)
        .getByRole("button", { name: "Log out" })
        .getAttribute("type")
    ).toBe("submit")
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
  it("counts ready photos without labels once and labels them in one batch", async () => {
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
    // The photos are listed once, in the portfolio grid with their "Needs
    // labels" badge; the section is the count and the batch action only.
    expect(
      screen.queryByRole("list", { name: "Photos that need labels" })
    ).toBeNull()
    expect(within(section).getByText("2")).toBeTruthy()

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
      within(section).getByRole("button", { name: "Label this photo" })
    ).toBeTruthy()
    expect(gallery.signals.at(-1)).toBe((before ?? 0) + 1)
  })

  it("says files, not photos, when videos need labels too", async () => {
    const video = (id: string) =>
      item(id, { mediaType: "video", mimeType: "video/mp4" })
    library.items = [item("a1"), video("v1")]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [],
    })
    render(await StaffPage())
    const section = screen.getByRole("region", { name: /Needs labels/ })
    expect(section.textContent).toMatch(/2\s*files/)
    expect(section.textContent).not.toMatch(/photos/)
    fireEvent.click(
      within(section).getByRole("button", { name: "Label these 2 files" })
    )
    expect(screen.getByRole("dialog", { name: "Labels" }).textContent).toBe(
      "a1,v1"
    )

    expect(uploadsNoun([video("v2")])).toBe("video")
    expect(uploadsNoun([item("a2")])).toBe("photo")
    expect(uploadsNoun([item("a2"), item("a3")])).toBe("photos")
    expect(uploadsNoun([video("v2"), video("v3")])).toBe("files")
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
    // Deleting it from the portfolio says the dish may need a new photo.
    expect(gallery.impact?.(item("a1"))).toEqual({
      kind: "menu",
      dishes: ["Lamb rogan josh"],
    })
    expect(gallery.impact?.(item("a2"))).toBeUndefined()
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
    const row = screen.getByRole("article", { name: "Chicken curry" })
    expect(row.textContent).toContain("Too dark, shoot near the pass")
    expect(
      screen.queryByRole("list", { name: "Photos accepted for menu use" })
    ).toBeNull()
  })

  it("takes the replacement photo of a better-photo request in one tap, labelled with that dish", async () => {
    library.items = []
    library.byId = [
      item("b1", { labels: LABELLED }),
      item("b2", { labels: LABELLED }),
    ]
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
        {
          photoId: "p3",
          assetId: "b2",
          itemId: "i3",
          itemName: "Momo",
          variantId: "v-veg",
          variantName: "Veg",
          state: "better_photo_requested",
          isPrimary: false,
          reason: "Show all ten",
        },
      ],
    })
    const openAdd = vi.fn()
    render(<AddProvider value={{ openAdd }}>{await StaffPage()}</AddProvider>)
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Better photo requested/,
    })
    expect(within(heading).getByText("2")).toBeTruthy()

    const momo = screen.getByRole("article", { name: "Momo (Veg)" })
    expect(momo.textContent).toContain("Show all ten")
    fireEvent.click(
      within(momo).getByRole("button", { name: "Take a new photo" })
    )
    expect(openAdd).toHaveBeenLastCalledWith({
      source: "camera",
      imagesOnly: true,
      preset: {
        itemId: "i3",
        variantId: "v-veg",
        itemName: "Momo",
        variantName: "Veg",
      },
    })

    const curry = screen.getByRole("article", { name: "Chicken curry" })
    fireEvent.click(
      within(curry).getByRole("button", { name: "Choose from photos" })
    )
    expect(openAdd).toHaveBeenLastCalledWith({
      source: "library",
      imagesOnly: true,
      preset: {
        itemId: "i2",
        variantId: null,
        itemName: "Chicken curry",
        variantName: null,
      },
    })
    expect(openAdd).toHaveBeenCalledTimes(2)
  })

  it("treats only a newer photo, never a video, as the retake", () => {
    const momo = {
      ...LABELLED,
      items: [
        {
          itemId: "i3",
          variantId: "v-Veg",
          name: "Momo",
          variantName: "Veg",
          sectionName: "Starters",
          labelledAs: null,
          state: "current" as const,
        },
      ],
    }
    const later = "2026-11-07T09:00:00.000Z"
    const request = {
      photoId: "p1",
      assetId: "b1",
      itemId: "i3",
      itemName: "Momo",
      variantId: "v-Veg",
      variantName: "Veg",
      state: "better_photo_requested" as const,
      isPrimary: false,
      reason: "Brighter",
    }
    const old = item("b1", { labels: momo })
    const video = item("n1", {
      mediaType: "video",
      mimeType: "video/mp4",
      createdAt: later,
      labels: momo,
    })
    const photo = item("n2", { createdAt: later, labels: momo })

    // A labelled video can never be reviewed for the dish: still to retake.
    expect(
      betterPhotoRequests([request], [old], [old, video]).map((r) => r.sent)
    ).toEqual([false])
    // Nor does an accepted decision on a video close the request.
    expect(
      betterPhotoRequests(
        [
          request,
          { ...request, photoId: "p2", assetId: "n1", state: "accepted" },
        ],
        [old],
        [old, video]
      ).map((r) => r.sent)
    ).toEqual([false])
    // A labelled newer photo is the retake, waiting for review.
    expect(
      betterPhotoRequests([request], [old], [old, video, photo]).map(
        (r) => r.sent
      )
    ).toEqual([true])
  })

  it("keeps Take a new photo on Me when the newer upload of the dish is a video", async () => {
    const momo = {
      ...LABELLED,
      items: [
        {
          itemId: "i3",
          variantId: null,
          name: "Momo",
          variantName: null,
          sectionName: "Starters",
          labelledAs: null,
          state: "current" as const,
        },
      ],
    }
    library.items = [
      item("n1", {
        mediaType: "video",
        mimeType: "video/mp4",
        createdAt: "2026-11-07T09:00:00.000Z",
        labels: momo,
      }),
    ]
    library.byId = [item("b1", { labels: momo })]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [
        {
          photoId: "p1",
          assetId: "b1",
          itemId: "i3",
          itemName: "Momo",
          variantId: null,
          variantName: null,
          state: "better_photo_requested",
          isPrimary: false,
          reason: "Brighter",
        },
      ],
    })
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        {await StaffPage()}
      </AddProvider>
    )
    const row = screen.getByRole("article", { name: "Momo" })
    expect(row.textContent).not.toContain("New photo sent")
    expect(
      within(row).getByRole("button", { name: "Take a new photo" })
    ).toBeTruthy()
  })
  it("says a retake was sent, and drops the request once the retake is accepted", async () => {
    const labelled = (itemId: string, name: string, variant?: string) => ({
      ...LABELLED,
      items: [
        {
          itemId,
          variantId: variant ? `v-${variant}` : null,
          name,
          variantName: variant ?? null,
          sectionName: "Starters",
          labelledAs: null,
          state: "current" as const,
        },
      ],
    })
    const later = "2026-11-07T09:00:00.000Z"
    const request = (
      photoId: string,
      assetId: string,
      itemId: string,
      itemName: string,
      variant: string | null
    ) => ({
      photoId,
      assetId,
      itemId,
      itemName,
      variantId: variant ? `v-${variant}` : null,
      variantName: variant,
      state: "better_photo_requested" as const,
      isPrimary: false,
      reason: "Brighter",
    })
    // n1: a newer Momo (Veg) retake on the newest page, no decision yet.
    // n2: a newer Chicken curry retake, accepted.
    // n3: a newer Momo (Chicken): another variant, so not a retake of Veg.
    library.items = [
      item("n1", { createdAt: later, labels: labelled("i3", "Momo", "Veg") }),
      item("n3", {
        createdAt: later,
        labels: labelled("i3", "Momo", "Chicken"),
      }),
    ]
    library.byId = [
      item("b1", { labels: labelled("i3", "Momo", "Veg") }),
      item("b2", { labels: labelled("i2", "Chicken curry") }),
      item("n2", {
        createdAt: later,
        labels: labelled("i2", "Chicken curry"),
      }),
      item("b4", { labels: labelled("i4", "Soup") }),
    ]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [
        request("p1", "b1", "i3", "Momo", "Veg"),
        request("p2", "b2", "i2", "Chicken curry", null),
        {
          ...request("p3", "n2", "i2", "Chicken curry", null),
          state: "accepted" as const,
          reason: null,
        },
        request("p4", "b4", "i4", "Soup", null),
      ],
    })
    const openAdd = vi.fn()
    render(<AddProvider value={{ openAdd }}>{await StaffPage()}</AddProvider>)

    const list = screen.getByRole("list", {
      name: "Photos with a better photo requested",
    })
    expect(
      within(list)
        .getAllByRole("article")
        .map((a) => a.querySelector("h3")?.textContent)
    ).toEqual(["Momo (Veg)", "Soup"])
    // Only Soup still needs a photo.
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Better photo requested/,
    })
    expect(within(heading).getByText("1")).toBeTruthy()

    const momo = within(list).getByRole("article", { name: "Momo (Veg)" })
    expect(momo.textContent).toContain(
      "New photo sent · waiting for manager review"
    )
    expect(
      within(momo).queryByRole("button", { name: "Take a new photo" })
    ).toBeNull()
    expect(
      within(momo).queryByRole("button", { name: "Choose from photos" })
    ).toBeNull()
    const again = within(momo).getByRole("button", { name: "Take another" })
    expect(again.className).toContain("min-h-13")
    fireEvent.click(again)
    expect(openAdd).toHaveBeenLastCalledWith({
      source: "camera",
      imagesOnly: true,
      preset: {
        itemId: "i3",
        variantId: "v-Veg",
        itemName: "Momo",
        variantName: "Veg",
      },
    })

    const soup = within(list).getByRole("article", { name: "Soup" })
    expect(soup.textContent).not.toContain("New photo sent")
    expect(
      within(soup).getByRole("button", { name: "Take a new photo" })
    ).toBeTruthy()
  })
  it("offers no retake for a request whose dish is off the current menu, and leaves it out of the count (B9)", async () => {
    library.items = []
    library.byId = [
      item("b1", { labels: LABELLED }),
      item("b2", { labels: LABELLED }),
    ]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [
        {
          photoId: "p1",
          assetId: "b1",
          itemId: "i1",
          itemName: "Soup",
          variantId: null,
          variantName: null,
          state: "better_photo_requested",
          isPrimary: false,
          reason: "Brighter",
          canRetake: true,
        },
        {
          photoId: "p2",
          assetId: "b2",
          itemId: "i2",
          itemName: "Old special",
          variantId: null,
          variantName: null,
          state: "better_photo_requested",
          isPrimary: false,
          reason: "Closer",
          canRetake: false,
        },
      ],
    })
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        {await StaffPage()}
      </AddProvider>
    )
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Better photo requested/,
    })
    expect(within(heading).getByText("1")).toBeTruthy()
    const gone = screen.getByRole("article", { name: "Old special" })
    expect(gone.textContent).toContain(
      "This dish isn't on your venue's menu now, so a new photo can't be sent for it."
    )
    expect(within(gone).queryByRole("button")).toBeNull()
    const soup = screen.getByRole("article", { name: "Soup" })
    expect(
      within(soup).getByRole("button", { name: "Take a new photo" })
    ).toBeTruthy()
  })
  it("offers no camera on a better-photo request while uploads are paused", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd }}>
        <StaffPortfolio
          profile={{
            displayName: "Anil Thapa",
            jobTitle: null,
            venueName: null,
            avatarUrl: null,
          }}
          uploadBlocked="Uploads are paused until you have a venue."
          initialPage={{ items: [], nextCursor: null }}
          menuPhotos={[
            {
              photoId: "p2",
              assetId: "b1",
              itemId: "i2",
              itemName: "Chicken curry",
              variantId: null,
              variantName: null,
              state: "better_photo_requested",
              isPrimary: false,
              reason: "Too dark",
            },
          ]}
          menuPhotoItems={[item("b1", { labels: LABELLED })]}
        />
      </AddProvider>
    )
    const row = screen.getByRole("article", { name: "Chicken curry" })
    expect(within(row).queryByRole("button")).toBeNull()
    expect(
      screen.getByText("Uploads are paused until you have a venue.")
    ).toBeTruthy()
  })

  it("lists a better-photo request only once its photo is ready", () => {
    const state = {
      photoId: "p1",
      assetId: "a1",
      itemId: "i1",
      itemName: "Soup",
      variantId: null,
      variantName: null,
      state: "better_photo_requested" as const,
      isPrimary: false,
      reason: "Brighter",
    }
    expect(
      betterPhotoRequests(
        [state, { ...state, photoId: "p0", state: "accepted" as const }],
        [item("a1", { labels: LABELLED })]
      ).map((r) => [r.key, r.dish, r.reason])
    ).toEqual([["p1", "Soup", "Brighter"]])
    expect(
      betterPhotoRequests([state], [item("a1", { uploadState: "processing" })])
    ).toEqual([])
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

describe("Me: saving the profile", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const values = { displayName: "Anil Thapa", avatarFile: null }
  const html = (status: number) =>
    new Response("<html><body>Error</body></html>", {
      status,
      headers: { "content-type": "text/html" },
    })

  it("says what an HTML error page means, not a connection problem", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)

    fetch.mockResolvedValueOnce(html(413))
    expect(await saveProfile(values)).toEqual({
      ok: false,
      error: PROFILE_SAVE_COPY.tooLarge,
      fieldErrors: { avatar: PROFILE_SAVE_COPY.tooLarge },
    })
    expect(PROFILE_SAVE_COPY.tooLarge).toBe(
      "This photo is too large. Profile photos can be up to 4.0 MB."
    )

    fetch.mockResolvedValueOnce(html(504))
    expect(await saveProfile(values)).toEqual({
      ok: false,
      error: "Saving took too long, so it may not have finished. Try again.",
    })

    fetch.mockResolvedValueOnce(html(401))
    expect(await saveProfile(values)).toEqual({
      ok: false,
      error: "Sign in again, then try again.",
    })

    fetch.mockResolvedValueOnce(html(500))
    expect(await saveProfile(values)).toEqual({
      ok: false,
      error: "Your changes could not be saved. Try again.",
    })

    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    expect(await saveProfile(values)).toEqual({
      ok: false,
      error: "Could not save. Check your connection.",
    })
  })

  it("passes on the route's own JSON answer", async () => {
    const answer = {
      ok: false,
      error: "Enter a display name.",
      fieldErrors: { displayName: "Enter a display name." },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(answer, { status: 400 }))
    )
    expect(await saveProfile(values)).toEqual(answer)
  })

  it("confirms a saved profile on Me until Edit profile opens again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true }))
    )
    library.items = []
    render(
      await StaffPage({ searchParams: Promise.resolve({ edit: "profile" }) })
    )
    expect(screen.queryByText("Profile saved.")).toBeNull()
    const dialog = screen.getByRole("dialog", { name: "Edit profile" })
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save changes" })
      )
    })
    expect(screen.queryByRole("dialog", { name: "Edit profile" })).toBeNull()
    expect(
      screen.getByText("Profile saved.").closest("[role=status]")
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
    expect(screen.queryByText("Profile saved.")).toBeNull()
  })
})
