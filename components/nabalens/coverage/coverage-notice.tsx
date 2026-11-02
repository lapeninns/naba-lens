"use client"

import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export type Notice = { tone: "success" | "error" | "warning"; text: string }

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
        <Alert
          ref={ref}
          tabIndex={ref ? -1 : undefined}
          role="status"
          variant={
            notice.tone === "error"
              ? "destructive"
              : notice.tone === "warning"
                ? "warning"
                : "default"
          }
          className="flex items-start gap-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {notice.tone === "success" ? (
            <CheckCircleIcon aria-hidden className="mt-0.5" />
          ) : (
            <WarningIcon aria-hidden className="mt-0.5" />
          )}
          <AlertDescription className="flex-1">{notice.text}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </Alert>
      ) : null}
    </div>
  )
}
