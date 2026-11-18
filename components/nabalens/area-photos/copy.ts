// Venue area labels and review (G-9, decision 24). Plain British English;
// staff copy never says "any photo counts". The month line lives with Your
// month in tasks/copy.ts (HOME_MONTH_COPY.counts); it is re-exported here.

import { CHIP_STATES } from "../status-chip"
import { INBOX_COPY } from "../manager/review/inbox-copy"
import { HOME_MONTH_COPY } from "../tasks/copy"

export const AREA_COPY = {
  /** Decision 5's month line, amended by G-9 (HOME_MONTH_COPY.counts). */
  monthCounts: HOME_MONTH_COPY.counts,
  fieldLabel: "Venue area",
  fieldHint:
    "Not a dish or a drink? Choose the part of the venue it shows. Once accepted, it counts toward your month.",
  none: "No area",
  noPlaces: "Your manager hasn't listed this venue's areas yet.",
  loadFailed: "Venue areas couldn't be loaded.",
  saveFailed: "The venue area wasn't saved.",
  retry: "Try again",
  mixed:
    "These photos have different areas. Choose one to give them all the same area.",
  saving: "Saving…",
  saved: "Saved",
  state: {
    pending: "Waiting for review",
    accepted: "Accepted",
    needs_another_photo: "Needs another photo",
    withdrawn: "Withdrawn",
  },
  review: {
    heading: "Venue area photos",
    summary:
      "Photos staff labelled with a part of the venue. An accepted photo counts toward their month.",
    empty: "No venue area photos are waiting for review.",
    decidedHeading: "Decided recently",
    // S3-R13: manager review words (DESIGN.md §7, departure A-REV-1).
    accept: INBOX_COPY.publicUse.action,
    state: {
      pending: CHIP_STATES.coverage_pending.word,
      accepted: "Accepted",
      needs_another_photo: CHIP_STATES.coverage_replacement_needed.word,
      withdrawn: "Withdrawn",
    },
    askAnother: "Ask for another photo",
    withdraw: "Withdraw",
    reasonLabel: "What should the next photo show?",
    withdrawReasonLabel: "Why is this photo withdrawn?",
    send: "Send",
    cancel: "Cancel",
    own: "Your photo. Another reviewer decides on it.",
    countsFor: (month: string) => `Counts for ${month}`,
    by: (name: string) => `By ${name}`,
    failed: "Venue area photos couldn't be loaded.",
  },
} as const
