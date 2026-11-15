// @vitest-environment jsdom
// G-3: the retake note block Home renders in its retake slot (G-1).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AddProvider } from "@/components/nabalens/shell/add-context"
import { RetakeNotes } from "@/components/nabalens/tasks/retake-notes"
import {
  homeRetakeNotes,
  meRetakeNotes,
} from "@/components/nabalens/tasks/retake-notes-model"
import type { RetakeNote } from "@/lib/server/coverage/types"

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: router.refresh }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function note(overrides: Partial<RetakeNote> = {}): RetakeNote {
  return {
    kind: "menu",
    noteId: "p1",
    revision: 1,
    assetId: "a1",
    thumbnailUrl: "https://storage.test/a1.webp",
    status: "open",
    canRetake: true,
    reason: "Too dark, try the window light",
    askedBy: "TEST Chef",
    askedAt: "2026-11-14T12:00:00.000Z",
    setAsideAt: null,
    dish: {
      itemId: "i1",
      variantId: "v1",
      itemName: "Korma",
      variantName: "Chicken",
    },
    requirement: null,
    ...overrides,
  }
}

const NOTES = [
  note(),
  note({
    kind: "coverage",
    noteId: "c1",
    dish: null,
    requirement: { id: "r1", title: "Bar set-up", kind: "service" },
  }),
  note({
    noteId: "p2",
    status: "set_aside",
    setAsideAt: "2026-11-15T09:00:00Z",
  }),
  note({ noteId: "p3", status: "retaken" }),
  note({ noteId: "p4", status: "cleared", canRetake: false }),
  note({ noteId: "p5", canRetake: false }),
]

describe("which notes each surface shows", () => {
  it("Home: open and retakeable only; Me: all but cleared", () => {
    expect(homeRetakeNotes(NOTES).map((n) => n.noteId)).toEqual(["p1", "c1"])
    expect(meRetakeNotes(NOTES).map((n) => n.noteId)).toEqual([
      "p1",
      "c1",
      "p2",
      "p3",
      "p5",
    ])
  })
})

describe("RetakeNotes on Home", () => {
  it("renders nothing when no note is open", () => {
    const { container } = render(
      <RetakeNotes surface="home" notes={NOTES.slice(2)} onLater={vi.fn()} />
    )
    // Only the empty polite status (for Later's announcement) is there.
    expect(container.textContent).toBe("")
    expect(screen.queryByRole("region")).toBeNull()
  })

  it("leads with the first note: Reshoot is the one primary action and opens the camera with the dish", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd }}>
        <RetakeNotes surface="home" notes={NOTES} onLater={vi.fn()} />
      </AddProvider>
    )
    const block = screen.getByRole("region", { name: "Needs another photo" })
    expect(block.textContent).toContain("Too dark, try the window light")
    expect(block.textContent).toContain("TEST Chef")
    expect(block.textContent).not.toMatch(/better photo|task|due|overdue/i)
    const primary = block.querySelectorAll('[data-variant="primary"]')
    expect(primary).toHaveLength(1)
    expect(primary[0].textContent).toBe("Reshoot")
    fireEvent.click(
      screen.getByRole("button", { name: "Reshoot: Korma (Chicken)" })
    )
    expect(openAdd).toHaveBeenCalledWith({
      source: "camera",
      imagesOnly: true,
      preset: {
        itemId: "i1",
        variantId: "v1",
        itemName: "Korma",
        variantName: "Chicken",
      },
    })
    // The coverage request follows as a row, through its send page.
    expect(
      screen
        .getByRole("link", { name: "Reshoot: Bar set-up" })
        .getAttribute("href")
    ).toBe("/staff/tasks/r1?replaces=c1")
    // Set aside, retaken, cleared and unretakeable notes stay off Home.
    expect(screen.getAllByRole("button", { name: /^Later/ })).toHaveLength(2)
  })

  it("Later hides the note at once, sends its reference and refreshes", async () => {
    const onLater = vi.fn(async () => ({
      ok: true as const,
      setAsideAt: "2026-11-15T10:00:00Z",
      replayed: false,
    }))
    render(<RetakeNotes surface="home" notes={NOTES} onLater={onLater} />)
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Later: Korma (Chicken)" })
      )
    })
    expect(onLater).toHaveBeenCalledWith({ kind: "menu", noteId: "p1" })
    expect(screen.queryByText("Korma (Chicken)")).toBeNull()
    expect(router.refresh).toHaveBeenCalled()
    // The coverage request now leads.
    expect(
      screen.getByRole("heading", { level: 2, name: "Bar set-up" })
    ).toBeTruthy()
  })

  it("Later moves focus to the given heading and says it was set aside (S-2)", async () => {
    const onLater = vi.fn(async () => ({
      ok: true as const,
      setAsideAt: "2026-11-15T10:00:00Z",
      replayed: false,
    }))
    render(
      <>
        <RetakeNotes
          surface="home"
          notes={NOTES.slice(0, 1)}
          onLater={onLater}
          focusAfterLaterId="next-heading"
        />
        <h2 id="next-heading" tabIndex={-1}>
          Our menu
        </h2>
      </>
    )
    const later = screen.getByRole("button", {
      name: "Later: Korma (Chicken)",
    })
    later.focus()
    await act(async () => {
      fireEvent.click(later)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(0)))
    })
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Our menu" })
    )
    expect(screen.getByRole("status").textContent).toBe(
      "Set aside for later. It stays on Me."
    )
  })

  it("brings the note back and says so when Later fails", async () => {
    const onLater = vi.fn(async () => ({
      ok: false as const,
      code: "unavailable" as const,
      status: 503 as const,
      message: "down",
    }))
    render(
      <RetakeNotes surface="home" notes={NOTES.slice(0, 1)} onLater={onLater} />
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Later: Korma (Chicken)" })
      )
    })
    expect(screen.getByRole("alert").textContent).toBe(
      "We couldn't set this aside. Try again."
    )
    const block = screen.getByRole("region", { name: "Needs another photo" })
    expect(within(block).getByText("Korma (Chicken)")).toBeTruthy()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it("offers Later but no Reshoot while uploads are paused", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <RetakeNotes
          surface="home"
          notes={NOTES.slice(0, 2)}
          uploadBlocked
          onLater={vi.fn()}
        />
      </AddProvider>
    )
    expect(screen.queryByRole("button", { name: /^Reshoot/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /^Reshoot/ })).toBeNull()
    expect(screen.getAllByRole("button", { name: /^Later/ })).toHaveLength(2)
  })
})
