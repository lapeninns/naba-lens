// The first-admin procedure end to end: the real `scripts/bootstrap-admin.ts`
// CLI against the local stack, then the promoted person signing in.
import { spawnSync } from "node:child_process"

import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import { setStaffActiveAction } from "@/app/admin/staff/actions"
import { GET as confirm } from "@/app/auth/confirm/route"
import RootPage from "@/app/page"
import { getAuthState } from "@/lib/auth"

import {
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  appRequest,
  authUserCount,
  Browser,
  issueSignInLink,
  redirectOf,
} from "./auth-support"

const service = serviceClient()

/** `pnpm bootstrap:admin ...` with only the documented environment. */
function bootstrap(...args: string[]) {
  const env = getLocalSupabaseEnv()
  const result = spawnSync(
    "node_modules/.bin/tsx",
    ["scripts/bootstrap-admin.ts", ...args],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: env.url,
        SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
      },
    }
  )
  return {
    code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

async function profile(id: string) {
  const { data } = await service
    .from("profiles")
    .select("role, active, display_name")
    .eq("id", id)
    .maybeSingle()
  return data
}

/** Signs in through /auth/confirm; returns where "/" sends them (or the failure). */
async function signInAndLand(email: string) {
  const browser = new Browser(email)
  const link = await issueSignInLink(service, email)
  const res = await browser.run(() => confirm(appRequest(browser, link)))
  if (res.headers.get("location") !== "/") {
    return { browser, landed: res.headers.get("location") }
  }
  const root = await browser.run(() => redirectOf(RootPage))
  return { browser, landed: root.location }
}

let venue: { id: string }

beforeAll(async () => {
  venue = await createVenue(service, "boot")
})

// Each CLI run starts tsx and pages through every auth user (GoTrue has no lookup
// by email), which takes seconds on a loaded machine.
describe("scripts/bootstrap-admin.ts", { timeout: 90_000 }, () => {
  it("needs --email and the service environment", () => {
    const missing = bootstrap()
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain("Usage")

    const noEnv = spawnSync(
      "node_modules/.bin/tsx",
      ["scripts/bootstrap-admin.ts", "--email", "x@nabalens.test"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      }
    )
    expect(noEnv.status).toBe(1)
    expect(noEnv.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("refuses an unknown email and never creates an account", async () => {
    const email = testEmail("boot-unknown")
    const result = bootstrap("--email", email, "--name", "TEST Owner")
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("No auth user with that email")
    expect(authUserCount(email)).toBe(0)
  })

  it("promotes an existing staff member, idempotently, and they land as admin", async () => {
    const user = await createIdentity(service, {
      label: "boot-staff",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    // Their open session is re-read on every request: it becomes an admin session.
    const before = await signInAndLand(user.email)
    expect(before.landed).toBe("/staff")

    const first = bootstrap("--email", ` ${user.email.toUpperCase()} `)
    expect(first).toMatchObject({ code: 0 })
    expect(first.stdout).toBe(`bootstrap-admin: promoted (user ${user.id})`)
    const again = bootstrap("--email", user.email)
    expect(again.stdout).toBe(
      `bootstrap-admin: already_admin (user ${user.id})`
    )
    expect(await profile(user.id)).toMatchObject({
      role: "admin",
      active: true,
    })
    expect(authUserCount(user.email)).toBe(1)

    const live = await before.browser.run(() => redirectOf(RootPage))
    expect(live.location).toBe("/admin")
    expect((await signInAndLand(user.email)).landed).toBe("/admin")
  })

  it("creates the profile for an invited user without one, only with --name", async () => {
    const user = await createIdentity(service, {
      label: "boot-owner",
      role: "admin",
      profile: false,
      session: false,
    })
    expect((await signInAndLand(user.email)).landed).toBe("/auth/blocked")

    const noName = bootstrap("--email", user.email)
    expect(noName.code).toBe(1)
    expect(noName.stderr).toContain("--name")
    expect(await profile(user.id)).toBeNull()

    const created = bootstrap("--email", user.email, "--name", "TEST Owner")
    expect(created.stdout).toBe(
      `bootstrap-admin: created_profile (user ${user.id})`
    )
    expect(bootstrap("--email", user.email, "--name", "Other").stdout).toBe(
      `bootstrap-admin: already_admin (user ${user.id})`
    )
    expect(await profile(user.id)).toEqual({
      role: "admin",
      active: true,
      display_name: "TEST Owner",
    })
    expect((await signInAndLand(user.email)).landed).toBe("/admin")
  })

  it("restores a deactivated account so the new admin can actually sign in", async () => {
    const admin = await createIdentity(service, {
      label: "boot-deactivator",
      role: "admin",
      session: false,
    })
    const adminBrowser = (await signInAndLand(admin.email)).browser
    const user = await createIdentity(service, {
      label: "boot-former",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    // Deactivated through the app: profile inactive and the auth user banned.
    const off = await adminBrowser.run(() =>
      setStaffActiveAction(user.id, false)
    )
    expect(off).toEqual({ ok: true })
    expect((await signInAndLand(user.email)).landed).toBe(
      "/login?error=link_invalid"
    )

    const promoted = bootstrap("--email", user.email)
    expect(promoted.stdout).toBe(`bootstrap-admin: promoted (user ${user.id})`)
    expect(await profile(user.id)).toMatchObject({
      role: "admin",
      active: true,
    })
    const { browser, landed } = await signInAndLand(user.email)
    expect(landed).toBe("/admin")
    expect((await browser.run(getAuthState)).status).toBe("active")
  })
})
