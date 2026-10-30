import { beforeAll, describe, expect, it, vi } from "vitest"

import { syntheticJpeg } from "../slice/media-actor"
import {
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  cookiesModule,
  params,
  sessionCookies,
  setupIdentity,
  setupSession,
  applyLocalEnv,
  type CookieJar,
} from "./gaps-support"

/**
 * GAP-11 item 2 (second half): a POST to /api/profile carrying a foreign
 * `Origin` must be refused, as app/admin/staff/[id]/avatar/route.ts already does.
 */

const jar = vi.hoisted<CookieJar>(() => ({ current: new Map() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => cookiesModule(jar))

applyLocalEnv()
vi.setConfig({ hookTimeout: 240_000, testTimeout: 90_000 })

const ORIGIN = "http://127.0.0.1:3000"
const FOREIGN = "https://attacker.example"
const admin = serviceClient()

async function displayName(id: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("display_name, avatar_path")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

describe("GAP-11: same-origin checks on profile routes", () => {
  let staff: TestIdentity
  let adminUser: TestIdentity

  beforeAll(async () => {
    const venue = await createVenue(admin, "gaps-origin")
    staff = await setupIdentity(admin, {
      label: "gaps-origin",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await setupIdentity(admin, {
      label: "gaps-origin-admin",
      role: "admin",
    })
  })

  it("control: the admin avatar route refuses a foreign Origin", async () => {
    jar.current = await setupSession(adminUser.email, () =>
      sessionCookies(adminUser)
    )
    const { POST } = await import("../../app/admin/staff/[id]/avatar/route")
    const form = new FormData()
    form.set(
      "file",
      new File([await syntheticJpeg(200, 200)], "x.jpg", {
        type: "image/jpeg",
      })
    )
    const before = await displayName(staff.id)
    const { NextRequest } = await import("next/server")
    const res = await POST(
      new NextRequest(`${ORIGIN}/admin/staff/${staff.id}/avatar`, {
        method: "POST",
        body: form,
        headers: { origin: FOREIGN },
      }),
      params(staff.id)
    )
    jar.current = new Map()
    expect(res.status).toBe(403)
    expect(await displayName(staff.id)).toEqual(before)
  })

  // BUG: app/api/profile/route.ts has no same-origin check (acceptance GAP-11
  // item 2; review finding 7, LOW). The admin avatar route above refuses a
  // foreign Origin with 403; /api/profile answers 200 and renames the caller.
  // SameSite=Lax session cookies blunt this in browsers, but the route itself
  // does not refuse. Expected to FAIL until the route checks Origin the way
  // app/admin/staff/[id]/avatar/route.ts does. Not skipped on purpose.
  it("/api/profile refuses a cross-origin POST and changes nothing", async () => {
    jar.current = await setupSession(staff.email, () => sessionCookies(staff))
    const { POST } = await import("../../app/api/profile/route")
    const before = await displayName(staff.id)
    const form = new FormData()
    form.set("displayName", "TEST cross-origin rename")
    const res = await POST(
      new Request(`${ORIGIN}/api/profile`, {
        method: "POST",
        body: form,
        headers: { origin: FOREIGN },
      })
    )
    jar.current = new Map()
    expect(await displayName(staff.id)).toEqual(before)
    expect(res.status).toBe(403)
  })
})
