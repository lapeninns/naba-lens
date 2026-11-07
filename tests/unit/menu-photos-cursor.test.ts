import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { eventsCursor, itemsCursor, queueCursor } =
  await import("@/lib/server/menu-photos/cursor")

const ID = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const raw = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

describe("menu photo cursors", () => {
  it("round-trips items/queue/events cursors", () => {
    const items = { section: 2, entry: 0, itemId: ID }
    expect(itemsCursor.decode(itemsCursor.encode(items))).toEqual(items)
    const queue = { createdAt: "2026-11-07T10:00:00.123456+00:00", key: ID }
    expect(queueCursor.decode(queueCursor.encode(queue))).toEqual(queue)
    expect(eventsCursor.decode(eventsCursor.encode({ before: 42 }))).toEqual({
      before: 42,
    })
  })

  it("rejects tampered cursor", () => {
    for (const bad of [
      "",
      "not base64!",
      raw({ a: 1 }),
      raw([1, 2]),
      raw([-1, 0, ID]),
      raw([1.5, 0, ID]),
      raw([1, 0, "x"]),
      raw([1, 0, ID, "extra"]),
    ])
      expect(itemsCursor.decode(bad), bad).toBeNull()
    for (const bad of [
      raw(["yesterday", ID]),
      raw(["2026-11-07T10:00:00Z", "1; drop table"]),
      raw(["2026-13-45T99:00:00Z", ID]),
      raw([ID]),
    ])
      expect(queueCursor.decode(bad), bad).toBeNull()
    for (const bad of [raw([0]), raw(["5"]), raw([1.2]), raw([1, 2])])
      expect(eventsCursor.decode(bad), bad).toBeNull()
  })
})
