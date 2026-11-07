"use client"

import * as React from "react"

import {
  formatBytes,
  OptionSelect,
  ProfileAvatar,
  useObjectUrl,
  type ActionResult,
  type Option,
  type StaffMember,
} from "@/components/nabalens"
import { TeamField } from "@/components/nabalens/invite-staff-dialog"
import { Notice } from "@/components/nabalens/notice"
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { Department } from "@/lib/config/departments"

import type { ManagerGrant } from "./account-controls"
import { firstName } from "./staff-order"

export type EditStaffValues = {
  displayName: string
  /** New photo chosen in this dialog, or null to keep the current one. */
  avatarFile?: File | null
  jobTitle?: string
  department?: Department | null
  venueId?: string | null
  active?: boolean
}

/** `photoSaved`: the new photo went through before the details failed. */
export type EditStaffResult = ActionResult & { photoSaved?: boolean }

const AVATAR_TYPES =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"

function listWords(words: string[]) {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
}

const UK_MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "Europe/London",
})

/**
 * A8 Edit staff details: name, job title, team, venue, photo and access for
 * one account. Email and role stay fixed. A venue move spells out what it
 * ends before it is saved; closing with unsaved changes asks first.
 */
export function EditStaffDialog({
  member,
  onClose,
  ...props
}: {
  member: StaffMember | null
  onClose: () => void
  venues: Option[]
  /** The person's effective manager grant, which a venue move ends. */
  grant: ManagerGrant | null
  /** Venues where someone else holds an effective manager grant. */
  managedVenueIds?: ReadonlySet<string>
  /** Pass MEDIA_LIMITS.maxAvatarBytes. */
  maxAvatarBytes: number
  onSubmit: (
    values: EditStaffValues
  ) => Promise<EditStaffResult> | EditStaffResult
}) {
  // The last person stays rendered while the dialog animates closed; every
  // opening gets a fresh form.
  const open = !!member
  const [session, setSession] = React.useState({ shown: member, open, key: 0 })
  if (open !== session.open || (member && member !== session.shown)) {
    setSession({
      shown: member ?? session.shown,
      open,
      key:
        open && (!session.open || member !== session.shown)
          ? session.key + 1
          : session.key,
    })
  }
  return session.shown ? (
    <EditStaffForm
      key={session.key}
      open={open}
      member={session.shown}
      onClose={onClose}
      {...props}
    />
  ) : null
}

function EditStaffForm({
  open,
  member,
  onClose,
  venues,
  grant,
  managedVenueIds,
  maxAvatarBytes,
  onSubmit,
}: {
  open: boolean
  member: StaffMember
  onClose: () => void
  venues: Option[]
  grant: ManagerGrant | null
  managedVenueIds?: ReadonlySet<string>
  maxAvatarBytes: number
  onSubmit: (
    values: EditStaffValues
  ) => Promise<EditStaffResult> | EditStaffResult
}) {
  const initialActive = member.status !== "inactive"
  const [displayName, setDisplayName] = React.useState(member.displayName)
  const [jobTitle, setJobTitle] = React.useState(member.jobTitle ?? "")
  const [department, setDepartment] = React.useState<Department | null>(
    member.department ?? null
  )
  const [venueId, setVenueId] = React.useState(member.venueId)
  const [active, setActive] = React.useState(initialActive)
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [avatarError, setAvatarError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<EditStaffResult | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false)
  const avatarPreview = useObjectUrl(avatarFile)
  const id = React.useId()
  const first = firstName(member.displayName)

  const changed = [
    displayName.trim() !== member.displayName && "display name",
    avatarFile && "profile photo",
    jobTitle.trim() !== (member.jobTitle ?? "") && "job title",
    department !== (member.department ?? null) && "team",
    venueId !== member.venueId && "venue",
    active !== initialActive && "account status",
  ].filter((word): word is string => typeof word === "string")

  const moving = !!venueId && !!member.venueId && venueId !== member.venueId
  const newVenue = venues.find((v) => v.id === venueId)?.name ?? null

  function requestClose() {
    if (pending) return
    if (changed.length > 0) setConfirmingDiscard(true)
    else onClose()
  }

  function pickAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null
    setAvatarError(null)
    if (file && file.size > maxAvatarBytes) {
      setAvatarError(
        `Profile photos can be up to ${formatBytes(maxAvatarBytes)}.`
      )
      event.currentTarget.value = ""
      return
    }
    setAvatarFile(file)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (avatarError || pending) return
    setPending(true)
    setResult(null)
    try {
      const outcome = await onSubmit({
        displayName: displayName.trim(),
        avatarFile,
        jobTitle: jobTitle.trim(),
        department,
        venueId,
        active,
      })
      setResult(outcome)
      if (outcome.ok) onClose()
      else if (outcome.photoSaved) setAvatarFile(null)
    } catch {
      setResult({
        ok: false,
        error: "Your changes could not be saved. Try again.",
      })
    } finally {
      setPending(false)
    }
  }

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {}

  return (
    <>
      <Dialog
        open={open}
        // Escape, the scrim and the corner X all ask before dropping edits.
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
      >
        <DialogContent className="md:max-w-(--size-dialog-wide)">
          <form
            onSubmit={submit}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5"
            noValidate
          >
            <DialogHeader>
              <DialogTitle>
                Edit {member.displayName}&apos;s details
              </DialogTitle>
            </DialogHeader>

            {result && !result.ok ? (
              <Notice
                tone="negative"
                title={
                  result.photoSaved ? "Some changes didn't save" : undefined
                }
              >
                {result.photoSaved
                  ? `The profile photo was saved, but the other changes weren't. ${result.error}`
                  : result.error}
              </Notice>
            ) : null}

            <div className="flex items-center gap-4">
              <ProfileAvatar
                name={displayName || member.displayName}
                src={avatarPreview ?? member.avatarUrl}
                size="lg"
              />
              <Field className="min-w-0 flex-1 gap-1.5">
                <FieldLabel htmlFor={`${id}-photo`}>Profile photo</FieldLabel>
                <Input
                  id={`${id}-photo`}
                  type="file"
                  accept={AVATAR_TYPES}
                  onChange={pickAvatar}
                  aria-describedby={`${id}-photo-hint`}
                  aria-invalid={
                    !!avatarError || !!fieldErrors.avatar || undefined
                  }
                  className="cursor-pointer py-2 file:mr-3 file:h-full file:cursor-pointer file:rounded-control file:bg-surface file:px-3"
                />
                <FieldDescription id={`${id}-photo-hint`}>
                  JPEG, PNG, WebP or HEIC, up to {formatBytes(maxAvatarBytes)}.
                </FieldDescription>
                {avatarError || fieldErrors.avatar ? (
                  <FieldError>{avatarError ?? fieldErrors.avatar}</FieldError>
                ) : null}
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-2 md:gap-4">
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${id}-name`}>Display name</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.currentTarget.value)}
                  required
                  maxLength={80}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.displayName || undefined}
                />
                {fieldErrors.displayName ? (
                  <FieldError>{fieldErrors.displayName}</FieldError>
                ) : null}
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${id}-job`}>
                  Job title{" "}
                  <span className="font-normal text-ink-muted">(optional)</span>
                </FieldLabel>
                <Input
                  id={`${id}-job`}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.currentTarget.value)}
                  maxLength={80}
                  aria-invalid={!!fieldErrors.jobTitle || undefined}
                />
                {fieldErrors.jobTitle ? (
                  <FieldError>{fieldErrors.jobTitle}</FieldError>
                ) : null}
              </Field>
            </div>

            {member.email ? (
              <div className="grid gap-1.5">
                <p className="text-label">Email</p>
                <p className="font-mono break-all text-ink-muted">
                  {member.email}
                </p>
                <p className="text-meta text-ink-muted">
                  Email and role can&apos;t be changed here.
                </p>
              </div>
            ) : null}

            <TeamField
              value={department}
              onChange={setDepartment}
              hint="Teams (FOH/BOH) only suggest who to assign. They do not give anyone extra access."
              error={fieldErrors.department}
            />

            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${id}-venue`}>Venue</FieldLabel>
              <OptionSelect
                id={`${id}-venue`}
                options={venues}
                value={venueId}
                onValueChange={setVenueId}
                placeholder="Choose a venue"
                invalid={!!fieldErrors.venueId}
                aria-describedby={`${id}-venue-hint`}
              />
              <FieldDescription id={`${id}-venue-hint`}>
                Affects new uploads only. Old photos keep their venue at upload.
              </FieldDescription>
              {fieldErrors.venueId ? (
                <FieldError>{fieldErrors.venueId}</FieldError>
              ) : null}
            </Field>

            {moving && newVenue ? (
              <Notice
                tone="attention"
                title={`Moving ${member.displayName} to ${newVenue}`}
              >
                <ul className="mt-1 grid list-disc gap-1 pl-5">
                  {grant ? (
                    <li>
                      {first}&apos;s venue manager grant at {grant.venueName}{" "}
                      ends: &quot;Ended: moved to another venue&quot;. It
                      doesn&apos;t move with {first}.
                    </li>
                  ) : null}
                  <li>
                    {first}&apos;s open tasks at {member.venueName} close. Those
                    items show Needs reassignment.
                  </li>
                  <li>
                    {`Past months and accepted photos stay with ${member.venueName}. Photos keep their venue at upload.`}
                  </li>
                  {/* Targets are per person, venue and month, so none exists
                      at the new venue yet. */}
                  <li>
                    {`${first}'s ${UK_MONTH.format(new Date())} target at ${newVenue} starts as Needs setup.`}
                    {venueId && !managedVenueIds?.has(venueId)
                      ? ` ${newVenue} has no venue manager, so an admin sets it.`
                      : null}
                  </li>
                </ul>
              </Notice>
            ) : null}

            <Field
              orientation="horizontal"
              className="justify-between gap-4 rounded-card bg-surface-2 px-4 py-3"
            >
              <div className="grid gap-0.5">
                <FieldLabel htmlFor={`${id}-active`}>Account active</FieldLabel>
                <FieldDescription>
                  Turning this off removes access when you save, like
                  Deactivate, without a confirmation.
                </FieldDescription>
              </div>
              <Switch
                id={`${id}-active`}
                checked={active}
                onCheckedChange={setActive}
              />
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                size="touch"
                onClick={requestClose}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="touch"
                disabled={pending || !displayName.trim()}
                aria-busy={pending}
              >
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmingDiscard}
        onOpenChange={(open) => {
          if (!open) setConfirmingDiscard(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to {first}&apos;s {listWords(changed)} aren&apos;t
              saved yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="secondary" size="touch">
              Keep editing
            </AlertDialogCancel>
            <Button
              variant="danger"
              size="touch"
              onClick={() => {
                setConfirmingDiscard(false)
                onClose()
              }}
            >
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
