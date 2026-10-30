// /api/internal/cleanup accepts only its shared secret, on POST and on GET (the
// method Vercel Cron uses). A signed-in admin's session is never enough.
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)

import { GET, POST } from "@/app/api/internal/cleanup/route"
import { GET as confirm } from "@/app/auth/confirm/route"

import { createIdentity, serviceClient } from "../support/identities"
import { appRequest, Browser, issueSignInLink } from "./auth-support"

const service = serviceClient()
const saved = process.env.CLEANUP_SECRET
const secret = randomUUID() + randomUUID()
let adminBrowser: Browser

beforeAll(async () => {
  const admin = await createIdentity(service, {
    label: "internal-admin",
    role: "admin",
    session: false,
  })
  adminBrowser = new Browser("internal-admin")
  const link = await issueSignInLink(service, admin.email)
  await adminBrowser.run(() => confirm(appRequest(adminBrowser, link)))
  expect(adminBrowser.authCookies().length).toBeGreaterThan(0)
})

afterAll(() => {
  if (saved === undefined) delete process.env.CLEANUP_SECRET
  else process.env.CLEANUP_SECRET = saved
})

describe.each([
  ["POST", POST],
  ["GET", GET],
] as const)("%s /api/internal/cleanup", (method, handler) => {
  const call = (authorization?: string, browser?: Browser) =>
    handler(
      appRequest(browser ?? new Browser("anon"), "/api/internal/cleanup", {
        method,
        headers: authorization ? { authorization } : {},
      })
    )

  it("is unavailable until a long enough secret is configured", async () => {
    delete process.env.CLEANUP_SECRET
    expect((await call(`Bearer ${secret}`)).status).toBe(503)
    process.env.CLEANUP_SECRET = "short"
    expect((await call("Bearer short")).status).toBe(503)
  })

  it("refuses wrong secrets and admin sessions without the secret", async () => {
    process.env.CLEANUP_SECRET = secret
    for (const auth of [
      undefined,
      "Bearer wrong",
      secret,
      `Bearer ${secret}x`,
      `Basic ${secret}`,
    ]) {
      const res = await call(auth)
      expect(res.status).toBe(401)
      expect(res.headers.get("cache-control")).toBe("no-store")
    }
    const withSession = await adminBrowser.run(() =>
      call(undefined, adminBrowser)
    )
    expect(withSession.status).toBe(401)
  })

  it("runs one cleanup pass with the secret", async () => {
    process.env.CLEANUP_SECRET = secret
    const res = await call(`Bearer ${secret}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(["completed", "skipped"]).toContain((await res.json()).status)
  })
})
