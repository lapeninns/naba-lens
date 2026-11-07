"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowUUpLeftIcon,
  ShieldCheckIcon,
  UserSwitchIcon,
} from "@phosphor-icons/react"

import { grantVenueManagerAction } from "@/app/_coverage/actions"
import { formatDate, type Option } from "@/components/nabalens"
import { CoverageNotice } from "@/components/nabalens/coverage/coverage-notice"
import {
  ReasonDialog,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import {
  REPORTED,
  useCoverageAction,
} from "@/components/nabalens/coverage/use-coverage-action"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { OptionSelect } from "@/components/nabalens/option-select"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import type { AccountRole, AccountRoleChange } from "@/lib/server/accounts"

import { convertToManagerAction, convertToStaffAction } from "../actions"
import { firstName } from "../staff-order"
import type { GrantRecord } from "./account-header"

export const ACCOUNT_TYPE_COPY = {
  heading: "Account type",
  staff: "Staff account",
  manager: (venue: string) => `Venue manager · ${venue}`,
  inEffect: (since: string) => `Venue access in effect since ${since}.`,
  notInEffect: "Venue access is not in effect.",
  noAccess: "No venue access.",
  ended: (kind: string) => `Venue access ended (${kind}).`,
  legacyGrant: (venue: string) =>
    `Legacy staff grant at ${venue}: it stays in effect until this account is converted to a venue manager account.`,
  makeManager: "Make venue manager",
  makingManager: "Making venue manager…",
  inactive: "Reactivate the account before changing its type.",
  giveAccess: (venue: string) => `Give access at ${venue}`,
  givingAccess: "Giving access…",
  accessGiven: (name: string, venue: string) =>
    `${name} now has venue access at ${venue}. It takes effect on ${firstName(name)}'s next page load.`,
  returnToStaff: "Return to staff account",
  returningToStaff: "Returning to staff…",
  toManager: {
    title: (name: string) => `Make ${name} a venue manager?`,
    bullets: (venue: string) => [
      `They'll sign in to the manager workspace for ${venue}.`,
      "They can no longer add or label photos, or use staff Photos and People.",
      "Their photos, credit and review history stay with their account.",
      "Their open photo tasks end.",
    ],
    done: (name: string, venue: string) =>
      `${name} is now a venue manager at ${venue}. It takes effect on ${firstName(name)}'s next page load.`,
  },
  toStaff: {
    title: (name: string) => `Return ${name} to a staff account?`,
    bullets: [
      "Their venue access ends now.",
      "They'll have a staff account with upload and portfolio access, and no review rights.",
    ],
    done: (name: string, venue: string) =>
      `${name} is now a staff account at ${venue}. It takes effect on ${firstName(name)}'s next page load.`,
  },
  venue: "Venue",
  chooseVenue: "Choose a venue.",
  reason: "Reason",
  reasonHelp: "It's kept in the account history, with your name and the time.",
  historyHeading: "History",
  historyEmpty: "No account type changes yet.",
  historyUnavailable: "The account type history couldn't be loaded.",
  roleName: { staff: "Staff", manager: "Venue manager" } as Record<
    AccountRole,
    string
  >,
} as const

const ENDED_KIND: Record<string, string> = {
  revoked: "revoked by an admin",
  venue_changed: "moved venue",
  deactivated: "account deactivated",
  role_changed: "account type changed",
}

export type AccountTypeMember = {
  id: string
  displayName: string
  status: "active" | "invited" | "inactive"
  venueId: string | null
  venueName: string | null
}

function historyLine(change: AccountRoleChange) {
  const names = ACCOUNT_TYPE_COPY.roleName
  const move =
    change.from && change.to
      ? `${names[change.from]} → ${names[change.to]}`
      : "Account type changed"
  return [
    formatDate(change.at),
    change.actorName ?? "An admin",
    move,
    change.reason,
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * The account's type on its staff page: a staff account can be made a venue
 * manager, and a venue manager account returned to staff, each with a venue
 * and a reason. Admin-only; every change is audited.
 */
export function AccountTypePanel({
  member,
  role,
  venues,
  grant,
  history,
}: {
  member: AccountTypeMember
  role: AccountRole
  /** Active venues the account can be assigned to. */
  venues: Option[]
  /** The effective grant, else the one that ended most recently. */
  grant: GrantRecord | null
  /** The last account type changes; null when they couldn't be loaded. */
  history: AccountRoleChange[] | null
}) {
  const router = useRouter()
  const ids = React.useId()
  const intents = useRequestIds()
  const action = useCoverageAction(() => router.refresh())
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(false)
  const [venueId, setVenueId] = React.useState<string | null>(null)
  const [venueError, setVenueError] = React.useState<string | null>(null)

  const name = member.displayName
  const inactive = member.status === "inactive"
  const toRole: AccountRole = role === "staff" ? "manager" : "staff"
  const defaultVenue = venues.find((v) => v.id === member.venueId)?.id ?? null
  const chosenVenue = venues.find((v) => v.id === venueId) ?? null
  const currentVenueActive = venues.some((v) => v.id === member.venueId)
  const inEffect = !!grant?.effective && !grant.revokedAt

  function openDialog() {
    setVenueId(defaultVenue)
    setVenueError(null)
    setOpen(true)
  }

  async function convert(reason: string): Promise<ReasonOutcome> {
    if (!venueId) {
      setVenueError(ACCOUNT_TYPE_COPY.chooseVenue)
      return { ok: false, error: ACCOUNT_TYPE_COPY.chooseVenue }
    }
    setVenueError(null)
    const scope = `account-role:${member.id}:${toRole}`
    const payload = { profileId: member.id, venueId, reason }
    const input = {
      requestId: intents.requestIdFor(scope, payload),
      ...payload,
    }
    const venueName = chosenVenue?.name ?? "this venue"
    const result = await action.run(
      () =>
        toRole === "manager"
          ? convertToManagerAction(input)
          : convertToStaffAction(input),
      toRole === "manager"
        ? ACCOUNT_TYPE_COPY.toManager.done(name, venueName)
        : ACCOUNT_TYPE_COPY.toStaff.done(name, venueName)
    )
    // A lost or failed request keeps its id, so a retry replays it.
    if (
      result.ok ||
      (result.code !== "network" && result.code !== "unavailable")
    )
      intents.settle(scope)
    if (result.ok) return { ok: true }
    if (action.reportedOnPage(result)) return REPORTED
    const fieldErrors = "fieldErrors" in result ? result.fieldErrors : undefined
    if (fieldErrors?.venueId) setVenueError(fieldErrors.venueId)
    return {
      ok: false,
      error: result.message,
      fieldError: fieldErrors?.reason,
    }
  }

  async function giveAccess() {
    if (!member.venueId) return
    await action.run(
      () =>
        grantVenueManagerAction({
          staffId: member.id,
          venueId: member.venueId,
          reason: null,
        }),
      ACCOUNT_TYPE_COPY.accessGiven(name, member.venueName ?? "this venue")
    )
  }

  let state: React.ReactNode = null
  if (role === "manager") {
    state =
      inEffect && grant
        ? ACCOUNT_TYPE_COPY.inEffect(formatDate(grant.grantedAt))
        : grant?.revokedAt
          ? ACCOUNT_TYPE_COPY.ended(
              (grant.revokeKind && ENDED_KIND[grant.revokeKind]) ?? "ended"
            )
          : grant
            ? ACCOUNT_TYPE_COPY.notInEffect
            : ACCOUNT_TYPE_COPY.noAccess
  } else if (inEffect && grant) {
    state = ACCOUNT_TYPE_COPY.legacyGrant(grant.venueName)
  }

  const canGiveAccess =
    role === "manager" &&
    !inEffect &&
    !inactive &&
    !!member.venueId &&
    currentVenueActive &&
    // An open grant at the current venue that is not in effect is an
    // inactive venue or account: a new grant would not help.
    !(grant && !grant.revokedAt && grant.venueId === member.venueId)

  return (
    <section aria-labelledby={`${ids}-heading`} className="grid gap-3">
      <h2
        id={`${ids}-heading`}
        className="text-section-title-touch text-ink md:text-section-title"
      >
        {ACCOUNT_TYPE_COPY.heading}
      </h2>
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />
      <div className="grid gap-1 text-body-touch md:text-body-sm">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {role === "manager" ? (
            <>
              <StatusChip state="venue_manager" />
              <span>
                {ACCOUNT_TYPE_COPY.manager(member.venueName ?? "No venue")}
              </span>
            </>
          ) : (
            ACCOUNT_TYPE_COPY.staff
          )}
        </p>
        {state ? <p className="text-ink-muted">{state}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {canGiveAccess ? (
          <Button
            variant="secondary"
            size="touch"
            onClick={() => void giveAccess()}
            disabled={action.pending}
            aria-busy={action.pending || undefined}
          >
            <ShieldCheckIcon aria-hidden />
            {action.pending
              ? ACCOUNT_TYPE_COPY.givingAccess
              : ACCOUNT_TYPE_COPY.giveAccess(member.venueName ?? "")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="touch"
          onClick={openDialog}
          disabled={inactive || action.pending}
          aria-describedby={inactive ? `${ids}-inactive` : undefined}
        >
          {role === "staff" ? (
            <UserSwitchIcon aria-hidden />
          ) : (
            <ArrowUUpLeftIcon aria-hidden />
          )}
          {role === "staff"
            ? ACCOUNT_TYPE_COPY.makeManager
            : ACCOUNT_TYPE_COPY.returnToStaff}
        </Button>
      </div>
      {inactive ? (
        <p
          id={`${ids}-inactive`}
          className="text-meta-touch text-ink-muted md:text-meta"
        >
          {ACCOUNT_TYPE_COPY.inactive}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <h3 className="text-meta-strong text-ink-muted">
          {ACCOUNT_TYPE_COPY.historyHeading}
        </h3>
        {history === null ? (
          <p className="text-meta-touch text-ink-muted md:text-meta">
            {ACCOUNT_TYPE_COPY.historyUnavailable}
          </p>
        ) : history.length === 0 ? (
          <p className="text-meta-touch text-ink-muted md:text-meta">
            {ACCOUNT_TYPE_COPY.historyEmpty}
          </p>
        ) : (
          <ul
            aria-label={ACCOUNT_TYPE_COPY.historyHeading}
            className="grid gap-1 text-meta-touch break-words md:text-meta"
          >
            {history.map((change) => (
              <li key={change.id}>{historyLine(change)}</li>
            ))}
          </ul>
        )}
      </div>

      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={
          toRole === "manager"
            ? ACCOUNT_TYPE_COPY.toManager.title(name)
            : ACCOUNT_TYPE_COPY.toStaff.title(name)
        }
        label={ACCOUNT_TYPE_COPY.reason}
        help={ACCOUNT_TYPE_COPY.reasonHelp}
        confirmLabel={
          toRole === "manager"
            ? ACCOUNT_TYPE_COPY.makeManager
            : ACCOUNT_TYPE_COPY.returnToStaff
        }
        pendingLabel={
          toRole === "manager"
            ? ACCOUNT_TYPE_COPY.makingManager
            : ACCOUNT_TYPE_COPY.returningToStaff
        }
        destructive={toRole === "staff"}
        onConfirm={convert}
        reportFocus={() => noticeRef.current}
      >
        <div className="grid gap-1.5">
          <label
            htmlFor={`${ids}-venue`}
            className="text-label-touch text-ink md:text-label"
          >
            {ACCOUNT_TYPE_COPY.venue}
          </label>
          <OptionSelect
            id={`${ids}-venue`}
            options={venues}
            value={venueId}
            onValueChange={(next) => {
              setVenueId(next)
              setVenueError(null)
            }}
            placeholder={ACCOUNT_TYPE_COPY.chooseVenue}
            invalid={!!venueError}
            className="max-md:min-h-11"
          />
          {venueError ? <FieldError>{venueError}</FieldError> : null}
        </div>
        <ul className="grid list-disc gap-1 ps-5 text-body-touch text-ink md:text-body-sm">
          {(toRole === "manager"
            ? ACCOUNT_TYPE_COPY.toManager.bullets(
                chosenVenue?.name ?? "the chosen venue"
              )
            : ACCOUNT_TYPE_COPY.toStaff.bullets
          ).map((line) => (
            <li key={line.slice(0, 24)}>{line}</li>
          ))}
        </ul>
      </ReasonDialog>
    </section>
  )
}
