"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { CoverageNotice } from "@/components/nabalens/coverage"
import type { Notice as CoverageNoticeValue } from "@/components/nabalens/coverage"
import {
  ReasonDialog,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
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
  SOURCE_KINDS,
  type KnowledgeResult,
  type MappingKind,
  type ReconcileResult,
  type SourceKind,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  MAPPING_KIND_LABEL,
  RECONCILE_COPY as COPY,
  SOURCE_KIND_LABEL,
} from "./reconcile-copy"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"

type Venue = { id: string; name: string }
type Keyed<T> = (input: Record<string, unknown>) => Promise<KnowledgeResult<T>>

const errorsOf = (result: { fieldErrors?: Partial<Record<string, string>> }) =>
  Object.fromEntries(
    Object.entries(result.fieldErrors ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  )

/** Declare a source (§7.3): Kind, Label, Venue. Keyed. */
export function DeclareSourceForm({
  venues,
  onDeclare,
}: {
  venues: Venue[]
  onDeclare: Keyed<{ sourceId: string; replayed: boolean }>
}) {
  const id = React.useId()
  const router = useRouter()
  const requests = useRequestIds()
  const sessionEnded = useSessionEndedCatch()
  const [kind, setKind] = React.useState<SourceKind | "">("")
  const [label, setLabel] = React.useState("")
  const [venueId, setVenueId] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)
  const [pending, setPending] = React.useState(false)

  async function submit() {
    const next: Record<string, string> = {}
    if (!kind) next.kind = "Choose what kind of source this is."
    if (!label.trim()) next.label = "Enter a name of up to 80 characters."
    setErrors(next)
    if (Object.keys(next).length) return
    const payload = { kind, label: label.trim(), venueId: venueId || null }
    const idempotencyKey = requests.requestIdFor("source-declare", payload)
    setPending(true)
    setNotice(null)
    try {
      const result = await onDeclare({ ...payload, idempotencyKey })
      requests.settle("source-declare")
      if (!result.ok) {
        setErrors(errorsOf(result))
        setNotice({ tone: "error", text: result.message })
        return
      }
      setKind("")
      setLabel("")
      setVenueId("")
      setNotice({ tone: "success", text: COPY.declared_ })
      router.refresh()
    } catch (cause) {
      setNotice({ tone: "error", text: sessionEnded(cause) || COPY.lostApply })
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      noValidate
      className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 id={`${id}-title`} className={LABEL}>
        {COPY.declare}
      </h3>
      <p className={MUTED}>{COPY.declareHelp}</p>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-kind`} className={LABEL}>
          {COPY.kind}
        </label>
        <select
          id={`${id}-kind`}
          value={kind}
          disabled={pending}
          className={INPUT}
          aria-invalid={errors.kind ? true : undefined}
          aria-describedby={errors.kind ? `${id}-kind-error` : undefined}
          onChange={(e) => setKind(e.currentTarget.value as SourceKind | "")}
        >
          <option value="">Choose…</option>
          {SOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {SOURCE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <FieldMessage id={`${id}-kind-error`} error={errors.kind} />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-label`} className={LABEL}>
          {COPY.label}
        </label>
        <input
          id={`${id}-label`}
          value={label}
          maxLength={80}
          placeholder="⟨Source label⟩"
          disabled={pending}
          className={INPUT}
          aria-invalid={errors.label ? true : undefined}
          aria-describedby={errors.label ? `${id}-label-error` : undefined}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <FieldMessage id={`${id}-label-error`} error={errors.label} />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-venue`} className={LABEL}>
          {COPY.venue}
        </label>
        <select
          id={`${id}-venue`}
          value={venueId}
          disabled={pending}
          className={INPUT}
          onChange={(e) => setVenueId(e.currentTarget.value)}
        >
          <option value="">{COPY.allVenues}</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Button
          type="submit"
          size="touch"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {COPY.declareSubmit}
        </Button>
      </div>
    </form>
  )
}

/** Retire a source with a reason (§7.3). Keyed. */
export function RetireSourceControl({
  sourceId,
  label,
  onRetire,
}: {
  sourceId: string
  label: string
  onRetire: Keyed<{ sourceId: string; replayed: boolean }>
}) {
  const router = useRouter()
  const requests = useRequestIds()
  const [open, setOpen] = React.useState(false)
  const scope = `source-retire:${sourceId}`
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="touch"
        onClick={() => setOpen(true)}
      >
        {COPY.retire}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={COPY.retireTitle(label)}
        label={COPY.why}
        emptyError={COPY.whyEmpty}
        confirmLabel={COPY.retireConfirm}
        pendingLabel="Retiring…"
        destructive
        onConfirm={async (reason): Promise<ReasonOutcome> => {
          const payload = { sourceId, reason }
          const result = await onRetire({
            ...payload,
            idempotencyKey: requests.requestIdFor(scope, payload),
          }).catch(() => null)
          if (!result) return { ok: false, error: COPY.lostApply }
          requests.settle(scope)
          if (!result.ok) return { ok: false, error: result.message }
          router.refresh()
          return { ok: true }
        }}
      />
    </>
  )
}

/** Review one old fact against a question (§7.3): append-only, reason required. */
export function MappingReviewControl({
  legacyFactId,
  legacyRevision,
  legacyKey,
  questions,
  onReview,
}: {
  legacyFactId: string
  legacyRevision: number
  legacyKey: string
  questions: { key: string; label: string }[]
  onReview: Keyed<{ mappingId: string; replayed: boolean }>
}) {
  const id = React.useId()
  const router = useRouter()
  const requests = useRequestIds()
  const [open, setOpen] = React.useState(false)
  const [questionKey, setQuestionKey] = React.useState("")
  // Nothing defaults to Exact (OD-17).
  const [kind, setKind] = React.useState<MappingKind | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const scope = `mapping-review:${legacyFactId}`
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="touch"
        onClick={() => setOpen(true)}
      >
        {COPY.review}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setQuestionKey("")
            setKind(null)
            setError(null)
          }
          setOpen(next)
        }}
        title={COPY.reviewTitle(legacyKey)}
        label={COPY.reason}
        emptyError={COPY.reasonEmpty}
        confirmLabel={COPY.reviewSubmit}
        pendingLabel="Saving…"
        onConfirm={async (reason): Promise<ReasonOutcome> => {
          if (!questionKey || !kind) {
            setError(
              !questionKey
                ? "Choose a question."
                : "Choose exact, candidate or none."
            )
            return { ok: false, error: "" }
          }
          setError(null)
          const payload = {
            legacyFactId,
            legacyRevision,
            questionKey,
            kind,
            reason,
          }
          const result = await onReview({
            ...payload,
            idempotencyKey: requests.requestIdFor(scope, payload),
          }).catch(() => null)
          if (!result) return { ok: false, error: COPY.lostApply }
          requests.settle(scope)
          if (!result.ok) return { ok: false, error: result.message }
          router.refresh()
          return { ok: true }
        }}
      >
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-question`} className={LABEL}>
            {COPY.question}
          </label>
          <select
            id={`${id}-question`}
            value={questionKey}
            className={INPUT}
            onChange={(e) => setQuestionKey(e.currentTarget.value)}
          >
            <option value="">Choose…</option>
            {questions.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset
          className="grid min-w-0 gap-1"
          aria-describedby={`${id}-exact-help`}
        >
          <legend className={LABEL}>{COPY.mappingKind}</legend>
          {(["exact", "candidate", "none"] as const).map((k) => (
            <label key={k} className={ROW}>
              <input
                type="radio"
                name={`${id}-kind`}
                className="size-5 shrink-0 accent-primary"
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {MAPPING_KIND_LABEL[k]}
            </label>
          ))}
          <p id={`${id}-exact-help`} className={MUTED}>
            {COPY.exactHelp}
          </p>
        </fieldset>
        {error ? <FieldMessage id={`${id}-error`} error={error} /> : null}
      </ReasonDialog>
    </>
  )
}

const SLOW_MS = 15_000

/** Start a dry run (§7.4): Kind and scope, then its run page. */
export function StartDryRunForm({
  venues,
  onReconcile,
  runBase,
}: {
  venues: Venue[]
  onReconcile: (
    input: Record<string, unknown>
  ) => Promise<KnowledgeResult<{ result: ReconcileResult }>>
  /**
   * The runs route; a run's page is `${runBase}/${runId}`. A path, not a
   * function: a Server Component can pass this component only serializable
   * props and Server Actions.
   */
  runBase: string
}) {
  const id = React.useId()
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [kind, setKind] = React.useState<"legacy" | "external">("legacy")
  const [venueId, setVenueId] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [slow, setSlow] = React.useState(false)
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)

  async function submit() {
    setPending(true)
    setSlow(false)
    setNotice(null)
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    try {
      const result = await onReconcile({
        kind,
        mode: "dry_run",
        venueId: venueId || null,
      })
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        return
      }
      router.push(`${runBase}/${encodeURIComponent(result.result.runId)}`)
    } catch (cause) {
      setNotice({ tone: "error", text: sessionEnded(cause) || COPY.failed })
    } finally {
      clearTimeout(timer)
      setPending(false)
    }
  }

  return (
    <form
      noValidate
      className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 id={`${id}-title`} className={LABEL}>
        {COPY.start}
      </h3>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      <fieldset className="grid min-w-0 gap-1" disabled={pending}>
        <legend className={LABEL}>{COPY.kind}</legend>
        {(["legacy", "external"] as const).map((k) => (
          <label key={k} className={ROW}>
            <input
              type="radio"
              name={`${id}-kind`}
              className="size-5 shrink-0 accent-primary"
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {COPY.runKind[k]}
          </label>
        ))}
      </fieldset>
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-venue`} className={LABEL}>
          {COPY.scopeVenue}
        </label>
        <select
          id={`${id}-venue`}
          value={venueId}
          disabled={pending}
          className={INPUT}
          onChange={(e) => setVenueId(e.currentTarget.value)}
        >
          <option value="">{COPY.allOfThem}</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <div>
          <Button
            type="submit"
            size="touch"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? COPY.running : COPY.startSubmit}
          </Button>
        </div>
        <p role="status" className={MUTED}>
          {pending && slow ? COPY.stillRunning : ""}
        </p>
      </div>
    </form>
  )
}

/**
 * Apply a fresh dry run (§7.4): a confirming dialog, then what was imported.
 * A source that changed since the dry run imports nothing.
 */
export function ApplyRunControl({
  count,
  kind,
  venueId,
  onReconcile,
  runsHref,
}: {
  count: number
  kind: "legacy" | "external"
  venueId: string | null
  onReconcile: (
    input: Record<string, unknown>
  ) => Promise<KnowledgeResult<{ result: ReconcileResult }>>
  runsHref: string
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [slow, setSlow] = React.useState(false)
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)

  async function apply() {
    setPending(true)
    setSlow(false)
    setNotice(null)
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    try {
      const result = await onReconcile({ kind, mode: "apply", venueId })
      setOpen(false)
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        return
      }
      setNotice({
        tone: "success",
        text: COPY.applied(
          result.result.created ?? 0,
          result.result.counts.alreadyApplied
        ),
      })
      router.refresh()
    } catch (cause) {
      setOpen(false)
      setNotice({ tone: "error", text: sessionEnded(cause) || COPY.lostApply })
    } finally {
      clearTimeout(timer)
      setPending(false)
    }
  }

  return (
    <div className="grid gap-2">
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      {notice?.tone === "error" && notice.text === COPY.lostApply ? (
        <a
          href={runsHref}
          className="text-body-touch text-ink underline md:text-body"
        >
          {COPY.runs}
        </a>
      ) : null}
      <div>
        <Button
          type="button"
          size="touch"
          disabled={pending || count === 0}
          onClick={() => setOpen(true)}
        >
          {COPY.apply(count)}
        </Button>
      </div>
      <p role="status" className={MUTED}>
        {pending && slow ? COPY.stillRunning : ""}
      </p>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{COPY.applyTitle(count)}</DialogTitle>
            <DialogDescription>{COPY.applyBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {COPY.cancel}
            </Button>
            <Button
              type="button"
              size="touch"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() => void apply()}
            >
              {pending ? COPY.running : COPY.applyConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
