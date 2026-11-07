"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MapPinIcon } from "@phosphor-icons/react"

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

  // Common Room choice rows: one white card, hairlines between rows, a 64px
  // row per choice with a large radio or box; the chosen row is accent-soft.
  const listClass =
    "grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
  const rowClass =
    "flex min-h-16 cursor-pointer items-center gap-3 px-4 py-2 text-item-title text-ink transition-colors duration-(--duration-quick) hover:bg-surface-2 has-checked:bg-accent-soft has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-focus has-focus-visible:outline-solid"
  const areaRowClass =
    "flex min-h-13 cursor-pointer items-center gap-3 px-4 py-2 text-body text-ink transition-colors duration-(--duration-quick) hover:bg-surface-2 has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-focus has-focus-visible:outline-solid"
  const markClass = "size-6 shrink-0 accent-select"

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface p-3 shadow-card">
        <ProfileAvatar name={displayName} src={avatarUrl} />
        <p className="grid min-w-0">
          <span className="text-item-title [overflow-wrap:anywhere] text-ink">
            {displayName}
          </span>
          <span className="flex items-center gap-1.5 text-body text-ink-muted">
            <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
            <span className="[overflow-wrap:anywhere]">
              {venueName ?? "No venue assigned"}
            </span>
          </span>
        </p>
      </div>

      {suggestion ? (
        <Notice tone="info" role="note" title="Check this suggestion">
          We picked {suggestion.name} from your job title ({suggestedFrom}).
          Change it if it&apos;s wrong, then choose Save.
        </Notice>
      ) : suggestedFrom ? (
        <Notice tone="info" role="note" title="Check this suggestion">
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
        <legend className="mb-1 px-1 font-display text-section-title text-ink">
          What do you do at {venue}?
        </legend>
        <p id={`${ids}-role-hint`} className="px-1 text-body text-ink-muted">
          Choose your main job. It sets the question Home asks and which dishes
          come first when you label. It never changes what you can see or do.
        </p>
        <div className={listClass}>
          {WORK_ROLE_OPTIONS.map((option) => (
            <label key={option.id} className={rowClass}>
              <input
                type="radio"
                name={`${ids}-role`}
                value={option.id}
                checked={roleKey === option.id}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (isWorkRoleKey(value)) setRoleKey(value)
                }}
                className={markClass}
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
          <label htmlFor={`${ids}-title`} className="px-1 text-label text-ink">
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
          />
          <p id={`${ids}-title-hint`} className="px-1 text-meta text-ink-muted">
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
        <legend className="mb-1 px-1 font-display text-section-title text-ink">
          Other areas you work in{" "}
          <span className="font-sans text-body font-normal text-ink-muted">
            (optional)
          </span>
        </legend>
        <div className={listClass}>
          {WORK_AREA_OPTIONS.map((area) => (
            <label key={area.id} className={areaRowClass}>
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
                className={markClass}
              />
              {area.name}
            </label>
          ))}
        </div>
        {fieldErrors.workAreas ? (
          <FieldError>{fieldErrors.workAreas}</FieldError>
        ) : null}
      </fieldset>

      {/* Skip (grey) and Save (the one blue), the same width; grey first in
          the DOM so blue sits on the right, or below when stacked. */}
      <div className="grid grid-cols-2 gap-2 rounded-card bg-surface p-3 shadow-card max-[359px]:grid-cols-1 md:p-4">
        <Button
          type="button"
          variant="secondary"
          size="touch"
          disabled={pending !== null}
          onClick={skip}
        >
          {pending === "skip" ? "Skipping…" : "Skip for now"}
        </Button>
        <Button type="submit" size="touch" disabled={pending !== null}>
          {pending === "save" ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}
