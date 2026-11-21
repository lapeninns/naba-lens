"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DotsThreeIcon, ShieldCheckIcon } from "@phosphor-icons/react"

import {
  grantVenueManagerAction,
  revokeVenueManagerAction,
} from "@/app/_coverage/actions"
import { failureText } from "@/components/nabalens/coverage/copy"
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
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { PageHeader } from "@/components/nabalens/page-header"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { SectionHead } from "../coverage-sections"
import { MANAGERS_COPY, compareBySurname } from "./managers-copy"

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
  header,
  grantOpen = false,
}: {
  /** The grant Dialog was open when its venue was chosen (`?grant=1`). */
  grantOpen?: boolean
  /**
   * The page's title row, drawn here so its one button can open the grant
   * Dialog (second handoff, decision 5). Omit it in tests of the lists.
   */
  header?: {
    scope: React.ReactNode
    title: React.ReactNode
    summary: React.ReactNode
    tabs: React.ReactNode
  }
  grants: ManagerGrantView[]
  venues: CoverageVenue[]
  selectedVenueId: string | null
  /** Active venue manager accounts at the selected venue without access there. */
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
  // The Dialog's venue choice is in the URL (it reads that venue's people),
  // with `grant=1` so the Dialog is open again if the page reloads for it.
  const [granting, setGranting] = React.useState(grantOpen)

  const current = grants.filter((g) => !g.revokedAt).sort(byName)
  const anyLegacy = current.some((g) => g.legacyStaffGrant)
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
      setGranting(false)
    } else if ("fieldErrors" in result && result.fieldErrors) {
      setErrors(result.fieldErrors)
    }
  }

  function selectVenue(venueId: string | null) {
    setStaffId(null)
    const query = new URLSearchParams()
    if (venueId) query.set("venue", venueId)
    if (includeRevoked) query.set("revoked", "1")
    query.set("grant", "1")
    router.push(`${basePath}?${query.toString()}`, { scroll: false })
  }

  const toggleQuery = new URLSearchParams()
  if (selectedVenueId) toggleQuery.set("venue", selectedVenueId)
  if (!includeRevoked) toggleQuery.set("revoked", "1")
  const toggleHref = toggleQuery.size
    ? `${basePath}?${toggleQuery.toString()}`
    : basePath

  const noStaff =
    selectedVenue && candidates.length === 0 ? selectedVenue.name : null
  const grantButton = (
    <Button
      variant="primary"
      onClick={() => setGranting(true)}
      data-testid="manager-grant-open"
    >
      <ShieldCheckIcon aria-hidden data-icon="inline-start" />
      {MANAGERS_COPY.grantHeading}
    </Button>
  )

  return (
    <div className="grid gap-6">
      {header ? (
        <div className="flex flex-col gap-4">
          <PageHeader
            venueScope
            scope={header.scope}
            title={header.title}
            summary={header.summary}
            actions={grantButton}
            className="pb-0 md:pb-0"
          >
            {header.tabs}
          </PageHeader>
          <OfflineNotice />
        </div>
      ) : (
        grantButton
      )}
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />

      <Dialog
        open={granting}
        onOpenChange={(next) => {
          if (action.pending) return
          setGranting(next)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{MANAGERS_COPY.grantHeading}</DialogTitle>
          </DialogHeader>
          <form onSubmit={grant} className="grid gap-4" noValidate>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor={`${ids}-venue`} className="text-label text-ink">
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
                <label htmlFor={`${ids}-staff`} className="text-label text-ink">
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
                  className="text-meta text-ink-muted"
                >
                  {MANAGERS_COPY.fields.personHint}
                </p>
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={`${ids}-note`} className="text-label text-ink">
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
                {errors.reason ? (
                  <FieldError>{errors.reason}</FieldError>
                ) : null}
              </div>
            </div>
            {noStaff ? (
              <Notice tone="attention">
                <p>{MANAGERS_COPY.noStaff(noStaff)}</p>
              </Notice>
            ) : null}
            <p className="max-w-prose text-meta text-ink-muted">
              {MANAGERS_COPY.powers}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setGranting(false)}
                disabled={action.pending}
              >
                {MANAGERS_COPY.cancel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={action.pending}
                aria-busy={action.pending || undefined}
              >
                <ShieldCheckIcon aria-hidden />
                {action.pending ? MANAGERS_COPY.granting : MANAGERS_COPY.grant}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
            <Table stacked framed aria-label={MANAGERS_COPY.currentHeading}>
              <TableHeader>
                <TableRow>
                  <TableHead>{MANAGERS_COPY.columns.person}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.venue}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.since}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.grantedBy}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.state}</TableHead>
                  <TableHead className="w-16">
                    <span className="sr-only">
                      {MANAGERS_COPY.columns.actions}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.map((g) => (
                  <TableRow key={g.id}>
                    <TableHead scope="row" className="text-label text-ink">
                      <PersonCell name={g.staff.displayName} />
                    </TableHead>
                    <TableCell
                      label={MANAGERS_COPY.columns.venue}
                      className="whitespace-normal"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        {g.venue.name}
                        {g.legacyStaffGrant ? (
                          <StatusChip tone="pending">
                            {MANAGERS_COPY.legacyStaffGrant}
                          </StatusChip>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell
                      label={MANAGERS_COPY.columns.since}
                      className="whitespace-normal tabular-nums"
                    >
                      {formatDate(g.grantedAt)}
                    </TableCell>
                    <TableCell
                      label={MANAGERS_COPY.columns.grantedBy}
                      className="whitespace-normal"
                    >
                      {g.grantedBy.displayName ?? ""}
                    </TableCell>
                    <TableCell
                      label={MANAGERS_COPY.columns.state}
                      className="whitespace-normal"
                    >
                      {g.effective ? (
                        <StatusChip tone="positive">
                          {MANAGERS_COPY.inEffect}
                        </StatusChip>
                      ) : (
                        <StatusChip tone="attention">
                          {notInEffect(g)}
                        </StatusChip>
                      )}
                    </TableCell>
                    <TableCell className="md:text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="quiet"
                              size="icon-lg"
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
                            variant="danger"
                            onClick={() => setRevoking(g)}
                          >
                            {MANAGERS_COPY.revokeItem}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {anyLegacy ? (
              <p className="max-w-prose px-1 text-meta text-ink-muted">
                {MANAGERS_COPY.legacyStaffGrantNote}
              </p>
            ) : null}
            <p className="px-1 text-meta text-ink-muted">
              {MANAGERS_COPY.sortNote}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby={`${ids}-ended`} className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <h2 id={`${ids}-ended`} className="type-section-title text-ink">
              {MANAGERS_COPY.endedHeading}
            </h2>
            <span className="text-meta text-ink-muted">
              {includeRevoked
                ? `${ended.length} · ${MANAGERS_COPY.endedNote.toLowerCase()}`
                : MANAGERS_COPY.endedNote}
            </span>
          </div>
          <Link
            href={toggleHref}
            className={buttonVariants({
              variant: "link",
              className: "min-h-11",
            })}
          >
            {includeRevoked ? MANAGERS_COPY.hideEnded : MANAGERS_COPY.showEnded}
          </Link>
        </div>
        {includeRevoked && ended.length > 0 ? (
          <>
            <Table stacked framed aria-label={MANAGERS_COPY.endedHeading}>
              <TableHeader>
                <TableRow>
                  <TableHead>{MANAGERS_COPY.columns.person}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.venue}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.dates}</TableHead>
                  <TableHead>{MANAGERS_COPY.columns.howItEnded}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ended.map((g) => {
                  const chip = g.revokeKind
                    ? ENDED_CHIP[g.revokeKind]
                    : undefined
                  return (
                    <TableRow key={g.id}>
                      <TableHead scope="row" className="text-label text-ink">
                        <PersonCell name={g.staff.displayName} />
                      </TableHead>
                      <TableCell
                        label={MANAGERS_COPY.columns.venue}
                        className="whitespace-normal"
                      >
                        {g.venue.name}
                      </TableCell>
                      <TableCell
                        label={MANAGERS_COPY.columns.dates}
                        className="whitespace-normal tabular-nums"
                      >
                        {formatDate(g.grantedAt)} to{" "}
                        {formatDate(g.revokedAt ?? g.grantedAt)}
                      </TableCell>
                      <TableCell
                        label={MANAGERS_COPY.columns.howItEnded}
                        className="whitespace-normal max-md:flex-wrap md:align-top"
                      >
                        <span className="grid gap-1.5">
                          {chip ? <StatusChip state={chip} /> : null}
                          {g.revokeReason ? (
                            <span className="text-meta text-ink-muted">
                              {g.revokeReason}
                              {g.revokedByName ? ` · ${g.revokedByName}` : null}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="px-1 text-meta text-ink-muted">
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
          if (result.code === "network") {
            return {
              ok: false,
              error: result.sessionEnded
                ? result.message
                : MANAGERS_COPY.revoke.notConfirmed(
                    target.staff.displayName,
                    target.venue.name
                  ),
            }
          }
          if (action.reportedOnPage(result)) return REPORTED
          return {
            ok: false,
            error: MANAGERS_COPY.revoke.nothingChanged(
              target.staff.displayName,
              target.venue.name,
              failureText(result)
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
            <p className="text-body">
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
