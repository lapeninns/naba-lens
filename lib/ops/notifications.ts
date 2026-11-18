// In-app notifications (spec §17; FA-10; 20261118106200_ops_notifications.sql).
// Pure and client-safe: parsing the inbox read and the words each notice
// shows. Notices are an inbox list and badges, never toasts (DESIGN.md §9).
// Staff words follow FA-7 (Retake, with the reviewer's reason).

export type NotificationKind =
  | "retake_requested"
  | "assigned"
  | "upload_problem"
  | "review_digest"
  | "exception"
  /** S2-REVIEW: a reviewer matched the person's photo to another dish (FA-7). */
  | "label_corrected"

export type NotificationState = "unread" | "read" | "resolved"

export type AppNotification = {
  id: number
  kind: NotificationKind
  subjectType: string
  subjectId: string | null
  venueId: string | null
  venueName: string | null
  payload: Record<string, unknown>
  createdAt: string
  state: NotificationState
}

export type Inbox = {
  items: AppNotification[]
  unread: number
  nextBefore: number | null
}

const KINDS = new Set<string>([
  "retake_requested",
  "assigned",
  "upload_problem",
  "review_digest",
  "exception",
  "label_corrected",
])
const STATES = new Set<string>(["unread", "read", "resolved"])

export function parseInbox(data: unknown): Inbox | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.items)) return null
  const items = d.items.flatMap((raw): AppNotification[] => {
    const r = raw as Record<string, unknown>
    if (
      typeof r.id !== "number" ||
      !KINDS.has(r.kind as string) ||
      !STATES.has(r.state as string) ||
      typeof r.createdAt !== "string" ||
      typeof r.subjectType !== "string"
    )
      return []
    return [
      {
        id: r.id,
        kind: r.kind as NotificationKind,
        subjectType: r.subjectType,
        subjectId: typeof r.subjectId === "string" ? r.subjectId : null,
        venueId: typeof r.venueId === "string" ? r.venueId : null,
        venueName: typeof r.venueName === "string" ? r.venueName : null,
        payload:
          r.payload && typeof r.payload === "object"
            ? (r.payload as Record<string, unknown>)
            : {},
        createdAt: r.createdAt,
        state: r.state as NotificationState,
      },
    ]
  })
  return {
    items,
    unread: typeof d.unread === "number" ? d.unread : 0,
    nextBefore: typeof d.nextBefore === "number" ? d.nextBefore : null,
  }
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null)
const num = (v: unknown) => (typeof v === "number" ? v : 0)
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

export const EXCEPTION_WORDS: Record<string, string> = {
  storage: "Storage is nearly full",
  processing: "Uploads are failing to process",
  job: "A background job failed",
  archive: "The original archive check failed",
  preparation: "Monthly preparation failed",
  backlog: "Photos have waited too long for review",
  venue_setup: "A venue is not fully set up",
}

/** What one notice says: a title and an optional line under it. */
export function notificationWords(n: AppNotification): {
  title: string
  detail: string | null
} {
  const p = n.payload
  switch (n.kind) {
    case "retake_requested": {
      const what =
        text(p.itemName) ??
        text(p.placeName) ??
        (p.source === "checklist" ? "a checklist photo" : "a photo")
      return { title: `Retake: ${what}`, detail: text(p.reason) }
    }
    case "label_corrected":
      return {
        title: `Label corrected: ${text(p.itemName) ?? "a photo"}`,
        detail: text(p.fromItemName)
          ? `You labelled it ${text(p.fromItemName)}. Nothing to do.`
          : "Nothing to do.",
      }
    case "assigned":
      return {
        title: "A check was given to you",
        detail: text(p.question)?.replaceAll("_", " ") ?? null,
      }
    case "upload_problem":
      return p.problem === "labels_not_applied"
        ? {
            title: "A photo's slot could not be saved",
            detail: "Open Me to match it again.",
          }
        : {
            title: "A photo did not send",
            detail: "Open Me to try again or remove it.",
          }
    case "review_digest": {
      const waiting = num(p.waiting)
      const overdue = num(p.overdueChecks)
      const parts = [
        waiting > 0 ? `${plural(waiting, "photo")} waiting for review` : null,
        overdue > 0 ? `${plural(overdue, "check")} past due` : null,
      ].filter(Boolean)
      return {
        title: text(p.venueName) ?? n.venueName ?? "Your venue",
        detail: parts.join(" · ") || null,
      }
    }
    case "exception": {
      const topic = text(p.topic) ?? ""
      const title = EXCEPTION_WORDS[topic] ?? "Something needs attention"
      return { title, detail: n.venueName }
    }
  }
}

export type NotificationPreferences = {
  retakes: boolean
  assignments: boolean
  uploadProblems: boolean
  digests: boolean
  quietStart: string | null
  quietEnd: string | null
  organisationQuietStart: string
  organisationQuietEnd: string
  timezone: string
}

export function parsePreferences(
  data: unknown
): NotificationPreferences | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  const bool = (k: string) =>
    typeof d[k] === "boolean" ? (d[k] as boolean) : null
  const retakes = bool("retakes")
  const assignments = bool("assignments")
  const uploadProblems = bool("uploadProblems")
  const digests = bool("digests")
  if (
    retakes === null ||
    assignments === null ||
    uploadProblems === null ||
    digests === null
  )
    return null
  return {
    retakes,
    assignments,
    uploadProblems,
    digests,
    quietStart: typeof d.quietStart === "string" ? d.quietStart : null,
    quietEnd: typeof d.quietEnd === "string" ? d.quietEnd : null,
    organisationQuietStart:
      typeof d.organisationQuietStart === "string"
        ? d.organisationQuietStart
        : "21:00",
    organisationQuietEnd:
      typeof d.organisationQuietEnd === "string"
        ? d.organisationQuietEnd
        : "08:00",
    timezone: typeof d.timezone === "string" ? d.timezone : "Europe/London",
  }
}
