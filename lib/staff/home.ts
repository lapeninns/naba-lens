// Staff Home, a reminder to add photos (DESIGN.md §5c, D15): which words the
// reminder uses, from when the person last added photos at this venue.
// Home never chooses a slot to photograph. Pure, so the page and the tests
// share it.

import type { MyUpload } from "@/lib/staff/my-uploads"

export type Reminder =
  | { kind: "first" }
  | { kind: "today"; count: number; atLeast: boolean }
  | { kind: "since"; days: number }
  | { kind: "unknown" }

/** "YYYY-MM-DD" in the venue's calendar (Lapen Inns venues are in London). */
export function londonDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000

/**
 * The reminder's case (§5c step 5) from the person's newest photos, newest
 * first. Null `items` (the read failed) says nothing rather than guess.
 */
export function addReminder(
  items: readonly MyUpload[] | null,
  venueId: string | null,
  now: Date = new Date(),
  /** More photos exist than `items` holds, so a count may be a floor. */
  hasMore = false
): Reminder {
  if (items === null) return { kind: "unknown" }
  const mine = items.filter((item) => item.venueId === venueId)
  if (mine.length === 0) return { kind: "first" }
  const today = londonDay(now)
  const count = mine.filter(
    (item) => londonDay(new Date(item.uploadedAt)) === today
  ).length
  if (count > 0)
    return {
      kind: "today",
      count,
      // Every photo read was today's and there are more: count is a floor.
      atLeast:
        hasMore &&
        items.every((item) => londonDay(new Date(item.uploadedAt)) === today),
    }
  const last = londonDay(new Date(mine[0]!.uploadedAt))
  return {
    kind: "since",
    days: Math.max(1, Math.round(dayNumber(today) - dayNumber(last))),
  }
}

export const HOME_COPY = {
  reminderTitle: (r: Reminder) =>
    r.kind === "first"
      ? "Add your first photos"
      : r.kind === "today"
        ? "Got more from today?"
        : "Got photos from today?",
  reminderLine: (r: Reminder) =>
    r.kind === "first"
      ? "Dishes, drinks and corners of the venue you took on shift. Pick them from your gallery."
      : r.kind === "today"
        ? `You've added ${r.count}${r.atLeast ? " or more" : ""} ${r.count === 1 && !r.atLeast ? "photo" : "photos"} today.`
        : r.kind === "since"
          ? r.days === 1
            ? "Your last photos were yesterday."
            : `Your last photos were ${r.days} days ago.`
          : null,
  stillEmpty: (n: number, venue: string) =>
    `${n} ${n === 1 ? "slot" : "slots"} still empty at ${venue}`,
  recentTitle: "Recent activity",
  seeYourPhotos: "See all",
  recentEmpty: "Photos you send to this venue will appear here.",
  recentFailed: "Recent activity couldn’t be loaded. Reload to try again.",
}
