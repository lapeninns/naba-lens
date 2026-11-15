"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PencilSimpleIcon } from "@phosphor-icons/react"

import { Card, SectionHeader } from "@/components/nabalens/common-room"
import {
  failureText,
  needsRefresh,
  plural,
  TARGET_SOURCE_LABEL,
} from "@/components/nabalens/coverage/copy"
import { Frames } from "@/components/nabalens/coverage/layout"
import { ReasonField } from "@/components/nabalens/coverage/reason-dialog"
import {
  rosterOrder,
  targetReasonRequired,
} from "@/components/nabalens/coverage/roster"
import { Stepper, TeamPerson } from "@/components/nabalens/coverage/team-roster"
import { NETWORK_ERROR } from "@/components/nabalens/coverage/use-coverage-action"
import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import type {
  CoverageResult,
  MonthlyProgress,
} from "@/lib/server/coverage/types"
import type { VenueTargetsView } from "@/lib/server/coverage/targets"

import { MANAGER_COPY } from "../copy"

const copy = MANAGER_COPY.team

type DefaultInput = {
  targetCount: number | null
  reason?: string
  expectedRevision: number | null
}
type PersonInput = {
  staffId: string
  targetCount: number
  reason?: string
  expectedRevision: number | null
}

type Feedback = { tone: "positive" | "negative"; text: string } | null

function countError(value: string): string | null {
  const n = Number(value)
  return value === "" || !Number.isInteger(n) || n < 1 || n > 500
    ? "Enter a whole number from 1 to 500."
    : null
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="text-meta font-bold text-warn-fg">
      {children}
    </p>
  )
}

/** Runs a save; a thrown call (offline, session ended) becomes text. */
function useSave() {
  const sessionEnded = useSessionEndedCatch()
  return React.useCallback(
    async <T,>(
      call: () => Promise<CoverageResult<T>>
    ): Promise<CoverageResult<T> | { ok: false; thrown: string }> => {
      try {
        return await call()
      } catch (error) {
        return { ok: false, thrown: sessionEnded(error) ?? NETWORK_ERROR }
      }
    },
    [sessionEnded]
  )
}

/**
 * The /manager team screen (G-6): the venue default photo target, then each
 * person's number this month. People are listed Needs setup first, then by
 * surname, never by progress (no rankings, v0.4). Changing a number someone
 * already has asks for a reason (DESIGN.md §5 Reasons).
 */
export function TeamTargets({
  view,
  onSetDefault,
  onSetPerson,
}: {
  view: VenueTargetsView
  onSetDefault: (
    input: DefaultInput
  ) => Promise<CoverageResult<{ targetCount: number | null }>>
  onSetPerson: (input: PersonInput) => Promise<CoverageResult<object>>
}) {
  const people = [...view.people].sort(rosterOrder)
  // The default's outcome outlives the card, which a fresh read remounts.
  const [feedback, setFeedback] = React.useState<Feedback>(null)
  return (
    <>
      {view.wholeVenue ? <Notice tone="info">{copy.wholeVenue}</Notice> : null}
      <DefaultCard
        key={view.venueDefault.revision ?? "none"}
        view={view}
        onSetDefault={onSetDefault}
        feedback={feedback}
        setFeedback={setFeedback}
      />
      <section aria-labelledby="team-people" className="grid gap-gutter">
        <SectionHeader id="team-people" title={copy.peopleTitle} />
        <p className="px-1 text-body text-ink-muted">{copy.privacy}</p>
        {people.length === 0 ? (
          <Card>
            <p className="text-body text-ink-muted">{copy.peopleEmpty}</p>
          </Card>
        ) : (
          <Card className="py-1">
            <ul className="grid divide-y divide-line">
              {people.map((row) => (
                <PersonRow
                  key={row.person.id}
                  row={row}
                  locked={view.wholeVenue}
                  onSetPerson={onSetPerson}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  )
}

function DefaultCard({
  view,
  onSetDefault,
  feedback,
  setFeedback,
}: {
  view: VenueTargetsView
  feedback: Feedback
  setFeedback: (feedback: Feedback) => void
  onSetDefault: (
    input: DefaultInput
  ) => Promise<CoverageResult<{ targetCount: number | null }>>
}) {
  const router = useRouter()
  const save = useSave()
  const current = view.venueDefault.targetCount
  const [value, setValue] = React.useState(
    current == null ? "" : String(current)
  )
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<{
    count?: string
    reason?: string
  }>({})
  const [saving, setSaving] = React.useState(false)

  const changed = value !== (current == null ? "" : String(current))
  const reasonNeeded = current != null

  async function submit(targetCount: number | null) {
    const found: typeof errors = {}
    if (targetCount !== null) {
      const error = countError(value)
      if (error) found.count = error
    }
    if (reasonNeeded && !reason.trim()) found.reason = "Enter a reason."
    setErrors(found)
    setFeedback(null)
    if (found.count || found.reason) return
    setSaving(true)
    const result = await save(() =>
      onSetDefault({
        targetCount,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        expectedRevision: view.venueDefault.revision,
      })
    )
    setSaving(false)
    if (result.ok) {
      setFeedback({
        tone: "positive",
        text: targetCount === null ? copy.defaultCleared : copy.defaultSaved,
      })
      router.refresh()
      return
    }
    if ("thrown" in result) {
      setFeedback({ tone: "negative", text: result.thrown })
      return
    }
    if (result.fieldErrors) {
      setErrors({
        count: result.fieldErrors.targetCount,
        reason: result.fieldErrors.reason,
      })
    }
    setFeedback({ tone: "negative", text: failureText(result) })
    if (needsRefresh(result)) router.refresh()
  }

  return (
    <section aria-labelledby="team-default" className="grid gap-gutter">
      <SectionHeader id="team-default" title={copy.defaultTitle} />
      <Card>
        <p className="text-body text-ink">{copy.defaultBody}</p>
        <p className="text-meta text-ink-muted">
          {current == null ? copy.defaultUnset : copy.defaultSet(current)}
        </p>
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit(Number(value))
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor="team-default-count" className="text-label text-ink">
              {copy.defaultName}
            </label>
            <Stepper
              id="team-default-count"
              name={copy.defaultName}
              value={value}
              onChange={setValue}
              changed={changed}
              invalid={!!errors.count}
              disabled={saving || view.wholeVenue}
              describedBy={
                errors.count ? "team-default-count-error" : undefined
              }
            />
            {errors.count ? (
              <FieldError id="team-default-count-error">
                {errors.count}
              </FieldError>
            ) : null}
          </div>
          {reasonNeeded ? (
            <ReasonField
              id="team-default-reason"
              label={copy.reasonLabel}
              value={reason}
              onChange={setReason}
              error={errors.reason}
              help={copy.reasonHelp}
              disabled={saving}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {current != null ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || view.wholeVenue}
                onClick={() => void submit(null)}
              >
                {copy.clearDefault}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !changed || view.wholeVenue}
            >
              {saving ? copy.saving : copy.saveDefault}
            </Button>
          </div>
        </form>
        {feedback ? (
          <Notice
            tone={feedback.tone}
            role={feedback.tone === "negative" ? "alert" : "status"}
          >
            {feedback.text}
          </Notice>
        ) : null}
      </Card>
    </section>
  )
}

function sourceLine(row: MonthlyProgress): string {
  if (row.targetCount == null) return copy.noTarget
  const target = plural(row.targetCount, "photo")
  const source =
    row.source === "venue_default"
      ? copy.usesDefault
      : row.source
        ? (TARGET_SOURCE_LABEL[row.source] ?? copy.ownNumber)
        : copy.ownNumber
  return `${target} · ${source}`
}

function PersonRow({
  row,
  locked,
  onSetPerson,
}: {
  row: MonthlyProgress
  locked: boolean
  onSetPerson: (input: PersonInput) => Promise<CoverageResult<object>>
}) {
  const router = useRouter()
  const save = useSave()
  const name = row.person.displayName
  const ids = `team-person-${row.person.id}`
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<{
    count?: string
    reason?: string
  }>({})
  const [feedback, setFeedback] = React.useState<Feedback>(null)
  const [saving, setSaving] = React.useState(false)
  const reasonNeeded = targetReasonRequired(row, "current")
  const completion = !!row.completionProgress

  function start() {
    setValue(row.targetCount == null ? "" : String(row.targetCount))
    setReason("")
    setErrors({})
    setFeedback(null)
    setEditing(true)
  }

  async function submit() {
    const found: typeof errors = {}
    const error = countError(value)
    if (error) found.count = error
    if (reasonNeeded && !reason.trim()) found.reason = "Enter a reason."
    setErrors(found)
    if (found.count || found.reason) return
    setSaving(true)
    const result = await save(() =>
      onSetPerson({
        staffId: row.person.id,
        targetCount: Number(value),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        expectedRevision: row.revision,
      })
    )
    setSaving(false)
    if (result.ok) {
      setEditing(false)
      setFeedback({ tone: "positive", text: copy.personSaved(name) })
      router.refresh()
      return
    }
    if ("thrown" in result) {
      setFeedback({ tone: "negative", text: result.thrown })
      return
    }
    if (result.fieldErrors) {
      setErrors({
        count: result.fieldErrors.targetCount,
        reason: result.fieldErrors.reason,
      })
    }
    setFeedback({ tone: "negative", text: failureText(result) })
    if (needsRefresh(result)) router.refresh()
  }

  const chip =
    row.status === "needs_setup" ? (
      <StatusChip state="needs_setup" />
    ) : row.complete ? (
      <StatusChip state="target_met" />
    ) : null

  return (
    <li className="grid gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TeamPerson
          person={row.person}
          meta={completion ? null : sourceLine(row)}
        />
        {!locked && !editing ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={copy.change(name)}
            onClick={start}
          >
            <PencilSimpleIcon aria-hidden />
            {copy.changeShort}
          </Button>
        ) : null}
      </div>
      {row.targetCount != null ? (
        <Frames
          compact
          accepted={row.completionProgress?.total ?? row.accepted}
          target={row.targetCount}
          pending={completion ? 0 : row.pending}
          verb={completion ? "completed" : "accepted"}
          chip={chip}
        />
      ) : (
        <p>{chip}</p>
      )}
      {editing ? (
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-count`} className="text-label text-ink">
              {copy.personName(name)}
            </label>
            <Stepper
              id={`${ids}-count`}
              name={copy.personName(name)}
              value={value}
              onChange={setValue}
              changed={value !== String(row.targetCount ?? "")}
              invalid={!!errors.count}
              disabled={saving}
              describedBy={errors.count ? `${ids}-count-error` : undefined}
            />
            {errors.count ? (
              <FieldError id={`${ids}-count-error`}>{errors.count}</FieldError>
            ) : null}
          </div>
          {reasonNeeded ? (
            <ReasonField
              id={`${ids}-reason`}
              label={copy.reasonLabel}
              value={reason}
              onChange={setReason}
              error={errors.reason}
              help={copy.reasonHelp}
              disabled={saving}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="quiet"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              {copy.cancel}
            </Button>
            <Button type="submit" variant="secondary" disabled={saving}>
              {saving ? copy.saving : copy.savePerson}
            </Button>
          </div>
        </form>
      ) : null}
      {feedback ? (
        <Notice
          tone={feedback.tone}
          role={feedback.tone === "negative" ? "alert" : "status"}
        >
          {feedback.text}
        </Notice>
      ) : null}
    </li>
  )
}
