"use client"

// Labels chosen in the upload sheet, per queue file. They go to the server as
// soon as the file's asset is reserved (POST /api/upload-labels): while the
// file is still uploading the server keeps them and finalise puts them on the
// photo; once it is ready they are saved straight away. A change is sent
// again, and clearing them discards what the server kept. A file shows
// "Saved" only when it is processed and its labels are on it: an answer that
// says so (a save, finalise, or the photo's own labels), never the absence of
// a kept row.
//
// Per file:
//   draft --asset reserved--> (POST) --> pending --finalise--> saved
//                                    \--> saved (asset already ready)
//                                    \--> retry (no answer; Retry labels)
//                                    \--> attention (refused; Fix labels)
//   pending --finalise said needs attention--> attention (kept on the server)
//   attention --Fix labels or Discard on Me--> saved (as the photo is now)

import * as React from "react"

import { dishName } from "@/lib/menus/dish-name"
import {
  EMPTY_LABEL_SUMMARY,
  LABEL_LIMITS,
  type LabelItemRef,
  type MediaLabelSummary,
  type PendingLabelItem,
  type SaveLabelsErrorCode,
  type SaveLabelsInput,
  type SaveLabelsResult,
  type UploadLabelDiscardResult,
  type UploadLabelPostResult,
} from "@/lib/menus/types"
import type { FinaliseLabels } from "@/lib/upload/types"

import {
  SessionExpiredError,
  SIGNED_OUT_MESSAGE,
  type QueueItem,
} from "./upload-queue"

/** What the sheet hands the label panel (the host adds the catalogue). */
export type UploadLabelPanelHostProps = {
  /** The files that can carry labels, in queue order. */
  items: readonly QueueItem[]
  /** Each file's labels now, by queue item id (for a panel mounting again). */
  initial: SaveLabelsInput[]
  /** Files that can no longer be labelled (failed for good). */
  disabledIds: string[]
  /**
   * Files whose labels were settled elsewhere (Fix labels or Discard on Me):
   * `initial` is what the photo has, and their dish is not put back.
   */
  settledIds: string[]
  /** One input per file; assetId is the queue item id. */
  onChange: (venueId: string, inputs: SaveLabelsInput[]) => void
  /** True while a choice in the panel is incomplete. */
  onPendingChange: (pending: boolean) => void
  /** Changes when the person discards the labels not stored yet. */
  discards: number
}

/** What the sheet hands the "Fix labels" dialog. */
export type UploadLabelFixProps = {
  item: QueueItem
  assetId: string
  /** The stored labels, addressed to the asset. */
  draft: SaveLabelsInput
  /** The photo's labels as last known (revision included). */
  labels: MediaLabelSummary
  problem: { code: SaveLabelsErrorCode; message: string } | null
  onClose: () => void
  /** Saves now (the asset is ready); the dialog closes only on success. */
  onSave: (input: SaveLabelsInput) => Promise<SaveLabelsResult>
}

/** Me fixed ("labelled") or discarded the kept labels of these photos. */
export type UploadLabelSettle = (
  assetIds: string[],
  how: "labelled" | "discarded"
) => void

export type UploadLabels = {
  /** Which files may carry labels (Add's general uploads, not task screens'). */
  canLabel?: (file: File) => boolean
  /**
   * Labels a file starts with (Our menu's dish, applied by default). Undefined
   * while that cannot be told yet (the menu is loading): asked again later.
   * "unavailable" while the menu failed to load (Retry labels: `retrySeed`).
   */
  seed?: (
    item: QueueItem
  ) =>
    | { venueId: string; input: SaveLabelsInput }
    | null
    | undefined
    | "unavailable"
  /** Loads the menu again for a dish that waits for it. */
  retrySeed?: () => void
  /** Whether some file's dish waits for a menu that failed to load. */
  onSeedWaiting?: (waiting: boolean) => void
  /** Rejects with SessionExpiredError when the person is signed out. */
  save: (
    venueId: string,
    input: SaveLabelsInput
  ) => Promise<UploadLabelPostResult>
  /** Discard what the server keeps for the asset; null on failure. */
  discard: (assetId: string) => Promise<UploadLabelDiscardResult | null>
  /** The person's kept labels (pending or needing attention); null on failure. */
  attention: () => Promise<PendingLabelItem[] | null>
  /** The photo's labels as they are now; null when they cannot be read. */
  summary?: (assetId: string) => Promise<MediaLabelSummary | null>
  /** Hear Me's Fix labels and Discard; returns the unsubscribe function. */
  settled?: (listener: UploadLabelSettle) => () => void
  /** Names of the menu items in an input, for the "Saved · …" line. */
  itemNames?: (input: SaveLabelsInput) => string[]
  /**
   * Whether a manager reviews a photo labelled with these items: at least one
   * is in a food or drinks section of the menu. Omitted: never.
   */
  reviewable?: (items: readonly LabelItemRef[]) => boolean
  onSaved?: (assetId: string) => void
  renderPanel: (props: UploadLabelPanelHostProps) => React.ReactNode
  renderFix: (props: UploadLabelFixProps) => React.ReactNode
}

type Phase =
  /** Not on the server yet (no asset ID, or being sent). */
  | "draft"
  /** Kept on the server; finalise puts them on the photo. */
  | "pending"
  /** On the photo. */
  | "saved"
  /** Could not be sent or confirmed; "Retry labels". */
  | "retry"
  /** The server refused them; "Fix labels". */
  | "attention"

type LabelRecord = {
  venueId: string
  /** What the person chose; assetId is the queue item id. */
  input: SaveLabelsInput
  phase: Phase
  /** The photo's label revision (expectedRevision of the next save). */
  revision: number
  /** Key of the input the server holds (kept or saved), and for which asset. */
  sent: string | null
  sentTo: string | null
  /** The server keeps them (a pending or needs-attention row). */
  held: boolean
  /**
   * A send got no clear answer: the server may keep them, or (the photo was
   * ready) have put them on it. Clearing then sends the empty choice.
   */
  maybeHeld: boolean
  /** Sent again once because the server no longer had them as expected. */
  resent: boolean
  /** Retry re-asks whether finalise applied them, instead of sending. */
  recheck: boolean
  /** The last request was refused because the session ended. */
  signedOut: boolean
  /** Settled on Me (Fix labels or Discard): the dish is not put back. */
  settled: boolean
  code: SaveLabelsErrorCode | null
  message: string | null
  summary: MediaLabelSummary | null
  /** The finalise outcome already taken into account. */
  outcome: FinaliseLabels | null
  conflictRetried: boolean
  /**
   * The asset whose labels on the server this sheet has an answer for (a
   * save's answer, finalise's, or a read). A file picked again is read
   * before its first send, so a seeded dish never replaces what is kept.
   */
  known: string | null
}

/** How one file's labels look in the sheet. */
export type LabelView =
  | { kind: "none" }
  | { kind: "saving" }
  /** `review`: a manager reviews the photo for one of these dishes. */
  | { kind: "saved"; names: string[]; review: boolean }
  /** Not saved yet: "Retry labels" (after signing in again, if signed out). */
  | { kind: "retry"; signedOut?: boolean }
  | { kind: "attention"; code: SaveLabelsErrorCode | null; message: string }
  /** The file failed for good, so its labels can never be saved. */
  | { kind: "lost" }

export const LABELS_NOT_SAVED = "Labels not saved yet."
export const MENU_CHANGED = "The menu changed. Check the dish."
export const LABELS_LOST = "Not saved (photo not saved)"

const MENU_CODES: ReadonlySet<SaveLabelsErrorCode> = new Set([
  "catalogue_changed",
  "unavailable_items",
])

const SIGNED_OUT = "signed-out" as const
/** A failed request: the session ended, or no answer to read. */
function failure(error: unknown) {
  return error instanceof SessionExpiredError ? SIGNED_OUT : null
}

export function isEmptyInput(input: SaveLabelsInput) {
  return (
    input.items.length === 0 &&
    input.contentTypes.length === 0 &&
    !input.note &&
    !input.missingItem
  )
}

/** The copy for a refusal: menu changes always read the same (C5). */
function problemText(code: SaveLabelsErrorCode | null, message: string | null) {
  return !code || MENU_CODES.has(code)
    ? MENU_CHANGED
    : (message ?? MENU_CHANGED)
}

/**
 * The labels on a photo, as the input that would put them there, with the
 * person's own open suggestion (so the sheet shows it and can withdraw it).
 */
function inputOf(
  summary: MediaLabelSummary,
  id: string,
  catalogueVersionId: string | null
): SaveLabelsInput {
  return {
    assetId: id,
    expectedRevision: summary.revision,
    catalogueVersionId,
    contentTypes: summary.contentTypes,
    note: summary.note,
    items: summary.items.map((i) => ({
      itemId: i.itemId,
      variantId: i.variantId,
    })),
    missingItem: summary.missingItem,
  }
}

/** The key of labels as the server applied them. */
function summaryKey(summary: MediaLabelSummary) {
  return keyOf(inputOf(summary, "", null))
}

/** What is chosen, independent of asset, revision and menu version. */
function keyOf(input: SaveLabelsInput) {
  return JSON.stringify([
    input.items.map((i) => `${i.itemId}:${i.variantId ?? ""}`).sort(),
    [...input.contentTypes].sort(),
    input.note ?? "",
    input.missingItem,
  ])
}

/** The labels themselves (a missing-item suggestion is not on the photo). */
function labelsKey(input: SaveLabelsInput) {
  return keyOf({ ...input, missingItem: null })
}

/**
 * Whether a send with this key carried a missing-item suggestion (or its
 * withdrawal): undoing it must then withdraw the person's own suggestion,
 * since null leaves it open. Unknown or nothing sent: leave it alone.
 */
function sentSuggestion(key: string | null) {
  if (!key || key === UNKNOWN_KEY) return false
  const sent = JSON.parse(key) as unknown[]
  return sent[3] !== null
}

function emptyInput(id: string, catalogueVersionId: string | null) {
  return {
    assetId: id,
    expectedRevision: 0,
    catalogueVersionId,
    contentTypes: [],
    note: null,
    items: [],
    missingItem: null,
  } satisfies SaveLabelsInput
}

const EMPTY_KEY = keyOf(emptyInput("", null))

/**
 * What the server already has for a file picked again, with this sheet's
 * choice (its seeded dish) added: nothing kept or applied is dropped.
 */
function mergeChoice(
  base: SaveLabelsInput,
  ours: SaveLabelsInput
): SaveLabelsInput {
  const refKey = (i: LabelItemRef) => `${i.itemId}:${i.variantId ?? ""}`
  const have = new Set(base.items.map(refKey))
  return {
    ...base,
    catalogueVersionId: ours.catalogueVersionId ?? base.catalogueVersionId,
    items: [
      ...base.items,
      ...ours.items.filter((i) => !have.has(refKey(i))),
    ].slice(0, LABEL_LIMITS.maxItemsPerAsset),
    contentTypes: [
      ...base.contentTypes,
      ...ours.contentTypes.filter((t) => !base.contentTypes.includes(t)),
    ].slice(0, LABEL_LIMITS.maxContentTypes),
    note: base.note ?? ours.note,
    missingItem: base.missingItem ?? ours.missingItem,
  }
}

/** Whether two inputs choose the same labels (no input: no labels). */
export function sameLabelChoice(
  a: SaveLabelsInput | undefined,
  b: SaveLabelsInput | undefined
) {
  return (a ? keyOf(a) : EMPTY_KEY) === (b ? keyOf(b) : EMPTY_KEY)
}
/** Held by the server, but what exactly is still being read. */
const UNKNOWN_KEY = "unknown"

function newRecord(venueId: string, input: SaveLabelsInput): LabelRecord {
  return {
    venueId,
    input,
    phase: "draft",
    revision: 0,
    sent: null,
    sentTo: null,
    held: false,
    maybeHeld: false,
    resent: false,
    recheck: false,
    signedOut: false,
    settled: false,
    code: null,
    message: null,
    summary: null,
    outcome: null,
    conflictRetried: false,
    known: null,
  }
}

/** On the photo as `summary` says: nothing left to send or keep. */
function onPhoto(
  r: LabelRecord,
  assetId: string,
  summary: MediaLabelSummary
): LabelRecord {
  return {
    ...r,
    phase: "saved",
    sent: summaryKey(summary),
    sentTo: assetId,
    known: assetId,
    held: false,
    maybeHeld: false,
    recheck: false,
    signedOut: false,
    revision: summary.revision,
    summary,
    code: null,
    message: null,
  }
}

const lostFile = (item: QueueItem) =>
  item.status === "failed" && item.retryable === false

export function useUploadLabels(
  items: readonly QueueItem[],
  config: UploadLabels | undefined,
  paused: boolean,
  /** The sheet is showing: labels needing attention are checked again. */
  open = true
) {
  const [records, setRecords] = React.useState<Record<string, LabelRecord>>({})
  // Changes when records change other than through the panel (finalise's
  // labels for a file with none here, Me settling them): the panel, which
  // reads `initial` once, mounts again.
  const [version, setVersion] = React.useState(0)
  // Per file: the request in flight, and the last asset+input attempted (so a
  // render never sends the same thing twice).
  const inFlight = React.useRef(new Set<string>())
  const attempted = React.useRef(new Map<string, string>())
  const seedAsked = React.useRef(new Set<string>())
  // Files whose finalise labels made a record here.
  const adopted = React.useRef(new Set<string>())
  // Files removed (or the queue cleared) while a send was in flight: what it
  // leaves kept or on the photo is undone.
  const removed = React.useRef(new Set<string>())

  const labelable = React.useMemo(
    () =>
      config
        ? items.filter((item) => config.canLabel?.(item.file) ?? true)
        : [],
    [items, config]
  )

  const patch = React.useCallback(
    (id: string, change: (record: LabelRecord) => LabelRecord) =>
      setRecords((current) =>
        current[id] ? { ...current, [id]: change(current[id]) } : current
      ),
    []
  )

  /** The photo is as `summary` says (settled elsewhere): take it as it is. */
  const adopt = React.useCallback(
    (id: string, assetId: string, summary: MediaLabelSummary) => {
      attempted.current.delete(id)
      setRecords((current) => {
        const r = current[id]
        if (!r) return current
        const input = inputOf(summary, id, r.input.catalogueVersionId)
        return {
          ...current,
          [id]: {
            ...onPhoto(r, assetId, summary),
            input,
            sent: keyOf(input),
            settled: true,
            resent: false,
            conflictRetried: false,
          },
        }
      })
      setVersion((v) => v + 1)
    },
    []
  )

  /**
   * Clears labels on a ready photo: the empty choice at its revision, sent
   * once more at the newer revision if the photo changed meanwhile.
   */
  const clearPhoto = React.useCallback(
    (
      venueId: string,
      assetId: string,
      revision: number,
      catalogueVersionId: string | null,
      withdraw: boolean
    ) => {
      if (!config) return
      const send = (expectedRevision: number) =>
        config.save(venueId, {
          ...emptyInput(assetId, catalogueVersionId),
          expectedRevision,
          // A suggestion this sheet sent goes with the labels it put there.
          missingItem: withdraw ? "" : null,
        })
      void send(revision)
        .then((result) =>
          !result.ok && result.code === "conflict" && result.current
            ? send(result.current.revision)
            : result
        )
        .catch(() => {})
    },
    [config]
  )

  /** Undo what a send left for a file that left the sheet meanwhile. */
  const scrub = React.useCallback(
    (
      venueId: string,
      input: SaveLabelsInput,
      result: UploadLabelPostResult | typeof SIGNED_OUT | null,
      ready: boolean
    ) => {
      if (!config) return
      const assetId = input.assetId
      const version = input.catalogueVersionId
      const withdraw = input.missingItem !== null
      if (result && result !== SIGNED_OUT && result.ok) {
        // On the photo now: only the empty choice takes them off.
        if (result.state === "saved")
          return clearPhoto(
            venueId,
            assetId,
            result.labels.revision,
            version,
            withdraw
          )
      } else if (
        ready &&
        result !== SIGNED_OUT &&
        (!result || result.code === "unavailable")
      ) {
        // No clear answer from a ready photo: they may be on it.
        return clearPhoto(
          venueId,
          assetId,
          input.expectedRevision,
          version,
          withdraw
        )
      }
      void config
        .discard(assetId)
        .then((done) => {
          if (done?.state === "already_applied")
            clearPhoto(
              venueId,
              assetId,
              done.labels.revision,
              version,
              withdraw
            )
        })
        .catch(() => {})
    },
    [config, clearPhoto]
  )

  /**
   * Reads what the server keeps for an adopted file whose kept labels could
   * not be read (needing attention): once read, they are the file's labels.
   */
  const readKept = React.useCallback(
    (id: string, assetId: string) => {
      if (!config) return
      attempted.current.set(id, `reread|${assetId}`)
      inFlight.current.add(id)
      void config
        .attention()
        .catch(() => null)
        .then((rows) => {
          inFlight.current.delete(id)
          const row = rows?.find((r) => r.assetId === assetId)
          if (!row) return
          patch(id, (r) => {
            if (r.sent !== UNKNOWN_KEY) return r
            const input = { ...row.input, assetId: id }
            attempted.current.set(id, `${assetId}|${keyOf(input)}`)
            return { ...r, venueId: row.venueId, input, sent: keyOf(input) }
          })
          setVersion((v) => v + 1)
        })
    },
    [config, patch]
  )

  // Labels a file starts with (the dish it was picked for).
  React.useEffect(() => {
    if (!config?.seed) return
    const seeds: Record<string, LabelRecord> = {}
    for (const item of labelable) {
      if (records[item.id] || seedAsked.current.has(item.id)) continue
      const seed = config.seed(item)
      if (seed === undefined || seed === "unavailable") continue
      seedAsked.current.add(item.id)
      if (seed) seeds[item.id] = newRecord(seed.venueId, seed.input)
    }
    if (Object.keys(seeds).length === 0) return
    // The menu (an external resource) decides the seed once it has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecords((current) => ({ ...seeds, ...current }))
  }, [labelable, records, config])

  React.useEffect(() => {
    if (!config) return
    for (const item of labelable) {
      const record = records[item.id]
      const assetId = item.assetId
      if (inFlight.current.has(item.id)) continue

      if (!record) {
        // Finalise applied (or could not apply) labels this sheet has no
        // record of: the page was reloaded and the same file picked again.
        if (item.labels && assetId && !adopted.current.has(item.id)) {
          adopted.current.add(item.id)
          const outcome = item.labels
          const fresh: LabelRecord =
            outcome.state === "saved"
              ? (() => {
                  const input = inputOf(outcome.labels, item.id, null)
                  return {
                    ...onPhoto(newRecord("", input), assetId, outcome.labels),
                    sent: keyOf(input),
                    outcome,
                  }
                })()
              : {
                  ...newRecord("", emptyInput(item.id, null)),
                  phase: "attention" as const,
                  held: true,
                  sent: UNKNOWN_KEY,
                  sentTo: assetId,
                  known: assetId,
                  // What is kept says which dish: the panel puts none back.
                  settled: true,
                  code: outcome.code,
                  message: problemText(outcome.code, outcome.message),
                  outcome,
                }
          attempted.current.set(item.id, `${assetId}|${keyOf(fresh.input)}`)
          if (outcome.state === "needs_attention") inFlight.current.add(item.id)
          void Promise.resolve().then(() => {
            if (outcome.state === "saved") config.onSaved?.(assetId)
            setRecords((current) =>
              current[item.id] ? current : { ...current, [item.id]: fresh }
            )
            setVersion((v) => v + 1)
            if (outcome.state !== "needs_attention") return
            // What is kept, for Fix labels.
            void config
              .attention()
              .catch(() => null)
              .then((rows) => {
                inFlight.current.delete(item.id)
                const row = rows?.find((r) => r.assetId === assetId)
                patch(item.id, (r) => {
                  if (!row || r.sent !== UNKNOWN_KEY) return { ...r }
                  const input = { ...row.input, assetId: item.id }
                  attempted.current.set(item.id, `${assetId}|${keyOf(input)}`)
                  return {
                    ...r,
                    venueId: row.venueId,
                    input,
                    sent: keyOf(input),
                  }
                })
                if (row) setVersion((v) => v + 1)
              })
          })
        }
        continue
      }

      // Finalise reported what it did with the labels the server kept.
      if (item.labels && record.outcome !== item.labels) {
        const outcome = item.labels
        inFlight.current.add(item.id)
        void Promise.resolve().then(() => {
          inFlight.current.delete(item.id)
          if (outcome.state === "saved" && item.assetId)
            config.onSaved?.(item.assetId)
          attempted.current.delete(item.id)
          patch(item.id, (r) => {
            // A later save already answered with a newer revision: finalise's
            // older labels are not what the photo has now. (Still pending: no
            // save answered "saved", only a conflict at finalise's revision,
            // so finalise's answer is what the photo has.)
            if (
              outcome.state === "saved" &&
              r.phase !== "pending" &&
              r.revision > 0 &&
              r.revision >= outcome.labels.revision
            )
              return { ...r, outcome }
            if (r.phase !== "pending") {
              // Finalise applied what the server kept, after the person
              // changed or cleared them (or a send got no answer): note what
              // is on the photo, so the current choice is sent over it.
              if (outcome.state === "saved" && item.assetId)
                return {
                  ...onPhoto(r, item.assetId, outcome.labels),
                  outcome,
                }
              if (outcome.state === "needs_attention" && r.maybeHeld)
                return {
                  ...r,
                  outcome,
                  phase: "attention",
                  held: true,
                  maybeHeld: false,
                  code: outcome.code,
                  message: problemText(outcome.code, outcome.message),
                }
              return { ...r, outcome }
            }
            if (outcome.state === "saved") {
              return {
                ...r,
                outcome,
                phase: "saved",
                held: false,
                revision: outcome.labels.revision,
                summary: outcome.labels,
              }
            }
            return {
              ...r,
              outcome,
              phase: "attention",
              held: true,
              code: outcome.code,
              message: problemText(outcome.code, outcome.message),
            }
          })
        })
        continue
      }

      // Finalise said the kept labels need attention, but they could not be
      // read: an empty choice here would discard them. Nothing is sent until
      // the person chooses labels; the read is tried again meanwhile.
      if (record.sent === UNKNOWN_KEY && keyOf(record.input) === EMPTY_KEY) {
        if (assetId && attempted.current.get(item.id) !== `reread|${assetId}`)
          readKept(item.id, assetId)
        continue
      }

      if (paused || !assetId || lostFile(item) || item.status === "cancelled")
        continue
      if (record.phase === "retry" || record.phase === "attention") {
        // Waits for Retry labels or Fix labels, unless the person changed them.
        if (
          attempted.current.get(item.id) === `${assetId}|${keyOf(record.input)}`
        )
          continue
      }

      // Done, but finalise said nothing about the kept labels (it ran before
      // they arrived, or the file was already processed): ask the server.
      // No kept row is not proof they were applied: the photo's own labels
      // are.
      if (
        item.status === "done" &&
        record.phase === "pending" &&
        record.sentTo === assetId &&
        record.sent === keyOf(record.input) &&
        !item.labels
      ) {
        if (attempted.current.get(item.id) === `check|${assetId}`) continue
        attempted.current.set(item.id, `check|${assetId}`)
        inFlight.current.add(item.id)
        const sentLabels = labelsKey(record.input)
        void (async () => {
          const rows = await config.attention().catch(failure)
          const row =
            rows !== SIGNED_OUT
              ? rows?.find((r) => r.assetId === assetId)
              : undefined
          const photo =
            rows && rows !== SIGNED_OUT && !row && config.summary
              ? await config.summary(assetId).catch(failure)
              : null
          inFlight.current.delete(item.id)
          const applied =
            photo &&
            photo !== SIGNED_OUT &&
            labelsKey(inputOf(photo, "", null)) === sentLabels
          if (applied) config.onSaved?.(assetId)
          patch(item.id, (r) => {
            if (rows === SIGNED_OUT || photo === SIGNED_OUT)
              return { ...r, phase: "retry", recheck: true, signedOut: true }
            if (!rows) return { ...r, phase: "retry", recheck: true }
            if (!row) {
              if (!photo) return { ...r, phase: "retry", recheck: true }
              if (applied)
                return {
                  ...onPhoto(r, assetId, photo),
                  sent: r.sent,
                  conflictRetried: false,
                }
              // Not kept and not on the photo: send them again, once.
              if (r.resent)
                return {
                  ...r,
                  phase: "retry",
                  recheck: true,
                  revision: photo.revision,
                }
              attempted.current.delete(item.id)
              return {
                ...r,
                sent: null,
                held: false,
                phase: "draft",
                recheck: false,
                resent: true,
                revision: photo.revision,
              }
            }
            if (row.status === "needs_attention")
              return {
                ...r,
                phase: "attention",
                held: true,
                recheck: false,
                code: row.code,
                message: problemText(row.code, row.message),
              }
            // Still kept although the asset is ready: send it again, once.
            if (r.resent) return { ...r, phase: "retry", recheck: true }
            attempted.current.delete(item.id)
            return {
              ...r,
              sent: null,
              phase: "draft",
              recheck: false,
              resent: true,
            }
          })
        })()
        continue
      }

      const key = keyOf(record.input)
      const ready = item.status === "done"
      // A send with no clear answer to a ready photo may have put them on it:
      // only the empty choice clears that (a DELETE removes kept labels only).
      const unsure = key === EMPTY_KEY && record.maybeHeld && ready
      const attempt = `${assetId}|${key}${unsure ? "|ready" : ""}`
      if (attempted.current.get(item.id) === attempt) continue
      if (record.sent === key && record.sentTo === assetId) continue

      if (key === EMPTY_KEY) {
        if (record.sent === null && !record.maybeHeld) continue
        if (
          !unsure &&
          (record.phase !== "saved" || record.sentTo !== assetId)
        ) {
          // Cleared before they reached the photo: discard what is kept.
          attempted.current.set(item.id, attempt)
          const keptFor = record.sentTo ?? assetId
          inFlight.current.add(item.id)
          void config
            .discard(keptFor)
            .catch(failure)
            .then((result) => {
              inFlight.current.delete(item.id)
              const applied =
                result &&
                result !== SIGNED_OUT &&
                result.state === "already_applied"
                  ? result.labels
                  : null
              if (removed.current.delete(item.id)) {
                // Gone from the sheet meanwhile, and finalise applied them.
                if (applied)
                  clearPhoto(
                    record.venueId,
                    keptFor,
                    applied.revision,
                    record.input.catalogueVersionId,
                    sentSuggestion(record.sent)
                  )
                return
              }
              // Finalise applied them first: clear them on the photo.
              if (applied) attempted.current.delete(item.id)
              patch(item.id, (r) => {
                if (result === SIGNED_OUT)
                  return { ...r, phase: "retry", signedOut: true }
                if (!result) return { ...r, phase: "retry" }
                if (result.state === "already_applied")
                  return onPhoto(r, keptFor, result.labels)
                return {
                  ...r,
                  phase: "draft",
                  sent: null,
                  // Nothing kept, but a direct save may still have landed:
                  // stay unsure until the photo is ready.
                  sentTo:
                    result.state === "none" && r.maybeHeld ? keptFor : null,
                  held: false,
                  maybeHeld: result.state === "none" && r.maybeHeld,
                  signedOut: false,
                  code: null,
                  message: null,
                }
              })
            })
          continue
        }
        // On the photo (or maybe): saving the empty set clears them.
      }

      // Picked again (after a reload): the server may keep labels for it, or
      // have put them on the photo. Read them before the first send and add
      // this sheet's choice (its dish) to them, instead of replacing them.
      if (item.resumed && record.known !== assetId && record.sent === null) {
        if (attempted.current.get(item.id) === `read|${assetId}`) continue
        attempted.current.set(item.id, `read|${assetId}`)
        inFlight.current.add(item.id)
        void (async () => {
          const rows = await config.attention().catch(failure)
          const row =
            rows && rows !== SIGNED_OUT
              ? rows.find((r) => r.assetId === assetId)
              : undefined
          // Not kept: maybe on the photo (ready by now, or not: then null).
          const photo =
            rows && rows !== SIGNED_OUT && !row && config.summary
              ? await config.summary(assetId).catch(failure)
              : null
          inFlight.current.delete(item.id)
          patch(item.id, (r) => {
            if (rows === SIGNED_OUT || photo === SIGNED_OUT)
              return { ...r, phase: "retry", signedOut: true }
            // Could not tell: Retry labels reads again; nothing is replaced.
            if (!rows || (ready && !row && !photo && config.summary))
              return { ...r, phase: "retry" }
            if (row) {
              const kept = { ...row.input, assetId: item.id }
              const input = mergeChoice(kept, r.input)
              const attention = row.status === "needs_attention"
              // Needing attention waits for Fix labels with all of it.
              if (attention)
                attempted.current.set(item.id, `${assetId}|${keyOf(input)}`)
              return {
                ...r,
                venueId: row.venueId,
                input,
                known: assetId,
                sent: keyOf(kept),
                sentTo: assetId,
                held: true,
                phase: attention ? "attention" : "pending",
                code: attention ? row.code : null,
                message: attention ? problemText(row.code, row.message) : null,
              }
            }
            if (photo) {
              const onIt = inputOf(photo, item.id, r.input.catalogueVersionId)
              return {
                ...onPhoto(r, assetId, photo),
                input: mergeChoice(onIt, r.input),
                sent: keyOf(onIt),
              }
            }
            return { ...r, known: assetId }
          })
          setVersion((v) => v + 1)
        })()
        continue
      }

      attempted.current.set(item.id, attempt)
      inFlight.current.add(item.id)
      const venueId = record.venueId
      const input = {
        ...record.input,
        assetId,
        expectedRevision: record.revision,
      }
      void Promise.resolve()
        .then(() => config.save(venueId, input))
        .catch(failure)
        .then((result) => {
          inFlight.current.delete(item.id)
          if (removed.current.has(item.id)) {
            // The file left the sheet meanwhile: nothing may stay kept, and
            // nothing it put on the photo may stay there.
            removed.current.delete(item.id)
            scrub(venueId, input, result, ready)
            return
          }
          if (
            result &&
            result !== SIGNED_OUT &&
            result.ok &&
            result.state === "saved"
          )
            config.onSaved?.(assetId)
          patch(item.id, (prev) => {
            // Any answer from the server is something this sheet now knows.
            const r =
              result && result !== SIGNED_OUT
                ? { ...prev, known: assetId }
                : prev
            if (result === SIGNED_OUT)
              return { ...r, phase: "retry", recheck: false, signedOut: true }
            if (!result || (!result.ok && result.code === "unavailable"))
              return {
                ...r,
                phase: "retry",
                recheck: false,
                sentTo: assetId,
                maybeHeld: true,
              }
            if (result.ok && result.state === "saved") {
              return {
                ...r,
                phase: "saved",
                sent: key,
                sentTo: assetId,
                held: false,
                maybeHeld: false,
                signedOut: false,
                revision: result.labels.revision,
                summary: result.labels,
                code: null,
                message: null,
                conflictRetried: false,
              }
            }
            if (result.ok)
              return {
                ...r,
                phase: "pending",
                sent: key,
                sentTo: assetId,
                held: true,
                maybeHeld: false,
                signedOut: false,
                code: null,
                message: null,
                conflictRetried: false,
              }
            if (
              result.code === "conflict" &&
              result.current &&
              !r.conflictRetried
            ) {
              attempted.current.delete(item.id)
              // A file picked again, with labels this sheet never had an
              // answer for: what the photo has is not ours to replace. Keep
              // it, add this choice, send that.
              if (item.resumed && prev.known !== assetId) {
                const onIt = inputOf(
                  result.current,
                  item.id,
                  r.input.catalogueVersionId
                )
                return {
                  ...onPhoto(r, assetId, result.current),
                  input: mergeChoice(onIt, r.input),
                  sent: keyOf(onIt),
                  conflictRetried: true,
                }
              }
              // The photo got labels meanwhile (finalise applied an earlier
              // choice): send this choice again over them, once.
              return {
                ...r,
                revision: result.current.revision,
                conflictRetried: true,
              }
            }
            return {
              ...r,
              phase: "attention",
              held: false,
              code: result.code,
              message: problemText(result.code, result.message),
            }
          })
          // A conflict on labels this sheet had no answer for was adopted
          // above: show the field what the photo has now.
          if (
            result &&
            result !== SIGNED_OUT &&
            !result.ok &&
            result.code === "conflict" &&
            item.resumed &&
            record.known !== assetId
          )
            setVersion((v) => v + 1)
        })
    }
  }, [labelable, records, config, paused, patch, scrub, clearPhoto, readKept])

  // Me's Fix labels or Discard for photos in this sheet.
  const latest = React.useRef({ labelable, records, config })
  React.useEffect(() => {
    latest.current = { labelable, records, config }
  })
  const settle = React.useCallback<UploadLabelSettle>(
    (assetIds, how) => {
      const { labelable, records, config } = latest.current
      const hits = labelable.filter(
        (item) =>
          item.assetId && assetIds.includes(item.assetId) && records[item.id]
      )
      for (const item of hits) {
        const assetId = item.assetId!
        attempted.current.delete(item.id)
        patch(item.id, (r) => {
          const settledNow = {
            ...r,
            known: assetId,
            held: false,
            maybeHeld: false,
            recheck: false,
            signedOut: false,
            settled: true,
            code: null,
            message: null,
          }
          if (how === "discarded") {
            // No labels from this sheet on the photo.
            const input = emptyInput(item.id, r.input.catalogueVersionId)
            return {
              ...settledNow,
              input,
              phase: "draft",
              sent: EMPTY_KEY,
              sentTo: assetId,
            }
          }
          // On the photo as Me saved them; what exactly is read next.
          return {
            ...settledNow,
            phase: "saved",
            sent: keyOf(r.input),
            sentTo: assetId,
            summary: null,
          }
        })
        if (how === "labelled" && config?.summary)
          void config
            .summary(assetId)
            .catch(() => null)
            .then((photo) => {
              if (photo) adopt(item.id, assetId, photo)
            })
      }
      if (hits.length > 0) setVersion((v) => v + 1)
    },
    [patch, adopt]
  )
  React.useEffect(() => config?.settled?.(settle), [config, settle])

  // Opened again: labels that needed attention may have been dealt with on
  // Me meanwhile. Not kept any more: the photo's labels say how.
  React.useEffect(() => {
    if (!open) return
    const { labelable, records, config } = latest.current
    // Kept labels that could not be read: read them again now.
    for (const item of labelable)
      if (
        item.assetId &&
        records[item.id]?.sent === UNKNOWN_KEY &&
        !inFlight.current.has(item.id)
      )
        readKept(item.id, item.assetId)
    if (!config?.summary) return
    const waiting = labelable.filter((item) => {
      const r = records[item.id]
      return (
        item.assetId &&
        item.status === "done" &&
        r?.phase === "attention" &&
        r.held &&
        !inFlight.current.has(item.id)
      )
    })
    if (waiting.length === 0) return
    void config
      .attention()
      .catch(() => null)
      .then((rows) => {
        if (!rows) return
        for (const item of waiting) {
          const assetId = item.assetId!
          if (rows.some((row) => row.assetId === assetId)) continue
          void config
            .summary?.(assetId)
            .catch(() => null)
            .then((photo) => {
              if (
                photo &&
                latest.current.records[item.id]?.phase === "attention"
              )
                adopt(item.id, assetId, photo)
            })
        }
      })
  }, [open, adopt, readKept])

  /**
   * Its dish (Our menu) cannot be told yet: "loading" while the menu loads,
   * "failed" while it could not be loaded.
   */
  function undecided(item: QueueItem): "loading" | "failed" | null {
    if (!config?.seed || lostFile(item) || !labelable.includes(item))
      return null
    const seed = config.seed(item)
    return seed === undefined
      ? "loading"
      : seed === "unavailable"
        ? "failed"
        : null
  }

  const seedWaiting = labelable.some(
    (item) => !records[item.id] && undecided(item) === "failed"
  )
  React.useEffect(
    () => config?.onSeedWaiting?.(seedWaiting),
    [config, seedWaiting]
  )
  React.useEffect(() => () => latest.current.config?.onSeedWaiting?.(false), [])

  function view(item: QueueItem): LabelView {
    const record = records[item.id]
    if (!record) {
      const waiting = undecided(item)
      return waiting === "failed"
        ? { kind: "retry" }
        : waiting
          ? { kind: "saving" }
          : { kind: "none" }
    }
    const empty = isEmptyInput(record.input)
    // A request in flight may still put labels on the photo (or take them
    // off): never "Saved" until it answers.
    const busy = inFlight.current.has(item.id)
    if (
      empty &&
      !busy &&
      !record.maybeHeld &&
      (record.sent === null || record.sent === EMPTY_KEY)
    )
      return { kind: "none" }
    if (lostFile(item)) return empty ? { kind: "none" } : { kind: "lost" }
    if (busy) return { kind: "saving" }
    if (record.phase === "retry")
      return record.signedOut
        ? { kind: "retry", signedOut: true }
        : { kind: "retry" }
    if (record.phase === "attention")
      return {
        kind: "attention",
        code: record.code,
        message: record.message ?? MENU_CHANGED,
      }
    if (
      record.phase === "saved" &&
      record.sent === keyOf(record.input) &&
      record.sentTo === item.assetId
    ) {
      if (empty) return { kind: "none" }
      const names = record.summary
        ? record.summary.items.map((i) => dishName(i, i.unspecified))
        : record.settled
          ? []
          : (config?.itemNames?.(record.input) ?? [])
      const refs: LabelItemRef[] = record.summary
        ? record.summary.items.map((i) => ({
            itemId: i.itemId,
            variantId: i.variantId,
          }))
        : record.settled
          ? []
          : record.input.items
      const review = config?.reviewable?.(refs) ?? false
      return { kind: "saved", names, review }
    }
    return { kind: "saving" }
  }

  /** Not yet kept on the server (lost if the page goes now). */
  function unstored(item: QueueItem) {
    const record = records[item.id]
    const kind = view(item).kind
    if (kind === "none" || kind === "saved" || kind === "lost") return false
    // No record yet but a dish waiting for the menu: nothing is sent yet.
    if (!record) return true
    return !record.held || record.sent !== keyOf(record.input)
  }

  function retry(id: string) {
    attempted.current.delete(id)
    // A dish waiting for a menu that failed to load: load it again.
    if (!records[id]) return config?.retrySeed?.()
    patch(id, (r) =>
      r.phase !== "retry"
        ? r
        : r.recheck
          ? { ...r, phase: "pending", recheck: false, signedOut: false }
          : { ...r, phase: "draft", signedOut: false }
    )
  }

  return {
    labelable,
    view,
    unstored,
    /** Changes when the panel must mount again (see `version` above). */
    version,
    /** A label request was refused because the session ended. */
    signedOut: labelable.some(
      (item) =>
        records[item.id]?.signedOut && records[item.id].phase === "retry"
    ),
    /** Each file's labels now (assetId = queue item id), for the panel. */
    initial: labelable.flatMap((item) =>
      records[item.id] ? [records[item.id].input] : []
    ),
    settledIds: labelable
      .filter((item) => records[item.id]?.settled)
      .map((item) => item.id),
    /** Panel changes: one input per file, by queue item id. */
    change(venueId: string, inputs: SaveLabelsInput[]) {
      setRecords((current) => {
        let next = current
        for (const input of inputs) {
          const existing = current[input.assetId]
          if (!existing && isEmptyInput(input)) continue
          if (
            existing &&
            existing.venueId === venueId &&
            keyOf(existing.input) === keyOf(input)
          )
            continue
          if (next === current) next = { ...current }
          next[input.assetId] = existing
            ? { ...existing, venueId, input, conflictRetried: false }
            : newRecord(venueId, input)
        }
        return next
      })
    },
    /** "Retry labels": send them again, or ask again whether they were applied. */
    retry,
    /** Signed in again: retry every label request the sign-out stopped. */
    retrySignedOut() {
      for (const item of labelable)
        if (records[item.id]?.signedOut) retry(item.id)
    },
    /** The labels to fix, addressed to the asset, and the problem. */
    fixDraft(item: QueueItem) {
      const record = records[item.id]
      if (!record || !item.assetId) return null
      return {
        draft: {
          ...record.input,
          assetId: item.assetId,
          expectedRevision: record.revision,
        },
        labels: record.summary ?? {
          ...EMPTY_LABEL_SUMMARY,
          revision: record.revision,
        },
        problem:
          record.phase === "attention" && record.code
            ? { code: record.code, message: record.message ?? MENU_CHANGED }
            : null,
      }
    },
    /** "Fix labels": save a corrected choice now. */
    async fix(
      item: QueueItem,
      input: SaveLabelsInput
    ): Promise<SaveLabelsResult> {
      const record = records[item.id]
      const assetId = item.assetId
      if (!config || !record || !assetId)
        return {
          ok: false,
          assetId: input.assetId,
          code: "not_found",
          message: "This file can no longer be labelled.",
        }
      const result = await config
        .save(record.venueId, { ...input, assetId })
        .catch(failure)
      if (!result || result === SIGNED_OUT)
        return {
          ok: false,
          assetId,
          code: "unavailable",
          message:
            result === SIGNED_OUT ? SIGNED_OUT_MESSAGE : LABELS_NOT_SAVED,
        }
      if (!result.ok) return result
      // The dialog's missingItem is a change against the photo (null: kept
      // as it was), not the photo's state: once saved, the record holds what
      // the photo has, own suggestion included, so the sheet shows it and a
      // later clear withdraws it.
      const now =
        result.state === "saved"
          ? inputOf(result.labels, item.id, input.catalogueVersionId)
          : { ...input, assetId: item.id }
      const key = keyOf(now)
      attempted.current.set(item.id, `${assetId}|${key}`)
      patch(item.id, (r) => ({
        ...r,
        known: assetId,
        input: now,
        phase: result.state === "saved" ? "saved" : "pending",
        sent: key,
        sentTo: assetId,
        held: result.state !== "saved",
        maybeHeld: false,
        signedOut: false,
        conflictRetried: false,
        revision:
          result.state === "saved" ? result.labels.revision : r.revision,
        summary: result.state === "saved" ? result.labels : r.summary,
        code: null,
        message: null,
      }))
      if (result.state === "saved") config.onSaved?.(assetId)
      return result.state === "saved"
        ? { ok: true, assetId, labels: result.labels }
        : {
            ok: true,
            assetId,
            labels: record.summary ?? {
              ...EMPTY_LABEL_SUMMARY,
              revision: record.revision,
            },
          }
    },
    /** The file left the queue: discard what the server keeps for it. */
    discard(item: QueueItem) {
      const record = records[item.id]
      attempted.current.delete(item.id)
      seedAsked.current.delete(item.id)
      if (inFlight.current.has(item.id)) removed.current.add(item.id)
      const kept =
        record &&
        (record.held || record.maybeHeld) &&
        (record.sentTo ?? item.assetId)
      if (kept && config)
        void config
          .discard(kept)
          .then((done) => {
            if (done?.state === "already_applied")
              clearPhoto(
                record.venueId,
                kept,
                done.labels.revision,
                record.input.catalogueVersionId,
                sentSuggestion(record.sent)
              )
          })
          .catch(() => {})
      setRecords((current) => {
        if (!current[item.id]) return current
        const next = { ...current }
        delete next[item.id]
        return next
      })
    },
    /** The queue is cleared: a send still in flight is undone when it answers. */
    reset() {
      for (const id of inFlight.current) removed.current.add(id)
      attempted.current.clear()
      seedAsked.current.clear()
      adopted.current.clear()
      setRecords({})
    },
  }
}
