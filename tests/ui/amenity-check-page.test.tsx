// @vitest-environment jsdom
// The staff amenity check page reads the check while the shell status loads,
// not after it.
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock("@/app/_amenities/actions", () => ({
  listSubmittableAssetsAction: vi.fn(),
  submitFindingAction: vi.fn(),
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({
    id: "me",
    avatarPath: null,
    displayName: "TEST Sam",
    venue: { id: "v1", name: "TEST Inn" },
  })),
}))
vi.mock("@/lib/server/coverage", () => ({
  getCoverageActor: vi.fn(async () => ({ ok: true, actor: { profile: {} } })),
}))
const shell = vi.hoisted(() => ({
  release: (() => {}) as (value: unknown) => void,
}))
vi.mock("@/app/staff/_shell/shell-status", () => ({
  staffShellStatus: vi.fn(
    () =>
      new Promise((resolve) => {
        shell.release = resolve
      })
  ),
}))
const amenities = vi.hoisted(() => ({
  getCheck: vi.fn(async () => ({
    ok: false,
    code: "unavailable",
    status: 503,
    message: "down",
  })),
  listSubmittableAssets: vi.fn(async () => ({ ok: true, assets: [] })),
}))
vi.mock("@/lib/server/amenities", () => amenities)

import AmenityCapturePage from "@/app/staff/tasks/amenities/[checkId]/page"

afterEach(() => vi.clearAllMocks())

describe("staff amenity check page", () => {
  it("starts the check's reads before the shell status has loaded", async () => {
    const page = AmenityCapturePage({
      params: Promise.resolve({ checkId: "c1" }),
    }).catch((error: unknown) => error)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(amenities.getCheck).toHaveBeenCalledWith(expect.anything(), {
      checkId: "c1",
    })
    expect(amenities.listSubmittableAssets).toHaveBeenCalled()
    shell.release({ canManage: false })
    // The failed check read still reaches the segment's error boundary.
    expect(await page).toEqual(new Error("Amenity read failed: unavailable"))
  })
})
