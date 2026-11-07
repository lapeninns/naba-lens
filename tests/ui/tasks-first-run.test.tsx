// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

import { AddProvider } from "@/components/nabalens/shell/add-context"
import {
  FIRST_RUN_COOKIE,
  FirstRun,
  setupGaps,
  showWelcomeEntry,
  TasksOverview,
} from "@/components/nabalens/tasks"
import type { OpenAddOptions } from "@/components/nabalens/shell/add-context"

import { monthly, PROFILE, tasksView } from "./tasks-fixtures"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function props(overrides: Partial<Parameters<typeof FirstRun>[0]> = {}) {
  return {
    name: "Josh Smith",
    venueName: "The Railway",
    periodLabel: "November 2026",
    monthly: { target: 3, accepted: 1, dueLabel: "Due 30 Nov 2026" },
    gaps: [] as string[],
    uploadBlocked: null as string | null,
    hasAvatar: false,
    workRole: null as string | null,
    photoHref: "/staff",
    profileHref: "/staff?edit=profile",
    workProfileHref: "/staff/profile?next=%2Fstaff%2Ftasks%2Fwelcome",
    homeHref: "/staff/tasks",
    dismiss: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

describe("FirstRun", () => {
  it("explains the portfolio, then work details, then the pickers, then Skip", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd }}>
        <FirstRun {...props()} />
      </AddProvider>
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome, Josh" })
    ).toBeTruthy()
    const steps = within(
      screen.getByRole("list", { name: "What happens to a photo" })
    ).getAllByRole("listitem")
    expect(steps.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Saved to your portfolio"),
      expect.stringContaining("Ready to label"),
      expect.stringContaining("Accepted for menu use"),
    ])
    const work = screen.getByRole("link", { name: "Add your work details" })
    expect(work.getAttribute("href")).toBe(
      "/staff/profile?next=%2Fstaff%2Ftasks%2Fwelcome"
    )
    expect(
      screen.getByRole("heading", { name: "What do you do at The Railway?" })
    ).toBeTruthy()

    // Document order: work details, library (primary), camera, Skip.
    const library = screen.getByRole("button", {
      name: "Choose from your photos",
    })
    const camera = screen.getByRole("button", { name: "Take a photo" })
    const skip = screen.getByRole("button", { name: "Skip for now" })
    const order = [work, library, camera, skip]
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("shows accepted of target for the month, with the due date", () => {
    render(<FirstRun {...props()} />)
    expect(
      screen.getByRole("heading", { name: "Your photos for November 2026" })
    ).toBeTruthy()
    expect(screen.getByText("1 of 3 accepted")).toBeTruthy()
    expect(screen.getByText("Due 30 Nov 2026")).toBeTruthy()
  })

  it("opens the library picker straight away and dismisses only on an actual pick", () => {
    const calls: OpenAddOptions[] = []
    const openAdd = vi.fn((opts?: OpenAddOptions) => {
      if (opts) calls.push(opts)
    })
    const dismiss = vi.fn(async () => ({ ok: true }))
    render(
      <AddProvider value={{ openAdd }}>
        <FirstRun {...props({ dismiss })} />
      </AddProvider>
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    expect(calls[0]?.source).toBe("library")
    // The picker opened; nothing is recorded until files are picked.
    expect(dismiss).not.toHaveBeenCalled()
    calls[0]?.onPicked?.()
    expect(dismiss).toHaveBeenCalledWith(true)
    expect(document.cookie).not.toContain(FIRST_RUN_COOKIE)
  })

  it("does not dismiss when the camera picker is cancelled", () => {
    const calls: OpenAddOptions[] = []
    const dismiss = vi.fn(async () => ({ ok: true }))
    render(
      <AddProvider value={{ openAdd: (opts) => opts && calls.push(opts) }}>
        <FirstRun {...props({ dismiss })} />
      </AddProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Take a photo" }))
    expect(calls[0]?.source).toBe("camera")
    // A cancelled picker never calls onPicked.
    expect(dismiss).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it("does not wait for the dismissal before the picker opens", () => {
    // A dismissal that never settles must not hold up openAdd.
    const dismiss = vi.fn(() => new Promise<never>(() => {}))
    const openAdd = vi.fn((opts?: OpenAddOptions) => opts?.onPicked?.())
    render(
      <AddProvider value={{ openAdd }}>
        <FirstRun {...props({ dismiss })} />
      </AddProvider>
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    expect(openAdd).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it("Skip for now records the dismissal, then goes to Home", async () => {
    const dismiss = vi.fn(async () => ({ ok: true }))
    render(<FirstRun {...props({ dismiss })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    })
    expect(dismiss).toHaveBeenCalledWith(true)
    expect(router.push).toHaveBeenCalledWith("/staff/tasks")
  })

  it("still goes to Home when the dismissal fails", async () => {
    const dismiss = vi.fn(async () => {
      throw new Error("offline")
    })
    render(<FirstRun {...props({ dismiss })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    })
    expect(router.push).toHaveBeenCalledWith("/staff/tasks")
  })

  it("shows the saved role and a link back to Me when opened from Me", () => {
    render(
      <FirstRun
        {...props({
          workRole: "Curry chef",
          back: { href: "/staff", label: "Back to Me" },
        })}
      />
    )
    expect(
      screen.getByRole("link", { name: "Back to Me" }).getAttribute("href")
    ).toBe("/staff")
    expect(screen.getByText("Curry chef")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Change work details" })
    ).toBeTruthy()
  })

  it("links to Me's photo upload outside the staff layout", () => {
    render(<FirstRun {...props()} />)
    expect(
      screen
        .getByRole("link", { name: "Add your first photo" })
        .getAttribute("href")
    ).toBe("/staff")
    expect(
      screen
        .getByRole("link", { name: "Add a profile photo (optional)" })
        .getAttribute("href")
    ).toBe("/staff?edit=profile")
  })

  it("lists what is still being set up", () => {
    render(
      <FirstRun
        {...props({
          hasAvatar: true,
          gaps: [
            "No team yet: an admin assigns Front of house or Back of house",
            "No target yet: your manager sets it",
          ],
        })}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Still being set up" })
    ).toBeTruthy()
    expect(screen.getByText("No target yet: your manager sets it")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Change profile photo (optional)" })
    ).toBeTruthy()
  })

  it("disables both pickers when uploads are blocked, but keeps Skip", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <FirstRun
          {...props({
            uploadBlocked:
              "The Railway isn't taking photos yet, so you can't add any. An admin turns the venue on.",
          })}
        />
      </AddProvider>
    )
    expect(
      screen.getByRole("heading", { name: "Photos can't be added yet" })
    ).toBeTruthy()
    for (const name of ["Choose from your photos", "Take a photo"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled
      ).toBe(true)
    }
    expect(
      (
        screen.getByRole("button", {
          name: "Skip for now",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })
})

describe("Start here on Home", () => {
  it("shows only to someone who has not dismissed it and has no photos", () => {
    const base = { dismissedAt: null, legacyCookie: false, hasOwnMedia: false }
    expect(showWelcomeEntry(base)).toBe(true)
    // Dismissed in the database (Skip, or a pick from the welcome).
    expect(
      showWelcomeEntry({ ...base, dismissedAt: "2026-11-06T10:00:00Z" })
    ).toBe(false)
    // The old per-browser cookie still counts as dismissed.
    expect(showWelcomeEntry({ ...base, legacyCookie: true })).toBe(false)
    // Anyone with a photo of their own is not a new starter.
    expect(showWelcomeEntry({ ...base, hasOwnMedia: true })).toBe(false)
  })

  it("still words the setup gaps", () => {
    expect(
      setupGaps(tasksView({ monthly: monthly({ setupMissing: ["target"] }) }))
    ).toContain("No target yet: your manager sets it")
  })

  it("shows the entry only when a link is given", () => {
    const home = (welcomeHref: string | null) =>
      render(
        <TasksOverview
          tasks={tasksView()}
          profile={PROFILE}
          tasksPath="/staff/tasks"
          portfolioPath="/staff"
          welcomeHref={welcomeHref}
        />
      )
    home(null)
    expect(screen.queryByText("Start here")).toBeNull()
    cleanup()
    home("/staff/tasks/welcome")
    expect(
      screen.getByRole("link", { name: "Start here" }).getAttribute("href")
    ).toBe("/staff/tasks/welcome")
  })
})
