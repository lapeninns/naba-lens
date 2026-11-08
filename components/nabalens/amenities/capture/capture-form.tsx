"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import {
  ANSWER_LABEL,
  EVIDENCE_RULE_LABEL,
  LIMITS,
  SUBMIT_ANSWERS,
  UI_TEXT,
  WIFI_KEY,
  evidenceSatisfies,
  type AmenityFailure,
  type AmenityResult,
  type CheckSummary,
  type EvidenceKind,
  type SubmitInput,
  type SubmitResult,
  type SubmittableAsset,
} from "@/lib/amenities/contract"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ReasonField } from "../../coverage/reason-dialog"
import { EmptyState } from "../../empty-state"
import { Notice } from "../../notice"
import { useOnline } from "../../offline-notice"
import {
  PhotoSourceActions,
  usePhotoSource,
  type PhotoSource,
} from "../../photo-source"
import type { OpenAddOptions } from "../../shell/add-context"
import type { UploadLimits } from "../../types"
import { UploadDialog } from "../../upload-dialog"
import type { Uploader } from "../../upload-queue"
import {
  clearDraft,
  emptyDraft,
  loadDraft,
  newIdempotencyKey,
  reconcileDraft,
  redactionHolds,
  saveDraft,
  type CaptureDraft,
} from "./draft"
import { EvidencePicker } from "./evidence-picker"
import {
  londonToday,
  missingEvidenceText,
  needsRedactionConfirm,
  validateDraft,
  type CaptureErrors,
  type CaptureField,
} from "./validate"

export type AssetsResult = AmenityResult<{ assets: SubmittableAsset[] }>
export type SubmitHandler = (
  input: SubmitInput
) => Promise<AmenityResult<SubmitResult>>

type Outcome =
  | { kind: "retry" }
  | { kind: "reload" }
  | { kind: "sign_in" }
  | { kind: "failed"; message: string }
  | { kind: "sent"; replayed: boolean }
  /** An earlier send was recorded, but the check has changed since. */
  | { kind: "stale" }

const ASSET_REASON_TEXT: Record<
  NonNullable<AmenityFailure["assetReason"]>,
  string
> = {
  not_found: "It's no longer available.",
  not_ready: "It's still processing.",
  other_venue: "It was taken at another venue.",
  not_own: "Only your own uploads can be sent.",
  deleted: "It was deleted.",
}

const RETRYABLE = new Set<AmenityFailure["code"]>(["unavailable"])

const inputClass =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:min-h-9 md:text-body"

const LABEL = "text-label-touch text-ink md:text-label"
const MUTED = "text-meta-touch text-ink-muted md:text-meta"

function isDirty(draft: CaptureDraft): boolean {
  return Boolean(
    draft.answer ||
    draft.finding ||
    draft.limitations ||
    draft.reason ||
    draft.assetIds.length ||
    draft.redactionConfirmed ||
    Object.values(draft.wifi).some(Boolean)
  )
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function FieldMessage({ id, error }: { id: string; error?: string }) {
  if (!error) return null
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-meta-touch font-semibold text-negative md:text-meta-strong"
    >
      <WarningCircleIcon aria-hidden className="mt-px size-4 shrink-0" />
      {error}
    </p>
  )
}

function TextInput({
  id,
  label,
  error,
  help,
  ...props
}: {
  id: string
  label: string
  error?: string
  help?: string
} & Omit<React.ComponentProps<"input">, "id">) {
  const describedBy =
    [help ? `${id}-help` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
        {...props}
      />
      {help ? (
        <p id={`${id}-help`} className={MUTED}>
          {help}
        </p>
      ) : null}
      <FieldMessage id={`${id}-error`} error={error} />
    </div>
  )
}

/**
 * Capture one amenity check: answer, what was found, evidence and (Wi-Fi) the
 * redaction tick and internal test notes. The whole draft, including its
 * idempotency key, is kept per person and check until a submit succeeds, so
 * "Try again" after a failed upload, a dropped connection or a reload sends
 * the same finding with the same key and is never recorded twice.
 */
export function CaptureForm({
  check,
  viewerId,
  initialAssets,
  loadAssets,
  submit,
  upload,
  canAttachLegacy = false,
  refreshSignal,
  onReload,
  onDone,
  signInHref,
  newKey = newIdempotencyKey,
}: {
  check: CheckSummary
  /** The signed-in person: drafts are kept per person on a shared device. */
  viewerId: string
  initialAssets: AssetsResult
  loadAssets: (input: { checkId: string }) => Promise<AssetsResult>
  submit: SubmitHandler
  /**
   * The upload flow, or null when the caller can't upload (admins pick from
   * media already at the venue). `addQueue` is the staff layout's one Add
   * queue; without it the form uploads through its own dialog.
   */
  upload: {
    addQueue?: {
      openAdd: (opts?: OpenAddOptions) => void
    } | null
    uploader: Uploader
    limits: UploadLimits
  } | null
  /** Managers and admins may also attach earlier Coverage photos. */
  canAttachLegacy?: boolean
  /** Changes when a global Add upload completes. */
  refreshSignal?: number
  /** Re-read the page (router.refresh) after a revision conflict. */
  onReload: () => void
  /** After a successful submit: back to Home or the check page. */
  onDone: () => void
  signInHref: string
  newKey?: () => string
}) {
  const ids = React.useId()
  const { entry } = check
  const rule = entry.evidenceRule
  const isWifi = entry.key === WIFI_KEY
  const redaction = needsRedactionConfirm(entry.key)
  const maxSelected = LIMITS.maxAssets

  const owner = React.useMemo(
    () => ({ userId: viewerId, checkId: check.id }),
    [viewerId, check.id]
  )
  const [draft, setDraft] = React.useState<CaptureDraft>(() =>
    emptyDraft(newKey, check.revision)
  )
  const [restored, setRestored] = React.useState(false)
  const [assets, setAssets] = React.useState<SubmittableAsset[]>(() =>
    initialAssets.ok ? initialAssets.assets : []
  )
  const [listError, setListError] = React.useState<string | null>(() =>
    initialAssets.ok ? null : initialAssets.message
  )
  const [flagged, setFlagged] = React.useState<ReadonlyMap<string, string>>(
    () => new Map()
  )
  const [errors, setErrors] = React.useState<CaptureErrors>({})
  const [extraErrors, setExtraErrors] = React.useState<string[]>([])
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)
  const [sending, setSending] = React.useState(false)
  const [uploadNote, setUploadNote] = React.useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [pickedFiles, setPickedFiles] = React.useState<File[] | undefined>()
  const sessionEnded = useSessionEndedCatch()
  const inFlight = React.useRef(false)
  const mounted = React.useRef(false)
  // One read at a time: Add hands over each upload as soon as it is ready,
  // so several reads can be asked for at once. A later request waits and
  // then reads once for every upload it carries; an older answer landing
  // after a newer one would otherwise drop an upload just selected.
  const loadingAssets = React.useRef(false)
  const queuedReload = React.useRef<Set<string> | null>(null)
  // The current pick's uploads selected here, and those not listed yet.
  const arrivals = React.useRef(newArrivals())
  // Uploads ready while an answer was sending: not in what was sent, so they
  // wait for its result instead of being selected into a draft it replaces.
  const late = React.useRef(new Set<string>())
  // A send with no definite answer yet (no reply, or a retryable failure) may
  // have been recorded: Try again replays it unchanged, so uploads arriving
  // until a definite answer wait in `late` as well.
  const unresolved = React.useRef(false)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queuedReload.current = null
    }
  }, [])

  // Read the stored draft after hydration (the server has no storage). A
  // draft from another revision of the check keeps its key only if it was
  // sent (it may have been recorded); a re-read after a conflict brings a new
  // revision too.
  const revision = check.revision
  React.useEffect(() => {
    const stored = loadDraft(owner)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from storage
    setDraft((current) => reconcileDraft(stored ?? current, revision, newKey))
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- newKey is a stable factory
  }, [owner, revision])

  React.useEffect(() => {
    if (!restored) return
    if (isDirty(draft)) saveDraft(owner, draft)
    else clearDraft(owner)
  }, [owner, draft, restored])

  const listed = React.useMemo(
    () => new Map(assets.map((a) => [a.assetId, a])),
    [assets]
  )
  const selected = React.useMemo(
    () => draft.assetIds.filter((id) => listed.has(id)),
    [draft.assetIds, listed]
  )
  const kinds = React.useMemo<EvidenceKind[]>(
    () => selected.map((id) => listed.get(id)!.kind),
    [selected, listed]
  )
  const ruleMet = evidenceSatisfies(rule, kinds)
  // The tick vouches for the evidence it was given for: adding or removing a
  // photo or video (here or before a reload) asks for it again.
  const redactionConfirmed = redactionHolds(draft, selected)

  /**
   * Every edit after an attempt is a new intent with a new key, except the
   * redaction tick (`sameIntent`): it vouches for the finding, it doesn't
   * change it, so ticking again after a reopen still replays. Changing the
   * evidence clears the tick: it was given for other photos.
   */
  function edit(
    change: (d: CaptureDraft) => CaptureDraft,
    { sameIntent = false } = {}
  ) {
    setOutcome((o) => (o?.kind === "sent" ? o : null))
    setDraft((current) => {
      let next = change(current)
      if (!sameIds(next.assetIds, current.assetIds))
        next = { ...next, redactionConfirmed: false, redactionAssetIds: [] }
      return current.attempted && !sameIntent
        ? { ...next, attempted: false, idempotencyKey: newKey() }
        : next
    })
  }

  function setField<K extends keyof CaptureDraft>(
    key: K,
    value: CaptureDraft[K]
  ) {
    edit((d) => ({ ...d, [key]: value }))
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function confirmRedaction(confirmed: boolean) {
    edit(
      (d) => ({
        ...d,
        redactionConfirmed: confirmed,
        redactionAssetIds: confirmed ? selected : [],
      }),
      { sameIntent: true }
    )
    if (errors.redactionConfirmed)
      setErrors((e) => ({ ...e, redactionConfirmed: undefined }))
  }

  function setWifi(key: keyof CaptureDraft["wifi"], value: string) {
    edit((d) => ({ ...d, wifi: { ...d.wifi, [key]: value } }))
    const field = `wifi.${key}` as CaptureField
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function toggle(assetId: string) {
    edit((d) => {
      const current = d.assetIds.filter((id) => listed.has(id))
      return {
        ...d,
        assetIds: current.includes(assetId)
          ? current.filter((id) => id !== assetId)
          : current.length >= maxSelected
            ? current
            : [...current, assetId],
      }
    })
    if (errors.assetIds) setErrors((e) => ({ ...e, assetIds: undefined }))
  }

  const reloadAssets = React.useCallback(
    async function reloadAssets(select: string[] = []) {
      if (loadingAssets.current) {
        queuedReload.current ??= new Set()
        for (const id of select) queuedReload.current.add(id)
        return
      }
      queuedReload.current = null
      loadingAssets.current = true
      try {
        let result: AssetsResult
        try {
          result = await loadAssets({ checkId: check.id })
        } catch (cause) {
          sessionEnded(cause)
          if (mounted.current)
            setListError("We couldn't load your photos and videos.")
          return
        }
        if (!mounted.current) return
        if (!result.ok) {
          setListError(result.message)
          return
        }
        setAssets(result.assets)
        setListError(null)
        if (select.length === 0) return
        if (inFlight.current || unresolved.current) {
          for (const id of select) late.current.add(id)
          return
        }
        const ready = new Set(result.assets.map((a) => a.assetId))
        const picked = select.filter((id) => ready.has(id))
        if (picked.length > 0)
          edit((d) => {
            const next = d.assetIds.filter((id) => ready.has(id))
            for (const id of picked) {
              if (next.length >= maxSelected) break
              if (!next.includes(id)) next.push(id)
            }
            return { ...d, assetIds: next }
          })
        const tally = arrivals.current
        for (const id of select) {
          if (ready.has(id)) {
            tally.selected.add(id)
            tally.waiting.delete(id)
          } else if (!tally.selected.has(id)) tally.waiting.add(id)
        }
        setUploadNote(arrivalNote(tally))
      } finally {
        loadingAssets.current = false
        const queued = queuedReload.current
        queuedReload.current = null
        if (queued !== null && mounted.current)
          void reloadAssets(Array.from(queued))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edit only touches state setters and newKey
    [loadAssets, check.id, maxSelected, sessionEnded]
  )

  const reloadRef = React.useRef(reloadAssets)
  React.useLayoutEffect(() => {
    reloadRef.current = reloadAssets
  }, [reloadAssets])

  const lastSignal = React.useRef(refreshSignal)
  React.useEffect(() => {
    if (refreshSignal === lastSignal.current) return
    lastSignal.current = refreshSignal
    void reloadAssets()
  }, [refreshSignal, reloadAssets])

  const ownPicker = usePhotoSource({
    onFiles: (files) => {
      arrivals.current = newArrivals()
      setPickedFiles(files)
      setUploadOpen(true)
    },
  })

  /** Runs in the click handler: the picker needs its user activation. */
  function choose(source: PhotoSource) {
    if (upload?.addQueue)
      upload.addQueue.openAdd({
        source,
        // Amenity evidence, never in the organisation community.
        purpose: "amenity",
        onPicked: () => {
          if (mounted.current) arrivals.current = newArrivals()
        },
        // Once per upload, as soon as that upload is ready (not when the
        // whole pick settles): each is added to the evidence, never
        // replacing it. False after unmount ("the screen is gone"): Add keeps
        // the upload saved, not attached to this check.
        onReady: (assetIds) => arrived.current(assetIds),
      })
    else ownPicker.open(source)
  }

  function onArrived(assetIds: string[]) {
    if (!mounted.current) return false
    if (inFlight.current || unresolved.current) {
      for (const id of assetIds) late.current.add(id)
      return
    }
    void reloadRef.current(assetIds)
  }
  const arrived = React.useRef(onArrived)
  React.useLayoutEffect(() => {
    arrived.current = onArrived
  })

  /** Uploads that arrived during the send are selected for the next one. */
  function selectLate() {
    const ids = [...late.current]
    late.current.clear()
    if (ids.length > 0) void reloadAssets(ids)
  }

  async function send() {
    if (inFlight.current) return
    // Only evidence still listed is sent (a deleted upload drops out).
    const checked = validateDraft({
      draft: { ...draft, assetIds: selected, redactionConfirmed },
      templateKey: entry.key,
      rule,
      kinds,
      checkId: check.id,
      revision: check.revision,
      today: londonToday(),
    })
    setExtraErrors([])
    if (!checked.ok) {
      setErrors(checked.errors)
      setOutcome(null)
      return
    }
    setErrors({})
    inFlight.current = true
    unresolved.current = true
    setSending(true)
    setOutcome(null)
    const sentDraft: CaptureDraft = {
      ...draft,
      revision: check.revision,
      assetIds: checked.input.assetIds,
      attempted: true,
    }
    setDraft(sentDraft)
    // Who and what was sent, even if the page is left before the answer.
    const sentFor = owner
    let result: AmenityResult<SubmitResult>
    try {
      result = await submit(checked.input)
    } catch (cause) {
      // The draft and its key stay, and uploads that arrive meanwhile wait:
      // Try again replays the same answer, never sends twice. Refused for
      // the ended session, it waits for Sign in again instead.
      const ended = sessionEnded(cause)
      if (mounted.current)
        setOutcome(ended ? { kind: "sign_in" } : { kind: "retry" })
      return
    } finally {
      inFlight.current = false
      if (mounted.current) setSending(false)
    }
    // A replay older than the revision on screen: the earlier send was
    // recorded, but the check changed since (a manager reopened it). This
    // answer still has to be sent, as a new intent with a new key.
    if (result.ok || !RETRYABLE.has(result.code)) unresolved.current = false
    const stale =
      result.ok && result.replayed && result.revision < check.revision
    // Recorded: drop the stored draft even when the form is gone, or a later
    // visit would replay this key after a reopen.
    if (result.ok && !stale) clearDraft(sentFor)
    if (!mounted.current) return

    if (stale) {
      setDraft((d) => ({
        ...d,
        attempted: false,
        idempotencyKey: newKey(),
        revision: check.revision,
      }))
      setOutcome({ kind: "stale" })
      selectLate()
      return
    }
    if (result.ok) {
      setDraft(emptyDraft(newKey, check.revision))
      setOutcome({ kind: "sent", replayed: result.replayed })
      const missed = late.current.size
      late.current.clear()
      // Stay, so the person learns those uploads are not in the answer.
      if (missed > 0) {
        setUploadNote(lateNote(missed))
        return
      }
      onDone()
      return
    }
    failed(result)
    if (!unresolved.current) selectLate()
  }

  function failed(result: AmenityFailure) {
    if (RETRYABLE.has(result.code)) {
      setOutcome({ kind: "retry" })
      return
    }
    // Nothing was recorded: the next send is a new intent with a new key.
    setDraft((d) => ({ ...d, attempted: false, idempotencyKey: newKey() }))
    switch (result.code) {
      case "revision_conflict":
        setOutcome({ kind: "reload" })
        return
      case "unauthenticated":
        setOutcome({ kind: "sign_in" })
        return
      case "evidence_rule_unmet": {
        const needed = EVIDENCE_RULE_LABEL[result.rule ?? rule]
        setErrors({
          assetIds: `Yes needs evidence: ${needed}. Add or choose it, then submit again.`,
        })
        setOutcome({
          kind: "failed",
          message: `This answer needs evidence: ${needed}.`,
        })
        return
      }
      case "asset_ineligible": {
        const why = result.assetReason
          ? ASSET_REASON_TEXT[result.assetReason]
          : result.message
        if (result.assetId) {
          const assetId = result.assetId
          setFlagged((current) => new Map(current).set(assetId, why))
          setDraft((d) => ({
            ...d,
            assetIds: d.assetIds.filter((id) => id !== assetId),
          }))
        }
        setOutcome({
          kind: "failed",
          message: `A photo or video can't be used: ${why} It has been unticked. Choose another, then submit again.`,
        })
        void reloadAssets()
        return
      }
    }
    if (result.fieldErrors) {
      const known: CaptureErrors = {}
      const other: string[] = []
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        if (!message) continue
        if (FIELD_NAMES.has(field)) known[field as CaptureField] = message
        else if (field === "wifi" || field.startsWith("wifi"))
          known["wifi.testSpot"] ??= message
        else other.push(message)
      }
      setErrors(known)
      setExtraErrors(other)
      setOutcome({
        kind: "failed",
        message: "Nothing was sent. Check the highlighted answers.",
      })
      return
    }
    setOutcome({ kind: "failed", message: result.message })
  }

  // Offline, Try again would only fail again. The unresolved send waits and
  // goes again by itself once the browser is back online: the same replay
  // as Try again (same key and revision; late uploads still wait).
  const online = useOnline()
  const sendRef = React.useRef(send)
  React.useLayoutEffect(() => {
    sendRef.current = send
  })
  const wasOnline = React.useRef(online)
  React.useEffect(() => {
    const back = online && !wasOnline.current
    wasOnline.current = online
    if (back && outcome?.kind === "retry" && !inFlight.current)
      void sendRef.current()
  }, [online, outcome])

  const errorId = (field: CaptureField) =>
    errors[field] ? `${ids}-${field}-error` : undefined

  const answer = draft.answer
  const missing = missingEvidenceText(rule, kinds)
  const canUpload = upload !== null
  const today = londonToday()

  return (
    <form
      noValidate
      aria-label={`Capture: ${entry.question}`}
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <section
        aria-labelledby={`${ids}-brief`}
        className="flex flex-col gap-2 rounded-panel bg-well p-4"
      >
        <h2 id={`${ids}-brief`} className={LABEL}>
          What to capture
        </h2>
        <p className="text-body-touch break-words md:text-body">
          {entry.captureBrief}
        </p>
        <p className="text-body-touch md:text-body-sm">
          <span className="font-semibold">Required evidence:</span>{" "}
          {EVIDENCE_RULE_LABEL[rule]}
          <span className="text-ink-muted"> (for a Yes answer)</span>
        </p>
      </section>

      {check.progress === "needs_recheck" && check.recheckReason ? (
        <Notice
          tone="attention"
          role="note"
          title="Your manager asked for a recheck"
        >
          <span className="break-words">{check.recheckReason}</span>
        </Notice>
      ) : null}

      {isWifi ? (
        <Notice tone="attention" role="note" title="Cover the Wi-Fi password">
          Before you take any photo or video, cover the Wi-Fi password and the
          join QR code. Evidence must never show them.
        </Notice>
      ) : null}

      <fieldset
        className="flex min-w-0 flex-col gap-2"
        aria-describedby={errorId("answer")}
        disabled={sending}
      >
        <legend className={cn(LABEL, "mb-2")}>{entry.question}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SUBMIT_ANSWERS.map((option) => (
            <label
              key={option}
              className="flex min-h-13 cursor-pointer items-center gap-3 rounded-control border border-line-control bg-panel px-4 text-label-touch text-ink has-checked:border-ink has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:min-h-11 md:text-label"
            >
              <input
                type="radio"
                name={`${ids}-answer`}
                value={option}
                checked={answer === option}
                onChange={() => setField("answer", option)}
                className="size-5 shrink-0 accent-primary"
              />
              {ANSWER_LABEL[option]}
            </label>
          ))}
        </div>
        <FieldMessage id={`${ids}-answer-error`} error={errors.answer} />
      </fieldset>

      <ReasonField
        id={`${ids}-finding`}
        label="What you found"
        required={false}
        value={draft.finding}
        onChange={(value) => setField("finding", value)}
        maxLength={LIMITS.finding}
        help="What a guest would find, in plain words."
        error={errors.finding}
        disabled={sending}
      />
      <ReasonField
        id={`${ids}-limitations`}
        label="Limitations"
        required={false}
        value={draft.limitations}
        onChange={(value) => setField("limitations", value)}
        maxLength={LIMITS.limitations}
        help="Anything that limits it, for example “two steps at the side door”."
        error={errors.limitations}
        disabled={sending}
      />
      {answer === "no" || answer === "not_applicable" ? (
        <ReasonField
          id={`${ids}-reason`}
          label="Reason"
          value={draft.reason}
          onChange={(value) => setField("reason", value)}
          maxLength={LIMITS.reason}
          help={`Required for ${ANSWER_LABEL[answer]}.`}
          error={errors.reason}
          disabled={sending}
        />
      ) : null}

      <section
        aria-labelledby={`${ids}-evidence`}
        className="flex min-w-0 flex-col gap-3"
      >
        <h2
          id={`${ids}-evidence`}
          className="font-display text-section-title-touch text-ink md:text-section-title"
        >
          Evidence
        </h2>
        <p
          aria-live="polite"
          data-testid="evidence-rule-status"
          className={cn(
            "flex items-start gap-1.5 text-body-touch md:text-body-sm",
            ruleMet ? "text-positive" : "text-ink"
          )}
        >
          {ruleMet ? (
            <CheckCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <WarningIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-attention"
            />
          )}
          {ruleMet
            ? `Evidence rule met: ${EVIDENCE_RULE_LABEL[rule]}.`
            : answer === "yes"
              ? missing
              : `Needed for Yes: ${EVIDENCE_RULE_LABEL[rule]}. Optional for No and Not applicable.`}
        </p>

        {canUpload ? (
          <div className="flex flex-col gap-2">
            <h3 className={LABEL}>Add a photo or video</h3>
            <PhotoSourceActions
              layout="row"
              className="sm:max-w-xl"
              libraryVariant={assets.length === 0 ? "primary" : "secondary"}
              disabled={sending}
              onChoose={choose}
            />
            <p className={MUTED}>
              New uploads are selected for you once they&apos;re ready.
            </p>
            {upload?.addQueue ? null : ownPicker.inputs}
          </div>
        ) : (
          <p className={MUTED}>
            You can&apos;t upload here. Attach photos or videos already on
            Naba-Lens, or assign this check to a staff member to capture new
            ones.
          </p>
        )}

        <div
          aria-live="polite"
          className="text-body-touch empty:hidden md:text-body-sm"
        >
          {uploadNote ? <p>{uploadNote}</p> : null}
        </div>

        {assets.length > 0 ? (
          <EvidencePicker
            assets={assets}
            selected={selected}
            flagged={flagged}
            maxSelected={maxSelected}
            disabled={sending}
            onToggle={toggle}
          />
        ) : listError ? null : (
          <EmptyState
            inline
            title="No photos or videos to choose yet."
            description={
              canUpload
                ? canAttachLegacy
                  ? "Add one above. Earlier Coverage photos of this amenity show here too."
                  : "Add one above."
                : "Nothing at this venue can be attached yet."
            }
          />
        )}
        {listError ? (
          <Notice
            tone="negative"
            role="alert"
            action={
              <Button
                type="button"
                variant="secondary"
                size="touch"
                onClick={() => void reloadAssets()}
              >
                <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                {UI_TEXT.retry}
              </Button>
            }
          >
            {listError}
          </Notice>
        ) : null}
        <p className={MUTED}>
          {selected.length} selected · up to {maxSelected}
        </p>
        <FieldMessage id={`${ids}-assetIds-error`} error={errors.assetIds} />
      </section>

      {redaction ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-13 cursor-pointer items-start gap-3 rounded-control border border-line-control bg-panel px-4 py-3 text-body-touch has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:min-h-11 md:text-body-sm">
            <input
              type="checkbox"
              checked={redactionConfirmed}
              disabled={sending}
              onChange={(e) => confirmRedaction(e.currentTarget.checked)}
              aria-invalid={errors.redactionConfirmed ? true : undefined}
              aria-describedby={errorId("redactionConfirmed")}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            {UI_TEXT.redactionConfirm}
          </label>
          <FieldMessage
            id={`${ids}-redactionConfirmed-error`}
            error={errors.redactionConfirmed}
          />
        </div>
      ) : null}

      {isWifi && answer === "yes" ? (
        <fieldset className="flex min-w-0 flex-col gap-3" disabled={sending}>
          <legend className={cn(LABEL, "mb-1")}>
            Wi-Fi test{" "}
            <span className="font-normal text-ink-muted">
              (internal, never shown to guests)
            </span>
          </legend>
          <TextInput
            id={`${ids}-wifi-spot`}
            label="Where you tested"
            value={draft.wifi.testSpot}
            maxLength={LIMITS.wifiTestSpot}
            onChange={(e) => setWifi("testSpot", e.currentTarget.value)}
            error={errors["wifi.testSpot"]}
            help="For example “garden, far table”."
          />
          <TextInput
            id={`${ids}-wifi-date`}
            label="Test date"
            type="date"
            max={today}
            value={draft.wifi.testedOn}
            onChange={(e) => setWifi("testedOn", e.currentTarget.value)}
            error={errors["wifi.testedOn"]}
          />
          <div className="grid gap-3 min-[400px]:grid-cols-2">
            <TextInput
              id={`${ids}-wifi-down`}
              label="Download (Mbps)"
              inputMode="decimal"
              value={draft.wifi.downloadMbps}
              onChange={(e) => setWifi("downloadMbps", e.currentTarget.value)}
              error={errors["wifi.downloadMbps"]}
            />
            <TextInput
              id={`${ids}-wifi-up`}
              label="Upload (Mbps)"
              inputMode="decimal"
              value={draft.wifi.uploadMbps}
              onChange={(e) => setWifi("uploadMbps", e.currentTarget.value)}
              error={errors["wifi.uploadMbps"]}
            />
          </div>
        </fieldset>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <OutcomeMessage
          outcome={outcome}
          extra={extraErrors}
          sending={sending}
          online={online}
          onRetry={() => void send()}
          onReload={onReload}
          signInHref={signInHref}
        />
        <Button
          type="submit"
          size="touch"
          disabled={sending}
          aria-busy={sending || undefined}
          className="sm:self-start"
        >
          {sending ? (
            <SpinnerGapIcon
              data-icon="inline-start"
              className="motion-safe:animate-spin"
              aria-hidden
            />
          ) : (
            <PaperPlaneTiltIcon data-icon="inline-start" aria-hidden />
          )}
          {UI_TEXT.submit}
        </Button>
      </div>

      {canUpload && !upload.addQueue ? (
        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          uploader={upload.uploader}
          limits={upload.limits}
          initialFiles={pickedFiles}
          onReady={(assetIds) => arrived.current(assetIds)}
          purpose="amenity"
        />
      ) : null}
    </form>
  )
}

type Arrivals = { selected: Set<string>; waiting: Set<string> }

function newArrivals(): Arrivals {
  return { selected: new Set(), waiting: new Set() }
}

/** "2 new uploads selected. 1 new upload isn't ready yet." */
function arrivalNote({ selected, waiting }: Arrivals): string | null {
  return (
    [
      selected.size
        ? `${selected.size} new ${selected.size === 1 ? "upload" : "uploads"} selected.`
        : null,
      waiting.size
        ? `${waiting.size} new ${waiting.size === 1 ? "upload isn't" : "uploads aren't"} ready yet.`
        : null,
    ]
      .filter(Boolean)
      .join(" ") || null
  )
}

/** Uploads ready after the answer was sent: saved, not in the answer. */
function lateNote(n: number) {
  return n === 1
    ? "1 new upload finished while your answer was sending, so it wasn't added to this check. The upload is saved."
    : `${n} new uploads finished while your answer was sending, so they weren't added to this check. The uploads are saved.`
}

const FIELD_NAMES = new Set<string>([
  "answer",
  "finding",
  "limitations",
  "reason",
  "assetIds",
  "wifi.testSpot",
  "wifi.testedOn",
  "wifi.downloadMbps",
  "wifi.uploadMbps",
  "redactionConfirmed",
])

function OutcomeMessage({
  outcome,
  extra,
  sending,
  online,
  onRetry,
  onReload,
  signInHref,
}: {
  outcome: Outcome | null
  extra: string[]
  sending: boolean
  online: boolean
  onRetry: () => void
  onReload: () => void
  signInHref: string
}) {
  if (!outcome) return null
  switch (outcome.kind) {
    case "sent":
      return (
        <Notice tone="positive" role="status">
          {outcome.replayed
            ? "This finding was already sent. Nothing was recorded twice."
            : "Finding sent. The check is complete."}
        </Notice>
      )
    case "stale":
      return (
        <Notice tone="attention" role="alert">
          Your earlier finding was recorded. This check has changed since, so
          review your answer and send it again.
        </Notice>
      )
    case "retry":
      return (
        <Notice
          tone="negative"
          role="alert"
          title="We couldn't send your finding"
          action={
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={onRetry}
              disabled={sending || !online}
            >
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              {UI_TEXT.retry}
            </Button>
          }
        >
          {online
            ? "Your draft is kept. Check your connection and try again; nothing is recorded twice."
            : "You're offline. We'll try when you're back online. Your draft is kept; nothing is recorded twice."}
        </Notice>
      )
    case "reload":
      return (
        <Notice
          tone="negative"
          role="alert"
          title="This check changed"
          action={
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={onReload}
            >
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              Reload
            </Button>
          }
        >
          Someone updated this check since you opened it, so nothing was sent.
          Reload to see the latest version; your draft is kept.
        </Notice>
      )
    case "sign_in":
      return (
        <Notice
          tone="negative"
          role="alert"
          action={
            <Link
              href={signInHref}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              Sign in
            </Link>
          }
        >
          Your session ended, so nothing was sent. Sign in again; your draft is
          kept on this device.
        </Notice>
      )
    case "failed":
      return (
        <Notice tone="negative" role="alert" title="Nothing was sent">
          <p>{outcome.message}</p>
          {extra.length > 0 ? (
            <ul className="mt-1 list-disc ps-5">
              {extra.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      )
  }
}
