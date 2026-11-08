import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({
  requireActiveAdmin: async () => ({ id: "admin-1", role: "admin" }),
}))
vi.mock("@/lib/auth/manager", () => ({
  getManagerWorkspace: async () => ({
    status: "available",
    venue: { id: "v1", name: "Lakeside" },
    profile: { displayName: "Mina" },
  }),
}))
vi.mock("@/app/manager/load-overview", () => ({
  loadManagerOverview: async () => ({
    ok: true,
    overview: { pendingPhotos: 3 },
  }),
}))
vi.mock("@/lib/auth/captcha", () => ({
  getLoginCaptchaConfig: () => ({ enabled: true, siteKey: "site-key" }),
}))

const { default: AdminLayout } = await import("@/app/admin/layout")
const { default: ManagerLayout } = await import("@/app/manager/layout")
const { SessionGuardHost } =
  await import("@/components/nabalens/session-guard-host")
const { ManagerShell } =
  await import("@/components/nabalens/manager/manager-shell")

describe("manager and admin pages meet an ended session in place", () => {
  it("the admin layout wraps every admin page in the session guard", async () => {
    expect(await AdminLayout({ children: "PAGE" })).toMatchObject({
      type: SessionGuardHost,
      props: {
        captchaRequired: true,
        captchaSiteKey: "site-key",
        children: "PAGE",
      },
    })
  })

  it("the manager layout wraps the workspace shell in the session guard", async () => {
    expect(await ManagerLayout({ children: "PAGE" })).toMatchObject({
      type: SessionGuardHost,
      props: {
        captchaRequired: true,
        captchaSiteKey: "site-key",
        children: {
          type: ManagerShell,
          props: { venueName: "Lakeside", reviewCount: 3, children: "PAGE" },
        },
      },
    })
  })
})
