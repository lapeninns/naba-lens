// @vitest-environment jsdom
// S2-REQ screens (spec §7 M4; FA-5; AC01): the manager's request rows, the
// New request form's required fields and errors beside their field, the
// controls on an open request, shot lists, and the staff "Asked for" section
// on Album Home (slots with the manager's brief, Needed by, no due words).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/manager/requests",
}))

import { RequestControls } from "@/components/nabalens/requests/request-controls"
import { RequestForm } from "@/components/nabalens/requests/request-form"
import { RequestRows } from "@/components/nabalens/requests/request-row"
import {
  NewShotListForm,
  ShotListCards,
} from "@/components/nabalens/requests/shot-lists"
import {
  AskedFor,
  askedForItems,
} from "@/components/nabalens/requests/staff-requests"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import type { AlbumSlot } from "@/lib/album/model"
import {
  parseRequest,
  type RequestView,
  type ShotListView,
  type StaffRequest,
} from "@/lib/requests/model"

afterEach(() => {
  cleanup()
  router.push.mockReset()
  router.refresh.mockReset()
})

const PIE = "00000000-0000-4000-8000-0000000d0001"
const GARDEN = "00000000-0000-4000-8000-00000000a001"

function request(over: Record<string, unknown> = {}): RequestView {
  return parseRequest({
    id: "00000000-0000-4000-8000-000000000e01",
    type: "missing_photo",
    required: true,
    slot: {
      kind: "dish",
      slotId: PIE,
      name: "Pie",
      category: "food",
      state: "missing",
    },
    subject: "Pie",
    brief: "Whole pie, steam visible",
    intendedUse: "public",
    team: "boh",
    photoCount: 1,
    priority: "normal",
    date: "2026-11-10",
    dateKind: "needed_by",
    overdue: false,
    state: "open",
    revision: 3,
    createdAt: "2026-11-18T10:00:00Z",
    ...over,
  })!
}

describe("request rows", () => {
  it("shows the state, brief and a slot request's date as Needed by", () => {
    render(<RequestRows requests={[request()]} shotLists={[]} />)
    const row = screen.getByRole("link")
    expect(row.getAttribute("href")).toBe(
      "/manager/requests/00000000-0000-4000-8000-000000000e01"
    )
    expect(within(row).getByText("Open")).toBeTruthy()
    expect(within(row).getByText("Whole pie, steam visible")).toBeTruthy()
    expect(row.textContent).toContain("Needed by 10 Nov")
    expect(row.textContent).not.toMatch(/overdue/i)
  })

  it("marks an optional, overdue New brief and its shot list", () => {
    const list: ShotListView = {
      id: "l1",
      name: "Spring launch",
      purpose: "menu_launch",
      note: null,
      date: null,
      state: "open",
      overdue: false,
      total: 1,
      completed: 0,
      cancelReason: null,
      revision: 1,
    }
    render(
      <RequestRows
        requests={[
          request({
            type: "campaign",
            required: false,
            slot: null,
            subject: "Fire pit",
            dateKind: "due",
            overdue: true,
            shotListId: "l1",
            state: "blocked",
            blockedReason: "Rain all week",
          }),
        ]}
        shotLists={[list]}
      />
    )
    const row = screen.getByRole("link")
    expect(within(row).getByText("Blocked")).toBeTruthy()
    expect(within(row).getByText("Overdue")).toBeTruthy()
    expect(row.textContent).toContain("Rain all week")
    expect(row.textContent).toContain("Optional, outside coverage")
    expect(row.textContent).toContain("Spring launch")
  })
})

describe("New request form (M4-required-fields)", () => {
  const people = [
    { id: "p1", name: "Ann", role: "staff" as const, team: "boh" as const },
    { id: "p2", name: "Max", role: "manager" as const, team: null },
  ]
  const slots = [
    {
      kind: "dish" as const,
      slotId: PIE,
      name: "Pie",
      categoryLabel: "Food",
      state: "missing",
    },
  ]

  it("prefills the slot from a link and shows errors beside the fields", async () => {
    const create = vi.fn()
    render(
      <RequestForm
        mode="slot"
        today="2026-11-18"
        slots={slots}
        facts={[]}
        people={people}
        shotLists={[]}
        initialSlot={{ kind: "dish", slotId: PIE }}
        create={create}
      />
    )
    expect(screen.getByText("Food · No photo yet")).toBeTruthy()
    fireEvent.submit(screen.getByRole("button", { name: "Send the request" }))
    expect(
      await screen.findByText("Write one line on what the photo must show.")
    ).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it("sends a slot request and opens it", async () => {
    const create = vi.fn(async (_input: unknown) => ({
      ok: true as const,
      id: "new-id",
    }))
    render(
      <RequestForm
        mode="slot"
        today="2026-11-18"
        slots={slots}
        facts={[]}
        people={people}
        shotLists={[]}
        initialSlot={{ kind: "dish", slotId: PIE }}
        create={create}
      />
    )
    await userEvent.type(
      screen.getByRole("textbox", { name: /Brief/ }),
      "Whole pie"
    )
    fireEvent.submit(screen.getByRole("button", { name: "Send the request" }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0]![0]).toMatchObject({
      type: "missing_photo",
      slotKind: "dish",
      slotId: PIE,
      brief: "Whole pie",
      intendedUse: "public",
      photoCount: 1,
      priority: "normal",
    })
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/manager/requests/new-id")
    )
  })

  it("puts a database refusal beside its field", async () => {
    const create = vi.fn(async () => ({
      ok: false as const,
      error: "Write what to photograph.",
      field: "subject",
    }))
    render(
      <RequestForm
        mode="new"
        today="2026-11-18"
        slots={[]}
        facts={[]}
        people={people}
        shotLists={[]}
        create={create}
      />
    )
    await userEvent.type(
      screen.getByRole("textbox", { name: /Subject/ }),
      "Fire pit"
    )
    await userEvent.type(screen.getByRole("textbox", { name: /Brief/ }), "Lit")
    fireEvent.submit(screen.getByRole("button", { name: "Send the request" }))
    expect(await screen.findByText("Write what to photograph.")).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()
  })

  it("asks a fact request for the fact, not a brief or use", async () => {
    const create = vi.fn()
    render(
      <RequestForm
        mode="fact"
        today="2026-11-18"
        slots={[]}
        facts={[{ checkId: "c1", question: "Guest Wi-Fi?", stateLabel: null }]}
        people={people}
        shotLists={[]}
        create={create}
      />
    )
    expect(screen.queryByText("Intended use")).toBeNull()
    fireEvent.submit(screen.getByRole("button", { name: "Send the request" }))
    expect(await screen.findByText("Choose the fact.")).toBeTruthy()
    expect(screen.queryByText(/Write one line/)).toBeNull()
  })
})

describe("controls on an open request", () => {
  const actions = () => ({
    edit: vi.fn(async () => ({ ok: true as const })),
    setBlocked: vi.fn(async () => ({ ok: true as const })),
    close: vi.fn(async () => ({ ok: true as const })),
  })

  it("asks a reason before cancelling and sends the revision read", async () => {
    const a = actions()
    render(
      <RequestControls
        request={request()}
        people={[]}
        today="2026-11-18"
        actions={a}
      />
    )
    // A slot request completes on its own: no Mark completed.
    expect(screen.queryByRole("button", { name: "Mark completed" })).toBeNull()
    const cancel = screen.getByRole("button", {
      name: "Cancel with this reason",
    })
    fireEvent.submit(cancel)
    expect(await screen.findByText("Add a short reason.")).toBeTruthy()
    expect(a.close).not.toHaveBeenCalled()
    const form = cancel.closest("form")!
    await userEvent.type(
      within(form).getByRole("textbox", { name: /Reason/ }),
      "Off the menu"
    )
    fireEvent.submit(cancel)
    await waitFor(() =>
      expect(a.close).toHaveBeenCalledWith({
        requestId: request().id,
        revision: 3,
        state: "cancelled",
        reason: "Off the menu",
      })
    )
    expect(router.refresh).toHaveBeenCalled()
  })

  it("lets a request with no slot be completed by hand, and unblocks", async () => {
    const a = actions()
    render(
      <RequestControls
        request={request({
          slot: null,
          type: "campaign",
          state: "blocked",
          blockedReason: "Rain",
        })}
        people={[]}
        today="2026-11-18"
        actions={a}
      />
    )
    fireEvent.submit(screen.getByRole("button", { name: "Mark completed" }))
    await waitFor(() =>
      expect(a.close).toHaveBeenCalledWith(
        expect.objectContaining({ state: "completed" })
      )
    )
    fireEvent.submit(screen.getByRole("button", { name: "Unblock" }))
    await waitFor(() =>
      expect(a.setBlocked).toHaveBeenCalledWith(
        expect.objectContaining({ reason: null })
      )
    )
  })

  it("shows a stale-change refusal", async () => {
    const a = actions()
    a.edit.mockResolvedValueOnce({
      ok: false,
      error: "Someone else changed this since you opened it.",
    } as never)
    render(
      <RequestControls
        request={request()}
        people={[]}
        today="2026-11-18"
        actions={a}
      />
    )
    const brief = screen.getByRole("textbox", { name: /Brief/ })
    await userEvent.clear(brief)
    await userEvent.type(brief, "Sliced")
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }))
    expect(
      await screen.findByText("Someone else changed this since you opened it.")
    ).toBeTruthy()
    expect(a.edit).toHaveBeenCalledWith({
      requestId: request().id,
      revision: 3,
      patch: { brief: "Sliced" },
    })
  })
})

describe("shot lists (M4-shot-lists)", () => {
  it("shows n of N and cancels with a reason", async () => {
    const cancel = vi.fn(async () => ({
      ok: true as const,
      requestsCancelled: 2,
    }))
    render(
      <ShotListCards
        lists={[
          {
            id: "l1",
            name: "Spring launch",
            purpose: "menu_launch",
            note: null,
            date: "2026-11-30",
            state: "open",
            overdue: false,
            total: 3,
            completed: 1,
            cancelReason: null,
            revision: 2,
          },
        ]}
        actions={{ create: vi.fn(), cancel }}
      />
    )
    expect(screen.getByText("1 of 3 completed")).toBeTruthy()
    expect(screen.getByText(/Menu launch · Due 30 Nov/)).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Cancel…" }))
    await userEvent.type(
      screen.getByRole("textbox", { name: /Reason/ }),
      "Moved"
    )
    fireEvent.submit(screen.getByRole("button", { name: "Cancel the list" }))
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        shotListId: "l1",
        revision: 2,
        reason: "Moved",
      })
    )
  })

  it("makes a shot list", async () => {
    const create = vi.fn(async () => ({ ok: true as const, id: "l2" }))
    render(<NewShotListForm today="2026-11-18" create={create} />)
    await userEvent.type(
      screen.getByRole("textbox", { name: /Name/ }),
      "Quiet Tuesday"
    )
    fireEvent.submit(screen.getByRole("button", { name: "Make the shot list" }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: "Quiet Tuesday",
        purpose: "menu_launch",
        date: null,
        note: null,
      })
    )
    expect(await screen.findByText(/The shot list is made/)).toBeTruthy()
  })
})

describe("Asked for on Album Home (AC01, FA-5)", () => {
  const pieSlot: AlbumSlot = {
    id: `dish:${PIE}`,
    name: "Pie",
    group: "Mains",
    state: "needed",
    thumbnailUrl: null,
    neededBy: null,
    brief: "Plated",
    target: { kind: "dish", itemId: PIE, itemName: "Pie" },
  }
  const staffRequest = (over: Partial<StaffRequest> = {}): StaffRequest => ({
    id: "r1",
    type: "missing_photo",
    slot: { kind: "dish", slotId: PIE, name: "Pie", state: "missing" },
    subject: "Pie",
    brief: "Whole pie, steam visible",
    photoCount: 1,
    neededBy: "2026-11-10",
    orientation: null,
    wantsVideo: false,
    captureWindow: null,
    referenceAssetId: null,
    forMe: true,
    state: "open",
    ...over,
  })

  it("pairs requests with album slots and drops ones the album no longer shows", () => {
    const items = askedForItems(
      [
        staffRequest(),
        staffRequest({
          id: "r2",
          slot: { kind: "area", slotId: GARDEN, name: "Garden", state: null },
        }),
        staffRequest({ id: "r3", slot: null, subject: "Fire pit" }),
      ],
      new Map([[pieSlot.id, pieSlot]])
    )
    expect(items.map((i) => [i.request.id, i.slot?.id ?? null])).toEqual([
      ["r1", `dish:${PIE}`],
      ["r3", null],
    ])
  })

  it("shows the slot with the manager's brief; tapping it adds to that slot", async () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd }}>
        <AskedFor
          items={[
            { request: staffRequest(), slot: pieSlot },
            {
              request: staffRequest({
                id: "r3",
                slot: null,
                subject: "Fire pit",
                brief: "Lit, after dark",
                forMe: false,
                neededBy: null,
                wantsVideo: true,
              }),
              slot: null,
            },
          ]}
          today="2026-11-18"
          canAdd
        />
      </AddProvider>
    )
    const section = screen.getByRole("region", { name: "Asked for" })
    expect(within(section).getByText("Whole pie, steam visible")).toBeTruthy()
    // Past its date it reads just "Needed" (DESIGN.md §7).
    expect(within(section).getByText("For you · Needed")).toBeTruthy()
    expect(within(section).getByText("A short video too")).toBeTruthy()
    expect(section.textContent).not.toMatch(/\bdue\b|overdue|task|request/i)

    await userEvent.click(within(section).getByRole("button", { name: /Pie/ }))
    expect(openAdd).toHaveBeenCalledWith({
      slot: { kind: "dish", itemId: PIE, name: "Pie" },
    })
    await userEvent.click(
      within(section).getByRole("button", { name: "Add photos for this" })
    )
    expect(openAdd).toHaveBeenLastCalledWith({ match: { place: null } })
  })

  it("renders nothing when nothing is asked for", () => {
    const { container } = render(
      <AskedFor items={[]} today="2026-11-18" canAdd />
    )
    expect(container.textContent).toBe("")
  })
})
