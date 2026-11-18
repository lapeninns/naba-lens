"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { setReviewerAction } from "@/app/manager/venue/actions"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  REVIEWER_ROLE_LABEL,
  REVIEWER_ROLES,
  type ReviewerRole,
  type VenueReviewers,
} from "@/lib/manager/venue"

/*
 * S2-MGR: Review assignments on the Venue hub (spec §7 M5, M1, §20). The
 * manager nominates a main and a backup reviewer from people who already
 * hold manager permission at the venue (the database refuses anyone else),
 * or leaves a role empty. When a reviewer leaves the venue the backup takes
 * over automatically; that change shows in History.
 */

export const REVIEWERS_COPY = {
  intro:
    "Choose who reviews photos here, and who covers when they are away. Only managers at this venue can be chosen.",
  nobody: "Nobody",
  noCandidates:
    "Nobody else here holds manager permission yet. Ask an admin to make someone a manager at this venue.",
  reason: "Reason (optional)",
  save: "Save reviewers",
  saving: "Saving",
  saved: "Reviewers saved.",
  failed: "That didn't save. Try again.",
  handover:
    "If the main reviewer stops managing this venue, the backup takes over.",
} as const

type SetReviewer = (
  input: unknown
) => Promise<
  | { ok: true; reviewers: VenueReviewers }
  | { ok: false; message: string; field?: string }
>

export function ReviewersForm({
  reviewers,
  onSet = setReviewerAction,
}: {
  reviewers: VenueReviewers
  onSet?: SetReviewer
}) {
  const router = useRouter()
  const [view, setView] = useState(reviewers)
  const [choice, setChoice] = useState<Record<ReviewerRole, string | null>>({
    main: reviewers.main?.profileId ?? null,
    backup: reviewers.backup?.profileId ?? null,
  })
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState<
    { kind: "saved" } | { kind: "error"; message: string } | null
  >(null)
  const [pending, start] = useTransition()

  const options = view.candidates.map((c) => ({
    id: c.profileId,
    name: c.name,
  }))
  const same =
    choice.main === choice.backup && choice.main !== null
      ? "Choose two different people."
      : null

  function save() {
    start(async () => {
      setStatus(null)
      let latest = view
      // Backup first when someone moves from backup to main, so the person
      // never holds both roles; the database moves them either way.
      const order: ReviewerRole[] =
        choice.main && choice.main === view.backup?.profileId
          ? ["main", "backup"]
          : ["backup", "main"]
      for (const role of order) {
        const current = latest[role]?.profileId ?? null
        if (current === choice[role]) continue
        const result = await onSet({
          role,
          profileId: choice[role],
          reason: reason.trim() || undefined,
        })
        if (!result.ok) {
          setStatus({
            kind: "error",
            message: result.message || REVIEWERS_COPY.failed,
          })
          return
        }
        latest = result.reviewers
      }
      setView(latest)
      setChoice({
        main: latest.main?.profileId ?? null,
        backup: latest.backup?.profileId ?? null,
      })
      setReason("")
      setStatus({ kind: "saved" })
      router.refresh()
    })
  }

  return (
    <form
      data-slot="reviewers-form"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!same) save()
      }}
    >
      <p className="text-body text-ink-muted">{REVIEWERS_COPY.intro}</p>
      {options.length === 0 ? (
        <p role="status" className="text-body text-ink">
          {REVIEWERS_COPY.noCandidates}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {REVIEWER_ROLES.map((role) => (
          <FormField
            key={role}
            label={REVIEWER_ROLE_LABEL[role]}
            optional
            error={role === "backup" ? same : undefined}
          >
            <OptionSelect
              options={options}
              value={choice[role]}
              emptyLabel={REVIEWERS_COPY.nobody}
              onValueChange={(value) =>
                setChoice((prev) => ({ ...prev, [role]: value }))
              }
              disabled={pending}
            />
          </FormField>
        ))}
      </div>
      <FormField label={REVIEWERS_COPY.reason} optional>
        <Input
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
        />
      </FormField>
      <p className="text-body text-ink-muted">{REVIEWERS_COPY.handover}</p>
      <Button
        type="submit"
        variant="secondary"
        className="justify-self-start max-md:w-full"
        loading={pending}
        loadingLabel={REVIEWERS_COPY.saving}
        disabled={options.length === 0}
      >
        {REVIEWERS_COPY.save}
      </Button>
      <p aria-live="polite" className="text-body">
        {status?.kind === "saved" ? (
          <span className="text-ink">{REVIEWERS_COPY.saved}</span>
        ) : status?.kind === "error" ? (
          <span role="alert" className="text-warn-fg">
            {status.message}
          </span>
        ) : null}
      </p>
    </form>
  )
}
