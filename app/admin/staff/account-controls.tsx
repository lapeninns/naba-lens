"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "@phosphor-icons/react"

import type { ActionResult, Option, StaffMember } from "@/components/nabalens"
import { Notice, type NoticeTone } from "@/components/nabalens/notice"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { StaffActionPending } from "@/components/nabalens/staff-directory-table"
import { Button } from "@/components/ui/button"

import {
  resendInvitationAction,
  setStaffActiveAction,
  updateStaffAccountAction,
} from "./actions"
import {
  EditStaffDialog,
  type EditStaffResult,
  type EditStaffValues,
} from "./edit-staff-dialog"
import { firstName } from "./staff-order"

export type Notice = {
  tone: "success" | "error" | "warning" | "pending"
  text: string
}

/** An effective venue manager grant, as the staff pages need it. */
export type ManagerGrant = {
  staffId: string
  venueId: string
  venueName: string
}

const NOTICE_TONE: Record<Notice["tone"], NoticeTone> = {
  success: "positive",
  error: "negative",
  warning: "attention",
  pending: "info",
}

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
        <Notice
          tone={NOTICE_TONE[notice.tone]}
          role="status"
          action={
            notice.tone === "pending" ? undefined : (
              <Button
                variant="quiet"
                size="icon-sm"
                aria-label="Close"
                onClick={onDismiss}
              >
                <XIcon aria-hidden />
              </Button>
            )
          }
        >
          {notice.text}
        </Notice>
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
 * staff member's page use it.
 */
export function useAccountControls({
  venues,
  maxAvatarBytes,
  grants = [],
}: {
  venues: Option[]
  maxAvatarBytes: number
  /** Effective venue manager grants, to say what a move or deactivation ends. */
  grants?: ManagerGrant[]
}) {
  const router = useRouter()
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [editing, setEditing] = React.useState<StaffMember | null>(null)
  const [deactivating, setDeactivating] = React.useState<StaffMember | null>(
    null
  )
  const [pending, setPending] = React.useState(false)
  // Resend or reactivate in flight. The ref turns away a second tap that lands
  // before the re-render disables the buttons: each resend invalidates the
  // link sent before it.
  const [busy, setBusy] = React.useState<StaffActionPending | null>(null)
  const busyRef = React.useRef(false)
  const [deactivateError, setDeactivateError] = React.useState<string | null>(
    null
  )
  // Statuses the server has confirmed, keyed by account, with the server props
  // object they apply to. The action's own re-render of the page can arrive long
  // after its result (it re-reads Auth, media and venues: over 30 s on a loaded
  // host), so the header and buttons must not wait for it. Any server render
  // brings new props objects, and fresh props always win.
  const [confirmed, setConfirmed] = React.useState<
    Record<string, { status: StaffMember["status"]; basis: StaffMember }>
  >({})
  // Copies made by withConfirmedStatus -> the props object they came from.
  const basisOf = React.useRef(new WeakMap<StaffMember, StaffMember>())

  const grantOf = (member: StaffMember) =>
    grants.find((grant) => grant.staffId === member.id) ?? null

  function confirmStatus(member: StaffMember, status?: StaffMember["status"]) {
    if (status) {
      const basis = basisOf.current.get(member) ?? member
      setConfirmed((current) => ({
        ...current,
        [member.id]: { status, basis },
      }))
    }
  }

  /** The member as rendered from props, with a status the server confirmed since. */
  function withConfirmedStatus(member: StaffMember): StaffMember {
    const entry = confirmed[member.id]
    if (!entry || entry.basis !== member || entry.status === member.status) {
      return member
    }
    const shown = { ...member, status: entry.status }
    basisOf.current.set(shown, member)
    return shown
  }

  /** Runs one resend or reactivate at a time; a rejected call changes nothing. */
  async function runAction(
    action: StaffActionPending,
    pendingText: string,
    failedText: string,
    task: () => Promise<Notice>
  ) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(action)
    setNotice({ tone: "pending", text: pendingText })
    try {
      setNotice(await task())
    } catch {
      setNotice({ tone: "error", text: failedText })
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  function resend(member: StaffMember) {
    const to = member.email ?? member.displayName
    return runAction(
      { action: "resend", memberId: member.id },
      `Sending the invitation to ${to}…`,
      `Nothing changed. The invitation to ${to} wasn't sent. Check your connection and try again.`,
      async () => {
        const result = await resendInvitationAction(member.id)
        return result.ok
          ? {
              tone: "success",
              text: `Invitation sent again to ${to}. Earlier links stop working.`,
            }
          : { tone: "error", text: result.error }
      }
    )
  }

  function reactivate(member: StaffMember) {
    return runAction(
      { action: "reactivate", memberId: member.id },
      `Reactivating ${member.displayName}…`,
      `Nothing changed. ${member.displayName} still can't sign in. Check your connection and try again.`,
      async () => {
        const result = await setStaffActiveAction(member.id, true)
        if (!result.ok) return { tone: "error", text: result.error }
        confirmStatus(member, result.status)
        router.refresh()
        return {
          tone: "success",
          text: `${member.displayName} can sign in again.`,
        }
      }
    )
  }

  function setActive(member: StaffMember, active: boolean) {
    if (busyRef.current) return
    if (active) void reactivate(member)
    else {
      setDeactivateError(null)
      setDeactivating(member)
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return
    const first = firstName(deactivating.displayName)
    setPending(true)
    setDeactivateError(null)
    try {
      const result = await setStaffActiveAction(deactivating.id, false)
      if (!result.ok) {
        setDeactivateError(result.error)
        return
      }
      confirmStatus(deactivating, result.status)
      router.refresh()
      setNotice({
        tone: result.warning ? "warning" : "success",
        text:
          result.warning ??
          `${deactivating.displayName} is inactive. ${first}'s uploads stay in the library.`,
      })
      setDeactivating(null)
    } catch {
      setDeactivateError(
        `Nothing changed. ${first} still has access. Check your connection and try again.`
      )
    } finally {
      setPending(false)
    }
  }

  async function saveEdit(
    member: StaffMember,
    values: EditStaffValues
  ): Promise<EditStaffResult> {
    let photoSaved = false
    try {
      if (values.avatarFile) {
        const avatar = await uploadAvatar(member.id, values.avatarFile)
        if (!avatar.ok) return avatar
        photoSaved = true
      }
      const result = await updateStaffAccountAction(member.id, {
        displayName: values.displayName,
        jobTitle: values.jobTitle ?? null,
        ...(values.department !== undefined
          ? { department: values.department }
          : {}),
        ...(values.venueId ? { venueId: values.venueId } : {}),
        ...(values.active !== undefined ? { active: values.active } : {}),
      })
      if (!result.ok) return { ...result, photoSaved }
      if (result.status) confirmStatus(member, result.status)
      const moved =
        values.venueId && member.venueId && values.venueId !== member.venueId
      const grant = grantOf(member)
      const newVenue = venues.find((v) => v.id === values.venueId)?.name
      setNotice({
        tone: result.warning ? "warning" : "success",
        text:
          result.warning ??
          (moved && newVenue
            ? `${values.displayName} now works at ${newVenue}.${
                grant
                  ? ` The manager grant at ${grant.venueName} ended: Ended: moved to another venue.`
                  : ""
              }`
            : `Saved ${values.displayName}.`),
      })
      return result
    } finally {
      // The only refresh for an edit (also after an activation change): picks
      // up a new photo even when a later field failed.
      router.refresh()
    }
  }

  const deactivatingGrant = deactivating ? grantOf(deactivating) : null
  const deactivatingFirst = deactivating
    ? firstName(deactivating.displayName)
    : ""

  const dialogs = (
    <>
      <EditStaffDialog
        member={editing}
        onClose={() => setEditing(null)}
        venues={venues}
        grant={editing ? grantOf(editing) : null}
        managedVenueIds={
          new Set(
            grants
              .filter((grant) => grant.staffId !== editing?.id)
              .map((grant) => grant.venueId)
          )
        }
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
          </AlertDialogHeader>
          {deactivateError ? (
            <Notice tone="negative" title="Couldn't deactivate">
              {deactivateError}
            </Notice>
          ) : null}
          <AlertDialogDescription
            render={<div />}
            className="grid gap-3 text-ink"
          >
            <p>
              They lose access straight away. On a phone that&apos;s still
              signed in, the next thing they do shows Account unavailable.
            </p>
            <p>
              Their uploads stay in the library, and you can reactivate the
              account later.
            </p>
            {deactivatingGrant ? (
              <p>
                {deactivatingFirst}&apos;s venue manager grant at{" "}
                {deactivatingGrant.venueName} ends: &quot;Ended: account
                deactivated&quot;. Reactivating doesn&apos;t restore it.
              </p>
            ) : null}
            <p>
              {deactivatingFirst}&apos;s open task assignments
              {deactivating?.venueName
                ? ` at ${deactivating.venueName}`
                : ""}{" "}
              close, so those items show Needs reassignment. Accepted photos
              still count.
            </p>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="secondary"
              size="touch"
              disabled={pending}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="danger"
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
    /** The resend or reactivate in flight; every such action waits for it. */
    busy,
    withConfirmedStatus,
    grantOf,
    dialogs,
  }
}
