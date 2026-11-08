import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthState, CurrentProfile } from "@/lib/auth/profile"

const auth = vi.hoisted(() => ({
  state: { status: "signed_out" } as AuthState,
}))
const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: vi.fn(),
  delete: vi.fn(),
}))
const signInWithOtp = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", async () => {
  const routes = await import("@/lib/auth/routes")
  return {
    getAuthState: async () => auth.state,
    homePathFor: routes.homePathFor,
    ROUTES: routes.ROUTES,
  }
})
vi.mock("@/lib/auth/captcha", async (original) => ({
  ...(await original<typeof import("@/lib/auth/captcha")>()),
  getLoginCaptchaConfig: () => ({ enabled: false, siteKey: null }),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined,
    set: jar.set,
    delete: jar.delete,
  }),
}))
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to })
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithOtp } }),
}))

const { default: LoginPage } = await import("@/app/login/page")
const { default: RootPage } = await import("@/app/page")
const { requestSignInLink } = await import("@/app/login/actions")

const profile = (role: CurrentProfile["role"]): CurrentProfile => ({
  id: "u1",
  email: "a@example.test",
  displayName: "A",
  avatarPath: null,
  jobTitle: null,
  role,
  venueId: null,
  venue: null,
  active: true,
  work: null,
})
const active = (role: CurrentProfile["role"]): AuthState =>
  ({
    status: "active",
    profile: profile(role),
    user: { id: "u1", email: "a@example.test" },
  }) as AuthState

async function redirectOf(run: () => unknown) {
  try {
    await run()
  } catch (error) {
    return (error as { to?: string }).to
  }
  return undefined
}

const loginWith = (params: Record<string, string | string[]>) => () =>
  LoginPage({ searchParams: Promise.resolve(params) })

beforeEach(() => {
  auth.state = { status: "signed_out" }
  jar.values.clear()
  jar.set.mockClear()
  jar.delete.mockClear()
  signInWithOtp.mockReset().mockResolvedValue({ error: null })
})

/** The LoginCardHost element the login page renders. */
async function loginCardProps(params: Record<string, string | string[]>) {
  const page = (await loginWith(params)()) as {
    props: { children: { props: Record<string, unknown> } }
  }
  return page.props.children.props
}

describe("login page", () => {
  it("passes a safe ?next= to the card, which sends it with the link request", async () => {
    expect(
      (await loginCardProps({ next: "/manager/review?status=pending" }))
        .returnTo
    ).toBe("/manager/review?status=pending")
  })

  it("ignores an unsafe or repeated ?next=", async () => {
    for (const next of [
      "//evil.example",
      "https://evil.example/manager",
      "/login",
      "/api/library",
      "/staff/%0d%0a",
      '"><script>alert(1)</script>',
      ["/staff", "/admin"],
    ]) {
      expect((await loginCardProps({ next })).returnTo, String(next)).toBeNull()
    }
  })

  it("sends a signed-in visitor to ?next= when the role allows it, else home", async () => {
    auth.state = active("manager")
    expect(await redirectOf(loginWith({ next: "/manager/review?x=1" }))).toBe(
      "/manager/review?x=1"
    )
    expect(await redirectOf(loginWith({ next: "/admin/menus" }))).toBe(
      "/manager"
    )
    expect(await redirectOf(loginWith({ next: "//evil.example" }))).toBe(
      "/manager"
    )
    expect(await redirectOf(loginWith({}))).toBe("/manager")
  })
})

describe("requestSignInLink remembers the return path", () => {
  it("stores a safe path in the HttpOnly return cookie", async () => {
    await expect(
      requestSignInLink("a@example.test", undefined, "/staff/tasks/t1")
    ).resolves.toEqual({})
    expect(jar.set).toHaveBeenCalledExactlyOnceWith(
      "nl-return-to",
      "/staff/tasks/t1",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 3600,
      })
    )
    expect(jar.delete).not.toHaveBeenCalled()
    expect(signInWithOtp).toHaveBeenCalledOnce()
  })

  it("forgets any earlier path when none, or an unsafe one, is given", async () => {
    for (const returnTo of [undefined, "//evil.example", "/auth/logout"]) {
      jar.set.mockClear()
      jar.delete.mockClear()
      await requestSignInLink("a@example.test", undefined, returnTo)
      expect(jar.set, String(returnTo)).not.toHaveBeenCalled()
      expect(jar.delete, String(returnTo)).toHaveBeenCalledWith("nl-return-to")
    }
  })

  it("touches no cookie for an invalid email", async () => {
    await requestSignInLink("not-an-email", undefined, "/staff/tasks")
    expect(jar.set).not.toHaveBeenCalled()
    expect(jar.delete).not.toHaveBeenCalled()
  })
})

describe("/ applies the remembered page after the role check", () => {
  it("returns each role to a page in its own area", async () => {
    jar.values.set("nl-return-to", "/manager/review?status=pending")
    auth.state = active("manager")
    expect(await redirectOf(RootPage)).toBe("/manager/review?status=pending")
  })

  it("sends another account on the same browser home when the role does not allow it", async () => {
    jar.values.set("nl-return-to", "/admin/menus/v1")
    auth.state = active("staff")
    expect(await redirectOf(RootPage)).toBe("/staff/tasks")
    jar.values.set("nl-return-to", "/staff/tasks/t1")
    auth.state = active("admin")
    expect(await redirectOf(RootPage)).toBe("/admin")
  })

  it("re-validates the cookie: a tampered value goes home", async () => {
    auth.state = active("staff")
    for (const value of [
      "//evil.example",
      "https://evil.example",
      "/staff/%5C%5Cx",
      "/api/x",
    ]) {
      jar.values.set("nl-return-to", value)
      expect(await redirectOf(RootPage), value).toBe("/staff/tasks")
    }
  })

  it("is unchanged without a cookie and for signed-out or blocked accounts", async () => {
    auth.state = active("admin")
    expect(await redirectOf(RootPage)).toBe("/admin")
    jar.values.set("nl-return-to", "/staff/tasks/t1")
    auth.state = { status: "signed_out" }
    expect(await redirectOf(RootPage)).toBe("/login")
    auth.state = { status: "inactive", profile: profile("staff") } as AuthState
    expect(await redirectOf(RootPage)).toBe("/auth/blocked")
  })
})
