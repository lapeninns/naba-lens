"use client"

import * as React from "react"
import { MagnifyingGlassIcon, UserPlusIcon } from "@phosphor-icons/react"

import {
  EmptyState,
  InviteStaffDialog,
  OptionSelect,
  StaffDirectoryTable,
  type InviteResult,
  type Option,
  type StaffMember,
} from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  AccountNotice,
  useAccountControls,
  type ManagerGrant,
} from "./account-controls"
import { inviteStaffAction } from "./actions"
import { STAFF_SUMMARY } from "./copy"
import { needsSetup, sortStaff } from "./staff-order"

type Filters = {
  venueId: string | null
  team: "foh" | "boh" | "unassigned" | null
  status: StaffMember["status"] | null
  query: string
}

const NO_FILTERS: Filters = {
  venueId: null,
  team: null,
  status: null,
  query: "",
}

const TEAM_OPTIONS: Option[] = [
  { id: "foh", name: "Front of house" },
  { id: "boh", name: "Back of house" },
  { id: "unassigned", name: "Unassigned" },
]

const STATUS_OPTIONS: Option[] = [
  { id: "active", name: "Active" },
  { id: "invited", name: "Invited" },
  { id: "inactive", name: "Inactive" },
]

function matches(member: StaffMember, filters: Filters) {
  if (filters.venueId && member.venueId !== filters.venueId) return false
  if (filters.status && member.status !== filters.status) return false
  if (filters.team === "unassigned" && member.department) return false
  if (
    (filters.team === "foh" || filters.team === "boh") &&
    member.department !== filters.team
  )
    return false
  const query = filters.query.trim().toLowerCase()
  if (
    query &&
    !member.displayName.toLowerCase().includes(query) &&
    !(member.email ?? "").toLowerCase().includes(query)
  )
    return false
  return true
}

/** "Showing inactive staff with no team. Try all statuses." */
function describeFilters(filters: Filters, venues: Option[]) {
  const status = filters.status ? `${filters.status} ` : ""
  const venue = filters.venueId
    ? ` at ${venues.find((v) => v.id === filters.venueId)?.name ?? "this venue"}`
    : ""
  const team =
    filters.team === "unassigned"
      ? " with no team"
      : filters.team === "foh"
        ? " in front of house"
        : filters.team === "boh"
          ? " in back of house"
          : ""
  const query = filters.query.trim()
    ? ` matching “${filters.query.trim()}”`
    : ""
  const hint = filters.status
    ? " Try all statuses."
    : filters.team
      ? " Try all teams."
      : filters.venueId
        ? " Try all venues."
        : ""
  return `Showing ${status}staff${venue}${team}${query}.${hint}`
}

function countLine(shown: StaffMember[], filtered: boolean) {
  const parts = [`${shown.length} shown`]
  if (!filtered) {
    for (const status of ["active", "invited", "inactive"] as const) {
      const count = shown.filter((m) => m.status === status).length
      if (count > 0) parts.push(`${count} ${status}`)
    }
  }
  return parts.join(" · ")
}

export function StaffDirectory({
  staff,
  venues,
  grants,
  maxAvatarBytes,
  notices,
}: {
  staff: StaffMember[]
  venues: Option[]
  /** Effective venue manager grants. */
  grants: ManagerGrant[]
  maxAvatarBytes: number
  /** Server-side notices (sign-in details unavailable) shown under the filters. */
  notices?: React.ReactNode
}) {
  const [inviting, setInviting] = React.useState(false)
  const [draft, setDraft] = React.useState<Filters>(NO_FILTERS)
  const [applied, setApplied] = React.useState<Filters>(NO_FILTERS)
  const controls = useAccountControls({ venues, maxAvatarBytes, grants })
  const id = React.useId()
  const managers = React.useMemo(
    () => new Set(grants.map((g) => g.staffId)),
    [grants]
  )

  // Venues people are at, including inactive ones nobody can be moved to.
  const venueOptions = React.useMemo(() => {
    const byId = new Map(venues.map((v) => [v.id, v.name]))
    for (const member of staff) {
      if (member.venueId && member.venueName && !byId.has(member.venueId))
        byId.set(member.venueId, member.venueName)
    }
    return [...byId].map(([id, name]) => ({ id, name }))
  }, [staff, venues])

  const filtered =
    applied.venueId !== null ||
    applied.team !== null ||
    applied.status !== null ||
    applied.query.trim() !== ""
  const shown = sortStaff(
    staff.map(controls.withConfirmedStatus).filter((m) => matches(m, applied))
  )
  const withoutTeam = staff.filter(needsSetup).length

  const invite = async (
    values: Parameters<typeof inviteStaffAction>[0]
  ): Promise<InviteResult> => inviteStaffAction(values)

  const clearFilters = () => {
    setDraft(NO_FILTERS)
    setApplied(NO_FILTERS)
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        venueScope
        scope="All venues"
        title="Staff"
        summary={STAFF_SUMMARY}
        actions={
          <Button size="touch" onClick={() => setInviting(true)}>
            <UserPlusIcon aria-hidden />
            Invite staff
          </Button>
        }
        className="pb-0 md:pb-0"
      />

      {staff.length === 0 ? (
        <EmptyState
          title="No staff yet."
          description="Invite people one at a time. Each gets a single-use sign-in link by email and shows as Invited until they first sign in."
          action={
            <Button
              variant="secondary"
              size="touch"
              onClick={() => setInviting(true)}
            >
              <UserPlusIcon aria-hidden />
              Invite staff
            </Button>
          }
        />
      ) : (
        <>
          <form
            role="search"
            aria-label="Filter staff"
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setApplied(draft)
            }}
          >
            <Field className="w-full gap-1.5 sm:w-44">
              <FieldLabel htmlFor={`${id}-venue`}>Venue</FieldLabel>
              <OptionSelect
                id={`${id}-venue`}
                options={venueOptions}
                value={draft.venueId}
                onValueChange={(venueId) =>
                  setDraft((d) => ({ ...d, venueId }))
                }
                emptyLabel="All venues"
              />
            </Field>
            <Field className="w-full gap-1.5 sm:w-44">
              <FieldLabel htmlFor={`${id}-team`}>Team</FieldLabel>
              <OptionSelect
                id={`${id}-team`}
                options={TEAM_OPTIONS}
                value={draft.team}
                onValueChange={(team) =>
                  setDraft((d) => ({ ...d, team: team as Filters["team"] }))
                }
                emptyLabel="All teams"
              />
            </Field>
            <Field className="w-full gap-1.5 sm:w-44">
              <FieldLabel htmlFor={`${id}-status`}>Status</FieldLabel>
              <OptionSelect
                id={`${id}-status`}
                options={STATUS_OPTIONS}
                value={draft.status}
                onValueChange={(status) =>
                  setDraft((d) => ({
                    ...d,
                    status: status as Filters["status"],
                  }))
                }
                emptyLabel="All statuses"
              />
            </Field>
            <Field className="w-full min-w-48 flex-1 gap-1.5">
              <FieldLabel htmlFor={`${id}-search`}>Search</FieldLabel>
              <div className="relative">
                <MagnifyingGlassIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
                />
                <Input
                  id={`${id}-search`}
                  type="search"
                  value={draft.query}
                  onChange={(e) => {
                    const query = e.currentTarget.value
                    setDraft((d) => ({ ...d, query }))
                  }}
                  placeholder="Name or email"
                  autoComplete="off"
                  className="h-11 pl-9 md:h-9"
                />
              </div>
            </Field>
            <Button
              type="submit"
              variant="secondary"
              size="touch"
              className="w-full sm:w-auto"
            >
              Apply filters
            </Button>
          </form>

          <OfflineNotice />
          {notices}
          {withoutTeam > 0 ? (
            <Notice
              tone="attention"
              title={
                withoutTeam === 1
                  ? "1 person has no team"
                  : `${withoutTeam} people have no team`
              }
            >
              People without a team show Needs setup for their monthly target
              until you choose Front of house or Back of house in Edit details.
            </Notice>
          ) : null}
          <AccountNotice
            notice={controls.notice}
            onDismiss={controls.dismissNotice}
          />

          {shown.length === 0 ? (
            <EmptyState
              variant="filtered"
              title="Nothing matches these filters."
              description={describeFilters(applied, venueOptions)}
              action={
                <Button variant="secondary" size="touch" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <section aria-labelledby={`${id}-accounts`} className="grid gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2
                  id={`${id}-accounts`}
                  className="text-section-title-touch text-ink md:text-section-title"
                >
                  Accounts
                </h2>
                <span className="text-meta-touch text-ink-muted md:text-meta">
                  {countLine(shown, filtered)}
                </span>
              </div>
              <StaffDirectoryTable
                staff={shown}
                managerIds={managers}
                getPortfolioHref={(member) =>
                  `/admin/staff/${encodeURIComponent(member.id)}`
                }
                onEdit={controls.edit}
                onResendInvite={(member) => void controls.resend(member)}
                onSetActive={controls.setActive}
              />
              <p className="text-body-sm text-ink-muted">
                Needs setup and Invited first, then A to Z by surname.
              </p>
            </section>
          )}
        </>
      )}

      <InviteStaffDialog
        open={inviting}
        onOpenChange={setInviting}
        venues={venues}
        onSubmit={invite}
        findAccount={(email) => {
          const match = staff.find(
            (m) => m.email && m.email.toLowerCase() === email.toLowerCase()
          )
          return match
            ? {
                displayName: match.displayName,
                venueName: match.venueName,
                href: `/admin/staff/${encodeURIComponent(match.id)}`,
              }
            : null
        }}
      />
      {controls.dialogs}
    </div>
  )
}
