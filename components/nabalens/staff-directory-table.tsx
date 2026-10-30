"use client"

import Link from "next/link"
import { DotsThreeIcon } from "@phosphor-icons/react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { cn } from "@/lib/utils"

import { ProfileAvatar } from "./profile-avatar"
import { StaffStatusBadge } from "./staff-status-badge"
import type { StaffMember } from "./types"

type StaffDirectoryTableProps = {
  staff: StaffMember[]
  getPortfolioHref: (member: StaffMember) => string
  onEdit: (member: StaffMember) => void
  onResendInvite: (member: StaffMember) => void
  onSetActive: (member: StaffMember, active: boolean) => void
  className?: string
}

function RowActions({
  member,
  onEdit,
  onResendInvite,
  onSetActive,
}: Omit<
  StaffDirectoryTableProps,
  "staff" | "getPortfolioHref" | "className"
> & {
  member: StaffMember
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11 sm:size-9"
            aria-label={`More actions for ${member.displayName}`}
          />
        }
      >
        <DotsThreeIcon weight="bold" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onClick={() => onEdit(member)}>
          Edit details
        </DropdownMenuItem>
        {member.status === "invited" ? (
          <DropdownMenuItem onClick={() => onResendInvite(member)}>
            Resend invitation
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {member.status === "inactive" ? (
          <DropdownMenuItem onClick={() => onSetActive(member, true)}>
            Reactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onSetActive(member, false)}
          >
            Deactivate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Table from md up; a list of two-line rows on phones. Same actions in both. */
export function StaffDirectoryTable({
  staff,
  getPortfolioHref,
  className,
  ...actions
}: StaffDirectoryTableProps) {
  const portfolioLink = (member: StaffMember) => (
    <Link
      href={getPortfolioHref(member)}
      className={cn(buttonVariants({ variant: "outline" }))}
      aria-label={`Open ${member.displayName}'s portfolio`}
    >
      Portfolio
    </Link>
  )

  return (
    <div className={cn("min-w-0", className)}>
      <ul
        aria-label="Staff"
        className="divide-y rounded-lg border bg-card md:hidden"
      >
        {staff.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-1 py-1 pr-1 pl-3"
          >
            <Link
              href={getPortfolioHref(member)}
              className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ProfileAvatar name={member.displayName} src={member.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {member.displayName}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2">
                  <StaffStatusBadge
                    status={member.status}
                    className="shrink-0"
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    {[member.jobTitle, member.venueName ?? "No venue"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </span>
              <span className="sr-only">, open portfolio</span>
            </Link>
            <RowActions member={member} {...actions} />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Name</TableHead>
              <TableHead className="hidden lg:table-cell">Job title</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="max-w-64 py-2.5 pl-4 whitespace-normal">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProfileAvatar
                      name={member.displayName}
                      src={member.avatarUrl}
                      className="size-8"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {member.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground lg:hidden">
                        {member.jobTitle ?? "No job title"}
                      </p>
                      {member.email ? (
                        <p className="hidden truncate text-xs text-muted-foreground lg:block">
                          {member.email}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {member.jobTitle ?? "—"}
                </TableCell>
                <TableCell className="min-w-32 whitespace-normal">
                  {member.venueName ?? (
                    <span className="text-muted-foreground">No venue</span>
                  )}
                </TableCell>
                <TableCell>
                  <StaffStatusBadge status={member.status} />
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-1">
                    {portfolioLink(member)}
                    <RowActions member={member} {...actions} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
