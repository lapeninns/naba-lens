// /admin/staff must render when Supabase Auth is slow or failing (journey run
// under load): the auth lookups are bounded by a deadline and the pages degrade
// to profile data plus a clear notice instead of failing.
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {}, refresh: () => {} }))

// The pages build their own service client; this one can be made to hang.
const authOutage = { mode: "none" as "none" | "hang" | "fail" }
vi.mock("@/lib/supabase/admin", async () => {
  const { serviceClient } = await import("../support/identities")
  return {
    createAdminClient: () => withAuthOutage(serviceClient()),
  }
})

import StaffPortfolioPage from "@/app/admin/staff/[id]/page"
import { AuthDetailsNotice } from "@/app/admin/staff/auth-details-notice"
import StaffDirectoryPage from "@/app/admin/staff/page"
import {
  getStaffAccount,
  inviteStaff,
  listStaffDirectory,
  resendInvitation,
  type AccountsContext,
} from "@/lib/server/accounts"
import { AUTH_LOOKUP_DEADLINE_MS } from "@/lib/server/accounts/auth-users"

import {
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
  type Db,
  type TestIdentity,
} from "../support/identities"
import { followEmailLink } from "./auth-confirm"
import {
  authUserCount,
  Browser,
  issueSignInLink,
  mailCount,
  redirectOf,
} from "./auth-support"

/** A service client whose Auth admin API hangs or fails while `authOutage` says so. */
function withAuthOutage(client: Db): Db {
  const admin = client.auth.admin
  for (const name of ["listUsers", "getUserById"] as const) {
    const real = admin[name].bind(admin) as (...a: unknown[]) => unknown
    ;(admin as unknown as Record<string, unknown>)[name] = (
      ...args: unknown[]
    ) => {
      if (authOutage.mode === "hang") return new Promise(() => {})
      if (authOutage.mode === "fail") {
        return Promise.resolve({
          data: { users: [], user: null },
          error: { status: 504, code: "request_timeout", message: "timeout" },
        })
      }
      return real(...args)
    }
  }
  return client
}

const service = serviceClient()
const SHORT = 300

let venue: { id: string }
let adminUser: TestIdentity
let invited: string
let signedIn: TestIdentity
let deactivated: TestIdentity
let browser: Browser

const ctx = (over: Partial<AccountsContext> = {}): AccountsContext => ({
  caller: adminUser.client,
  service: withAuthOutage(serviceClient()),
  authDeadlineMs: SHORT,
  ...over,
})

async function timed<T>(work: () => Promise<T>) {
  const start = Date.now()
  const value = await work()
  return { value, ms: Date.now() - start }
}

function findAll(
  node: unknown,
  match: (n: { type?: unknown; props?: Record<string, unknown> }) => boolean,
  out: { type?: unknown; props?: Record<string, unknown> }[] = []
) {
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, match, out))
    return out
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> }
  if (match(element)) out.push(element)
  if (element.props) findAll(element.props.children, match, out)
  return out
}

beforeAll(async () => {
  venue = await createVenue(service, "dir-outage")
  adminUser = await createIdentity(service, {
    label: "dir-admin",
    role: "admin",
  })
  signedIn = await createIdentity(service, {
    label: "dir-signed-in",
    role: "staff",
    venueId: venue.id,
  })
  deactivated = await createIdentity(service, {
    label: "dir-deactivated",
    role: "staff",
    venueId: venue.id,
    active: false,
  })
  const email = testEmail("dir-invited")
  const result = await inviteStaff(
    {
      caller: adminUser.client,
      service,
      mailer: async () => ({ error: null }),
    },
    {
      displayName: "TEST dir-invited",
      email,
      jobTitle: null,
      venueId: venue.id,
    }
  )
  if (result.status !== "sent") throw new Error("invite failed")
  invited = result.userId

  browser = new Browser("dir-admin")
  await followEmailLink(
    browser,
    await issueSignInLink(service, adminUser.email)
  )
})

describe("staff directory data when Supabase Auth is slow or down", () => {
  it("control: with Auth answering, emails and Invited/Active are exact", async () => {
    authOutage.mode = "none"
    const result = await listStaffDirectory(ctx())
    expect(result.ok && result.authDetails).toBe("ok")
    if (!result.ok) return
    const byId = new Map(result.staff.map((s) => [s.id, s]))
    expect(byId.get(invited)?.status).toBe("invited")
    expect(byId.get(signedIn.id)).toMatchObject({
      status: "active",
      email: signedIn.email,
    })
    expect(byId.get(deactivated.id)?.status).toBe("inactive")
  })

  for (const mode of ["hang", "fail"] as const) {
    it(`Auth ${mode}s: the list still loads within the deadline, marked unavailable`, async () => {
      authOutage.mode = mode
      const { value: result, ms } = await timed(() => listStaffDirectory(ctx()))
      authOutage.mode = "none"
      expect(ms).toBeLessThan(SHORT + 2_000)
      expect(result.ok && result.authDetails).toBe("unavailable")
      if (!result.ok) return
      const byId = new Map(result.staff.map((s) => [s.id, s]))
      // Database facts stay exact; Auth-only facts are absent, not invented.
      expect(byId.get(deactivated.id)?.status).toBe("inactive")
      expect(byId.get(signedIn.id)).toMatchObject({
        status: "active",
        email: null,
        lastSignInAt: null,
        displayName: "TEST dir-signed-in",
      })
      expect(byId.get(invited)?.venueId).toBe(venue.id)
    })
  }

  it("one account's page data degrades the same way", async () => {
    authOutage.mode = "hang"
    const { value: result, ms } = await timed(() =>
      getStaffAccount(ctx(), signedIn.id)
    )
    authOutage.mode = "none"
    expect(ms).toBeLessThan(SHORT + 2_000)
    expect(result).toMatchObject({
      ok: true,
      authDetails: "unavailable",
      staff: { id: signedIn.id, email: null, status: "active" },
    })
  })

  it("invite and resend refuse clearly, creating and sending nothing", async () => {
    authOutage.mode = "hang"
    const email = testEmail("dir-during-outage")
    const sent = vi.fn(async () => ({ error: null }))
    const invite = await inviteStaff(ctx({ mailer: sent }), {
      displayName: "TEST outage",
      email,
      jobTitle: null,
      venueId: venue.id,
    })
    const resend = await resendInvitation(ctx({ mailer: sent }), invited)
    authOutage.mode = "none"
    expect(invite).toMatchObject({
      status: "error",
      code: "auth_failed",
      error: expect.stringMatching(/Nothing was saved/),
    })
    expect(resend).toMatchObject({
      ok: false,
      code: "auth_failed",
      error: expect.stringMatching(/No email was sent/),
    })
    expect(sent).not.toHaveBeenCalled()
    expect(authUserCount(email)).toBe(0)
    expect(await mailCount(email)).toBe(0)
  })
})

describe("the real pages during an Auth outage", { timeout: 30_000 }, () => {
  it("/admin/staff renders the list with the notice, within the default deadline", async () => {
    authOutage.mode = "hang"
    const { value: page, ms } = await timed(() =>
      browser.run(() => redirectOf(StaffDirectoryPage))
    )
    authOutage.mode = "none"
    expect(page.location).toBeNull()
    expect(ms).toBeLessThan(AUTH_LOOKUP_DEADLINE_MS + 3_000)
    expect(
      findAll(page.value, (n) => n.type === AuthDetailsNotice)
    ).toHaveLength(1)
    const directory = findAll(page.value, (n) =>
      Array.isArray(n.props?.staff)
    )[0]
    const ids = (directory?.props?.staff as { id: string }[]).map((s) => s.id)
    expect(ids).toEqual(
      expect.arrayContaining([invited, signedIn.id, deactivated.id])
    )

    // Healthy again: no notice.
    const healthy = await browser.run(() => redirectOf(StaffDirectoryPage))
    expect(findAll(healthy.value, (n) => n.type === AuthDetailsNotice)).toEqual(
      []
    )
  })

  it("/admin/staff/[id] renders with the notice too", async () => {
    authOutage.mode = "hang"
    const page = await browser.run(() =>
      redirectOf(() =>
        StaffPortfolioPage({ params: Promise.resolve({ id: signedIn.id }) })
      )
    )
    authOutage.mode = "none"
    expect(page.location).toBeNull()
    expect(
      findAll(page.value, (n) => n.type === AuthDetailsNotice)
    ).toHaveLength(1)
  })
})
