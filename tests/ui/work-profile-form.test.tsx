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

import { initialWorkValues, safeNext } from "@/app/staff/profile/work-values"
import { WorkProfileForm } from "@/components/nabalens/work-profile-form"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderForm(
  overrides: Partial<Parameters<typeof WorkProfileForm>[0]> = {}
) {
  const onSave = vi.fn(async () => ({ ok: true as const }))
  const onSkip = vi.fn(async () => ({ ok: true as const }))
  render(
    <WorkProfileForm
      venueName="TEST Inn"
      initial={{ roleKey: null, roleTitle: "", workAreas: [] }}
      next="/staff/tasks/welcome"
      onSave={onSave}
      onSkip={onSkip}
      {...overrides}
    />
  )
  return { onSave, onSkip }
}

/** A main job or area chip (v2 PickChip, a toggle button). */
const chip = (name: string) => screen.getByRole("button", { name })
const pressed = (name: string) => chip(name).getAttribute("aria-pressed")

describe("WorkProfileForm", () => {
  it("asks what you do at the venue, the jobs in four groups", () => {
    renderForm()
    expect(
      screen.getByRole("group", { name: "What do you do at TEST Inn?" })
    ).toBeTruthy()
    // Decision 9 (screens-2 handoff): grouped chips, options unchanged.
    for (const [group, first] of [
      ["Kitchen", "Head chef"],
      ["Bar", "Bartender"],
      ["Front of house", "Waiter / server"],
      ["Something else", "Other"],
    ] as const) {
      expect(
        within(screen.getByRole("group", { name: group })).getAllByRole(
          "button"
        )[0]!.textContent
      ).toBe(first)
    }
    expect(
      screen.getByRole("group", { name: "Other areas you work in (optional)" })
    ).toBeTruthy()
  })

  it("saves the main job and extra areas, then goes on", async () => {
    const { onSave } = renderForm()
    fireEvent.click(chip("Curry chef"))
    fireEvent.click(chip("Tandoor and breads"))
    fireEvent.click(chip("Kitchen"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    // Areas go in the listed order, whatever order they were ticked in.
    expect(onSave).toHaveBeenCalledWith({
      roleKey: "curry_chef",
      roleTitle: null,
      workAreas: ["kitchen", "tandoor"],
    })
    expect(router.push).toHaveBeenCalledWith("/staff/tasks/welcome")
  })

  it("asks for a main job before saving", async () => {
    const { onSave } = renderForm()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose what you mainly do."
    )
    expect(document.activeElement).toBe(chip("Head chef"))
  })

  it("needs a short title for Other", async () => {
    const { onSave } = renderForm()
    fireEvent.click(chip("Other"))
    const title = screen.getByRole("textbox", { name: "Your role" })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe("Enter your role.")
    expect(title.getAttribute("aria-invalid")).toBe("true")
    expect(document.activeElement).toBe(title)

    fireEvent.change(title, { target: { value: "  Pot   wash  " } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    expect(onSave).toHaveBeenCalledWith({
      roleKey: "other",
      roleTitle: "Pot wash",
      workAreas: [],
    })
  })

  it("treats a prefill from the job title as a suggestion to confirm", async () => {
    const { onSave } = renderForm({
      initial: { roleKey: "bartender", roleTitle: "", workAreas: [] },
      suggestedFrom: "Barman",
    })
    expect(pressed("Bartender")).toBe("true")
    expect(screen.getByText("Check this suggestion")).toBeTruthy()
    expect(
      screen.getByText(/We picked Bartender from your job title \(Barman\)/)
    ).toBeTruthy()
    // Nothing is stored until Save.
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(chip("Bar team"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ roleKey: "bar_team" })
    )
  })

  it("Skip for now skips without saving", async () => {
    const { onSave, onSkip } = renderForm()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    })
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith("/staff/tasks/welcome")
  })

  it("shows the server's message and field error and stays put", async () => {
    renderForm({
      onSave: vi.fn(async () => ({
        ok: false as const,
        message: "Check the highlighted field.",
        fieldErrors: { roleTitle: "Use 40 characters or fewer." },
      })),
      initial: { roleKey: "other", roleTitle: "x", workAreas: [] },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    expect(screen.getByText("Check the highlighted field.")).toBeTruthy()
    expect(screen.getByText("Use 40 characters or fewer.")).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()
  })

  it("works by keyboard: every chip is a named button and the hint is linked", () => {
    renderForm()
    const group = screen.getByRole("group", {
      name: "What do you do at TEST Inn?",
    })
    for (const button of within(group).getAllByRole("button")) {
      expect(button.textContent).toBeTruthy()
      expect(button.getAttribute("aria-pressed")).toBe("false")
    }
    const hint = document.getElementById(
      group.getAttribute("aria-describedby") ?? ""
    )
    expect(hint?.textContent).toContain("Choose your main job.")
    // One main job at a time: choosing another releases the first.
    fireEvent.click(chip("Host"))
    fireEvent.click(chip("Manager"))
    expect(pressed("Host")).toBe("false")
    expect(pressed("Manager")).toBe("true")
  })
})

describe("work details helpers", () => {
  it("keeps next inside the staff area", () => {
    expect(safeNext("/staff/tasks/welcome?from=me")).toBe(
      "/staff/tasks/welcome?from=me"
    )
    expect(safeNext("/staff")).toBe("/staff")
    for (const bad of [
      undefined,
      "",
      "https://evil.test",
      "//evil.test",
      "/staff//evil",
      "/\\evil.test",
      "/admin",
      "/staffing",
      "staff",
    ]) {
      expect(safeNext(bad)).toBe("/staff")
    }
    expect(safeNext(["/staff/tasks", "/admin"])).toBe("/staff/tasks")
  })

  it("prefills the saved profile, a matched title, or Other with the title", () => {
    const saved = {
      roleKey: "server" as const,
      roleTitle: null,
      workAreas: ["bar" as const],
      completedAt: "2026-11-01T00:00:00Z",
      skippedAt: null,
      welcomeDismissedAt: null,
    }
    expect(initialWorkValues({ jobTitle: "Head chef", work: saved })).toEqual({
      initial: { roleKey: "server", roleTitle: "", workAreas: ["bar"] },
      suggestedFrom: null,
    })
    expect(
      initialWorkValues({ jobTitle: "Tandoori chef", work: null })
    ).toEqual({
      initial: { roleKey: "tandoor_chef", roleTitle: "", workAreas: [] },
      suggestedFrom: "Tandoori chef",
    })
    const long = "Senior pastry and dessert development specialist lead"
    const other = initialWorkValues({ jobTitle: long, work: null })
    expect(other.initial.roleKey).toBe("other")
    expect(other.initial.roleTitle.length).toBeLessThanOrEqual(40)
    expect(long.startsWith(other.initial.roleTitle)).toBe(true)
    expect(initialWorkValues({ jobTitle: null, work: null })).toEqual({
      initial: { roleKey: null, roleTitle: "", workAreas: [] },
      suggestedFrom: null,
    })
  })
})
