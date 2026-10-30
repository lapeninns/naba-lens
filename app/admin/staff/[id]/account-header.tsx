"use client"

import {
  ProfileHeader,
  StaffStatusBadge,
  type Option,
  type StaffMember,
} from "@/components/nabalens"
import { Button } from "@/components/ui/button"

import { AccountNotice, useAccountControls } from "../account-controls"

/** Profile header for one staff account, with the admin's account actions. */
export function AccountHeader({
  member: fromProps,
  venueActive,
  venues,
  maxAvatarBytes,
}: {
  member: StaffMember
  venueActive: boolean | null
  venues: Option[]
  maxAvatarBytes: number
}) {
  const controls = useAccountControls({ venues, maxAvatarBytes })
  const member = controls.withConfirmedStatus(fromProps)
  return (
    <div className="grid gap-4">
      <ProfileHeader
        displayName={member.displayName}
        avatarUrl={member.avatarUrl}
        jobTitle={member.jobTitle}
        venueName={
          member.venueName && venueActive === false
            ? `${member.venueName} (inactive venue)`
            : member.venueName
        }
        meta={
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StaffStatusBadge status={member.status} />
            {member.email ? (
              <span className="break-all">{member.email}</span>
            ) : null}
          </span>
        }
        actions={
          <>
            {member.status === "inactive" ? (
              <Button
                variant="outline"
                size="touch"
                onClick={() => controls.setActive(member, true)}
              >
                Reactivate
              </Button>
            ) : (
              <Button
                variant="outline"
                size="touch"
                onClick={() => controls.setActive(member, false)}
              >
                Deactivate
              </Button>
            )}
            {member.status === "invited" ? (
              <Button
                variant="outline"
                size="touch"
                onClick={() => void controls.resend(member)}
              >
                Resend invitation
              </Button>
            ) : null}
            <Button size="touch" onClick={() => controls.edit(member)}>
              Edit details
            </Button>
          </>
        }
      />
      <AccountNotice
        notice={controls.notice}
        onDismiss={controls.dismissNotice}
      />
      {controls.dialogs}
    </div>
  )
}
