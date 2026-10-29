import { cn } from "@/lib/utils"

import { UPLOAD_STATE_LABEL } from "./format"
import type { UploadState } from "./types"

const tone: Record<UploadState, string> = {
  uploading: "bg-info-surface text-info",
  processing: "bg-warning-surface text-warning",
  ready: "bg-positive-surface text-positive",
  failed: "bg-negative-surface text-negative",
}

/** Technical pipeline state. Never an approval status. */
export function UploadStateBadge({
  state,
  className,
}: {
  state: UploadState
  className?: string
}) {
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium",
        tone[state],
        className
      )}
    >
      {UPLOAD_STATE_LABEL[state]}
    </span>
  )
}
