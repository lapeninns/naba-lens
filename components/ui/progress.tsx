"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "@/lib/utils"

/**
 * A Common Room bar: 8px, rounded, grey track with a hairline edge. `tone`
 * "accepted" (default) fills green, because progress means accepted photos;
 * "neutral" fills ink, for technical progress such as an upload. Blue never
 * marks progress. Always pair it with the words ("3 of 5 accepted").
 */
function Progress({
  className,
  children,
  value,
  tone = "accepted",
  ...props
}: ProgressPrimitive.Root.Props & { tone?: "accepted" | "neutral" }) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      data-tone={tone}
      className={cn("group/progress flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-[4px] bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full rounded-[4px] bg-ok-fg transition-all group-data-[tone=neutral]/progress:bg-ink",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-label text-ink", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto font-mono text-meta-strong text-ink-muted tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
