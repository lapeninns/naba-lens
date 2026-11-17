// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/nabalens"
import {
  ALBUM_ADD_OPTIONS,
  AlbumAddTrigger,
} from "@/components/nabalens/album/album-add-trigger"
import { AlbumHome } from "@/components/nabalens/album/album-home"
import { RememberPlace } from "@/components/nabalens/album/remember-place"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import { buildAlbum, currentPlace, type AlbumInput } from "@/lib/album/model"
import {
  ALBUM_PLACE_COOKIE,
  albumPlaceCookie,
  parseAlbumPlace,
} from "@/lib/album/remembered-place"

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "nl_album_place" && jar.value !== undefined
        ? { name, value: jar.value }
        : undefined,
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/staff/tasks",
}))

const BAR = "00000000-0000-4000-8000-00000000b001"
const PASS = "00000000-0000-4000-8000-00000000b002"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"

const dish = (n: number, sectionId: string, sectionName: string) => ({
  itemId: `00000000-0000-4000-8000-0000000d000${n}`,
  name: `Dish ${n}`,
  sectionId,
  sectionName,
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
})

// The bar has two gaps, the kitchen pass one: the bar is the default place.
const input: AlbumInput = {
  places: [
    { subjectId: BAR, label: "The bar" },
    { subjectId: PASS, label: "Kitchen pass" },
  ],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "menu_section", key: "desserts", subjectId: PASS },
  ],
  sections: [
    { sectionId: DRINKS, slug: "drinks" },
    { sectionId: DESSERTS, slug: "desserts" },
  ],
  dishes: [
    dish(1, DRINKS, "Drinks"),
    dish(2, DRINKS, "Drinks"),
    dish(3, DESSERTS, "Desserts"),
  ],
  amenities: [],
  areas: [],
  myRetakeItemIds: new Set(),
}
const album = buildAlbum(input)

function clearCookie() {
  document.cookie = `${ALBUM_PLACE_COOKIE}=; Path=/staff; Max-Age=0`
  document.cookie = `${ALBUM_PLACE_COOKIE}=; Max-Age=0`
}

beforeEach(() => {
  // jsdom keeps cookies for the page's own path; Album's live under /staff.
  window.history.replaceState(null, "", "/staff/tasks")
  clearCookie()
  jar.value = undefined
})

afterEach(() => {
  cleanup()
  clearCookie()
})

function staffNav(slot: "app-nav" | "tabbar") {
  const found = screen
    .getAllByRole("navigation", { name: "Staff" })
    .find((el) => el.dataset.slot === slot)
  if (!found) throw new Error(`no ${slot}`)
  return found
}

function renderShell(
  openAdd = vi.fn(),
  props: { canManage?: boolean; active?: "tasks" | "portfolio" } = {}
) {
  render(
    <AddProvider value={{ openAdd }}>
      <AppShell
        variant="staff"
        album
        active={props.active ?? "tasks"}
        canManage={props.canManage}
        reviewCount={props.canManage ? 2 : undefined}
        userName="Anil Thapa"
        todoCount={4}
      >
        x
      </AppShell>
    </AddProvider>
  )
  return openAdd
}

describe("Album shell: the tab bar (DESIGN.md §5 Tab bar)", () => {
  it("has three tabs in order: Album, Add photos, Me", () => {
    renderShell()
    const tabs = within(staffNav("tabbar"))
    const items = Array.from(
      staffNav("tabbar").querySelectorAll<HTMLElement>("a, button")
    ).map((el) => [el.tagName, el.textContent, el.getAttribute("href")])
    expect(items).toEqual([
      ["A", "Album", "/staff/tasks"],
      ["BUTTON", "Add photos", null],
      ["A", "Me", "/staff"],
    ])
    expect(tabs.getByRole("link", { name: "Album" })).toBeTruthy()
    expect(tabs.getByRole("button", { name: "Add photos" })).toBeTruthy()
    expect(tabs.getByRole("link", { name: "Me" })).toBeTruthy()
  })

  it("marks the open tab and shows no To do badge on Album", () => {
    renderShell(vi.fn(), { active: "portfolio" })
    const tabs = within(staffNav("tabbar"))
    expect(
      tabs.getByRole("link", { name: "Me" }).getAttribute("aria-current")
    ).toBe("page")
    // todoCount was passed, but slots are never tasks (§7): no badge.
    expect(tabs.getByRole("link", { name: "Album" }).textContent).toBe("Album")
  })

  it("leaves out Photos, People and Our menu, and the header's second Me", () => {
    renderShell()
    for (const name of ["Photos", "People", "Our menu", "Home"]) {
      expect(screen.queryByRole("link", { name })).toBeNull()
    }
    expect(screen.queryByRole("link", { name: "Me: Anil Thapa" })).toBeNull()
  })

  it("keeps the AppBar to Album, Me and a manager's Manage", () => {
    renderShell(vi.fn(), { canManage: true })
    const links = within(staffNav("app-nav"))
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")])
    expect(links).toEqual([
      ["Album", "/staff/tasks"],
      ["Me", "/staff"],
      ["Manage, 2 to review", "/staff/manage"],
    ])
  })

  it("gives every tab the full 68px bar height (48px or more)", () => {
    renderShell()
    for (const el of staffNav("tabbar").querySelectorAll("a, button")) {
      expect(el.className).toContain("min-h-tabbar")
    }
  })

  it("opens the phone's photos straight away from the tab, never the camera", async () => {
    const openAdd = renderShell()
    await userEvent.click(
      within(staffNav("tabbar")).getByRole("button", { name: "Add photos" })
    )
    expect(openAdd).toHaveBeenCalledTimes(1)
    // The gallery for many photos, then Match (AL-1, merged at integration).
    expect(openAdd).toHaveBeenCalledWith({ match: { place: null } })
    expect(ALBUM_ADD_OPTIONS.source).not.toBe("camera")
  })

  it("opens the same picker from the AppBar's Add photos", async () => {
    const openAdd = renderShell()
    const bar = screen
      .getAllByRole("button", { name: "Add photos" })
      .find((el) => !staffNav("tabbar").contains(el))!
    await userEvent.click(bar)
    expect(openAdd).toHaveBeenCalledWith(ALBUM_ADD_OPTIONS)
  })

  it("names the queue on Add photos while files are unfinished", () => {
    render(
      <AddProvider
        value={{ openAdd: vi.fn(), busy: { count: 2, words: "2 sending" } }}
      >
        <AlbumAddTrigger kind="tab" />
      </AddProvider>
    )
    expect(
      screen.getByRole("button", { name: "Add photos, 2 sending" })
    ).toBeTruthy()
  })

  it("links to Me outside the staff layout", () => {
    render(<AlbumAddTrigger kind="tab" />)
    expect(
      screen.getByRole("link", { name: "Add photos" }).getAttribute("href")
    ).toBe("/staff")
  })

  it("keeps today's five tabs on other layouts", () => {
    render(
      <AppShell variant="staff" active="tasks">
        x
      </AppShell>
    )
    const names = Array.from(
      staffNav("tabbar").querySelectorAll("a, button")
    ).map((el) => el.textContent)
    expect(names).toEqual(["Home", "Photos", "Add", "People", "Me"])
  })

  it("ranks nobody: no leaderboard words anywhere in the shell", () => {
    renderShell(vi.fn(), { canManage: true })
    expect(document.body.textContent).not.toMatch(
      /rank|leader|top contributor|most photos/i
    )
  })
})

describe("Album remembers the place last opened (DESIGN.md §5a step 3)", () => {
  it("accepts only a place id in the cookie, nothing else", () => {
    expect(parseAlbumPlace(BAR)).toBe(BAR)
    expect(parseAlbumPlace("unplaced")).toBe("unplaced")
    expect(parseAlbumPlace(undefined)).toBeNull()
    expect(parseAlbumPlace("")).toBeNull()
    expect(parseAlbumPlace("a;b=c")).toBeNull()
    expect(parseAlbumPlace("x".repeat(65))).toBeNull()
  })

  it("writes a /staff cookie with a lifetime and no personal data", () => {
    const cookie = albumPlaceCookie(BAR, true)
    expect(cookie).toMatch(new RegExp(`^nl_album_place=${BAR}; `))
    expect(cookie).toContain("Path=/staff")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain("Secure")
    expect(cookie).toMatch(/Max-Age=\d+/)
    expect(albumPlaceCookie(BAR)).not.toContain("Secure")
  })

  it("remembers a place chosen from Album's chips", async () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <AlbumHome
          venueName="The Bell"
          album={album}
          current={currentPlace(album, null)}
          retakes={[]}
          canAdd
          blocked={null}
        />
      </AddProvider>
    )
    const chip = screen.getByRole("link", { name: /Kitchen pass\s*1 empty/ })
    chip.addEventListener("click", (event) => event.preventDefault())
    await userEvent.click(chip)
    expect(document.cookie).toContain(`${ALBUM_PLACE_COOKIE}=${PASS}`)
  })

  it("remembers a place when All opens it", async () => {
    render(
      <AlbumHome
        venueName="The Bell"
        album={album}
        current={currentPlace(album, PASS)}
        retakes={[]}
        canAdd={false}
        blocked={null}
      />
    )
    const all = screen.getByRole("link", { name: "All 1" })
    expect(all.className).toContain("min-h-12")
    all.addEventListener("click", (event) => event.preventDefault())
    await userEvent.click(all)
    expect(document.cookie).toContain(`${ALBUM_PLACE_COOKIE}=${PASS}`)
  })

  it("remembers the place whose own screen is open", () => {
    render(<RememberPlace placeId="unplaced" />)
    expect(document.cookie).toContain(`${ALBUM_PLACE_COOKIE}=unplaced`)
  })

  it("reads the remembered place on the server, ignoring a bad value", async () => {
    const { rememberedAlbumPlace } = await import("@/lib/server/album-place")
    expect(await rememberedAlbumPlace()).toBeNull()
    jar.value = PASS
    expect(await rememberedAlbumPlace()).toBe(PASS)
    jar.value = "<script>"
    expect(await rememberedAlbumPlace()).toBeNull()
  })

  it("opens on the remembered place, else the one with most empty slots", () => {
    expect(currentPlace(album, PASS)?.label).toBe("Kitchen pass")
    // A place since removed, or another venue's: the most empty place.
    expect(
      currentPlace(album, "00000000-0000-4000-8000-00000000ffff")?.label
    ).toBe("The bar")
    expect(currentPlace(album, null)?.label).toBe("The bar")
  })
})
