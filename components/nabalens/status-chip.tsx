import {
  ArrowUUpLeftIcon,
  ArrowUpIcon,
  CameraIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  DownloadSimpleIcon,
  GlobeIcon,
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
  WarningIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr"
import type { Icon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * The chip's tone: the meaning in colour, which only repeats the word.
 * v2 draws five tones (docs/design-system/v2/GUIDELINES.md "Status
 * language"); these six names map onto them in V2_TONE.
 */
export type ChipTone =
  "neutral" | "positive" | "attention" | "negative" | "pending" | "closed"

/**
 * v2's five chip looks (StatusChip, `nl-chip--*`): neutral ink on
 * surface-sunken, progress sky, positive bottle, attention brass-ink on
 * brass-soft, and problem, the only solid chip, on-signal on signal.
 */
const V2_LOOK = {
  neutral: "bg-surface-2 text-ink",
  progress: "bg-info-bg text-info-fg",
  positive: "bg-ok-bg text-ok-fg",
  attention: "bg-warn-bg text-warn-fg",
  problem: "bg-signal text-on-signal",
} as const

export type V2Tone = keyof typeof V2_LOOK

/** The v2 tone each chip tone is drawn in. */
export const V2_TONE: Record<ChipTone, V2Tone> = {
  neutral: "neutral",
  closed: "neutral",
  pending: "progress",
  positive: "positive",
  attention: "attention",
  negative: "problem",
}

/**
 * The shape names states carry (and show as `data-shape`). Since D10 every
 * one is v2's pill in one of its five tones; the names stay so the states
 * table and the callers that pick a shape keep working. The upload shapes
 * are the exception v2 also makes: an upload's state is words beside the
 * file in its tone colour, with no box (UploadRow `nl-file__state`).
 */
export const CHIP_SHAPES = {
  ready: V2_LOOK.progress,
  submitted: V2_LOOK.progress,
  accepted: V2_LOOK.positive,
  needs: V2_LOOK.attention,
  closed: V2_LOOK.neutral,
  overdue: V2_LOOK.attention,
  complete: V2_LOOK.positive,
  setup: V2_LOOK.attention,
  na: V2_LOOK.neutral,
  progress: V2_LOOK.neutral,
  met: V2_LOOK.positive,
  self: V2_LOOK.attention,
  present: V2_LOOK.positive,
  waiting: V2_LOOK.progress,
  neutralSquare: V2_LOOK.neutral,
  menuActive: V2_LOOK.positive,
  changed: V2_LOOK.attention,
  plain: V2_LOOK.neutral,
  /** Problem: the solid signal chip. */
  warnSquare: V2_LOOK.problem,
  /** Upload pipeline: words beside the file, no box. */
  upload: "rounded-none bg-transparent px-0 text-label text-info-fg",
  uploadMuted: "rounded-none bg-transparent px-0 text-label text-ink-muted",
  uploadFailed: "rounded-none bg-transparent px-0 text-label text-signal",
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
 * The one "Approved" is FA-7's manager and admin name for a public
 * acceptance (`review_public`); staff see `outcome_public` instead.
 * Every other file reads its state words from here (CHIP_STATES or
 * chipState), never restates them.
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
    icon: WarningIcon,
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
    icon: CameraIcon,
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
  // A venue's setup checklist item (S2-ADMIN, spec §8 A2): needs_setup or
  // this.
  setup_in_place: {
    word: "In place",
    tone: "positive",
    icon: CheckIcon,
    shape: "met",
  },
  // A venue's operating status (S2-ADMIN, spec §8 A2; FA-33)
  venue_open: {
    word: "Open",
    tone: "neutral",
    icon: CheckIcon,
    shape: "neutralSquare",
  },
  venue_temporarily_closed: {
    word: "Temporarily closed",
    tone: "attention",
    icon: ClockIcon,
    shape: "overdue",
  },
  venue_archived: {
    word: "Closed and archived",
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
  // Me's milestone for an own photo in the portfolio (not a knowledge draft)
  portfolio_saved: { word: "Saved", tone: "neutral", shape: "plain" },
  // A venue question nobody has answered (never "Needs verification", which
  // is a legacy fact's word)
  to_check: { word: "To check", tone: "neutral", shape: "plain" },
  // One finding about a venue question (knowledge history)
  saved: {
    word: "Saved",
    tone: "neutral",
    icon: FileTextIcon,
    shape: "plain",
  },
  // A dish still needed whose photo waits for a first decision (goals
  // decision 11). The dish stays in Still needed; anyone may add another.
  waiting_for_review: {
    word: "Waiting for review",
    tone: "pending",
    icon: ClockIcon,
    shape: "waiting",
  },
  awaiting_confirmation: {
    word: "Awaiting confirmation",
    tone: "pending",
    icon: ClockIcon,
    shape: "waiting",
  },
  current_answer: {
    word: "Current answer",
    tone: "positive",
    icon: CheckIcon,
    shape: "met",
  },
  needs_attention: {
    word: "Needs attention",
    tone: "attention",
    icon: WarningCircleIcon,
    shape: "needs",
  },
  not_confirmed: {
    word: "Not confirmed",
    tone: "closed",
    icon: XIcon,
    shape: "closed",
  },
  no_longer_used: {
    word: "No longer in use",
    tone: "closed",
    icon: MinusCircleIcon,
    shape: "closed",
  },
  couldnt_establish: {
    word: "Couldn't establish",
    tone: "neutral",
    icon: MinusIcon,
    shape: "na",
  },
  // S1-EXPORT (spec §10 publication states, §8 A5). Admin and manager
  // screens only (FA-7): staff never see these words. Exported is never
  // Published (§10 inv. 9).
  publication_not_selected: {
    word: "Not exported",
    tone: "neutral",
    shape: "plain",
  },
  publication_exported: {
    word: "Exported",
    tone: "neutral",
    icon: DownloadSimpleIcon,
    shape: "neutralSquare",
  },
  publication_queued: {
    word: "Queued",
    tone: "pending",
    icon: ClockIcon,
    shape: "waiting",
  },
  publication_published_confirmed: {
    word: "Published",
    tone: "positive",
    icon: GlobeIcon,
    shape: "present",
  },
  publication_update_pending: {
    word: "Update pending",
    tone: "pending",
    icon: ClockIcon,
    shape: "waiting",
  },
  publication_withdrawal_pending: {
    word: "Withdrawal pending",
    tone: "attention",
    icon: ArrowUUpLeftIcon,
    shape: "needs",
  },
  // One Withdrawn, one icon: the same X as outcome_withdrawn (S4-DOCS).
  publication_withdrawn_confirmed: {
    word: "Withdrawn",
    tone: "closed",
    icon: XIcon,
    shape: "closed",
  },
  publication_failed_unknown: {
    word: "Failed or unknown",
    tone: "negative",
    icon: WarningCircleIcon,
    shape: "warnSquare",
  },
  // An export package
  package_ready: {
    word: "Ready to download",
    tone: "neutral",
    icon: DownloadSimpleIcon,
    shape: "neutralSquare",
  },
  package_exported: {
    word: "Exported",
    tone: "neutral",
    icon: DownloadSimpleIcon,
    shape: "neutralSquare",
  },
  package_needs_rebuild: {
    word: "Needs rebuilding",
    tone: "attention",
    icon: WarningCircleIcon,
    shape: "needs",
  },
  package_invalidated: {
    word: "Can't be downloaded",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  // S3-R14 (X10): why one photo in a package is no longer eligible, since
  // the package was made (export_package_detail staleReason). Withdrawn is
  // kept for a real withdrawal; a review or coverage change says so.
  package_item_withdrawn: {
    word: "Withdrawn since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_deleted: {
    word: "Deleted since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_off_menu: {
    word: "Off the menu since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_subject_retired: {
    word: "Retired since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_label_changed: {
    word: "Label changed since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_check_due: {
    word: "Check due since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_fact_changed: {
    word: "Answer changed since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_review_changed: {
    word: "Review changed since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  package_item_changed: {
    word: "Changed since",
    tone: "negative",
    icon: XIcon,
    shape: "warnSquare",
  },
  // S2-METRICS (spec §18.1): a slot's state in a manager or admin report,
  // from the one coverage rule (public.coverage_slots). Only "Covered"
  // counts in the numerator; Not here and No photo needed leave the total.
  coverage_covered: {
    word: "Covered",
    tone: "positive",
    icon: CheckIcon,
    shape: "present",
  },
  coverage_check_due: {
    word: "Check due",
    tone: "pending",
    icon: ClockIcon,
    shape: "changed",
  },
  coverage_pending: {
    word: "Awaiting review",
    tone: "pending",
    icon: ArrowUpIcon,
    shape: "waiting",
  },
  coverage_replacement_needed: {
    word: "Another photo requested",
    tone: "attention",
    icon: CameraIcon,
    shape: "needs",
  },
  coverage_missing: {
    word: "Missing",
    tone: "neutral",
    icon: MinusIcon,
    shape: "neutralSquare",
  },
  coverage_not_here: {
    word: "Not here",
    tone: "closed",
    shape: "na",
  },
  coverage_inactive: {
    word: "No photo needed",
    tone: "closed",
    icon: MinusCircleIcon,
    shape: "closed",
  },
  // S2-STAFF, My uploads (spec §6 S4; FA-7): what happened to a person's
  // own photo, in staff words. Managers see the spec's action names.
  outcome_waiting: {
    word: "Waiting",
    tone: "pending",
    icon: ArrowUpIcon,
    shape: "waiting",
  },
  outcome_public: {
    word: "In the album",
    tone: "positive",
    icon: CheckIcon,
    shape: "accepted",
  },
  outcome_reference: {
    word: "Kept for reference",
    tone: "closed",
    icon: FileTextIcon,
    shape: "closed",
  },
  outcome_retake: {
    word: "Retake",
    tone: "attention",
    icon: CameraIcon,
    shape: "needs",
  },
  outcome_label_corrected: {
    word: "Label corrected",
    tone: "neutral",
    icon: PencilSimpleIcon,
    shape: "plain",
  },
  outcome_not_used: {
    word: "Not used",
    tone: "closed",
    icon: MinusCircleIcon,
    shape: "closed",
  },
  outcome_withdrawn: {
    word: "Withdrawn",
    tone: "closed",
    icon: XIcon,
    shape: "closed",
  },
  // S3-R14: a photo's review in the admin Library (FA-7: managers and
  // admins see the spec's names). Waiting, another photo and withdrawn use
  // waiting_for_review, coverage_replacement_needed and outcome_withdrawn.
  review_public: {
    word: "Approved for public use",
    tone: "positive",
    icon: CheckIcon,
    shape: "present",
  },
  review_reference: {
    word: "Kept as reference",
    tone: "closed",
    icon: FileTextIcon,
    shape: "closed",
  },
  review_unreviewed: {
    word: "Not reviewed yet",
    tone: "pending",
    icon: ClockIcon,
    shape: "waiting",
  },
  review_not_used: {
    word: "Not used",
    tone: "closed",
    icon: MinusCircleIcon,
    shape: "closed",
  },
  internal_only: {
    word: "Internal only",
    tone: "closed",
    icon: LockSimpleIcon,
    shape: "closed",
  },
  // S2-REQ: a request's state (spec §7 M4). Manager and admin screens only;
  // staff see the slot itself, never these words.
  request_open: {
    word: "Open",
    tone: "neutral",
    icon: TargetIcon,
    shape: "neutralSquare",
  },
  request_submitted: {
    word: "Submitted",
    tone: "pending",
    icon: ArrowUpIcon,
    shape: "submitted",
  },
  request_completed: {
    word: "Completed",
    tone: "positive",
    icon: CheckIcon,
    shape: "met",
  },
  request_blocked: {
    word: "Blocked",
    tone: "attention",
    icon: WarningCircleIcon,
    shape: "needs",
  },
  request_cancelled: {
    word: "Cancelled",
    tone: "closed",
    icon: XIcon,
    shape: "closed",
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

// v2 chip (`nl-chip`): a 28px pill, caption type at 600, a 16px icon and the
// word. A long word ("Ended: moved to another venue") wraps inside the chip
// rather than pushing a 320px or zoomed page sideways. The shape class
// (CHIP_SHAPES) sets the tone's fill and colour. The transparent border
// draws nothing until forced colours drop the fill, when it is the chip's
// edge.
export const chipClassName =
  "inline-flex max-w-full min-h-7 items-center gap-1 rounded-round border border-transparent py-0.5 pr-2.5 pl-2 text-left text-chip align-middle whitespace-normal [overflow-wrap:anywhere] [&_svg]:size-4 [&_svg]:shrink-0"

/**
 * v2: every chip has an icon. A state without its own icon, or a chip
 * redrawn in another tone, takes its tone's: a plain circle (nothing yet),
 * the clock (waiting), the check (done), the exclamation (a person needs
 * to act) or the triangle (a problem).
 */
const TONE_ICON: Record<V2Tone, Icon> = {
  neutral: CircleIcon,
  progress: ClockIcon,
  positive: CheckIcon,
  attention: WarningCircleIcon,
  problem: WarningIcon,
}

const BOXLESS: ReadonlySet<ChipShape> = new Set([
  "upload",
  "uploadMuted",
  "uploadFailed",
])

type StatusChipProps = {
  className?: string
  title?: string
  /** Override the drawn shape: one of the names in CHIP_SHAPES. */
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
  // The state's icon belongs to its own shape; a redrawn chip, or a state
  // with none, takes its tone's. The box-less upload words keep their own.
  const Icon =
    known && shape === known.shape && known.icon
      ? known.icon
      : BOXLESS.has(shape)
        ? undefined
        : TONE_ICON[V2_TONE[tone]]
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      data-v2-tone={V2_TONE[tone]}
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
        "inline-grid h-[26px] min-w-[26px] place-items-center rounded-round px-[7px] font-mono text-mono leading-none font-semibold tabular-nums",
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
