import {
  CheckCircleIcon,
  ClockCountdownIcon,
  ClockIcon,
  ProhibitIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"
import type { Icon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * solid = decided, dashed = waiting on someone, muted outline = closed, no
 * tone = a neutral fact. Attention and negative always carry their icon so a
 * state never depends on telling green from red.
 */
export type ChipTone =
  | "neutral"
  | "positive"
  | "attention"
  | "negative"
  | "pending"
  | "closed"

const TONE: Record<ChipTone, string> = {
  neutral: "bg-well text-ink",
  positive: "bg-positive-soft text-positive",
  attention: "bg-attention-soft text-attention",
  negative: "bg-negative-soft text-negative",
  pending: "border-dashed border-ink-muted bg-transparent text-ink-muted",
  // ink-muted, not ink-subtle: a closed chip often sits in a row with a hover
  // or press fill, where ink-subtle drops below 4.5:1.
  closed: "border-line bg-transparent text-ink-muted",
}

type ChipState = { word: string; tone: ChipTone; icon?: Icon; struck?: boolean }

/**
 * The fixed words from the system's States and words table, keyed by the
 * service's state names. Never add a synonym (Approved, Rejected, Done…).
 */
export const CHIP_STATES = {
  // A file uploading (technical only, never an approval)
  selected: { word: "Ready to upload", tone: "pending" },
  queued: { word: "Waiting", tone: "pending", icon: ClockIcon },
  uploading: { word: "Uploading", tone: "pending", icon: ClockIcon },
  processing: { word: "Processing", tone: "pending", icon: ClockIcon },
  failed: { word: "Failed", tone: "negative", icon: WarningCircleIcon },
  cancelled: { word: "Cancelled", tone: "closed" },
  // A sent photo
  submitted: { word: "Submitted", tone: "pending", icon: ClockIcon },
  accepted: { word: "Accepted", tone: "positive", icon: CheckCircleIcon },
  needs_another_photo: {
    word: "Needs another photo",
    tone: "attention",
    icon: WarningIcon,
  },
  closed: { word: "Closed", tone: "closed" },
  self_review: { word: "Self-review", tone: "attention", icon: WarningIcon },
  // A person's month and a checklist item
  needs_setup: { word: "Needs setup", tone: "attention", icon: WarningIcon },
  target_met: { word: "Target met", tone: "positive", icon: CheckCircleIcon },
  complete: { word: "Complete", tone: "positive", icon: CheckCircleIcon },
  not_applicable: {
    word: "Not applicable",
    tone: "closed",
    icon: ProhibitIcon,
  },
  retired: { word: "Retired", tone: "closed", icon: ProhibitIcon },
  needs_reassignment: {
    word: "Needs reassignment",
    tone: "attention",
    icon: WarningIcon,
  },
  overdue: { word: "Overdue", tone: "negative", icon: ClockCountdownIcon },
  read_only: { word: "Read-only", tone: "closed" },
  // An amenity fact (service names present / absent / unknown)
  present: { word: "Present", tone: "neutral" },
  absent: { word: "Not present", tone: "closed" },
  unknown: { word: "Needs verification", tone: "attention", icon: WarningIcon },
  // A venue's menu coverage
  no_active_menu: { word: "No active menu", tone: "neutral" },
  coverage_needs_setup: {
    word: "Menu coverage needs setup",
    tone: "attention",
    icon: WarningIcon,
  },
  menu_changed: {
    word: "Menu changed — review coverage",
    tone: "attention",
    icon: WarningIcon,
  },
  coverage_current: {
    word: "Menu coverage is current",
    tone: "positive",
    icon: CheckCircleIcon,
  },
  // A menu version
  draft: { word: "Draft", tone: "pending" },
  active_menu: { word: "Active · for labelling only", tone: "positive" },
  retired_menu: { word: "Retired", tone: "closed" },
  discarded: { word: "Discarded", tone: "closed", struck: true },
  // An account: the normal state is quiet
  active: { word: "Active", tone: "neutral" },
  invited: { word: "Invited", tone: "pending" },
  inactive: { word: "Inactive", tone: "closed", icon: ProhibitIcon },
  // A manager grant
  venue_manager: { word: "Venue manager", tone: "neutral" },
  revoked: { word: "Revoked by an admin", tone: "closed" },
  ended_moved: { word: "Ended: moved to another venue", tone: "closed" },
  ended_deactivated: { word: "Ended: account deactivated", tone: "closed" },
  // Labels: a finding aid, not a status
  needs_labels: { word: "Needs labels", tone: "neutral" },
} as const satisfies Record<string, ChipState>

export type ChipStateKey = keyof typeof CHIP_STATES

function humanise(key: string) {
  const words = key.replace(/[_-]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Word, tone and icon for a state key; unknown keys are neutral, never a crash. */
export function chipState(key: string): ChipState {
  return Object.hasOwn(CHIP_STATES, key)
    ? CHIP_STATES[key as ChipStateKey]
    : { word: humanise(key), tone: "neutral" }
}

// Below md a long word ("Ended: moved to another venue") wraps inside the chip
// rather than pushing a 320px or zoomed page sideways.
export const chipClassName =
  "inline-flex max-w-full min-h-[22px] items-center gap-1 rounded-chip border border-transparent px-[7px] text-chip-touch wdth-92 align-middle max-md:whitespace-normal md:text-chip md:whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0"

type StatusChipProps = {
  className?: string
  title?: string
} & (
  | {
      /** A key from CHIP_STATES (or a service state; unknown keys are neutral). */
      state: ChipStateKey | (string & {})
      /** Replaces the word (counts and dates: "2 labels", "Accepted late · …"). */
      children?: React.ReactNode
      tone?: ChipTone
    }
  | { state?: undefined; tone: ChipTone; children: React.ReactNode }
)

/**
 * A short word for the state of one thing. The word is the meaning; tone and
 * shape only repeat it. Ready media gets no chip at all.
 */
export function StatusChip(props: StatusChipProps) {
  const known = props.state !== undefined ? chipState(props.state) : null
  const tone = props.tone ?? known?.tone ?? "neutral"
  const Icon = known?.icon
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      data-state={props.state}
      title={props.title}
      className={cn(
        chipClassName,
        TONE[tone],
        known?.struck && "line-through decoration-1",
        props.className
      )}
    >
      {Icon ? <Icon aria-hidden /> : null}
      {props.children ?? known?.word}
    </span>
  )
}

/** A count for work waiting on this person (`nl-count`). */
export function CountBadge({
  count,
  label,
  className,
}: {
  count: number
  /** Accessible text after the number, e.g. "to review", "things to do". */
  label: string
  className?: string
}) {
  if (count <= 0) return null
  return (
    <span
      data-slot="count"
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-round bg-ink px-1.5 text-chip text-paper tabular-nums",
        className
      )}
    >
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  )
}
