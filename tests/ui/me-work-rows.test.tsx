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
// Me with the Album badge (the retakes Album shows), tested in staff-shell-status.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/app/_media/actions", () => ({
  deleteMedia: vi.fn(),
  readDeleteEvidence: vi.fn(async () => ({ status: "missing" })),
}))
vi.mock("@/app/staff/actions", () => ({ loadMyMedia: vi.fn() }))
const gallery = vi.hoisted(() => ({
  signals: [] as number[],
  impact: undefined as ((item: MediaItem) => unknown) | undefined,
  readEvidence: undefined as unknown,
}))
vi.mock("@/app/_media/media-gallery", () => ({
  MediaGallery: ({
    label,
    refreshSignal,
    getDeleteImpact,
    readDeleteEvidence,
  }: {
    label: string
    refreshSignal?: number
    getDeleteImpact?: (item: MediaItem) => unknown
    readDeleteEvidence?: unknown
  }) => {
    gallery.signals.push(refreshSignal ?? 0)
    gallery.impact = getDeleteImpact
    gallery.readEvidence = readDeleteEvidence
    return <section aria-label={label} />
  },
}))
type HostProps = {
  assetIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (results: { ok: boolean; assetId: string }[]) => void
  onAreaSaved?: (assetIds: string[], subjectId: string | null) => void
}
const areas = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock("@/lib/server/area-photos", () => ({
  getMyAreaLabels: async (_actor: unknown, ids: string[]) => ({
    ok: true,
    labels: ids
      .filter((id) => areas.ids.includes(id))
      .map((assetId) => ({ assetId })),
  }),
}))
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

const NOW = "2026-11-07T09:00:00.000Z"
const DISH = {
  itemId: "i2",
  variantId: null,
  itemName: "Chicken curry",
  variantName: null,
}
/** A retake note as my_retake_notes returns it (G-3). */
function note(overrides: Partial<RetakeNote> = {}): RetakeNote {
  return {
    kind: "menu",
    noteId: "p2",
    revision: 1,
    assetId: "b1",
    thumbnailUrl: "https://storage.test/b1.webp",
    status: "open",
    canRetake: true,
    reason: "Too dark",
    askedBy: "TEST Chef",
    askedAt: "2026-11-06T12:00:00.000Z",
    setAsideAt: null,
    dish: DISH,
    requirement: null,
    ...overrides,
  }
}

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
  listMyRetakeNotes: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
// No working list at this venue: the legacy screens, counts and badge.
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: {
    getWorkingList: async () => ({ ok: true, view: null }),
  },
}))
vi.mock("@/lib/server/amenities", () => ({
  getMyAmenityTasks: vi.fn(async () => ({ ok: true, tasks: [] })),
}))

import type { RetakeNote } from "@/lib/server/coverage/types"
import {
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
  // Me and the shell's Album badge both read the notes: keep each test's own.
  coverage.listMyRetakeNotes.mockReset()
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

  it("passes the avatar and the Album badge to the shell", async () => {
    library.items = []
    const { tasksView } = await import("./tasks-fixtures")
    coverage.getMyTasks.mockResolvedValueOnce({ ok: true, tasks: tasksView() })
    coverage.listMyRetakeNotes.mockResolvedValue({ ok: true, notes: [] })
    const { container } = render(await StaffPage())
    const shell = container.firstElementChild as HTMLElement
    expect(shell.dataset.avatar).toBe("/api/avatars/me")
    expect(shell.dataset.todo).not.toBe("")
  })

  it("still renders when the task and menu reads fail", async () => {
    library.items = [item("a1")]
    coverage.getMyTasks.mockRejectedValueOnce(new Error("down"))
    coverage.listMyMenuPhotoDecisions.mockRejectedValueOnce(new Error("down"))
    coverage.listMyRetakeNotes.mockRejectedValue(new Error("down"))
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

  it("leaves photos with a venue area out, and follows area saves (S-1, note 7)", async () => {
    library.items = [item("a1"), item("a2"), item("a3")]
    areas.ids = ["a3"]
    coverage.listMyMenuPhotoDecisions.mockResolvedValueOnce({
      ok: true,
      states: [],
    })
    try {
      render(await StaffPage())
      const section = screen.getByRole("region", { name: /Needs labels/ })
      // a3 has the uploader's area: labelled.
      fireEvent.click(
        within(section).getByRole("button", { name: "Label these 2 photos" })
      )
      expect(screen.getByRole("dialog", { name: "Labels" }).textContent).toBe(
        "a1,a2"
      )
      // An area-only save takes a1 out at once; clearing a3's brings it back.
      act(() => host.last?.onAreaSaved?.(["a1"], "place-bar"))
      expect(
        within(section).getByRole("button", { name: "Label this photo" })
      ).toBeTruthy()
      act(() => host.last?.onAreaSaved?.(["a3"], null))
      expect(
        within(section).getByRole("button", { name: "Label these 2 photos" })
      ).toBeTruthy()
    } finally {
      areas.ids = []
    }
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
    // It also reads what deleting does to venue answers (HM-04).
    expect(gallery.readEvidence).toBeTypeOf("function")
  })

  it("shows a retake note with the reviewer's reason, read on the server", async () => {
    library.items = []
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: true,
      notes: [note({ reason: "Too dark, shoot near the pass" })],
    })
    render(await StaffPage())
    const rows = within(
      screen.getByRole("list", { name: "Photos that need another photo" })
    ).getAllByRole("listitem")
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain("Needs another photo")
    const row = screen.getByRole("article", { name: "Chicken curry" })
    expect(row.textContent).toContain("Too dark, shoot near the pass")
    expect(row.textContent).toContain("TEST Chef")
    expect(row.textContent).not.toMatch(/better photo|task|due|overdue/i)
    // The old browser-side rule read the decisions list; no longer.
    expect(
      screen.queryByRole("list", { name: "Photos accepted for menu use" })
    ).toBeNull()
  })

  it("retakes a menu note in one tap from the phone's photos, labelled with that dish", async () => {
    library.items = []
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: true,
      notes: [
        note(),
        note({
          noteId: "p3",
          assetId: "b2",
          dish: {
            itemId: "i3",
            variantId: "v-veg",
            itemName: "Momo",
            variantName: "Veg",
          },
          reason: "Show all ten",
        }),
      ],
    })
    const openAdd = vi.fn()
    render(<AddProvider value={{ openAdd }}>{await StaffPage()}</AddProvider>)
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Needs another photo/,
    })
    expect(within(heading).getByText("2")).toBeTruthy()

    const momo = screen.getByRole("article", { name: "Momo (Veg)" })
    fireEvent.click(
      within(momo).getByRole("button", { name: "Retake: Momo (Veg)" })
    )
    expect(openAdd).toHaveBeenLastCalledWith({
      source: "library",
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
      within(curry).getByRole("button", {
        name: "Retake: Chicken curry",
      })
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
    // Me has no Later: set-aside notes stay here.
    expect(screen.queryByRole("button", { name: /^Later/ })).toBeNull()
  })

  it("links coverage requests to their send page, for the month and for a job", async () => {
    library.items = []
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: true,
      notes: [
        note({ kind: "coverage", noteId: "c1", dish: null }),
        note({
          kind: "coverage",
          noteId: "c2",
          dish: null,
          requirement: { id: "r1", title: "Bar set-up", kind: "service" },
        }),
      ],
    })
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        {await StaffPage()}
      </AddProvider>
    )
    const month = screen.getByRole("article", { name: "Photo for your month" })
    expect(
      within(month)
        .getByRole("link", { name: "Retake: Photo for your month" })
        .getAttribute("href")
    ).toBe("/staff/tasks/month?replaces=c1")
    const bar = screen.getByRole("article", { name: "Bar set-up" })
    expect(
      within(bar)
        .getByRole("link", { name: "Retake: Bar set-up" })
        .getAttribute("href")
    ).toBe("/staff/tasks/r1?replaces=c2")
  })

  it("keeps set-aside and retaken notes, drops cleared ones, and counts only those still to take", async () => {
    library.items = []
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: true,
      notes: [
        note({ noteId: "p1", status: "set_aside", setAsideAt: NOW }),
        note({
          noteId: "p2",
          status: "retaken",
          dish: { ...DISH, itemId: "i4", itemName: "Soup" },
        }),
        note({
          noteId: "p3",
          status: "cleared",
          canRetake: false,
          dish: { ...DISH, itemId: "i5", itemName: "Dal" },
        }),
      ],
    })
    const openAdd = vi.fn()
    render(<AddProvider value={{ openAdd }}>{await StaffPage()}</AddProvider>)
    const list = screen.getByRole("list", {
      name: "Photos that need another photo",
    })
    expect(
      within(list)
        .getAllByRole("article")
        .map((a) => a.querySelector("h3")?.textContent)
    ).toEqual(["Chicken curry", "Soup"])
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Needs another photo/,
    })
    expect(within(heading).getByText("1")).toBeTruthy()

    const aside = within(list).getByRole("article", { name: "Chicken curry" })
    expect(aside.textContent).toContain("Set aside for later")
    expect(
      within(aside).getByRole("button", { name: "Retake: Chicken curry" })
    ).toBeTruthy()

    const soup = within(list).getByRole("article", { name: "Soup" })
    expect(soup.textContent).toContain("New photo sent · waiting for review")
    expect(within(soup).queryByRole("button", { name: /^Retake/ })).toBeNull()
    fireEvent.click(
      within(soup).getByRole("button", { name: "Add another: Soup" })
    )
    expect(openAdd).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "library" })
    )
  })

  it("offers no retake for a dish off the menu or a job no longer open, and leaves them out of the count", async () => {
    library.items = []
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: true,
      notes: [
        note({ noteId: "p1", canRetake: false }),
        note({
          kind: "coverage",
          noteId: "c1",
          dish: null,
          canRetake: false,
          requirement: { id: "r1", title: "Bar set-up", kind: "service" },
        }),
        note({
          noteId: "p2",
          dish: { ...DISH, itemId: "i4", itemName: "Soup" },
        }),
      ],
    })
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        {await StaffPage()}
      </AddProvider>
    )
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Needs another photo/,
    })
    expect(within(heading).getByText("1")).toBeTruthy()
    const gone = screen.getByRole("article", { name: "Chicken curry" })
    expect(gone.textContent).toContain(
      "This dish isn't on your venue's menu now, so a new photo can't be sent for it."
    )
    expect(within(gone).queryByRole("button")).toBeNull()
    const closed = screen.getByRole("article", { name: "Bar set-up" })
    expect(closed.textContent).toContain("no longer open to you")
    expect(within(closed).queryByRole("link")).toBeNull()
  })

  it("offers no Retake and no send link while uploads are paused", () => {
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
          retakeNotes={[
            note(),
            note({ kind: "coverage", noteId: "c1", dish: null }),
          ]}
        />
      </AddProvider>
    )
    const row = screen.getByRole("article", { name: "Chicken curry" })
    expect(within(row).queryByRole("button")).toBeNull()
    const month = screen.getByRole("article", { name: "Photo for your month" })
    expect(within(month).queryByRole("link")).toBeNull()
    expect(
      screen.getByText("Uploads are paused until you have a venue.")
    ).toBeTruthy()
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
