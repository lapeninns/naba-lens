"use client"

import * as React from "react"

/**
 * One request ID per user intent, as the coverage services require: the same
 * intent (same task + same photos) reuses its ID across retries, so a submit
 * whose response was lost replays instead of acting twice. Kept in
 * sessionStorage so a reload of a pending submit also replays; a changed
 * selection or a settled outcome starts a new ID.
 */

const STORAGE_KEY = "nabalens.task-submit-intents"

type Store = Record<string, string>

function read(): Store {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store) {
  try {
    if (Object.keys(store).length === 0) {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    }
  } catch {
    // Storage unavailable (private mode, quota): the in-memory ID still covers
    // retries within this page.
  }
}

export function intentKey(
  requirementId: string | null,
  assetIds: readonly string[],
  replacesSubmissionId: string | null = null
): string {
  return `${requirementId ?? "month"}:${replacesSubmissionId ?? ""}:${[...assetIds].sort().join(",")}`
}

export type RequestIntent = {
  /** The request ID for this intent, created on first use. */
  idFor: (key: string) => string
  /** The intent has a final outcome: the next attempt gets a new ID. */
  settle: (key: string) => void
}

export function useRequestIntent(
  newId: () => string = () => crypto.randomUUID()
): RequestIntent {
  const memory = React.useRef<Store>({})
  const makeId = React.useRef(newId)
  return React.useMemo(
    () => ({
      idFor(key) {
        const stored = memory.current[key] ?? read()[key]
        if (stored) {
          memory.current[key] = stored
          return stored
        }
        const id = makeId.current()
        memory.current[key] = id
        write({ ...read(), [key]: id })
        return id
      },
      settle(key) {
        delete memory.current[key]
        const store = read()
        delete store[key]
        write(store)
      },
    }),
    []
  )
}
