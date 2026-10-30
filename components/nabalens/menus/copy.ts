// Shared copy and small display helpers for the admin Menus screens (spec v0.3
// §2 meanings, §3 rules 5, 6 and 8). Pure: safe in Server and Client Components.

import type {
  MenuSectionKind,
  MenuSource,
  MenuVersionStatus,
} from "@/lib/menus/types"

/** Spec §2 "Activate": labelling only, never publication or availability. */
export const ACTIVE_MEANING_COPY =
  "Active means available for labelling photos and videos. It is not a public menu and not proof that the venue serves these items."

export const UNSUPPORTED_IMPORT_COPY =
  "PDF, image, Word and JavaScript menus are not supported. They are not read or parsed; convert the menu to JSON or CSV first."

export const LABELS_KEPT_COPY = "Existing labels on photos and videos are kept."

/** Result a page's Server Function returns to a menus control. */
export type MenuActionResult = { ok: true } | { ok: false; error: string }

export const MENU_STATUS_LABEL: Record<MenuVersionStatus, string> = {
  draft: "Draft",
  active: "Active",
  retired: "Retired",
  discarded: "Discarded",
}

export const MENU_STATUS_DESCRIPTION: Record<MenuVersionStatus, string> = {
  draft: "Being prepared. Staff cannot label with it until it is activated.",
  active: ACTIVE_MEANING_COPY,
  retired: `No longer used for new labels. ${LABELS_KEPT_COPY}`,
  discarded: "Abandoned draft. It was never used for labelling.",
}

export const SECTION_KIND_LABEL: Record<MenuSectionKind, string> = {
  food: "Food",
  drinks: "Drinks",
  other: "Other",
}

export const SOURCE_KIND_LABEL: Record<MenuSource["kind"], string> = {
  manual: "Entered by hand",
  json: "JSON file",
  csv: "CSV file",
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
})

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : dateTimeFormatter.format(date)
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "3 labelled photos/videos" style count used by diff, editor and archive. */
export function labelledFilesCopy(count: number): string {
  return `${count} labelled ${count === 1 ? "photo/video" : "photos/videos"}`
}
