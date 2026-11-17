"use client"

import * as React from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { BRIEF_MAX } from "@/lib/album/model"

/*
 * Album AL-4 (DESIGN.md §5 Brief, §2 principle 4): a manager writes the one
 * line that says what a slot's photo must show. Staff read it on the slot,
 * in Match and in Review; the reviewer judges against the same words. Used
 * for a menu section on /manager/album and for one dish on the manager's
 * menu item page. Saved with its own button (a typed line is not saved on
 * every key); the result is written beside the field (§6.7), and a failure
 * keeps what was typed.
 */

export const SLOT_BRIEF_COPY = {
  label: "Brief",
  labelFor: (name: string) => `Brief for ${name}`,
  hint: `One line on what the photo must show, up to ${BRIEF_MAX} characters. Staff read it before they add the photo, and the reviewer checks against it.`,
  save: "Save brief",
  saving: "Saving…",
  clear: "Clear brief",
  clearing: "Clearing…",
  tooLong: `Keep the brief to ${BRIEF_MAX} characters or fewer.`,
  saved: (name: string) => `Saved: the brief for ${name}.`,
  cleared: (name: string) => `Cleared the brief for ${name}.`,
  network:
    "Not saved: the connection dropped. Check your signal and try again.",
  count: (n: number) => `${n} of ${BRIEF_MAX} characters`,
} as const

export type SlotBriefSaver = (
  brief: string | null
) => Promise<
  { ok: true; brief: string | null } | { ok: false; message: string }
>

type Status =
  | { kind: "idle" }
  | { kind: "saved"; cleared: boolean }
  | { kind: "failed"; message: string }

export function SlotBriefField({
  name,
  brief,
  label,
  hint,
  onSave,
}: {
  /** What the slot or section is called, for the saved line: "Desserts". */
  name: string
  /** The saved brief, if there is one. */
  brief: string | null
  /** The field's label; "Brief" unless several share a page. */
  label?: string
  /** Replaces the standard hint, for example to say a section's brief is the fallback. */
  hint?: string
  onSave: SlotBriefSaver
}) {
  const [saved, setSaved] = React.useState(brief)
  const [value, setValue] = React.useState(brief ?? "")
  const [busy, setBusy] = React.useState<"save" | "clear" | null>(null)
  const [status, setStatus] = React.useState<Status>({ kind: "idle" })
  const statusId = React.useId()

  const trimmed = value.trim()
  const tooLong = trimmed.length > BRIEF_MAX
  const unchanged = (trimmed || null) === saved

  async function run(next: string | null, which: "save" | "clear") {
    if (busy) return
    setBusy(which)
    setStatus({ kind: "idle" })
    try {
      const result = await onSave(next)
      if (result.ok) {
        setSaved(result.brief)
        setValue(result.brief ?? "")
        setStatus({ kind: "saved", cleared: result.brief === null })
      } else {
        setStatus({ kind: "failed", message: result.message })
      }
    } catch {
      setStatus({ kind: "failed", message: SLOT_BRIEF_COPY.network })
    } finally {
      setBusy(null)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (tooLong || unchanged) return
    void run(trimmed || null, "save")
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <FormField
        label={label ?? SLOT_BRIEF_COPY.label}
        optional
        description={hint ?? SLOT_BRIEF_COPY.hint}
        error={tooLong ? SLOT_BRIEF_COPY.tooLong : undefined}
      >
        <Input
          type="text"
          value={value}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </FormField>
      <p
        className={
          tooLong ? "text-meta text-warn-fg" : "text-meta text-ink-muted"
        }
      >
        {SLOT_BRIEF_COPY.count(trimmed.length)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="secondary"
          loading={busy === "save"}
          loadingLabel={SLOT_BRIEF_COPY.saving}
          disabled={(busy !== null && busy !== "save") || tooLong || unchanged}
          aria-describedby={statusId}
        >
          {SLOT_BRIEF_COPY.save}
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="quiet"
            loading={busy === "clear"}
            loadingLabel={SLOT_BRIEF_COPY.clearing}
            disabled={busy !== null && busy !== "clear"}
            onClick={() => void run(null, "clear")}
          >
            {SLOT_BRIEF_COPY.clear}
          </Button>
        ) : null}
      </div>
      <div id={statusId} role="status" aria-live="polite">
        {status.kind === "saved" ? (
          <p className="text-meta text-ink-muted">
            {status.cleared
              ? SLOT_BRIEF_COPY.cleared(name)
              : SLOT_BRIEF_COPY.saved(name)}
          </p>
        ) : status.kind === "failed" ? (
          <Notice tone="negative" role="none">
            {status.message}
          </Notice>
        ) : null}
      </div>
    </form>
  )
}
