// Words of Review in a thumb (DESIGN.md §6.5, §7): Keep in the album and Ask
// for another photo (redesign R4, ia.md decision 3; "Accept" and "Ask again"
// are retired), never approve or reject. The photo detail page keeps the
// finer decisions. Pure: safe in Server and Client Components.

export const ALBUM_REVIEW_COPY = {
  /** The page title is the queue count (§6.5). */
  title: (count: number) =>
    count === 0
      ? "Nothing to review"
      : count === 1
        ? "1 photo to review"
        : `${count} photos to review`,
  accept: "Keep in the album",
  askAgain: "Ask for another photo",
  cancel: "Cancel",
  sending: "Sending",
  reasonsHeading: "What should the next photo fix?",
  other: "Other",
  otherLabel: "What should the next photo show?",
  otherSend: "Ask for another photo",
  otherEmpty: "Say what the next photo should show.",
  by: (name: string) => `By ${name}`,
  photoAlt: (name: string, author: string) => `${name}, photo by ${author}`,
  noPhoto: "This photo can't be shown here. Open the full list to see it.",
  stageLabel: "Photo to review",
  briefLabel: "Brief",
  /** What the last decision did, written on the page (§6.7). */
  accepted: (name: string) => `${name} is in the album.`,
  askedAgain: (name: string, reason: string) =>
    `Asked for another photo of ${name}: ${reason}.`,
  emptyTitle: "Every photo is reviewed",
  emptyBody:
    "New photos show here as staff add them. Each one already fills its slot as Waiting.",
  own: (count: number) =>
    count === 1
      ? "1 of your own photos is waiting. Another reviewer decides on it."
      : `${count} of your own photos are waiting. Another reviewer decides on them.`,
  ownRefused: "This is your photo. Another reviewer decides on it.",
  next: "Next photo",
  allPhotos: "See every photo as a list",
  /** S2-REVIEW: the current photo's review detail. */
  details: "Details, Fix label and more decisions",
  failed: "That decision wasn't sent. Check your signal and try again.",
  moreFailed: "The next photos didn't load. Try again.",
  moreRetry: "Load the next photos",
  goneElsewhere: "Someone already decided on this photo. Here is the next one.",
} as const
