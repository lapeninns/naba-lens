"use client"

import * as React from "react"

const STORAGE_KEY = "nabalens.coverage-manage-intents"
/** Unsettled intents kept per tab; the oldest are dropped beyond this. */
const MAX_STORED = 50

type Store = Record<string, string>

function read(): Store {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Store)
      : {}
  } catch {
    return {}
  }
}

function write(store: Store) {
  try {
    const entries = Object.entries(store).slice(-MAX_STORED)
    if (entries.length === 0) window.sessionStorage.removeItem(STORAGE_KEY)
    else
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(entries))
      )
  } catch {
    // Storage unavailable (private mode, quota): the in-memory id still
    // covers retries within this page.
  }
}

/**
 * One request id per user intent. A retry of the same intent (same scope and
 * payload, after a network error, "try again" or a reload of the page) reuses
 * its id, so the server replays the original outcome instead of acting twice.
 * A changed payload gets a new id: reusing one with different input is a
 * conflict. Pending intents live in sessionStorage until settled.
 */
export function useRequestIds() {
  const intents = React.useRef(new Map<string, { key: string; id: string }>())

  const requestIdFor = React.useCallback(
    (scope: string, payload: unknown): string => {
      const key = `${scope}\n${JSON.stringify(payload ?? null)}`
      const current = intents.current.get(scope)
      if (current && current.key === key) return current.id
      const stored = read()[key]
      const id = stored ?? crypto.randomUUID()
      intents.current.set(scope, { key, id })
      if (!stored) write({ ...read(), [key]: id })
      return id
    },
    []
  )

  /** The intent finished (success, or a final answer): the next one is new. */
  const settle = React.useCallback((scope: string) => {
    const current = intents.current.get(scope)
    intents.current.delete(scope)
    if (!current) return
    const store = read()
    delete store[current.key]
    write(store)
  }, [])

  return React.useMemo(() => ({ requestIdFor, settle }), [requestIdFor, settle])
}
