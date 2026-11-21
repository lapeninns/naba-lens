// Staff Me, the account hub (DESIGN.md §5b, D17, D18): the words its rows
// show. Pure, so the page and the tests share it.

import type { MonthlyProgress } from "@/lib/server/coverage/types"

/** Your month's line (§5b step 5); never a comparison with anyone (§9). */
export function monthLine(month: MonthlyProgress | null): string {
  if (!month) return "Your target and progress"
  if (month.status === "needs_setup") return "Not set up yet"
  if (month.complete) return "Done for this month"
  return month.targetCount
    ? `${month.accepted} of ${month.targetCount} this month`
    : `${month.accepted} accepted this month`
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const ME_COPY = {
  title: "Me",
  month: "Your month",
  notices: "Notices",
  noticesLine: (unread: number | null) =>
    unread ? `${unread} unread` : "Retakes, jobs and photos that didn't send",
  otherJobs: "Other jobs",
  otherJobsLine: (n: number | null) =>
    n === null
      ? "Checks and venue questions. We couldn't count them."
      : `${plural(n, "job", "jobs")} · checks and venue questions`,
  venueGroup: "Your venue",
  colleaguesPhotos: "Colleagues' photos",
  colleaguesPhotosLine: "Accepted photos from your venue, newest first",
  // Posting (D21): the venue's Album posts, newest first.
  colleaguesPostsLine: "Photos your venue posted to the Album, newest first",
  people: "People",
  peopleLine: "Your colleagues and their photos",
  youGroup: "You",
  settings: "Settings",
  settingsLine: "Profile, work details, venues and appearance",
  help: "Help",
  helpLine: "How it works, the photo guide and your managers",
  logOut: "Log out",
}
