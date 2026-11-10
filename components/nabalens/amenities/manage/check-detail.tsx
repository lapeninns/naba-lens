"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CameraIcon,
  FloppyDiskIcon,
  SpinnerGapIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"

import {
  CoverageNotice,
  CoverageSection,
  ReasonField,
} from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useStillWaiting } from "@/components/nabalens/use-still-waiting"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  ANSWER_LABEL,
  EVIDENCE_RULE_LABEL,
  LIMITS,
  UI_TEXT,
  amenityHrefs,
  type AmenityResult,
  type CheckDetail,
  type ReopenPreset,
} from "@/lib/amenities/contract"

import {
  DecisionPanel,
  type DecisionHandlers,
} from "@/components/nabalens/knowledge/decisions"
import { answerInUseLines } from "@/components/nabalens/knowledge/copy"
import type { QuestionView } from "@/lib/knowledge-client/contract"

import { EventHistory, SubmissionHistory, peopleIndex } from "./check-history"
import { ProgressChip, answeredText } from "./check-row"
import { ReopenDialog, type ReopenOutcome } from "./reopen-dialog"
import { useAmenityAction } from "./use-amenity-action"

type RevisionResult = AmenityResult<{ revision: number }>

/** Every check write carries a request key (MG-01). */
type Keyed<T> = T & { idempotencyKey: string }

type Write = "assign" | "unassign" | "notes" | "archive" | "restore" | "reopen"

export const SAVING = "Saving…"
export const STILL_SAVING = "Still saving; keep this page open."

export type CheckDetailHandlers = {
  assign: (
    input: Keyed<{
      checkId: string
      assigneeId: string | null
      revision: number
    }>
  ) => Promise<RevisionResult>
  setNotes: (
    input: Keyed<{
      checkId: string
      notes: string
      revision: number
    }>
  ) => Promise<RevisionResult>
  archive: (
    input: Keyed<{
      checkId: string
      revision: number
    }>
  ) => Promise<RevisionResult>
  restore: (
    input: Keyed<{
      checkId: string
      revision: number
    }>
  ) => Promise<RevisionResult>
  reopen: (
    input: Keyed<{
      checkId: string
      revision: number
      preset: ReopenPreset
      reason?: string
    }>
  ) => Promise<RevisionResult>
}

const NOTES_DRAFT_PREFIX = "nabalens.amenity-notes."

function readNotesDraft(checkId: string): string | null {
  try {
    return window.sessionStorage.getItem(NOTES_DRAFT_PREFIX + checkId)
  } catch {
    return null
  }
}

const noSubscription = () => () => {}

/** Null clears the draft. */
function writeNotesDraft(checkId: string, notes: string | null) {
  try {
    if (notes === null)
      window.sessionStorage.removeItem(NOTES_DRAFT_PREFIX + checkId)
    else window.sessionStorage.setItem(NOTES_DRAFT_PREFIX + checkId, notes)
  } catch {
    // Storage unavailable (private mode, quota): the draft lives on screen only.
  }
}

/**
 * One amenity check for its venue's manager or an admin: the question and
 * brief, where it stands, who captures it, notes, and every submission and
 * change. Each write sends the revision the page was read at. A re-read
 * (after any write) keeps the notice; the assignee and notes drafts follow
 * what is saved unless the manager has unsaved changes in them, so typed
 * notes survive a revision conflict. Unsaved notes are also kept in this
 * tab's sessionStorage per check until saved, so a reload or a session-ended
 * sign-in brings them back (MG-09).
 *
 * `canUpload` is false for viewers who can only attach media already on
 * Naba-Lens (manager accounts, admins): Capture myself is then a secondary
 * action and the page says new evidence comes from assigned staff.
 */
export function AmenityCheckDetail({
  detail,
  basePath,
  handlers,
  canUpload = true,
  knowledge = null,
}: {
  detail: CheckDetail
  basePath: string
  handlers: CheckDetailHandlers
  canUpload?: boolean
  /** A working-list question: its decisions and the venue's answer. */
  knowledge?: {
    view: Extract<QuestionView, { inScope: true }>
    handlers: DecisionHandlers
  } | null
}) {
  const { check, permissions } = detail
  const id = React.useId()
  const hrefs = amenityHrefs(basePath)
  const action = useAmenityAction()
  const savedAssigneeId = check.assignee?.id ?? null
  const savedNotes = check.notes ?? ""
  const [assigneeId, setAssigneeId] = React.useState<string | null>(
    savedAssigneeId
  )
  const [notes, setNotes] = React.useState(savedNotes)
  // The server renders no draft (sessionStorage is the browser's); the
  // stored one is restored once, after hydration.
  const storedNotes = React.useSyncExternalStore(
    noSubscription,
    () => readNotesDraft(check.id),
    () => null
  )
  const [restored, setRestored] = React.useState(false)
  if (!restored && storedNotes !== null) {
    setRestored(true)
    if (storedNotes.trim() !== savedNotes) setNotes(storedNotes)
  }
  function editNotes(value: string) {
    setNotes(value)
    writeNotesDraft(check.id, value.trim() === savedNotes ? null : value)
  }
  // What the drafts were last reset to, to tell an unsaved edit from a
  // value that is simply behind the page after a re-read.
  const [base, setBase] = React.useState({
    revision: check.revision,
    assigneeId: savedAssigneeId,
    notes: savedNotes,
  })
  if (base.revision !== check.revision) {
    setBase({
      revision: check.revision,
      assigneeId: savedAssigneeId,
      notes: savedNotes,
    })
    if (assigneeId === base.assigneeId) setAssigneeId(savedAssigneeId)
    if (notes === base.notes || notes.trim() === savedNotes)
      setNotes(savedNotes)
  }
  const [reopenOpen, setReopenOpen] = React.useState(false)
  // The write in flight, so only its button says it is saving.
  const [busy, setBusy] = React.useState<Write | null>(null)
  const still = useStillWaiting(busy !== null)
  // Each write's outcome takes focus: the button that acted is often gone
  // (Archive becomes Restore) or disabled (Assign, Save notes) once it lands.
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const focusOutcome = React.useRef(false)
  const reopenLanded = React.useRef(false)
  React.useEffect(() => {
    if (!action.notice || !focusOutcome.current) return
    focusOutcome.current = false
    noticeRef.current?.focus()
  }, [action.notice])
  const active = check.status === "active"
  const revision = check.revision
  const people = peopleIndex(detail.assigneeOptions, [
    check.assignee,
    check.answeredBy,
    ...detail.events.map((e) => e.actor),
  ])

  /**
   * One check write, keyed per intent: the same write with the same input
   * (a retry or a second tap) reuses its key until a reply settles it.
   */
  async function write<I extends { checkId: string }, T extends object>(
    key: Write,
    input: I,
    call: (input: Keyed<I>) => Promise<AmenityResult<T>>,
    success: string
  ) {
    setBusy(key)
    // Reopen's dialog hands focus to the notice as it closes instead.
    focusOutcome.current = key !== "reopen"
    try {
      return await action.runKeyed(
        `amenity-check:${input.checkId}:${key}`,
        input,
        (idempotencyKey) => call({ ...input, idempotencyKey }),
        success
      )
    } finally {
      setBusy(null)
    }
  }

  async function assign(next: string | null) {
    if (next == null) {
      await write(
        "unassign",
        { checkId: check.id, assigneeId: null, revision },
        handlers.assign,
        "Unassigned."
      )
      return
    }
    if (next === check.assignee?.id) return
    const name = people.get(next) ?? "them"
    await write(
      "assign",
      { checkId: check.id, assigneeId: next, revision },
      handlers.assign,
      `Assigned to ${name}.`
    )
  }

  async function saveNotes(event: React.FormEvent) {
    event.preventDefault()
    if (notes.length > LIMITS.notes) {
      action.setFieldErrors({ notes: `Use up to ${LIMITS.notes} characters.` })
      return
    }
    const result = await write(
      "notes",
      { checkId: check.id, notes: notes.trim(), revision },
      handlers.setNotes,
      "Notes saved."
    )
    if (result.ok) writeNotesDraft(check.id, null)
  }

  async function reopen(input: {
    preset: ReopenPreset
    reason?: string
  }): Promise<ReopenOutcome> {
    const result = await write(
      "reopen",
      { checkId: check.id, revision, ...input },
      handlers.reopen,
      knowledge
        ? "Reopened. The answer is no longer in use; staff see it as Needs recheck."
        : "Reopened: staff will see it as Needs recheck."
    )
    if (result.ok) {
      reopenLanded.current = true
      return { ok: true }
    }
    if (result.code === "invalid_input" || result.code === "network")
      return {
        ok: false,
        error: result.message,
        fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined,
      }
    reopenLanded.current = true
    return { ok: false, error: result.message, close: true }
  }

  const answered = answeredText(check)
  const canReopen =
    permissions.canReopen && active && check.progress === "complete"
  const muted = "text-body-touch text-ink-muted md:text-body-sm"
  const stillSaving = (...keys: Write[]) =>
    still && busy && keys.includes(busy) ? (
      <p role="status" className={muted}>
        {STILL_SAVING}
      </p>
    ) : null
  /** The pressed button's icon and label while its write runs. */
  const label = (key: Write, icon: React.ReactNode, text: string) =>
    busy === key ? (
      <>
        <SpinnerGapIcon aria-hidden className="animate-spin" />
        {SAVING}
      </>
    ) : (
      <>
        {icon}
        {text}
      </>
    )

  return (
    <div className="grid min-w-0 gap-6 md:gap-8">
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />

      {knowledge ? (
        <DecisionPanel
          view={knowledge.view}
          handlers={knowledge.handlers}
          onReopen={canReopen ? () => setReopenOpen(true) : undefined}
        />
      ) : null}

      <CoverageSection id="amenity-status" title="Where it stands">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-meta-touch text-ink-muted md:text-meta">
              Progress
            </dt>
            <dd>
              <ProgressChip check={check} />
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-meta-touch text-ink-muted md:text-meta">
              Answer
            </dt>
            <dd className="text-body-touch text-ink md:text-body">
              {knowledge
                ? answerInUseLines(
                    knowledge.view.slot.answerInUse,
                    knowledge.view.slot
                  ).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))
                : ANSWER_LABEL[check.answer]}
              {answered ? (
                <span className="block text-meta-touch text-ink-muted md:text-meta">
                  {answered}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-meta-touch text-ink-muted md:text-meta">
              Evidence needed
            </dt>
            <dd className="text-body-touch text-ink md:text-body">
              {EVIDENCE_RULE_LABEL[check.entry.evidenceRule]}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-meta-touch text-ink-muted md:text-meta">
              Category
            </dt>
            <dd className="text-body-touch break-words text-ink md:text-body">
              {check.entry.category}
            </dd>
          </div>
        </dl>
        {check.progress === "needs_recheck" && check.recheckReason ? (
          <Notice tone="attention" role="note" title="Recheck reason">
            <span className="break-words">{check.recheckReason}</span>
          </Notice>
        ) : null}
        {!active ? (
          <Notice>
            Archived: hidden from staff and the counts. Its history is kept;
            restoring brings it back as it was.
          </Notice>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {permissions.canSubmit && active ? (
            <Link
              href={hrefs.capture(check.id)}
              className={buttonVariants({
                variant: canUpload ? "primary" : "secondary",
                size: "touch",
              })}
            >
              <CameraIcon aria-hidden />
              {UI_TEXT.captureMyself}
            </Link>
          ) : null}
          {canReopen ? (
            <Button
              variant="secondary"
              size="touch"
              onClick={() => setReopenOpen(true)}
              disabled={action.pending}
            >
              <ArrowCounterClockwiseIcon aria-hidden />
              {UI_TEXT.reopen}
            </Button>
          ) : null}
          {permissions.canArchive && active ? (
            <Button
              variant="secondary"
              size="touch"
              onClick={() =>
                write(
                  "archive",
                  { checkId: check.id, revision },
                  handlers.archive,
                  "Archived. Restore it from the Archived list at any time."
                )
              }
              disabled={action.pending}
              aria-busy={busy === "archive" || undefined}
            >
              {label("archive", <ArchiveIcon aria-hidden />, UI_TEXT.archive)}
            </Button>
          ) : null}
          {permissions.canRestore && !active ? (
            <Button
              variant="secondary"
              size="touch"
              onClick={() =>
                write(
                  "restore",
                  { checkId: check.id, revision },
                  handlers.restore,
                  "Restored."
                )
              }
              disabled={action.pending}
              aria-busy={busy === "restore" || undefined}
            >
              {label(
                "restore",
                <ArrowCounterClockwiseIcon aria-hidden />,
                UI_TEXT.restore
              )}
            </Button>
          ) : null}
        </div>
        {stillSaving("archive", "restore")}
        {permissions.canSubmit && active && !canUpload ? (
          <p className={muted}>
            {UI_TEXT.captureMyself} attaches photos and videos already on
            Naba-Lens. For new ones, assign this check to staff.
          </p>
        ) : null}
      </CoverageSection>

      <CoverageSection id="amenity-brief" title="Capture brief">
        <p className="max-w-(--size-reading) text-body-touch break-words whitespace-pre-line text-ink md:text-body">
          {check.entry.captureBrief}
        </p>
      </CoverageSection>

      <CoverageSection id="amenity-assignee" title="Who captures it">
        <p className="text-body-touch text-ink md:text-body">
          {check.assignee
            ? `Assigned to ${check.assignee.displayName ?? "a former team member"}.`
            : "No one is assigned."}
        </p>
        {permissions.canAssign && active ? (
          <div className="grid max-w-md gap-3">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${id}-assignee`}
                className="text-label-touch text-ink md:text-label"
              >
                Assignee
              </label>
              <OptionSelect
                id={`${id}-assignee`}
                options={detail.assigneeOptions.map((o) => ({
                  id: o.id,
                  name: o.jobTitle
                    ? `${o.displayName} (${o.jobTitle})`
                    : o.displayName,
                }))}
                value={assigneeId}
                onValueChange={setAssigneeId}
                placeholder={
                  detail.assigneeOptions.length
                    ? "Choose a person…"
                    : "No active staff at this venue"
                }
                invalid={!!action.fieldErrors.assigneeId}
                disabled={action.pending || detail.assigneeOptions.length === 0}
                aria-describedby={
                  action.fieldErrors.assigneeId
                    ? `${id}-assignee-error`
                    : undefined
                }
              />
              {action.fieldErrors.assigneeId ? (
                <p
                  id={`${id}-assignee-error`}
                  role="alert"
                  className="text-meta-touch font-semibold text-negative md:text-meta-strong"
                >
                  {action.fieldErrors.assigneeId}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                size="touch"
                onClick={() => assign(assigneeId)}
                disabled={
                  action.pending ||
                  !assigneeId ||
                  assigneeId === check.assignee?.id
                }
                aria-busy={busy === "assign" || undefined}
              >
                {label("assign", <UserPlusIcon aria-hidden />, UI_TEXT.assign)}
              </Button>
              {check.assignee ? (
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => assign(null)}
                  disabled={action.pending}
                  aria-busy={busy === "unassign" || undefined}
                >
                  {label(
                    "unassign",
                    <UserMinusIcon aria-hidden />,
                    UI_TEXT.unassign
                  )}
                </Button>
              ) : null}
            </div>
            {stillSaving("assign", "unassign")}
            <p className={muted}>
              Only active staff at this venue can be assigned. Anyone can be
              changed later; their submissions are kept.
            </p>
          </div>
        ) : null}
      </CoverageSection>

      {permissions.canAssign ? (
        <CoverageSection id="amenity-notes" title="Notes">
          <form
            onSubmit={saveNotes}
            className="grid max-w-(--size-reading) gap-3"
            noValidate
          >
            <ReasonField
              id={`${id}-notes`}
              label="Notes for this venue"
              help="Kept with this check, for whoever manages the venue."
              value={notes}
              onChange={editNotes}
              error={action.fieldErrors.notes}
              required={false}
              maxLength={LIMITS.notes}
              disabled={action.pending}
            />
            <div>
              <Button
                type="submit"
                variant="secondary"
                size="touch"
                disabled={
                  action.pending || notes.trim() === (check.notes ?? "")
                }
                aria-busy={busy === "notes" || undefined}
              >
                {label("notes", <FloppyDiskIcon aria-hidden />, "Save notes")}
              </Button>
            </div>
            {stillSaving("notes")}
          </form>
        </CoverageSection>
      ) : null}

      <SubmissionHistory submissions={detail.submissions} />
      <EventHistory events={detail.events} people={people} />

      {canReopen ? (
        <ReopenDialog
          open={reopenOpen}
          onOpenChange={setReopenOpen}
          question={check.entry.question}
          onConfirm={reopen}
          knowledge={knowledge !== null}
          returnFocus={() => {
            if (!reopenLanded.current) return null
            reopenLanded.current = false
            return noticeRef.current
          }}
        />
      ) : null}
    </div>
  )
}
