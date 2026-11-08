"use client"

import Link from "next/link"
import {
  ArrowCounterClockwiseIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  IdentificationCardIcon,
  PencilSimpleIcon,
  ProhibitIcon,
  UserGearIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Department } from "@/lib/config/departments"
import { cn } from "@/lib/utils"

import { ProfileAvatar } from "./profile-avatar"
import { StaffStatusBadge } from "./staff-status-badge"
import { StatusChip } from "./status-chip"
import type { StaffMember } from "./types"

/** A resend or reactivate the server hasn't answered yet. */
export type StaffActionPending = {
  action: "resend" | "reactivate"
  memberId: string
}

type StaffActions = {
  onEdit: (member: StaffMember) => void
  onResendInvite: (member: StaffMember) => void
  onSetActive: (member: StaffMember, active: boolean) => void
  /** While set, resend and (de)activate wait for it on every account. */
  pending?: StaffActionPending | null
}

type StaffDirectoryTableProps = StaffActions & {
  staff: StaffMember[]
  getPortfolioHref: (member: StaffMember) => string
  /** Accounts holding an effective venue manager grant. */
  managerIds?: ReadonlySet<string>
  className?: string
}

const TEAM_SHORT: Record<Department, { short: string; long: string }> = {
  foh: { short: "FOH", long: "Front of house" },
  boh: { short: "BOH", long: "Back of house" },
}

/** FOH, BOH or Unassigned, in the quiet weight of a fact. */
export function TeamLabel({
  department,
}: {
  department: Department | null | undefined
}) {
  if (!department) return <span className="text-ink-muted">Unassigned</span>
  const team = TEAM_SHORT[department]
  return (
    <abbr title={team.long} className="font-bold no-underline">
      {team.short}
    </abbr>
  )
}

/**
 * Every action on one account, behind one "More actions" button. Rows never
 * carry inline buttons; the menu repeats the person's name as its label.
 */
export function StaffActionsMenu({
  member,
  onEdit,
  onResendInvite,
  onSetActive,
  pending = null,
  profileHref,
  makeManagerHref,
  className,
}: StaffActions & {
  member: StaffMember
  /** "Open profile", where the menu is not already on the profile. */
  profileHref?: string
  /** "Make venue manager", for active accounts without a grant. */
  makeManagerHref?: string
  className?: string
}) {
  const busyWith = pending?.memberId === member.id ? pending.action : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            size="icon"
            className={className}
            aria-label={`More actions for ${member.displayName}`}
          />
        }
      >
        <DotsThreeIcon weight="bold" aria-hidden />
      </DropdownMenuTrigger>
      {/* Capped so a long name wraps instead of widening the menu off-screen. */}
      <DropdownMenuContent
        align="end"
        className="w-auto max-w-[min(20rem,var(--available-width))] min-w-52"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-meta-strong break-words text-ink-muted">
            {member.displayName}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onEdit(member)}>
            <PencilSimpleIcon aria-hidden />
            Edit details
          </DropdownMenuItem>
          {member.status === "invited" ? (
            <DropdownMenuItem
              disabled={!!pending}
              onClick={() => onResendInvite(member)}
            >
              <EnvelopeSimpleIcon aria-hidden />
              {busyWith === "resend"
                ? "Sending invitation…"
                : "Resend invitation"}
            </DropdownMenuItem>
          ) : null}
          {profileHref ? (
            <DropdownMenuItem render={<Link href={profileHref} />}>
              <IdentificationCardIcon aria-hidden />
              Open profile
            </DropdownMenuItem>
          ) : null}
          {makeManagerHref && member.status !== "inactive" ? (
            <DropdownMenuItem render={<Link href={makeManagerHref} />}>
              <UserGearIcon aria-hidden />
              Make venue manager
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {member.status === "inactive" ? (
          <DropdownMenuItem
            disabled={!!pending}
            onClick={() => onSetActive(member, true)}
          >
            <ArrowCounterClockwiseIcon aria-hidden />
            {busyWith === "reactivate" ? "Reactivating…" : "Reactivate"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            disabled={!!pending}
            onClick={() => onSetActive(member, false)}
          >
            <ProhibitIcon aria-hidden />
            Deactivate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusCell({
  member,
  manager,
}: {
  member: StaffMember
  manager: boolean
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StaffStatusBadge status={member.status} />
      {manager && member.status !== "inactive" ? (
        <StatusChip state="venue_manager" />
      ) : null}
    </span>
  )
}

/**
 * Staff accounts: a table from md up, two-line rows on phones. The order is
 * the caller's; every action sits in the row's More actions menu.
 */
export function StaffDirectoryTable({
  staff,
  getPortfolioHref,
  managerIds,
  className,
  ...actions
}: StaffDirectoryTableProps) {
  const isManager = (member: StaffMember) => managerIds?.has(member.id) ?? false
  const menu = (member: StaffMember) => (
    <StaffActionsMenu
      member={member}
      profileHref={getPortfolioHref(member)}
      {...actions}
    />
  )
  const nameLink = (member: StaffMember) => (
    <Link
      href={getPortfolioHref(member)}
      // On phones the padding makes a 44px+ hit area; the negative margin keeps
      // the text where it was, and `relative` keeps it above the meta line.
      className="relative block truncate rounded-chip text-item-title text-ink underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid max-md:-my-3.5 max-md:py-3.5"
    >
      {member.displayName}
    </Link>
  )

  return (
    <div className={cn("min-w-0", className)}>
      <ul
        aria-label="Staff"
        className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card md:hidden"
      >
        {staff.map((member) => (
          <li
            key={member.id}
            className={cn(
              "flex min-h-16 items-center gap-3 py-2 pr-1 pl-3",
              member.status === "inactive" && "text-ink-muted"
            )}
          >
            <ProfileAvatar
              name={member.displayName}
              src={member.avatarUrl}
              size="md"
            />
            <div className="grid min-w-0 flex-1 gap-1 py-1 text-body">
              {nameLink(member)}
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted">
                <StatusCell member={member} manager={isManager(member)} />
                <span className="truncate">
                  {member.venueName ?? "No venue"} ·{" "}
                  <TeamLabel department={member.department} />
                </span>
              </span>
            </div>
            {menu(member)}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-card bg-surface px-2 shadow-card md:block">
        <Table aria-label="Staff">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="pl-4">
                Name
              </TableHead>
              <TableHead scope="col">Venue</TableHead>
              <TableHead scope="col" className="hidden lg:table-cell">
                Team
              </TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="w-12 pr-3 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((member) => (
              <TableRow
                key={member.id}
                className={cn(
                  "text-body",
                  member.status === "inactive" && "text-ink-muted"
                )}
              >
                <TableCell className="max-w-72 py-2.5 pl-4 whitespace-normal">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProfileAvatar
                      name={member.displayName}
                      src={member.avatarUrl}
                      size="md"
                    />
                    <div className="grid min-w-0">
                      {nameLink(member)}
                      {member.email ? (
                        <span className="truncate font-mono text-meta text-ink-muted">
                          {member.email}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="min-w-32 whitespace-normal">
                  {member.venueName ?? (
                    <span className="text-ink-muted">No venue</span>
                  )}
                  <span className="block text-meta text-ink-muted lg:hidden">
                    <TeamLabel department={member.department} />
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <TeamLabel department={member.department} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <StatusCell member={member} manager={isManager(member)} />
                </TableCell>
                <TableCell className="pr-3 text-right">
                  {menu(member)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
