// @vitest-environment jsdom
// B02-02: Add asks "What are you adding?" with only the person's choices and
// the venue and audience lines; Just photos is today's Add; without the
// entry (switch off, or capabilities unread) Add is today's Add exactly.
// Home's contribute card opens the question picker; a manager account gets
// its two intents inline; "Capture myself" returns to a focused notice
// (CA-15).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AddHost } from "@/app/staff/_shell/add-host"
import {
  AmenityCheckDetail,
  type CheckDetailHandlers,
} from "@/components/nabalens/amenities/manage"
import { FINDING_SENT_PARAM } from "@/components/nabalens/amenities/capture/finding-sent"
import { ContributeCard } from "@/components/nabalens/home/contribute-card"
import { AddTrigger } from "@/components/nabalens/shell/add-context"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { ManagerEntrySection } from "@/components/nabalens/shell/manager-entry"
import type { EntryMenu } from "@/lib/work-client/entry"

import { WIFI_CHECK, detail } from "./amenities-manage-fixtures"

const { refresh, supabase } = vi.hoisted(() => ({
  refresh: vi.fn(),
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
    },
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/staff/tasks",
}))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => null,
}))

const MENU: EntryMenu = {
  venueName: "Lakeside",
  intents: ["dish", "task", "question", "change", "photos"],
  tasks: [{ id: "t1", title: "Bar shelves" }],
  questions: [{ checkId: "c1", question: "Is there step-free access?" }],
  answered: [{ checkId: "c2", question: "Is there Wi-Fi?" }],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
beforeEach(() => {
  // A phone: Add opens its sheet.
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
})

async function host(
  entry: Promise<EntryMenu | null> | null,
  children?: React.ReactNode
) {
  await act(async () => {
    render(
      <AddHost
        blocked={null}
        captchaRequired={false}
        captchaSiteKey={null}
        entry={entry}
        venueName="Lakeside"
      >
        <AddTrigger kind="bar" />
        {children}
      </AddHost>
    )
  })
}

async function openAdd() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }))
  })
}

describe("Add with the shared entry on", () => {
  it("asks what is being added, for this venue, with only these choices", async () => {
    await host(Promise.resolve(MENU))
    await openAdd()
    const dialog = await screen.findByRole("dialog", {
      name: ENTRY_COPY.title,
    })
    expect(within(dialog).getByText("For Lakeside")).toBeTruthy()
    const names = within(dialog)
      .getAllByRole("listitem")
      .map((item) => item.textContent)
    expect(names).toHaveLength(5)
    expect(names[0]).toContain("A dish or drink")
    expect(names[0]).toContain(ENTRY_COPY.dishAudience)
    expect(
      within(dialog)
        .getByRole("link", { name: /A dish or drink/ })
        .getAttribute("href")
    ).toBe("/staff/menu")
    expect(names.join(" ")).not.toMatch(/public/i)
  })

  it("picks a task or a question, back to Home afterwards, focus on each step", async () => {
    await host(Promise.resolve(MENU))
    await openAdd()
    const dialog = await screen.findByRole("dialog")
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Photos for a task/ })
      )
    })
    const heading = within(dialog).getByRole("heading", { name: "Which task?" })
    expect(document.activeElement).toBe(heading)
    expect(within(dialog).getByText(ENTRY_COPY.photosAudience)).toBeTruthy()
    expect(
      within(dialog)
        .getByRole("link", { name: /Bar shelves/ })
        .getAttribute("href")
    ).toBe("/staff/tasks/t1?from=home")

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Back" }))
    })
    expect(document.activeElement).toBe(
      within(dialog).getByRole("heading", { name: ENTRY_COPY.title })
    )
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Report a change/ })
      )
    })
    expect(within(dialog).getByText(ENTRY_COPY.findingAudience)).toBeTruthy()
    expect(
      within(dialog)
        .getByRole("link", { name: /Is there Wi-Fi/ })
        .getAttribute("href")
    ).toBe("/staff/tasks/amenities/c2?from=home")
  })

  it("Just photos is today's Add sheet, with the venue and who sees them", async () => {
    await host(Promise.resolve(MENU))
    await openAdd()
    const dialog = await screen.findByRole("dialog")
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Just photos/ })
      )
    })
    const sheet = await screen.findByRole("dialog", { name: "Add photos" })
    expect(within(sheet).getByText("For Lakeside")).toBeTruthy()
    expect(within(sheet).getByText(ENTRY_COPY.photosAudience)).toBeTruthy()
  })

  it("falls back to today's Add when the capabilities couldn't be read", async () => {
    await host(Promise.resolve(null))
    await openAdd()
    const sheet = await screen.findByRole("dialog", { name: "Add photos" })
    expect(screen.queryByRole("dialog", { name: ENTRY_COPY.title })).toBeNull()
    expect(within(sheet).getByText("For Lakeside")).toBeTruthy()
  })
})

describe("Add with the entry off (b01)", () => {
  it("opens today's Add sheet with no intent step or context lines", async () => {
    await host(null)
    await openAdd()
    const sheet = await screen.findByRole("dialog", { name: "Add photos" })
    expect(within(sheet).queryByText("For Lakeside")).toBeNull()
    expect(within(sheet).queryByText(ENTRY_COPY.photosAudience)).toBeNull()
  })
})

describe("Home's contribute card (§3.3)", () => {
  it("adds Answer a venue question, which opens the question picker", async () => {
    await host(
      Promise.resolve(MENU),
      <ContributeCard
        prompt="What did you cook today?"
        blocked={null}
        canAnswer
      />
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Answer a venue question" })
      )
    })
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("heading", { name: "Which question?" })
    ).toBeTruthy()
    expect(
      within(dialog)
        .getByRole("link", { name: /step-free/ })
        .getAttribute("href")
    ).toBe("/staff/tasks/amenities/c1?from=home")
    // Opened at the question: there is no step to go back to.
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull()
  })

  it("keeps two buttons without a working list", async () => {
    await host(
      Promise.resolve(MENU),
      <ContributeCard prompt="What did you cook today?" blocked={null} />
    )
    expect(
      screen.queryByRole("button", { name: "Answer a venue question" })
    ).toBeNull()
  })
})

describe("manager account entry (§5.3)", () => {
  it("offers only Answer a venue question and Report a change", async () => {
    render(
      <ManagerEntrySection
        menu={{ ...MENU, intents: ["question", "change"], tasks: [] }}
        basePath="/manager"
      />
    )
    const items = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(items).toHaveLength(2)
    expect(items[0]).toContain("Answer a venue question")
    expect(items[1]).toContain("Report a change")
    // A manager isn't told their manager sees it.
    expect(screen.queryByText(ENTRY_COPY.findingAudience)).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Answer a venue/ }))
    })
    expect(
      screen.getByRole("link", { name: /step-free/ }).getAttribute("href")
    ).toBe("/manager/amenities/c1/capture")
  })
})

describe("Capture myself returns to a focused notice (CA-15)", () => {
  const ok = async () => ({ ok: true as const, revision: 4 })
  const handlers: CheckDetailHandlers = {
    assign: ok,
    setNotes: ok,
    archive: ok,
    restore: ok,
    reopen: ok,
  }

  it("names the check sent and takes focus; Dismiss keeps focus on the page", async () => {
    window.history.replaceState(
      null,
      "",
      `/manager/amenities/${WIFI_CHECK.id}?${FINDING_SENT_PARAM}=${WIFI_CHECK.id}`
    )
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath="/manager"
        handlers={handlers}
      />
    )
    const notice = (await screen.findByText("Finding sent")).closest(
      "[role=status]"
    ) as HTMLElement
    expect(notice.textContent).toContain("Finding sent")
    expect(notice.textContent).toContain(WIFI_CHECK.entry.question)
    expect(document.activeElement).toBe(notice)
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }))
    expect(document.activeElement?.id).toBe("amenity-check")
    expect(window.location.search).toBe("")
  })

  it("says nothing for another check", () => {
    window.history.replaceState(
      null,
      "",
      `/manager?${FINDING_SENT_PARAM}=other`
    )
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath="/manager"
        handlers={handlers}
      />
    )
    expect(screen.queryByText("Finding sent")).toBeNull()
  })
})
