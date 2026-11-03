"use client"

import Link from "next/link"
import {
  ArrowCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react"

import {
  formatDate,
  StaffStatusBadge,
  type Option,
  type StaffMember,
} from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  StaffActionsMenu,
  TeamLabel,
} from "@/components/nabalens/staff-directory-table"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"

import {
  AccountNotice,
  useAccountControls,
  type ManagerGrant,
} from "../account-controls"
import { firstName } from "../staff-order"

/** The grant shown in Account: the effective one, else the latest that ended. */
export type GrantRecord = {
  venueId: string
  venueName: string
  grantedAt: string
  grantedByName: string | null
  revokedAt: string | null
  revokeKind:
    "revoked" | "venue_changed" | "deactivated" | "role_changed" | null
  effective: boolean
}

const ENDING_STATE = {
  revoked: "revoked",
  venue_changed: "ended_moved",
  deactivated: "ended_deactivated",
} as const

function grantDates(from: string, to: string) {
  const start = formatDate(from)
  const end = formatDate(to)
  const year = end.slice(-4)
  return `${start.endsWith(year) ? start.slice(0, -5) : start} to ${end}`
}

function GrantDetail({
  grant,
  inactive,
}: {
  grant: GrantRecord | null
  inactive: boolean
}) {
  if (grant?.effective && !grant.revokedAt && !inactive) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip state="venue_manager" />
        <span>
          {grant.venueName} · since {formatDate(grant.grantedAt)}
          {grant.grantedByName ? ` · granted by ${grant.grantedByName}` : ""}
        </span>
      </span>
    )
  }
  if (grant?.revokedAt) {
    const ending =
      grant.revokeKind && grant.revokeKind !== "role_changed"
        ? ENDING_STATE[grant.revokeKind]
        : null
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {grant.venueName} · {grantDates(grant.grantedAt, grant.revokedAt)}
        </span>
        {ending ? <StatusChip state={ending} /> : null}
      </span>
    )
  }
  return (
    <span>
      None. Make someone a venue manager on{" "}
      <Link
        href="/admin/coverage/managers"
        className="font-semibold text-ink underline underline-offset-3"
      >
        Venue managers
      </Link>
      .
    </span>
  )
}

/**
 * The top of one staff member's page and their Account details, with every
 * account action. Status follows what the server confirmed at once, without
 * waiting for the page to re-render.
 */
export function AccountHeader({
  member: fromProps,
  venueActive,
  venues,
  maxAvatarBytes,
  grant = null,
  notices,
  photos,
}: {
  member: StaffMember
  venueActive: boolean | null
  venues: Option[]
  maxAvatarBytes: number
  /** The grant to describe under Account (see GrantRecord). */
  grant?: GrantRecord | null
  /** Server notices shown under the header (sign-in details unavailable). */
  notices?: React.ReactNode
  /** The Photos section, rendered on the server. */
  photos?: React.ReactNode
}) {
  const effective: ManagerGrant[] =
    grant?.effective && !grant.revokedAt
      ? [
          {
            staffId: fromProps.id,
            venueId: grant.venueId,
            venueName: grant.venueName,
          },
        ]
      : []
  const controls = useAccountControls({
    venues,
    maxAvatarBytes,
    grants: effective,
  })
  const member = controls.withConfirmedStatus(fromProps)
  const first = firstName(member.displayName)
  const inactive = member.status === "inactive"
  const isManager = effective.length > 0 && !inactive
  const venueName =
    member.venueName && venueActive === false
      ? `${member.venueName} (inactive venue)`
      : member.venueName

  return (
    <div className="grid gap-5">
      <AccountNotice
        notice={controls.notice}
        onDismiss={controls.dismissNotice}
      />
      <PageHeader
        venueScope
        scope={member.venueName ?? "No venue"}
        title={member.displayName}
        className="pb-0 md:pb-0"
        summary={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {member.jobTitle ? <span>{member.jobTitle} ·</span> : null}
            <StaffStatusBadge status={member.status} />
            {isManager ? <StatusChip state="venue_manager" /> : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="touch"
              onClick={() => controls.edit(member)}
            >
              <PencilSimpleIcon aria-hidden />
              Edit details
            </Button>
            <StaffActionsMenu
              member={member}
              className="flex-none!"
              makeManagerHref={
                !isManager && member.venueId
                  ? `/admin/coverage/managers?venue=${encodeURIComponent(member.venueId)}`
                  : undefined
              }
              onEdit={controls.edit}
              onResendInvite={(m) => void controls.resend(m)}
              onSetActive={controls.setActive}
            />
          </>
        }
      />

      <OfflineNotice />
      {notices}
      {member.status === "invited" ? (
        <Notice
          title="Invited"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void controls.resend(member)}
            >
              <EnvelopeSimpleIcon aria-hidden />
              Resend invitation
            </Button>
          }
        >
          {first} hasn&apos;t signed in yet.
        </Notice>
      ) : null}
      {inactive ? (
        <Notice
          title="Inactive"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => controls.setActive(member, true)}
            >
              <ArrowCounterClockwiseIcon aria-hidden />
              Reactivate
            </Button>
          }
        >
          {first} can&apos;t sign in. {first}&apos;s uploads stay in the library
          {member.venueName
            ? ` and in ${member.venueName}'s past coverage`
            : ""}
          .
        </Notice>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {photos}
        <section aria-labelledby="account-heading" className="grid gap-3">
          <h2
            id="account-heading"
            className="text-section-title-touch text-ink md:text-section-title"
          >
            Account
          </h2>
          <dl className="grid gap-3 text-body-touch md:text-body-sm">
            {member.email ? (
              <div className="grid gap-0.5">
                <dt className="text-meta-strong text-ink-muted">Email</dt>
                <dd className="break-all">{member.email}</dd>
              </div>
            ) : null}
            <div className="grid gap-0.5">
              <dt className="text-meta-strong text-ink-muted">Status</dt>
              <dd>
                <StaffStatusBadge status={member.status} />
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-meta-strong text-ink-muted">Venue</dt>
              <dd>{venueName ?? "No venue"}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-meta-strong text-ink-muted">Team</dt>
              <dd>
                <TeamLabel department={member.department} />
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-meta-strong text-ink-muted">Job title</dt>
              <dd>{member.jobTitle ?? "None"}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-meta-strong text-ink-muted">
                Venue manager grant
              </dt>
              <dd>
                <GrantDetail grant={grant} inactive={inactive} />
              </dd>
            </div>
          </dl>
        </section>
      </div>
      {controls.dialogs}
    </div>
  )
}
