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
      className={cn("grid min-w-0 gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h2
          id={titleId}
          className="text-section-title-touch text-balance text-ink md:text-section-title"
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
  neutral: "",
  zero: "text-ink-subtle",
  attention: "text-attention",
  negative: "text-negative",
  positive: "text-positive",
}

/** A row of headline numbers that each link to their list (`nl-tally`). */
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
        "-ms-4 flex flex-wrap overflow-hidden border-y border-line",
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
      <span className="text-meta text-ink-muted">{label}</span>
      <span
        className={cn(
          "flex items-baseline gap-1.5 font-display text-count tabular-nums",
          TALLY_TONE[shownTone]
        )}
      >
        {Icon && value > 0 ? (
          <Icon aria-hidden className="size-[18px] self-center" />
        ) : null}
        {value}
        {of != null ? (
          <small className="font-sans text-body-sm font-normal text-ink-muted">
            of {of}
          </small>
        ) : null}
      </span>
      {note ? <span className="text-meta text-ink-muted">{note}</span> : null}
    </>
  )
  const cell =
    "grid min-w-0 content-start gap-0.5 px-4 pt-3 pb-3.5 text-inherit no-underline"
  return (
    <li className="-ms-px -mt-px flex min-w-0 flex-[1_1_148px] border-s border-t border-line">
      {href ? (
        <Link
          href={href}
          className={cn(
            cell,
            "w-full outline-offset-[-2px] hover:bg-fill-hover"
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
 * "3 of 5 accepted" with one frame per photo: filled when accepted, dashed
 * while waiting for review. A missing target is shown as Needs setup by the
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
            "font-semibold tabular-nums",
            compact ? "text-body-sm" : "font-display text-count"
          )}
        >
          {accepted}
        </span>
        <span
          className={cn(
            "text-ink-muted",
            compact ? "text-body-sm" : "text-meta-touch md:text-body"
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
              "flex overflow-hidden rounded-print border border-line-control",
              compact ? "h-2" : "h-3"
            )}
          >
            <span
              className="bg-positive-fill"
              style={{ width: `${(filled / target) * 100}%` }}
            />
            <span
              className="bg-[repeating-linear-gradient(135deg,var(--color-ink-muted)_0_1.5px,transparent_1.5px_5px)]"
              style={{ width: `${(waiting / target) * 100}%` }}
            />
          </div>
        ) : (
          <ol aria-hidden className="flex gap-1">
            {Array.from({ length: target }, (_, i) => (
              <li
                key={i}
                className={cn(
                  "flex-[1_1_0] rounded-print border",
                  compact ? "h-2 max-w-5.5" : "h-3 max-w-14",
                  i < filled
                    ? "border-positive-fill bg-positive-fill"
                    : i < filled + waiting
                      ? "border-[1.5px] border-dashed border-ink-muted"
                      : "border-line-control"
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

/** A bordered list of rows (`nl-list`). */
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
        "@container -mx-3 grid border-y border-line [&>li+li]:border-t [&>li+li]:border-line",
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
              "text-item-title-touch break-words md:text-item-title",
              closed ? "text-ink-muted" : "text-ink"
            )}
          >
            {title}
          </span>
          {kind ? (
            <span className="text-meta-strong text-ink-muted">{kind}</span>
          ) : null}
          {chip}
        </div>
        {shownIssues.length > 0 ? (
          <ul className="mt-2 grid gap-1">
            {shownIssues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-meta-strong text-attention"
              >
                <WarningIcon aria-hidden className="mt-px size-4 shrink-0" />
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
          className="mt-0.5 size-5 text-ink-subtle @max-[520px]:col-start-2 @max-[520px]:row-start-1"
        />
      ) : (
        <span aria-hidden />
      )}
    </>
  )
  const grid = cn(
    "grid grid-cols-[minmax(0,1fr)_168px_20px] items-start gap-4 px-3 py-3.5 text-inherit no-underline @max-[520px]:grid-cols-[minmax(0,1fr)_20px] @max-[520px]:gap-y-3",
    className
  )
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={cn(grid, "outline-offset-[-2px] hover:bg-fill-hover")}
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
        "grid gap-1 rounded-control bg-attention-soft px-3 py-2.5",
        className
      )}
    >
      <p className="text-body-touch break-words text-ink before:content-['“'] after:content-['”'] md:text-body">
        {children}
      </p>
      {by ? <p className="text-meta text-ink-muted">{by}</p> : null}
    </blockquote>
  )
}
