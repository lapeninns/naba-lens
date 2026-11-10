// @vitest-environment jsdom
// Me "Your findings" (B01-06, design §4.5): rows, one action each, drafts,
// closed assignments, a venue move, Show more on the server's cursor, and the
// empty, failed and partial states.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  YOUR_FINDINGS_COPY,
  YourFindings,
} from "@/components/nabalens/knowledge/findings-history"
import type {
  FindingSummary,
  FindingsPage,
} from "@/lib/knowledge-client/contract"

afterEach(cleanup)

const HERE = { id: "v1", name: "The Old Crown" }

function finding(over: Partial<FindingSummary> = {}): FindingSummary {
  return {
    findingRef: { type: "contribution", id: "f1" },
    checkId: "c1",
    question: "Is there parking on site?",
    venue: HERE,
    answer: "yes",
    kind: "finding",
    state: "awaiting_confirmation",
    noLongerUsed: null,
    stateReason: null,
    managerNote: null,
    detailRequestId: null,
    unknownPreset: null,
    answeredBy: null,
    sentAt: "2026-11-05T10:00:00.000Z",
    savedAt: null,
    decidedAt: null,
    recognition: { kind: "pending" },
    ...over,
  }
}

const page = (
  items: FindingSummary[],
  over: Partial<FindingsPage> = {}
): FindingsPage => ({
  items,
  nextCursor: null,
  hiddenEarlierVenues: [],
  ...over,
})

const CURRENT = finding({
  findingRef: { type: "contribution", id: "f-cur" },
  checkId: "c-cur",
  question: "Is there Wi-Fi?",
  state: "current",
  recognition: { kind: "scored", period: "2026-11" },
})
const ASKED = finding({
  findingRef: { type: "contribution", id: "f-ask" },
  checkId: "c-ask",
  question: "Is the entrance step-free?",
  state: "needs_attention",
  managerNote: "Which door did you check?",
})
const DRAFT = finding({
  findingRef: null,
  checkId: "c-draft",
  question: "Is there a lift?",
  answer: null,
  kind: "draft",
  state: "saved",
  sentAt: null,
  savedAt: "2026-11-06T09:30:00.000Z",
})
const CLOSED = finding({
  findingRef: null,
  checkId: "c-closed",
  question: "Are dogs welcome?",
  answer: null,
  kind: "assignment",
  state: "assignment_closed",
  answeredBy: "Priya",
  answeredAt: "2026-11-04T09:00:00.000Z",
  decidedAt: null,
  sentAt: null,
  recognition: { kind: "none" },
})
const UNKNOWN = finding({
  findingRef: { type: "contribution", id: "f-unk" },
  checkId: "c-unk",
  question: "Is there a hearing loop?",
  answer: "unknown",
  state: "submitted",
  recognition: { kind: "not_scored" },
})
const LEGACY = finding({
  findingRef: { type: "submission", id: "s-1" },
  checkId: "c-old",
  question: "Is there a garden?",
  state: "no_longer_used",
  noLongerUsed: "replaced_by_newer_answer",
})

const noLoad = vi.fn(async () => ({ ok: true as const, page: page([]) }))

function rowOf(question: string) {
  return screen
    .getByRole("heading", { level: 3, name: question })
    .closest("li") as HTMLElement
}

describe("Your findings", () => {
  it("shows each finding with its answer, state, explanation, date and credit", () => {
    render(
      <YourFindings
        initial={page([ASKED, DRAFT, CURRENT, CLOSED, UNKNOWN, LEGACY])}
        venue={HERE}
        loadMore={noLoad}
      />
    )
    expect(
      screen.getByRole("region", {
        name: "Your findings, 1 needs attention",
      })
    ).toBeTruthy()
    expect(screen.getByText(YOUR_FINDINGS_COPY.intro)).toBeTruthy()

    const current = within(rowOf("Is there Wi-Fi?"))
    expect(current.getByText("Answer: Yes")).toBeTruthy()
    expect(current.getByText("Current answer")).toBeTruthy()
    expect(current.getByText("In use as the venue's answer.")).toBeTruthy()
    expect(current.getByText("Sent 5 Nov 2026, 10:00")).toBeTruthy()
    expect(current.getByText("Counted in your November target.")).toBeTruthy()

    const draft = within(rowOf("Is there a lift?"))
    expect(draft.getByText("Not sent yet. Only you can see it.")).toBeTruthy()
    expect(draft.getByText("Saved 6 Nov 2026, 09:30")).toBeTruthy()
    expect(draft.queryByText(/^Answer:/)).toBeNull()

    const closed = within(rowOf("Are dogs welcome?"))
    expect(
      closed.getByText("Assigned to you; answered by Priya on 4 Nov.")
    ).toBeTruthy()
    // Priya's answer is never shown as this person's send (HM-05).
    expect(closed.queryByText(/^Sent /)).toBeNull()
    const unknown = within(rowOf("Is there a hearing loop?"))
    expect(unknown.getByText("Answer: Couldn't establish")).toBeTruthy()
    expect(
      unknown.getByText(
        "Couldn't-establish findings don't count toward targets."
      )
    ).toBeTruthy()
    expect(
      within(rowOf("Is there a garden?")).getByText(
        "A newer answer replaced it. It stays in your history."
      )
    ).toBeTruthy()
  })

  it("gives each row one action, named with its question", () => {
    render(
      <YourFindings
        initial={page([ASKED, DRAFT, CURRENT])}
        venue={HERE}
        loadMore={noLoad}
      />
    )
    expect(
      screen
        .getByRole("link", { name: "Add detail: Is the entrance step-free?" })
        .getAttribute("href")
    ).toBe("/staff/tasks/amenities/c-ask")
    expect(
      screen.getByRole("link", { name: "Finish: Is there a lift?" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "View: Is there Wi-Fi?" })
    ).toBeTruthy()
    for (const question of [
      "Is the entrance step-free?",
      "Is there a lift?",
      "Is there Wi-Fi?",
    ])
      expect(within(rowOf(question)).getAllByRole("link")).toHaveLength(1)
  })

  it("keeps rows from a venue I've left, read-only, and lets me discard a draft there", async () => {
    const away = { id: "v0", name: "The Swan" }
    const discardDraft = vi.fn(async () => ({ ok: true as const }))
    render(
      <YourFindings
        initial={page([
          finding({ venue: away, state: "current" }),
          { ...DRAFT, venue: away, sendable: false },
        ])}
        venue={HERE}
        loadMore={noLoad}
        onDiscardDraft={discardDraft}
        viewerId="u1"
      />
    )
    const old = within(rowOf("Is there parking on site?"))
    expect(old.getByText("The Swan")).toBeTruthy()
    expect(
      old.getByText("You've moved to The Old Crown; this stays as it was.")
    ).toBeTruthy()
    expect(old.queryByRole("link")).toBeNull()

    const draft = within(rowOf("Is there a lift?"))
    expect(
      draft.getByText(
        "This draft is for The Swan. You can't send it now that you work at The Old Crown."
      )
    ).toBeTruthy()
    expect(draft.queryByRole("link")).toBeNull()
    await userEvent.click(
      draft.getByRole("button", { name: "Discard draft: Is there a lift?" })
    )
    // This device's copy of the capture form's draft goes too (L1).
    window.localStorage.setItem("nabalens.amenity-draft.v2:u1:c-draft", "{}")
    await userEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(discardDraft).toHaveBeenCalledWith({ checkId: "c-draft" })
    expect(
      window.localStorage.getItem("nabalens.amenity-draft.v2:u1:c-draft")
    ).toBeNull()
    // Focus goes to the heading, which can take it (L2), and the outcome is
    // said once (HM-08).
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("your-findings-heading")
    )
    expect(screen.getByRole("status").textContent).toBe("Draft discarded.")
    expect(
      screen.queryByRole("heading", { level: 3, name: "Is there a lift?" })
    ).toBeNull()
  })

  it("keeps the draft and says so when discarding fails", async () => {
    render(
      <YourFindings
        initial={page([{ ...DRAFT, sendable: false }])}
        venue={HERE}
        loadMore={noLoad}
        onDiscardDraft={async () => ({
          ok: false as const,
          code: "unavailable" as const,
          status: 503,
          message: "down",
        })}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Discard draft: Is there a lift?" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      YOUR_FINDINGS_COPY.discardFailed
    )
    expect(rowOf("Is there a lift?")).toBeTruthy()
  })

  it("passes the server's cursor back untouched and moves focus to the first new row", async () => {
    const cursor = "eyJ0IjoiMjAyNi0xMS0wNSIsImlkIjoiZjEifQ=="
    const loadMore = vi.fn(async () => ({
      ok: true as const,
      page: page([CURRENT, LEGACY]),
    }))
    render(
      <YourFindings
        initial={page([ASKED, CURRENT], { nextCursor: cursor })}
        venue={HERE}
        loadMore={loadMore}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(loadMore).toHaveBeenCalledWith({ cursor })
    // Already listed rows aren't repeated.
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
    ).toEqual([
      "Is the entrance step-free?",
      "Is there Wi-Fi?",
      "Is there a garden?",
    ])
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 3, name: "Is there a garden?" })
    )
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull()
  })

  it("keeps loaded rows when an older page fails, and retries the same cursor", async () => {
    const loadMore = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, page: page([LEGACY]) })
    render(
      <YourFindings
        initial={page([CURRENT], { nextCursor: "opaque" })}
        venue={HERE}
        loadMore={loadMore}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(screen.getByText(YOUR_FINDINGS_COPY.failed)).toBeTruthy()
    expect(rowOf("Is there Wi-Fi?")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(loadMore).toHaveBeenNthCalledWith(2, { cursor: "opaque" })
    expect(rowOf("Is there a garden?")).toBeTruthy()
    expect(screen.queryByText(YOUR_FINDINGS_COPY.failed)).toBeNull()
  })

  it("says what will show here when nothing has been sent", () => {
    render(<YourFindings initial={page([])} venue={HERE} loadMore={noLoad} />)
    expect(screen.getByText(YOUR_FINDINGS_COPY.empty)).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "See amenity checks" })
        .getAttribute("href")
    ).toBe("/staff/tasks")
    expect(screen.getByRole("region", { name: "Your findings" })).toBeTruthy()
  })

  it("never shows the empty state when earlier venues are hidden", () => {
    render(
      <YourFindings
        initial={page([], { hiddenEarlierVenues: [{ name: "The Swan" }] })}
        venue={HERE}
        loadMore={noLoad}
      />
    )
    expect(screen.queryByText(YOUR_FINDINGS_COPY.empty)).toBeNull()
    expect(
      screen.getByText(
        "Findings from The Swan aren't shown since you moved venue. Your manager there can still see them."
      )
    ).toBeTruthy()
  })

  it("says the history couldn't be read, with Try again, rather than nothing sent", () => {
    render(<YourFindings initial={null} venue={HERE} loadMore={noLoad} />)
    expect(screen.getByText(YOUR_FINDINGS_COPY.failed)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href")
    ).toBe("/staff")
    expect(screen.queryByText(YOUR_FINDINGS_COPY.empty)).toBeNull()
  })
})

describe("Your findings: focus, busy discard and refresh (B02-06)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
  }

  it("Show more keeps focus while loading, and a failure focuses Try again (HM-06)", async () => {
    let fail!: (e: Error) => void
    const loadMore = vi.fn(
      () => new Promise<never>((_, reject) => (fail = reject))
    )
    render(
      <YourFindings
        initial={page([CURRENT], { nextCursor: "opaque" })}
        venue={HERE}
        loadMore={loadMore}
      />
    )
    const more = screen.getByRole("button", { name: "Show more" })
    await userEvent.click(more)
    const loading = screen.getByRole("button", {
      name: YOUR_FINDINGS_COPY.loading,
    })
    expect(loading.getAttribute("aria-disabled")).toBe("true")
    expect(loading.hasAttribute("disabled")).toBe(false)
    expect(document.activeElement).toBe(loading)
    await userEvent.click(loading)
    expect(loadMore).toHaveBeenCalledTimes(1)
    fail(new Error("offline"))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Try again" })
      )
    )
  })

  it("a last page of rows already shown moves focus to the heading (HM-06)", async () => {
    const loadMore = vi.fn(async () => ({
      ok: true as const,
      page: page([CURRENT]),
    }))
    render(
      <YourFindings
        initial={page([CURRENT], { nextCursor: "opaque" })}
        venue={HERE}
        loadMore={loadMore}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Show more" }))
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("your-findings-heading")
    )
  })

  it("the discard dialog stays open and busy until the server answers (HM-08)", async () => {
    const answer = deferred<{ ok: true }>()
    const discardDraft = vi.fn(() => answer.promise)
    render(
      <YourFindings
        initial={page([{ ...DRAFT, sendable: false }])}
        venue={HERE}
        loadMore={noLoad}
        onDiscardDraft={discardDraft}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Discard draft: Is there a lift?" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Discard" }))
    const busy = screen.getByRole("button", { name: "Discarding…" })
    expect(busy.getAttribute("aria-busy")).toBe("true")
    await userEvent.click(busy)
    expect(discardDraft).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(screen.queryByText("Draft discarded.")).toBeNull()
    answer.resolve({ ok: true })
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Draft discarded.")
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows a refreshed first page, not the rows first loaded (HM-09)", () => {
    const { rerender } = render(
      <YourFindings initial={page([CURRENT])} venue={HERE} loadMore={noLoad} />
    )
    expect(rowOf("Is there Wi-Fi?")).toBeTruthy()
    rerender(
      <YourFindings initial={page([ASKED])} venue={HERE} loadMore={noLoad} />
    )
    expect(rowOf("Is the entrance step-free?")).toBeTruthy()
    expect(
      screen.queryByRole("heading", { level: 3, name: "Is there Wi-Fi?" })
    ).toBeNull()
  })

  it("keeps loaded pages when the parent re-renders the same first page (HM-09)", async () => {
    const loadMore = vi.fn(async () => ({
      ok: true as const,
      page: page([LEGACY]),
    }))
    const ui = () => (
      <YourFindings
        initial={page([CURRENT], { nextCursor: "opaque" })}
        venue={HERE}
        loadMore={loadMore}
      />
    )
    const { rerender } = render(ui())
    await userEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(rowOf("Is there a garden?")).toBeTruthy()
    rerender(ui())
    expect(rowOf("Is there a garden?")).toBeTruthy()
  })
})
