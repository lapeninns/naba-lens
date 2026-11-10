"use client"

import { Button } from "@/components/ui/button"

import { Notice as NoticeBox } from "../notice"

export type Notice = { tone: "success" | "error" | "warning"; text: string }

const TONE = {
  success: "positive",
  error: "negative",
  warning: "attention",
} as const

/**
 * Polite live region for the outcome of the last coverage action. With `ref`
 * the notice can take focus, for when the control that acted has gone. The
 * wrapper is the only live region and stays mounted, so the outcome is read
 * once: a status inside it would be a second, nested region.
 */
export function CoverageNotice({
  notice,
  onDismiss,
  ref,
}: {
  notice: Notice | null
  onDismiss: () => void
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      role="status"
      className="rounded-card outline-none empty:hidden focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      {notice ? (
        <NoticeBox
          role="none"
          tone={TONE[notice.tone]}
          action={
            <Button variant="quiet" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          }
        >
          {notice.text}
        </NoticeBox>
      ) : null}
    </div>
  )
}
