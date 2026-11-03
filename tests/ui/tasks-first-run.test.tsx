// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AddProvider } from "@/components/nabalens/shell/add-context"
import {
  FIRST_RUN_COOKIE,
  FirstRun,
  isNewStarter,
  setupGaps,
  TasksOverview,
} from "@/components/nabalens/tasks"

import { monthly, PROFILE, tasksView } from "./tasks-fixtures"

afterEach(() => {
  cleanup()
  document.cookie = `${FIRST_RUN_COOKIE}=; path=/; max-age=0`
})

const props = {
  name: "Josh Smith",
  venueName: "The Railway",
  periodLabel: "November 2026",
  target: 3,
  dueLabel: "Due 30 Nov 2026",
  gaps: [] as string[],
  uploadBlocked: null as string | null,
  hasAvatar: false,
  photoHref: "/staff",
  profileHref: "/staff",
  homeHref: "/staff/tasks",
}

describe("FirstRun", () => {
  it("welcomes the starter and offers both buttons", () => {
    render(<FirstRun {...props} />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome, Josh" })
    ).toBeTruthy()
    expect(
      screen.getByText("Take photos at work: dishes, the bar, the venue.")
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Your photos for November 2026" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Add a profile photo" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Take your first photo" })
    ).toBeTruthy()
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("opens the Add sheet from the photo action inside the staff layout", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd }}>
        <FirstRun {...props} />
      </AddProvider>
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Take your first photo" })
    )
    expect(openAdd).toHaveBeenCalledTimes(1)
    expect(document.cookie).toContain(`${FIRST_RUN_COOKIE}=1`)
  })

  it("records that it was seen when either button is pressed", () => {
    render(<FirstRun {...props} />)
    const home = screen.getByRole("link", { name: "Go to Home" })
    expect(home.getAttribute("href")).toBe("/staff/tasks")
    fireEvent.click(home)
    expect(document.cookie).toContain(`${FIRST_RUN_COOKIE}=1`)
  })

  it("lists what is still being set up", () => {
    render(
      <FirstRun
        {...props}
        hasAvatar
        gaps={[
          "No team yet: an admin assigns Front of house or Back of house",
          "No target yet: your manager sets it",
        ]}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Still being set up" })
    ).toBeTruthy()
    expect(screen.getByText("No target yet: your manager sets it")).toBeTruthy()
    expect(
      screen.getByText(
        "You can take photos now. They go to Photos and your profile straight away."
      )
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Change photo" })).toBeTruthy()
  })

  it("disables the photo action when uploads are blocked", () => {
    render(
      <FirstRun
        {...props}
        uploadBlocked="The Railway isn't taking photos yet, so you can't add any. An admin turns the venue on."
      />
    )
    expect(
      screen.getByRole("heading", { name: "Photos can't be added yet" })
    ).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Take your first photo",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(screen.getByRole("link", { name: "Go to Home" })).toBeTruthy()
  })
})

describe("first-run entry on Home", () => {
  const base = tasksView()

  it("derives a new starter from an empty month", () => {
    expect(
      isNewStarter(tasksView({ monthly: monthly({ accepted: 0, pending: 0 }) }))
    ).toBe(true)
    expect(isNewStarter(tasksView({ monthly: monthly({ accepted: 2 }) }))).toBe(
      false
    )
    expect(
      setupGaps(tasksView({ monthly: monthly({ setupMissing: ["target"] }) }))
    ).toContain("No target yet: your manager sets it")
  })

  it("shows the entry only when a link is given", () => {
    const home = (welcomeHref: string | null) =>
      render(
        <TasksOverview
          tasks={base}
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
