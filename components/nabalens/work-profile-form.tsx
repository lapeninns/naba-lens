"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  WORK_AREA_OPTIONS,
  WORK_ROLE_OPTIONS,
  WORK_ROLE_TITLE_MAX,
  isWorkRoleKey,
  type WorkArea,
  type WorkRoleKey,
} from "@/lib/config/work-roles"
import { cn } from "@/lib/utils"

import { Notice } from "./notice"
import { ProfileAvatar } from "./profile-avatar"

export type WorkProfileValues = {
  roleKey: WorkRoleKey | null
  roleTitle: string
  workAreas: WorkArea[]
}

/** What the save and skip Server Functions return (WorkProfileOutcome). */
export type WorkProfileResult =
  | { ok: true }
  | {
      ok: false
      message: string
      fieldErrors?: Partial<
        Record<"roleKey" | "roleTitle" | "workAreas", string>
      >
    }

const NETWORK = "Your work details could not be saved. Check your connection."

/**
 * "What do you do at [venue]?": one main job (radio list, Other with a short
 * title) and optional extra areas. Saving the main job completes the work
 * details; Skip for now leaves them empty. A value worked out from the
 * admin-set job title is only a suggestion: nothing is stored until Save.
 */
export function WorkProfileForm({
  displayName,
  venueName,
  avatarUrl = null,
  initial,
  suggestedFrom = null,
  next,
  onSave,
  onSkip,
}: {
  displayName: string
  venueName: string | null
  avatarUrl?: string | null
  initial: WorkProfileValues
  /** The job title a suggested prefill came from; null when `initial` is saved. */
  suggestedFrom?: string | null
  /** Where to go after Save or Skip (an internal path). */
  next: string
  onSave: (input: {
    roleKey: WorkRoleKey
    roleTitle: string | null
    workAreas: WorkArea[]
  }) => Promise<WorkProfileResult>
  onSkip: () => Promise<WorkProfileResult>
}) {
  const router = useRouter()
  const ids = React.useId()
  const [roleKey, setRoleKey] = React.useState(initial.roleKey)
  const [roleTitle, setRoleTitle] = React.useState(initial.roleTitle)
  const [areas, setAreas] = React.useState(() => new Set(initial.workAreas))
  const [pending, setPending] = React.useState<"save" | "skip" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<"roleKey" | "roleTitle" | "workAreas", string>>
  >({})
  const titleRef = React.useRef<HTMLInputElement>(null)
  const roleRef = React.useRef<HTMLFieldSetElement>(null)
  const venue = venueName ?? "your venue"
  const suggestion =
    suggestedFrom && initial.roleKey
      ? WORK_ROLE_OPTIONS.find((o) => o.id === initial.roleKey)
      : null

  const finish = (result: WorkProfileResult) => {
    if (result.ok) {
      router.push(next)
      return
    }
    setError(result.message)
    setFieldErrors(result.fieldErrors ?? {})
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setError(null)
    const title = roleTitle.trim().replace(/\s+/g, " ")
    if (!roleKey) {
      setFieldErrors({ roleKey: "Choose what you mainly do." })
      roleRef.current?.querySelector("input")?.focus()
      return
    }
    if (roleKey === "other" && !title) {
      setFieldErrors({ roleTitle: "Enter your role." })
      titleRef.current?.focus()
      return
    }
    setFieldErrors({})
    setPending("save")
    try {
      finish(
        await onSave({
          roleKey,
          roleTitle: roleKey === "other" ? title : null,
          workAreas: WORK_AREA_OPTIONS.map((a) => a.id).filter((id) =>
            areas.has(id)
          ),
        })
      )
    } catch {
      setError(NETWORK)
    } finally {
      setPending(null)
    }
  }

  const skip = async () => {
    if (pending) return
    setError(null)
    setPending("skip")
    try {
      finish(await onSkip())
    } catch {
      setError(NETWORK)
    } finally {
      setPending(null)
    }
  }

  const radioClass =
    "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2 text-body-touch has-checked:border-ink has-checked:bg-well has-focus-visible:outline-2 has-focus-visible:outline-focus has-focus-visible:outline-solid md:min-h-9 md:text-body-sm"

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <div className="flex items-center gap-3">
        <ProfileAvatar
          name={displayName}
          src={avatarUrl}
          className="size-12 text-base"
        />
        <p className="grid min-w-0">
          <span className="text-body-touch font-semibold break-words text-ink md:text-body">
            {displayName}
          </span>
          <span className="text-meta-touch text-ink-muted md:text-meta">
            {venueName ?? "No venue assigned"}
          </span>
        </p>
      </div>

      {suggestion ? (
        <Notice tone="plain" title="Check this suggestion">
          We picked {suggestion.name} from your job title ({suggestedFrom}).
          Change it if it&apos;s wrong, then choose Save.
        </Notice>
      ) : suggestedFrom ? (
        <Notice tone="plain" title="Check this suggestion">
          We filled in your job title as Other. Change it if it&apos;s wrong,
          then choose Save.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      ) : null}

      <fieldset
        ref={roleRef}
        className="grid gap-2"
        aria-describedby={`${ids}-role-hint${fieldErrors.roleKey ? ` ${ids}-role-error` : ""}`}
        aria-invalid={!!fieldErrors.roleKey || undefined}
      >
        <legend className="mb-1 text-label-touch font-semibold md:text-label">
          What do you do at {venue}?
        </legend>
        <p
          id={`${ids}-role-hint`}
          className="text-meta-touch text-ink-muted md:text-meta"
        >
          Choose your main job. It sets the question Home asks and which dishes
          come first when you label. It never changes what you can see or do.
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {WORK_ROLE_OPTIONS.map((option) => (
            <label key={option.id} className={radioClass}>
              <input
                type="radio"
                name={`${ids}-role`}
                value={option.id}
                checked={roleKey === option.id}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (isWorkRoleKey(value)) setRoleKey(value)
                }}
                className="size-4 shrink-0 accent-ink"
              />
              {option.name}
            </label>
          ))}
        </div>
        {fieldErrors.roleKey ? (
          <FieldError id={`${ids}-role-error`}>
            {fieldErrors.roleKey}
          </FieldError>
        ) : null}
      </fieldset>

      {roleKey === "other" ? (
        <div className="grid gap-1.5">
          <label
            htmlFor={`${ids}-title`}
            className="text-label-touch font-semibold md:text-label"
          >
            Your role
          </label>
          <Input
            ref={titleRef}
            id={`${ids}-title`}
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.currentTarget.value)}
            maxLength={WORK_ROLE_TITLE_MAX}
            autoComplete="organization-title"
            aria-describedby={`${ids}-title-hint${fieldErrors.roleTitle ? ` ${ids}-title-error` : ""}`}
            aria-invalid={!!fieldErrors.roleTitle || undefined}
            className="h-11 sm:h-9"
          />
          <p
            id={`${ids}-title-hint`}
            className="text-meta-touch text-ink-muted md:text-meta"
          >
            A short title, up to {WORK_ROLE_TITLE_MAX} characters.
          </p>
          {fieldErrors.roleTitle ? (
            <FieldError id={`${ids}-title-error`}>
              {fieldErrors.roleTitle}
            </FieldError>
          ) : null}
        </div>
      ) : null}

      <fieldset
        className="grid gap-2"
        aria-invalid={!!fieldErrors.workAreas || undefined}
      >
        <legend className="mb-1 text-label-touch font-semibold md:text-label">
          Other areas you work in{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {WORK_AREA_OPTIONS.map((area) => (
            <label key={area.id} className={radioClass}>
              <input
                type="checkbox"
                value={area.id}
                checked={areas.has(area.id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  setAreas((current) => {
                    const nextAreas = new Set(current)
                    if (checked) nextAreas.add(area.id)
                    else nextAreas.delete(area.id)
                    return nextAreas
                  })
                }}
                className="size-4 shrink-0 accent-ink"
              />
              {area.name}
            </label>
          ))}
        </div>
        {fieldErrors.workAreas ? (
          <FieldError>{fieldErrors.workAreas}</FieldError>
        ) : null}
      </fieldset>

      <div
        className={cn(
          "flex flex-col gap-2 sm:flex-row-reverse sm:justify-start",
          "[&>*]:w-full sm:[&>*]:w-auto"
        )}
      >
        <Button type="submit" size="touch" disabled={pending !== null}>
          {pending === "save" ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="quiet"
          size="touch"
          disabled={pending !== null}
          onClick={skip}
        >
          {pending === "skip" ? "Skipping…" : "Skip for now"}
        </Button>
      </div>
    </form>
  )
}
