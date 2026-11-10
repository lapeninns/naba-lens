import Link from "next/link"

import { amenityHrefs } from "@/lib/amenities/contract"
import type { ToConfirmRow } from "@/lib/knowledge-client/contract"
import { dishName } from "@/lib/menus/dish-name"
import type { QueueCard } from "@/lib/server/menu-photos/types"
import type { Merged, ReviewKind } from "@/lib/work-client/triage"

import {
  dateAndTime,
  KNOWLEDGE_ANSWER_LABEL,
  toConfirmLine,
  TO_CONFIRM_COPY,
} from "../../knowledge/copy"
import { StatusChip } from "../../status-chip"
import { managerHrefs } from "../hrefs"
import { CardStateChip } from "./review-card"

export const REVIEW_KIND_COPY = {
  label: "Show",
  kinds: { photos: "Photos", findings: "Findings", all: "All" },
  waitingSince: (at: string) => `Waiting since ${dateAndTime(at)}`,
  disputes: "Disagrees with the answer in use",
  photo: "Photo",
  from: (name: string) => `From ${name}`,
  heldBack: "More photos are waiting. See Photos for the rest.",
  nothing: "Nothing waiting.",
} as const

export function reviewKindHref(kind: ReviewKind): string {
  return kind === "photos"
    ? managerHrefs.review()
    : `${managerHrefs.review()}?kind=${kind}`
}

/** Photos · Findings · All. Links, so each view has its own URL. */
export function ReviewKindFilter({ active }: { active: ReviewKind }) {
  return (
    <nav aria-label={REVIEW_KIND_COPY.label} className="flex flex-wrap gap-2">
      {(["photos", "findings", "all"] as const).map((kind) => (
        <Link
          key={kind}
          href={reviewKindHref(kind)}
          aria-current={kind === active ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-round border border-border-strong px-4 text-body font-semibold text-ink outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid aria-[current=page]:bg-ink aria-[current=page]:text-surface"
        >
          {REVIEW_KIND_COPY.kinds[kind]}
        </Link>
      ))}
    </nav>
  )
}

const ROW_LINK =
  "grid min-h-16 min-w-0 gap-1 p-4 outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"

/** When a To confirm row started waiting (R4), else its send time. */
export const findingWaitingAt = (row: ToConfirmRow) =>
  row.waitingSince ?? row.sentAt

/** Review age counts from labelling when known (MG-28). */
export const photoWaitingAt = (card: QueueCard) =>
  card.labelledAt ?? card.uploadedAt

function FindingEntry({ row }: { row: ToConfirmRow }) {
  const at = findingWaitingAt(row)
  return (
    <li data-entry="finding">
      <Link
        href={`${amenityHrefs(managerHrefs.overview).check(row.checkId)}#amenity-to-confirm`}
        className={ROW_LINK}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-item-title [overflow-wrap:anywhere] text-ink">
            {row.question}
          </span>
          <StatusChip state="awaiting_confirmation" />
        </span>
        <span className="text-body text-ink">{toConfirmLine([row])}</span>
        {row.answer ? (
          <span className="text-meta text-ink-muted">
            Answer: {KNOWLEDGE_ANSWER_LABEL[row.answer]}
          </span>
        ) : null}
        {row.disputes ? (
          <span className="text-meta text-ink-muted">
            {REVIEW_KIND_COPY.disputes}
          </span>
        ) : null}
        {at ? (
          <span className="text-meta text-ink-muted">
            {REVIEW_KIND_COPY.waitingSince(at)}
          </span>
        ) : null}
      </Link>
    </li>
  )
}

function PhotoEntry({ card }: { card: QueueCard }) {
  return (
    <li data-entry="photo">
      <Link
        href={
          card.item
            ? managerHrefs.review({ item: card.item.itemId })
            : managerHrefs.review()
        }
        className={ROW_LINK}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-item-title [overflow-wrap:anywhere] text-ink">
            {card.item
              ? dishName({
                  name: card.item.name,
                  variantName: card.item.variantName,
                })
              : REVIEW_KIND_COPY.photo}
          </span>
          <CardStateChip card={card} />
        </span>
        <span className="text-body text-ink">
          {REVIEW_KIND_COPY.from(card.contributor.name)}
        </span>
        <span className="text-meta text-ink-muted">
          {REVIEW_KIND_COPY.waitingSince(photoWaitingAt(card))}
        </span>
      </Link>
    </li>
  )
}

const LIST =
  "grid min-w-0 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"

/** Findings: the To confirm rows in the server's order (R4), one per finding. */
export function FindingsView({ rows }: { rows: readonly ToConfirmRow[] }) {
  if (rows.length === 0)
    return <p className="text-body text-ink-muted">{TO_CONFIRM_COPY.empty}</p>
  return (
    <ul aria-label={REVIEW_KIND_COPY.kinds.findings} className={LIST}>
      {rows.map((row, index) => (
        <FindingEntry key={`${row.checkId}:${index}`} row={row} />
      ))}
    </ul>
  )
}

/** All: photos and findings by waiting time; each links to its own screen. */
export function AllView({
  entries,
  heldBack,
}: {
  entries: readonly Merged<QueueCard, ToConfirmRow>[]
  heldBack: number
}) {
  return (
    <div className="grid gap-3">
      {entries.length === 0 ? (
        <p className="text-body text-ink-muted">{REVIEW_KIND_COPY.nothing}</p>
      ) : (
        <ul aria-label={REVIEW_KIND_COPY.kinds.all} className={LIST}>
          {entries.map((entry, index) =>
            entry.kind === "photo" ? (
              <PhotoEntry key={`p:${entry.value.key}`} card={entry.value} />
            ) : (
              <FindingEntry
                key={`f:${entry.value.checkId}:${index}`}
                row={entry.value}
              />
            )
          )}
        </ul>
      )}
      {heldBack > 0 ? (
        <Link
          href={reviewKindHref("photos")}
          className="inline-flex min-h-11 items-center justify-self-start rounded-control text-body text-ink underline underline-offset-2 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {REVIEW_KIND_COPY.heldBack}
        </Link>
      ) : null}
    </div>
  )
}
