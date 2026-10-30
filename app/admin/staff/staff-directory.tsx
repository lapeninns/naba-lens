"use client"

import * as React from "react"
import { UserPlusIcon } from "@phosphor-icons/react"

import {
  EmptyState,
  InviteStaffDialog,
  StaffDirectoryTable,
  type InviteResult,
  type Option,
  type StaffMember,
} from "@/components/nabalens"
import { Button } from "@/components/ui/button"

import { AccountNotice, useAccountControls } from "./account-controls"
import { inviteStaffAction } from "./actions"

export function StaffDirectory({
  staff,
  venues,
  maxAvatarBytes,
}: {
  staff: StaffMember[]
  venues: Option[]
  maxAvatarBytes: number
}) {
  const [inviting, setInviting] = React.useState(false)
  const controls = useAccountControls({ venues, maxAvatarBytes })

  const invite = async (
    values: Parameters<typeof inviteStaffAction>[0]
  ): Promise<InviteResult> => inviteStaffAction(values)

  const inviteButton = (
    <Button size="touch" onClick={() => setInviting(true)}>
      <UserPlusIcon data-icon="inline-start" aria-hidden />
      Invite staff
    </Button>
  )

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Staff
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {staff.length === 1 ? "1 account" : `${staff.length} accounts`}
          </p>
        </div>
        <div className="[&>*]:w-full sm:[&>*]:w-auto">{inviteButton}</div>
      </div>

      <AccountNotice
        notice={controls.notice}
        onDismiss={controls.dismissNotice}
      />

      {staff.length === 0 ? (
        <EmptyState
          title="No staff yet"
          description="Invite your first team member. They get an email with a sign-in link."
        />
      ) : (
        <StaffDirectoryTable
          staff={staff.map(controls.withConfirmedStatus)}
          getPortfolioHref={(member) =>
            `/admin/staff/${encodeURIComponent(member.id)}`
          }
          onEdit={controls.edit}
          onResendInvite={(member) => void controls.resend(member)}
          onSetActive={controls.setActive}
        />
      )}

      <InviteStaffDialog
        open={inviting}
        onOpenChange={setInviting}
        venues={venues}
        onSubmit={invite}
      />
      {controls.dialogs}
    </div>
  )
}
