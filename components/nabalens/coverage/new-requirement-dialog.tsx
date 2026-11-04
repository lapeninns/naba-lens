"use client"

import * as React from "react"
import { PlusIcon } from "@phosphor-icons/react"

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

import { COVERAGE_LIMITS, failureText } from "./copy"
import { textareaClass } from "./reason-dialog"
import type { CoverageResult, CreateRequirementInput } from "./types"
import { useRequestIds } from "./use-request-id"

export type CreateRequirementHandler = (
  input: Omit<CreateRequirementInput, "venueId">
) => Promise<CoverageResult<{ requirementId: string; replayed: boolean }>>

const KINDS: {
  value: CreateRequirementInput["kind"]
  label: string
  help: string
}[] = [
  {
    value: "venue_specific",
    label: "Venue-specific",
    help: "Something only this venue has, such as a function room or a view.",
  },
  {
    value: "service",
    label: "Venue or service area",
    help: "Another part of the venue or service, such as a terrace bar.",
  },
]

/**
 * Adds a manager-defined checklist item. Creating it confirms it applies, so
 * it counts toward venue coverage straight away.
 */
export function NewRequirementDialog({
  onCreate,
  onCreated,
  triggerLabel = "Add a checklist item",
}: {
  onCreate: CreateRequirementHandler
  triggerLabel?: string
  /** Called with the new item's id (e.g. to open it and assign people). */
  onCreated: (requirementId: string) => void
}) {
  const ids = React.useId()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] =
    React.useState<CreateRequirementInput["kind"]>("venue_specific")
  const [title, setTitle] = React.useState("")
  const [guidance, setGuidance] = React.useState("")
  const [target, setTarget] = React.useState("1")
  const [dueOn, setDueOn] = React.useState("")
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  // One id per create intent (same details), kept across retries and reloads:
  // a retry after a lost response returns the item already created (replayed)
  // instead of adding a second one. Changed details make a new intent.
  const intents = useRequestIds()

  function reset() {
    setKind("venue_specific")
    setTitle("")
    setGuidance("")
    setTarget("1")
    setDueOn("")
    setErrors({})
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    const name = title.trim()
    if (!name || name.length > COVERAGE_LIMITS.titleMax)
      found.title = `Enter a title of up to ${COVERAGE_LIMITS.titleMax} characters.`
    if (guidance.trim().length > COVERAGE_LIMITS.guidanceMax)
      found.guidance = `Use up to ${COVERAGE_LIMITS.guidanceMax} characters.`
    const n = Number(target)
    if (!Number.isInteger(n) || n < 1 || n > COVERAGE_LIMITS.photoTargetMax)
      found.photoTarget = `Enter a whole number from 1 to ${COVERAGE_LIMITS.photoTargetMax}.`
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const input = {
      kind,
      title: name,
      guidance: guidance.trim() || null,
      photoTarget: n,
      dueOn: dueOn || null,
    }
    const requestId = intents.requestIdFor("create", input)
    setPending(true)
    setError(null)
    try {
      const result = await onCreate({ ...input, requestId })
      if (!result.ok) {
        // Only an outage may be retried with the same id; any other answer is
        // final for this id, so the next attempt mints a new one.
        if (result.code !== "unavailable") intents.settle("create")
        const keyRejected =
          result.code === "state_conflict" ||
          (result.code === "invalid_input" && !!result.fieldErrors?.requestId)
        setError(
          keyRejected
            ? "This request changed since it was first sent. Check the details and add the item again."
            : failureText(result)
        )
        const fields = { ...result.fieldErrors }
        delete fields.requestId
        setErrors(fields)
        return
      }
      intents.settle("create")
      setOpen(false)
      reset()
      onCreated(result.requirementId)
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button size="touch" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" aria-hidden />
        {triggerLabel}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          if (!next) reset()
          setOpen(next)
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Add a checklist item</DialogTitle>
              <DialogDescription>
                It applies from now on and counts toward venue coverage. You can
                assign people after adding it.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="grid gap-1" disabled={pending}>
              <legend className="mb-1 text-sm font-medium">Type</legend>
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 sm:min-h-9"
                >
                  <input
                    type="radio"
                    name={`${ids}-kind`}
                    value={option.value}
                    checked={kind === option.value}
                    onChange={() => setKind(option.value)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="grid">
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {option.help}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${ids}-title`}>Title</FieldLabel>
              <Input
                id={`${ids}-title`}
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                maxLength={COVERAGE_LIMITS.titleMax}
                required
                aria-invalid={!!errors.title || undefined}
                className="h-11 sm:h-9"
                disabled={pending}
              />
              {errors.title ? <FieldError>{errors.title}</FieldError> : null}
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${ids}-guidance`}>
                Guidance for staff (optional)
              </FieldLabel>
              <textarea
                id={`${ids}-guidance`}
                value={guidance}
                onChange={(e) => setGuidance(e.currentTarget.value)}
                maxLength={COVERAGE_LIMITS.guidanceMax}
                rows={3}
                aria-invalid={!!errors.guidance || undefined}
                className={textareaClass}
                disabled={pending}
              />
              {errors.guidance ? (
                <FieldError>{errors.guidance}</FieldError>
              ) : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${ids}-target`}>Photo target</FieldLabel>
                <Input
                  id={`${ids}-target`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={COVERAGE_LIMITS.photoTargetMax}
                  step={1}
                  value={target}
                  onChange={(e) => setTarget(e.currentTarget.value)}
                  aria-invalid={!!errors.photoTarget || undefined}
                  className="h-11 sm:h-9"
                  disabled={pending}
                />
                {errors.photoTarget ? (
                  <FieldError>{errors.photoTarget}</FieldError>
                ) : null}
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${ids}-due`}>
                  Due date (optional)
                </FieldLabel>
                <Input
                  id={`${ids}-due`}
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.currentTarget.value)}
                  aria-invalid={!!errors.dueOn || undefined}
                  aria-describedby={`${ids}-due-help`}
                  className="h-11 sm:h-9"
                  disabled={pending}
                />
                <FieldDescription id={`${ids}-due-help`}>
                  UK date.
                </FieldDescription>
                {errors.dueOn ? <FieldError>{errors.dueOn}</FieldError> : null}
              </Field>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="touch"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="touch"
                disabled={pending}
                aria-busy={pending || undefined}
              >
                {pending ? "Adding…" : "Add item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
