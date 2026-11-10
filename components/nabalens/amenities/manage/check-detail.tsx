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
import {
  QUALIFIER_WORD,
  answerInUseLines,
  managerSentNoticeFor,
} from "@/components/nabalens/knowledge/copy"
import {
  POLICY_COPY,
  type PolicyContext,
} from "@/components/nabalens/knowledge/policy-detail"
import { PolicyNeedsPanel } from "@/components/nabalens/knowledge/policy-detail-fields"
import {
  DateChangeControl,
  UpcomingSection,
  type UpcomingRead,
} from "@/components/nabalens/knowledge/schedule-section"
import { SPORT_LINES } from "@/components/nabalens/knowledge/service-detail"
import { CheckDatesSection } from "@/components/nabalens/knowledge/check-dates"
import {
  AnswerOnDate,
  HistorySection,
  WithdrawControl,
} from "@/components/nabalens/knowledge/corrections"
import { OldFactsSection } from "@/components/nabalens/knowledge/old-facts"
import {
  findingKey,
  type LegacyNarrativeItem,
  type QuestionView,
  type RecheckTask,
  type SlotEventView,
} from "@/lib/knowledge-client/contract"

import { FINDING_SENT_PARAM } from "../capture/finding-sent"
import {
  FindingSentNotice,
  type FindingSentCopy,
} from "../capture/finding-sent-notice"
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

/** Where focus goes when the sent notice is dismissed. */
const CHECK_TOP_ID = "amenity-check"

/** A check off the working list, complete after the send. */
const LEGACY_SENT: FindingSentCopy = {
  title: "Finding sent",
  body: "The check is complete.",
  tone: "positive",
}

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
    /** A policy question (B03-c): State the policy, and its cards' rows. */
    policy?: PolicyContext | null
    /** B03-g: who may correct, withdraw and read history, and its first page. */
    corrections?: {
      canCorrect: boolean
      canWithdraw: boolean
      canReadHistory: boolean
      events: { items: SlotEventView[]; nextCursor: string | null } | null
      withdraw: React.ComponentProps<typeof WithdrawControl>["onWithdraw"]
      loadOlder: React.ComponentProps<typeof HistorySection>["loadOlder"]
      loadAt: React.ComponentProps<typeof AnswerOnDate>["load"]
      today: string
    } | null
    /** B03-f: the venue's old facts as history; null when unreadable. */
    oldFacts?: LegacyNarrativeItem[] | null
    /** B03-e: the check's open rechecks; null when they couldn't be read. */
    rechecks?: { count: number; tasks: RecheckTask[] } | null
    /** A schedule in use (B03-d): Upcoming, and a change for one date. */
    schedule?: {
      read: UpcomingRead
      timezone: string
      lastDay: string | null
      today: string
      addException: React.ComponentProps<typeof DateChangeControl>["onAdd"]
    } | null
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
  // An incomplete policy is never shown as the current answer (B03 UI §4.3).
  const notConfirmed =
    knowledge?.view.slot.answerInUse.detail === "policy_incomplete"
  // On a policy question a manager or an admin states the policy (§4.1).
  const statesPolicy = Boolean(knowledge?.policy)
  // "Capture myself" came back here naming this check (CA-15): say what
  // happened to the finding, from this page's read, never the URL alone.
  const sentId = React.useSyncExternalStore(
    noSubscription,
    () => new URLSearchParams(window.location.search).get(FINDING_SENT_PARAM),
    () => null
  )
  const sent =
    sentId !== check.id
      ? null
      : knowledge
        ? managerSentNoticeFor(knowledge.view.slot)
        : check.progress === "complete"
          ? LEGACY_SENT
          : null
  // A qualified answer reads needs recheck but is stored complete (§2.6),
  // so it can be reopened like any answer in use.
  const canReopen =
    permissions.canReopen &&
    active &&
    (check.progress === "complete" || Boolean(check.qualification))
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
    <div
      id={CHECK_TOP_ID}
      tabIndex={-1}
      className="grid min-w-0 gap-6 outline-none md:gap-8"
    >
      {sent ? (
        <FindingSentNotice
          question={check.entry.question}
          returnFocusId={CHECK_TOP_ID}
          copy={sent}
        />
      ) : null}
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
          policy={knowledge.policy ?? null}
          stateHref={
            permissions.canSubmit && active
              ? hrefs.capture(check.id)
              : undefined
          }
          completeHref={
            statesPolicy
              ? (finding) =>
                  `${hrefs.capture(check.id)}?complete=${encodeURIComponent(findingKey(finding.findingRef))}`
              : undefined
          }
        />
      ) : null}

      <CoverageSection id="amenity-status" title="Where it stands">
        {SPORT_LINES[check.entry.key] ? (
          <p className="text-body-touch text-ink md:text-body">
            {SPORT_LINES[check.entry.key]}
          </p>
        ) : null}
        {knowledge?.view.slot.answerInUse.policyMissing?.length ? (
          <PolicyNeedsPanel
            needs={knowledge.view.slot.answerInUse.policyMissing}
          />
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-meta-touch text-ink-muted md:text-meta">
              Progress
            </dt>
            <dd>
              <ProgressChip check={check} notConfirmed={notConfirmed} />
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
                : check.qualification
                  ? QUALIFIER_WORD[check.qualification]
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
        {check.progress === "needs_recheck" &&
        check.recheckReason &&
        !check.qualification ? (
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
                variant: canUpload || statesPolicy ? "primary" : "secondary",
                size: "touch",
              })}
            >
              <CameraIcon aria-hidden />
              {statesPolicy ? POLICY_COPY.statePolicy : UI_TEXT.captureMyself}
            </Link>
          ) : null}
          {knowledge?.corrections?.canWithdraw &&
          active &&
          knowledge.view.slot.answerInUse.value &&
          knowledge.view.slot.answerInUse.detail !== "answer_withdrawn" ? (
            <WithdrawControl
              checkId={check.id}
              slotRevision={knowledge.view.slot.slotRevision}
              value={ANSWER_LABEL[knowledge.view.slot.answerInUse.value]}
              onWithdraw={knowledge.corrections.withdraw}
              focusId="amenity-status-title"
            />
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
        {permissions.canSubmit && active && !canUpload && !statesPolicy ? (
          <p className={muted}>
            {UI_TEXT.captureMyself} attaches photos and videos already on
            Naba-Lens. For new ones, assign this check to staff.
          </p>
        ) : null}
      </CoverageSection>

      {knowledge?.view.slot.freshness ? (
        <CheckDatesSection
          freshness={knowledge.view.slot.freshness}
          rechecks={knowledge.rechecks ?? null}
          assignee={check.assignee?.displayName ?? null}
          findingWaiting={knowledge.view.pending.length > 0}
          policy={statesPolicy}
        />
      ) : null}

      {knowledge?.schedule ? (
        <>
          <UpcomingSection
            read={knowledge.schedule.read}
            timezone={knowledge.schedule.timezone}
            lastDay={knowledge.schedule.lastDay}
            today={knowledge.schedule.today}
          />
          {active && knowledge.view.slot.answerInUse.scheduleId ? (
            <DateChangeControl
              checkId={check.id}
              slotRevision={knowledge.view.slot.slotRevision}
              scheduleId={knowledge.view.slot.answerInUse.scheduleId}
              onAdd={knowledge.schedule.addException}
            />
          ) : null}
        </>
      ) : null}

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
        {check.qualification && permissions.canAssign && active ? (
          <p className="text-body-touch text-ink-muted md:text-body-sm">
            Assigning doesn&apos;t change the answer in use. Whoever you assign
            is asked to look again; what they send goes through this
            question&apos;s usual confirmation.
          </p>
        ) : null}
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

      {knowledge?.corrections?.canReadHistory ? (
        <>
          <HistorySection
            checkId={check.id}
            first={knowledge.corrections.events}
            loadOlder={knowledge.corrections.loadOlder}
            checkDatesApply={
              knowledge.view.slot.freshness?.some(
                (entry) => entry.state !== "unrated"
              ) ?? false
            }
          />
          <AnswerOnDate
            checkId={check.id}
            today={knowledge.corrections.today}
            load={knowledge.corrections.loadAt}
          />
        </>
      ) : null}

      {knowledge && knowledge.oldFacts !== undefined ? (
        <OldFactsSection items={knowledge.oldFacts} />
      ) : null}

      <SubmissionHistory
        submissions={detail.submissions}
        currentNotConfirmed={notConfirmed}
      />
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
