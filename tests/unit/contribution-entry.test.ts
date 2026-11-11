// B02-02 shared contribution entry: the switch (§4.4), the intent step's
// choices (§4.1), return paths (§4.3), and the words it adds (§4.2, §5.3,
// CA-11, CA-15).
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  managerSentNoticeFor,
  UPLOAD_WAIT_COPY,
} from "@/components/nabalens/knowledge/copy"
import {
  ENTRY_COPY,
  yesRefusedLine,
} from "@/components/nabalens/shell/entry-copy"
import type { WorkingSlot } from "@/lib/knowledge-client/contract"
import type { VenueCapabilities } from "@/lib/work-client/contract"
import {
  entryFrom,
  entryMenu,
  fromHref,
  withFrom,
} from "@/lib/work-client/entry"

const STAFF: VenueCapabilities = {
  accountKind: "staff",
  venueId: "v1",
  canUpload: true,
  canLabel: true,
  canSendFindings: true,
  canConfirmFindings: false,
  canSelfConfirm: {},
  canReviewMenuPhotos: false,
  canDecideOwnMenuPhoto: false,
  canReviewChecklist: false,
  canBeAssigned: true,
}
const MANAGER: VenueCapabilities = {
  ...STAFF,
  accountKind: "manager",
  canUpload: false,
  canLabel: false,
  canConfirmFindings: true,
  canBeAssigned: false,
}

type Slot = Parameters<typeof entryMenu>[1]["slots"][number]
const slot = (
  checkId: string,
  over: Partial<Pick<Slot, "mode" | "progress">> & { value?: "yes" | null }
): Slot => ({
  checkId,
  question: `Question ${checkId}`,
  mode: over.mode ?? "answer",
  progress: over.progress ?? "needs_capture",
  answerInUse: { value: over.value ?? null } as Slot["answerInUse"],
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("contributionEntry switch (§4.4)", () => {
  it("defaults to b02; the env sets everyone, the venue list keeps b01", async () => {
    const { contributionEntry } =
      await import("@/lib/config/contribution-entry")
    expect(contributionEntry("v1")).toBe("b02")
    vi.stubEnv("NABALENS_CONTRIBUTION_ENTRY", "b01")
    expect(contributionEntry("v1")).toBe("b01")
    vi.stubEnv("NABALENS_CONTRIBUTION_ENTRY", "nonsense")
    expect(contributionEntry("v1")).toBe("b02")
    vi.stubEnv("NABALENS_CONTRIBUTION_ENTRY_B01_VENUES", " v2 ,v3")
    expect(contributionEntry("v2")).toBe("b01")
    expect(contributionEntry("v4")).toBe("b02")
    expect(contributionEntry(null)).toBe("b02")
  })
})

describe("entryMenu (§4.1, §5.3)", () => {
  const slots = [
    slot("done", { mode: "change", progress: "complete", value: "yes" }),
    slot("open", {}),
    slot("recheck", { mode: "recheck", progress: "needs_recheck" }),
    slot("hidden", { mode: "none" }),
  ]
  const tasks = [
    { requirement: { id: "t1", title: "Bar" }, canSubmit: true },
    { requirement: { id: "t2", title: "Closed" }, canSubmit: false },
  ]

  it("offers staff every choice they can complete, with its lists", () => {
    const menu = entryMenu(STAFF, { venueName: "Lakeside", slots, tasks })
    expect(menu).toEqual({
      venueName: "Lakeside",
      intents: ["dish", "task", "question", "change", "photos"],
      tasks: [{ id: "t1", title: "Bar" }],
      questions: [
        { checkId: "open", question: "Question open" },
        { checkId: "recheck", question: "Question recheck" },
      ],
      answered: [{ checkId: "done", question: "Question done" }],
    })
  })

  it("puts open questions first, keeping the list's order", () => {
    const menu = entryMenu(STAFF, {
      venueName: "Lakeside",
      slots: [slot("a", { mode: "add", progress: "complete" }), slot("b", {})],
      tasks: [],
    })
    expect(menu?.questions.map((q) => q.checkId)).toEqual(["b", "a"])
  })

  it("gives a manager-only account Answer and Report a change only", () => {
    // Managers get answered questions in answer mode.
    const menu = entryMenu(MANAGER, {
      venueName: "Lakeside",
      slots: [
        slot("done", { progress: "complete", value: "yes" }),
        slot("open", {}),
      ],
      tasks,
    })
    expect(menu?.intents).toEqual(["question", "change"])
    expect(menu?.answered).toEqual([
      { checkId: "done", question: "Question done" },
    ])
  })

  it("is null without capabilities or without any choice (today's Add)", () => {
    expect(entryMenu(null, { venueName: "L", slots, tasks })).toBeNull()
    expect(
      entryMenu(MANAGER, { venueName: "L", slots: [], tasks: [] })
    ).toBeNull()
  })
})

describe("return paths (§4.3)", () => {
  it("allow-lists from values as relative /staff paths", () => {
    expect(fromHref("home")).toEqual({ origin: "home", href: "/staff/tasks" })
    expect(fromHref("menu")).toEqual({ origin: "menu", href: "/staff/menu" })
    expect(fromHref("me")).toEqual({ origin: "me", href: "/staff" })
    expect(fromHref("task:3f0c9a52-6b1d")).toEqual({
      origin: "task",
      href: "/staff/tasks/3f0c9a52-6b1d",
    })
    for (const bad of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/staff",
      "task:",
      "task:../admin",
      "task:a/b",
      "task:guide",
      "Home",
    ])
      expect(fromHref(bad)).toBeNull()
  })

  it("names the page someone is on", () => {
    expect(entryFrom("/staff/tasks")).toBe("home")
    expect(entryFrom("/staff/menu")).toBe("menu")
    expect(entryFrom("/staff")).toBe("me")
    expect(entryFrom("/staff/tasks/t1")).toBe("task:t1")
    expect(entryFrom("/staff/tasks/month")).toBe("task:month")
    expect(entryFrom("/staff/tasks/guide")).toBeNull()
    expect(entryFrom("/staff/community")).toBeNull()
    expect(entryFrom(null)).toBeNull()
  })

  it("adds from to an href, keeping its query and hash", () => {
    expect(withFrom("/staff/tasks/amenities/c1", "task:t1")).toBe(
      "/staff/tasks/amenities/c1?from=task%3At1"
    )
    expect(withFrom("/a?x=1#h", "me")).toBe("/a?x=1&from=me#h")
    expect(withFrom("/a", null)).toBe("/a")
  })
})

describe("entry copy", () => {
  it("states existing behaviour only, never public use (§4.2)", () => {
    const lines = [
      ENTRY_COPY.photosAudience,
      ENTRY_COPY.dishAudience,
      ENTRY_COPY.findingAudience,
      ENTRY_COPY.evidenceAudience,
    ]
    for (const line of lines) expect(line).not.toMatch(/public|guests|website/i)
    expect(ENTRY_COPY.venue("Lakeside")).toBe("For Lakeside")
  })

  it("says why Yes can't be sent by a manager account (§5.3)", () => {
    expect(yesRefusedLine("either")).toBe(
      "Yes needs a photo or video. This account can't add new photos or videos, and none of yours can be attached."
    )
  })

  it("names why uploads didn't finish (CA-11)", () => {
    expect(UPLOAD_WAIT_COPY.unfinished(1, "photo", "cancelled")).toBe(
      "Your photo was cancelled in Add. Add it again or choose another."
    )
    expect(UPLOAD_WAIT_COPY.unfinished(2, "mixed", "removed")).toBe(
      "Your 2 photos and videos were removed from Add. Add them again or choose others."
    )
    expect(UPLOAD_WAIT_COPY.unfinished(1, "video", "failed")).toBe(
      "Your video failed to save. Add it again or choose another."
    )
  })
})

describe("managerSentNoticeFor (CA-15)", () => {
  const view = (
    state: string,
    { self = false, requires = true }: { self?: boolean; requires?: boolean }
  ) =>
    ({
      myLatest: { answer: "yes", state },
      requiresConfirmation: requires,
      answerInUse: { confirmation: { self } },
    }) as unknown as Pick<
      WorkingSlot,
      "myLatest" | "answerInUse" | "requiresConfirmation"
    >

  it("confirmed by you", () => {
    expect(managerSentNoticeFor(view("current", { self: true }))?.body).toBe(
      "Confirmed by you. It's now the venue's answer."
    )
  })

  it("waits for another manager or an admin", () => {
    expect(managerSentNoticeFor(view("awaiting_confirmation", {}))?.body).toBe(
      "It waits for another manager or an admin to confirm it."
    )
  })

  it("in use straight away where no confirmation is needed", () => {
    expect(
      managerSentNoticeFor(view("current", { requires: false }))?.body
    ).toBe("It's now the venue's answer.")
  })

  it("nothing without a finding of theirs", () => {
    expect(
      managerSentNoticeFor({
        myLatest: null,
      } as unknown as Parameters<typeof managerSentNoticeFor>[0])
    ).toBeNull()
  })
})
