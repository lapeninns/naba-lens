"use client"

import * as React from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

import { formatBytes } from "./format"
import { OptionSelect } from "./option-select"
import { ProfileAvatar } from "./profile-avatar"
import type { ActionResult, Option } from "./types"
import { useObjectUrl } from "./use-upload-queue"

export type ProfileFormValues = {
  displayName: string
  /** New photo chosen in this dialog, or null to keep the current one. */
  avatarFile: File | null
  /** Admin only. */
  jobTitle?: string
  venueId?: string | null
  active?: boolean
}

type EditProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Staff edit name and photo only. Admin also edit job title, venue and access. */
  variant: "staff" | "admin"
  initial: {
    displayName: string
    avatarUrl: string | null
    jobTitle?: string | null
    venueId?: string | null
    active?: boolean
  }
  /** Admin variant: active venues that can take new assignments. */
  venues?: Option[]
  /** Pass MEDIA_LIMITS.maxAvatarBytes. */
  maxAvatarBytes: number
  onSubmit: (values: ProfileFormValues) => Promise<ActionResult> | ActionResult
}

const AVATAR_TYPES =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"

export function EditProfileDialog(props: EditProfileDialogProps) {
  const { open, onOpenChange } = props
  const [pending, setPending] = React.useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-w-md">
        {/* Mounted only while open, so every opening starts from `initial`. */}
        <EditProfileForm {...props} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  )
}

function EditProfileForm({
  onOpenChange,
  variant,
  initial,
  venues = [],
  maxAvatarBytes,
  onSubmit,
  pending,
  setPending,
}: EditProfileDialogProps & {
  pending: boolean
  setPending: (pending: boolean) => void
}) {
  const isAdmin = variant === "admin"
  const [displayName, setDisplayName] = React.useState(initial.displayName)
  const [jobTitle, setJobTitle] = React.useState(initial.jobTitle ?? "")
  const [venueId, setVenueId] = React.useState(initial.venueId ?? null)
  const [active, setActive] = React.useState(initial.active ?? true)
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [avatarError, setAvatarError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ActionResult | null>(null)
  const avatarPreview = useObjectUrl(avatarFile)
  const ids = {
    name: React.useId(),
    photo: React.useId(),
    photoHelp: React.useId(),
    job: React.useId(),
    venue: React.useId(),
    active: React.useId(),
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
    if (avatarError) return
    setPending(true)
    setResult(null)
    try {
      const values: ProfileFormValues = {
        displayName: displayName.trim(),
        avatarFile,
      }
      if (isAdmin)
        Object.assign(values, { jobTitle: jobTitle.trim(), venueId, active })
      const outcome = await onSubmit(values)
      setResult(outcome)
      if (outcome.ok) onOpenChange(false)
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
    <form
      onSubmit={submit}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5"
      noValidate
    >
      <DialogHeader>
        <DialogTitle>
          {isAdmin ? "Edit staff account" : "Edit profile"}
        </DialogTitle>
        <DialogDescription>
          {isAdmin
            ? "Changes to venue apply to new uploads only. Existing media keeps its original venue."
            : "Your name and photo appear on your portfolio."}
        </DialogDescription>
      </DialogHeader>

      {result && !result.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-4">
        <ProfileAvatar
          name={displayName || initial.displayName}
          src={avatarPreview ?? initial.avatarUrl}
          className="size-16 text-lg"
        />
        <Field className="min-w-0 flex-1 gap-1.5">
          <FieldLabel htmlFor={ids.photo}>Profile photo</FieldLabel>
          <Input
            id={ids.photo}
            type="file"
            accept={AVATAR_TYPES}
            onChange={pickAvatar}
            aria-describedby={ids.photoHelp}
            aria-invalid={!!avatarError || !!fieldErrors.avatar || undefined}
            className="h-11 sm:h-9"
          />
          <FieldDescription id={ids.photoHelp}>
            JPEG, PNG, WebP or HEIC, up to {formatBytes(maxAvatarBytes)}.
          </FieldDescription>
          {avatarError || fieldErrors.avatar ? (
            <FieldError>{avatarError ?? fieldErrors.avatar}</FieldError>
          ) : null}
        </Field>
      </div>

      <Field className="gap-1.5">
        <FieldLabel htmlFor={ids.name}>Display name</FieldLabel>
        <Input
          id={ids.name}
          value={displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
          required
          maxLength={80}
          autoComplete="name"
          aria-invalid={!!fieldErrors.displayName || undefined}
          className="h-11 sm:h-9"
        />
        {fieldErrors.displayName ? (
          <FieldError>{fieldErrors.displayName}</FieldError>
        ) : null}
      </Field>

      {isAdmin ? (
        <>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={ids.job}>Job title</FieldLabel>
            <Input
              id={ids.job}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.currentTarget.value)}
              maxLength={80}
              aria-invalid={!!fieldErrors.jobTitle || undefined}
              className="h-11 sm:h-9"
            />
            {fieldErrors.jobTitle ? (
              <FieldError>{fieldErrors.jobTitle}</FieldError>
            ) : null}
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={ids.venue}>Venue</FieldLabel>
            <OptionSelect
              id={ids.venue}
              options={venues}
              value={venueId}
              onValueChange={setVenueId}
              placeholder="Choose a venue"
              invalid={!!fieldErrors.venueId}
            />
            {fieldErrors.venueId ? (
              <FieldError>{fieldErrors.venueId}</FieldError>
            ) : null}
          </Field>
          <Field
            orientation="horizontal"
            className="justify-between gap-4 rounded-lg border px-3 py-3"
          >
            <div className="grid gap-0.5">
              <FieldLabel htmlFor={ids.active}>Account active</FieldLabel>
              <FieldDescription>
                Inactive accounts cannot sign in or upload. Their media stays in
                the library.
              </FieldDescription>
            </div>
            <Switch
              id={ids.active}
              checked={active}
              onCheckedChange={setActive}
            />
          </Field>
        </>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => onOpenChange(false)}
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
  )
}
