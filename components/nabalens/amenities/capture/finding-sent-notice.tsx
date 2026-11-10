"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"

import { Notice } from "../../notice"
import { FINDING_SENT_PARAM } from "./finding-sent"

/** What Home says about the send; without it, the legacy "check complete". */
export type FindingSentCopy = {
  title: string
  /** After the question. */
  body: string
  /** The recognition line, on its own line; never a promise. */
  extra?: string | null
  tone?: "positive" | "info" | "plain"
}

const LEGACY: FindingSentCopy = {
  title: "Finding sent",
  body: "The check is complete.",
  tone: "positive",
}

/**
 * "Finding sent" on Home after an amenity check, until dismissed or the
 * person moves on. It takes focus on arrival: the form that sent it is gone.
 * Dismiss hands focus to `returnFocusId` (focusable with tabIndex -1), as the
 * button that had it disappears. On a working-list question the words follow
 * what happened to the finding (design §4.3).
 */
export function FindingSentNotice({
  question,
  returnFocusId,
  copy = LEGACY,
}: {
  question: string
  returnFocusId: string
  copy?: FindingSentCopy
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(true)

  React.useEffect(() => {
    ref.current?.focus()
  }, [])

  if (!open) return null

  function dismiss() {
    document.getElementById(returnFocusId)?.focus()
    setOpen(false)
    // A reload after Dismiss must not bring the notice back.
    const url = new URL(window.location.href)
    url.searchParams.delete(FINDING_SENT_PARAM)
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    )
  }

  return (
    <Notice
      ref={ref}
      tabIndex={-1}
      tone={copy.tone ?? "positive"}
      role="status"
      title={copy.title}
      action={
        <Button variant="quiet" size="touch" onClick={dismiss}>
          Dismiss
        </Button>
      }
    >
      <span className="[overflow-wrap:anywhere]">{question}</span> {copy.body}
      {copy.extra ? <span className="block">{copy.extra}</span> : null}
    </Notice>
  )
}
