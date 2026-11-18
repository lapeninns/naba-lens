// Where a staff notice leads (spec §17; FA-10; S2-STAFF). Pure: the inbox
// itself is read through lib/server/notifications. A retake opens its slot
// with the reviewer's reason (AC17); a check given to the person opens it;
// an upload problem opens Me, where My uploads shows it.
import type { AppNotification } from "@/lib/ops/notifications"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null)

export function noticeHref(n: AppNotification): string {
  const p = n.payload
  switch (n.kind) {
    case "retake_requested": {
      const item = id(p.itemId)
      if (p.source === "menu_photo" && item)
        return `/staff/album/slot/dish/${item}`
      const subject = id(p.subjectId)
      if (p.source === "area" && subject)
        return `/staff/album/slot/area/${subject}`
      return "/staff"
    }
    case "assigned": {
      const check = id(p.checkId) ?? id(n.subjectId)
      return check ? `/staff/tasks/amenities/${check}` : "/staff/tasks/other"
    }
    default:
      return "/staff"
  }
}

export const NOTICES_COPY = {
  title: "Notices",
  summary:
    "Retakes, checks given to you and photos that didn't send. They stay here until you read them.",
  empty: "No notices. Retakes and checks given to you appear here.",
  failed:
    "Your notices couldn't be loaded. Check your connection and reload the page.",
  markAll: "Mark all as read",
  marked: "All marked as read.",
  unread: "New",
  older: "Show older notices",
  prefsTitle: "What to tell you about",
  prefsSummary:
    "Notices appear here and as a number on Me, never as pop-ups. Nothing is sent between 21:00 and 08:00 at your venue.",
  retakes: "Retakes asked for",
  assignments: "Checks given to you",
  uploadProblems: "Photos that didn't send",
  saved: "Saved.",
  prefsFailed: "Your choices couldn't be loaded. Reload the page.",
} as const
