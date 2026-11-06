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
 * the notice can take focus, for when the control that acted has gone.
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
    <div aria-live="polite" className="empty:hidden">
      {notice ? (
        <NoticeBox
          ref={ref}
          tabIndex={ref ? -1 : undefined}
          role="status"
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
