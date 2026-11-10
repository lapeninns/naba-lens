import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/lifecycle/remove", () => ({ removeMediaAsset: vi.fn() }))
const auth = vi.hoisted(() => ({ getMediaActor: vi.fn() }))
vi.mock("@/lib/server/media/context", () => auth)
const work = vi.hoisted(() => ({ getDeleteImpact: vi.fn() }))
vi.mock("@/lib/work-client/services", () => ({ workServices: work }))

import { readDeleteEvidence } from "@/app/_media/actions"

const ASSET = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const actor = { profile: { id: "me" } }

beforeEach(() => {
  auth.getMediaActor.mockReset()
  work.getDeleteImpact.mockReset()
  auth.getMediaActor.mockResolvedValue({ ok: true, actor })
})

describe("readDeleteEvidence (HM-04)", () => {
  it("reads as the signed-in staff member and passes the impact on", async () => {
    const impact = { status: "known", items: [] }
    work.getDeleteImpact.mockResolvedValue({ status: "ok", value: impact })
    expect(await readDeleteEvidence(ASSET)).toEqual({ status: "ok", impact })
    expect(auth.getMediaActor).toHaveBeenCalledWith("staff")
    expect(work.getDeleteImpact).toHaveBeenCalledWith(actor, ASSET)
  })

  it("passes on a database that predates B02", async () => {
    work.getDeleteImpact.mockResolvedValue({ status: "missing" })
    expect(await readDeleteEvidence(ASSET)).toEqual({ status: "missing" })
  })

  it("keeps the failure's details on the server", async () => {
    work.getDeleteImpact.mockResolvedValue({
      status: "failed",
      failure: { ok: false, code: "unavailable", status: 503, message: "x" },
    })
    expect(await readDeleteEvidence(ASSET)).toEqual({ status: "failed" })
  })

  it("reads nothing for someone who isn't active staff", async () => {
    auth.getMediaActor.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Your account is not active.",
    })
    expect(await readDeleteEvidence(ASSET)).toEqual({ status: "failed" })
    expect(work.getDeleteImpact).not.toHaveBeenCalled()
  })

  it("refuses a non-string id", async () => {
    expect(await readDeleteEvidence(1 as never)).toEqual({ status: "failed" })
    expect(auth.getMediaActor).not.toHaveBeenCalled()
  })
})
