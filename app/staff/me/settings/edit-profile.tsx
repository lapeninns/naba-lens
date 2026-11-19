"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PencilSimpleIcon } from "@phosphor-icons/react"

import { PROFILE_SAVE_COPY, saveProfile } from "@/app/staff/staff-portfolio"
import { EditProfileDialog } from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { MEDIA_LIMITS } from "@/lib/config/media"

/**
 * Edit profile on Settings (DESIGN.md §5b): name and photo, in the same
 * dialog and through the same /api/profile save as before. The result is
 * written on the page (§6.7).
 */
export function EditProfile({
  displayName,
  avatarUrl,
}: {
  displayName: string
  avatarUrl: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  return (
    <div className="grid gap-2">
      <Button
        variant="secondary"
        className="min-h-12 justify-self-start"
        onClick={() => {
          setSaved(false)
          setOpen(true)
        }}
      >
        <PencilSimpleIcon data-icon="inline-start" aria-hidden />
        Edit profile
      </Button>
      {saved ? (
        <Notice tone="positive">{PROFILE_SAVE_COPY.saved}</Notice>
      ) : null}
      <EditProfileDialog
        open={open}
        onOpenChange={setOpen}
        variant="staff"
        initial={{ displayName, avatarUrl }}
        maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
        onSubmit={async (values) => {
          const result = await saveProfile(values)
          if (result.ok) {
            setSaved(true)
            router.refresh()
          }
          return result
        }}
      />
    </div>
  )
}
