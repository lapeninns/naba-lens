import { beforeEach, describe, expect, it, vi } from "vitest"

// A Menu read that finds the session ended sends the manager to sign in and
// back to the same list or item, with its filters (section, status, search).

vi.mock("server-only", () => ({}))
const failedRead = vi.hoisted(() =>
  vi.fn((...args: unknown[]): never => {
    throw new Error(`redirected to ${String(args[2])}`)
  })
)
vi.mock("@/app/manager/load-overview", () => ({
  failedRead,
  loadManagerOverview: async () => ({ ok: false, code: "unauthenticated" }),
}))
vi.mock("@/app/manager/actions", () => ({
  loadMenuItemsPageAction: vi.fn(),
  decideMenuPhotoAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))
vi.mock("@/lib/auth/manager", () => ({
  requireManagerVenue: async () => ({ venue: { id: "v1", name: "Lakeside" } }),
}))
vi.mock("@/lib/server/menu-photos", () => ({
  listManagerMenuItems: vi.fn(),
  getManagerPhotoCtx: async () => ({ ok: false, code: "unauthenticated" }),
  getManagerItem: vi.fn(),
  listItemEvents: vi.fn(),
}))

const { default: MenuPage } = await import("@/app/manager/menu/page")
const { default: ItemPage } = await import("@/app/manager/menu/[itemId]/page")

const SECTION = "4b1f0f6e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
const ITEM = "7d1f0f6e-1c2d-4e5f-8a9b-0c1d2e3f4a5c"

beforeEach(() => {
  failedRead.mockClear()
})

async function reason(page: Promise<unknown>) {
  try {
    await page
    return "rendered"
  } catch (error) {
    return (error as Error).message
  }
}

describe("Menu after the session ended", () => {
  it("returns to the list with its filters", async () => {
    const page = MenuPage({
      searchParams: Promise.resolve({
        status: "needs_photo",
        section: SECTION,
        q: "momo",
      }),
    })
    expect(await reason(page)).toBe(
      `redirected to /manager/menu?status=needs_photo&section=${SECTION}&q=momo`
    )
  })

  it("returns to the item, keeping the list's filters for Back", async () => {
    const from = `status=needs_photo&section=${SECTION}`
    const page = ItemPage({
      params: Promise.resolve({ itemId: ITEM }),
      searchParams: Promise.resolve({ from }),
    })
    expect(await reason(page)).toBe(
      `redirected to /manager/menu/${ITEM}?${new URLSearchParams({ from })}`
    )
  })
})
