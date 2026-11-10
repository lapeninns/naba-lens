import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const server = vi.hoisted(() => ({
  knowledgeRpcFailure: vi.fn(() => ({
    ok: false,
    code: "unavailable",
    status: 503,
    message: "failed",
  })),
}))
vi.mock("@/lib/server/knowledge", () => server)
const rpc = vi.hoisted(() => ({ knowledgeRpc: vi.fn() }))
vi.mock("@/lib/server/knowledge/rpc", () => rpc)

import type {
  ContributionsFeedItem,
  FeedFindingItem,
  FeedPhotoItem,
  FeedTaskSendItem,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"
import { contributionRows } from "@/lib/work-client/contributions"
import { parseContributionsPage } from "@/lib/work-client/parse"
import { workServices } from "@/lib/work-client/services"
import { mergeByWaiting, reviewKindOf } from "@/lib/work-client/triage"

const actor = { db: {} } as MediaActor

function photo(over: Partial<FeedPhotoItem> = {}): FeedPhotoItem {
  return {
    type: "photo",
    key: "p:a1",
    at: "2026-11-06T10:00:00.000Z",
    assetId: "a1",
    venueId: "v1",
    venueName: "TEST Inn",
    mediaType: "image",
    uploadState: "ready",
    sentAt: "2026-11-06T10:00:00.000Z",
    labels: { hasLabels: true, needsLabels: false, needsAttention: false },
    menuDecisions: [],
    menuUseAccepted: false,
    ...over,
  }
}

function taskSend(over: Partial<FeedTaskSendItem> = {}): FeedTaskSendItem {
  return {
    type: "task_send",
    key: "t:s1",
    at: "2026-11-05T10:00:00.000Z",
    itemId: "s1",
    submissionId: "sub1",
    requirementId: "r1",
    requirementTitle: "Bar at opening",
    venueId: "v1",
    venueName: "TEST Inn",
    assetId: "a9",
    assetAvailable: true,
    state: "submitted",
    reason: null,
    decidedAt: null,
    archived: false,
    sentAt: "2026-11-05T10:00:00.000Z",
    replacesItemId: null,
    replacesSentAt: null,
    revision: 1,
    ...over,
  }
}

function finding(over: Partial<FeedFindingItem> = {}): FeedFindingItem {
  return {
    type: "finding",
    key: "f:1",
    at: "2026-11-04T10:00:00.000Z",
    findingRef: { type: "contribution", id: "f1" },
    checkId: "c1",
    venueId: "v1",
    venueName: "TEST Inn",
    questionKey: "parking",
    question: "Is there parking on site?",
    kind: "finding",
    answer: "yes",
    sentAt: "2026-11-04T10:00:00.000Z",
    state: "current",
    recognition: { kind: "pending" },
    ...over,
  } as FeedFindingItem
}

beforeEach(() => vi.clearAllMocks())

describe("parseContributionsPage (R5)", () => {
  it("keeps the server's order and cursor, and drops a type it doesn't know", () => {
    const page = parseContributionsPage({
      items: [
        photo(),
        { type: "survey", key: "x", at: "2026-11-06T09:00:00.000Z" },
        taskSend(),
        finding(),
      ],
      nextCursor: "opaque",
    })
    expect(page?.items.map((i) => i.key)).toEqual(["p:a1", "t:s1", "f:1"])
    expect(page?.nextCursor).toBe("opaque")
  })

  it("is unreadable when a known row is missing what the screen words", () => {
    expect(
      parseContributionsPage({
        items: [{ ...photo(), uploadState: "lost" }],
        nextCursor: null,
      })
    ).toBeNull()
    expect(parseContributionsPage({ items: "no", nextCursor: null })).toBeNull()
    expect(parseContributionsPage({ items: [], nextCursor: 3 })).toBeNull()
  })
})

describe("contributionRows (§6.1)", () => {
  it("gives a photo one field per dimension", () => {
    const [saving] = contributionRows([
      photo({
        uploadState: "processing",
        labels: { hasLabels: false, needsLabels: true, needsAttention: false },
      }),
    ])
    expect(saving).toMatchObject({
      upload: "saving",
      labels: "needs_labels",
      items: [],
      reviews: [],
      menuUseAccepted: false,
    })
    const [failed] = contributionRows([
      photo({
        uploadState: "failed",
        labels: { hasLabels: true, needsLabels: false, needsAttention: true },
      }),
    ])
    expect(failed).toMatchObject({
      upload: "not_finished",
      labels: "needs_attention",
    })
  })

  it("names a photo after its menu items, one review line per decision, and never a revision", () => {
    const decision = {
      photoId: "ph1",
      itemId: "i1",
      itemName: "Fish pie",
      variantName: null,
      state: "accepted" as const,
      reason: null,
      decidedAt: "2026-11-06T12:00:00.000Z",
    }
    const [row] = contributionRows([
      photo({
        menuDecisions: [
          decision,
          {
            ...decision,
            photoId: "ph2",
            itemId: "i2",
            itemName: "Burger",
            variantName: "Large",
            state: "better_photo_requested",
            reason: "Too dark",
          },
        ],
        menuUseAccepted: true,
      }),
    ])
    expect(row).toMatchObject({
      type: "photo",
      items: ["Fish pie", "Burger"],
      menuUseAccepted: true,
      reviews: [
        { item: "Fish pie", state: "accepted", offMenu: false },
        {
          item: "Burger (Large)",
          state: "better_photo_requested",
          reason: "Too dark",
          offMenu: false,
        },
      ],
    })
    expect(row).not.toHaveProperty("revision")
  })

  it("marks a better-photo request for an item off the menu (D13)", () => {
    const [row] = contributionRows(
      [
        photo({
          menuDecisions: [
            {
              photoId: "ph1",
              itemId: "i1",
              itemName: "Fish pie",
              variantName: null,
              state: "better_photo_requested",
              reason: "Blurred",
              decidedAt: "2026-11-06T12:00:00.000Z",
            },
          ],
        }),
      ],
      new Set(["ph1"])
    )
    expect(row.type === "photo" && row.reviews[0].offMenu).toBe(true)
  })

  it("gives a task send a revision only when it replaced an earlier send", () => {
    const [first, second] = contributionRows([
      taskSend(),
      taskSend({
        key: "t:s2",
        state: "needs_another_photo",
        reason: "Show the whole bar",
        revision: 2,
        replacesSentAt: "2026-11-01T10:00:00.000Z",
      }),
    ])
    expect(first).toMatchObject({ review: "waiting", revision: null })
    expect(second).toMatchObject({
      review: "needs_another_photo",
      reason: "Show the whole bar",
      revision: { number: 2, replacesSentAt: "2026-11-01T10:00:00.000Z" },
    })
  })

  it("reuses B01's finding rows and says which earlier finding was replaced, without a number", () => {
    const rows = contributionRows([
      finding({ key: "f:2", findingRef: { type: "contribution", id: "f2" } }),
      finding({
        key: "f:1",
        state: "no_longer_used",
        stateReason: "replaced_by_own",
        sentAt: "2026-11-01T08:00:00.000Z",
      }),
      {
        type: "assignment_closed",
        key: "a:1",
        at: "2026-10-01T10:00:00.000Z",
        kind: "assignment_closed",
        state: "assignment_closed",
        checkId: "c9",
        venueId: "v1",
        questionKey: "wifi",
        question: "Is there Wi-Fi?",
        answeredBy: "Sam",
        sentAt: "2026-10-01T10:00:00.000Z",
      },
    ] as ContributionsFeedItem[])
    expect(rows[0]).toMatchObject({
      type: "finding",
      replacedEarlierAt: "2026-11-01T08:00:00.000Z",
    })
    expect(rows[1]).toMatchObject({ replacedEarlierAt: null })
    expect(rows[1].type === "finding" && rows[1].finding.noLongerUsed).toBe(
      "replaced_by_own"
    )
    // A closed assignment borrows its venue's name from another row.
    expect(rows[2].type === "finding" && rows[2].finding.venue.name).toBe(
      "TEST Inn"
    )
  })

  it("never re-sorts: rows follow the server's order", () => {
    const rows = contributionRows([
      finding({ key: "f:old", at: "2026-01-01T00:00:00.000Z" }),
      photo({ key: "p:new", at: "2026-11-09T00:00:00.000Z" }),
    ])
    expect(rows.map((r) => r.key)).toEqual(["f:old", "p:new"])
  })
})

describe("workServices.getContributions", () => {
  it("reads 20 a page with the server's cursor", async () => {
    rpc.knowledgeRpc.mockResolvedValue({
      data: { items: [photo()], nextCursor: "next" },
      error: null,
    })
    const result = await workServices.getContributions(actor, "abc")
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "my_contributions_feed",
      { p_cursor: "abc", p_limit: 20 }
    )
    expect(result).toMatchObject({
      status: "ok",
      value: { nextCursor: "next" },
    })
  })

  it("is missing before the B02 migrations, so Me keeps B01", async () => {
    rpc.knowledgeRpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function does not exist" },
    })
    expect(await workServices.getContributions(actor)).toEqual({
      status: "missing",
    })
  })

  it("fails an unreadable page and any other error", async () => {
    rpc.knowledgeRpc.mockResolvedValueOnce({ data: { items: 1 }, error: null })
    expect(await workServices.getContributions(actor)).toMatchObject({
      status: "failed",
    })
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "denied" },
    })
    expect(await workServices.getContributions(actor)).toMatchObject({
      status: "failed",
    })
    expect(server.knowledgeRpcFailure).toHaveBeenCalled()
  })
})

describe("Review kind filter (§6.2)", () => {
  it("defaults to Photos", () => {
    expect(reviewKindOf(undefined)).toBe("photos")
    expect(reviewKindOf("findings")).toBe("findings")
    expect(reviewKindOf("all")).toBe("all")
    expect(reviewKindOf(["all"])).toBe("photos")
  })

  const at = (x: { at: string | null }) => x.at

  it("All interleaves by waiting time without re-sorting either queue", () => {
    const photos = [
      { id: "p1", at: "2026-11-01T10:00:00.000Z" },
      { id: "p2", at: "2026-11-03T10:00:00.000Z" },
    ]
    // The server's findings order (R4) is kept even where its times aren't
    // ascending.
    const findings = [
      { id: "f1", at: "2026-11-02T10:00:00.000Z" },
      { id: "f2", at: "2026-11-04T10:00:00.000Z" },
      { id: "f3", at: "2026-11-03T12:00:00.000Z" },
    ]
    const { entries, heldBack } = mergeByWaiting(
      photos,
      at,
      findings,
      at,
      false
    )
    expect(entries.map((e) => e.value.id)).toEqual([
      "p1",
      "f1",
      "p2",
      "f2",
      "f3",
    ])
    expect(heldBack).toBe(0)
  })

  it("holds back findings newer than the last photo read when more photos wait", () => {
    const { entries, heldBack } = mergeByWaiting(
      [{ id: "p1", at: "2026-11-01T10:00:00.000Z" }],
      at,
      [
        { id: "f1", at: "2026-10-30T10:00:00.000Z" },
        { id: "f2", at: "2026-11-05T10:00:00.000Z" },
      ],
      at,
      true
    )
    expect(entries.map((e) => e.value.id)).toEqual(["f1", "p1"])
    expect(heldBack).toBe(1)
  })
})

describe("R5 waiting review lines (§6.1)", () => {
  const decided = {
    photoId: "ph1",
    itemId: "i1",
    itemName: "Fish pie",
    variantName: null,
    state: "accepted" as const,
    reason: null,
    decidedAt: "2026-11-06T12:00:00.000Z",
  }
  const waiting = {
    photoId: null,
    itemId: "i2",
    itemName: "Burger",
    variantName: "Large",
    state: "waiting" as const,
    reason: null,
    decidedAt: null,
  }

  it("reads a labelled item still waiting, and refuses mixed shapes", () => {
    const ok = parseContributionsPage({
      items: [photo({ menuDecisions: [decided, waiting] })],
      nextCursor: null,
    })
    expect(ok?.items).toHaveLength(1)
    for (const bad of [
      { ...waiting, photoId: "ph9" },
      { ...decided, photoId: null },
      { ...waiting, itemId: undefined },
    ])
      expect(
        parseContributionsPage({
          items: [photo({ menuDecisions: [bad as never] })],
          nextCursor: null,
        })
      ).toBeNull()
  })

  it("gives the waiting item its own line, never off the menu", () => {
    const [row] = contributionRows(
      [photo({ menuDecisions: [decided, waiting] })],
      new Set(["ph1"])
    )
    expect(row).toMatchObject({
      items: ["Fish pie", "Burger"],
      reviews: [
        { item: "Fish pie", state: "accepted", photoId: "ph1" },
        {
          item: "Burger (Large)",
          state: "waiting",
          photoId: null,
          offMenu: false,
        },
      ],
    })
    if (row.type !== "photo") throw new Error("photo row")
    expect(new Set(row.reviews.map((line) => line.key)).size).toBe(2)
  })

  it("matches a renamed item by its id, not its name", () => {
    // The decided row keeps the name at decision time; the waiting row (a
    // second variant of the same item) has the current name.
    const [row] = contributionRows([
      photo({
        menuDecisions: [
          { ...decided, itemName: "Fish pie" },
          { ...waiting, itemId: "i1", itemName: "Fisherman's pie" },
          { ...waiting, itemId: "i3", itemName: "Fish pie" },
        ],
      }),
    ])
    expect(row.type === "photo" && row.items).toEqual(["Fish pie", "Fish pie"])
    expect(row.type === "photo" && row.reviews.map((l) => l.itemId)).toEqual([
      "i1",
      "i1",
      "i3",
    ])
  })
})
