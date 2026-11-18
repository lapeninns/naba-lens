"use client"

import * as React from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"

import { MATCH_COPY } from "./copy"

export type SpecialKind = "food" | "drinks"

export type SuggestSpecial = (
  name: string,
  kind: SpecialKind
) => Promise<{ ok: true } | { ok: false; message: string }>

/**
 * "Not on the menu?" under a search that found nothing (S1-MENUS hand-off,
 * spec §3.3 "staff suggest"): the searched words become a suggested local
 * special for the manager to decide. Two taps, no typing beyond the search
 * already made. The photo itself still needs an answer: I'm not sure lets
 * the manager match it once the special is added.
 */
export function SuggestSpecialRow({
  name,
  onSuggest,
}: {
  /** The search text, trimmed: the special's name. */
  name: string
  onSuggest: SuggestSpecial
}) {
  const [state, setState] = React.useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "done"; name: string }
    | { kind: "failed"; message: string }
  >({ kind: "idle" })
  const send = async (kind: SpecialKind) => {
    setState({ kind: "sending" })
    const result = await onSuggest(name, kind).catch(() => ({
      ok: false as const,
      message: "",
    }))
    setState(
      result.ok
        ? { kind: "done", name }
        : { kind: "failed", message: result.message }
    )
  }
  if (state.kind === "done")
    return (
      <p
        role="status"
        className="text-body text-ink"
        data-slot="match-special-done"
      >
        {MATCH_COPY.specialDone(state.name)}
      </p>
    )
  return (
    <div className="grid gap-2" data-slot="match-special">
      <p className="text-body text-ink">{MATCH_COPY.specialQuestion(name)}</p>
      <div className="flex flex-wrap gap-2">
        {(["food", "drinks"] as const).map((kind) => (
          <Button
            key={kind}
            type="button"
            variant="secondary"
            className="min-h-12 rounded-round"
            disabled={state.kind === "sending"}
            onClick={() => void send(kind)}
          >
            {MATCH_COPY.specialKind(kind)}
          </Button>
        ))}
      </div>
      {state.kind === "failed" ? (
        <Notice tone="negative" role="alert">
          {MATCH_COPY.specialFailed} {state.message}
        </Notice>
      ) : null}
    </div>
  )
}
