import Link from "next/link"
import {
  CheckCircleIcon,
  ClockIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { formatDate } from "@/components/nabalens/format"
import { LEGACY_QUALIFICATION_WORD } from "@/components/nabalens/knowledge/copy"
import { StatusChip, type ChipTone } from "@/components/nabalens/status-chip"
import {
  ANSWER_LABEL,
  EVIDENCE_RULE_LABEL,
  PROGRESS_LABEL,
  type CheckProgress,
  type CheckSummary,
} from "@/lib/amenities/contract"

const PROGRESS_TONE: Record<CheckProgress, ChipTone> = {
  needs_capture: "pending",
  needs_recheck: "attention",
  complete: "positive",
}

const PROGRESS_ICON = {
  needs_capture: ClockIcon,
  needs_recheck: WarningIcon,
  complete: CheckCircleIcon,
} as const

/** Needs capture / Needs recheck / Complete, with Archived for archived checks. */
export function ProgressChip({
  check,
  notConfirmed = false,
}: {
  check: CheckSummary
  /**
   * The knowledge view says the answer isn't confirmed (an incomplete
   * policy, B03 UI §4.3): never shown as the current answer.
   */
  notConfirmed?: boolean
}) {
  if (check.status === "archived")
    return <StatusChip tone="closed">Archived</StatusChip>
  if (notConfirmed) return <StatusChip state="not_confirmed" />
  // A qualified answer reads needs recheck but is an answer in use (§2.6).
  if (check.qualification)
    return (
      <StatusChip tone="attention">
        <WarningIcon aria-hidden />
        {LEGACY_QUALIFICATION_WORD[check.qualification]}
      </StatusChip>
    )
  const Icon = PROGRESS_ICON[check.progress]
  return (
    <StatusChip tone={PROGRESS_TONE[check.progress]}>
      <Icon aria-hidden />
      {PROGRESS_LABEL[check.progress]}
    </StatusChip>
  )
}

export function assigneeText(check: CheckSummary) {
  return check.assignee
    ? `Assigned to ${check.assignee.displayName ?? "a former team member"}`
    : "Unassigned"
}

/** When the answer was saved, not when its evidence was taken. */
export function answeredText(check: CheckSummary) {
  if (!check.answeredAt) return null
  const who = check.answeredBy?.displayName ?? "a former team member"
  return `Recorded by ${who} on ${formatDate(check.answeredAt)}`
}

/**
 * One check in a list: the question links to its page and its target covers
 * the whole row (at least 44px); facts wrap below. A row action sits above
 * the link's target.
 */
export function CheckRow({
  check,
  href,
  action,
  showAnswered,
  labelId,
}: {
  check: CheckSummary
  href: string
  action?: React.ReactNode
  showAnswered?: boolean
  /** Id on the question link, for a row action to describe itself by. */
  labelId?: string
}) {
  const answered = showAnswered ? answeredText(check) : null
  return (
    <li
      data-check-key={check.entry.key}
      data-check-id={check.id}
      data-archived={check.status === "archived" || undefined}
      className="relative flex min-h-11 min-w-0 flex-wrap items-start gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0 hover:bg-surface-2"
    >
      <div className="grid min-w-0 flex-1 basis-64 gap-1">
        <Link
          href={href}
          id={labelId}
          className="rounded-control text-body-touch font-semibold break-words text-ink underline-offset-3 outline-none after:absolute after:inset-0 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:text-body"
        >
          {check.entry.question}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta-touch text-ink-muted md:text-meta">
          <span>{check.entry.category}</span>
          <span aria-hidden>·</span>
          <span>Evidence: {EVIDENCE_RULE_LABEL[check.entry.evidenceRule]}</span>
          <span aria-hidden>·</span>
          <span>{assigneeText(check)}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta-touch text-ink-muted md:text-meta">
          <ProgressChip check={check} />
          <span>
            Answer:{" "}
            {check.qualification
              ? LEGACY_QUALIFICATION_WORD[check.qualification]
              : ANSWER_LABEL[check.answer]}
          </span>
          {answered ? (
            <>
              <span aria-hidden>·</span>
              <span>{answered}</span>
            </>
          ) : null}
        </p>
        {check.progress === "needs_recheck" &&
        check.recheckReason &&
        !check.qualification ? (
          <p className="text-meta-touch break-words text-ink md:text-meta">
            Recheck: {check.recheckReason}
          </p>
        ) : null}
      </div>
      {action ? <div className="relative shrink-0">{action}</div> : null}
    </li>
  )
}
