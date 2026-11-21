"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { chipState, StatusChip } from "@/components/nabalens/status-chip"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LinkButton } from "@/components/ui/link-button"
import { OptionRow } from "@/components/ui/option-row"
import {
  CAPTURE_WINDOW_MAX,
  checkRequestDraft,
  defaultTypeForSlot,
  INTENDED_USES,
  ORIENTATIONS,
  PHOTO_COUNT_MAX,
  PRIORITIES,
  REQUEST_BRIEF_MAX,
  REQUEST_WORDS,
  SUBJECT_MAX,
  TEAMS,
  type DraftErrors,
  type IntendedUse,
  type Orientation,
  type Priority,
  type RequestDraft,
  type RequestPerson,
  type RequestSlotKind,
  type RequestType,
  type ShotListView,
  type Team,
} from "@/lib/requests/model"

import { requestHrefs } from "./hrefs"

/*
 * New request (spec §7 M4). Three starts, one form:
 *   slot  from an existing requirement: choose the slot; its name is the
 *         subject and its category sets the team
 *   new   a New brief for a subject with no slot yet
 *   fact  a fact confirmation, for a manager or admin
 * Required: subject, a one-line brief (as Album's), intended use. Defaults:
 * this venue, the slot's team, one photo, normal priority. The rest is
 * optional and folded under "More detail". The database checks all of it
 * again.
 */

export type SlotOption = {
  kind: RequestSlotKind
  slotId: string
  name: string
  categoryLabel: string
  state: string
  /** The slot's current album photo, offered as the example (M4 reference image). */
  primaryAssetId?: string | null
  /**
   * The slot's standing brief (FA-52, public.slot_briefs without requests):
   * the manager's, the catalogue's or the category's shot template. It
   * prefills Brief; the manager may change it.
   */
  brief?: string | null
}

export type FactOption = {
  checkId: string
  question: string
  stateLabel: string | null
}

type CreateAction = (
  input: unknown
) => Promise<
  { ok: true; id: string } | { ok: false; error: string; field?: string }
>

/** A slot's coverage word: the coverage_* chip, as on Metrics (X11). */
const slotStateWord = (state: string) => chipState(`coverage_${state}`).word

const slotKey = (kind: string, id: string) => `${kind}:${id}`

const MEDIA_TYPES: RequestType[] = [
  "missing_photo",
  "replacement",
  "optional_angle",
  "campaign",
]

const options = <T extends string>(
  list: readonly T[],
  words: Record<T, string>
) => list.map((id) => ({ id, name: words[id] }))

export function RequestForm({
  mode,
  today,
  slots,
  facts,
  people,
  shotLists,
  initialSlot,
  initialFact,
  create,
}: {
  mode: "slot" | "new" | "fact"
  today: string
  slots: SlotOption[]
  facts: FactOption[]
  people: RequestPerson[]
  shotLists: ShotListView[]
  initialSlot?: { kind: RequestSlotKind; slotId: string } | null
  initialFact?: string | null
  create: CreateAction
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const firstSlot = initialSlot
    ? slots.find(
        (s) => s.kind === initialSlot.kind && s.slotId === initialSlot.slotId
      )
    : undefined
  const [slot, setSlot] = React.useState<string | null>(
    firstSlot ? slotKey(firstSlot.kind, firstSlot.slotId) : null
  )
  const chosen = slots.find((s) => slotKey(s.kind, s.slotId) === slot)
  const [type, setType] = React.useState<RequestType>(
    mode === "fact"
      ? "fact_confirmation"
      : mode === "new"
        ? "missing_photo"
        : defaultTypeForSlot(firstSlot?.state ?? null)
  )
  const [factCheckId, setFact] = React.useState<string | null>(
    initialFact && facts.some((f) => f.checkId === initialFact)
      ? initialFact
      : null
  )
  const [subject, setSubject] = React.useState("")
  const [brief, setBrief] = React.useState(firstSlot?.brief ?? "")
  // The last prefilled brief: choosing another slot replaces it only while
  // the manager has not written their own.
  const prefilled = React.useRef(firstSlot?.brief ?? "")
  const [intendedUse, setUse] = React.useState<IntendedUse | "">(
    mode === "fact" ? "internal" : "public"
  )
  const [team, setTeam] = React.useState<Team | null>(null)
  const [photoCount, setCount] = React.useState("1")
  const [priority, setPriority] = React.useState<Priority>("normal")
  const [assigneeId, setAssignee] = React.useState<string | null>(null)
  const [date, setDate] = React.useState("")
  const [orientation, setOrientation] = React.useState<Orientation | null>(null)
  const [wantsVideo, setVideo] = React.useState(false)
  const [captureWindow, setWindow] = React.useState("")
  const [shotListId, setShotList] = React.useState<string | null>(null)
  const [useExample, setUseExample] = React.useState(false)
  const [errors, setErrors] = React.useState<DraftErrors>({})
  const [failure, setFailure] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const verifiers = people.filter((p) => p.role === "manager")
  const assignable = mode === "fact" ? verifiers : people

  const onSlot = (next: string | null) => {
    setSlot(next)
    const s = slots.find((x) => slotKey(x.kind, x.slotId) === next)
    if (s && (type === "missing_photo" || type === "replacement"))
      setType(defaultTypeForSlot(s.state))
    if (brief.trim() === "" || brief === prefilled.current) {
      const standing = s?.brief ?? ""
      prefilled.current = standing
      setBrief(standing)
    }
  }

  const submit = async () => {
    const draft: RequestDraft = {
      mode,
      type,
      slotKind: chosen?.kind ?? null,
      slotId: chosen?.slotId ?? null,
      factCheckId,
      subject,
      brief,
      intendedUse,
      team,
      photoCount: Number(photoCount),
      priority,
      assigneeId,
      date: date || null,
      orientation,
      wantsVideo,
      captureWindow,
      shotListId,
    }
    const found = checkRequestDraft(draft, today)
    setErrors(found)
    setFailure(null)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      const result = await create({
        ...draft,
        slotKind: mode === "slot" ? draft.slotKind : null,
        slotId: mode === "slot" ? draft.slotId : null,
        factCheckId: mode === "fact" ? factCheckId : null,
        referenceAssetId:
          mode === "slot" && useExample
            ? (chosen?.primaryAssetId ?? null)
            : null,
        subject: mode === "new" ? subject : null,
        brief: brief.trim() || null,
        intendedUse: intendedUse || null,
      })
      if (!result.ok) {
        if (result.field && result.field !== "form")
          setErrors({ [result.field]: result.error })
        else setFailure(result.error)
        return
      }
      router.push(requestHrefs.request(result.id))
    } catch (cause) {
      setFailure(
        sessionEnded(cause) ??
          "That didn't go through. Check your connection and try again."
      )
    } finally {
      setBusy(false)
    }
  }

  const hint = REQUEST_WORDS.typeHint[type]
  const form = (
    <form
      noValidate
      data-slot="request-form"
      className="grid gap-4 rounded-card bg-surface p-3 edge sm:p-5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {failure ? (
        <Notice tone="negative" role="alert">
          {failure}
        </Notice>
      ) : null}

      {mode === "slot" ? (
        <FormField
          label="Slot"
          error={errors.slotId}
          description={
            chosen
              ? `${chosen.categoryLabel} · ${slotStateWord(chosen.state)}`
              : "The dish, place or facility the photo is for."
          }
        >
          <OptionSelect
            options={slots.map((s) => ({
              id: slotKey(s.kind, s.slotId),
              name: `${s.name} · ${s.categoryLabel}`,
            }))}
            value={slot}
            onValueChange={onSlot}
            placeholder="Choose a slot"
            invalid={Boolean(errors.slotId)}
          />
        </FormField>
      ) : null}

      {mode === "fact" ? (
        <FormField
          label="Fact"
          error={errors.factCheckId}
          description="Completes only when a manager or admin confirms the answer."
        >
          <OptionSelect
            options={facts.map((f) => ({
              id: f.checkId,
              name: f.stateLabel
                ? `${f.question} · ${f.stateLabel}`
                : f.question,
            }))}
            value={factCheckId}
            onValueChange={setFact}
            placeholder="Choose a fact"
            invalid={Boolean(errors.factCheckId)}
          />
        </FormField>
      ) : null}

      {mode === "new" ? (
        <FormField
          label="Subject"
          error={errors.subject}
          description="What to photograph. It has no slot in the album yet."
        >
          <Input
            value={subject}
            maxLength={SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
          />
        </FormField>
      ) : null}

      <FormField
        label={mode === "fact" ? "Note" : "Brief"}
        optional={mode === "fact"}
        error={errors.brief}
        description={
          mode === "fact"
            ? "What to check, in one line."
            : `One line on what the photo must show. Staff read it on the slot. ${[...brief].length} of ${REQUEST_BRIEF_MAX} characters.`
        }
      >
        <Input
          value={brief}
          maxLength={REQUEST_BRIEF_MAX}
          onChange={(e) => setBrief(e.target.value)}
        />
      </FormField>

      {mode !== "fact" ? (
        <FormField label="Intended use" error={errors.intendedUse}>
          <OptionSelect
            options={options(INTENDED_USES, REQUEST_WORDS.use)}
            value={intendedUse || null}
            onValueChange={(v) => setUse((v as IntendedUse | null) ?? "")}
            invalid={Boolean(errors.intendedUse)}
          />
        </FormField>
      ) : null}

      {/* The three required answers (slot, brief, use) come first; the
          kind defaults from the slot, so it follows them. */}
      {mode !== "fact" ? (
        <FormField
          label="Kind of request"
          error={errors.type}
          description={hint}
        >
          <OptionSelect
            options={MEDIA_TYPES.filter(
              (t) => mode === "slot" || t !== "replacement"
            ).map((t) => ({ id: t, name: REQUEST_WORDS.type[t] }))}
            value={type}
            onValueChange={(v) => v && setType(v as RequestType)}
          />
        </FormField>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={mode === "fact" ? "Who confirms it" : "Person"}
          optional={mode !== "fact"}
          error={errors.assigneeId}
          description={
            mode === "fact"
              ? "A manager. Leave empty to take it yourself."
              : "They are told in their inbox. Anyone can still add the photo."
          }
        >
          <OptionSelect
            options={assignable.map((p) => ({ id: p.id, name: p.name }))}
            value={assigneeId}
            onValueChange={setAssignee}
            emptyLabel={mode === "fact" ? "Me" : "Anyone at the venue"}
          />
        </FormField>
        <FormField
          label={mode === "slot" ? "Needed by" : "Due"}
          optional
          error={errors.date}
          description={
            mode === "slot"
              ? "Orders the slot for staff. It never turns overdue."
              : undefined
          }
        >
          <Input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
      </div>

      <details className="group grid gap-4 rounded-control bg-surface-2 p-3">
        <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink focus-ring">
          {mode === "fact"
            ? "More detail: priority"
            : "More detail: priority, team, orientation, shot list"}
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <FormField label="Priority">
            <OptionSelect
              options={options(PRIORITIES, REQUEST_WORDS.priority)}
              value={priority}
              onValueChange={(v) => v && setPriority(v as Priority)}
            />
          </FormField>
          {mode !== "fact" ? (
            <>
              <FormField
                label="Team"
                optional
                description={
                  mode === "slot"
                    ? "Defaults from the slot's category."
                    : undefined
                }
              >
                <OptionSelect
                  options={options(TEAMS, REQUEST_WORDS.team)}
                  value={team}
                  onValueChange={(v) => setTeam(v as Team | null)}
                  emptyLabel="Default"
                />
              </FormField>
              <FormField
                label="Photos"
                error={errors.photoCount}
                description={`1 to ${PHOTO_COUNT_MAX}.`}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={PHOTO_COUNT_MAX}
                  value={photoCount}
                  onChange={(e) => setCount(e.target.value)}
                />
              </FormField>
              <FormField label="Orientation" optional>
                <OptionSelect
                  options={options(ORIENTATIONS, REQUEST_WORDS.orientation)}
                  value={orientation}
                  onValueChange={(v) => setOrientation(v as Orientation | null)}
                  emptyLabel="Any"
                />
              </FormField>
              <FormField
                label="When to shoot"
                optional
                error={errors.captureWindow}
                description="A quiet time, or when the light is right."
              >
                <Input
                  value={captureWindow}
                  maxLength={CAPTURE_WINDOW_MAX}
                  onChange={(e) => setWindow(e.target.value)}
                />
              </FormField>
              {shotLists.length > 0 ? (
                <FormField label="Shot list" optional error={errors.shotListId}>
                  <OptionSelect
                    options={shotLists.map((l) => ({ id: l.id, name: l.name }))}
                    value={shotListId}
                    onValueChange={setShotList}
                    emptyLabel="None"
                  />
                </FormField>
              ) : null}
              {mode === "slot" && chosen?.primaryAssetId ? (
                <OptionRow
                  type="checkbox"
                  size="sm"
                  className="sm:col-span-2"
                  label="Show the current album photo as an example"
                  hint="Staff see it beside your brief."
                  checked={useExample}
                  onCheckedChange={(v) => setUseExample(v === true)}
                />
              ) : null}
              <OptionRow
                type="checkbox"
                size="sm"
                className="sm:col-span-2"
                label="Ask for a short video too"
                checked={wantsVideo}
                onCheckedChange={(v) => setVideo(v === true)}
              />
            </>
          ) : null}
        </div>
      </details>

      <div className="flex flex-wrap gap-2 max-sm:*:flex-auto">
        <Button type="submit" variant="primary" loading={busy} disabled={busy}>
          Send the request
        </Button>
        <LinkButton href={requestHrefs.list()} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </form>
  )

  if (mode === "fact") return form
  const previewName =
    mode === "slot" ? (chosen?.name ?? null) : subject.trim() || null
  const previewBrief = brief.trim()
  // The handoff's New request: the form left, and from bp-desktop what staff
  // will see on the slot beside it, so the brief is written for them.
  return (
    <div className="grid items-start gap-4 desktop:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      {form}
      <aside
        aria-labelledby="request-preview-title"
        data-slot="request-preview"
        className="grid gap-3 rounded-card bg-surface p-4 edge"
      >
        <h2 id="request-preview-title" className="text-heading text-ink">
          What staff will see
        </h2>
        {previewName ? (
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-label [overflow-wrap:anywhere] text-ink">
                {previewName}
              </p>
              <StatusChip state="request_open" />
            </div>
            <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
              {[
                previewBrief ? `Asked for: “${previewBrief}”` : null,
                date ? `Needed by ${shortDate(date)}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Write the brief to see it here."}
            </p>
          </div>
        ) : (
          <p className="text-meta text-ink-muted">
            {mode === "slot"
              ? "Choose a slot to see it here."
              : "Write the subject to see it here."}
          </p>
        )}
      </aside>
    </div>
  )
}

/** "28 Nov" for a YYYY-MM-DD date. */
function shortDate(day: string): string {
  const at = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(at.getTime())
    ? day
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(at)
}
