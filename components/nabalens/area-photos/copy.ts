// G-9 strings (temporary home: G-5 owns the copy files and moves these into
// components/nabalens/tasks/copy.ts and menu-photos/copy.ts at the end).
// Plain British English; staff copy never says "any photo counts".

export const AREA_COPY = {
  /** Decision 5's month line once G-9 lands (for the month screen; G-5). */
  monthCounts:
    "Accepted photos you labelled — dishes, drinks and venue areas — and photos you sent to the month, count",
  fieldLabel: "Venue area",
  fieldHint:
    "Not a dish or a drink? Choose the part of the venue it shows. Once accepted, it counts toward your month.",
  none: "No area",
  noPlaces: "Your manager hasn't listed this venue's areas yet.",
  loadFailed: "Venue areas couldn't be loaded.",
  saveFailed: "The venue area wasn't saved. Try again.",
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
    accept: "Accept",
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
