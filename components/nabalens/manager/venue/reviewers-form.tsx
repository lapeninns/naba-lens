"use client"

import { MetaList } from "@/components/nabalens/meta-list"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { setReviewerAction } from "@/app/manager/venue/actions"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { REVIEWER_ROLE_LABEL, type VenueReviewers } from "@/lib/manager/venue"

/*
 * S2-MGR, S3-R5: Review assignments on the Venue hub (spec §7 M5, M1, §20).
 * The admin names the main reviewer (§8 A2); here it is read-only. The
 * manager nominates the backup reviewer from people who already hold manager
 * permission at the venue (the database refuses anyone else, and refuses a
 * manager's change to the main role), or leaves it empty. When a reviewer
 * leaves the venue the backup takes over automatically; that change shows in
 * History.
 */

export const REVIEWERS_COPY = {
  intro:
    "An admin names the main reviewer. You choose who covers when they are away. Only managers at this venue can be chosen.",
  mainNone: "Not named yet. Ask an admin to name the main reviewer.",
  nobody: "Nobody",
  noCandidates:
    "Nobody else here holds manager permission yet. Ask an admin to make someone a manager at this venue.",
  reason: "Reason",
  save: "Save backup reviewer",
  saving: "Saving",
  saved: "Backup reviewer saved.",
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
  const [backup, setBackup] = useState<string | null>(
    reviewers.backup?.profileId ?? null
  )
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState<
    { kind: "saved" } | { kind: "error"; message: string } | null
  >(null)
  const [pending, start] = useTransition()

  // The main reviewer cannot also be the backup (the database refuses a
  // manager's move of the main reviewer).
  const options = view.candidates
    .filter((c) => c.profileId !== view.main?.profileId)
    .map((c) => ({ id: c.profileId, name: c.name }))

  function save() {
    start(async () => {
      setStatus(null)
      if ((view.backup?.profileId ?? null) === backup) {
        setStatus({ kind: "saved" })
        return
      }
      const result = await onSet({
        role: "backup",
        profileId: backup,
        reason: reason.trim() || undefined,
      })
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: result.message || REVIEWERS_COPY.failed,
        })
        return
      }
      setView(result.reviewers)
      setBackup(result.reviewers.backup?.profileId ?? null)
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
        save()
      }}
    >
      <p className="text-body text-ink-muted">{REVIEWERS_COPY.intro}</p>
      <MetaList
        items={[
          {
            label: REVIEWER_ROLE_LABEL.main,
            value: (
              <span data-reviewer="main">
                {view.main?.name ?? (
                  <span className="text-ink-muted">
                    {REVIEWERS_COPY.mainNone}
                  </span>
                )}
              </span>
            ),
          },
        ]}
      />
      {options.length === 0 ? (
        <p role="status" className="text-body text-ink">
          {REVIEWERS_COPY.noCandidates}
        </p>
      ) : null}
      <FormField label={REVIEWER_ROLE_LABEL.backup} optional>
        <OptionSelect
          options={options}
          value={backup}
          emptyLabel={REVIEWERS_COPY.nobody}
          onValueChange={setBackup}
          disabled={pending}
        />
      </FormField>
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
        disabled={options.length === 0 && !view.backup}
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
