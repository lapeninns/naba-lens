import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { authorize, replaceProfileAvatar, accountsContext } = vi.hoisted(() => ({
  authorize: vi.fn(),
  replaceProfileAvatar: vi.fn(),
  accountsContext: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authorize }))
vi.mock("@/lib/server/accounts", () => ({ replaceProfileAvatar }))
vi.mock("@/lib/server/accounts/request", () => ({ accountsContext }))
vi.mock("@/lib/media", () => ({ createAvatarDerivative: vi.fn() }))

const { POST } = await import("@/app/admin/staff/[id]/avatar/route")
const staffId = "11111111-1111-4111-8111-111111111111"

function request(headers: Record<string, string>) {
  const body = new FormData()
  body.set("file", new File([new Uint8Array([1, 2, 3])], "avatar.jpg"))
  // Next development can normalise the URL to localhost while the browser's
  // Origin and external Host still contain 127.0.0.1.
  return new NextRequest(
    `http://localhost:3000/admin/staff/${staffId}/avatar`,
    {
      method: "POST",
      headers,
      body,
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authorize.mockResolvedValue({ ok: true })
  accountsContext.mockResolvedValue({ actor: "admin" })
  replaceProfileAvatar.mockResolvedValue({ ok: true })
})

describe("admin avatar upload origin checks", () => {
  it("accepts the external development or forwarded host despite a normalised URL", async () => {
    for (const headers of [
      {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      },
      {
        host: "internal:3000",
        "x-forwarded-host": "naba-lens.example, edge.internal",
        origin: "https://naba-lens.example",
        "sec-fetch-site": "same-origin",
      },
    ] as Record<string, string>[]) {
      const response = await POST(request(headers), {
        params: Promise.resolve({ id: staffId }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    }
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize).toHaveBeenCalledWith("admin")
    expect(replaceProfileAvatar).toHaveBeenCalledTimes(2)
    expect(replaceProfileAvatar).toHaveBeenLastCalledWith(
      { actor: "admin" },
      staffId,
      new Uint8Array([1, 2, 3]),
      expect.any(Function)
    )
  })

  it("rejects foreign, opaque and cross-site requests before authorization or body reads", async () => {
    for (const headers of [
      { host: "naba-lens.example", origin: "https://attacker.example" },
      { host: "naba-lens.example", origin: "null" },
      { host: "naba-lens.example", "sec-fetch-site": "cross-site" },
      { host: "naba-lens.example", "sec-fetch-site": "same-site" },
    ] as Record<string, string>[]) {
      const input = request(headers)
      const readBody = vi.spyOn(input, "formData")
      const response = await POST(input, {
        params: Promise.resolve({ id: staffId }),
      })
      expect(response.status).toBe(403)
      expect(readBody).not.toHaveBeenCalled()
    }
    expect(authorize).not.toHaveBeenCalled()
    expect(accountsContext).not.toHaveBeenCalled()
    expect(replaceProfileAvatar).not.toHaveBeenCalled()
  })
})
