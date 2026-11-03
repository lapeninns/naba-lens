"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DotsThreeIcon, ShieldCheckIcon } from "@phosphor-icons/react"

import {
  grantVenueManagerAction,
  revokeVenueManagerAction,
} from "@/app/_coverage/actions"
import { CoverageNotice } from "@/components/nabalens/coverage/coverage-notice"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import type {
  CoveragePerson,
  CoverageVenue,
  ManagerGrantView,
} from "@/components/nabalens/coverage/types"
import {
  REPORTED,
  useCoverageAction,
} from "@/components/nabalens/coverage/use-coverage-action"
import { EmptyState } from "@/components/nabalens/empty-state"
import { formatDate } from "@/components/nabalens/format"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { SectionHead } from "../coverage-sections"
import { MANAGERS_COPY, compareBySurname } from "./managers-copy"

const TH =
  "px-3 py-2 text-left text-meta-strong text-ink-muted first:pl-4 last:pr-4"
const TD =
  "px-3 py-2.5 align-middle text-body-touch text-ink first:pl-4 last:pr-4 md:text-body-sm max-md:flex max-md:gap-2 max-md:px-4 max-md:py-1 max-md:before:min-w-28 max-md:before:text-ink-muted max-md:before:content-[attr(data-label)]"
const TABLE =
  "w-full border-collapse max-md:block max-md:[&_tbody]:block max-md:[&_thead]:sr-only max-md:[&_tr]:block max-md:[&_tr]:py-2"

const ENDED_CHIP: Record<string, string> = {
  revoked: "revoked",
  venue_changed: "ended_moved",
  deactivated: "ended_deactivated",
}

function byName(a: ManagerGrantView, b: ManagerGrantView) {
  return compareBySurname(a.staff.displayName, b.staff.displayName)
}

function PersonCell({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-3">
      <ProfileAvatar name={name} size="md" />
      <span className="font-semibold break-words">{name}</span>
    </span>
  )
}

/** Admin-only grant and revoke of venue-manager status. */
export function ManagersView({
  grants,
  venues,
  selectedVenueId,
  candidates,
  includeRevoked,
  basePath,
}: {
  grants: ManagerGrantView[]
  venues: CoverageVenue[]
  selectedVenueId: string | null
  /** Active staff currently at the selected venue. */
  candidates: CoveragePerson[]
  includeRevoked: boolean
  basePath: string
}) {
  const router = useRouter()
  const ids = React.useId()
  const action = useCoverageAction(() => router.refresh())
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const [staffId, setStaffId] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  const [revoking, setRevoking] = React.useState<ManagerGrantView | null>(null)

  const current = grants.filter((g) => !g.revokedAt).sort(byName)
  const ended = grants.filter((g) => g.revokedAt).sort(byName)
  const managed = new Set(
    current.filter((g) => g.effective).map((g) => g.venue.id)
  )
  const openGrantStaff = new Set(current.map((g) => g.staff.id))
  const options = candidates
    .filter((p) => !openGrantStaff.has(p.id))
    .map((p) => ({ id: p.id, name: p.displayName }))
  const selectedVenue = venues.find((v) => v.id === selectedVenueId)

  async function grant(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!selectedVenueId) found.venueId = MANAGERS_COPY.chooseVenue
    if (!staffId) found.staffId = MANAGERS_COPY.choosePerson
    setErrors(found)
    if (!selectedVenueId || !staffId) return
    const person = candidates.find((p) => p.id === staffId)
    const result = await action.run(
      () =>
        grantVenueManagerAction({
          staffId,
          venueId: selectedVenueId,
          reason: note.trim() || null,
        }),
      MANAGERS_COPY.granted(
        person?.displayName ?? "They",
        selectedVenue?.name ?? "this venue"
      )
    )
    if (result.ok) {
      setStaffId(null)
      setNote("")
    } else if ("fieldErrors" in result && result.fieldErrors) {
      setErrors(result.fieldErrors)
    }
  }

  function selectVenue(venueId: string | null) {
    setStaffId(null)
    const query = new URLSearchParams()
    if (venueId) query.set("venue", venueId)
    if (includeRevoked) query.set("revoked", "1")
    const search = query.toString()
    router.push(search ? `${basePath}?${search}` : basePath)
  }

  const toggleQuery = new URLSearchParams()
  if (selectedVenueId) toggleQuery.set("venue", selectedVenueId)
  if (!includeRevoked) toggleQuery.set("revoked", "1")
  const toggleHref = toggleQuery.size
    ? `${basePath}?${toggleQuery.toString()}`
    : basePath

  const noStaff =
    selectedVenue && candidates.length === 0 ? selectedVenue.name : null

  return (
    <div className="grid gap-8">
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />

      <section aria-labelledby={`${ids}-grant`} className="grid gap-3">
        <SectionHead id={`${ids}-grant`} title={MANAGERS_COPY.grantHeading} />
        <form onSubmit={grant} className="grid gap-4" noValidate>
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-start">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${ids}-venue`}
                className="text-label font-semibold"
              >
                {MANAGERS_COPY.fields.venue}
              </label>
              <OptionSelect
                id={`${ids}-venue`}
                options={venues}
                value={selectedVenueId}
                onValueChange={selectVenue}
                placeholder={MANAGERS_COPY.fields.venuePlaceholder}
                invalid={!!errors.venueId}
                disabled={action.pending}
              />
              {errors.venueId ? (
                <FieldError>{errors.venueId}</FieldError>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label
                htmlFor={`${ids}-staff`}
                className="text-label font-semibold"
              >
                {MANAGERS_COPY.fields.person}
              </label>
              <OptionSelect
                id={`${ids}-staff`}
                options={options}
                value={staffId}
                onValueChange={setStaffId}
                placeholder={MANAGERS_COPY.fields.personPlaceholder}
                invalid={!!errors.staffId}
                disabled={
                  action.pending || !selectedVenueId || options.length === 0
                }
                aria-describedby={`${ids}-staff-hint`}
              />
              {errors.staffId ? (
                <FieldError>{errors.staffId}</FieldError>
              ) : null}
              <p
                id={`${ids}-staff-hint`}
                className="text-meta-touch text-ink-muted md:text-meta"
              >
                {MANAGERS_COPY.fields.personHint}
              </p>
            </div>
            <div className="grid gap-1.5">
              <label
                htmlFor={`${ids}-note`}
                className="text-label font-semibold"
              >
                {MANAGERS_COPY.fields.note}{" "}
                <span className="font-normal text-ink-muted">
                  {MANAGERS_COPY.fields.optional}
                </span>
              </label>
              <Input
                id={`${ids}-note`}
                type="text"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.currentTarget.value)}
                disabled={action.pending}
                aria-invalid={errors.reason ? true : undefined}
              />
              {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              size="touch"
              className="md:mt-[26px]"
              disabled={action.pending}
              aria-busy={action.pending || undefined}
            >
              <ShieldCheckIcon aria-hidden />
              {action.pending ? MANAGERS_COPY.granting : MANAGERS_COPY.grant}
            </Button>
          </div>
          {noStaff ? (
            <Notice tone="attention">
              <p>{MANAGERS_COPY.noStaff(noStaff)}</p>
            </Notice>
          ) : null}
        </form>
        <p className="max-w-prose text-meta-touch text-ink-muted md:text-meta">
          {MANAGERS_COPY.powers}
        </p>
      </section>

      <section aria-labelledby={`${ids}-current`} className="grid gap-3">
        <SectionHead
          id={`${ids}-current`}
          title={MANAGERS_COPY.currentHeading}
          note={
            selectedVenueId
              ? undefined
              : MANAGERS_COPY.venueCount(managed.size, venues.length)
          }
        />
        {current.length === 0 ? (
          <EmptyState
            variant="done"
            title={MANAGERS_COPY.emptyTitle}
            description={MANAGERS_COPY.emptyText}
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-panel border border-line">
              <table
                aria-label={MANAGERS_COPY.currentHeading}
                className={TABLE}
              >
                <thead className="border-b border-line">
                  <tr>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.person}
                    </th>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.venue}
                    </th>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.since}
                    </th>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.grantedBy}
                    </th>
                    <th scope="col" className={`${TH} w-16`}>
                      <span className="sr-only">
                        {MANAGERS_COPY.columns.actions}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {current.map((g) => (
                    <tr key={g.id}>
                      <th
                        scope="row"
                        className={`${TD} text-left max-md:before:content-none`}
                      >
                        <PersonCell name={g.staff.displayName} />
                      </th>
                      <td
                        data-label={MANAGERS_COPY.columns.venue}
                        className={TD}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          {g.venue.name}
                          {!g.effective ? (
                            <StatusChip tone="attention">
                              {notInEffect(g)}
                            </StatusChip>
                          ) : null}
                        </span>
                      </td>
                      <td
                        data-label={MANAGERS_COPY.columns.since}
                        className={`${TD} tabular-nums`}
                      >
                        {formatDate(g.grantedAt)}
                      </td>
                      <td
                        data-label={MANAGERS_COPY.columns.grantedBy}
                        className={TD}
                      >
                        {g.grantedBy.displayName ?? ""}
                      </td>
                      <td className={`${TD} md:text-right`}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-lg"
                                className="size-11 sm:size-9"
                                disabled={action.pending}
                                aria-label={MANAGERS_COPY.moreActions(
                                  g.staff.displayName
                                )}
                              />
                            }
                          >
                            <DotsThreeIcon weight="bold" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setRevoking(g)}
                            >
                              {MANAGERS_COPY.revokeItem}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {MANAGERS_COPY.sortNote}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby={`${ids}-ended`} className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <h2
              id={`${ids}-ended`}
              className="text-section-title-touch text-ink md:text-section-title"
            >
              {MANAGERS_COPY.endedHeading}
            </h2>
            <span className="text-meta-touch text-ink-muted md:text-meta">
              {includeRevoked
                ? `${ended.length} · ${MANAGERS_COPY.endedNote.toLowerCase()}`
                : MANAGERS_COPY.endedNote}
            </span>
          </div>
          <Link
            href={toggleHref}
            className={buttonVariants({
              variant: "link",
              className: "min-h-11 md:min-h-0",
            })}
          >
            {includeRevoked ? MANAGERS_COPY.hideEnded : MANAGERS_COPY.showEnded}
          </Link>
        </div>
        {includeRevoked && ended.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-panel border border-line">
              <table aria-label={MANAGERS_COPY.endedHeading} className={TABLE}>
                <thead className="border-b border-line">
                  <tr>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.person}
                    </th>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.venue}
                    </th>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.dates}
                    </th>
                    <th scope="col" className={TH}>
                      {MANAGERS_COPY.columns.howItEnded}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ended.map((g) => {
                    const chip = g.revokeKind
                      ? ENDED_CHIP[g.revokeKind]
                      : undefined
                    return (
                      <tr key={g.id}>
                        <th
                          scope="row"
                          className={`${TD} text-left max-md:before:content-none`}
                        >
                          <PersonCell name={g.staff.displayName} />
                        </th>
                        <td
                          data-label={MANAGERS_COPY.columns.venue}
                          className={TD}
                        >
                          {g.venue.name}
                        </td>
                        <td
                          data-label={MANAGERS_COPY.columns.dates}
                          className={`${TD} tabular-nums`}
                        >
                          {formatDate(g.grantedAt)} to{" "}
                          {formatDate(g.revokedAt ?? g.grantedAt)}
                        </td>
                        <td
                          data-label={MANAGERS_COPY.columns.howItEnded}
                          className={`${TD} max-md:flex-wrap md:align-top`}
                        >
                          <span className="grid gap-1.5">
                            {chip ? <StatusChip state={chip} /> : null}
                            {g.revokeReason ? (
                              <span className="text-meta-touch text-ink-muted md:text-meta">
                                {g.revokeReason}
                                {g.revokedByName
                                  ? ` · ${g.revokedByName}`
                                  : null}
                              </span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {MANAGERS_COPY.sortNote}
            </p>
          </>
        ) : null}
      </section>

      <ReasonDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={MANAGERS_COPY.revoke.title(revoking?.staff.displayName ?? "")}
        description={MANAGERS_COPY.revoke.description(
          revoking?.staff.displayName ?? ""
        )}
        label={MANAGERS_COPY.revoke.reason}
        help={MANAGERS_COPY.revoke.help}
        confirmLabel={MANAGERS_COPY.revoke.confirm}
        pendingLabel={MANAGERS_COPY.revoke.confirming}
        destructive
        onConfirm={async (text) => {
          if (!revoking) return { ok: false, error: MANAGERS_COPY.choosePerson }
          const target = revoking
          const result = await action.run(
            () =>
              revokeVenueManagerAction({ grantId: target.id, reason: text }),
            MANAGERS_COPY.revoke.done(
              target.staff.displayName,
              target.venue.name
            )
          )
          if (result.ok) return { ok: true }
          if (action.reportedOnPage(result)) return REPORTED
          return {
            ok: false,
            error: MANAGERS_COPY.revoke.nothingChanged(
              target.staff.displayName,
              target.venue.name
            ),
            fieldError:
              "fieldErrors" in result ? result.fieldErrors?.reason : undefined,
          }
        }}
        reportFocus={() => noticeRef.current}
      >
        {revoking ? (
          <div className="flex items-center gap-3">
            <ProfileAvatar name={revoking.staff.displayName} size="md" />
            <p className="text-body-sm">
              <strong>{revoking.staff.displayName}</strong>
              <br />
              <span className="text-ink-muted">
                {MANAGERS_COPY.revoke.context(
                  revoking.venue.name,
                  formatDate(revoking.grantedAt)
                )}
              </span>
            </p>
          </div>
        ) : null}
      </ReasonDialog>
    </div>
  )
}

function notInEffect(grant: ManagerGrantView): string {
  if (!grant.staff.active) return "Not in effect: account inactive"
  if (grant.staffVenueId !== grant.venue.id)
    return "Not in effect: works at another venue now"
  return "Not in effect: venue inactive"
}
