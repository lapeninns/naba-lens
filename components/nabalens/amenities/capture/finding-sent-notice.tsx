"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"

import { Notice } from "../../notice"
import { FINDING_SENT_PARAM } from "./finding-sent"

/**
 * "Finding sent" on Home after an amenity check, until dismissed or the
 * person moves on. It takes focus on arrival: the form that sent it is gone.
 * Dismiss hands focus to `returnFocusId` (focusable with tabIndex -1), as the
 * button that had it disappears.
 */
export function FindingSentNotice({
  question,
  returnFocusId,
}: {
  question: string
  returnFocusId: string
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
      tone="positive"
      role="status"
      title="Finding sent"
      action={
        <Button variant="quiet" size="touch" onClick={dismiss}>
          Dismiss
        </Button>
      }
    >
      <span className="[overflow-wrap:anywhere]">{question}</span> The check is
      complete.
    </Notice>
  )
}
