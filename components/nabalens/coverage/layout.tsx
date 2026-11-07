import Link from "next/link"
import { CaretRightIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

/** A titled block on a coverage page (`nl-section`). */
export function CoverageSection({
  title,
  count,
  action,
  id,
  children,
  className,
}: {
  title: React.ReactNode
  /** Quiet text after the title: a count, a month or a state. */
  count?: React.ReactNode
  action?: React.ReactNode
  id?: string
  children?: React.ReactNode
  className?: string
}) {
  const titleId = id ? `${id}-title` : undefined
  return (
    <section
      aria-labelledby={titleId}
      className={cn("grid min-w-0 gap-(--gutter)", className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 pt-2">
        <h2
          id={titleId}
          className="font-display text-section-title text-balance text-ink"
        >
          {title}
        </h2>
        {count != null ? (
          <span className="text-meta text-ink-muted tabular-nums">{count}</span>
        ) : null}
        {action ? <div className="ms-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export type TallyTone =
  "neutral" | "attention" | "negative" | "positive" | "zero"

const TALLY_TONE: Record<TallyTone, string> = {
  neutral: "text-ink",
  zero: "text-ink-muted",
  attention: "text-warn-fg",
  negative: "text-warn-fg",
  positive: "text-ok-fg",
}

/**
 * A row of headline numbers that each link to their list: grey count tiles
 * inside one white card on the canvas.
 */
export function Tally({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.25rem),1fr))] gap-2 rounded-card bg-surface p-3 shadow-card",
        className
      )}
    >
      {children}
    </ul>
  )
}

export function TallyItem({
  label,
  value,
  of,
  note,
  tone = "neutral",
  icon: Icon,
  href,
}: {
  label: string
  value: number
  /** "of 13" after the number. */
  of?: number
  note?: React.ReactNode
  tone?: TallyTone
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  href?: string
}) {
  const shownTone = tone !== "positive" && value === 0 ? "zero" : tone
  const body = (
    <>
      <span className="text-meta font-semibold text-ink-muted">{label}</span>
      <span
        className={cn(
          "flex items-baseline gap-1.5 font-display text-section-title font-extrabold tabular-nums",
          TALLY_TONE[shownTone]
        )}
      >
        {Icon && value > 0 ? (
          <Icon aria-hidden className="size-5 self-center" />
        ) : null}
        {value}
        {of != null ? (
          <small className="font-sans text-body font-bold text-ink-muted">
            of {of}
          </small>
        ) : null}
      </span>
      {note ? <span className="text-meta text-ink-muted">{note}</span> : null}
    </>
  )
  const cell =
    "grid min-h-11 min-w-0 content-start gap-0.5 rounded-control bg-surface-2 px-3 pt-2.5 pb-3 text-ink no-underline"
  return (
    <li className="flex min-w-0">
      {href ? (
        <Link
          href={href}
          className={cn(
            cell,
            "w-full outline-offset-2 transition-colors duration-(--duration-quick) hover:bg-raised"
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={cn(cell, "w-full")}>{body}</div>
      )}
    </li>
  )
}

/**
 * "3 of 5 accepted" with one segment per photo: green when accepted, striped
 * while waiting for review, grey still needed. Blue never marks progress. A missing target is shown as Needs setup by the
 * caller, never as done.
 */
export function Frames({
  accepted,
  target,
  pending = 0,
  compact = false,
  chip,
  className,
}: {
  accepted: number
  target: number
  pending?: number
  compact?: boolean
  /** A state chip beside the count (Target met, Overdue). */
  chip?: React.ReactNode
  className?: string
}) {
  const filled = Math.min(accepted, target)
  const waiting = Math.max(0, Math.min(pending, target - filled))
  const text = `${accepted} of ${target} accepted`
  const asBar = target > 12
  return (
    <div
      className={cn("grid min-w-0", compact ? "gap-1.5" : "gap-2", className)}
    >
      <p
        className={cn(
          "flex flex-wrap items-baseline gap-x-2 gap-y-1",
          compact && "text-body-sm"
        )}
      >
        <span
          className={cn(
            "tabular-nums",
            compact
              ? "font-mono text-meta-strong text-ink"
              : "font-display text-count text-ink"
          )}
        >
          {accepted}
        </span>
        <span
          className={cn(
            "text-ink-muted",
            compact
              ? "font-mono text-meta-strong tabular-nums"
              : "font-display text-section-title"
          )}
        >
          of {target} accepted
        </span>
        {chip ? <span className="self-center">{chip}</span> : null}
      </p>
      {target > 0 ? (
        asBar ? (
          <div
            aria-hidden
            className={cn(
              "flex overflow-hidden rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]",
              compact ? "h-2" : "h-3"
            )}
          >
            <span
              className="bg-ok-fg"
              style={{ width: `${(filled / target) * 100}%` }}
            />
            <span
              className="bg-stripe"
              style={{ width: `${(waiting / target) * 100}%` }}
            />
          </div>
        ) : (
          <ol aria-hidden className="flex gap-1">
            {Array.from({ length: target }, (_, i) => (
              <li
                key={i}
                className={cn(
                  "flex-[1_1_0] rounded-round",
                  compact ? "h-2 max-w-6" : "h-3 max-w-16",
                  i < filled
                    ? "bg-ok-fg"
                    : i < filled + waiting
                      ? "bg-stripe"
                      : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
                )}
              />
            ))}
          </ol>
        )
      ) : null}
      <span className="sr-only">
        {text}
        {pending > 0 ? `, ${pending} to review` : ""}
      </span>
    </div>
  )
}

/** Rows in one white card on the canvas, hairlines between them. */
export function ItemList({
  children,
  className,
  label,
}: {
  children: React.ReactNode
  className?: string
  label?: string
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "@container grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card [&>li+li]:border-t [&>li+li]:border-line",
        className
      )}
    >
      {children}
    </ul>
  )
}

/**
 * One row: title, kind, chip, issues in attention text and quiet meta on the
 * left, progress on the right (below the text in narrow lists), a caret when
 * the row opens something.
 */
export function ItemRow({
  title,
  kind,
  chip,
  issues,
  meta,
  aside,
  href,
  closed = false,
  className,
}: {
  title: React.ReactNode
  kind?: React.ReactNode
  chip?: React.ReactNode
  issues?: React.ReactNode[]
  meta?: React.ReactNode
  aside?: React.ReactNode
  href?: string
  closed?: boolean
  className?: string
}) {
  const shownIssues = (issues ?? []).filter(Boolean)
  const body = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span
            className={cn(
              "text-item-title [overflow-wrap:anywhere]",
              closed ? "text-ink-muted" : "text-ink"
            )}
          >
            {title}
          </span>
          {kind ? (
            <span className="text-meta font-semibold text-ink-muted">
              {kind}
            </span>
          ) : null}
          {chip}
        </div>
        {shownIssues.length > 0 ? (
          <ul className="mt-2 grid gap-1">
            {shownIssues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-meta font-bold text-warn-fg"
              >
                <WarningIcon
                  aria-hidden
                  className="mt-0.5 size-[18px] shrink-0"
                />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-muted">
            {meta}
          </div>
        ) : null}
      </div>
      {aside ? (
        <div className="min-w-0 @max-[520px]:col-start-1 @max-[520px]:row-start-2">
          {aside}
        </div>
      ) : (
        <span aria-hidden />
      )}
      {href ? (
        <CaretRightIcon
          aria-hidden
          weight="bold"
          className="mt-0.5 size-5 text-ink-muted @max-[520px]:col-start-2 @max-[520px]:row-start-1"
        />
      ) : (
        <span aria-hidden />
      )}
    </>
  )
  const grid = cn(
    "grid min-h-16 grid-cols-[minmax(0,1fr)_168px_20px] items-start gap-4 p-3 text-ink no-underline md:px-4 @max-[520px]:grid-cols-[minmax(0,1fr)_20px] @max-[520px]:gap-y-3",
    className
  )
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={cn(
            grid,
            "-outline-offset-3 transition-colors duration-(--duration-quick) hover:bg-surface-2"
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={grid}>{body}</div>
      )}
    </li>
  )
}

/** A quoted reason with who wrote it and when (`nl-quote`). */
export function Quote({
  children,
  by,
  className,
}: {
  children: React.ReactNode
  by?: React.ReactNode
  className?: string
}) {
  return (
    <blockquote
      className={cn(
        "grid gap-1 rounded-control bg-surface-2 px-3 py-2.5 ps-4 shadow-[inset_4px_0_0_var(--warn-fg)]",
        className
      )}
    >
      <p className="text-body [overflow-wrap:anywhere] text-ink before:content-['“'] after:content-['”']">
        {children}
      </p>
      {by ? <p className="text-meta text-ink-muted">{by}</p> : null}
    </blockquote>
  )
}
