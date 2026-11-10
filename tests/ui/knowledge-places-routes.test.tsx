// @vitest-environment jsdom
// B03 UI design §3.6: the Places pages under /manager, /staff/manage and the
// admin venue tools, and the way to them from Amenities.
import { cleanup, render, screen } from "@testing-library/react"
import { cloneElement, isValidElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/manager/amenities/places",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

const VENUE = { id: "9b000000-0000-4000-8000-000000000301", name: "⟨Venue⟩" }
const ctx = (mode: "workspace" | "manager" | "admin", basePath: string) => ({
  mode,
  actor: { profile: { id: "u1" } },
  viewerId: "u1",
  viewerName: "⟨Name⟩",
  venue: VENUE,
  venueId: VENUE.id,
  basePath,
  coverage: null,
})
const access = vi.hoisted(() => ({
  workspaceManagerContext: vi.fn(),
  managerAccess: vi.fn(),
  adminVenueContext: vi.fn(),
}))
vi.mock("@/app/staff/manage/_shared/context", () => access)
vi.mock("@/app/staff/manage/_shared/frame", () => ({
  // The real frame renders the page title as the h1 inside its shell.
  ManageFrame: ({
    title,
    children,
  }: {
    title: string
    children: ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
  NotManagerPage: () => <p>not a manager</p>,
}))
const knowledge = vi.hoisted(() => ({ listPlaces: vi.fn() }))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))
vi.mock("@/app/_knowledge/actions", () => ({
  addPlaceAction: vi.fn(),
  retirePlaceAction: vi.fn(),
  decideFindingAction: vi.fn(),
  resolveConflictAction: vi.fn(),
}))
vi.mock("@/app/_amenities/actions", () => ({}))

import AdminPlacesPage from "@/app/admin/coverage/[venueId]/amenities/places/page"
import ManagerPlacesPage from "@/app/manager/amenities/places/page"
import ManagePlacesPage from "@/app/staff/manage/amenities/places/page"

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const { type } = node
  const props = node.props as Record<string, unknown>
  if (typeof type === "function" && type.constructor.name === "AsyncFunction")
    return resolve(await (type as (p: unknown) => Promise<ReactNode>)(props))
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props))
    if (isValidElement(value) || Array.isArray(value))
      next[key] = await resolve(value as ReactNode)
  if (Object.keys(next).length === 0) return node
  const { children, ...rest } = next
  return Array.isArray(children)
    ? cloneElement(node, rest, ...(children as ReactNode[]))
    : cloneElement(node, next)
}

const PLACE = {
  subjectId: "5a000000-0000-4000-8000-000000000001",
  kind: "entrance",
  label: "⟨Main entrance⟩",
  active: true,
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  access.workspaceManagerContext.mockResolvedValue(ctx("workspace", "/manager"))
  access.managerAccess.mockResolvedValue({
    ok: true,
    ctx: ctx("manager", "/staff/manage"),
  })
  access.adminVenueContext.mockResolvedValue(
    ctx("admin", `/admin/coverage/${VENUE.id}`)
  )
  knowledge.listPlaces.mockResolvedValue({
    ok: true,
    venueId: VENUE.id,
    places: [PLACE],
  })
})

const pages = {
  manager: [() => ManagerPlacesPage(), "/manager/amenities"],
  "legacy grant": [() => ManagePlacesPage(), "/staff/manage/amenities"],
  admin: [
    () => AdminPlacesPage({ params: Promise.resolve({ venueId: VENUE.id }) }),
    `/admin/coverage/${VENUE.id}/amenities`,
  ],
} as const

describe("Places pages", () => {
  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    "%s: the venue's places, with the way back to Amenities",
    async (name) => {
      const [page, list] = pages[name]
      render(<>{await resolve(await page())}</>)
      expect(knowledge.listPlaces).toHaveBeenCalledWith(expect.anything(), {
        venueId: VENUE.id,
      })
      expect(
        screen.getByRole("heading", { level: 1, name: "Places at ⟨Venue⟩" })
      ).toBeTruthy()
      expect(
        screen.getByRole("link", { name: "All amenities" }).getAttribute("href")
      ).toBe(list)
      expect(screen.getByText("⟨Main entrance⟩")).toBeTruthy()
    }
  )

  it("says places aren't available before the migration", async () => {
    knowledge.listPlaces.mockResolvedValue({
      ok: true,
      venueId: null,
      places: null,
    })
    render(<>{await resolve(await ManagerPlacesPage())}</>)
    expect(screen.getByText("Places aren't available yet.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Add place" })).toBeNull()
  })

  it("a staff account without a grant gets the plain refusal", async () => {
    access.managerAccess.mockResolvedValue({
      ok: false,
      viewerName: "⟨Name⟩",
      reason: "not_manager",
    })
    render(<>{await resolve(await ManagePlacesPage())}</>)
    expect(screen.getByText("not a manager")).toBeTruthy()
    expect(knowledge.listPlaces).not.toHaveBeenCalled()
  })
})
