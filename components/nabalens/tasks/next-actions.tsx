"use client"

import Link from "next/link"
import { EVIDENCE_RULE_LABEL, staffCaptureHref } from "@/lib/amenities/contract"
import type { CheckCard as CheckCardData } from "./next-actions-model"
import { StatusChip } from "./status-badges"
import { action, cardClass, titleClass, TopRow } from "./todo-list"

const checkLinkId = (checkId: string) => `todo-check-${checkId}`

function CheckCard({
  check,
  recheck,
  primary,
}: {
  check: CheckCardData
  recheck: boolean
  primary: boolean
}) {
  return (
    <li className={cardClass(primary, recheck ? "warn" : "info")}>
      <TopRow
        kicker={<>Amenity check: {check.category}</>}
        chip={
          <StatusChip tone={recheck ? "warning" : "info"}>
            {check.chip}
          </StatusChip>
        }
      />
      <h3 className={titleClass(primary)}>{check.question}</h3>
      {recheck && check.recheckReason ? (
        <p className="text-body [overflow-wrap:anywhere] text-ink">
          <span className="font-semibold">Recheck reason:</span>{" "}
          {check.recheckReason}
        </p>
      ) : null}
      <p className="text-body text-ink-muted">
        Evidence: {EVIDENCE_RULE_LABEL[check.evidenceRule]}
      </p>
      <Link
        id={checkLinkId(check.checkId)}
        href={staffCaptureHref(check.checkId)}
        aria-label={`${check.action}: ${check.question}`}
        className={action(primary)}
      >
        {check.action}
      </Link>
    </li>
  )
}

/**
 * Other jobs (B03-e): my open recheck tasks as check cards, none of them
 * the page's blue action. Nothing when empty.
 */
export function RecheckCards({
  checks,
  label,
}: {
  checks: readonly CheckCardData[]
  label: string
}) {
  if (checks.length === 0) return null
  return (
    <ul aria-label={label} className="grid gap-gutter">
      {checks.map((check) => (
        <CheckCard key={check.checkId} check={check} recheck primary={false} />
      ))}
    </ul>
  )
}
