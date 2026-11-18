"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UserPlusIcon } from "@phosphor-icons/react"

import { Card, SectionHeader } from "@/components/nabalens/common-room"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import {
  InviteStaffDialog,
  type InviteResult,
} from "@/components/nabalens/invite-staff-dialog"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"

/** One member of the venue, as the manager's Team screen shows them. */
export type VenuePerson = {
  profileId: string
  displayName: string
  jobTitle: string | null
  role: "staff" | "manager"
  /** Working at this venue now (it is their active venue). */
  workingHere: boolean
}

export type RemoveResult =
  | {
      ok: true
      outcome: "removed" | "deactivated"
      reassigned: { coverageAssignments: number; amenityChecks: number }
      warning?: string
    }
  | { ok: false; error: string }

/**
 * People at the venue (spec §7 M5; S1-PEOPLE). A manager invites ordinary
 * staff to this venue and removes ordinary staff from it; managers are listed
 * but only an admin changes them. Removing someone from their last venue ends
 * their access; their photos and history stay (AC34). Feedback is written on
 * the page (DESIGN.md §6.7), never a toast.
 */
export function VenuePeople({
  venue,
  people,
  selfId,
  onInvite,
  onRemove,
}: {
  venue: { id: string; name: string }
  people: VenuePerson[]
  selfId: string
  onInvite: (input: {
    displayName: string
    email: string
    jobTitle: string
  }) => Promise<InviteResult>
  onRemove: (input: {
    profileId: string
    reason: string
    replacementId: string | null
  }) => Promise<RemoveResult>
}) {
  const router = useRouter()
  const [inviting, setInviting] = React.useState(false)
  const [removing, setRemoving] = React.useState<VenuePerson | null>(null)
  const [replacement, setReplacement] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  const colleagues = (except: string) =>
    people
      .filter(
        (p) => p.profileId !== except && p.role === "staff" && p.workingHere
      )
      .map((p) => ({ id: p.profileId, name: p.displayName }))

  return (
    <section aria-labelledby="venue-people" className="grid gap-gutter">
      <SectionHeader
        id="venue-people"
        title={`People at ${venue.name}`}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setInviting(true)}
          >
            <UserPlusIcon aria-hidden />
            Invite staff
          </Button>
        }
      />
      <p className="px-1 text-body text-ink-muted">
        You can invite and remove staff here. Only an admin can make someone a
        manager.
      </p>
      {done ? (
        <Notice tone="positive" role="status">
          {done}
        </Notice>
      ) : null}
      <Card className="py-1">
        <ul ref={listRef} className="grid divide-y divide-line" tabIndex={-1}>
          {people.map((person) => (
            <li
              key={person.profileId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="grid min-w-0 gap-0.5">
                <p className="text-body font-bold text-ink">
                  {person.displayName}
                </p>
                <p className="text-meta text-ink-muted">
                  {[
                    person.role === "manager" ? "Manager" : "Staff",
                    person.jobTitle,
                    person.workingHere ? null : "Working at another venue now",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {person.role === "staff" && person.profileId !== selfId ? (
                <Button
                  variant="danger-quiet"
                  size="sm"
                  onClick={() => {
                    setReplacement(null)
                    setRemoving(person)
                  }}
                >
                  Remove from {venue.name}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <InviteStaffDialog
        open={inviting}
        onOpenChange={(open) => {
          setInviting(open)
          if (!open) router.refresh()
        }}
        venues={[{ id: venue.id, name: venue.name }]}
        lockedVenue={{ id: venue.id, name: venue.name }}
        onSubmit={(values) =>
          onInvite({
            displayName: values.displayName,
            email: values.email,
            jobTitle: values.jobTitle,
          })
        }
      />

      <ReasonDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={
          removing ? `Remove ${removing.displayName} from ${venue.name}?` : ""
        }
        description="Their photos and history stay. If this is their only venue, their access ends."
        label="Reason"
        confirmLabel="Remove"
        pendingLabel="Removing…"
        destructive
        reportFocus={() => listRef.current}
        reportFocusOnSuccess
        onConfirm={async (reason) => {
          if (!removing) return { ok: false, error: "Choose someone." }
          const result = await onRemove({
            profileId: removing.profileId,
            reason,
            replacementId: replacement,
          })
          if (!result.ok) return { ok: false, error: result.error }
          const moved =
            result.reassigned.coverageAssignments +
            result.reassigned.amenityChecks
          setDone(
            [
              result.outcome === "deactivated"
                ? `${removing.displayName} no longer has access to Naba-Lens.`
                : `${removing.displayName} no longer works at ${venue.name}.`,
              moved > 0 ? `${moved} open jobs moved to their colleague.` : null,
              result.warning ?? null,
            ]
              .filter(Boolean)
              .join(" ")
          )
          router.refresh()
          return { ok: true }
        }}
      >
        {removing && colleagues(removing.profileId).length > 0 ? (
          <div className="grid gap-1.5">
            <label
              htmlFor="venue-people-replacement"
              className="text-label text-ink"
            >
              Who takes over their open jobs?{" "}
              <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <OptionSelect
              id="venue-people-replacement"
              options={colleagues(removing.profileId)}
              value={replacement}
              onValueChange={setReplacement}
              emptyLabel="Nobody: show them as needing someone"
            />
          </div>
        ) : null}
      </ReasonDialog>
    </section>
  )
}
