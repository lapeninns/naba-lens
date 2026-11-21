"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { Input } from "@/components/ui/input"
import {
  WORK_AREA_OPTIONS,
  WORK_ROLE_OPTIONS,
  WORK_ROLE_TITLE_MAX,
  type WorkArea,
  type WorkRoleKey,
} from "@/lib/config/work-roles"

import { ActionDock } from "./common-room/action-dock"
import { Notice } from "./notice"

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
 * The main jobs as four groups of chips (screens-2 handoff, decision 9): the
 * same options in the same order, a third of the scrolling.
 */
const ROLE_GROUPS: ReadonlyArray<{
  id: string
  label: string
  roles: readonly WorkRoleKey[]
}> = [
  {
    id: "kitchen",
    label: "Kitchen",
    roles: [
      "head_chef",
      "sous_chef",
      "line_chef",
      "curry_chef",
      "tandoor_chef",
      "plating",
      "kitchen_team",
    ],
  },
  { id: "bar", label: "Bar", roles: ["bartender", "bar_team"] },
  {
    id: "front",
    label: "Front of house",
    roles: ["server", "host", "manager", "venue_team"],
  },
  { id: "else", label: "Something else", roles: ["other"] },
]

/**
 * "What do you do at [venue]?": one main job (chips in four groups, Other
 * with a short title) and optional extra areas (chips, any number). Saving the main job completes the work
 * details; Skip for now leaves them empty. A value worked out from the
 * admin-set job title is only a suggestion: nothing is stored until Save.
 */
export function WorkProfileForm({
  venueName,
  initial,
  suggestedFrom = null,
  next,
  onSave,
  onSkip,
}: {
  venueName: string | null
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
  const sessionEnded = useSessionEndedCatch()
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
      roleRef.current?.querySelector("button")?.focus()
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
    } catch (cause) {
      setError(sessionEnded(cause) ?? NETWORK)
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
    } catch (cause) {
      setError(sessionEnded(cause) ?? NETWORK)
    } finally {
      setPending(null)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
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
        <legend className="mb-1 px-1 type-section-title text-ink">
          What do you do at {venue}?
        </legend>
        <p id={`${ids}-role-hint`} className="px-1 text-body text-ink-muted">
          Choose your main job. It sets the question Home asks and which dishes
          come first when you label. It never changes what you can see or do.
        </p>
        {ROLE_GROUPS.map((group) => (
          <div key={group.id} className="grid gap-2 pt-1">
            <h3
              id={`${ids}-group-${group.id}`}
              className="px-1 text-label text-ink-muted"
            >
              {group.label}
            </h3>
            <PillGroup aria-labelledby={`${ids}-group-${group.id}`}>
              {group.roles.map((key) => {
                const option = WORK_ROLE_OPTIONS.find((o) => o.id === key)
                return option ? (
                  <FilterPill
                    key={key}
                    selected={roleKey === key}
                    onClick={() => setRoleKey(key)}
                  >
                    {option.name}
                  </FilterPill>
                ) : null
              })}
            </PillGroup>
          </div>
        ))}
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
        <legend className="mb-1 px-1 type-section-title text-ink">
          Other areas you work in{" "}
          <span className="font-sans text-body font-normal text-ink-muted">
            (optional)
          </span>
        </legend>
        {/* The fieldset's legend names this group. */}
        <PillGroup>
          {WORK_AREA_OPTIONS.map((area) => (
            <FilterPill
              key={area.id}
              selected={areas.has(area.id)}
              onClick={() =>
                setAreas((current) => {
                  const nextAreas = new Set(current)
                  if (nextAreas.has(area.id)) nextAreas.delete(area.id)
                  else nextAreas.add(area.id)
                  return nextAreas
                })
              }
            >
              {area.name}
            </FilterPill>
          ))}
        </PillGroup>
        {fieldErrors.workAreas ? (
          <FieldError>{fieldErrors.workAreas}</FieldError>
        ) : null}
      </fieldset>

      {/* Skip (grey) and Save (the one bottle button) in the dock; grey
          first in the DOM so the primary sits on the right. */}
      <ActionDock>
        <Button
          type="button"
          variant="secondary"
          disabled={pending !== null}
          onClick={skip}
        >
          {pending === "skip" ? "Skipping…" : "Skip for now"}
        </Button>
        <Button variant="primary" type="submit" disabled={pending !== null}>
          {pending === "save" ? "Saving…" : "Save"}
        </Button>
      </ActionDock>
    </form>
  )
}
