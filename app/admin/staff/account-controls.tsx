"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react"

import {
  EditProfileDialog,
  type ActionResult,
  type Option,
  type ProfileFormValues,
  type StaffMember,
} from "@/components/nabalens"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import {
  resendInvitationAction,
  setStaffActiveAction,
  updateStaffAccountAction,
} from "./actions"

export type Notice = { tone: "success" | "error" | "warning"; text: string }

/** Polite live region for the outcome of the last account action. */
export function AccountNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | null
  onDismiss: () => void
}) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {notice ? (
        <Alert
          role="status"
          variant={
            notice.tone === "error"
              ? "destructive"
              : notice.tone === "warning"
                ? "warning"
                : "default"
          }
          className="flex items-start gap-2"
        >
          {notice.tone === "success" ? (
            <CheckCircleIcon aria-hidden className="mt-0.5" />
          ) : (
            <WarningIcon aria-hidden className="mt-0.5" />
          )}
          <AlertDescription className="flex-1">{notice.text}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </Alert>
      ) : null}
    </div>
  )
}

async function uploadAvatar(
  staffId: string,
  file: File
): Promise<ActionResult> {
  const body = new FormData()
  body.set("file", file)
  try {
    const response = await fetch(
      `/admin/staff/${encodeURIComponent(staffId)}/avatar`,
      { method: "POST", body }
    )
    const json = (await response.json().catch(() => null)) as {
      error?: string
      fieldErrors?: Record<string, string>
    } | null
    if (response.ok) return { ok: true }
    return {
      ok: false,
      error: json?.error ?? "The photo could not be saved. Try again.",
      fieldErrors: json?.fieldErrors,
    }
  } catch {
    return { ok: false, error: "The photo could not be uploaded. Try again." }
  }
}

/**
 * Edit, resend and (de)activate for one or many staff accounts. Returns the
 * handlers plus the dialogs to render once; both the directory and a single
 * portfolio page use it.
 */
export function useAccountControls({
  venues,
  maxAvatarBytes,
}: {
  venues: Option[]
  maxAvatarBytes: number
}) {
  const router = useRouter()
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [editing, setEditing] = React.useState<StaffMember | null>(null)
  const [deactivating, setDeactivating] = React.useState<StaffMember | null>(
    null
  )
  const [pending, setPending] = React.useState(false)
  const [deactivateError, setDeactivateError] = React.useState<string | null>(
    null
  )

  async function resend(member: StaffMember) {
    setNotice(null)
    const result = await resendInvitationAction(member.id)
    setNotice(
      result.ok
        ? {
            tone: "success",
            text: `Invitation sent again to ${member.email ?? member.displayName}.`,
          }
        : { tone: "error", text: result.error }
    )
  }

  async function reactivate(member: StaffMember) {
    setNotice(null)
    const result = await setStaffActiveAction(member.id, true)
    setNotice(
      result.ok
        ? {
            tone: "success",
            text: `${member.displayName} can sign in again.`,
          }
        : { tone: "error", text: result.error }
    )
  }

  function setActive(member: StaffMember, active: boolean) {
    if (active) void reactivate(member)
    else {
      setDeactivateError(null)
      setDeactivating(member)
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return
    setPending(true)
    setDeactivateError(null)
    try {
      const result = await setStaffActiveAction(deactivating.id, false)
      if (!result.ok) {
        setDeactivateError(result.error)
        return
      }
      setNotice({
        tone: result.warning ? "warning" : "success",
        text:
          result.warning ??
          `${deactivating.displayName} is deactivated. Their uploads stay in the library.`,
      })
      setDeactivating(null)
    } catch {
      setDeactivateError("The account could not be deactivated. Try again.")
    } finally {
      setPending(false)
    }
  }

  async function saveEdit(
    member: StaffMember,
    values: ProfileFormValues
  ): Promise<ActionResult> {
    try {
      if (values.avatarFile) {
        const avatar = await uploadAvatar(member.id, values.avatarFile)
        if (!avatar.ok) return avatar
      }
      const result = await updateStaffAccountAction(member.id, {
        displayName: values.displayName,
        jobTitle: values.jobTitle ?? null,
        ...(values.venueId ? { venueId: values.venueId } : {}),
        ...(values.active !== undefined ? { active: values.active } : {}),
      })
      if (result.ok) {
        setNotice({
          tone: result.warning ? "warning" : "success",
          text: result.warning ?? `Saved ${values.displayName}.`,
        })
      }
      return result
    } finally {
      // Picks up a new photo even when a later field failed.
      router.refresh()
    }
  }

  const dialogs = (
    <>
      <EditProfileDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        variant="admin"
        initial={{
          displayName: editing?.displayName ?? "",
          avatarUrl: editing?.avatarUrl ?? null,
          jobTitle: editing?.jobTitle ?? null,
          venueId: editing?.venueId ?? null,
          active: editing ? editing.status !== "inactive" : true,
        }}
        venues={venues}
        maxAvatarBytes={maxAvatarBytes}
        onSubmit={(values) =>
          editing
            ? saveEdit(editing, values)
            : { ok: false, error: "Nothing to save." }
        }
      />
      <AlertDialog
        open={!!deactivating}
        onOpenChange={(open) => {
          if (!open && !pending) setDeactivating(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {deactivating?.displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose access straight away, including on phones where they are
              still signed in. Their uploads stay in the library, and you can
              reactivate the account later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deactivateError ? (
            <p role="alert" className="text-sm text-negative">
              {deactivateError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel size="touch" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              size="touch"
              onClick={confirmDeactivate}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Deactivating…" : "Deactivate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return {
    notice,
    setNotice,
    dismissNotice: () => setNotice(null),
    edit: (member: StaffMember) => setEditing(member),
    resend,
    setActive,
    dialogs,
  }
}
