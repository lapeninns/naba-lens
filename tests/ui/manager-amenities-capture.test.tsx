// @vitest-environment jsdom
// "Capture myself" uploads: a manager account in /manager can't upload
// (reserve_media_asset is staff-only), so its capture page offers existing
// media only. A staff account holding a manager grant in /staff/manage still
// gets the upload flow. Renders the real capture screen and form.
import { cleanup, render, screen } from "@testing-library/react"
import { cloneElement, isValidElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/manager/amenities",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

const access = vi.hoisted(() => ({
  workspaceManagerContext: vi.fn(),
  managerAccess: vi.fn(),
}))
vi.mock("@/app/staff/manage/_shared/context", () => access)
vi.mock("@/app/staff/manage/_shared/frame", () => ({
  NotManagerPage: () => null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const services = vi.hoisted(() => ({
  getCheck: vi.fn(),
  listSubmittableAssets: vi.fn(),
}))
vi.mock("@/lib/server/amenities", () => services)
// R8 unavailable: the capture page keeps today's no-upload form (B02-c's
// uploads are tested in manager-add-b02c and manager-amenities).
vi.mock("@/app/manager/entry", () => ({
  managerCapabilities: vi.fn(async () => null),
}))
vi.mock("@/app/_amenities/actions", () => ({
  listSubmittableAssetsAction: vi.fn(),
  submitFindingAction: vi.fn(),
}))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => ({}),
}))

import ManageAmenityCapturePage from "@/app/staff/manage/amenities/[checkId]/capture/page"
import * as managerCapturePage from "@/app/manager/amenities/[checkId]/capture/page"
const ManagerAmenityCapturePage = managerCapturePage.default

import { DARTS, MANAGER, VENUE, detail } from "./amenities-manage-fixtures"

/** Awaits async Server Components in the tree; client components render as usual. */
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

const params = Promise.resolve({ checkId: DARTS.id })
const NO_UPLOAD =
  /You can't upload here\. Attach photos or videos already on Naba-Lens, or assign this check to a staff member/

function ctx(mode: "manager" | "workspace", basePath: string) {
  return {
    mode,
    actor: { profile: { id: MANAGER.id } },
    viewerId: MANAGER.id,
    viewerName: MANAGER.displayName,
    venue: VENUE,
    venueId: VENUE.id,
    basePath,
    coverage: null,
  }
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  access.workspaceManagerContext.mockResolvedValue(ctx("workspace", "/manager"))
  access.managerAccess.mockResolvedValue({
    ok: true,
    ctx: ctx("manager", "/staff/manage"),
  })
  services.getCheck.mockResolvedValue({
    ok: true,
    detail: detail({ check: DARTS }),
  })
  services.listSubmittableAssets.mockResolvedValue({ ok: true, assets: [] })
})

describe("Capture myself: who may upload", () => {
  it("/manager offers no upload and says how to get new evidence", async () => {
    await show(ManagerAmenityCapturePage({ params }))
    expect(
      screen.getByRole("heading", { level: 1, name: DARTS.entry.question })
    ).toBeTruthy()
    expect(screen.queryByText("Add a photo or video")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Choose from your photos" })
    ).toBeNull()
    expect(screen.getByText(NO_UPLOAD)).toBeTruthy()
  })

  it("/manager has no upload time budget", () => {
    expect("maxDuration" in managerCapturePage).toBe(false)
  })

  it("/staff/manage keeps the upload flow for a staff account with a grant", async () => {
    await show(ManageAmenityCapturePage({ params }))
    expect(screen.getByText("Add a photo or video")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Choose from your photos" })
    ).toBeTruthy()
    expect(screen.queryByText(NO_UPLOAD)).toBeNull()
  })
})

describe("Capture myself: Yes with nothing to attach (§5.3)", () => {
  const REFUSED =
    "Yes needs a photo. This account can't add new photos or videos, and none of yours can be attached."
  const ASSET = {
    assetId: "asset-1",
    kind: "photo" as const,
    createdAt: "2026-11-01T10:00:00Z",
    source: "legacy_coverage" as const,
    thumbUrl: null,
  }

  it("/manager keeps Yes and says why before it is chosen", async () => {
    await show(ManagerAmenityCapturePage({ params }))
    expect(screen.getByRole("radio", { name: "Yes" })).toBeTruthy()
    expect(screen.getByText(REFUSED)).toBeTruthy()
  })

  it("not once something can be attached, nor for a staff account with a grant", async () => {
    services.listSubmittableAssets.mockResolvedValue({
      ok: true,
      assets: [ASSET],
    })
    await show(ManagerAmenityCapturePage({ params }))
    expect(screen.queryByText(REFUSED)).toBeNull()
    cleanup()
    services.listSubmittableAssets.mockResolvedValue({ ok: true, assets: [] })
    await show(ManageAmenityCapturePage({ params }))
    expect(screen.queryByText(REFUSED)).toBeNull()
  })
})
