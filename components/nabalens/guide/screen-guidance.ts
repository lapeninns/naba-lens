/**
 * B10-05a in-app guidance: short lines shown on a screen, closed until asked
 * for. Every line is taken word for word from copy the app or its released
 * guides already use (b10-design §7.1: wording comes only from signed-off
 * sources); tests/unit/ops-guidance.test.ts proves each one still matches.
 * Nothing here adds a claim about ingredients, allergens, policies, credit or
 * review.
 *
 * Two gates keep it off until the product owner signs off the copy:
 * - the whole panel shows only when NABALENS_SCREEN_GUIDANCE=on (SW-15,
 *   default off; lib/config/screen-guidance.ts);
 * - a line marked awaiting_sign_off never shows, even when the panel is on. Its
 *   source copy is itself still waiting for sign-off.
 * GUIDANCE_TITLE is new wording: it is part of the sign-off the switch waits for.
 */

import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { GUIDE_SAFETY } from "@/lib/guide/dish-guide"

import {
  ANSWER_HINT,
  DRAFT_SAVED,
  KNOWLEDGE_ANSWER_LABEL,
} from "../knowledge/copy"

export const GUIDANCE_SCREENS = [
  "staff-home",
  "staff-capture",
  "manager-review",
] as const
export type GuidanceScreen = (typeof GUIDANCE_SCREENS)[number]

/** Proposed; the product owner signs it off with the switch (pending). */
export const GUIDANCE_TITLE = "Tips for this screen"

export type GuidanceSource =
  /** An exported copy constant, named for review. */
  | { kind: "copy"; ref: string }
  /** A released guide or a component: the exact text, whitespace aside. */
  | { kind: "quote"; file: string; quote: string }

export type GuidanceLine = {
  id: string
  screen: GuidanceScreen
  /** B10-05 training module the line belongs to (b10-design §7.3). */
  module: "T1" | "T2" | "T3" | "T4" | "T5"
  text: string
  source: GuidanceSource
  /** shipped: wording the app or its guides already use. awaiting_sign_off: its source still waits for the owner. */
  wording: "shipped" | "awaiting_sign_off"
}

/** Markdown emphasis removed, whitespace collapsed: how a quote reads on screen. */
export const plainQuote = (quote: string) =>
  quote.replace(/\*\*/g, "").replace(/\s+/g, " ").trim()

const quote = (
  file: string,
  text: string
): { text: string; source: GuidanceSource } => ({
  text: plainQuote(text),
  source: { kind: "quote", file, quote: text },
})

const STAFF_GUIDE = "docs/usage-staff.md"
const MANAGER_GUIDE = "docs/usage-manager.md"

export const GUIDANCE_LINES: readonly GuidanceLine[] = [
  {
    id: "G-01",
    screen: "staff-home",
    module: "T1",
    text: GUIDE_SAFETY,
    source: { kind: "copy", ref: "lib/guide/dish-guide.ts GUIDE_SAFETY" },
    wording: "shipped",
  },
  {
    id: "G-02",
    screen: "staff-home",
    module: "T1",
    ...quote(
      STAFF_GUIDE,
      "**Overdue** is shown for follow-up only: you can still send photos."
    ),
    wording: "shipped",
  },
  {
    id: "G-03",
    screen: "staff-home",
    module: "T1",
    text: DRAFT_SAVED.status,
    source: {
      kind: "copy",
      ref: "components/nabalens/knowledge/copy.ts DRAFT_SAVED.status",
    },
    wording: "shipped",
  },
  {
    id: "G-04",
    screen: "staff-home",
    module: "T2",
    text: ENTRY_COPY.photosAudience,
    source: {
      kind: "copy",
      ref: "components/nabalens/shell/entry-copy.ts ENTRY_COPY.photosAudience",
    },
    wording: "awaiting_sign_off",
  },
  {
    id: "G-05",
    screen: "staff-capture",
    module: "T1",
    text: `${KNOWLEDGE_ANSWER_LABEL.unknown}: ${ANSWER_HINT.unknown}`,
    source: {
      kind: "copy",
      ref: "components/nabalens/knowledge/copy.ts KNOWLEDGE_ANSWER_LABEL.unknown + ANSWER_HINT.unknown",
    },
    wording: "shipped",
  },
  {
    id: "G-06",
    screen: "staff-capture",
    module: "T4",
    ...quote(
      STAFF_GUIDE,
      "For **guest Wi-Fi**, cover the Wi-Fi password and the join QR code before you\ntake any photo or video, then tick **I have covered the Wi-Fi password and\njoin QR code**."
    ),
    wording: "shipped",
  },
  {
    id: "G-07",
    screen: "staff-capture",
    module: "T1",
    text: ENTRY_COPY.findingAudience,
    source: {
      kind: "copy",
      ref: "components/nabalens/shell/entry-copy.ts ENTRY_COPY.findingAudience",
    },
    wording: "awaiting_sign_off",
  },
  {
    id: "G-08",
    screen: "staff-capture",
    module: "T4",
    text: ENTRY_COPY.evidenceAudience,
    source: {
      kind: "copy",
      ref: "components/nabalens/shell/entry-copy.ts ENTRY_COPY.evidenceAudience",
    },
    wording: "awaiting_sign_off",
  },
  {
    id: "G-09",
    screen: "manager-review",
    module: "T5",
    ...quote(
      MANAGER_GUIDE,
      "**Ask for another photo** needs a reason (what the next photo should show)."
    ),
    wording: "shipped",
  },
  {
    id: "G-10",
    screen: "manager-review",
    module: "T5",
    ...quote(
      MANAGER_GUIDE,
      "After a network failure, trying again never decides twice."
    ),
    wording: "shipped",
  },
  {
    id: "G-11",
    screen: "manager-review",
    module: "T5",
    ...quote(
      "components/nabalens/amenities/capture/knowledge-fields.tsx",
      "It waits in To confirm until someone else decides."
    ),
    wording: "shipped",
  },
]

/** The lines a screen may show: shipped wording only, in registry order. */
export function shownGuidance(screen: GuidanceScreen): readonly GuidanceLine[] {
  return GUIDANCE_LINES.filter(
    (line) => line.screen === screen && line.wording === "shipped"
  )
}
