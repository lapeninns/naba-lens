import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * Progress (common-room.md §4). One component, two modes.
 *
 * `segments`: one rounded segment per unit, green when accepted, striped
 * while submitted and waiting, warn with a heavy edge when a reviewer asked
 * for another photo, grey with an edge while still needed. Above 12 units
 * the segments merge into one bar with the same fills. In that order:
 * accepted, waiting, needs another, still needed (goals plan, decision 13).
 *
 * `bar` (the default): a continuous 8px bar. It fills with ink (`neutral`,
 * the default: any share, or technical progress such as an upload). Tone
 * `ok` (green) is only for a bar that counts accepted work.
 *
 * Blue never marks progress, and progress is never colour alone: a label in
 * words ("3 of 5 accepted") is required, shown or for screen readers only.
 */

/** Above this many units the segments merge into one bar. */
const MAX_SEGMENTS = 12

type ProgressSize = "md" | "sm"
type ProgressTone = "ok" | "neutral"

/*
 * The words that go with the bar. `label` is shown above it (or hidden with
 * `labelHidden`); `aria-label` and `aria-labelledby` are for a bar whose
 * words are already written beside it.
 */
type ProgressLabelling =
  | {
      label: React.ReactNode
      labelHidden?: boolean
      "aria-label"?: undefined
      "aria-labelledby"?: undefined
    }
  | {
      label?: undefined
      labelHidden?: undefined
      "aria-label": string
      "aria-labelledby"?: undefined
    }
  | {
      label?: undefined
      labelHidden?: undefined
      "aria-label"?: undefined
      "aria-labelledby": string
    }

type ProgressCommon = {
  /** md is the default; sm is the compact form for table cells and rows. */
  size?: ProgressSize
  /** What a screen reader says for the value, when the default will not do. */
  valueText?: string
  "aria-valuetext"?: string
  className?: string
  id?: string
}

type ProgressBarProps = ProgressCommon &
  ProgressLabelling & {
    mode?: "bar"
    /** Out of `max`. `null` means the amount is not known yet. */
    value: number | null
    max?: number
    /**
     * `neutral` (ink, the default) for any share or technical progress;
     * `ok` (green) only where the bar counts accepted work.
     */
    tone?: ProgressTone
    /** Extra parts drawn above the bar. */
    children?: React.ReactNode
  }

type ProgressSegmentsProps = ProgressCommon &
  ProgressLabelling & {
    mode: "segments"
    /** Units accepted (green). */
    accepted: number
    /** Units sent and waiting for a decision (striped). */
    submitted?: number
    /** Units a reviewer asked to be taken again (warn). */
    needsAnother?: number
    /** Units needed in all; the rest are grey. */
    total: number
    /**
     * Words for a key under the bar, from the area's copy. Pass only the
     * kinds that appear.
     */
    keyLabels?: {
      accepted?: string
      submitted?: string
      needsAnother?: string
      needed?: string
    }
  }

type ProgressProps = ProgressBarProps | ProgressSegmentsProps

/*
 * Forced colours drop fills and box-shadow edges, so each kind keeps a
 * border there: accepted is solid, submitted keeps its stripes inside an
 * outline, needs another is a dashed outline, still needed is an empty
 * outline.
 */
const FILL = {
  accepted: "bg-ok-fg forced-colors:border-6",
  submitted: "bg-stripe forced-colors:border",
  needsAnother:
    "bg-warn-bg edge-invalid forced-colors:border-2 forced-colors:border-dashed",
  needed: "bg-surface-2 edge-strong forced-colors:border",
} as const

const SEGMENT_HEIGHT = { md: "h-3", sm: "h-2" } as const

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function Progress(props: ProgressProps) {
  const {
    size = "md",
    label,
    labelHidden = false,
    valueText,
    className,
    id,
  } = props
  const generatedId = React.useId()
  const labelId = `${id ?? generatedId}-label`
  const hasLabel = label !== undefined && label !== null
  const words = typeof label === "string" ? label : undefined
  const naming = hasLabel
    ? { "aria-labelledby": labelId }
    : {
        "aria-label": props["aria-label"],
        "aria-labelledby": props["aria-labelledby"],
      }
  const labelNode = hasLabel ? (
    <ProgressLabel id={labelId} className={cn(labelHidden && "sr-only")}>
      {label}
    </ProgressLabel>
  ) : null
  const spoken = valueText ?? props["aria-valuetext"]

  if (props.mode === "segments") {
    const total = Math.max(0, Math.floor(props.total))
    const ok = clamp(Math.floor(props.accepted), 0, total)
    const sent = clamp(Math.floor(props.submitted ?? 0), 0, total - ok)
    const redo = clamp(
      Math.floor(props.needsAnother ?? 0),
      0,
      total - ok - sent
    )
    const merged = total === 0 || total > MAX_SEGMENTS
    const keyLabels = props.keyLabels
    const height = SEGMENT_HEIGHT[size]
    return (
      <div
        id={id}
        data-slot="progress"
        data-mode="segments"
        data-size={size}
        data-tone="ok"
        className={cn(
          "grid min-w-0",
          size === "sm" ? "gap-1.5" : "gap-2.5",
          className
        )}
      >
        {labelNode}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={ok}
          aria-valuetext={spoken ?? words ?? `${ok} of ${total}`}
          data-slot="progress-track"
          data-merged={merged ? "" : undefined}
          className={cn(
            merged
              ? cn(
                  "flex overflow-hidden rounded-round forced-colors:border",
                  height,
                  "bg-surface-2 edge-strong"
                )
              : "grid gap-1"
          )}
          style={
            merged
              ? undefined
              : { gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }
          }
          {...naming}
        >
          {merged ? (
            <>
              {ok > 0 ? (
                <i
                  data-slot="progress-segment"
                  data-state="accepted"
                  className={cn("block h-full", FILL.accepted)}
                  style={{ width: `${(ok / total) * 100}%` }}
                />
              ) : null}
              {sent > 0 ? (
                <i
                  data-slot="progress-segment"
                  data-state="submitted"
                  className="block h-full bg-stripe"
                  style={{ width: `${(sent / total) * 100}%` }}
                />
              ) : null}
              {redo > 0 ? (
                <i
                  data-slot="progress-segment"
                  data-state="needsAnother"
                  className={cn("block h-full", FILL.needsAnother)}
                  style={{ width: `${(redo / total) * 100}%` }}
                />
              ) : null}
            </>
          ) : (
            Array.from({ length: total }, (_, index) => {
              const state =
                index < ok
                  ? "accepted"
                  : index < ok + sent
                    ? "submitted"
                    : index < ok + sent + redo
                      ? "needsAnother"
                      : "needed"
              return (
                <i
                  key={index}
                  data-slot="progress-segment"
                  data-state={state}
                  className={cn("block rounded-round", height, FILL[state])}
                />
              )
            })
          )}
        </div>
        {keyLabels ? (
          <p
            data-slot="progress-key"
            className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted"
          >
            {(["accepted", "submitted", "needsAnother", "needed"] as const).map(
              (kind) =>
                keyLabels[kind] ? (
                  <span key={kind} className="inline-flex items-center gap-1.5">
                    <i
                      aria-hidden
                      className={cn(
                        "block h-2.5 w-5.5 shrink-0 rounded-round",
                        FILL[kind]
                      )}
                    />
                    {keyLabels[kind]}
                  </span>
                ) : null
            )}
          </p>
        ) : null}
      </div>
    )
  }

  const max = props.max && props.max > 0 ? props.max : 100
  const known = typeof props.value === "number" && Number.isFinite(props.value)
  const percent = known
    ? clamp(((props.value as number) / max) * 100, 0, 100)
    : 0
  const tone: ProgressTone = props.tone ?? "neutral"
  return (
    <div
      id={id}
      data-slot="progress"
      data-mode="bar"
      data-size={size}
      data-tone={tone}
      className={cn(
        "group/progress grid min-w-0",
        size === "sm" ? "gap-1.5" : "gap-2.5",
        className
      )}
    >
      {labelNode}
      {props.children}
      <ProgressTrack
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={known ? clamp(props.value as number, 0, max) : undefined}
        aria-valuetext={
          spoken ?? (known ? `${Math.round(percent)}%` : undefined)
        }
        data-indeterminate={known ? undefined : ""}
        {...naming}
      >
        <ProgressIndicator percent={known ? percent : null} />
      </ProgressTrack>
    </div>
  )
}

/** The 8px track of a plain bar: grey, with a hairline edge. */
function ProgressTrack({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="progress-track"
      className={cn(
        "relative flex h-2 w-full items-center overflow-hidden rounded-square bg-surface-2 edge forced-colors:border",
        className
      )}
      {...props}
    />
  )
}

/**
 * The fill of a plain bar. `percent` is 0 to 100; `null` means the amount is
 * not known, drawn as stripes across the whole track (never as an empty bar,
 * which would read as nothing done).
 */
function ProgressIndicator({
  percent,
  className,
  style,
  ...props
}: React.ComponentProps<"div"> & { percent: number | null }) {
  const known = percent !== null
  return (
    <div
      data-slot="progress-indicator"
      className={cn(
        "h-full rounded-square transition-[width] duration-move",
        known
          ? "bg-ink group-data-[tone=ok]/progress:bg-ok-fg forced-colors:border-4"
          : "w-full bg-stripe",
        known && percent === 0 && "forced-colors:border-0",
        className
      )}
      style={known ? { width: `${clamp(percent, 0, 100)}%`, ...style } : style}
      {...props}
    />
  )
}

/** The words above a bar. Mono, so the numbers line up from row to row. */
function ProgressLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="progress-label"
      className={cn(
        "min-w-0 font-mono text-mono font-semibold wrap-break-word text-ink tabular-nums",
        className
      )}
      {...props}
    />
  )
}

/** A second figure beside the label, such as a percentage. */
function ProgressValue({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="progress-value"
      className={cn(
        "font-mono text-mono font-semibold text-ink-muted tabular-nums",
        className
      )}
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
  MAX_SEGMENTS,
  type ProgressProps,
  type ProgressSize,
  type ProgressTone,
}
