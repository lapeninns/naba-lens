"use client"

// Labels chosen in the upload sheet, per queue file. They go to the server as
// soon as the file's asset is reserved (POST /api/upload-labels): while the
// file is still uploading the server keeps them and finalise puts them on the
// photo; once it is ready they are saved straight away. A change is sent
// again, and clearing them discards what the server kept. A file shows
// "Saved" only when it is processed and its labels are on it.
//
// Per file:
//   draft --asset reserved--> (POST) --> pending --finalise--> saved
//                                    \--> saved (asset already ready)
//                                    \--> retry (no answer; Retry labels)
//                                    \--> attention (refused; Fix labels)
//   pending --finalise said needs attention--> attention (kept on the server)

import * as React from "react"

import type {
  MediaLabelSummary,
  SaveLabelsErrorCode,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

import type { QueueItem, UploadLabelOutcome } from "./upload-queue"

// TODO(integration): import from "@/lib/menus/types" (S1 adds them, C1).
/** POST /api/upload-labels. */
export type UploadLabelPostResult =
  | { ok: true; assetId: string; state: "saved"; labels: MediaLabelSummary }
  | { ok: true; assetId: string; state: "pending" }
  | {
      ok: false
      assetId: string
      code: SaveLabelsErrorCode
      message: string
      current?: MediaLabelSummary
      unavailableItemIds?: string[]
    }

// TODO(integration): import from "@/lib/menus/types" (S1 adds it, C1).
/** One row of GET /api/upload-labels?attention=1. */
export type PendingLabelItem = {
  assetId: string
  venueId: string
  status: "pending" | "needs_attention"
  code: SaveLabelsErrorCode | null
  message: string | null
  input: SaveLabelsInput
  uploadState: string
  mediaType: "image" | "video"
  thumbnailUrl: string | null
  updatedAt: string
}

/** What the sheet hands the label panel (the host adds the catalogue). */
export type UploadLabelPanelHostProps = {
  /** The files that can carry labels, in queue order. */
  items: readonly QueueItem[]
  /** Each file's labels now, by queue item id (for a panel mounting again). */
  initial: SaveLabelsInput[]
  /** Files that can no longer be labelled (failed for good). */
  disabledIds: string[]
  /** One input per file; assetId is the queue item id. */
  onChange: (venueId: string, inputs: SaveLabelsInput[]) => void
  /** True while a choice in the panel is incomplete. */
  onPendingChange: (pending: boolean) => void
}

/** What the sheet hands the "Fix labels" dialog. */
export type UploadLabelFixProps = {
  item: QueueItem
  assetId: string
  /** The stored labels, addressed to the asset. */
  draft: SaveLabelsInput
  problem: { code: SaveLabelsErrorCode; message: string } | null
  onClose: () => void
  /** Saves now (the asset is ready); the dialog closes only on success. */
  onSave: (input: SaveLabelsInput) => Promise<SaveLabelsResult>
}

export type UploadLabels = {
  /** Which files may carry labels (Add's general uploads, not task screens'). */
  canLabel?: (file: File) => boolean
  /**
   * Labels a file starts with (Our menu's dish, applied by default). Undefined
   * while that cannot be told yet (the menu is loading): asked again later.
   */
  seed?: (
    item: QueueItem
  ) => { venueId: string; input: SaveLabelsInput } | null | undefined
  save: (
    venueId: string,
    input: SaveLabelsInput
  ) => Promise<UploadLabelPostResult>
  /** Discard what the server keeps for the asset; resolves false on failure. */
  discard: (assetId: string) => Promise<boolean>
  /** The person's kept labels (pending or needing attention); null on failure. */
  attention: () => Promise<PendingLabelItem[] | null>
  /** Names of the menu items in an input, for the "Saved · …" line. */
  itemNames?: (input: SaveLabelsInput) => string[]
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
  /** Retry re-asks whether finalise applied them, instead of sending. */
  recheck: boolean
  code: SaveLabelsErrorCode | null
  message: string | null
  summary: MediaLabelSummary | null
  /** The finalise outcome already taken into account. */
  outcome: UploadLabelOutcome | null
  conflictRetried: boolean
}

/** How one file's labels look in the sheet. */
export type LabelView =
  | { kind: "none" }
  | { kind: "saving" }
  | { kind: "saved"; names: string[] }
  | { kind: "retry" }
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

export function isEmptyInput(input: SaveLabelsInput) {
  return (
    input.items.length === 0 &&
    input.contentTypes.length === 0 &&
    !input.note &&
    !input.missingItem
  )
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

const EMPTY_KEY = keyOf({
  assetId: "",
  expectedRevision: 0,
  catalogueVersionId: null,
  contentTypes: [],
  note: null,
  items: [],
  missingItem: null,
})

function newRecord(venueId: string, input: SaveLabelsInput): LabelRecord {
  return {
    venueId,
    input,
    phase: "draft",
    revision: 0,
    sent: null,
    sentTo: null,
    held: false,
    recheck: false,
    code: null,
    message: null,
    summary: null,
    outcome: null,
    conflictRetried: false,
  }
}

const lostFile = (item: QueueItem) =>
  item.status === "failed" && item.retryable === false

export function useUploadLabels(
  items: readonly QueueItem[],
  config: UploadLabels | undefined,
  paused: boolean
) {
  const [records, setRecords] = React.useState<Record<string, LabelRecord>>({})
  // Per file: the request in flight, and the last asset+input attempted (so a
  // render never sends the same thing twice).
  const inFlight = React.useRef(new Set<string>())
  const attempted = React.useRef(new Map<string, string>())
  const seedAsked = React.useRef(new Set<string>())

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

  // Labels a file starts with (the dish it was picked for).
  React.useEffect(() => {
    if (!config?.seed) return
    const seeds: Record<string, LabelRecord> = {}
    for (const item of labelable) {
      if (records[item.id] || seedAsked.current.has(item.id)) continue
      const seed = config.seed(item)
      if (seed === undefined) continue
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
      if (!record || inFlight.current.has(item.id)) continue

      // Finalise reported what it did with the labels the server kept.
      if (item.labels && record.outcome !== item.labels) {
        const outcome = item.labels
        inFlight.current.add(item.id)
        void Promise.resolve().then(() => {
          inFlight.current.delete(item.id)
          if (outcome.state === "saved" && item.assetId)
            config.onSaved?.(item.assetId)
          patch(item.id, (r) => {
            if (r.phase !== "pending") return { ...r, outcome }
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
              message: outcome.message,
            }
          })
        })
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
        void config
          .attention()
          .catch(() => null)
          .then((rows) => {
            inFlight.current.delete(item.id)
            const row = rows?.find((r) => r.assetId === assetId)
            if (rows && !row) config.onSaved?.(assetId)
            patch(item.id, (r) => {
              if (!rows) return { ...r, phase: "retry", recheck: true }
              // Applied by finalise (it is no longer kept).
              if (!row)
                return { ...r, phase: "saved", held: false, recheck: false }
              if (row.status === "needs_attention")
                return {
                  ...r,
                  phase: "attention",
                  held: true,
                  recheck: false,
                  code: row.code,
                  message: row.message ?? MENU_CHANGED,
                }
              // Still kept although the asset is ready: send it again.
              attempted.current.delete(item.id)
              return { ...r, sent: null, phase: "draft", recheck: false }
            })
          })
        continue
      }

      const key = keyOf(record.input)
      const attempt = `${assetId}|${key}`
      if (attempted.current.get(item.id) === attempt) continue
      if (record.sent === key && record.sentTo === assetId) continue

      if (key === EMPTY_KEY) {
        if (record.sent === null) continue
        if (record.phase !== "saved" || record.sentTo !== assetId) {
          // Cleared before they reached the photo: discard what is kept.
          attempted.current.set(item.id, attempt)
          const keptFor = record.sentTo
          inFlight.current.add(item.id)
          void (keptFor ? config.discard(keptFor) : Promise.resolve(true))
            .catch(() => false)
            .then((ok) => {
              inFlight.current.delete(item.id)
              patch(item.id, (r) =>
                ok
                  ? {
                      ...r,
                      phase: "draft",
                      sent: null,
                      sentTo: null,
                      held: false,
                      code: null,
                      message: null,
                    }
                  : { ...r, phase: "retry" }
              )
            })
          continue
        }
        // Already on the photo: saving the empty set clears them.
      }

      attempted.current.set(item.id, attempt)
      inFlight.current.add(item.id)
      const input = {
        ...record.input,
        assetId,
        expectedRevision: record.revision,
      }
      void Promise.resolve()
        .then(() => config.save(record.venueId, input))
        .catch(() => null)
        .then((result) => {
          inFlight.current.delete(item.id)
          if (result?.ok && result.state === "saved") config.onSaved?.(assetId)
          patch(item.id, (r) => {
            if (!result || (!result.ok && result.code === "unavailable"))
              return { ...r, phase: "retry", recheck: false }
            if (result.ok && result.state === "saved") {
              return {
                ...r,
                phase: "saved",
                sent: key,
                sentTo: assetId,
                held: false,
                revision: result.labels.revision,
                summary: result.labels,
                code: null,
                message: null,
              }
            }
            if (result.ok)
              return {
                ...r,
                phase: "pending",
                sent: key,
                sentTo: assetId,
                held: true,
                code: null,
                message: null,
              }
            if (
              result.code === "conflict" &&
              result.current &&
              !r.conflictRetried
            ) {
              // The photo got labels meanwhile (finalise applied an earlier
              // choice): send this choice again over them, once.
              attempted.current.delete(item.id)
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
              message: MENU_CODES.has(result.code)
                ? MENU_CHANGED
                : result.message,
            }
          })
        })
    }
  }, [labelable, records, config, paused, patch])

  function view(item: QueueItem): LabelView {
    const record = records[item.id]
    if (!record) return { kind: "none" }
    const empty = isEmptyInput(record.input)
    if (empty && (record.sent === null || record.sent === EMPTY_KEY))
      return { kind: "none" }
    if (lostFile(item)) return empty ? { kind: "none" } : { kind: "lost" }
    if (record.phase === "retry") return { kind: "retry" }
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
        ? record.summary.items.map((i) =>
            i.variantName ? `${i.name} (${i.variantName})` : i.name
          )
        : (config?.itemNames?.(record.input) ?? [])
      return { kind: "saved", names }
    }
    return { kind: "saving" }
  }

  /** Not yet kept on the server (lost if the page goes now). */
  function unstored(item: QueueItem) {
    const record = records[item.id]
    const kind = view(item).kind
    if (!record || kind === "none" || kind === "saved" || kind === "lost")
      return false
    return !record.held || record.sent !== keyOf(record.input)
  }

  return {
    labelable,
    view,
    unstored,
    /** Each file's labels now (assetId = queue item id), for the panel. */
    initial: labelable.flatMap((item) =>
      records[item.id] ? [records[item.id].input] : []
    ),
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
    retry(id: string) {
      attempted.current.delete(id)
      patch(id, (r) =>
        r.phase !== "retry"
          ? r
          : r.recheck
            ? { ...r, phase: "pending", recheck: false }
            : { ...r, phase: "draft" }
      )
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
        .catch(() => null)
      if (!result)
        return {
          ok: false,
          assetId,
          code: "unavailable",
          message: LABELS_NOT_SAVED,
        }
      if (!result.ok) return result
      const key = keyOf(input)
      attempted.current.set(item.id, `${assetId}|${key}`)
      patch(item.id, (r) => ({
        ...r,
        input: { ...input, assetId: item.id },
        phase: result.state === "saved" ? "saved" : "pending",
        sent: key,
        sentTo: assetId,
        held: result.state !== "saved",
        revision:
          result.state === "saved" ? result.labels.revision : r.revision,
        summary: result.state === "saved" ? result.labels : r.summary,
        code: null,
        message: null,
      }))
      if (result.state === "saved") config.onSaved?.(assetId)
      return result.state === "saved"
        ? { ok: true, assetId, labels: result.labels }
        : { ok: true, assetId, labels: record.summary ?? emptySummary() }
    },
    /** The file left the queue: discard what the server keeps for it. */
    discard(item: QueueItem) {
      const record = records[item.id]
      attempted.current.delete(item.id)
      seedAsked.current.delete(item.id)
      if (record?.held && record.sentTo) void config?.discard(record.sentTo)
      setRecords((current) => {
        if (!current[item.id]) return current
        const next = { ...current }
        delete next[item.id]
        return next
      })
    },
    reset() {
      attempted.current.clear()
      seedAsked.current.clear()
      setRecords({})
    },
  }
}

function emptySummary(): MediaLabelSummary {
  return {
    revision: 0,
    contentTypes: [],
    note: null,
    items: [],
    missingItem: null,
    hasLabels: false,
    updatedAt: null,
  }
}
