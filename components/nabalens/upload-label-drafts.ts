"use client"

import * as React from "react"

import type { SaveLabelsInput, SaveLabelsResult } from "@/lib/menus/types"

import type { QueueItem } from "./upload-queue"

export type UploadDraftEditorProps = {
  items: readonly QueueItem[]
  onClose: () => void
  onQueue: (venueId: string, inputs: SaveLabelsInput[]) => void
}

export type UploadLabelDrafts = {
  renderEditor: (props: UploadDraftEditorProps) => React.ReactNode
  canDraft?: (file: File) => boolean
  save: (venueId: string, input: SaveLabelsInput) => Promise<SaveLabelsResult>
  onSaved?: (assetId: string) => void
}

type Draft = {
  venueId: string
  input: SaveLabelsInput
} & (
  | { status: "queued" | "saved" }
  | { status: "error"; message: string; retryable: boolean }
)

export function useUploadLabelDrafts(
  items: readonly QueueItem[],
  config: UploadLabelDrafts | undefined,
  paused: boolean
) {
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const inFlight = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (!config || paused) return
    for (const item of items) {
      const draft = drafts[item.id]
      const assetId = item.assetId
      if (
        draft?.status !== "queued" ||
        item.status !== "done" ||
        !assetId ||
        inFlight.current.has(item.id)
      )
        continue

      inFlight.current.add(item.id)
      void Promise.resolve()
        .then(() => config.save(draft.venueId, { ...draft.input, assetId }))
        .then((result): Draft => {
          if (result.ok && result.assetId === assetId) {
            config.onSaved?.(assetId)
            return { ...draft, status: "saved" }
          }
          if (result.ok) throw new Error("Save could not be confirmed")
          return {
            ...draft,
            status: "error",
            message: result.message,
            retryable: result.code === "unavailable",
          }
        })
        .catch((): Draft => ({
          ...draft,
          status: "error",
          message: "Saving labels could not be confirmed. Try again.",
          retryable: true,
        }))
        .then((next) => {
          inFlight.current.delete(item.id)
          setDrafts((current) =>
            current[item.id] === draft
              ? { ...current, [item.id]: next }
              : current
          )
        })
    }
  }, [items, drafts, config, paused])

  function discard(id: string) {
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  return {
    drafts,
    waiting: items.filter(
      (i) => drafts[i.id] && drafts[i.id].status !== "saved"
    ).length,
    stage(venueId: string, inputs: SaveLabelsInput[]) {
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(
          inputs.map(
            (input) =>
              [input.assetId, { venueId, input, status: "queued" }] as const
          )
        ),
      }))
    },
    retry(id: string) {
      setDrafts((current) => {
        const draft = current[id]
        return draft?.status === "error" && draft.retryable
          ? { ...current, [id]: { ...draft, status: "queued" } }
          : current
      })
    },
    discard,
    reset: () => setDrafts({}),
  }
}
