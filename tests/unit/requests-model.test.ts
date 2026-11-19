// S2-REQ requests and shot lists: the pure model (lib/requests/model.ts) and
// the server module's mapping onto the shared error shape
// (lib/server/requests). Spec §7 M4; FA-5; DESIGN.md §7.
import { describe, expect, it, vi } from "vitest"

import {
  checkRequestDraft,
  countRequests,
  defaultTypeForSlot,
  filterRequests,
  managerDateWords,
  parseRequestDetail,
  parseRequestList,
  parseStaffRequests,
  requestChip,
  shortDate,
  staffDateWords,
  staffRequestExtras,
  type RequestDraft,
} from "@/lib/requests/model"
import {
  closeRequest,
  createManagerRequest,
  listMyRequests,
  listRequests,
  requestError,
} from "@/lib/server/requests"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import { notificationWords } from "@/lib/ops/notifications"

vi.mock("server-only", () => ({}))

const ID = "11111111-1111-4111-8111-111111111111"
const SLOT = "22222222-2222-4222-8222-222222222222"

const rawRequest = (over: Record<string, unknown> = {}) => ({
  id: ID,
  type: "missing_photo",
  required: true,
  slot: {
    kind: "dish",
    slotId: SLOT,
    name: "Pie",
    category: "food",
    state: "missing",
    unavailable: false,
  },
  fact: null,
  subject: "Pie",
  brief: "Whole pie",
  intendedUse: "public",
  team: "boh",
  photoCount: 1,
  priority: "normal",
  assignee: null,
  date: "2026-11-30",
  dateKind: "needed_by",
  overdue: false,
  referenceAssetId: null,
  orientation: null,
  wantsVideo: false,
  captureWindow: null,
  shotListId: null,
  state: "open",
  blockedReason: null,
  retake: false,
  closedReason: null,
  closedAt: null,
  closedByRule: false,
  revision: 1,
  createdAt: "2026-11-18T10:00:00Z",
  createdBy: "Sam",
  ...over,
})

describe("parsing", () => {
  it("reads the manager list and drops malformed rows", () => {
    const list = parseRequestList({
      venueId: "v1",
      today: "2026-11-18",
      items: [rawRequest(), { id: ID, type: "nope" }, "junk"],
      shotLists: [
        {
          id: "l1",
          name: "Spring",
          purpose: "menu_launch",
          state: "open",
          total: 2,
          completed: 1,
          revision: 1,
        },
        { id: "l2", name: "Bad", purpose: "party", state: "open" },
      ],
      people: [
        { id: "p1", name: "Ann", role: "staff", team: "boh" },
        { id: "p2", name: "Odd", role: "admin" },
      ],
    })
    expect(list?.items).toHaveLength(1)
    expect(list?.items[0]).toMatchObject({
      subject: "Pie",
      slot: { kind: "dish", slotId: SLOT },
      dateKind: "needed_by",
    })
    expect(list?.shotLists.map((l) => l.id)).toEqual(["l1"])
    expect(list?.people.map((p) => p.id)).toEqual(["p1"])
  })

  it("refuses a shape without a venue or items", () => {
    expect(parseRequestList(null)).toBeNull()
    expect(parseRequestList({ items: [] })).toBeNull()
    expect(parseStaffRequests({ venueId: "v" })).toBeNull()
  })

  it("reads a detail's history and marks the rule's own closes", () => {
    const detail = parseRequestDetail({
      ...rawRequest({ state: "completed", closedByRule: true }),
      history: [
        { kind: "created", actor: "Sam", at: "2026-11-18T10:00:00Z" },
        {
          kind: "completed",
          actor: null,
          at: "2026-11-19T10:00:00Z",
          detail: { by: "rule" },
        },
      ],
    })
    expect(detail?.history.map((h) => [h.kind, h.byRule])).toEqual([
      ["created", false],
      ["completed", true],
    ])
  })

  it("reads the staff list without fact requests", () => {
    const list = parseStaffRequests({
      venueId: "v1",
      today: "2026-11-18",
      items: [
        {
          id: ID,
          type: "missing_photo",
          slot: {
            kind: "area",
            slotId: SLOT,
            name: "Garden",
            state: "missing",
          },
          subject: "Garden",
          brief: "From the gate",
          photoCount: 2,
          neededBy: "2026-11-20",
          wantsVideo: true,
          orientation: "landscape",
          forMe: true,
          state: "open",
        },
        {
          id: "x",
          type: "fact_confirmation",
          subject: "a",
          brief: "b",
          state: "open",
        },
      ],
    })
    expect(list?.items).toHaveLength(1)
    expect(staffRequestExtras(list!.items[0]!)).toEqual([
      "2 photos",
      "A short video too",
      "Landscape",
    ])
  })
})

describe("dates (FA-5, DESIGN.md §7)", () => {
  it("formats a short date", () => {
    expect(shortDate("2026-11-30")).toBe("30 Nov")
    expect(shortDate("soon")).toBe("soon")
  })

  it("never shows Overdue on a slot request", () => {
    expect(
      managerDateWords({
        date: "2026-11-01",
        dateKind: "needed_by",
        overdue: false,
      })
    ).toBe("Needed by 1 Nov")
    expect(
      managerDateWords({ date: "2026-11-01", dateKind: "due", overdue: true })
    ).toBe("Overdue: 1 Nov")
    expect(
      managerDateWords({ date: "2026-12-01", dateKind: "due", overdue: false })
    ).toBe("Due 1 Dec")
    expect(
      managerDateWords({ date: null, dateKind: null, overdue: false })
    ).toBeNull()
  })

  it("gives staff Needed by, then just Needed, never a due word", () => {
    expect(staffDateWords("2026-11-30", "2026-11-18")).toBe("Needed by 30 Nov")
    expect(staffDateWords("2026-11-10", "2026-11-18")).toBe("Needed")
    expect(staffDateWords(null, "2026-11-18")).toBeNull()
    for (const words of [
      staffDateWords("2026-11-30", "2026-11-18"),
      staffDateWords("2026-11-10", "2026-11-18"),
    ])
      expect(words).not.toMatch(/due|overdue/i)
  })
})

describe("the form's checks (M4-required-fields)", () => {
  const draft = (over: Partial<RequestDraft> = {}): RequestDraft => ({
    mode: "slot",
    type: "missing_photo",
    slotKind: "dish",
    slotId: SLOT,
    brief: "Whole pie",
    intendedUse: "public",
    photoCount: 1,
    priority: "normal",
    wantsVideo: false,
    ...over,
  })

  it("passes a complete slot request", () => {
    expect(checkRequestDraft(draft(), "2026-11-18")).toEqual({})
  })

  it("requires the slot, the brief and the use", () => {
    const errors = checkRequestDraft(
      draft({ slotId: null, brief: " ", intendedUse: "" }),
      "2026-11-18"
    )
    expect(Object.keys(errors).sort()).toEqual([
      "brief",
      "intendedUse",
      "slotId",
    ])
  })

  it("requires a subject for a New brief and refuses a replacement there", () => {
    const errors = checkRequestDraft(
      draft({ mode: "new", type: "replacement", slotId: null, subject: "" }),
      "2026-11-18"
    )
    expect(errors.subject).toBeDefined()
    expect(errors.type).toBeDefined()
  })

  it("lets a fact request go without a brief or use", () => {
    expect(
      checkRequestDraft(
        draft({
          mode: "fact",
          type: "fact_confirmation",
          slotId: null,
          factCheckId: SLOT,
          brief: "",
          intendedUse: "",
        }),
        "2026-11-18"
      )
    ).toEqual({})
  })

  it("checks limits, one line, the count and the date", () => {
    const errors = checkRequestDraft(
      draft({
        brief: "a\nb",
        photoCount: 21,
        date: "2026-11-01",
        captureWindow: "x".repeat(81),
      }),
      "2026-11-18"
    )
    expect(Object.keys(errors).sort()).toEqual([
      "brief",
      "captureWindow",
      "date",
      "photoCount",
    ])
    expect(
      checkRequestDraft(draft({ brief: "x".repeat(141) }), "2026-11-18").brief
    ).toMatch(/140/)
  })

  it("starts a covered slot as a replacement", () => {
    expect(defaultTypeForSlot("covered")).toBe("replacement")
    expect(defaultTypeForSlot("check_due")).toBe("replacement")
    expect(defaultTypeForSlot("missing")).toBe("missing_photo")
    expect(defaultTypeForSlot(null)).toBe("missing_photo")
  })
})

describe("lists and chips", () => {
  const items = parseRequestList({
    venueId: "v",
    items: [
      rawRequest(),
      rawRequest({ id: "b", state: "completed" }),
      rawRequest({ id: "c", state: "cancelled" }),
      rawRequest({ id: "d", state: "blocked" }),
    ],
  })!.items

  it("filters active and done requests", () => {
    expect(filterRequests(items, "active").map((r) => r.state)).toEqual([
      "open",
      "blocked",
    ])
    expect(filterRequests(items, "done")).toHaveLength(2)
    expect(filterRequests(items, "all")).toHaveLength(4)
    expect(countRequests(items)).toMatchObject({ open: 1, completed: 1 })
  })

  it("has a chip word for every state in the shared status chip", () => {
    for (const state of [
      "open",
      "submitted",
      "completed",
      "blocked",
      "cancelled",
    ] as const)
      expect(CHIP_STATES[requestChip(state)]).toBeDefined()
    expect(CHIP_STATES.request_completed.word).toBe("Completed")
  })
})

describe("server module", () => {
  function fakeDb(answer: {
    data?: unknown
    error?: { message: string; code: string }
  }) {
    const calls: Array<{ fn: string; args: unknown }> = []
    const db = {
      rpc: vi.fn(async (fn: string, args: unknown) => {
        calls.push({ fn, args })
        return { data: answer.data ?? null, error: answer.error ?? null }
      }),
    }
    return { db: db as never, calls }
  }

  it("maps database names onto fields and codes", () => {
    expect(
      requestError({ message: "brief_required", code: "22023" })
    ).toMatchObject({
      code: "invalid_input",
      field: "brief",
    })
    expect(
      requestError({ message: "assignee_cannot_verify", code: "22023" })
    ).toMatchObject({ field: "assigneeId" })
    expect(
      requestError({ message: "request_conflict", code: "P0001" }).code
    ).toBe("stale_version")
    expect(
      requestError({ message: "request_exists", code: "23505" }).code
    ).toBe("conflict")
    expect(
      requestError({ message: "completes_automatically", code: "P0001" })
        .message
    ).toMatch(/completes on its own/)
    expect(
      requestError({ message: "not_venue_manager", code: "42501" }).code
    ).toBe("forbidden")
    expect(
      requestError({ message: "not_active_user", code: "42501" }).code
    ).toBe("account_inactive")
  })

  it("refuses bad ids before calling the database", async () => {
    const { db, calls } = fakeDb({})
    expect(
      (
        await createManagerRequest(
          { db },
          { type: "missing_photo", slotKind: "dish", slotId: "nope" }
        )
      ).ok
    ).toBe(false)
    expect(
      (
        await closeRequest(
          { db },
          { requestId: "x", revision: 1, state: "cancelled" }
        )
      ).ok
    ).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it("sends a create with its defaults and reads the id back", async () => {
    const { db, calls } = fakeDb({ data: { id: ID, revision: 1 } })
    const out = await createManagerRequest(
      { db },
      {
        type: "campaign",
        subject: "Fire pit",
        brief: "Lit",
        intendedUse: "social",
      }
    )
    expect(out).toEqual({ ok: true, id: ID, revision: 1 })
    expect(calls[0]).toMatchObject({
      fn: "media_request_create",
      args: { p_type: "campaign", p_photo_count: 1, p_priority: "normal" },
    })
  })

  it("parses the reads and reports a bad shape as unavailable", async () => {
    const good = fakeDb({ data: { venueId: "v", items: [rawRequest()] } })
    const list = await listRequests({ db: good.db }, { includeClosed: true })
    expect(list.ok && list.list.items).toHaveLength(1)
    expect(good.calls[0]).toMatchObject({
      fn: "media_requests",
      args: { p_include_closed: true },
    })
    const bad = fakeDb({ data: { nope: true } })
    expect((await listMyRequests({ db: bad.db })).ok).toBe(false)
  })
})

describe("the assigned notice (S1-OPS inbox)", () => {
  const notice = (payload: Record<string, unknown>) => ({
    id: 1,
    kind: "assigned" as const,
    subjectType: "media_request",
    subjectId: ID,
    venueId: null,
    venueName: null,
    payload,
    createdAt: "2026-11-18T10:00:00Z",
    state: "unread" as const,
  })

  it("names the subject and the brief, with no due words", () => {
    const words = notificationWords(
      notice({ requestType: "missing_photo", subject: "Pie", brief: "Whole" })
    )
    expect(words).toEqual({ title: "Asked for: Pie", detail: "Whole" })
    expect(
      notificationWords(
        notice({ requestType: "fact_confirmation", subject: "Guest Wi-Fi?" })
      ).title
    ).toBe("Confirm: Guest Wi-Fi?")
  })
})
