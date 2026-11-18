"use client"

import * as React from "react"
import { CheckIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { CONTRIBUTION_NOTICE } from "@/lib/auth/venues"

/*
 * The first sign-in notice (spec §3.2; S1-PEOPLE's record, S2-STAFF's
 * screen): where the person works and as what, and how their photos are
 * used, with "I understand" recorded once per notice version
 * (acknowledge_contribution_notice). Shown on the welcome, and as Start
 * here on Album until it is accepted.
 */
export const NOTICE_COPY = {
  workingAt: (venue: string, role: string) =>
    `You work at ${venue} as ${role.toLowerCase()}.`,
  noVenue: "You are not at a venue yet. An admin adds you to one.",
  accept: "I understand",
  accepted: "You have read this.",
  failed: "This couldn't be saved. Check your connection and try again.",
} as const

export function ContributionNoticeCard({
  venueName,
  roleLabel,
  acknowledged,
  acknowledge,
}: {
  venueName: string | null
  roleLabel: string
  /** Already accepted for this version. */
  acknowledged: boolean
  acknowledge: () => Promise<{ ok: boolean }>
}) {
  const [done, setDone] = React.useState(acknowledged)
  const [error, setError] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  return (
    <section
      aria-labelledby="contribution-notice"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
      data-slot="contribution-notice"
    >
      <p className="text-heading [overflow-wrap:anywhere] text-ink">
        {venueName
          ? NOTICE_COPY.workingAt(venueName, roleLabel)
          : NOTICE_COPY.noVenue}
      </p>
      <h2
        id="contribution-notice"
        className="type-section-title [overflow-wrap:anywhere] text-ink"
      >
        {CONTRIBUTION_NOTICE.title}
      </h2>
      <ul className="grid list-disc gap-1.5 pl-5 text-body text-ink">
        {CONTRIBUTION_NOTICE.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {done ? (
        <p
          className="flex items-center gap-2 text-body text-ink-muted"
          role="status"
        >
          <CheckIcon aria-hidden weight="bold" className="size-5 text-ok-fg" />
          {NOTICE_COPY.accepted}
        </p>
      ) : (
        <Button
          variant="secondary"
          className="justify-self-start"
          loading={pending}
          onClick={async () => {
            setPending(true)
            setError(false)
            try {
              const result = await acknowledge()
              if (result.ok) setDone(true)
              else setError(true)
            } catch {
              setError(true)
            } finally {
              setPending(false)
            }
          }}
        >
          {NOTICE_COPY.accept}
        </Button>
      )}
      {error ? (
        <Notice tone="negative" role="alert">
          {NOTICE_COPY.failed}
        </Notice>
      ) : null}
    </section>
  )
}
