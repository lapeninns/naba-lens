// @vitest-environment jsdom
// S2-STAFF screens: the place filters, the slot page with Report a change,
// My uploads, Help and account, the notices inbox and the first sign-in
// notice (spec §3.2, §6 S3, S4, S5, §17).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AlbumPlaceScreen } from "@/components/nabalens/album/album-place"
import { AlbumSlotScreen } from "@/components/nabalens/album/slot-screen"
import { ContributionNoticeCard } from "@/components/nabalens/me/contribution-notice"
import { MeAccount } from "@/components/nabalens/me/me-account"
import {
  MyUploads,
  type MyUploadsActions,
} from "@/components/nabalens/me/my-uploads"
import { NoticesInbox } from "@/components/nabalens/me/notices-inbox"
import {
  AddProvider,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { buildAlbum, findSlot, type AlbumInput } from "@/lib/album/model"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import type { MyUpload } from "@/lib/staff/my-uploads"

const refresh = vi.fn()
const rows = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="my-upload-row"]')
  )
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/staff",
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const BAR = "00000000-0000-4000-8000-00000000b001"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const D1 = "00000000-0000-4000-8000-0000000d0001"
const D2 = "00000000-0000-4000-8000-0000000d0002"
const V = "00000000-0000-4000-8000-0000000000f1"
const A = "00000000-0000-4000-8000-0000000000a1"
const B = "00000000-0000-4000-8000-0000000000b2"

const dish = (itemId: string, name: string, extra = {}) => ({
  itemId,
  name,
  sectionId: DRINKS,
  sectionName: "Drinks",
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
  coverageCategory: "drinks" as const,
  ...extra,
})

const input: AlbumInput = {
  places: [{ subjectId: BAR, label: "The bar" }],
  placements: [{ source: "menu_section", key: "drinks", subjectId: BAR }],
  sections: [{ sectionId: DRINKS, slug: "drinks" }],
  dishes: [
    dish(D1, "Guinness", { coverage: "missing" }),
    dish(D2, "Aperol", {
      coverage: "covered",
      thumbnailUrl: "/thumb.jpg",
      pendingCount: 2,
    }),
  ],
  amenities: [],
  areas: [
    {
      subjectId: BAR,
      label: "The bar",
      state: "needed",
      coverage: "missing",
      coverageCategory: "spaces",
    },
  ],
  myRetakeItemIds: new Set(),
  briefs: {
    sections: new Map([["drinks", "The full glass, on the bar"]]),
    items: new Map(),
    amenities: new Map(),
  },
}

function withAdd(ui: React.ReactNode, open = vi.fn()) {
  return render(
    <AddProvider value={{ openAdd: (o?: OpenAddOptions) => open(o) }}>
      {ui}
    </AddProvider>
  )
}

describe("Album place filters (spec §6 S3)", () => {
  const album = buildAlbum(input)
  const bar = album.places[0]!

  it("draws the state and category pills as links, the chosen one current", () => {
    withAdd(
      <AlbumPlaceScreen
        venueName="The Bell"
        place={bar}
        canAdd
        filter={{ show: "needed", category: null }}
      />
    )
    const show = screen.getByRole("group", { name: "Show" })
    const needed = within(show).getByRole("link", { name: "Needed" })
    expect(needed.getAttribute("aria-current")).toBe("true")
    expect(
      within(show)
        .getByRole("link", { name: "In the album" })
        .getAttribute("href")
    ).toBe(`/staff/album/${BAR}?show=in-album`)
    const cats = screen.getByRole("group", { name: "Category" })
    expect(
      within(cats)
        .getAllByRole("link")
        .map((l) => l.textContent)
    ).toEqual(["Everything", "Drinks", "Spaces"])
    // Needed shows the empty slots only; Aperol (in the album) is filtered.
    expect(screen.queryByRole("link", { name: /Aperol/ })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Guinness: needed" })
    ).toBeTruthy()
  })

  it("shows the waiting count under a tile and links a filled tile to its page", () => {
    withAdd(<AlbumPlaceScreen venueName="The Bell" place={bar} canAdd />)
    const tile = screen.getByRole("link", { name: "Aperol: in the album" })
    expect(tile.getAttribute("href")).toBe(`/staff/album/slot/dish/${D2}`)
    expect(screen.getByText("2 waiting")).toBeTruthy()
  })

  it("says so when nothing matches", () => {
    withAdd(
      <AlbumPlaceScreen
        venueName="The Bell"
        place={bar}
        canAdd
        filter={{ show: "waiting", category: null }}
      />
    )
    expect(screen.getByRole("status").textContent).toMatch(/No slots here/)
  })

  it("reports a change on a chosen slot of the place", async () => {
    const user = userEvent.setup()
    const send = vi.fn(async () => ({ ok: true as const, created: true }))
    withAdd(
      <AlbumPlaceScreen
        venueName="The Bell"
        place={bar}
        canAdd
        sendReport={send}
      />
    )
    await user.click(screen.getByRole("button", { name: "Report a change" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Send to your manager" })
    )
    expect(within(dialog).getByRole("alert").textContent).toBe("Choose a slot")
    expect(send).not.toHaveBeenCalled()
  })
})

describe("Slot page (spec §6 S3; AC17)", () => {
  const album = buildAlbum(input)

  it("shows the photo in the album, brief, waiting count and the retake reason", () => {
    const { slot, place } = findSlot(album, `dish:${D2}`)!
    withAdd(
      <AlbumSlotScreen
        venueName="The Bell"
        placeLabel={place.label}
        placeHref={`/staff/album/${BAR}`}
        slot={slot}
        retake={{ reason: "Too dark, use the bar lights" }}
        ownPhotos={[
          {
            assetId: A,
            outcome: "retake_requested",
            uploadedAt: "2026-11-12T10:00:00Z",
          },
        ]}
        canAdd
        blocked={null}
        sendReport={vi.fn()}
      />
    )
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Aperol")
    expect(screen.getByText("The full glass, on the bar")).toBeTruthy()
    expect(screen.getByText(/2 photos are waiting/)).toBeTruthy()
    expect(screen.getByText("Too dark, use the bar lights")).toBeTruthy()
    expect(screen.getByText("The photo in the album")).toBeTruthy()
    expect(screen.getByText("Retake")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add more photos" })).toBeTruthy()
  })

  it("adds a photo to this slot from the gallery", async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const { slot, place } = findSlot(album, `dish:${D1}`)!
    withAdd(
      <AlbumSlotScreen
        venueName="The Bell"
        placeLabel={place.label}
        placeHref="/x"
        slot={slot}
        retake={null}
        ownPhotos={[]}
        canAdd
        blocked={null}
        sendReport={vi.fn()}
      />,
      open
    )
    await user.click(
      screen.getByRole("button", { name: "Add photos for this slot" })
    )
    expect(open).toHaveBeenCalledWith({
      slot: { kind: "dish", itemId: D1, name: "Guinness" },
    })
  })

  it("sends a report with the chosen reason and says nothing changes yet (AC26)", async () => {
    const user = userEvent.setup()
    const send = vi.fn(async () => ({ ok: true as const, created: true }))
    const { slot, place } = findSlot(album, `dish:${D1}`)!
    withAdd(
      <AlbumSlotScreen
        venueName="The Bell"
        placeLabel={place.label}
        placeHref="/x"
        slot={slot}
        retake={null}
        ownPhotos={[]}
        canAdd
        blocked={null}
        sendReport={send}
      />
    )
    await user.click(screen.getByRole("button", { name: "Report a change" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("radio", { name: "Something else" })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Send to your manager" })
    )
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "Say what has changed."
    )
    await user.type(within(dialog).getByRole("textbox"), "Now a pint glass")
    await user.click(
      within(dialog).getByRole("button", { name: "Send to your manager" })
    )
    expect(send).toHaveBeenCalledWith({
      kind: "dish",
      subjectId: D1,
      reason: "other",
      note: "Now a pint glass",
    })
    expect((await screen.findByRole("status")).textContent).toMatch(
      /Nothing changes until they check it/
    )
  })
})

// ---- My uploads (spec §6 S4) ------------------------------------------------

function upload(over: Partial<MyUpload> = {}): MyUpload {
  return {
    assetId: A,
    venueId: V,
    venueName: "The Bell",
    mediaType: "image",
    uploadState: "ready",
    uploadedAt: "2026-11-12T10:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    duplicate: false,
    labelRevision: 2,
    sharedKinds: [],
    slots: [
      {
        kind: "dish",
        slotId: D1,
        name: "Guinness",
        outcome: "awaiting_review",
        reason: null,
        decidedAt: null,
        replacesAssetId: null,
        retakeAnswered: false,
      },
    ],
    labelHelp: false,
    removalRequested: false,
    removalRequestId: null,
    ...over,
  }
}

function actions(over: Partial<MyUploadsActions> = {}): MyUploadsActions {
  return {
    loadMore: vi.fn(),
    withdraw: vi.fn(async () => ({ ok: true as const })),
    changeSlot: vi.fn(async () => ({ ok: true as const })),
    loadBoard: vi.fn(async () => ({
      ok: true as const,
      board: { slots: [], amenities: [] },
    })),
    requestRemoval: vi.fn(async () => ({ ok: true as const })),
    report: vi.fn(async () => ({ ok: true as const, created: true })),
    ...over,
  }
}

describe("My uploads (spec §6 S4)", () => {
  const items = [
    upload({ assetId: A }),
    upload({
      assetId: B,
      venueId: "00000000-0000-4000-8000-0000000000f2",
      venueName: "The Crown",
      capturedAt: "2026-11-10T19:00:00Z",
      slots: [
        {
          kind: "area",
          slotId: BAR,
          name: "The bar",
          outcome: "retake_requested",
          reason: "Too dark",
          decidedAt: null,
          replacesAssetId: null,
          retakeAnswered: false,
        },
      ],
    }),
    upload({
      assetId: "00000000-0000-4000-8000-0000000000c3",
      slots: [
        {
          kind: "dish",
          slotId: D2,
          name: "Aperol",
          outcome: "public",
          reason: null,
          decidedAt: "2026-11-13T10:00:00Z",
          replacesAssetId: null,
          retakeAnswered: false,
        },
      ],
    }),
  ]

  it("opens the picker for an unmatched photo and shows its dates as read-only", () => {
    render(
      <MyUploads
        initial={{
          items: [upload({ slots: [], capturedAt: "2026-11-10T19:00:00Z" })],
          next: null,
        }}
        currentVenueId={V}
        layout="detail"
        actions={actions()}
      />
    )
    expect(
      screen.getByRole("link", { name: "Label photo" }).getAttribute("href")
    ).toBe(`/staff/album/match-later?photo=${A}`)
    expect(screen.getByText(/taken 10 Nov/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Fix date taken" })).toBeNull()
  })

  it("opens on Needs attention with the counts, the reason and the venue", () => {
    render(
      <MyUploads
        initial={{ items, next: null }}
        currentVenueId={V}
        actions={actions()}
      />
    )
    const pills = screen.getByRole("group", { name: "Show" })
    expect(
      within(pills)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Needs attention 1", "Sending 0", "Waiting 1", "Reviewed 1"])
    expect(
      within(pills)
        .getByRole("button", { name: /Needs attention/ })
        .getAttribute("aria-pressed")
    ).toBe("true")
    const [row] = rows() as [HTMLElement]
    expect(row.textContent).toContain("Too dark")
    expect(row.textContent).toContain("Sent to The Crown")
    expect(row.textContent).toContain("taken 10 Nov")
    expect(
      within(row).getByRole("link", { name: "Retake" }).getAttribute("href")
    ).toBe(`/staff/album/slot/area/${BAR}`)
  })

  it("offers Change slot and Withdraw while waiting, and withdraws on confirm", async () => {
    const user = userEvent.setup()
    const a = actions()
    render(
      <MyUploads
        initial={{ items, next: null }}
        currentVenueId={V}
        actions={a}
      />
    )
    await user.click(screen.getByRole("button", { name: /^Waiting/ }))
    const [row] = rows() as [HTMLElement]
    expect(
      within(row).getByRole("button", { name: "Change slot" })
    ).toBeTruthy()
    expect(
      within(row).queryByRole("button", { name: "Ask for a correction" })
    ).toBeNull()
    await user.click(within(row).getByRole("button", { name: "Withdraw" }))
    const confirm = await screen.findByRole("alertdialog")
    await user.click(within(confirm).getByRole("button", { name: "Withdraw" }))
    expect(a.withdraw).toHaveBeenCalledWith(A)
    expect(await screen.findByText("Withdrawn.")).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("offers a correction and removal once checked, with the words staff see", async () => {
    const user = userEvent.setup()
    const a = actions()
    render(
      <MyUploads
        initial={{ items, next: null }}
        currentVenueId={V}
        actions={a}
      />
    )
    await user.click(screen.getByRole("button", { name: /^Reviewed/ }))
    const [row] = rows() as [HTMLElement]
    expect(row.textContent).toContain("In the album")
    expect(within(row).queryByRole("button", { name: "Withdraw" })).toBeNull()
    await user.click(
      within(row).getByRole("button", { name: "Ask for a correction" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("radio", {
        name: "It's matched to the wrong slot",
      })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Send to your manager" })
    )
    expect(a.report).toHaveBeenCalledWith({
      kind: "photo",
      subjectId: "00000000-0000-4000-8000-0000000000c3",
      reason: "wrong_label",
      note: "",
    })
    expect(await screen.findByText(/Ask for a correction: sent/)).toBeTruthy()
  })

  it("says when nothing was sent, and when the read failed", () => {
    const { unmount } = render(
      <MyUploads
        initial={{ items: [], next: null }}
        currentVenueId={V}
        actions={actions()}
      />
    )
    expect(screen.getByText(/Nothing sent yet/)).toBeTruthy()
    unmount()
    render(<MyUploads initial={null} currentVenueId={V} actions={actions()} />)
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't be loaded/)
  })
})

describe("My uploads repairs (S3-R4)", () => {
  it("re-signs a broken thumbnail once, then says it could not load (F7)", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MyUploads
        initial={{ items: [upload({ assetId: A })], next: null }}
        currentVenueId={V}
        actions={actions()}
      />
    )
    const img = () => container.querySelector("img")
    expect(img()?.getAttribute("src")).toBe(`/api/media/${A}/thumb`)
    fireEvent.error(img()!)
    // One fresh, re-signed attempt.
    expect(img()?.getAttribute("src")).toBe(`/api/media/${A}/thumb?r=1`)
    expect(screen.queryByText("1 preview could not load.")).toBeNull()
    fireEvent.error(img()!)
    // Broken: the plain icon and the gallery's words, with Try again.
    expect(img()).toBeNull()
    expect(screen.getByText("1 preview could not load.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(img()?.getAttribute("src")).toBe(`/api/media/${A}/thumb?r=2`)
    expect(screen.queryByText("1 preview could not load.")).toBeNull()
  })

  it("says an I'm not sure photo is with the manager, not under Match later (E4)", () => {
    render(
      <MyUploads
        initial={{
          items: [
            upload({ assetId: A, slots: [], labelHelp: true }),
            upload({ assetId: B, slots: [] }),
          ],
          next: null,
        }}
        currentVenueId={V}
        actions={actions()}
      />
    )
    expect(
      screen
        .getByRole("button", { name: /Needs attention/ })
        .getAttribute("aria-pressed")
    ).toBe("true")
    const [unsure, later] = rows() as [HTMLElement, HTMLElement]
    expect(unsure.textContent).toContain(
      "With your manager, who will choose its slot."
    )
    expect(unsure.textContent).not.toContain("Match later")
    expect(
      within(unsure).queryByRole("link", { name: "Label photo" })
    ).toBeNull()
    expect(
      within(later).getByRole("link", { name: "Label photo" })
    ).toBeTruthy()
  })

  it("offers Change slot only at the photo's venue, with a hint elsewhere (V13)", () => {
    render(
      <MyUploads
        initial={{
          items: [
            upload({
              assetId: A,
              venueId: "00000000-0000-4000-8000-0000000000f2",
              venueName: "The Crown",
            }),
          ],
          next: null,
        }}
        currentVenueId={V}
        actions={actions()}
      />
    )
    const [row] = rows() as [HTMLElement]
    expect(
      within(row).queryByRole("button", { name: "Change slot" })
    ).toBeNull()
    expect(row.textContent).toContain(
      "To change its slot, switch to The Crown first."
    )
    expect(within(row).getByRole("button", { name: "Withdraw" })).toBeTruthy()
  })

  it("draws outcome words from the chip, not a copy (V25)", () => {
    render(
      <MyUploads
        initial={{
          items: [
            upload({
              assetId: A,
              slots: [
                {
                  kind: "dish",
                  slotId: D1,
                  name: "Guinness",
                  outcome: "label_corrected",
                  reason: null,
                  decidedAt: "2026-11-13T10:00:00Z",
                  replacesAssetId: null,
                  retakeAnswered: false,
                },
              ],
            }),
          ],
          next: null,
        }}
        currentVenueId={V}
        actions={actions()}
      />
    )
    const [row] = rows() as [HTMLElement]
    expect(row.textContent).toContain(CHIP_STATES.outcome_label_corrected.word)
    expect(
      within(row).getByRole("button", { name: "Ask to remove" })
    ).toBeTruthy()
  })
})

describe("Help and account (spec §6 S5)", () => {
  it("lists venues with roles, the managers, notices and help", () => {
    render(
      <MeAccount
        venues={[
          { venueId: V, venueName: "The Bell", role: "staff", isActive: true },
          {
            venueId: "00000000-0000-4000-8000-0000000000f2",
            venueName: "The Crown",
            role: "manager",
            isActive: false,
          },
        ]}
        switchVenue={vi.fn()}
        managers={[
          {
            id: A,
            displayName: "Sam Lee",
            jobTitle: "General manager",
            isYou: false,
          },
        ]}
        unread={3}
        helpHref="/staff/tasks/guide#cant-add"
      />
    )
    expect(screen.getByText("Working at The Bell · Staff")).toBeTruthy()
    expect(screen.getByText("The Crown · Manager")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Change venue" })).toBeTruthy()
    expect(screen.getByText("Sam Lee")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: /Notices/ }).getAttribute("href")
    ).toBe("/staff/notifications")
    expect(screen.getByText("3")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: /If you can't add photos/ })
        .getAttribute("href")
    ).toBe("/staff/tasks/guide#cant-add")
  })

  it("says when there is no manager, and when they couldn't be read", () => {
    const { rerender } = render(
      <MeAccount
        venues={[]}
        switchVenue={vi.fn()}
        managers={[]}
        unread={0}
        helpHref="/x"
      />
    )
    expect(screen.getByText(/no manager listed/)).toBeTruthy()
    rerender(
      <MeAccount
        venues={null}
        switchVenue={vi.fn()}
        managers={null}
        unread={null}
        helpHref="/x"
      />
    )
    expect(screen.getByText(/couldn't be loaded/)).toBeTruthy()
  })
})

describe("Notices inbox (spec §17; FA-10)", () => {
  it("lists notices with where they lead and marks them all read", async () => {
    const user = userEvent.setup()
    const markRead = vi.fn(async () => ({ ok: true as const, changed: 1 }))
    render(
      <NoticesInbox
        initial={{
          items: [
            {
              id: 7,
              kind: "retake_requested",
              subjectType: "menu_item",
              subjectId: D1,
              venueId: V,
              venueName: "The Bell",
              payload: {
                source: "menu_photo",
                itemId: D1,
                itemName: "Guinness",
                reason: "Blurred",
              },
              createdAt: "2026-11-18T10:00:00Z",
              state: "unread",
            },
          ],
          unread: 1,
          nextBefore: null,
        }}
        preferences={{
          retakes: true,
          assignments: true,
          uploadProblems: false,
          digests: false,
          quietStart: null,
          quietEnd: null,
          organisationQuietStart: "21:00",
          organisationQuietEnd: "08:00",
          timezone: "Europe/London",
        }}
        actions={{
          loadMore: vi.fn(),
          markRead,
          savePreferences: vi.fn(),
        }}
      />
    )
    const link = screen.getByRole("link", { name: /Retake: Guinness/ })
    expect(link.getAttribute("href")).toBe(`/staff/album/slot/dish/${D1}`)
    expect(link.textContent).toContain("Blurred")
    expect(link.textContent).toContain("New")
    await user.click(screen.getByRole("button", { name: "Mark all as read" }))
    expect(markRead).toHaveBeenCalledWith(null)
    expect(await screen.findByText("All marked as read.")).toBeTruthy()
    expect(
      screen.getByRole("checkbox", { name: "Photos that didn't send" })
    ).toBeTruthy()
  })
})

describe("First sign-in notice (spec §3.2)", () => {
  it("says where the person works and records I understand", async () => {
    const user = userEvent.setup()
    const acknowledge = vi.fn(async () => ({ ok: true }))
    render(
      <ContributionNoticeCard
        venueName="The Bell"
        roleLabel="Staff"
        acknowledged={false}
        acknowledge={acknowledge}
      />
    )
    expect(screen.getByText("You work at The Bell as staff.")).toBeTruthy()
    expect(screen.getByText("How your photos are used")).toBeTruthy()
    // A tick box, not a button (screens-2 handoff, decision 10).
    expect(screen.queryByRole("button", { name: "I understand" })).toBeNull()
    await user.click(screen.getByRole("checkbox", { name: "I understand" }))
    expect(acknowledge).toHaveBeenCalled()
    expect(await screen.findByText("You have read this.")).toBeTruthy()
    expect(
      screen
        .getByRole("checkbox", { name: "I understand" })
        .getAttribute("aria-checked")
    ).toBe("true")
  })
})
