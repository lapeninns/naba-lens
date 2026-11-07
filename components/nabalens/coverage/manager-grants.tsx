"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldCheckIcon, UserMinusIcon } from "@phosphor-icons/react"

import { formatDateTime } from "@/components/nabalens/menus/copy"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"

import { CoverageNotice } from "./coverage-notice"
import { MANAGER_POWERS_COPY, REVOKE_KIND_LABEL, labelFor } from "./copy"
import { CoverageBadge } from "./coverage-badges"
import { ReasonDialog, ReasonField } from "./reason-dialog"
import type {
  CoveragePerson,
  CoverageResult,
  CoverageVenue,
  GrantVenueManagerInput,
  ManagerGrantView,
  RevokeVenueManagerInput,
} from "./types"
import { REPORTED, useCoverageAction } from "./use-coverage-action"

export type GrantHandlers = {
  grant: (input: GrantVenueManagerInput) => Promise<CoverageResult<object>>
  revoke: (input: RevokeVenueManagerInput) => Promise<CoverageResult<object>>
}

function ineffectiveText(grant: ManagerGrantView): string | null {
  if (grant.effective || grant.revokedAt) return null
  if (!grant.staff.active) return "Not in effect: account inactive"
  if (grant.staffVenueId !== grant.venue.id)
    return "Not in effect: works at another venue now"
  return "Not in effect: venue inactive"
}

/**
 * Admin-only venue manager grants. A grant applies only while the person is
 * active staff at that (active) venue; moving venue or deactivation ends it,
 * and a new grant is needed after a move.
 */
export function ManagerGrants({
  grants,
  venues,
  selectedVenueId,
  candidates,
  includeRevoked,
  basePath,
  onSelectVenue,
  handlers,
  onStale,
}: {
  grants: ManagerGrantView[]
  venues: CoverageVenue[]
  selectedVenueId: string | null
  /** Active staff currently at the selected venue. */
  candidates: CoveragePerson[]
  includeRevoked: boolean
  /** This page's path, for the show/hide ended grants link. */
  basePath: string
  onSelectVenue: (venueId: string | null) => void
  handlers: GrantHandlers
  onStale?: () => void
}) {
  const ids = React.useId()
  const action = useCoverageAction(onStale)
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const [staffId, setStaffId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  const [revoking, setRevoking] = React.useState<ManagerGrantView | null>(null)

  const openGrantStaff = new Set(
    grants.filter((g) => !g.revokedAt).map((g) => g.staff.id)
  )
  const options = candidates
    .filter((p) => !openGrantStaff.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.jobTitle ? `${p.displayName} (${p.jobTitle})` : p.displayName,
    }))

  async function grant(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!selectedVenueId) found.venueId = "Choose a venue."
    if (!staffId) found.staffId = "Choose a person."
    setErrors(found)
    if (!selectedVenueId || !staffId) return
    const person = candidates.find((p) => p.id === staffId)
    const result = await action.run(
      () =>
        handlers.grant({
          staffId,
          venueId: selectedVenueId,
          reason: reason.trim() || null,
        }),
      `${person?.displayName ?? "They"} can now manage coverage at ${venues.find((v) => v.id === selectedVenueId)?.name ?? "this venue"}.`
    )
    if (result.ok) {
      setStaffId(null)
      setReason("")
    } else if ("fieldErrors" in result && result.fieldErrors) {
      setErrors(result.fieldErrors)
    }
  }

  const query = new URLSearchParams()
  if (selectedVenueId) query.set("venue", selectedVenueId)
  if (!includeRevoked) query.set("revoked", "1")

  return (
    <div className="grid gap-8">
      <p className="max-w-prose text-meta text-ink-muted">
        {MANAGER_POWERS_COPY}
      </p>
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />

      <section
        aria-labelledby={`${ids}-grant`}
        className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
      >
        <h2 id={`${ids}-grant`} className="font-bold">
          Make someone a venue manager
        </h2>
        <form onSubmit={grant} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-venue`} className="text-label text-ink">
                Venue
              </label>
              <OptionSelect
                id={`${ids}-venue`}
                options={venues}
                value={selectedVenueId}
                onValueChange={(id) => {
                  setStaffId(null)
                  onSelectVenue(id)
                }}
                placeholder="Choose a venue…"
                invalid={!!errors.venueId}
                disabled={action.pending}
              />
              {errors.venueId ? (
                <FieldError>{errors.venueId}</FieldError>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-staff`} className="text-label text-ink">
                Person (active staff at that venue)
              </label>
              <OptionSelect
                id={`${ids}-staff`}
                options={options}
                value={staffId}
                onValueChange={setStaffId}
                placeholder={
                  !selectedVenueId
                    ? "Choose a venue first"
                    : options.length
                      ? "Choose a person…"
                      : "No one else to choose"
                }
                invalid={!!errors.staffId}
                disabled={
                  action.pending || !selectedVenueId || options.length === 0
                }
              />
              {errors.staffId ? (
                <FieldError>{errors.staffId}</FieldError>
              ) : null}
            </div>
          </div>
          <ReasonField
            id={`${ids}-reason`}
            label="Note"
            required={false}
            value={reason}
            onChange={setReason}
            error={errors.reason}
            disabled={action.pending}
          />
          <div>
            <Button
              type="submit"
              size="touch"
              disabled={action.pending}
              aria-busy={action.pending || undefined}
            >
              <ShieldCheckIcon data-icon="inline-start" aria-hidden />
              {action.pending ? "Saving…" : "Make venue manager"}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${ids}-list`} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id={`${ids}-list`}
            className="font-display text-section-title text-ink"
          >
            {includeRevoked ? "All grants" : "Current grants"}
          </h2>
          <Link
            href={query.size ? `${basePath}?${query.toString()}` : basePath}
            className="inline-flex min-h-11 items-center text-meta underline underline-offset-3 sm:min-h-0"
          >
            {includeRevoked ? "Hide ended grants" : "Show ended grants"}
          </Link>
        </div>
        {grants.length === 0 ? (
          <p className="text-meta text-ink-muted">
            No venue managers{selectedVenueId ? " at this venue" : ""} yet.
          </p>
        ) : (
          <ul
            aria-label="Venue managers"
            className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
          >
            {grants.map((grant) => {
              const notEffective = ineffectiveText(grant)
              return (
                <li
                  key={grant.id}
                  className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4"
                >
                  <div className="grid min-w-0 flex-1 gap-1">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold [overflow-wrap:anywhere]">
                        {grant.staff.displayName}
                      </span>
                      <span className="text-ink-muted">
                        · {grant.venue.name}
                      </span>
                      {grant.effective ? (
                        <CoverageBadge tone="positive">In effect</CoverageBadge>
                      ) : grant.revokedAt ? (
                        <CoverageBadge tone="muted">Ended</CoverageBadge>
                      ) : (
                        <CoverageBadge tone="warning">
                          Not in effect
                        </CoverageBadge>
                      )}
                    </p>
                    <p className="text-meta text-ink-muted">
                      Granted {formatDateTime(grant.grantedAt)}
                      {grant.grantedBy.displayName
                        ? ` by ${grant.grantedBy.displayName}`
                        : null}
                      {grant.grantReason
                        ? `. Note: ${grant.grantReason}`
                        : null}
                    </p>
                    {grant.revokedAt ? (
                      <p className="text-meta text-ink-muted">
                        {grant.revokeKind
                          ? labelFor(REVOKE_KIND_LABEL, grant.revokeKind)
                          : "Ended"}{" "}
                        {formatDateTime(grant.revokedAt)}
                        {grant.revokedByName
                          ? ` by ${grant.revokedByName}`
                          : null}
                        {grant.revokeReason
                          ? `. Reason: ${grant.revokeReason}`
                          : null}
                      </p>
                    ) : notEffective ? (
                      <p className="text-meta font-bold text-warn-fg">
                        {notEffective}
                      </p>
                    ) : null}
                  </div>
                  {!grant.revokedAt ? (
                    <Button
                      variant="secondary"
                      size="touch"
                      onClick={() => setRevoking(grant)}
                      disabled={action.pending}
                      aria-label={`Revoke ${grant.staff.displayName}’s manager grant`}
                    >
                      <UserMinusIcon data-icon="inline-start" aria-hidden />
                      Revoke
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ReasonDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={`Revoke ${revoking?.staff.displayName ?? ""}’s manager grant?`}
        description="It takes effect on their next action, including on phones where they are still signed in. Their decisions so far stay recorded."
        label="Reason"
        confirmLabel="Revoke"
        pendingLabel="Revoking…"
        destructive
        onConfirm={async (text) => {
          if (!revoking) return { ok: false, error: "Choose a grant first." }
          const result = await action.run(
            () => handlers.revoke({ grantId: revoking.id, reason: text }),
            `${revoking.staff.displayName} is no longer a venue manager.`
          )
          if (result.ok) return { ok: true }
          if (action.reportedOnPage(result)) return REPORTED
          return {
            ok: false,
            error: result.message,
            fieldError:
              "fieldErrors" in result ? result.fieldErrors?.reason : undefined,
          }
        }}
        reportFocus={() => noticeRef.current}
      />
    </div>
  )
}
