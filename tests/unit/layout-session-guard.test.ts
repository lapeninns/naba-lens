import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({
  requireActiveAdmin: async () => ({ id: "admin-1", role: "admin" }),
  requireActiveStaff: async () => ({
    id: "staff-1",
    role: "staff",
    venue: null,
  }),
  uploadBlockReason: () => null,
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
const entry = vi.hoisted(() => ({
  managerAddEntry: vi.fn(() => Promise.resolve(null)),
}))
vi.mock("@/app/manager/entry", () => entry)
vi.mock("@/lib/auth/captcha", () => ({
  getLoginCaptchaConfig: () => ({ enabled: true, siteKey: "site-key" }),
}))

const { default: AdminLayout } = await import("@/app/admin/layout")
const { default: ManagerLayout } = await import("@/app/manager/layout")
const { SessionGuardHost } =
  await import("@/components/nabalens/session-guard-host")
const { ManagerShell } =
  await import("@/components/nabalens/manager/manager-shell")
const { default: StaffLayout } = await import("@/app/staff/layout")
const { AddHost } = await import("@/app/staff/_shell/add-host")

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
    vi.stubEnv("NABALENS_CONTRIBUTION_ENTRY", "b01")
    try {
      // The entry off: today's workspace, with no Add host and no R8 read.
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
      expect(entry.managerAddEntry).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("with the entry on, the shell sits in a manager Add host fed R8's read in flight", async () => {
    vi.stubEnv("NABALENS_CONTRIBUTION_ENTRY", "b02")
    try {
      const tree = await ManagerLayout({ children: "PAGE" })
      expect(tree).toMatchObject({
        type: SessionGuardHost,
        props: {
          children: {
            type: AddHost,
            props: {
              blocked: null,
              captchaRequired: true,
              captchaSiteKey: "site-key",
              venueName: "Lakeside",
              role: "manager",
              children: {
                type: ManagerShell,
                props: { venueName: "Lakeside", children: "PAGE" },
              },
            },
          },
        },
      })
      expect(entry.managerAddEntry).toHaveBeenCalledWith("v1", "Lakeside")
      // A promise: the page never waits for the capabilities read.
      expect(tree.props.children.props.entry).toBeInstanceOf(Promise)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("staff pages meet an ended session in place", () => {
  it("the staff layout wraps Add (and its upload sheet) in the session guard", async () => {
    expect(await StaffLayout({ children: "PAGE" })).toMatchObject({
      type: SessionGuardHost,
      props: {
        captchaRequired: true,
        captchaSiteKey: "site-key",
        children: {
          type: AddHost,
          props: {
            blocked: null,
            captchaRequired: true,
            captchaSiteKey: "site-key",
            children: "PAGE",
          },
        },
      },
    })
  })
})
