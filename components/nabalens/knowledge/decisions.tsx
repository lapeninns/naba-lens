"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ChatCircleTextIcon,
  CheckIcon,
  EyeIcon,
  ShieldCheckIcon,
  XIcon,
} from "@phosphor-icons/react"

import { EvidenceTile } from "@/components/nabalens/amenities/evidence-tile"
import { newIdempotencyKey } from "@/components/nabalens/amenities/capture/draft"
import { CoverageNotice, CoverageSection } from "@/components/nabalens/coverage"
import type { Notice as CoverageNoticeValue } from "@/components/nabalens/coverage"
import { REPORTED } from "@/components/nabalens/coverage/use-coverage-action"
import {
  ReasonDialog,
  ReasonField,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ANSWER_LABEL } from "@/lib/amenities/contract"
import {
  findingKey,
  type AnswerInUse,
  type DecideInput,
  type DecisionResult,
  type FindingRef,
  type QuestionView,
  type KnowledgeFailure,
  type KnowledgeResult,
  type PendingFinding,
  type ResolveConflictInput,
} from "@/lib/knowledge-client/contract"

import {
  dateAndTime,
  KNOWLEDGE_ANSWER_LABEL,
  KNOWLEDGE_FAILURE_COPY,
  longDate,
  UNKNOWN_PRESET_LABEL,
} from "./copy"

type InScope = Extract<QuestionView, { inScope: true }>
type Decision = KnowledgeResult<DecisionResult>

export type DecisionHandlers = {
  decide: (input: DecideInput) => Promise<Decision>
  resolveConflict: (input: ResolveConflictInput) => Promise<Decision>
}

// ---- Words ------------------------------------------------------------------------

function firstName(person: PendingFinding["sender"]): string {
  const name = person?.displayName?.trim()
  return name ? name.split(/\s+/)[0] : "They"
}

const KIND_TITLE: Record<PendingFinding["kind"], string> = {
  finding: "Finding",
  change_report: "Change report",
  detail: "Added detail",
  answer_unconfirmed: "Answer in use, not confirmed",
  evidence_removed: "Evidence removed from the answer in use",
}

/** One line on what readers of the venue's answers get now (§6.2, D1). */
export function readersNow(answer: AnswerInUse, pending: PendingFinding[]) {
  if (answer.reason === "disputed")
    return "While this is undecided, readers are told the answer is being checked. Confirm the change, keep the answer in use, or reopen the question."
  if (answer.status === "available" && pending.length > 0)
    return "Readers still get the current answer."
  if (answer.reason === "not_confirmed" && answer.detail === "pending")
    return "Readers are told it's awaiting confirmation."
  if (answer.reason === "withdrawn")
    return "Readers aren't given the answer until you decide."
  return null
}

/** "Readers get the answer again" only when nothing else still disputes it. */
function againLine(othersDisputing: number) {
  return othersDisputing === 0
    ? "Readers get the answer again."
    : "Readers get the answer again once the other findings that disagree are decided."
}

const STALE = new Set<KnowledgeFailure["code"]>([
  "revision_conflict",
  "already_decided",
  "knowledge_slot_out_of_scope",
  "not_found",
  "not_permitted",
  "wrong_venue",
  "state_conflict",
])

/** The person's words for a refused decision (§6.6). Never "Try again". */
export function decisionFailureText(failure: KnowledgeFailure): string {
  const copy = KNOWLEDGE_FAILURE_COPY.decision
  switch (failure.code) {
    case "revision_conflict":
      return copy.stale
    case "already_decided":
      return copy.alreadyDecided
    case "self_confirmation_not_permitted":
      return copy.selfNotPermitted
    case "asset_ineligible":
      return copy.evidenceGone
    case "knowledge_slot_out_of_scope":
      return copy.outOfScope
    default:
      return failure.message
  }
}

// ---- Running a decision -------------------------------------------------------------

type Lost = { text: string; retry: () => void }

/**
 * Runs one decision: a fresh request key per intent, the refusal in the
 * person's words, a re-read after success or a stale refusal, and Try again
 * (same key, same input) only when the reply was lost.
 */
function useDecision() {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)
  const [lost, setLost] = React.useState<Lost | null>(null)

  const run = React.useCallback(
    async function run(
      call: () => Promise<Decision>,
      success: string
    ): Promise<boolean> {
      setPending(true)
      setNotice(null)
      setLost(null)
      try {
        const result = await call()
        if (!result.ok) {
          const stale = STALE.has(result.code)
          setNotice({
            tone: stale ? "warning" : "error",
            text: decisionFailureText(result),
          })
          if (stale) router.refresh()
          return false
        }
        setNotice({ tone: "success", text: success })
        router.refresh()
        return true
      } catch (cause) {
        const ended = sessionEnded(cause)
        if (ended) setNotice({ tone: "error", text: ended })
        else
          setLost({
            text: KNOWLEDGE_FAILURE_COPY.decision.lost,
            retry: () => void run(call, success),
          })
        return false
      } finally {
        setPending(false)
      }
    },
    [router, sessionEnded]
  )

  return {
    run,
    pending,
    notice,
    lost,
    dismiss: () => {
      setNotice(null)
      setLost(null)
    },
  }
}

// ---- Dialogs ---------------------------------------------------------------------

/** A decision with an optional note (confirm over an answer, keep this answer). */
function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: (note: string) => Promise<void>
}) {
  const id = React.useId()
  const [note, setNote] = React.useState("")
  const [pending, setPending] = React.useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setNote("")
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            try {
              await onConfirm(note.trim())
              setNote("")
              onOpenChange(false)
            } finally {
              setPending(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">
              {title}
            </DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere]">
              {description}
            </DialogDescription>
          </DialogHeader>
          <ReasonField
            id={`${id}-note`}
            label="Note"
            value={note}
            onChange={setNote}
            required={false}
            disabled={pending}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Ask =
  | { kind: "detail"; finding: PendingFinding }
  | { kind: "decline"; finding: PendingFinding }
  | { kind: "keep_single"; finding: PendingFinding }
  | { kind: "choose"; finding: PendingFinding }
  | { kind: "keep_all" }
  | { kind: "confirm_replace"; finding: PendingFinding }
  | { kind: "reaffirm"; finding: PendingFinding }

// ---- The panel --------------------------------------------------------------------

/**
 * "To confirm" on a working-list question (B01-04): every undecided finding
 * and every answer in use that needs a decision, compared with what's in use,
 * what readers get meanwhile, and the decisions the manager may take. A
 * question with two or more findings that disagree is decided as one choice.
 */
export function DecisionPanel({
  view,
  handlers,
  onReopen,
}: {
  view: InScope
  handlers: DecisionHandlers
  /** Opens the check's existing reopen dialog. */
  onReopen?: () => void
}) {
  const decision = useDecision()
  const [ask, setAsk] = React.useState<Ask | null>(null)
  const { slot, pending, permissions } = view
  const answer = slot.answerInUse
  const slotRevision = slot.slotRevision
  const venue = view.venue.name
  if (pending.length === 0) return null

  const isFinding = (p: PendingFinding) =>
    p.kind === "finding" || p.kind === "change_report" || p.kind === "detail"
  const answers = pending.filter((p) => isFinding(p) && p.answer !== "unknown")
  const unknowns = pending.filter((p) => isFinding(p) && p.answer === "unknown")
  const current = pending.filter((p) => !isFinding(p))
  const conflict = answers.length >= 2
  const disputing = pending.filter((p) => p.disputes).length
  const readers = readersNow(answer, pending)

  const decide = (
    finding: PendingFinding,
    kind: DecideInput["decision"],
    success: string,
    note?: string
  ) => {
    const input: DecideInput = {
      findingRef: finding.findingRef,
      decision: kind,
      slotRevision,
      idempotencyKey: newIdempotencyKey(),
      ...(note ? { note } : {}),
    }
    return decision.run(() => handlers.decide(input), success)
  }

  const resolve = (
    choose: FindingRef | "keep_in_use",
    reason: string,
    success: string
  ) => {
    const input: ResolveConflictInput = {
      checkId: slot.checkId,
      slotRevision,
      idempotencyKey: newIdempotencyKey(),
      choose,
      reason,
    }
    return decision.run(() => handlers.resolveConflict(input), success)
  }

  /** A dialog's decision: closes and reports through the panel either way. */
  const reported = async (done: Promise<boolean>): Promise<ReasonOutcome> =>
    (await done) ? { ok: true } : REPORTED

  function confirm(finding: PendingFinding) {
    if (answer.value && finding.answer !== answer.value) {
      setAsk({ kind: "confirm_replace", finding })
      return
    }
    void decide(
      finding,
      "confirm",
      `Confirmed. This is now the answer for ${venue}.`
    )
  }

  const actionsFor = (finding: PendingFinding): React.ReactNode => {
    if (finding.mine && !permissions.canSelfConfirm)
      return (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          {KNOWLEDGE_FAILURE_COPY.decision.selfNotPermitted}
        </p>
      )
    const detail = permissions.canRequestDetail ? (
      <Button
        variant="secondary"
        size="touch"
        disabled={decision.pending}
        onClick={() => setAsk({ kind: "detail", finding })}
      >
        <ChatCircleTextIcon aria-hidden />
        Ask for more detail
      </Button>
    ) : null
    if (finding.kind === "evidence_removed")
      return (
        <>
          {onReopen ? (
            <Button variant="secondary" size="touch" onClick={onReopen}>
              <ArrowCounterClockwiseIcon aria-hidden />
              Reopen
            </Button>
          ) : null}
          <Button
            size="touch"
            disabled={decision.pending}
            onClick={() => setAsk({ kind: "reaffirm", finding })}
          >
            <ShieldCheckIcon aria-hidden />
            Keep this answer
          </Button>
        </>
      )
    if (finding.kind === "answer_unconfirmed")
      return (
        <>
          {permissions.canDecline ? (
            <Button
              variant="secondary"
              size="touch"
              disabled={decision.pending}
              onClick={() => setAsk({ kind: "decline", finding })}
            >
              <XIcon aria-hidden />
              Don&apos;t confirm
            </Button>
          ) : null}
          {permissions.canConfirm ? (
            <Button
              size="touch"
              disabled={decision.pending}
              onClick={() => confirm(finding)}
            >
              <CheckIcon aria-hidden />
              Confirm
            </Button>
          ) : null}
        </>
      )
    if (finding.answer === "unknown") {
      const seen = (primary: boolean) => (
        <Button
          variant={primary ? "primary" : "secondary"}
          size="touch"
          disabled={decision.pending}
          onClick={() => void decide(finding, "seen", "Marked as seen.")}
        >
          <EyeIcon aria-hidden />
          Mark as seen
        </Button>
      )
      // Keep (S10) settles every listed finding, so a card offers it only
      // when it's the only finding that disputes the answer (R3, rev 5).
      if (finding.disputes && disputing === 1 && !conflict)
        return (
          <>
            {detail}
            {seen(false)}
            {permissions.canDecline ? (
              <Button
                size="touch"
                disabled={decision.pending}
                onClick={() => setAsk({ kind: "keep_single", finding })}
              >
                <ShieldCheckIcon aria-hidden />
                Keep the answer in use
              </Button>
            ) : null}
          </>
        )
      return (
        <>
          {detail}
          {seen(true)}
        </>
      )
    }
    if (conflict)
      return permissions.canConfirm ? (
        <Button
          variant="secondary"
          size="touch"
          disabled={decision.pending}
          onClick={() => setAsk({ kind: "choose", finding })}
        >
          <CheckIcon aria-hidden />
          Use this answer
        </Button>
      ) : null
    return (
      <>
        {detail}
        {permissions.canDecline ? (
          <Button
            variant="secondary"
            size="touch"
            disabled={decision.pending}
            onClick={() => setAsk({ kind: "decline", finding })}
          >
            {finding.disputes ? (
              <ShieldCheckIcon aria-hidden />
            ) : (
              <XIcon aria-hidden />
            )}
            {finding.disputes ? "Keep the answer in use" : "Don't confirm"}
          </Button>
        ) : null}
        {permissions.canConfirm ? (
          <Button
            size="touch"
            disabled={decision.pending}
            onClick={() => confirm(finding)}
          >
            <CheckIcon aria-hidden />
            Confirm
          </Button>
        ) : null}
      </>
    )
  }

  const unknownNote = (finding: PendingFinding) =>
    finding.answer !== "unknown" || !finding.disputes
      ? null
      : disputing === 1 && !conflict
        ? "Either Keep the answer in use or Mark as seen ends the dispute, and readers then get the answer again. If the doubt is right, reopen the question instead."
        : "Marking it as seen settles this finding only. To keep the answer in use, use the panel above, which settles every finding that disagrees."

  const card = (finding: PendingFinding) => (
    <FindingCard
      key={findingKey(finding.findingRef)}
      finding={finding}
      answer={answer}
      note={unknownNote(finding)}
      actions={actionsFor(finding)}
    />
  )

  const name = (f: PendingFinding) => firstName(f.sender)

  return (
    <CoverageSection
      id="amenity-to-confirm"
      title="To confirm"
      count={pending.length}
    >
      <CoverageNotice notice={decision.notice} onDismiss={decision.dismiss} />
      {decision.lost ? (
        <Notice
          tone="negative"
          role="alert"
          action={
            <Button
              variant="secondary"
              size="touch"
              onClick={decision.lost.retry}
              disabled={decision.pending}
            >
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              Try again
            </Button>
          }
        >
          {decision.lost.text}
        </Notice>
      ) : null}
      {readers ? (
        <p className="text-body-touch text-ink md:text-body">{readers}</p>
      ) : null}
      {conflict ? (
        <Notice tone="attention" role="note">
          These findings disagree. Choose which one to use, or keep the answer
          in use.
        </Notice>
      ) : null}
      <ul className="grid gap-3">
        {current.map(card)}
        {answers.map(card)}
        {conflict ? null : unknowns.map(card)}
      </ul>
      {conflict && answer.value && permissions.canDecline ? (
        <div>
          <Button
            variant="secondary"
            size="touch"
            disabled={decision.pending}
            onClick={() => setAsk({ kind: "keep_all" })}
          >
            <ShieldCheckIcon aria-hidden />
            Keep the answer in use
          </Button>
        </div>
      ) : null}
      {conflict && unknowns.length > 0 ? (
        <section aria-labelledby="also-recorded" className="grid gap-3">
          <h3
            id="also-recorded"
            className="text-label-touch text-ink md:text-label"
          >
            Also recorded
          </h3>
          <ul className="grid gap-3">{unknowns.map(card)}</ul>
        </section>
      ) : null}

      <ReasonDialog
        open={ask?.kind === "detail"}
        onOpenChange={(open) => !open && setAsk(null)}
        title={
          ask?.kind === "detail"
            ? `Ask ${name(ask.finding)} for more detail`
            : "Ask for more detail"
        }
        label="What do you need?"
        help={
          ask?.kind === "detail"
            ? `${name(ask.finding)} sees this on Home.`
            : undefined
        }
        emptyError="Say what you need."
        confirmLabel="Ask for more detail"
        pendingLabel="Asking…"
        onConfirm={(note) =>
          ask?.kind === "detail"
            ? reported(
                decide(
                  ask.finding,
                  "request_detail",
                  `Asked ${name(ask.finding)} for more detail.`,
                  note
                )
              )
            : Promise.resolve(REPORTED)
        }
      />
      <ReasonDialog
        open={ask?.kind === "decline" || ask?.kind === "keep_single"}
        onOpenChange={(open) => !open && setAsk(null)}
        title={
          ask &&
          "finding" in ask &&
          (ask.kind === "keep_single" || ask.finding.disputes)
            ? "Keep the answer in use?"
            : "Don't confirm this finding?"
        }
        label="Why not?"
        help={
          ask && "finding" in ask
            ? `${name(ask.finding)} sees this.`
            : undefined
        }
        emptyError="Say why."
        note={
          ask && "finding" in ask
            ? ask.finding.kind === "answer_unconfirmed"
              ? "The question is reopened: staff see it as Needs recheck."
              : ask.finding.disputes || ask.kind === "keep_single"
                ? `The answer in use doesn't change. ${againLine(disputing - 1)}`
                : "The answer in use doesn't change."
            : undefined
        }
        confirmLabel={
          ask &&
          "finding" in ask &&
          (ask.kind === "keep_single" || ask.finding.disputes)
            ? "Keep the answer in use"
            : "Don't confirm"
        }
        pendingLabel="Saving…"
        onConfirm={(reason) => {
          if (ask?.kind === "keep_single")
            // A disputing Couldn't-establish finding is settled by S10 (R3).
            return reported(
              resolve(
                "keep_in_use",
                reason,
                `Kept the answer in use. ${name(ask.finding)} will see why.`
              )
            )
          if (ask?.kind === "decline")
            return reported(
              decide(
                ask.finding,
                "decline",
                `Not confirmed. ${name(ask.finding)} will see why.`,
                reason
              )
            )
          return Promise.resolve(REPORTED)
        }}
      />
      <ReasonDialog
        open={ask?.kind === "choose" || ask?.kind === "keep_all"}
        onOpenChange={(open) => !open && setAsk(null)}
        title={
          ask?.kind === "choose"
            ? `Use ${name(ask.finding)}'s answer?`
            : "Keep the answer in use?"
        }
        description={
          ask?.kind === "choose"
            ? "The other findings are marked Not confirmed with your reason, and any Couldn't-establish findings listed here are marked as seen. Only findings sent after this can disagree with the new answer."
            : "The findings that disagree are marked Not confirmed with your reason, and any Couldn't-establish findings listed here are marked as seen."
        }
        label="Why this one?"
        help="Everyone who sent a finding sees this."
        emptyError="Say why."
        confirmLabel={
          ask?.kind === "choose" ? "Use this answer" : "Keep the answer in use"
        }
        pendingLabel="Saving…"
        onConfirm={(reason) =>
          ask?.kind === "choose"
            ? reported(
                resolve(
                  ask.finding.findingRef,
                  reason,
                  `Using ${name(ask.finding)}'s answer. The other findings are marked Not confirmed.`
                )
              )
            : reported(
                resolve("keep_in_use", reason, "Kept the answer in use.")
              )
        }
      />
      <NoteDialog
        open={ask?.kind === "confirm_replace"}
        onOpenChange={(open) => !open && setAsk(null)}
        title="Replace the current answer?"
        description={
          ask?.kind === "confirm_replace" && answer.value
            ? `“${ANSWER_LABEL[answer.value]}” stops being used and stays in the history. “${KNOWLEDGE_ANSWER_LABEL[ask.finding.answer]}” is used from now.`
            : ""
        }
        confirmLabel="Confirm and replace"
        onConfirm={async (note) => {
          if (ask?.kind !== "confirm_replace") return
          await decide(
            ask.finding,
            "confirm",
            `Confirmed. This is now the answer for ${venue}.`,
            note || undefined
          )
        }}
      />
      <NoteDialog
        open={ask?.kind === "reaffirm"}
        onOpenChange={(open) => !open && setAsk(null)}
        title="Keep this answer?"
        description={`The remaining evidence is enough. ${againLine(disputing)}`}
        confirmLabel="Keep this answer"
        onConfirm={async (note) => {
          if (ask?.kind !== "reaffirm") return
          await decide(
            ask.finding,
            "reaffirm",
            "Kept this answer.",
            note || undefined
          )
        }}
      />
    </CoverageSection>
  )
}

// ---- One finding ------------------------------------------------------------------

function Fact({
  term,
  different = false,
  children,
}: {
  term: string
  different?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-meta-touch text-ink-muted md:text-meta">
        {term}
        {different ? (
          <span className="ml-1.5 font-semibold text-ink">Different</span>
        ) : null}
      </dt>
      <dd className="text-body-touch break-words whitespace-pre-line text-ink md:text-body">
        {children}
      </dd>
    </div>
  )
}

function confirmationText(answer: AnswerInUse): string {
  const c = answer.confirmation
  const who = c.by?.displayName ?? null
  switch (c.state) {
    case "confirmed":
      return c.self
        ? `Confirmed by ${who ?? "a manager"} (their own finding)${c.at ? ` on ${longDate(c.at)}` : ""}`
        : `Confirmed by ${who ?? "a manager"}${c.at ? ` on ${longDate(c.at)}` : ""}`
    case "pending":
      return "Not confirmed"
    case "revoked":
      return "Confirmation withdrawn"
    case "not_required":
      return answer.savedAt
        ? "Not needed for this question"
        : "Not recorded (answered before confirmation existed)"
  }
}

function FindingCard({
  finding,
  answer,
  note,
  actions,
}: {
  finding: PendingFinding
  answer: AnswerInUse
  note: string | null
  actions: React.ReactNode
}) {
  const titleId = `finding-${findingKey(finding.findingRef).replace(":", "-")}`
  const sender = finding.sender?.displayName ?? "a former team member"
  const isCurrent =
    finding.kind === "answer_unconfirmed" || finding.kind === "evidence_removed"
  const differs =
    !isCurrent && answer.value !== null && finding.answer !== answer.value
  return (
    <li
      aria-labelledby={titleId}
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3
          id={titleId}
          className="text-item-title [overflow-wrap:anywhere] text-ink"
        >
          {isCurrent
            ? KIND_TITLE[finding.kind]
            : `${KIND_TITLE[finding.kind]} from ${sender}${finding.senderIsAssignee ? " (assigned)" : ""}`}
        </h3>
        <StatusChip state="awaiting_confirmation" />
      </div>
      <p className="text-meta-touch text-ink-muted md:text-meta">
        {isCurrent ? "Recorded" : "Sent"} {dateAndTime(finding.sentAt)}
      </p>
      {finding.kind === "answer_unconfirmed" ? (
        <p className="text-body-touch text-ink md:text-body">
          This answer is recorded but not confirmed, so readers are told
          it&apos;s awaiting confirmation.
        </p>
      ) : null}
      {finding.kind === "evidence_removed" ? (
        <p className="text-body-touch text-ink md:text-body">
          {finding.removedEvidence === 0
            ? "Evidence attached to this answer was deleted."
            : finding.removedEvidence === 1
              ? "1 photo attached to this answer was deleted."
              : `${finding.removedEvidence} photos attached to this answer were deleted.`}{" "}
          Readers aren&apos;t given the answer until you decide.
        </p>
      ) : null}
      <dl className="grid gap-3 md:grid-cols-2">
        <div className="grid content-start gap-3 rounded-control bg-well p-3">
          <p className="text-label-touch text-ink md:text-label">In use now</p>
          <Fact term="Answer">
            {answer.value ? ANSWER_LABEL[answer.value] : "None"}
            {answer.savedAt ? `, recorded ${longDate(answer.savedAt)}` : ""}
          </Fact>
          {answer.value ? (
            <Fact term="Confirmation">{confirmationText(answer)}</Fact>
          ) : null}
        </div>
        {isCurrent ? null : (
          <div className="grid content-start gap-3 rounded-control bg-well p-3">
            <p className="text-label-touch text-ink md:text-label">
              This finding
            </p>
            <Fact term="Answer" different={differs}>
              {KNOWLEDGE_ANSWER_LABEL[finding.answer]}
            </Fact>
            {finding.changeReason ? (
              <Fact term="What changed">{finding.changeReason}</Fact>
            ) : null}
            {finding.finding ? (
              <Fact term="What they found">{finding.finding}</Fact>
            ) : null}
            {finding.limitations ? (
              <Fact term="Limitations">{finding.limitations}</Fact>
            ) : null}
            {finding.reason ? (
              <Fact term="Reason">{finding.reason}</Fact>
            ) : null}
            {finding.unknownPreset ? (
              <Fact term="Why they couldn't establish it">
                {UNKNOWN_PRESET_LABEL[finding.unknownPreset]}
              </Fact>
            ) : null}
            {finding.triedText ? (
              <Fact term="What they tried">{finding.triedText}</Fact>
            ) : null}
          </div>
        )}
      </dl>
      {finding.evidence.length > 0 ? (
        <ul
          aria-label="Evidence"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {finding.evidence.map((item, i) => (
            <li key={item.assetId}>
              <EvidenceTile
                item={item}
                label={`${item.kind === "video" ? "Video" : "Photo"} ${i + 1} from ${sender}`}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {finding.detailRequest ? (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          {finding.detailRequest.at
            ? `You asked for more detail on ${longDate(finding.detailRequest.at)}`
            : "You asked for more detail"}
          {finding.detailRequest.note ? `: ${finding.detailRequest.note}` : "."}
        </p>
      ) : null}
      {note ? (
        <p className="text-body-touch text-ink md:text-body">{note}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 *:flex-auto sm:*:flex-none">
        {actions}
      </div>
    </li>
  )
}
