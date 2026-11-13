import {
  ArrowsClockwiseIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  ImagesIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Row, SectionHeader } from "@/components/nabalens/common-room"
import { dateAndTime, longDate } from "@/components/nabalens/knowledge/copy"
import type {
  TriageQueue,
  TriageRow,
  TriageRowQueue,
} from "@/lib/work-client/contract"

export const TRIAGE_HEADING_ID = "overview-triage"

export const TRIAGE_COPY = {
  title: "Triage",
  menuPhotos: (n: number, oldest: string | null) =>
    `Menu photos to review: ${n}${oldest ? `, oldest ${dateAndTime(oldest)}` : ""}`,
  findings: (n: number, oldest: string | null) =>
    `Findings to confirm: ${n}${oldest ? `, oldest ${dateAndTime(oldest)}` : ""}`,
  checklist: (n: number) => `Checklist photos to review: ${n}`,
  rechecks: (n: number, oldest: string | null) =>
    `Rechecks due: ${n}${oldest ? `, oldest due ${longDate(oldest)}` : ""}`,
  suggestions: (n: number, oldest: string | null) =>
    `Imports to decide: ${n}${oldest ? `, oldest ${dateAndTime(oldest)}` : ""}`,
} as const

/** B03 rows show only where the caller gives them a page to go to. */
export type TriageHrefs = Record<TriageQueue, string> &
  Partial<Record<Exclude<TriageRowQueue, TriageQueue>, string>>

const ICON: Record<TriageRowQueue, React.ReactNode> = {
  menu_photos: <ImagesIcon />,
  findings: <ShieldCheckIcon />,
  checklist: <ClipboardTextIcon />,
  rechecks: <ArrowsClockwiseIcon />,
  suggestions: <DownloadSimpleIcon />,
}

/** Rows grouped in one white card with hairlines. */
const ROW_LIST =
  "grid min-w-0 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card [&_[data-slot=cr-row]]:rounded-none [&_[data-slot=cr-row]]:shadow-none [&_[data-slot=cr-row]]:focus-visible:-outline-offset-3"

/**
 * The Triage card (UI design §6.2): one row per queue the caller can act on,
 * side by side and never summed (D6). A queue that isn't available is left
 * out, never shown as zero. The caller's own photos waiting for someone else
 * are their own line under the photo row, never part of its number.
 */
export function TriageCard({
  rows,
  hrefs,
  ownWaiting,
}: {
  rows: readonly TriageRow[]
  hrefs: TriageHrefs
  /** Today's wording and link for my own waiting photos; null hides it. */
  ownWaiting?: ((n: number) => { text: string; href: string }) | null
}) {
  const lines: {
    key: string
    title: string
    href: string
    icon: React.ReactNode
  }[] = []
  for (const row of rows) {
    if (!row.available) continue
    const href = hrefs[row.queue]
    if (!href) continue
    const title =
      row.queue === "menu_photos"
        ? TRIAGE_COPY.menuPhotos(row.waiting, row.oldestWaitingAt)
        : row.queue === "findings"
          ? TRIAGE_COPY.findings(row.waiting, row.oldestWaitingAt)
          : row.queue === "rechecks"
            ? TRIAGE_COPY.rechecks(row.waiting, row.oldestWaitingAt)
            : row.queue === "suggestions"
              ? TRIAGE_COPY.suggestions(row.waiting, row.oldestWaitingAt)
              : TRIAGE_COPY.checklist(row.waiting)
    lines.push({
      key: row.queue,
      title,
      href,
      icon: ICON[row.queue],
    })
    if (row.queue === "menu_photos" && row.ownWaiting > 0 && ownWaiting) {
      const own = ownWaiting(row.ownWaiting)
      lines.push({ key: "own", ...own, title: own.text, icon: <UserIcon /> })
    }
  }
  if (lines.length === 0) return null
  return (
    <section
      aria-labelledby={TRIAGE_HEADING_ID}
      className="grid gap-(--gutter)"
    >
      <SectionHeader id={TRIAGE_HEADING_ID} title={TRIAGE_COPY.title} />
      <ul className={ROW_LIST}>
        {lines.map((line) => (
          <li key={line.key} data-triage={line.key}>
            <Row href={line.href} icon={line.icon} title={line.title} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The findings queue's count, for a To confirm badge; null when not shown. */
export function triageConfirmCount(rows: readonly TriageRow[]): number | null {
  const row = rows.find((r) => r.queue === "findings")
  return row?.available ? row.waiting : null
}
