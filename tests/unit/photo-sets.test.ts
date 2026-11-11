// The Add queue's set engine (B02-05): a set starts once two of its photos
// are reserved, takes each photo as it is reserved, retries quietly, and
// never does anything an upload waits on.
import { describe, expect, it, vi, type Mock } from "vitest"

import {
  PhotoSets,
  type SetKeyStore,
  type SetTransport,
} from "@/components/nabalens/shell/photo-sets"

const DISH = { kind: "menu_item" as const, id: "item-1", name: "Lamb tikka" }

function keys(): SetKeyStore & { settled: string[]; issued: string[] } {
  const known = new Map<string, string>()
  const store = {
    settled: [] as string[],
    issued: [] as string[],
    keyFor(scope: string) {
      const key = known.get(scope) ?? `key-${known.size + 1}-abcdef`
      known.set(scope, key)
      store.issued.push(key)
      return key
    },
    settle(scope: string) {
      known.delete(scope)
      store.settled.push(scope)
    },
  }
  return store
}

function transport(over: { start?: Mock<SetTransport["start"]> } = {}) {
  return {
    start: vi.fn<SetTransport["start"]>(async () => ({
      status: "ok",
      groupId: "group-1",
    })),
    add: vi.fn<SetTransport["add"]>(async (input) => ({
      status: "ok",
      members: input.assetIds.length,
    })),
    ...over,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("PhotoSets", () => {
  it("leaves a single photo alone and groups from the second", async () => {
    const t = transport()
    const k = keys()
    const sets = new PhotoSets(t, k)
    const set = sets.open(DISH)
    sets.reserved(set, "a1")
    await flush()
    expect(t.start).not.toHaveBeenCalled()
    sets.reserved(set, "a2")
    await flush()
    expect(t.start).toHaveBeenCalledWith({
      key: "key-1-abcdef",
      subject: { kind: "menu_item", id: "item-1" },
    })
    expect(t.add).toHaveBeenCalledWith({
      groupId: "group-1",
      assetIds: ["a1", "a2"],
    })
    // The start was answered: its key is not kept.
    expect(k.settled).toEqual(["menu_item:item-1:a1"])
    // "Add more to this set": the same group.
    sets.reserved(set, "a3")
    await flush()
    expect(t.start).toHaveBeenCalledTimes(1)
    expect(t.add).toHaveBeenLastCalledWith({
      groupId: "group-1",
      assetIds: ["a3"],
    })
    expect(sets.groupOf(set)).toEqual({
      groupId: "group-1",
      assetIds: ["a1", "a2", "a3"],
    })
  })

  it("takes at most 10 photos", async () => {
    const t = transport()
    const sets = new PhotoSets(t, keys())
    const set = sets.open(DISH)
    for (let i = 1; i <= 12; i++) sets.reserved(set, `a${i}`)
    await flush()
    await flush()
    const added = t.add.mock.calls.flatMap(([input]) => input.assetIds)
    expect(added).toHaveLength(10)
    expect(added).not.toContain("a11")
  })

  it("retries quietly with the same key, then gives up", async () => {
    const waits: number[] = []
    const runs: (() => void)[] = []
    const t = transport({
      start: vi.fn<SetTransport["start"]>(async () => {
        throw new Error("network")
      }),
    })
    const k = keys()
    const sets = new PhotoSets(t, k, {
      delays: [10, 20],
      later: (run, ms) => {
        waits.push(ms)
        runs.push(run)
      },
    })
    const set = sets.open(DISH)
    sets.reserved(set, "a1")
    sets.reserved(set, "a2")
    await flush()
    runs.shift()!()
    await flush()
    runs.shift()!()
    await flush()
    expect(waits).toEqual([10, 20])
    expect(t.start).toHaveBeenCalledTimes(3)
    expect(new Set(k.issued)).toEqual(new Set(["key-1-abcdef"]))
    expect(runs).toHaveLength(0)
    expect(sets.groupOf(set)).toBeNull()
  })

  it("stops for good on a refusal, and turns sets off when missing", async () => {
    const refused = transport({
      start: vi.fn<SetTransport["start"]>(async () => ({
        status: "failed",
        retry: false,
      })),
    })
    const later = vi.fn()
    const one = new PhotoSets(refused, keys(), { later })
    const set = one.open(DISH)
    one.reserved(set, "a1")
    one.reserved(set, "a2")
    await flush()
    one.reserved(set, "a3")
    await flush()
    expect(refused.start).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()

    const onMissing = vi.fn()
    const missing = transport({
      start: vi.fn<SetTransport["start"]>(async () => ({ status: "missing" })),
    })
    const two = new PhotoSets(missing, keys(), { onMissing })
    const first = two.open(DISH)
    two.reserved(first, "b1")
    two.reserved(first, "b2")
    await flush()
    const second = two.open({ kind: "task", id: "t1", name: "Bar" })
    two.reserved(second, "c1")
    two.reserved(second, "c2")
    await flush()
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(missing.start).toHaveBeenCalledTimes(1)
  })
})
