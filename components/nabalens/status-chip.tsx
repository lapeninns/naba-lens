import {
  ArrowUUpLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  ForkKnifeIcon,
  InfoIcon,
  LockSimpleIcon,
  MinusCircleIcon,
  MinusIcon,
  PencilSimpleIcon,
  TagIcon,
  TargetIcon,
  UserIcon,
  UsersIcon,
  WarningCircleIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr"
import type { Icon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * The chip's tone: the meaning in colour, which only repeats the word.
 * Common Room draws each state in its own shape too (see CHIP_SHAPES): a
 * state never depends on telling green from red.
 */
export type ChipTone =
  "neutral" | "positive" | "attention" | "negative" | "pending" | "closed"

/**
 * Common Room state shapes (DESIGN.md §3). pill = round, square = 4px,
 * stamp = 2px with a double border. Reserved: the filled ok square
 * (`accepted`) is Accepted's alone; the round info outline (`ready`) is
 * Ready's alone; the stamp (`complete`) is Complete's alone; the dashed
 * hatched square (`setup`) is Needs setup's and Needs verification's alone.
 */
export const CHIP_SHAPES = {
  ready: "rounded-round border-info-fg text-info-fg",
  submitted: "rounded-round border-border-strong text-ink",
  accepted: "rounded-square border-ok-bg bg-ok-bg text-ok-fg",
  needs: "rounded-round border-warn-fg bg-warn-bg text-warn-fg",
  closed: "rounded-square border-line bg-surface-2 text-ink-muted",
  overdue: "rounded-square border-warn-fg text-warn-fg",
  complete:
    "rounded-stamp border-4 border-double border-stamp-fg py-px font-display font-extrabold tracking-[0.06em] text-stamp-fg uppercase",
  setup:
    "rounded-square border-2 border-dashed border-ink-muted bg-hatch text-ink",
  na: "rounded-square border-2 border-dotted border-ink-muted text-ink-muted",
  progress: "rounded-round border-line bg-surface-2 text-ink",
  met: "rounded-square border-ok-fg text-ok-fg",
  self: "rounded-square border-info-fg bg-info-bg text-info-fg",
  present: "rounded-square border-ok-fg text-ok-fg",
  waiting: "rounded-round border-dashed border-border-strong text-ink",
  neutralSquare: "rounded-square border-border-strong text-ink",
  menuActive: "rounded-square border-border-strong bg-surface-2 text-ink",
  changed:
    "rounded-square border-border-strong border-l-[5px] border-l-warn-fg text-ink",
  plain: "rounded-round border-transparent bg-surface-2 text-ink",
  /** Problem with a fill (tone-only negative): square, warn tint and edge. */
  warnSquare: "rounded-square border-warn-fg bg-warn-bg text-warn-fg",
  /** Upload pipeline: words in mono beside the file, no box. */
  upload:
    "rounded-none border-transparent px-0 font-mono font-semibold text-ink",
  uploadMuted:
    "rounded-none border-transparent px-0 font-mono font-semibold text-ink-muted",
  uploadFailed:
    "rounded-none border-transparent px-0 font-mono font-semibold text-warn-fg",
} as const

export type ChipShape = keyof typeof CHIP_SHAPES

/** The shape for a tone when a chip has no fixed state (counts, dates…). */
const TONE_SHAPE: Record<ChipTone, ChipShape> = {
  neutral: "plain",
  positive: "met",
  attention: "overdue",
  negative: "warnSquare",
  pending: "waiting",
  closed: "closed",
}

type ChipState = {
  word: string
  tone: ChipTone
  icon?: Icon
  struck?: boolean
  shape?: ChipShape
}

/**
 * The fixed words from the system's States and words table, keyed by the
 * service's state names. Never add a synonym (Approved, Rejected, Done…).
 */
export const CHIP_STATES = {
  // A file uploading (technical only, never an approval)
  selected: { word: "Ready to upload", tone: "pending", shape: "upload" },
  queued: {
    word: "Waiting",
    tone: "pending",
    icon: ClockIcon,
    shape: "uploadMuted",
  },
  uploading: {
    word: "Uploading",
    tone: "pending",
    icon: ArrowUpIcon,
    shape: "upload",
  },
  processing: {
    word: "Processing",
    tone: "pending",
    icon: ClockIcon,
    shape: "upload",
  },
  failed: {
    word: "Failed",
    tone: "negative",
    icon: WarningCircleIcon,
    shape: "uploadFailed",
  },
  cancelled: {
    word: "Cancelled",
    tone: "closed",
    icon: XIcon,
    shape: "uploadMuted",
  },
  // A sent photo
  submitted: {
    word: "Submitted",
    tone: "pending",
    icon: ArrowUpIcon,
    shape: "submitted",
  },
  accepted: {
    word: "Accepted",
    tone: "positive",
    icon: CheckIcon,
    shape: "accepted",
  },
  needs_another_photo: {
    word: "Needs another photo",
    tone: "attention",
    icon: ArrowUUpLeftIcon,
    shape: "needs",
  },
  closed: {
    word: "Closed",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  self_review: {
    word: "Self-review",
    tone: "attention",
    icon: InfoIcon,
    shape: "self",
  },
  // A person's month and a checklist item
  needs_setup: {
    word: "Needs setup",
    tone: "attention",
    icon: WrenchIcon,
    shape: "setup",
  },
  target_met: {
    word: "Target met",
    tone: "positive",
    icon: TargetIcon,
    shape: "met",
  },
  complete: {
    word: "Complete",
    tone: "positive",
    icon: CheckIcon,
    shape: "complete",
  },
  not_applicable: {
    word: "Not applicable",
    tone: "closed",
    icon: MinusCircleIcon,
    shape: "na",
  },
  retired: {
    word: "Retired",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  needs_reassignment: {
    word: "Needs reassignment",
    tone: "attention",
    icon: UsersIcon,
    shape: "overdue",
  },
  overdue: {
    word: "Overdue",
    tone: "negative",
    icon: ClockIcon,
    shape: "overdue",
  },
  read_only: {
    word: "Read-only",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  // An amenity fact (service names present / absent / unknown)
  present: {
    word: "Present",
    tone: "neutral",
    icon: CheckIcon,
    shape: "present",
  },
  absent: {
    word: "Not present",
    tone: "closed",
    icon: MinusIcon,
    shape: "closed",
  },
  unknown: {
    word: "Needs verification",
    tone: "attention",
    icon: WrenchIcon,
    shape: "setup",
  },
  // A venue's menu coverage
  no_active_menu: {
    word: "No active menu",
    tone: "neutral",
    icon: ForkKnifeIcon,
    shape: "plain",
  },
  coverage_needs_setup: {
    word: "Menu coverage needs setup",
    tone: "attention",
    icon: WrenchIcon,
    shape: "setup",
  },
  menu_changed: {
    word: "Menu changed — review coverage",
    tone: "attention",
    icon: ForkKnifeIcon,
    shape: "changed",
  },
  coverage_current: {
    word: "Menu coverage is current",
    tone: "positive",
    icon: CheckIcon,
    shape: "plain",
  },
  // A menu version
  draft: {
    word: "Draft",
    tone: "pending",
    icon: PencilSimpleIcon,
    shape: "waiting",
  },
  active_menu: {
    word: "Active · for labelling only",
    tone: "positive",
    icon: ForkKnifeIcon,
    shape: "menuActive",
  },
  retired_menu: {
    word: "Retired",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  discarded: {
    word: "Discarded",
    tone: "closed",
    icon: XIcon,
    struck: true,
    shape: "closed",
  },
  // An account: the normal state is quiet
  active: {
    word: "Active",
    tone: "neutral",
    icon: UserIcon,
    shape: "neutralSquare",
  },
  invited: {
    word: "Invited",
    tone: "pending",
    icon: EnvelopeSimpleIcon,
    shape: "waiting",
  },
  inactive: {
    word: "Inactive",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  // A manager grant: In effect (neutral outline square) / not in effect (grey)
  venue_manager: {
    word: "Venue manager",
    tone: "neutral",
    icon: FileTextIcon,
    shape: "neutralSquare",
  },
  revoked: {
    word: "Revoked by an admin",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  ended_moved: {
    word: "Ended: moved to another venue",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  ended_deactivated: {
    word: "Ended: account deactivated",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  // Labels: a finding aid, not a status
  needs_labels: {
    word: "Needs labels",
    tone: "neutral",
    icon: TagIcon,
    shape: "plain",
  },
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

// Common Room chip: 32px, 17px bold, icon + word. A long word ("Ended:
// moved to another venue") wraps inside the chip rather than pushing a 320px
// or zoomed page sideways. The shape class (CHIP_SHAPES) sets radius, edge,
// fill and colour.
export const chipClassName =
  "inline-flex max-w-full min-h-8 items-center gap-1.5 border-[1.5px] border-transparent bg-transparent py-0.5 pr-3 pl-2 text-left text-chip align-middle whitespace-normal [overflow-wrap:anywhere] [&_svg]:size-[18px] [&_svg]:shrink-0"

type StatusChipProps = {
  className?: string
  title?: string
  /** Override the drawn shape (keep it to the reserved rules in §3). */
  shape?: ChipShape
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
 * A short word for the state of one thing. The word is the meaning; shape and
 * tone only repeat it. Ready media gets no chip at all.
 */
export function StatusChip(props: StatusChipProps) {
  const known = props.state !== undefined ? chipState(props.state) : null
  const tone = props.tone ?? known?.tone ?? "neutral"
  // A tone given with a known state recolours the meaning: draw its shape.
  const shape: ChipShape =
    props.shape ??
    (props.tone && known && props.tone !== known.tone
      ? TONE_SHAPE[props.tone]
      : (known?.shape ?? TONE_SHAPE[tone]))
  // The state's icon belongs to its own shape; a redrawn chip goes without.
  const Icon = known && shape === known.shape ? known.icon : undefined
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      data-shape={shape}
      data-state={props.state}
      title={props.title}
      className={cn(
        chipClassName,
        CHIP_SHAPES[shape],
        known?.struck && "line-through decoration-1",
        props.className
      )}
    >
      {Icon ? <Icon aria-hidden weight="bold" /> : null}
      {props.children ?? known?.word}
    </span>
  )
}

/**
 * A count for work waiting on this person (`nl-count`): a mono number on a
 * disc. `tone="warn"` is the tab bar's count (photos to review, things to
 * do); the default is a quiet ink disc.
 */
export function CountBadge({
  count,
  label,
  tone = "neutral",
  className,
}: {
  count: number
  /** Accessible text after the number, e.g. "to review", "things to do". */
  label: string
  tone?: "neutral" | "warn"
  className?: string
}) {
  if (count <= 0) return null
  return (
    <span
      data-slot="count"
      data-tone={tone}
      className={cn(
        "inline-grid h-[26px] min-w-[26px] place-items-center rounded-round px-[7px] font-mono text-[1.0625rem] leading-none font-bold tabular-nums",
        tone === "warn" ? "bg-warn-fg text-surface" : "bg-ink text-surface",
        className
      )}
    >
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  )
}
