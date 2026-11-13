// @vitest-environment jsdom
// B05-06 search screen review repairs (R1, R2, R3, R5, R7): the result list
// follows each server render of page one, every outcome goes through the
// screen's one status region, and a failed Show more keeps focus on a control.
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.hoisted(() => ({
  fetchSearchPage: vi.fn(),
  // A plain function, not a spy: a spy's rejected result is reported as a
  // failure of its own even when the caller handles it.
  rejecting: null as null | (() => Promise<never>),
}))
vi.mock("@/app/_media/fetch-search-page", () => ({
  fetchSearchPage: (...args: unknown[]) =>
    fetchMock.rejecting
      ? fetchMock.rejecting()
      : fetchMock.fetchSearchPage(...args),
}))

import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import { SearchResults } from "@/components/nabalens/search/search-results"
import type { SearchPageResult } from "@/components/nabalens/search/types"
import type { AssetSearchItem } from "@/lib/server/media/search/types"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
beforeEach(() => {
  fetchMock.fetchSearchPage.mockReset()
  fetchMock.rejecting = null
})

const NOW = "2026-11-11T12:00:00.000Z"

function item(n: number): AssetSearchItem {
  return {
    id: `asset-${n}`,
    mediaType: "image",
    thumbnailUrl: null,
    venueName: "Venue A",
    uploaderFirstName: "Sam",
    uploadedAt: "2026-11-10T09:00:00.000Z",
    groupId: null,
    subjects: { menuItems: [], checks: [], tasks: [], group: null },
    use: {
      state: "not_granted",
      inForce: 0,
      withdrawn: 0,
      destinations: [],
    },
    menuDecisions: [],
    answers: [],
  }
}

/** A promise React's use() reads at once (already fulfilled). */
function settled(value: SearchPageResult): Promise<SearchPageResult> {
  return Object.assign(Promise.resolve(value), {
    status: "fulfilled",
    value,
  })
}

const okPage = (n: number, nextCursor: string | null = null) =>
  settled({
    ok: true,
    page: {
      items: Array.from({ length: n }, (_, i) => item(i + 1)),
      nextCursor,
    },
  })

type Props = Partial<React.ComponentProps<typeof SearchResults>>

function List(props: Props & { initialPage: Promise<SearchPageResult> }) {
  return (
    <SearchResults
      search=""
      showVenue={false}
      now={NOW}
      empty={<p>EMPTY</p>}
      emptyStatus={SEARCH_COPY.emptyFiltered}
      onStatus={() => {}}
      onFieldErrors={() => {}}
      onRetry={() => {}}
      onReload={() => {}}
      onLostFocus={() => {}}
      {...props}
    />
  )
}

const cards = () => document.querySelectorAll("[data-asset-card]")

describe("SearchResults follows page one (R1)", () => {
  it("replaces a stale empty list when a new page one arrives with the same key", () => {
    const { rerender } = render(<List initialPage={okPage(0)} />)
    expect(screen.getByText("EMPTY")).toBeTruthy()
    rerender(<List initialPage={okPage(3)} />)
    expect(cards()).toHaveLength(3)
  })

  it("replaces a failed page one when a refresh brings a good one", () => {
    const failed = settled({
      ok: false,
      status: 503,
      code: "unavailable",
      message: "",
    })
    const { rerender } = render(<List initialPage={failed} />)
    expect(screen.getByText(SEARCH_COPY.couldNotLoad)).toBeTruthy()
    rerender(<List initialPage={okPage(2)} />)
    expect(cards()).toHaveLength(2)
  })

  it("picks up a refreshed page one after Show more", async () => {
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: true,
      page: { items: [item(10), item(11)], nextCursor: null },
    })
    const { rerender } = render(<List initialPage={okPage(2, "c1")} />)
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    expect(cards()).toHaveLength(4)
    rerender(<List initialPage={okPage(1)} />)
    expect(cards()).toHaveLength(1)
  })

  it("drops a Show more page that settles after a new page one, even before its abort", async () => {
    // The abort of the old request can come after its reply (it used to run
    // in a passive effect). Model that by making abort do nothing: the page
    // must still be dropped, not appended to the new list.
    vi.spyOn(AbortController.prototype, "abort").mockImplementation(() => {})
    let reply!: (value: SearchPageResult) => void
    fetchMock.fetchSearchPage.mockReturnValue(
      new Promise<SearchPageResult>((resolve) => {
        reply = resolve
      })
    )
    const { rerender } = render(<List initialPage={okPage(2, "c1")} />)
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    rerender(<List initialPage={okPage(1)} />)
    expect(cards()).toHaveLength(1)
    await act(async () => {
      reply({
        ok: true,
        page: { items: [item(10), item(11)], nextCursor: "stale" },
      })
    })
    expect(cards()).toHaveLength(1)
    // The stale page's cursor did not survive either: page one had none.
    expect(
      screen.queryByRole("button", { name: SEARCH_COPY.showMore })
    ).toBeNull()
  })

  it("gives focus a home when a new page one removes the focused card", async () => {
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: true,
      page: { items: [item(10), item(11)], nextCursor: null },
    })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    // Show more put focus on the first new card (the third).
    expect(document.activeElement).toBe(cards()[2])
    rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("still gives focus a home when the window lost focus before the reset", async () => {
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: true,
      page: { items: [item(10), item(11)], nextCursor: null },
    })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    const card = cards()[2] as HTMLElement
    expect(document.activeElement).toBe(card)
    // The user switches tab or app: the document loses focus and the card
    // blurs with no new target, while staying the page's active element.
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    act(() => {
      card.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null })
      )
    })
    rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("does not take focus back after the user dropped it on blank space", async () => {
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: true,
      page: { items: [item(10), item(11)], nextCursor: null },
    })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    const card = cards()[2] as HTMLElement
    expect(document.activeElement).toBe(card)
    // A click on blank space: the document keeps focus, the card loses it.
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    await act(async () => card.blur())
    expect(document.activeElement).toBe(document.body)
    rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).not.toHaveBeenCalled()
  })

  /**
   * Chromium blurs a focused element while removing it, still connected, with
   * no related target (verified in real Chromium; WebKit and jsdom fire
   * nothing). Model that in jsdom so recovery is proven under either
   * behaviour. (React 19 ignores events dispatched during its own commit, so
   * the model guards against that ever changing, not a current failure.)
   */
  function blurOnRemovalLikeChromium() {
    const remove = Node.prototype.removeChild
    vi.spyOn(Node.prototype, "removeChild").mockImplementation(function <
      T extends Node,
    >(this: Node, child: T): T {
      const active = document.activeElement
      if (active && child.contains(active)) {
        active.dispatchEvent(
          new FocusEvent("blur", { bubbles: false, relatedTarget: null })
        )
        active.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: null })
        )
      }
      return remove.call(this, child) as T
    })
  }

  it("recovers focus when the browser blurs the card while removing it (Chromium)", async () => {
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: true,
      page: { items: [item(10), item(11)], nextCursor: null },
    })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    expect(document.activeElement).toBe(cards()[2])
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    blurOnRemovalLikeChromium()
    await act(async () => {
      rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    })
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("recovers focus when a reset removes the focused pager control", async () => {
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: false,
      status: 400,
      code: "invalid_input",
      message: "",
      fieldErrors: { cursor: "expired" },
    })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    const again = screen.getByRole("button", { name: SEARCH_COPY.searchAgain })
    expect(document.activeElement).toBe(again)
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    blurOnRemovalLikeChromium()
    await act(async () => {
      rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    })
    expect(
      screen.queryByRole("button", { name: SEARCH_COPY.searchAgain })
    ).toBeNull()
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("forgets a control removed outside a reset, so a later reset does not take focus", async () => {
    // Show more: expired, so focus goes to Search again. Search again then
    // finds nothing: its own commit removes the button (no reset), and the
    // screen is handed focus once. Focus is then dropped on blank space; a
    // later same-key refresh must not pull it back.
    fetchMock.fetchSearchPage
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: "invalid_input",
        message: "",
        fieldErrors: { cursor: "expired" },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: { items: [], nextCursor: null },
      })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.searchAgain })
    )
    expect(screen.getByText("EMPTY")).toBeTruthy()
    expect(onLostFocus).toHaveBeenCalledTimes(1)
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    await act(async () => {
      rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    })
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("recovers focus the list placed while no focus event reached it (window away)", async () => {
    // Chromium sets focus without firing focus events while the window is not
    // focused. Model that by stopping every focus event before React sees it.
    fetchMock.fetchSearchPage.mockResolvedValue({
      ok: true,
      page: { items: [item(10), item(11)], nextCursor: null },
    })
    const stop = (event: Event) => event.stopImmediatePropagation()
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    for (const type of ["focus", "focusin", "blur", "focusout"])
      window.addEventListener(type, stop, true)
    try {
      await userEvent.click(
        screen.getByRole("button", { name: SEARCH_COPY.showMore })
      )
      expect(document.activeElement).toBe(cards()[2])
      await act(async () => {
        rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
      })
    } finally {
      for (const type of ["focus", "focusin", "blur", "focusout"])
        window.removeEventListener(type, stop, true)
    }
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("recovers focus when a reset lands while Search again is still loading", async () => {
    fetchMock.fetchSearchPage
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: "invalid_input",
        message: "",
        fieldErrors: { cursor: "expired" },
      })
      .mockReturnValueOnce(new Promise(() => {})) // Search again never settles
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.searchAgain })
    )
    // Search again's own commit replaced the focused button.
    expect(
      screen.queryByRole("button", { name: SEARCH_COPY.searchAgain })
    ).toBeNull()
    expect(onLostFocus).not.toHaveBeenCalled()
    await act(async () => {
      rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    })
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("recovers focus from a failed page one's Sign in link when a refresh brings results", async () => {
    const signedOut = settled({
      ok: false,
      status: 401,
      code: "signed_out",
      message: "",
    })
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={signedOut} onLostFocus={onLostFocus} />
    )
    const link = screen.getByRole("link", { name: SEARCH_COPY.signIn })
    link.focus()
    expect(document.activeElement).toBe(link)
    await act(async () => {
      rerender(<List initialPage={okPage(2)} onLostFocus={onLostFocus} />)
    })
    expect(cards()).toHaveLength(2)
    expect(onLostFocus).toHaveBeenCalledTimes(1)
  })

  it("does not take focus when Show more is loading and focus is on nothing", async () => {
    // A Safari-style click (buttons do not take focus), or a click on blank
    // space after pressing Show more: focus is on nothing, but this list did
    // not put it there. A refresh during the load must not move focus.
    fetchMock.fetchSearchPage.mockReturnValue(new Promise(() => {}))
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    await act(async () => {
      rerender(<List initialPage={okPage(1)} onLostFocus={onLostFocus} />)
    })
    expect(cards()).toHaveLength(1)
    expect(onLostFocus).not.toHaveBeenCalled()
  })

  it("leaves focus alone when a new page one arrives while focus is elsewhere", () => {
    const onLostFocus = vi.fn()
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <List initialPage={okPage(3)} onLostFocus={onLostFocus} />
      </>
    )
    screen.getByRole("button", { name: "Elsewhere" }).focus()
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <List initialPage={okPage(1)} onLostFocus={onLostFocus} />
      </>
    )
    expect(onLostFocus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Elsewhere" })
    )
  })
})

describe("the one status region says every outcome (R2, R7)", () => {
  it("announces an empty result", () => {
    const onStatus = vi.fn()
    render(<List initialPage={okPage(0)} onStatus={onStatus} />)
    expect(onStatus).toHaveBeenLastCalledWith(SEARCH_COPY.emptyFiltered)
  })

  it("announces the count", () => {
    const onStatus = vi.fn()
    render(<List initialPage={okPage(2, "c")} onStatus={onStatus} />)
    expect(onStatus).toHaveBeenLastCalledWith(SEARCH_COPY.shownMore(2))
  })

  it.each([
    [{ status: 401, code: "signed_out", message: "" }, SEARCH_COPY.signedOut],
    [
      {
        status: 403,
        code: "not_permitted",
        message: SEARCH_COPY.wrongVenue,
      },
      SEARCH_COPY.wrongVenue,
    ],
    [
      {
        status: 400,
        code: "invalid_input",
        message: "",
        fieldErrors: { mediaType: "bad" },
      },
      SEARCH_COPY.checkFilters,
    ],
    [
      { status: 503, code: "unavailable", message: "" },
      SEARCH_COPY.couldNotLoad,
    ],
  ] as const)(
    "a refused page one (%o) renders no live region of its own and says its title",
    (failure, title) => {
      const onStatus = vi.fn()
      render(
        <List
          initialPage={settled({ ok: false, ...failure } as SearchPageResult)}
          onStatus={onStatus}
        />
      )
      expect(screen.getByText(title)).toBeTruthy()
      expect(
        document.querySelectorAll('[role="status"], [role="alert"]')
      ).toHaveLength(0)
      expect(onStatus).toHaveBeenLastCalledWith(title)
    }
  )
})

describe("a failed Show more keeps focus and says why (R3, R5)", () => {
  it.each([
    [
      { ok: false, status: 503, code: "unavailable", message: "" },
      SEARCH_COPY.tryAgain,
      SEARCH_COPY.moreFailed,
    ],
    [
      {
        ok: false,
        status: 400,
        code: "invalid_input",
        message: "",
        fieldErrors: { cursor: "expired" },
      },
      SEARCH_COPY.searchAgain,
      SEARCH_COPY.expired,
    ],
    [
      { ok: false, status: 401, code: "signed_out", message: "" },
      SEARCH_COPY.signIn,
      SEARCH_COPY.signedOut,
    ],
  ] as const)(
    "%o focuses %s and announces it",
    async (failure, control, sentence) => {
      fetchMock.fetchSearchPage.mockResolvedValue(failure)
      const onStatus = vi.fn()
      render(<List initialPage={okPage(2, "c1")} onStatus={onStatus} />)
      await userEvent.click(
        screen.getByRole("button", { name: SEARCH_COPY.showMore })
      )
      const target = screen.getByText(control).closest("a, button")
      expect(document.activeElement).toBe(target)
      expect(onStatus).toHaveBeenLastCalledWith(sentence)
    }
  )

  it("a fetch that throws without an abort shows Try again, not a stuck loader", async () => {
    // As AbortSignal.any did on Safari before 17.4 (a thrown TypeError).
    fetchMock.rejecting = () =>
      Promise.reject(new TypeError("AbortSignal.any is not a function"))
    const onStatus = vi.fn()
    render(<List initialPage={okPage(2, "c1")} onStatus={onStatus} />)
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    const retry = screen.getByRole("button", { name: SEARCH_COPY.tryAgain })
    expect(retry.getAttribute("aria-disabled")).toBeNull()
    expect(document.activeElement).toBe(retry)
    expect(onStatus).toHaveBeenLastCalledWith(SEARCH_COPY.moreFailed)
  })

  it("Search again that finds nothing hands focus back to the screen", async () => {
    fetchMock.fetchSearchPage
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: "invalid_input",
        message: "",
        fieldErrors: { cursor: "expired" },
      })
      .mockResolvedValueOnce({
        ok: true,
        page: { items: [], nextCursor: null },
      })
    const onLostFocus = vi.fn()
    render(<List initialPage={okPage(2, "c1")} onLostFocus={onLostFocus} />)
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.showMore })
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.searchAgain })
    )
    await act(async () => {})
    expect(onLostFocus).toHaveBeenCalled()
  })
})
