import type { EntryIntent, EntryOrigin } from "@/lib/work-client/entry"

/**
 * The shared entry's words (B02 UI design §4.1, §4.2). Audience lines state
 * existing behaviour only; nothing here claims public use.
 */
export const ENTRY_COPY = {
  title: "What are you adding?",
  venue: (venueName: string) => `For ${venueName}`,
  /**
   * D4: who sees photos, from existing behaviour (portfolio, and Photos for
   * colleagues). The exact words are to be checked with WS3 and the owner
   * before release; change them here only.
   */
  photosAudience:
    "Saved to your portfolio and shared in Photos with colleagues.",
  dishAudience: "A manager decides whether it's used for the menu.",
  findingAudience: "Your manager sees this.",
  evidenceAudience: "Kept out of Photos. Used as evidence for venue questions.",
  intents: {
    dish: "A dish or drink",
    task: "Photos for a task",
    question: "Answer a venue question",
    change: "Report a change",
    photos: "Just photos",
  } satisfies Record<EntryIntent, string>,
  // Headings of the picker steps.
  pick: {
    task: "Which task?",
    question: "Which question?",
    change: "Which answer has changed?",
  },
  back: "Back",
  cancel: "Cancel",
  // B02-05 (§7): several photos of one subject, and capture guidance.
  guideTitle: "What a useful photo shows",
  addMoreToSet: "Add more to this set",
  setSaved: (n: number, subject: string) =>
    `${n} ${n === 1 ? "photo" : "photos"} of ${subject} saved. Each is reviewed on its own.`,
} as const

/** The back link on a capture page opened with `from`. */
export const FROM_BACK_LABEL: Record<EntryOrigin, string> = {
  home: "Home",
  menu: "Our menu",
  me: "Me",
  task: "Back to the task",
}

/**
 * MO capture page, Yes with nothing to attach (§5.3). `rule` reads after
 * "Yes needs".
 */
export const YES_NEEDS_RULE = {
  photo: "a photo",
  video: "a video",
  either: "a photo or video",
  both: "a photo and a video",
} as const

export function yesRefusedLine(rule: keyof typeof YES_NEEDS_RULE): string {
  return `Yes needs ${YES_NEEDS_RULE[rule]}. This account can't add new photos or videos, and none of yours can be attached.`
}
