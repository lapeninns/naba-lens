// @vitest-environment jsdom
// Amenities in the /manager workspace: the /staff/manage amenity screens for a
// manager account's own venue, inside the workspace shell (no staff shell or
// coverage tabs), with every link under /manager.
import { cleanup, render, screen, within } from "@testing-library/react"
import { cloneElement, isValidElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/manager/amenities",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

const auth = vi.hoisted(() => ({
  requireManagerVenue: vi.fn(),
  getMediaActor: vi.fn(),
}))
vi.mock("@/lib/auth/manager", () => ({
  requireManagerVenue: auth.requireManagerVenue,
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: auth.getMediaActor,
}))

const services = vi.hoisted(() => ({
  getVenueAmenities: vi.fn(),
  listCatalogue: vi.fn(),
  getCheck: vi.fn(),
  listSubmittableAssets: vi.fn(),
}))
vi.mock("@/lib/server/amenities", () => services)

vi.mock("@/app/_amenities/actions", () => ({
  addChecksAction: vi.fn(),
  archiveCheckAction: vi.fn(),
  assignCheckAction: vi.fn(),
  enableAmenitiesAction: vi.fn(),
  reopenCheckAction: vi.fn(),
  restoreCheckAction: vi.fn(),
  setCheckNotesAction: vi.fn(),
}))

const capture = vi.hoisted(() => ({
  CaptureScreen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))
vi.mock("@/app/staff/tasks/amenities/_capture/screen", () => capture)

import ManagerAmenityCheckNotFound from "@/app/manager/amenities/[checkId]/not-found"
import ManagerAmenityCheckPage from "@/app/manager/amenities/[checkId]/page"
import ManagerAmenityCapturePage from "@/app/manager/amenities/[checkId]/capture/page"
import ManagerAmenitiesPage from "@/app/manager/amenities/page"
import { UI_TEXT } from "@/lib/amenities/contract"

import {
  CATALOGUE,
  MANAGER,
  VENUE,
  WIFI_CHECK,
  detail,
  view,
} from "./amenities-manage-fixtures"

/**
 * Renders a Server Component tree in jsdom: async components are awaited
 * (they have no hooks); client components are left for React to render.
 */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const { type } = node
  const props = node.props as Record<string, unknown>
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    return resolve(await (type as (p: unknown) => Promise<ReactNode>)(props))
  }
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (isValidElement(value) || Array.isArray(value))
      next[key] = await resolve(value as ReactNode)
  }
  return Object.keys(next).length ? cloneElement(node, next) : node
}

async function show(page: Promise<ReactNode>) {
  return render(<>{await resolve(await page)}</>)
}

const actor = { profile: { id: MANAGER.id } }
const params = (checkId: string) => Promise.resolve({ checkId })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  auth.requireManagerVenue.mockResolvedValue({
    status: "available",
    profile: { id: MANAGER.id, displayName: MANAGER.displayName },
    venue: VENUE,
    grant: { id: "grant-1", venueId: VENUE.id },
  })
  auth.getMediaActor.mockResolvedValue({ ok: true, actor })
  services.getVenueAmenities.mockResolvedValue({ ok: true, view: view() })
  services.listCatalogue.mockResolvedValue({ ok: true, options: CATALOGUE })
  services.getCheck.mockResolvedValue({ ok: true, detail: detail() })
})

function noStaffLinks() {
  const hrefs = screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "")
  expect(hrefs.filter((h) => h.startsWith("/staff"))).toEqual([])
}

describe("/manager/amenities", () => {
  it("reads the workspace venue as a manager account and lists its checks", async () => {
    await show(ManagerAmenitiesPage())
    expect(auth.getMediaActor).toHaveBeenCalledWith("manager")
    expect(services.getVenueAmenities).toHaveBeenCalledWith(actor, {
      venueId: VENUE.id,
    })
    expect(
      screen.getByRole("heading", { level: 1, name: UI_TEXT.navTab })
    ).toBeTruthy()
    // The workspace layout has its own nav: no coverage tabs or staff shell.
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.queryByRole("main")).toBeNull()
    // Active and Recently completed both list it.
    const links = screen.getAllByRole("link", { name: /Is there guest Wi-Fi/ })
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      links.map(() => `/manager/amenities/${WIFI_CHECK.id}`)
    )
    noStaffLinks()
  })

  it("goes to /manager when the workspace is unavailable", async () => {
    auth.requireManagerVenue.mockRejectedValue(
      new Error("NEXT_REDIRECT /manager")
    )
    await expect(ManagerAmenitiesPage()).rejects.toThrow(
      "NEXT_REDIRECT /manager"
    )
    expect(services.getVenueAmenities).not.toHaveBeenCalled()
  })

  it("goes to /manager when the service refuses the grant mid-session", async () => {
    services.getVenueAmenities.mockResolvedValue({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: "Not allowed.",
    })
    await expect(show(ManagerAmenitiesPage())).rejects.toThrow(
      "NEXT_REDIRECT /manager"
    )
  })

  it("says so on the page when the service is down", async () => {
    services.getVenueAmenities.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "Amenities are unavailable.",
    })
    await show(ManagerAmenitiesPage())
    expect(screen.getByText("Amenities couldn't be loaded")).toBeTruthy()
  })
})

describe("/manager/amenities/[checkId]", () => {
  it("shows the check with workspace links back and to Capture myself", async () => {
    await show(ManagerAmenityCheckPage({ params: params(WIFI_CHECK.id) }))
    expect(services.getCheck).toHaveBeenCalledWith(actor, {
      checkId: WIFI_CHECK.id,
    })
    expect(
      screen.getByRole("link", { name: "All amenities" }).getAttribute("href")
    ).toBe("/manager/amenities")
    expect(
      screen
        .getByRole("link", { name: UI_TEXT.captureMyself })
        .getAttribute("href")
    ).toBe(`/manager/amenities/${WIFI_CHECK.id}/capture`)
    noStaffLinks()
  })

  it("treats another venue's check as not found", async () => {
    services.getCheck.mockResolvedValue({
      ok: true,
      detail: detail({
        check: {
          ...WIFI_CHECK,
          venueId: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b99",
        },
      }),
    })
    await expect(
      show(ManagerAmenityCheckPage({ params: params(WIFI_CHECK.id) }))
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("treats an id that is not a check as not found, without a read", async () => {
    await expect(
      show(ManagerAmenityCheckPage({ params: params("not-a-uuid") }))
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(services.getCheck).not.toHaveBeenCalled()
  })

  it("not found keeps the /staff/manage heading and links to the workspace list", () => {
    render(<ManagerAmenityCheckNotFound />)
    expect(
      screen.getByRole("heading", { level: 1, name: "This check isn't here" })
    ).toBeTruthy()
    const back = screen.getByRole("link", { name: "See all amenities" })
    expect(back.getAttribute("href")).toBe("/manager/amenities")
  })
})

describe("/manager/amenities/[checkId]/capture", () => {
  it("captures with the manager form for the workspace venue and returns to the check", async () => {
    const { container } = await show(
      ManagerAmenityCapturePage({ params: params(WIFI_CHECK.id) })
    )
    const checkHref = `/manager/amenities/${WIFI_CHECK.id}`
    expect(capture.CaptureScreen).toHaveBeenCalledTimes(1)
    expect(capture.CaptureScreen.mock.calls[0][0]).toMatchObject({
      actor,
      checkId: WIFI_CHECK.id,
      mode: "manager",
      // Manager accounts can't upload (reserve_media_asset is staff-only).
      canUpload: false,
      venueId: VENUE.id,
      venueName: VENUE.name,
      backHref: checkHref,
      backLabel: "Back to the check",
      doneHref: checkHref,
    })
    // No staff AppShell around it: the workspace layout is the shell.
    expect(within(container).queryByRole("navigation")).toBeNull()
  })
})
