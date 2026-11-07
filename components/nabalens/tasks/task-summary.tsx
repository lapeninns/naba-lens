import Link from "next/link"
import {
  CalendarBlankIcon,
  CaretLeftIcon,
  ClockIcon,
  ForkKnifeIcon,
  HouseIcon,
  InfoIcon,
  LockSimpleIcon,
  MapPinIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Card } from "../common-room/card"
import { IconDisc } from "../common-room/icon-disc"
import { SeparateNote, VenueScope } from "../common-room/scope-label"
import { Stamp } from "../common-room/stamp"
import { StatusChip as SystemChip } from "../status-chip"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ProfileAvatar } from "../profile-avatar"
import { plural, requirementKindLabel } from "./copy"
import { DueLine } from "./status-badges"
import type { MyAssignment, RequirementKind } from "./types"

/** Back link to Home, sized for touch (the thread's "‹ Home"). */
export function BackToTasks({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-1 text-label text-ink outline-none hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      <CaretLeftIcon className="size-5" weight="bold" aria-hidden />
      Home
    </Link>
  )
}

/** The kind's icon in the task post's disc (decorative). */
const KIND_ICON: Record<RequirementKind, React.ReactNode> = {
  menu_section: <ForkKnifeIcon />,
  amenity: <MapPinIcon />,
  venue_specific: <HouseIcon />,
  service: <CalendarBlankIcon />,
}

/** A sentence inside the task post: an icon and the words (DESIGN.md §5). */
function Flag({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "neutral" | "warn"
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role="note"
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-control px-3 py-2.5 text-body text-ink [&_svg]:mt-px [&_svg]:size-[22px]",
        tone === "warn"
          ? "bg-warn-bg shadow-[inset_4px_0_0_var(--warn-fg)] [&_svg]:text-warn-fg"
          : "bg-surface-2 [&_svg]:text-ink-muted"
      )}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
      <p className="min-w-0">{children}</p>
    </div>
  )
}

/**
 * The section's shared progress as one segment per photo (accepted green, the
 * rest grey), with the same words and accessible name as before.
 */
function SharedCount({
  accepted,
  target,
}: {
  accepted: number
  target: number
}) {
  const total = Math.max(0, Math.floor(target))
  const ok = Math.min(Math.max(0, accepted), total)
  const label = `${accepted} of ${target} photos accepted`
  const segmented = total > 0 && total <= 12
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(total ? (ok / total) * 100 : 0)}
      className={cn(
        "h-3",
        segmented
          ? "grid gap-1"
          : "flex overflow-hidden rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
      )}
      style={
        segmented
          ? { gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {segmented ? (
        Array.from({ length: total }, (_, index) => (
          <i
            key={index}
            className={cn(
              "block h-3 rounded-round",
              index < ok
                ? "bg-ok-fg"
                : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
            )}
          />
        ))
      ) : (
        <i
          className="block bg-ok-fg"
          style={{ width: total ? `${(ok / total) * 100}%` : 0 }}
        />
      )}
    </div>
  )
}

/**
 * Task header: what to photograph, by when, and shared progress. Notices carry
 * the overdue, complete and closed states; none of them blocks sending.
 *
 * Common Room: the task's own post leads the thread (kind disc, title, venue,
 * state and due), the guide follows as its own card, and the section's shared
 * progress is a separate card so it is never read as the person's month.
 */
export function TaskSummary({
  assignment,
  monthLabel,
  venueName,
  sendHref,
  guide,
}: {
  assignment: MyAssignment
  /** "November": names the monthly target the photos count toward. */
  monthLabel?: string
  venueName?: string | null
  /** Where "Send photos" jumps to; omitted when the caller can't send. */
  sendHref?: string
  /** Shown between "What to photograph" and "On this section". */
  guide?: React.ReactNode
}) {
  const { requirement } = assignment
  const closed = !requirement.isCurrent
  const satisfied = requirement.progress.satisfied
  const overdue = Boolean(requirement.due?.overdue) && !satisfied && !closed
  const hasPhotos = assignment.mySubmissions.length > 0
  const kind = requirementKindLabel(requirement.kind)
  const { progress, assignees } = requirement
  const others = Math.max(0, assignees.length - 1)
  const countsNote = !closed && !satisfied && !overdue && monthLabel
  return (
    <div className="flex flex-col gap-(--gutter)">
      <Card className="gap-3.5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          <IconDisc className="size-11 [&_svg]:size-6">
            {KIND_ICON[requirement.kind] ?? <CalendarBlankIcon />}
          </IconDisc>
          <div className="grid min-w-0 gap-0.5">
            <h1 className="font-display text-card-title [overflow-wrap:anywhere] text-ink">
              {requirement.title}
            </h1>
            {venueName ? (
              <VenueScope venue={venueName} suffix={`· ${kind}`} />
            ) : (
              <span className="text-meta text-ink-muted">{kind}</span>
            )}
          </div>
        </div>

        {requirement.due || closed || satisfied ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            {closed ? <SystemChip state="closed" /> : null}
            {satisfied && !closed ? <Stamp /> : null}
            {requirement.due ? (
              <DueLine
                due={requirement.due}
                done={satisfied || closed}
                className="text-ink [&>span:last-child]:font-mono [&>span:last-child]:font-semibold [&>span:last-child]:tabular-nums"
              />
            ) : null}
          </div>
        ) : null}

        {closed ? (
          <Flag icon={<LockSimpleIcon />}>
            This task is closed. Photos you sent stay counted
            {venueName ? ` for ${venueName}` : ""}.
          </Flag>
        ) : satisfied ? (
          <Flag icon={<InfoIcon />}>
            This task has enough accepted photos. Extra photos still go to
            Photos and your profile.
          </Flag>
        ) : overdue ? (
          <Flag tone="warn" icon={<ClockIcon />}>
            It&apos;s past its due date. You can still send photos; nothing is
            blocked.
          </Flag>
        ) : null}

        {requirement.guidance ? (
          <section
            aria-labelledby="guidance-heading"
            className="grid gap-1.5 border-t border-line pt-3.5"
          >
            <h2
              id="guidance-heading"
              className="font-display text-item-title text-ink"
            >
              What to photograph
            </h2>
            <p className="max-w-(--size-reading) break-words whitespace-pre-line">
              {requirement.guidance}
            </p>
          </section>
        ) : null}

        {sendHref && assignment.canSubmit ? (
          <Link
            href={sendHref}
            className={buttonVariants({
              variant: "secondary",
              className: "w-full sm:w-auto sm:self-start",
            })}
          >
            {hasPhotos ? "Send more photos" : "Send photos"}
          </Link>
        ) : null}
      </Card>

      {guide}

      <Card as="section" aria-labelledby="progress-heading" className="gap-2.5">
        <h2
          id="progress-heading"
          className="font-display text-section-title text-ink"
        >
          On this section
        </h2>
        {progress.target ? (
          <>
            <p className="font-display text-section-title text-ink tabular-nums">
              <span className="text-[2.125rem] leading-none font-extrabold tracking-[-0.02em]">
                {progress.accepted}
              </span>{" "}
              of {progress.target}{" "}
              <span className="font-sans text-body font-normal">
                photos accepted
                {others > 0 ? (
                  <span className="text-ink-muted">
                    {" "}
                    · shared with {plural(others, "colleague", "colleagues")}
                  </span>
                ) : null}
              </span>
            </p>
            <SharedCount
              accepted={progress.accepted}
              target={progress.target}
            />
          </>
        ) : null}
        <p className="text-meta text-ink-muted">
          You: {assignment.myAccepted} accepted · {assignment.myPending} waiting
          for review
        </p>
        {assignees.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {assignees.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-2 text-body text-ink"
              >
                <ProfileAvatar
                  name={person.displayName}
                  src={person.avatarUrl}
                  size="sm"
                />
                {person.displayName}
              </li>
            ))}
          </ul>
        ) : null}
        {countsNote ? (
          <SeparateNote className="border-t border-line pt-3">
            Counts toward the task and your {monthLabel} target once accepted.
          </SeparateNote>
        ) : null}
      </Card>
    </div>
  )
}
