// B05-01: the set engine's live cap, its read of the set for the
// acknowledgement, and replacing a photo that didn't finish.
import { describe, expect, it, vi } from "vitest"

import {
  PhotoSets,
  type SetKeyStore,
  type SetTransport,
} from "@/components/nabalens/shell/photo-sets"
import type { ContributionGroupView } from "@/lib/knowledge/contract"

const DISH = { kind: "menu_item" as const, id: "item-1", name: "Tandoori" }

const keys = (): SetKeyStore => ({
  keyFor: (scope) => `key-${scope}`,
  settle: () => {},
})

const VIEW = {
  groupId: "group-1",
  venueId: "venue-1",
  createdAt: "2026-11-12T10:00:00Z",
  mine: true,
  subject: { kind: "menu_item", id: "item-1", name: "Tandoori" },
  members: [],
} satisfies ContributionGroupView

function transport(over: Partial<SetTransport> = {}) {
  const base = {
    start: vi.fn<SetTransport["start"]>(async () => ({
      status: "ok",
      groupId: "group-1",
    })),
    add: vi.fn<NonNullable<SetTransport["add"]>>(async (input) => ({
      status: "ok",
      members: input.assetIds.length,
    })),
    read: vi.fn<NonNullable<SetTransport["read"]>>(async () => ({
      status: "ok",
      group: VIEW,
    })),
    replace: vi.fn<NonNullable<SetTransport["replace"]>>(async (input) => ({
      status: "ok",
      groupId: input.groupId,
      assetId: input.newAssetId,
      replacesAssetId: input.failedAssetId,
      position: 4,
    })),
  }
  // Overrides keep the mocks' types: every override here is a vi.fn.
  return Object.assign(base, over) as typeof base
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}
const added = (t: ReturnType<typeof transport>) =>
  t.add.mock.calls.flatMap(([input]) => input.assetIds)

describe("the live cap (B05-01c)", () => {
  it("lets a failed photo's place go to another, up to 10 live", async () => {
    const t = transport()
    const sets = new PhotoSets(t, keys())
    const set = sets.open(DISH)
    for (let i = 1; i <= 10; i++) sets.reserved(set, `a${i}`)
    await flush()
    // Total 10, live 10: the 11th waits for room.
    sets.reserved(set, "a11")
    await flush()
    expect(added(t)).not.toContain("a11")
    // The server failed a3: it stays a member, but no longer counts.
    sets.serverFailed(set, "a3")
    sets.reserved(set, "a12")
    await flush()
    expect(added(t)).toContain("a12")
    expect(added(t)).toHaveLength(11)
    sets.reserved(set, "a13")
    await flush()
    expect(added(t)).not.toContain("a13")
    // a3 retried and finished: it counts again, so still no room.
    sets.finished(set, "a3")
    sets.serverFailed(set, "a4")
    sets.finished(set, "a4")
    sets.reserved(set, "a14")
    await flush()
    expect(added(t)).toHaveLength(11)
  })

  it("never passes 30 positions, and sends at most 10 a call", async () => {
    const t = transport()
    const sets = new PhotoSets(t, keys())
    const set = sets.open(DISH)
    for (let i = 1; i <= 40; i++) {
      sets.reserved(set, `a${i}`)
      // Every photo failed on the server: none of them is live.
      sets.serverFailed(set, `a${i}`)
    }
    await flush()
    expect(added(t)).toHaveLength(30)
    for (const [input] of t.add.mock.calls)
      expect(input.assetIds.length).toBeLessThanOrEqual(10)
  })
})

describe("reading the set (B05-01e)", () => {
  it("reads once every photo has joined, and not without a group", async () => {
    const t = transport()
    const sets = new PhotoSets(t, keys())
    const set = sets.open(DISH)
    sets.reserved(set, "a1")
    // One photo: no group yet, so the screen words it itself.
    expect(await sets.read(set)).toBeNull()
    expect(t.read).not.toHaveBeenCalled()
    sets.reserved(set, "a2")
    // The read waits for the join on its way.
    expect(await sets.read(set)).toEqual(VIEW)
    expect(t.read).toHaveBeenCalledWith({ groupId: "group-1" })
    expect(added(t)).toEqual(["a1", "a2"])
  })

  it("waits for a photo reserved while an earlier join was still running", async () => {
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    const t = transport()
    const join = t.add.getMockImplementation()!
    t.add.mockImplementationOnce(async (input) => {
      await slow
      return join(input)
    })
    const sets = new PhotoSets(t, keys())
    const set = sets.open(DISH)
    sets.reserved(set, "a1")
    sets.reserved(set, "a2")
    await flush()
    // Reserved while the first join runs: it joins after it.
    sets.reserved(set, "a3")
    const read = sets.read(set)
    await flush()
    expect(t.read).not.toHaveBeenCalled()
    release()
    expect(await read).toEqual(VIEW)
    expect(added(t)).toEqual(["a1", "a2", "a3"])
    // The read went out after a3 joined.
    expect(t.read.mock.invocationCallOrder[0]).toBeGreaterThan(
      t.add.mock.invocationCallOrder[1]!
    )
  })

  it("is null when a photo never joined, or the read failed", async () => {
    const refused = transport({
      add: vi.fn(async () => ({ status: "failed" as const, retry: false })),
    })
    const one = new PhotoSets(refused, keys())
    const set = one.open(DISH)
    one.reserved(set, "a1")
    one.reserved(set, "a2")
    await flush()
    expect(await one.read(set)).toBeNull()

    const failing = transport({
      read: vi.fn(async () => ({ status: "failed" as const, retry: true })),
    })
    const two = new PhotoSets(failing, keys())
    const other = two.open(DISH)
    two.reserved(other, "b1")
    two.reserved(other, "b2")
    await flush()
    expect(await two.read(other)).toBeNull()
    failing.read.mockRejectedValueOnce(new Error("network"))
    expect(await two.read(other)).toBeNull()
  })
})

describe("replacing a photo (B05-01d)", () => {
  async function grouped(t: ReturnType<typeof transport>, opts = {}) {
    const sets = new PhotoSets(t, keys(), opts)
    const set = sets.open(DISH)
    for (const id of ["a1", "a2", "bad"]) sets.reserved(set, id)
    await flush()
    return { sets, set }
  }

  it("swaps the new photo in for the failed one instead of adding it", async () => {
    const t = transport()
    const { sets, set } = await grouped(t)
    expect(await sets.replace(set, "bad", "new")).toEqual({
      status: "replaced",
    })
    expect(t.replace).toHaveBeenCalledWith({
      groupId: "group-1",
      failedAssetId: "bad",
      newAssetId: "new",
    })
    expect(added(t)).not.toContain("new")
    expect(sets.isMember(set, "new")).toBe(true)
    expect(sets.groupOf(set)?.assetIds).toContain("new")
    // The replaced photo no longer counts: room for 7 more, not 6.
    for (let i = 1; i <= 9; i++) sets.reserved(set, `m${i}`)
    await flush()
    expect(added(t).filter((id) => id.startsWith("m"))).toHaveLength(7)
  })

  it("treats the same photo picked again as no replacement", async () => {
    const t = transport()
    const { sets, set } = await grouped(t)
    expect(await sets.replace(set, "bad", "bad")).toEqual({ status: "same" })
    expect(t.replace).not.toHaveBeenCalled()
  })

  it("passes a refusal on with its reason, and retries what may work later", async () => {
    const refusal = {
      code: "asset_ineligible" as const,
      message: "x",
      reason: "not_replaceable" as const,
      assetId: "bad",
    }
    const t = transport({
      replace: vi.fn(async () => ({
        status: "failed" as const,
        retry: false,
        refusal,
      })),
    })
    const { sets, set } = await grouped(t)
    expect(await sets.replace(set, "bad", "new")).toEqual({
      status: "refused",
      refusal,
    })
    expect(sets.isMember(set, "new")).toBe(false)

    const waits: number[] = []
    const flaky = transport()
    flaky.replace
      .mockResolvedValueOnce({ status: "failed", retry: true })
      .mockRejectedValueOnce(new Error("network"))
    const again = await grouped(flaky, {
      delays: [5, 10],
      later: (run: () => void, ms: number) => {
        waits.push(ms)
        run()
      },
    })
    expect(await again.sets.replace(again.set, "bad", "new")).toEqual({
      status: "replaced",
    })
    expect(waits).toEqual([5, 10])

    const down = transport({
      replace: vi.fn(async () => ({ status: "failed" as const, retry: true })),
    })
    const gone = await grouped(down, {
      delays: [1],
      later: (run: () => void) => run(),
    })
    expect(await gone.sets.replace(gone.set, "bad", "new")).toEqual({
      status: "unavailable",
    })
    expect(down.replace).toHaveBeenCalledTimes(2)
  })

  it("is unavailable without a group or before B05-m5", async () => {
    const t = transport()
    const sets = new PhotoSets(t, keys())
    const set = sets.open(DISH)
    sets.reserved(set, "a1")
    expect(await sets.replace(set, "a1", "new")).toEqual({
      status: "unavailable",
    })
    const missing = transport({
      replace: vi.fn(async () => ({ status: "missing" as const })),
    })
    const { sets: s2, set: g2 } = await grouped(missing)
    expect(await s2.replace(g2, "bad", "new")).toEqual({
      status: "unavailable",
    })
  })
})
