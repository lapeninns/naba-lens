// B05-m5 group summary (OD-B5-01-2): the pure TypeScript mirror of
// contribution_group's summary, over every mix of member states, removed and
// replaced members included.
import { describe, expect, it } from "vitest"

import {
  GROUP_MEMBER_TECHNICAL,
  type GroupMemberTechnical,
} from "@/lib/knowledge/contract"
import {
  summariseGroup,
  type SummaryMember,
} from "@/lib/work-client/group-summary"

const KINDS: SummaryMember[] = GROUP_MEMBER_TECHNICAL.flatMap((technical) => [
  { technical, replaced: false },
  { technical, replaced: true },
])

/** Every multiset of member kinds up to `size` members. */
function mixes(size: number): SummaryMember[][] {
  const out: SummaryMember[][] = [[]]
  const grow = (prefix: SummaryMember[], from: number) => {
    if (prefix.length === size) return
    for (let i = from; i < KINDS.length; i++) {
      const next = [...prefix, KINDS[i]!]
      out.push(next)
      grow(next, i)
    }
  }
  grow([], 0)
  return out
}

const m = (
  technical: GroupMemberTechnical,
  replaced = false
): SummaryMember => ({ technical, replaced })

describe("group summary (OD-B5-01-2)", () => {
  it("reads the tandoor set: two ready, one failed, then replaced and ready", () => {
    expect(summariseGroup([m("ready"), m("ready"), m("failed")])).toEqual({
      live: 3,
      ready: 2,
      inProgress: 0,
      failed: 1,
      removed: 0,
      replaced: 0,
      finished: false,
    })
    expect(
      summariseGroup([
        m("ready"),
        m("ready"),
        m("failed", true),
        m("uploading"),
      ])
    ).toEqual({
      live: 3,
      ready: 2,
      inProgress: 1,
      failed: 0,
      removed: 0,
      replaced: 1,
      finished: false,
    })
    expect(
      summariseGroup([m("ready"), m("ready"), m("failed", true), m("ready")])
    ).toEqual({
      live: 3,
      ready: 3,
      inProgress: 0,
      failed: 0,
      removed: 0,
      replaced: 1,
      finished: true,
    })
  })

  it("leaves removed members out of the denominator and is never finished when empty", () => {
    expect(summariseGroup([m("ready"), m("removed")])).toMatchObject({
      live: 1,
      removed: 1,
      finished: true,
    })
    expect(summariseGroup([m("removed")])).toMatchObject({
      live: 0,
      finished: false,
    })
    expect(summariseGroup([])).toEqual({
      live: 0,
      ready: 0,
      inProgress: 0,
      failed: 0,
      removed: 0,
      replaced: 0,
      finished: false,
    })
  })

  it("holds the bucket rules over every mix of up to four members", () => {
    const all = mixes(4)
    // 10 kinds: 1 + 10 + 55 + 220 + 715 multisets.
    expect(all).toHaveLength(1001)
    for (const mix of all) {
      const s = summariseGroup(mix)
      const label = JSON.stringify(mix)
      const plain = mix.filter((x) => !x.replaced)
      const n = (t: GroupMemberTechnical) =>
        plain.filter((x) => x.technical === t).length
      // Each member is in exactly one bucket.
      expect(
        s.ready + s.inProgress + s.failed + s.removed + s.replaced,
        label
      ).toBe(mix.length)
      expect(s.replaced, label).toBe(mix.length - plain.length)
      expect(s.ready, label).toBe(n("ready"))
      expect(s.failed, label).toBe(n("failed"))
      expect(s.removed, label).toBe(n("removed"))
      // A stopped upload is still uploading: in progress.
      expect(s.inProgress, label).toBe(n("uploading") + n("processing"))
      expect(s.live, label).toBe(s.ready + s.inProgress + s.failed)
      // Finished only when every live member is ready (§1.10.4).
      expect(s.finished, label).toBe(s.live > 0 && s.ready === s.live)
      if (s.inProgress > 0 || s.failed > 0)
        expect(s.finished, label).toBe(false)
      // A replaced member changes nothing but `replaced`, whatever its state,
      // ready included (it never counts again).
      for (const t of GROUP_MEMBER_TECHNICAL)
        expect(summariseGroup([...mix, m(t, true)]), label).toEqual({
          ...s,
          replaced: s.replaced + 1,
        })
      // Order does not matter.
      expect(summariseGroup([...mix].reverse()), label).toEqual(s)
    }
  })
})
