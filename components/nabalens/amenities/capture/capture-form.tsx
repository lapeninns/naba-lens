"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  SpinnerGapIcon,
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
  type EvidenceKind,
  type SubmitInput,
  type SubmitResult,
  type SubmittableAsset,
} from "@/lib/amenities/contract"
import {
  KNOWLEDGE_ANSWERS,
  stateConflictKind,
  type CaptureCheck,
  type FindingKind,
  type KnowledgeAnswer,
  type UnknownPreset,
  type KnowledgeFailure,
  type KnowledgeResult,
  type SaveDraftInput,
  type ServerDraft,
  type SubmitKnowledgeInput,
  type SubmittedFinding,
  type WorkingSlot,
} from "@/lib/knowledge-client/contract"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ReasonField } from "../../coverage/reason-dialog"
import { EmptyState } from "../../empty-state"
import {
  ANSWER_HINT,
  DETAIL_SENT,
  DRAFT_SAVE_COPY,
  DRAFT_SAVED,
  redactionWaitLine,
  KNOWLEDGE_ANSWER_LABEL,
  KNOWLEDGE_FAILURE_COPY,
  captureContextLines,
  dockNote,
  recognitionLine,
  replacedOwnLine,
  SEND_PROGRESS_COPY,
  sentCopy,
  SLOW_SEND_MS,
  UPLOAD_WAIT_COPY,
  type SentCopy,
  type UploadKinds,
} from "../../knowledge/copy"
import {
  checkedOnError,
  newCheckedOn,
  reopenCheckedOn,
} from "../../knowledge/checked-on"
import { CheckedOnField } from "../../knowledge/checked-on-field"
import {
  emptyAccess,
  firstBadMeasurement,
} from "../../knowledge/accessibility-detail"
import { AccessDetailFields } from "../../knowledge/accessibility-detail-fields"
import {
  detailErrorsFor,
  detailFieldErrors,
  detailToSend,
  draftDetail,
  hasDetailErrors,
  NO_DETAIL_ERRORS,
  partsFromDetail,
  partsTouched,
  showsAccess,
  showsFacility,
  type DetailErrors,
  type DetailForm,
} from "../../knowledge/detail-form"
import { emptyFacility } from "../../knowledge/facility-detail"
import { FacilityDetailFields } from "../../knowledge/facility-detail-fields"
import { Notice } from "../../notice"
import { useOnline } from "../../offline-notice"
import {
  PhotoSourceActions,
  usePhotoSource,
  type PhotoSource,
} from "../../photo-source"
import {
  useAddActive,
  type OpenAddOptions,
  type UnfinishedReason,
} from "../../shell/add-context"
import { yesRefusedLine } from "../../shell/entry-copy"
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
import { FieldMessage, LABEL, MUTED } from "./field-parts"
import {
  ChangeReasonField,
  DraftRestoredNotice,
  SelfConfirmFieldset,
  UnknownFields,
} from "./knowledge-fields"
import {
  londonToday,
  missingEvidenceText,
  needsRedactionConfirm,
  validateDraft,
  validateKnowledgeDraft,
  type CaptureErrors,
  type CaptureField,
} from "./validate"

export type AssetsResult = AmenityResult<{ assets: SubmittableAsset[] }>
export type SubmitHandler = (
  input: SubmitInput
) => Promise<AmenityResult<SubmitResult>>

/**
 * The knowledge path for a working-list question: what the screen read about
 * the question, the knowledge submit and server drafts. Without it the form
 * sends through the legacy amenity submit.
 */
export type KnowledgeCapture = {
  venueName: string
  slot: WorkingSlot
  role: "staff" | "manager"
  canSelfConfirm: boolean
  /** Replying to a manager's request for more detail. */
  respondsTo: { decisionId: string; note: string } | null
  submit: (
    input: SubmitKnowledgeInput
  ) => Promise<KnowledgeResult<SubmittedFinding>>
  saveDraft:
    | ((
        input: SaveDraftInput
      ) => Promise<KnowledgeResult<{ draftRevision: number; savedAt: string }>>)
    | null
  onDiscardDraft: (() => Promise<KnowledgeResult<Record<never, never>>>) | null
  serverDraft: ServerDraft | null
  /**
   * "Change my finding" (§4.6): start from my undecided finding's answer.
   * A draft on this device or the account still wins.
   */
  prefill?: {
    answer: KnowledgeAnswer | null
    unknownPreset: UnknownPreset | null
  } | null
  /**
   * B03-b: the question's version has a detail form this build renders
   * (facility or accessibility), with the venue's active places for it.
   */
  detailForm?: DetailForm | null
}

type Outcome =
  | { kind: "retry" }
  | { kind: "reload" }
  | { kind: "sign_in" }
  | { kind: "failed"; message: string }
  | {
      kind: "sent"
      replayed: boolean
      /** Knowledge path: what happened to the finding. */
      copy?: SentCopy
      extra?: string[]
    }
  /** An earlier send was recorded, but the check has changed since. */
  | { kind: "stale" }
  /** The legacy submit refused a working-list question. */
  | { kind: "path_required" }
  /** The question left the working list while the form was open. */
  | { kind: "out_of_scope" }
  /** The server refused a manager's self-confirmation. */
  | { kind: "self_stale" }
  | { kind: "not_permitted" }
  /** Knowledge path: a state conflict, by kind (L4). */
  | {
      kind: "conflict"
      reason: "reused_key" | "archived" | "other"
      message: string
    }
  | { kind: "saved"; offline: boolean }
  | { kind: "save_failed" }
  /** Saved elsewhere since (or sent or discarded there, when `gone`). */
  | { kind: "draft_conflict"; gone: boolean }
  /** The save was refused: this draft's own key was already sent (R11). */
  | { kind: "already_sent" }
  /** The save was refused: I sent a finding on this question since (R11). */
  | { kind: "newer_send"; sentAt: string | null }
  | { kind: "discarded" }
  | { kind: "discard_failed" }
  /** Uploads from this form aren't ready yet: nothing was sent. */
  | { kind: "uploads_pending"; canSendWithout: boolean }
  /** The question changed while the form waited for an upload. */
  | { kind: "wait_conflict" }

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

/** One send's result, legacy or knowledge, as the form handles it. */
type Sent =
  | {
      ok: true
      replayed: boolean
      /** The check (legacy) or slot (knowledge) revision after the send. */
      revision: number
      knowledge?: SubmittedFinding
    }
  | KnowledgeFailure

function fromLegacy(result: AmenityResult<SubmitResult>): Sent {
  return result.ok
    ? { ok: true, replayed: result.replayed, revision: result.revision }
    : result
}

function fromKnowledge(result: KnowledgeResult<SubmittedFinding>): Sent {
  return result.ok
    ? {
        ok: true,
        replayed: result.replayed,
        revision: result.slotRevision,
        knowledge: result,
      }
    : result
}

const inputClass =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"

function isDirty(draft: CaptureDraft): boolean {
  return Boolean(
    draft.answer ||
    draft.finding ||
    draft.limitations ||
    draft.reason ||
    draft.unknownPreset ||
    draft.triedText ||
    draft.changeReason ||
    draft.confirmOwn !== null ||
    draft.assetIds.length ||
    draft.redactionConfirmed ||
    draft.uploadsPending?.count ||
    Object.values(draft.wifi).some(Boolean) ||
    partsTouched(draft) ||
    draft.checkedOn?.source === "chosen"
  )
}

/** What a pick is: photos, videos, or both (or unknown, without the files). */
function kindsOf(files: File[] | undefined): UploadKinds {
  if (!files?.length) return "mixed"
  const videos = files.filter((f) => f.type.startsWith("video/")).length
  return videos === 0 ? "photo" : videos === files.length ? "video" : "mixed"
}

function mergeKinds(a: UploadKinds | null, b: UploadKinds): UploadKinds {
  return a === null || a === b ? b : "mixed"
}

/** The newest upload listed now, as an instant to compare later ones with. */
function newestListed(assets: SubmittableAsset[]): string | null {
  let newest: string | null = null
  for (const a of assets)
    if (newest === null || Date.parse(a.createdAt) > Date.parse(newest))
      newest = a.createdAt
  return newest
}

/** Fields in screen order: a failed check focuses the first invalid one. */
const FIELD_ORDER: CaptureField[] = [
  "changeReason",
  "answer",
  "unknownPreset",
  "triedText",
  "finding",
  "limitations",
  "reason",
  "assetIds",
  "redactionConfirmed",
  "wifi.testSpot",
  "wifi.testedOn",
  "wifi.downloadMbps",
  "wifi.uploadMbps",
  "confirmOwn",
]

/** The id suffix of a field's control, where it isn't the field's name. */
const FIELD_ELEMENT: Partial<Record<CaptureField, string>> = {
  triedText: "unknown-tried",
  redactionConfirmed: "redaction",
  "wifi.testSpot": "wifi-spot",
  "wifi.testedOn": "wifi-date",
  "wifi.downloadMbps": "wifi-down",
  "wifi.uploadMbps": "wifi-up",
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** A server draft as the form's draft, keeping its key and sent revision. */
function fromServerDraft(server: ServerDraft): CaptureDraft {
  const { payload } = server
  const attempted = payload.sentSlotRevision !== null
  return {
    ...emptyDraft(() => server.idempotencyKey, payload.sentSlotRevision),
    attempted,
    answer: payload.answer,
    finding: payload.finding,
    limitations: payload.limitations,
    reason: payload.reason,
    unknownPreset: payload.unknownPreset,
    triedText: payload.triedText,
    changeReason: payload.changeReason,
    sentSlotRevision: payload.sentSlotRevision,
    wifi: { ...payload.wifi },
    assetIds: [...server.assetIds],
    ...(payload.detail ? partsFromDetail(payload.detail) : {}),
    ...(payload.checkedOn ? { checkedOn: payload.checkedOn } : {}),
  }
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
  pageHref,
  knowledge = null,
  newKey = newIdempotencyKey,
  uploadRefused = false,
}: {
  check: CaptureCheck
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
  /** This page, opened again: the form a refused legacy send should use. */
  pageHref?: string
  /** Send through the knowledge path (a working-list question). */
  knowledge?: KnowledgeCapture | null
  newKey?: () => string
  /**
   * A manager account that can't upload (§5.3): with nothing to attach, Yes
   * stays offered and says why it can't be sent.
   */
  uploadRefused?: boolean
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
  const [draft, setDraft] = React.useState<CaptureDraft>(() => ({
    ...emptyDraft(
      newKey,
      knowledge ? knowledge.slot.slotRevision : check.revision
    ),
    ...(knowledge?.prefill ?? {}),
  }))
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
  // B03-b detail forms: detail and Checked on errors, and why a reopened
  // draft's Checked on was cleared.
  const detailForm = knowledge?.detailForm ?? null
  const [detailErrors, setDetailErrors] =
    React.useState<DetailErrors>(NO_DETAIL_ERRORS)
  const [checkedOnErr, setCheckedOnErr] = React.useState<string | undefined>()
  const [checkedOnNotice, setCheckedOnNotice] = React.useState<string | null>(
    null
  )
  const [extraErrors, setExtraErrors] = React.useState<string[]>([])
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)
  const [sending, setSending] = React.useState(false)
  // A send with no reply for SLOW_SEND_MS says so (CA-24).
  const [slowSend, setSlowSend] = React.useState(false)
  // The restored draft's send never had a definite answer (CA-05).
  const [lastSendUnsure, setLastSendUnsure] = React.useState(false)
  // A send that left late uploads out: the form stays locked until the
  // person chooses Done or a deliberate second send with them (CA-09).
  const [afterSend, setAfterSend] = React.useState<{
    draft: CaptureDraft
    missed: string[]
  } | null>(null)
  const doneRef = React.useRef<HTMLButtonElement>(null)
  const stopRef = React.useRef<HTMLButtonElement>(null)
  const evidenceHeadingRef = React.useRef<HTMLHeadingElement>(null)
  const [uploadNote, setUploadNote] = React.useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [pickedFiles, setPickedFiles] = React.useState<File[] | undefined>()
  const sessionEnded = useSessionEndedCatch()
  const slot = knowledge?.slot ?? null
  const findingKind: FindingKind = knowledge?.respondsTo
    ? "detail"
    : slot?.mode === "change"
      ? "change_report"
      : "finding"
  const askConfirmOwn =
    knowledge?.role === "manager" &&
    slot?.requiresConfirmation === true &&
    knowledge.canSelfConfirm
  // The server refused "I confirm it now": only the other choice is left.
  const [ownAllowed, setOwnAllowed] = React.useState(true)
  const selfConfirmRef = React.useRef<HTMLFieldSetElement>(null)
  const serverDraftRevision = React.useRef<number | null>(
    knowledge?.serverDraft?.draftRevision ?? null
  )
  // Which copy was restored: the account's (with its save time) or this
  // phone's (no time: the account time wouldn't describe it, CA-06).
  const [restoredFrom, setRestoredFrom] = React.useState<{
    savedAt: string | null
    nearPurge: boolean
  } | null>(null)
  const pendingSync = React.useRef(false)
  // A save to the account in flight: a send waits for it, so the send's
  // draft removal comes after it on the server (CA-01).
  const saving = React.useRef<Promise<void> | null>(null)
  const [savingNow, setSavingNow] = React.useState(false)
  // A send succeeded: no later save may recreate the draft it removed.
  const sentOk = React.useRef(false)
  // Uploads picked here that aren't ready yet (knowledge evidence must be
  // ready to attach), and whether the person chose to wait for them.
  const [pendingUploads, setPendingUploads] = React.useState(0)
  // Why uploads from here ended in Add without becoming ready (CA-11).
  const unfinishedFrom = React.useRef<UnfinishedReason[]>([])
  const [pendingKinds, setPendingKinds] = React.useState<UploadKinds | null>(
    null
  )
  const [waiting, setWaiting] = React.useState(false)
  // Counts finished asset reads, so the wait re-checks after each (L3).
  const [assetReads, setAssetReads] = React.useState(0)
  const addActive = useAddActive()
  const answerGroupRef = React.useRef<HTMLFieldSetElement>(null)
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
  // A knowledge question is guarded by its slot revision (the check's revision
  // plus its knowledge events), not the check's own.
  const revision = slot ? slot.slotRevision : check.revision
  const serverDraft = knowledge?.serverDraft ?? null
  React.useEffect(() => {
    const stored = loadDraft(owner)
    // This device's draft is the newest; otherwise the account's saved one.
    const fromServer =
      !stored && serverDraft ? fromServerDraft(serverDraft) : null
    // A form's Checked on date from an earlier day is cleared (D-B3-12).
    const saved = stored ?? fromServer
    const reopened = saved?.checkedOn
      ? reopenCheckedOn(saved.checkedOn, londonToday())
      : null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from storage
    setCheckedOnNotice(reopened?.notice ?? null)
    setDraft((current) => {
      const next = reconcileDraft(
        stored ?? fromServer ?? current,
        revision,
        newKey
      )
      return reopened ? { ...next, checkedOn: reopened.value } : next
    })
    setLastSendUnsure(Boolean((stored ?? fromServer)?.attempted))
    // Uploads still saving when the person left: newer unticked ones listed
    // now finished after they went, and aren't attached by themselves.
    const left = stored?.uploadsPending
    if (left && initialAssets.ok) {
      const after = left.after ? Date.parse(left.after) : -Infinity
      const finished = initialAssets.assets.filter(
        (a) =>
          a.source === "own" &&
          !stored.assetIds.includes(a.assetId) &&
          Date.parse(a.createdAt) > after
      ).length
      const n = Math.min(finished, left.count)
      if (n > 0) setUploadNote(finishedNote(n))
    }
    if (stored && isDirty(stored))
      setRestoredFrom({ savedAt: null, nearPurge: false })
    else if (serverDraft)
      setRestoredFrom({
        savedAt: serverDraft.savedAt,
        nearPurge:
          Date.now() - new Date(serverDraft.savedAt).getTime() >=
          80 * 86_400_000,
      })
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- newKey is a stable factory; initialAssets is the page's first read
  }, [owner, revision, serverDraft])

  // This device's copy remembers uploads still saving, for the next visit.
  React.useEffect(() => {
    if (!restored) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the pending count into the stored draft
    setDraft((d) => {
      const current = d.uploadsPending ?? null
      if (pendingUploads === 0)
        return current ? { ...d, uploadsPending: undefined } : d
      if (current?.count === pendingUploads) return d
      return {
        ...d,
        uploadsPending: {
          count: pendingUploads,
          after: current ? current.after : newestListed(assets),
        },
      }
    })
    if (pendingUploads === 0) setPendingKinds(null)
  }, [pendingUploads, assets, restored])

  // The draft-save base (B02 R11): my latest send on this question as the
  // page read it, then this form's own sends. Undefined from an older
  // server: saves go without it, as before.
  const loadedSentAt = knowledge?.slot.mySentAt
  const baseSentAt = React.useRef<string | null | undefined>(loadedSentAt)
  React.useEffect(() => {
    baseSentAt.current = loadedSentAt
  }, [loadedSentAt])
  const saveButtonRef = React.useRef<HTMLButtonElement>(null)

  // A re-read brings the account draft's current revision (CA-02).
  React.useEffect(() => {
    serverDraftRevision.current = serverDraft?.draftRevision ?? null
  }, [serverDraft])

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
    // New input after a send is a new draft that may be saved again.
    sentOk.current = false
    setOutcome((o) => (o?.kind === "sent" ? o : null))
    setDraft((current) => {
      let next = change(current)
      // The form's Checked on date is stamped at the first edit, so a draft
      // reopened later can tell it from a chosen one.
      if (detailForm && next.checkedOn === undefined)
        next = { ...next, checkedOn: newCheckedOn(londonToday()) }
      if (!sameIds(next.assetIds, current.assetIds))
        next = { ...next, redactionConfirmed: false, redactionAssetIds: [] }
      return current.attempted && !sameIntent
        ? {
            ...next,
            attempted: false,
            idempotencyKey: newKey(),
            sentSlotRevision: null,
          }
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
    // The person decided about this upload: it no longer waits to be selected.
    late.current.delete(assetId)
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
        // Listed now: they are selected (or wait as arrivals) from here.
        for (const id of select) late.current.delete(id)
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
        if (mounted.current) setAssetReads((n) => n + 1)
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
      setPendingUploads((n) => n + files.length)
      setPendingKinds((k) => mergeKinds(k, kindsOf(files)))
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
        // A working-list question's evidence picked together is one set.
        subject: knowledge
          ? {
              kind: "question",
              id: knowledge.slot.checkId,
              name: knowledge.slot.question,
            }
          : null,
        onPicked: (files) => {
          if (!mounted.current) return
          arrivals.current = newArrivals()
          unfinishedFrom.current = []
          setPendingUploads((n) => n + (files?.length ?? 0))
          if (files?.length)
            setPendingKinds((k) => mergeKinds(k, kindsOf(files)))
        },
        // Once per upload, as soon as that upload is ready (not when the
        // whole pick settles): each is added to the evidence, never
        // replacing it. False after unmount ("the screen is gone"): Add keeps
        // the upload saved, not attached to this check.
        onReady: (assetIds) => arrived.current(assetIds),
        onUnfinished: (reason) => {
          if (mounted.current) unfinishedFrom.current.push(reason)
        },
      })
    else ownPicker.open(source)
  }

  function onArrived(assetIds: string[]) {
    if (!mounted.current) return false
    setPendingUploads((n) => Math.max(0, n - assetIds.length))
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

  /**
   * Uploads that arrived during the send are selected for the next one. They
   * stay waiting until a reload lists them: if it fails (a session that
   * ended fails it too), the next send still reports them as not added.
   */
  function selectLate() {
    const ids = [...late.current]
    if (ids.length > 0) void reloadAssets(ids)
  }

  async function send({
    ignorePending = false,
    fromWait = false,
  }: { ignorePending?: boolean; fromWait?: boolean } = {}) {
    if (inFlight.current) return
    // A save still on its way finishes first, so this send's removal of the
    // account draft comes after it (CA-01). Another send queued behind the
    // same save may have gone (or succeeded) meanwhile (L-a).
    if (saving.current) {
      await saving.current
      if (inFlight.current || sentOk.current) return
    }
    // Only evidence still listed is sent (a deleted upload drops out).
    const common = {
      draft: { ...draft, assetIds: selected, redactionConfirmed },
      templateKey: entry.key,
      rule,
      kinds,
      checkId: check.id,
      today: londonToday(),
    }
    // A retry, or a replay from another device, resends the revision the
    // first attempt went with, so the request is the same one.
    const sendRevision =
      draft.attempted && draft.sentSlotRevision !== null
        ? draft.sentSlotRevision
        : revision
    const checked = knowledge
      ? validateKnowledgeDraft({
          ...common,
          slotRevision: sendRevision,
          kind: findingKind,
          respondsTo: knowledge.respondsTo?.decisionId ?? null,
          askConfirmOwn,
        })
      : validateDraft({ ...common, revision: check.revision })
    setExtraErrors([])
    // B03-b detail forms: the detail and Checked on, checked here (the
    // database checks them again against the question's version).
    const today = londonToday()
    const checkedOnValue = draft.checkedOn ?? newCheckedOn(today)
    const detailErrs = detailForm
      ? detailErrorsFor(detailForm, draft, draft.answer, {
          venueName: knowledge?.venueName ?? "",
          today,
        })
      : NO_DETAIL_ERRORS
    const checkedOnErrNow =
      detailForm && draft.answer
        ? (checkedOnError(checkedOnValue, today) ?? undefined)
        : undefined
    const detailBad = hasDetailErrors(detailErrs) || Boolean(checkedOnErrNow)
    if (detailForm) {
      setDetailErrors(detailErrs)
      setCheckedOnErr(checkedOnErrNow)
    }
    if (detailForm && checked.ok && !detailBad) {
      const detail = detailToSend(detailForm, draft, draft.answer)
      Object.assign(checked.input, {
        ...(detail ? { detail } : {}),
        observedOn: checkedOnValue.date!,
        observedOnSource: checkedOnValue.source!,
      })
    }
    // Knowledge evidence must be ready to attach: with uploads from this form
    // still saving, nothing is sent until the person waits or goes without.
    const waitable = knowledge !== null && pendingUploads > 0 && !ignorePending
    if (!checked.ok || detailBad) {
      const errs = checked.ok ? {} : checked.errors
      const onlyEvidence =
        !detailBad &&
        Object.entries(errs).every(
          ([field, message]) => !message || field === "assetIds"
        )
      if (!checked.ok && waitable && onlyEvidence) {
        setErrors({})
        setOutcome({ kind: "uploads_pending", canSendWithout: false })
        return
      }
      setErrors(errs)
      setOutcome(null)
      if (Object.values(errs).some(Boolean)) focusFirstInvalid(errs)
      else focusDetailError(detailErrs, checkedOnErrNow)
      return
    }
    if (waitable) {
      setErrors({})
      setOutcome({ kind: "uploads_pending", canSendWithout: true })
      return
    }
    setErrors({})
    inFlight.current = true
    unresolved.current = true
    // The send supersedes a save still waiting for a connection.
    pendingSync.current = false
    setSending(true)
    setOutcome(null)
    const sentDraft: CaptureDraft = {
      ...draft,
      revision,
      assetIds: checked.input.assetIds,
      attempted: true,
      sentSlotRevision: knowledge ? sendRevision : null,
    }
    setDraft(sentDraft)
    // Who and what was sent, even if the page is left before the answer.
    const sentFor = owner
    let result: Sent
    try {
      result = knowledge
        ? fromKnowledge(
            await knowledge.submit(checked.input as SubmitKnowledgeInput)
          )
        : fromLegacy(await submit(checked.input as SubmitInput))
    } catch (cause) {
      // The draft and its key stay, and uploads that arrive meanwhile wait:
      // Try again replays the same answer, never sends twice. Refused for
      // the ended session, it waits for Sign in again instead.
      const ended = sessionEnded(cause)
      // Refused for the ended session: definitely not recorded, so uploads
      // stop waiting for an answer and are selected as usual.
      if (ended) unresolved.current = false
      if (mounted.current) {
        setOutcome(ended ? { kind: "sign_in" } : { kind: "retry" })
        if (ended) selectLate()
      }
      return
    } finally {
      inFlight.current = false
      if (mounted.current) setSending(false)
    }
    // Legacy only: a replay older than the revision on screen means the
    // earlier send was recorded but the check changed since (a manager
    // reopened it), so this answer still has to be sent with a new key. A
    // knowledge replay returns the original slot revision, which any later
    // event outdates: it was sent, with its original outcome (M1).
    if (result.ok || !RETRYABLE.has(result.code as AmenityFailure["code"]))
      unresolved.current = false
    const stale =
      !knowledge && result.ok && result.replayed && result.revision < revision
    // Recorded: drop the stored draft even when the form is gone, or a later
    // visit would replay this key after a reopen.
    if (result.ok && !stale) {
      clearDraft(sentFor)
      // The server removed the account draft with the send (CA-01).
      sentOk.current = true
      // Saves from this form now go after that send (R11).
      if (result.knowledge?.sentAt) baseSentAt.current = result.knowledge.sentAt
    }
    if (!mounted.current) return

    if (stale) {
      setDraft((d) => ({
        ...d,
        attempted: false,
        idempotencyKey: newKey(),
        revision,
        sentSlotRevision: null,
      }))
      setOutcome({ kind: "stale" })
      selectLate()
      return
    }
    if (result.ok) {
      setLastSendUnsure(false)
      setDraft(emptyDraft(newKey, revision))
      setOutcome({
        kind: "sent",
        replayed: result.replayed,
        ...(result.knowledge
          ? knowledgeSent(
              result.knowledge,
              checked.input as SubmitKnowledgeInput
            )
          : {}),
      })
      const sentIds = new Set(checked.input.assetIds)
      const missed = [...late.current].filter((id) => !sentIds.has(id))
      late.current.clear()
      // Stay, locked, so the person learns those uploads are not in the
      // answer, and sending them is a deliberate second send (CA-09).
      if (missed.length > 0) {
        setUploadNote(lateNote(missed.length))
        setAfterSend({ draft: sentDraft, missed })
        requestAnimationFrame(() => doneRef.current?.focus())
        return
      }
      onDone()
      return
    }
    if (fromWait && result.code === "revision_conflict") {
      setDraft((d) => ({
        ...d,
        attempted: false,
        idempotencyKey: newKey(),
        sentSlotRevision: null,
      }))
      setOutcome({ kind: "wait_conflict" })
      return
    }
    failed(result)
    if (!unresolved.current) selectLate()
  }

  function startWaiting() {
    setOutcome(null)
    setWaiting(true)
    // Wait for it goes with its notice: the next control is Stop (CA-17).
    requestAnimationFrame(() => stopRef.current?.focus())
  }

  /**
   * A deliberate second send after late uploads were left out (CA-09): the
   * answer just sent, as a new finding with a new key, with those uploads
   * selected once they are listed.
   */
  function sendAgainWithLate() {
    if (!afterSend) return
    const { draft: was, missed } = afterSend
    setAfterSend(null)
    setUploadNote(null)
    setOutcome(null)
    sentOk.current = false
    setDraft({
      ...was,
      idempotencyKey: newKey(),
      attempted: false,
      revision,
      sentSlotRevision: null,
      redactionConfirmed: false,
      redactionAssetIds: [],
    })
    void reloadAssets(missed)
    requestAnimationFrame(() =>
      answerGroupRef.current?.querySelector<HTMLInputElement>("input")?.focus()
    )
  }

  /** Focus the first invalid control; its message is in its description. */
  /**
   * The first invalid detail control: Checked on, else the accessibility
   * section's, else the facility field.
   */
  function focusDetailError(errs: DetailErrors, checkedOn: string | undefined) {
    requestAnimationFrame(() => {
      if (checkedOn) {
        document.getElementById(`${ids}-checked-on`)?.focus()
        return
      }
      const access = accessTarget(errs.access)
      if (access) {
        access.focus()
        return
      }
      const facilityErrs = errs.facility
      const field = (
        [
          "locations",
          "availability",
          "fees",
          "limitations",
          "howToRequest",
        ] as const
      ).find((f) => facilityErrs[f])
      const target =
        field === "locations"
          ? document.getElementById(`${ids}-facility-label`)
          : field === "availability"
            ? (document.getElementsByName(`${ids}-facility-availability`)[0] as
                HTMLElement | undefined)
            : field === "fees"
              ? (document.getElementById(`${ids}-facility-amount`) ??
                (document.getElementsByName(`${ids}-facility-fees`)[0] as
                  HTMLElement | undefined))
              : field
                ? document.getElementById(`${ids}-facility-${field}`)
                : null
      target?.focus()
    })
  }

  /** The accessibility control an error belongs to, in screen order. */
  function accessTarget(errs: DetailErrors["access"]): HTMLElement | null {
    const first = (prefix: string) =>
      document.querySelector<HTMLElement>(
        `input[name^="${ids}-access-${prefix}"]`
      )
    if (errs.entrances) return first("entrance-")
    if (errs.scope) {
      const typed = document.getElementById(`${ids}-access-scope-label`)
      return typed ?? first("scope")
    }
    if (errs.features) return first("feature-")
    if (errs.measurements) {
      const bad = firstBadMeasurement(
        draft.access ?? emptyAccess(),
        londonToday()
      )
      return (
        (bad &&
          document.getElementById(`${ids}-access-m${bad.index}-${bad.part}`)) ||
        document.getElementById(`${ids}-access-m0-feature`)
      )
    }
    return null
  }

  function focusFirstInvalid(errs: CaptureErrors) {
    const field = FIELD_ORDER.find((name) => errs[name])
    if (!field) return
    requestAnimationFrame(() => {
      const byId = (suffix: string) =>
        document.getElementById(`${ids}-${suffix}`)
      const firstInput = (root: Element | null | undefined) =>
        root?.querySelector<HTMLElement>("input:not(:disabled)") ?? null
      const target: HTMLElement | null =
        field === "answer"
          ? firstInput(answerGroupRef.current)
          : field === "confirmOwn"
            ? firstInput(selfConfirmRef.current)
            : field === "unknownPreset"
              ? firstInput(byId("unknown-preset-group"))
              : field === "assetIds"
                ? (evidenceHeadingRef.current?.parentElement?.querySelector<HTMLElement>(
                    'input[type="checkbox"]:not(:disabled)'
                  ) ?? evidenceHeadingRef.current)
                : byId(FIELD_ELEMENT[field] ?? field)
      target?.focus()
    })
  }

  function stopWaiting() {
    setWaiting(false)
    setOutcome(null)
    requestAnimationFrame(() =>
      answerGroupRef.current?.querySelector<HTMLInputElement>("input")?.focus()
    )
  }

  /** What the knowledge path reports, in the person's words. */
  function knowledgeSent(
    sent: SubmittedFinding,
    input: SubmitKnowledgeInput
  ): { copy: SentCopy; extra: string[] } {
    const inUse = slot?.answerInUse.value ?? null
    const copy =
      input.kind === "detail"
        ? DETAIL_SENT
        : sentCopy({
            outcome: sent.outcome,
            answer: input.answer,
            compared: inUse
              ? inUse === input.answer
                ? "same"
                : "differs"
              : "none",
            changeReport: input.kind === "change_report",
            selfConfirmed:
              input.confirmOwn === true && sent.outcome === "current",
            leftForOthers: input.confirmOwn === false,
          })
    const recognition = recognitionLine(sent.recognition, input.answer)
    return {
      copy,
      extra: [
        ...(sent.replacedOwn ? [replacedOwnLine(sent.replacedOwn.sentAt)] : []),
        ...(recognition ? [recognition] : []),
      ],
    }
  }

  function failed(result: KnowledgeFailure) {
    if (RETRYABLE.has(result.code as AmenityFailure["code"])) {
      setOutcome({ kind: "retry" })
      return
    }
    // Nothing was recorded: the next send is a new intent with a new key.
    setDraft((d) => ({
      ...d,
      attempted: false,
      idempotencyKey: newKey(),
      sentSlotRevision: null,
    }))
    switch (result.code) {
      case "knowledge_path_required":
        setOutcome({ kind: "path_required" })
        return
      case "knowledge_slot_out_of_scope":
        setOutcome({ kind: "out_of_scope" })
        return
      case "self_confirmation_not_permitted":
        setOwnAllowed(false)
        setDraft((d) => ({ ...d, confirmOwn: null }))
        setOutcome({ kind: "self_stale" })
        requestAnimationFrame(() => selfConfirmRef.current?.focus())
        return
      case "not_permitted":
        if (knowledge) {
          setOutcome({ kind: "not_permitted" })
          return
        }
        break
      case "state_conflict":
        if (knowledge) {
          setOutcome({
            kind: "conflict",
            reason: stateConflictKind(result) ?? "other",
            message: result.message,
          })
          return
        }
        break
    }
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
      // B03-b: detail paths and the observation date go to their fields.
      const detailErrs = detailFieldErrors(result.fieldErrors)
      if (hasDetailErrors(detailErrs)) setDetailErrors(detailErrs)
      const observed =
        result.fieldErrors.observedOn ?? result.fieldErrors.observedOnSource
      if (observed) setCheckedOnErr(observed)
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        if (!message) continue
        if (field.startsWith("detail.") || field.startsWith("observedOn"))
          continue
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

  /**
   * Save for later: the draft as it is, answer or not, to the account (the
   * device keeps its copy regardless). Offline it stays on this phone and is
   * saved to the account once the browser is back online.
   */
  async function saveForLater(fromSync = false) {
    if (
      !knowledge?.saveDraft ||
      inFlight.current ||
      saving.current ||
      sentOk.current
    )
      return
    if (!navigator.onLine) {
      pendingSync.current = true
      setOutcome({ kind: "saved", offline: true })
      return
    }
    pendingSync.current = false
    const run = saveToAccount(fromSync)
    saving.current = run
    setSavingNow(true)
    try {
      await run
    } finally {
      saving.current = null
      if (mounted.current) setSavingNow(false)
    }
  }

  async function saveToAccount(fromSync: boolean) {
    if (!knowledge?.saveDraft) return
    let result: KnowledgeResult<{ draftRevision: number; savedAt: string }>
    try {
      result = await knowledge.saveDraft({
        checkId: check.id,
        draftRevision: serverDraftRevision.current,
        payload: {
          answer: draft.answer,
          finding: draft.finding,
          limitations: draft.limitations,
          reason: draft.reason,
          unknownPreset: draft.unknownPreset,
          triedText: draft.triedText,
          changeReason: draft.changeReason,
          wifi: { ...draft.wifi },
          sentSlotRevision: draft.attempted ? draft.sentSlotRevision : null,
          ...(detailForm
            ? {
                detail: draftDetail(detailForm, draft),
                checkedOn: draft.checkedOn ?? null,
              }
            : {}),
        },
        assetIds: selected,
        idempotencyKey: draft.idempotencyKey,
        ...(baseSentAt.current === undefined
          ? {}
          : { baseSentAt: baseSentAt.current }),
      })
    } catch (cause) {
      if (sessionEnded(cause)) {
        if (mounted.current) setOutcome({ kind: "sign_in" })
        return
      }
      pendingSync.current = true
      if (mounted.current) setOutcome({ kind: "save_failed" })
      return
    }
    // A send that succeeded meanwhile removed the draft: ignore this answer.
    if (!mounted.current || sentOk.current) return
    if (result.ok) {
      serverDraftRevision.current = result.draftRevision
      // After an offline save, say it reached the account (X-04).
      setOutcome((current) =>
        !fromSync || current?.kind === "saved"
          ? { kind: "saved", offline: false }
          : current
      )
      return
    }
    if (result.code === "draft_already_sent") {
      draftAlreadySent(result)
      return
    }
    if (result.code === "draft_conflict") {
      // Take the revision now stored, so the next save goes through rather
      // than conflicting until a reload (CA-02).
      const stored = result.draftRevision ?? null
      serverDraftRevision.current = stored
      setOutcome({ kind: "draft_conflict", gone: stored === null })
      return
    }
    if (result.code === "knowledge_slot_out_of_scope") {
      setOutcome({ kind: "out_of_scope" })
      return
    }
    setOutcome({ kind: "save_failed" })
  }

  /**
   * A save refused because the work was already sent (R11). Never says where
   * it was sent from: the send may have been from this phone.
   */
  function draftAlreadySent(result: KnowledgeFailure) {
    const sentAt = result.sentAt ?? null
    if (result.sentReason === "newer_send") {
      setOutcome({ kind: "newer_send", sentAt })
      return
    }
    // This draft's own key was sent: its copy on this phone goes, and the
    // form starts a new draft after that send.
    if (sentAt) baseSentAt.current = sentAt
    clearDraft(owner)
    serverDraftRevision.current = null
    setRestoredFrom(null)
    setLastSendUnsure(false)
    setDraft(emptyDraft(newKey, revision))
    setOutcome({ kind: "already_sent" })
  }

  /**
   * Start a new draft after a newer send: the old draft's phone copy goes,
   * what is on screen becomes the new draft (a new key, nothing typed is
   * lost), and saves go after that send from now on.
   */
  function startNewDraft(sentAt: string | null) {
    if (sentAt) baseSentAt.current = sentAt
    clearDraft(owner)
    serverDraftRevision.current = null
    setRestoredFrom(null)
    setLastSendUnsure(false)
    setDraft((d) => ({
      ...d,
      idempotencyKey: newKey(),
      attempted: false,
      sentSlotRevision: null,
    }))
    setOutcome(null)
    // The notice that held the action is gone: Save for later is next.
    requestAnimationFrame(() => saveButtonRef.current?.focus())
  }

  async function discardServerDraft() {
    // The account copy first: if it can't be discarded, nothing is cleared
    // and the person is told, rather than it coming back later (CA-07).
    if (knowledge?.onDiscardDraft) {
      let ok = false
      try {
        ok = (await knowledge.onDiscardDraft()).ok
      } catch (cause) {
        if (sessionEnded(cause)) {
          if (mounted.current) setOutcome({ kind: "sign_in" })
          return
        }
      }
      if (!mounted.current) return
      if (!ok) {
        setOutcome({ kind: "discard_failed" })
        return
      }
    }
    clearDraft(owner)
    setDraft(emptyDraft(newKey, revision))
    setRestoredFrom(null)
    serverDraftRevision.current = null
    setOutcome({ kind: "discarded" })
    // The notice that held the button is gone: start at the answers (CA-16).
    requestAnimationFrame(() =>
      answerGroupRef.current?.querySelector<HTMLInputElement>("input")?.focus()
    )
  }

  // Offline, Try again would only fail again. The unresolved send waits and
  // goes again by itself once the browser is back online: the same replay
  // as Try again (same key and revision; late uploads still wait).
  const online = useOnline()
  const sendRef = React.useRef(send)
  React.useLayoutEffect(() => {
    sendRef.current = send
  })
  const saveRef = React.useRef(saveForLater)
  React.useLayoutEffect(() => {
    saveRef.current = saveForLater
  })
  const wasOnline = React.useRef(online)
  React.useEffect(() => {
    const back = online && !wasOnline.current
    wasOnline.current = online
    if (back && outcome?.kind === "retry" && !inFlight.current) {
      // The send goes; a save waiting too would only recreate the draft the
      // send removes (CA-01).
      pendingSync.current = false
      void sendRef.current()
      return
    }
    if (back && pendingSync.current) void saveRef.current(true)
  }, [online, outcome])

  // Waiting: once every upload from here is ready (and listed), send by
  // itself, with the same key (nothing was attempted while waiting).
  // A failed read ends the wait with its error: the uploads can't be listed,
  // so nothing is sent without them.
  React.useEffect(() => {
    if (!waiting || pendingUploads > 0 || loadingAssets.current) return
    setWaiting(false)
    if (listError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the wait ends on an asset read finishing
      setOutcome({
        kind: "failed",
        message: `${listError} Nothing was sent. Try again when your photos and videos load.`,
      })
      return
    }
    void sendRef.current({ fromWait: true })
  }, [waiting, pendingUploads, draft.assetIds, assetReads, listError])

  // The Add queue has nothing in progress, yet uploads from here never became
  // ready: they failed or stopped. Give the last ready answer a moment first.
  React.useEffect(() => {
    if (addActive !== 0 || pendingUploads === 0) return
    const timer = window.setTimeout(() => {
      // Add said why for every one of them, and the same: name it (CA-11).
      const reasons = unfinishedFrom.current.splice(0)
      const reason =
        reasons.length === pendingUploads &&
        reasons.every((r) => r === reasons[0])
          ? reasons[0]
          : null
      const message = reason
        ? UPLOAD_WAIT_COPY.unfinished(
            pendingUploads,
            pendingKinds ?? "mixed",
            reason
          )
        : UPLOAD_WAIT_COPY.failed(pendingUploads, pendingKinds ?? "mixed")
      setPendingUploads(0)
      setUploadNote(message)
      if (waiting) {
        setWaiting(false)
        setOutcome({ kind: "failed", message })
      }
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [addActive, pendingUploads, pendingKinds, waiting])

  // Slow is said, not hidden: after SLOW_SEND_MS without a reply (CA-24).
  React.useEffect(() => {
    if (!sending) return
    const timer = window.setTimeout(() => setSlowSend(true), SLOW_SEND_MS)
    return () => {
      window.clearTimeout(timer)
      setSlowSend(false)
    }
  }, [sending])

  // The rule line changes with every answer and tick; only a change of "met"
  // is announced (CA-18).
  const [ruleAnnouncement, setRuleAnnouncement] = React.useState("")
  const lastRuleMet = React.useRef(ruleMet)
  React.useEffect(() => {
    if (lastRuleMet.current === ruleMet) return
    lastRuleMet.current = ruleMet
    setRuleAnnouncement(
      ruleMet
        ? `Evidence rule met: ${EVIDENCE_RULE_LABEL[rule]}.`
        : `Evidence rule not met: ${EVIDENCE_RULE_LABEL[rule]}.`
    )
  }, [ruleMet, rule])

  const errorId = (field: CaptureField) =>
    errors[field] ? `${ids}-${field}-error` : undefined

  const answer = draft.answer
  // Read-only while sending, while waiting for uploads to send by itself, and
  // after a send that left late uploads out.
  const locked = sending || waiting || afterSend !== null
  // Submit and Save keep focus while busy: aria-disabled with a guard, never
  // `disabled`, which drops focus to the page (CA-14).
  const submitBlocked = locked || savingNow
  const waitKinds = pendingKinds ?? "photo"
  const unsure = lastSendUnsure && draft.attempted && !outcome && !sending
  const missing = missingEvidenceText(rule, kinds)
  const canUpload = upload !== null
  const yesRefused =
    uploadRefused && !canUpload && assets.length === 0 && !listError
      ? yesRefusedLine(rule)
      : null
  const today = londonToday()

  return (
    <form
      noValidate
      aria-label={`Capture: ${entry.question}`}
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (submitBlocked) return
        void send()
      }}
    >
      {knowledge && slot ? (
        <Notice tone="plain" role="note">
          {captureContextLines({
            venueName: knowledge.venueName,
            slot,
            role: knowledge.role,
            canSelfConfirm: knowledge.canSelfConfirm,
          }).map((line) => (
            <p key={line} className="[overflow-wrap:anywhere]">
              {line}
            </p>
          ))}
        </Notice>
      ) : null}
      {knowledge?.respondsTo ? (
        <Notice
          tone="attention"
          role="note"
          title="Your manager asked for more detail"
        >
          <span className="break-words">{knowledge.respondsTo.note}</span>
        </Notice>
      ) : null}
      {knowledge && restoredFrom ? (
        <DraftRestoredNotice
          savedAt={restoredFrom.savedAt}
          nearPurge={restoredFrom.nearPurge}
          attempted={unsure}
          onDiscard={discardServerDraft}
          disabled={locked}
        />
      ) : unsure ? (
        <Notice tone="attention" role="note">
          {SEND_PROGRESS_COPY.lastSendUnsure}
        </Notice>
      ) : null}
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
          title={
            // A qualified answer's reason comes from the server, not a manager.
            check.qualification
              ? "This answer needs checking"
              : "Your manager asked for a recheck"
          }
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

      {knowledge && findingKind === "change_report" ? (
        <ChangeReasonField
          id={`${ids}-changeReason`}
          value={draft.changeReason}
          onChange={(value) => setField("changeReason", value)}
          error={errors.changeReason}
          disabled={locked}
        />
      ) : null}

      <fieldset
        ref={answerGroupRef}
        className="flex min-w-0 flex-col gap-2"
        aria-describedby={errorId("answer")}
        disabled={locked}
      >
        <legend className={cn(LABEL, "mb-2")}>{entry.question}</legend>
        {knowledge ? (
          <div className="grid gap-2 min-[360px]:grid-cols-2 sm:grid-cols-4">
            {KNOWLEDGE_ANSWERS.map((option: KnowledgeAnswer) => (
              <label
                key={option}
                className="flex min-h-13 cursor-pointer items-start gap-3 rounded-control border border-line-control bg-panel px-4 py-3 text-label-touch text-ink has-checked:border-ink has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:min-h-11 md:text-label"
              >
                <input
                  type="radio"
                  name={`${ids}-answer`}
                  value={option}
                  checked={answer === option}
                  onChange={() => setField("answer", option)}
                  aria-labelledby={`${ids}-answer-${option}`}
                  aria-describedby={`${ids}-answer-${option}-hint`}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span className="grid gap-0.5">
                  <span id={`${ids}-answer-${option}`}>
                    {KNOWLEDGE_ANSWER_LABEL[option]}
                  </span>
                  <span
                    id={`${ids}-answer-${option}-hint`}
                    className="text-meta-touch font-normal text-ink-muted md:text-meta"
                  >
                    {option === "yes" && yesRefused
                      ? yesRefused
                      : ANSWER_HINT[option]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
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
        )}
        {yesRefused && !knowledge ? (
          <p className={MUTED}>{yesRefused}</p>
        ) : null}
        <FieldMessage id={`${ids}-answer-error`} error={errors.answer} />
      </fieldset>

      {knowledge && answer === "unknown" ? (
        <UnknownFields
          id={`${ids}-unknown`}
          preset={draft.unknownPreset}
          tried={draft.triedText}
          onPreset={(value) => setField("unknownPreset", value)}
          onTried={(value) => setField("triedText", value)}
          presetError={errors.unknownPreset}
          triedError={errors.triedText}
          disabled={locked}
        />
      ) : null}

      {detailForm?.schema === "accessibility" &&
      showsAccess(detailForm, answer) ? (
        <AccessDetailFields
          id={`${ids}-access`}
          value={draft.access ?? emptyAccess()}
          onChange={(next) => {
            edit((d) => ({ ...d, access: next }))
            setDetailErrors((e) => ({ ...e, access: {} }))
          }}
          answer={answer}
          stepFree={detailForm.stepFree}
          places={detailForm.places}
          features={detailForm.features}
          venueName={knowledge?.venueName ?? ""}
          canManagePlaces={detailForm.canManagePlaces}
          errors={detailErrors.access}
          today={londonToday()}
          disabled={locked}
        />
      ) : null}
      {detailForm && showsFacility(detailForm, answer) ? (
        <FacilityDetailFields
          id={`${ids}-facility`}
          value={draft.facility ?? emptyFacility()}
          onChange={(next) => {
            edit((d) => ({ ...d, facility: next }))
            setDetailErrors((e) => ({ ...e, facility: {} }))
          }}
          places={detailForm.places}
          venueName={knowledge?.venueName ?? ""}
          errors={detailErrors.facility}
          showWhere={detailForm.schema === "facility"}
          disabled={locked}
        />
      ) : null}
      {detailForm && answer ? (
        <CheckedOnField
          id={`${ids}-checked-on`}
          value={draft.checkedOn ?? newCheckedOn(londonToday())}
          today={londonToday()}
          onChange={(next) => {
            edit((d) => ({ ...d, checkedOn: next }))
            setCheckedOnErr(undefined)
            setCheckedOnNotice(null)
          }}
          error={checkedOnErr}
          notice={checkedOnNotice}
          disabled={locked}
        />
      ) : null}

      <ReasonField
        id={`${ids}-finding`}
        label="What you found"
        required={false}
        value={draft.finding}
        onChange={(value) => setField("finding", value)}
        maxLength={LIMITS.finding}
        help="What a guest would find, in plain words."
        error={errors.finding}
        disabled={locked}
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
        disabled={locked}
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
          disabled={locked}
        />
      ) : null}

      <section
        aria-labelledby={`${ids}-evidence`}
        className="flex min-w-0 flex-col gap-3"
      >
        <h2
          ref={evidenceHeadingRef}
          id={`${ids}-evidence`}
          tabIndex={-1}
          aria-describedby={errorId("assetIds")}
          className="font-display text-section-title-touch text-ink outline-none md:text-section-title"
        >
          Evidence
        </h2>
        <p aria-live="polite" className="sr-only">
          {ruleAnnouncement}
        </p>
        <p
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
              : knowledge
                ? `Needed for Yes: ${EVIDENCE_RULE_LABEL[rule]}. Optional for the other answers.`
                : `Needed for Yes: ${EVIDENCE_RULE_LABEL[rule]}. Optional for No and Not applicable.`}
        </p>

        {canUpload ? (
          <div className="flex flex-col gap-2">
            <h3 className={LABEL}>Add a photo or video</h3>
            <PhotoSourceActions
              layout="row"
              className="sm:max-w-xl"
              // Submit is the screen's only primary (CA-23).
              libraryVariant="secondary"
              disabled={locked}
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
            disabled={locked}
            describedBy={errorId("assetIds")}
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
              id={`${ids}-redaction`}
              type="checkbox"
              checked={redactionConfirmed}
              // A photo still saving changes the set the tick vouches for
              // when it arrives, which clears it: it waits for the photo.
              disabled={locked || pendingUploads > 0}
              onChange={(e) => confirmRedaction(e.currentTarget.checked)}
              aria-invalid={errors.redactionConfirmed ? true : undefined}
              aria-describedby={
                [
                  pendingUploads > 0 ? `${ids}-redaction-wait` : null,
                  errorId("redactionConfirmed") ?? null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            {UI_TEXT.redactionConfirm}
          </label>
          {pendingUploads > 0 ? (
            <p id={`${ids}-redaction-wait`} className={MUTED}>
              {redactionWaitLine(pendingUploads, waitKinds)}
            </p>
          ) : null}
          <FieldMessage
            id={`${ids}-redactionConfirmed-error`}
            error={errors.redactionConfirmed}
          />
        </div>
      ) : null}

      {isWifi && answer === "yes" ? (
        <fieldset className="flex min-w-0 flex-col gap-3" disabled={locked}>
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

      {askConfirmOwn ? (
        <SelfConfirmFieldset
          ref={selfConfirmRef}
          id={`${ids}-confirmOwn`}
          value={draft.confirmOwn}
          onChange={(value) => setField("confirmOwn", value)}
          ownAllowed={ownAllowed}
          error={errors.confirmOwn}
          disabled={locked}
        />
      ) : null}

      {/* Notices sit in the page flow; only the buttons stay sticky, so a
          notice never covers the fields it is about on a phone (CA-22). */}
      {waiting || outcome?.kind === "uploads_pending" ? (
        <UploadWait
          waiting={waiting}
          count={pendingUploads}
          kinds={waitKinds}
          online={online}
          canSendWithout={
            outcome?.kind === "uploads_pending" && outcome.canSendWithout
          }
          yesNeeds={answer === "yes" ? EVIDENCE_RULE_LABEL[rule] : null}
          stopRef={stopRef}
          onWait={startWaiting}
          onSendWithout={() => void send({ ignorePending: true })}
          onStop={stopWaiting}
        />
      ) : null}
      {sending && slowSend ? (
        <Notice tone="info" role="status">
          {SEND_PROGRESS_COPY.slow}
        </Notice>
      ) : null}
      <OutcomeMessage
        outcome={outcome}
        extra={extraErrors}
        sending={sending}
        online={online}
        onRetry={() => void send()}
        onStartNewDraft={startNewDraft}
        onReload={onReload}
        signInHref={signInHref}
        pageHref={pageHref}
        venueName={knowledge?.venueName ?? null}
      />
      {knowledge && slot && dockNote(slot, knowledge.role) ? (
        <p className={MUTED}>{dockNote(slot, knowledge.role)}</p>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {afterSend ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={sendAgainWithLate}
            >
              {afterSend.missed.length === 1
                ? "Send again with the new photo"
                : "Send again with the new photos"}
            </Button>
            <Button
              ref={doneRef}
              type="button"
              size="touch"
              className="sm:self-start"
              onClick={onDone}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            {knowledge?.saveDraft ? (
              <Button
                ref={saveButtonRef}
                type="button"
                variant="secondary"
                size="touch"
                aria-disabled={submitBlocked || undefined}
                aria-busy={savingNow || undefined}
                onClick={() => {
                  if (!submitBlocked) void saveForLater()
                }}
              >
                {savingNow ? "Saving…" : "Save for later"}
              </Button>
            ) : null}
            <Button
              type="submit"
              size="touch"
              aria-disabled={submitBlocked || undefined}
              aria-busy={sending || waiting || undefined}
              className="sm:self-start"
            >
              {sending || waiting ? (
                <SpinnerGapIcon
                  data-icon="inline-start"
                  className="motion-safe:animate-spin"
                  aria-hidden
                />
              ) : (
                <PaperPlaneTiltIcon data-icon="inline-start" aria-hidden />
              )}
              {waiting
                ? UPLOAD_WAIT_COPY.primary(pendingUploads, waitKinds)
                : sending
                  ? SEND_PROGRESS_COPY.sending
                  : !knowledge
                    ? UI_TEXT.submit
                    : findingKind === "detail"
                      ? "Send detail"
                      : findingKind === "change_report"
                        ? "Send change report"
                        : askConfirmOwn && draft.confirmOwn === true
                          ? "Submit and confirm"
                          : UI_TEXT.submit}
            </Button>
          </div>
        )}
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

/** Uploads that finished after the person left the form (CA-10). */
function finishedNote(n: number) {
  return n === 1
    ? "1 upload finished after you left; tick it to add it."
    : `${n} uploads finished after you left; tick them to add them.`
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

/** Uploads from this form aren't ready: wait for them, or send without them. */
function UploadWait({
  waiting,
  count,
  kinds,
  online,
  canSendWithout,
  yesNeeds,
  stopRef,
  onWait,
  onSendWithout,
  onStop,
}: {
  waiting: boolean
  count: number
  kinds: UploadKinds
  online: boolean
  canSendWithout: boolean
  /** The evidence rule, in words, when only the unready uploads meet it. */
  yesNeeds: string | null
  stopRef: React.Ref<HTMLButtonElement>
  onWait: () => void
  onSendWithout: () => void
  onStop: () => void
}) {
  const n = Math.max(count, 1)
  if (waiting)
    return (
      <Notice
        tone="info"
        role="status"
        action={
          <Button
            ref={stopRef}
            type="button"
            variant="quiet"
            size="touch"
            onClick={onStop}
          >
            {UPLOAD_WAIT_COPY.stop}
          </Button>
        }
      >
        <p>{UPLOAD_WAIT_COPY.waiting(n, kinds)}</p>
        {online ? null : <p>{UPLOAD_WAIT_COPY.offline(n, kinds)}</p>}
      </Notice>
    )
  return (
    <Notice
      tone="info"
      role="status"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={onWait}
          >
            {UPLOAD_WAIT_COPY.waitFor(n)}
          </Button>
          {canSendWithout ? (
            <Button
              type="button"
              variant="quiet"
              size="touch"
              onClick={onSendWithout}
            >
              {UPLOAD_WAIT_COPY.sendWithout(n)}
            </Button>
          ) : null}
        </div>
      }
    >
      <p>
        {canSendWithout || !yesNeeds
          ? UPLOAD_WAIT_COPY.pending(n, kinds)
          : UPLOAD_WAIT_COPY.yesNeeds(yesNeeds, n, kinds)}
      </p>
      {online ? null : <p>{UPLOAD_WAIT_COPY.offline(n, kinds)}</p>}
    </Notice>
  )
}

function OutcomeMessage({
  outcome,
  extra,
  sending,
  online,
  onRetry,
  onStartNewDraft,
  onReload,
  signInHref,
  pageHref,
  venueName,
}: {
  outcome: Outcome | null
  extra: string[]
  sending: boolean
  online: boolean
  onRetry: () => void
  onStartNewDraft: (sentAt: string | null) => void
  onReload: () => void
  signInHref: string
  pageHref?: string
  venueName: string | null
}) {
  if (!outcome) return null
  const reload = (label = "Reload") => (
    <Button type="button" variant="secondary" size="touch" onClick={onReload}>
      <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
      {label}
    </Button>
  )
  switch (outcome.kind) {
    case "sent":
      if (outcome.copy)
        return (
          <Notice
            tone={outcome.copy.tone === "plain" ? "plain" : outcome.copy.tone}
            role="status"
          >
            <p>
              {outcome.replayed
                ? "This finding was already sent. Nothing was recorded twice."
                : outcome.copy.status}
            </p>
            {outcome.extra?.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Notice>
        )
      return (
        <Notice tone="positive" role="status">
          {outcome.replayed
            ? "This finding was already sent. Nothing was recorded twice."
            : "Finding sent. The check is complete."}
        </Notice>
      )
    case "path_required":
      // A plain navigation: the server then renders the knowledge form. A
      // retry of the legacy call could only be refused again.
      return (
        <Notice
          tone="negative"
          role="alert"
          title={KNOWLEDGE_FAILURE_COPY.pathRequired.title}
          action={
            <a
              href={pageHref ?? ""}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              {KNOWLEDGE_FAILURE_COPY.pathRequired.action}
            </a>
          }
        >
          {KNOWLEDGE_FAILURE_COPY.pathRequired.body}
        </Notice>
      )
    case "out_of_scope": {
      const copy = KNOWLEDGE_FAILURE_COPY.outOfScope(venueName ?? "the venue")
      return (
        <Notice
          tone="negative"
          role="alert"
          title={copy.title}
          action={reload(copy.action)}
        >
          {copy.body}
        </Notice>
      )
    }
    case "self_stale":
      return (
        <Notice
          tone="negative"
          role="alert"
          title={KNOWLEDGE_FAILURE_COPY.selfConfirmStale.title}
        >
          {KNOWLEDGE_FAILURE_COPY.selfConfirmStale.body}
        </Notice>
      )
    case "not_permitted":
      return (
        <Notice tone="negative" role="alert" action={reload()}>
          {KNOWLEDGE_FAILURE_COPY.notPermitted}
        </Notice>
      )
    case "conflict":
      return (
        <Notice tone="negative" role="alert" action={reload()}>
          {outcome.reason === "reused_key"
            ? KNOWLEDGE_FAILURE_COPY.reusedKey
            : outcome.reason === "archived"
              ? KNOWLEDGE_FAILURE_COPY.archived
              : outcome.message || KNOWLEDGE_FAILURE_COPY.conflict}
        </Notice>
      )
    case "saved":
      return (
        <Notice tone="plain" role="status">
          {outcome.offline
            ? "Saved on this phone. It's saved to your account when you're back online with this page open."
            : DRAFT_SAVED.status}
        </Notice>
      )
    case "save_failed":
      return (
        <Notice tone="negative" role="alert">
          We couldn&apos;t save your draft to your account. It&apos;s kept on
          this phone; try again.
        </Notice>
      )
    case "uploads_pending":
      return null
    case "wait_conflict":
      return (
        <Notice
          tone="negative"
          role="alert"
          title={KNOWLEDGE_FAILURE_COPY.waitConflict.title}
          action={reload(KNOWLEDGE_FAILURE_COPY.waitConflict.action)}
        >
          {KNOWLEDGE_FAILURE_COPY.waitConflict.body}
        </Notice>
      )
    case "draft_conflict":
      return (
        <Notice tone="attention" role="status">
          {outcome.gone
            ? DRAFT_SAVE_COPY.conflictGone
            : DRAFT_SAVE_COPY.conflictSaved}
        </Notice>
      )
    case "already_sent":
      return (
        <Notice tone="plain" role="status">
          {DRAFT_SAVE_COPY.alreadySent}
        </Notice>
      )
    case "newer_send":
      return (
        <Notice
          tone="attention"
          role="status"
          action={
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => onStartNewDraft(outcome.sentAt)}
            >
              {DRAFT_SAVE_COPY.startNew}
            </Button>
          }
        >
          {DRAFT_SAVE_COPY.newerSend(outcome.sentAt)}
        </Notice>
      )
    case "discarded":
      return (
        <Notice tone="plain" role="status">
          Draft discarded.
        </Notice>
      )
    case "discard_failed":
      return (
        <Notice tone="negative" role="alert">
          We couldn&apos;t discard your draft. It&apos;s still saved; try again.
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
            : "You're offline. Keep this page open; it sends again when you're back online. Your draft is kept; nothing is recorded twice."}
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
