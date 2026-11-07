import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export type RowTone = "neutral" | "warn" | "info" | "ok"

const ICON_TONE: Record<RowTone, string> = {
  neutral: "bg-surface-2 text-ink",
  warn: "bg-warn-bg text-warn-fg",
  info: "bg-info-bg text-info-fg",
  ok: "bg-ok-bg text-ok-fg",
}

const ROW =
  "grid min-h-16 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-card bg-surface p-3 text-left text-ink shadow-card"
const INTERACTIVE =
  "transition-colors duration-(--duration-quick) outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"

type RowProps = {
  /** A 44px round icon disc on the left (decorative). */
  icon?: React.ReactNode
  /** A 56px square thumbnail instead of the icon. */
  thumb?: React.ReactNode
  tone?: RowTone
  /** First line, bold 18px. */
  title: React.ReactNode
  /** Second line, muted. */
  subtitle?: React.ReactNode
  /** Chips under the two lines. */
  chips?: React.ReactNode
  /** Right side before the chevron (a count, a time). */
  end?: React.ReactNode
  /** Link target; the whole row is the link. */
  href?: string
  /** Button handler; the whole row is the button (client components only). */
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  /** Hide the chevron (a static row). Defaults to shown for links/buttons. */
  chevron?: boolean
  className?: string
  "aria-label"?: string
  "aria-current"?: React.AriaAttributes["aria-current"]
}

/**
 * A to-do row (DESIGN.md §4): icon, two lines, chevron. The rail of secondary
 * jobs under the lead card. Use RowList to group rows in one card.
 */
export function Row({
  icon,
  thumb,
  tone = "neutral",
  title,
  subtitle,
  chips,
  end,
  href,
  onClick,
  chevron,
  className,
  ...aria
}: RowProps) {
  const interactive = Boolean(href || onClick)
  const showChevron = chevron ?? interactive
  const lead = thumb ? (
    <span className="block size-14 shrink-0 overflow-hidden rounded-control bg-media-placeholder [&_img]:size-full [&_img]:object-cover">
      {thumb}
    </span>
  ) : icon ? (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-round [&_svg]:size-6",
        ICON_TONE[tone]
      )}
    >
      {icon}
    </span>
  ) : null
  const body = (
    <>
      {lead}
      <span className="grid min-w-0 gap-0.5">
        <span className="text-item-title [overflow-wrap:anywhere]">
          {title}
        </span>
        {subtitle ? (
          <span className="text-body [overflow-wrap:anywhere] text-ink-muted">
            {subtitle}
          </span>
        ) : null}
        {chips ? (
          <span className="mt-1 flex flex-wrap gap-1.5">{chips}</span>
        ) : null}
      </span>
      <span className="flex items-center justify-end gap-2 text-ink-muted">
        {end}
        {showChevron ? (
          <CaretRightIcon aria-hidden weight="bold" className="size-5" />
        ) : null}
      </span>
    </>
  )
  const classes = cn(
    ROW,
    !lead && "grid-cols-[minmax(0,1fr)_auto]",
    interactive && INTERACTIVE,
    className
  )
  if (href) {
    return (
      <Link href={href} data-slot="cr-row" className={classes} {...aria}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        data-slot="cr-row"
        onClick={onClick}
        className={classes}
        {...aria}
      >
        {body}
      </button>
    )
  }
  return (
    <div data-slot="cr-row" className={classes} {...aria}>
      {body}
    </div>
  )
}

/**
 * Rows grouped in one card with hairlines between them. Pass Row children;
 * an optional `head` sits above the first row. Renders a <ul> when `list`.
 */
export function RowList({
  head,
  list = false,
  className,
  children,
}: {
  head?: React.ReactNode
  /** Wrap each child in <li> inside a <ul> (when it is a real list). */
  list?: boolean
  className?: string
  children: React.ReactNode
}) {
  const inner =
    "[&_[data-slot=cr-row]]:rounded-none [&_[data-slot=cr-row]]:shadow-none [&_[data-slot=cr-row]]:focus-visible:-outline-offset-3"
  return (
    <div
      data-slot="cr-row-list"
      className={cn(
        "grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card",
        inner,
        className
      )}
    >
      {head ? <div className="px-3 pt-3.5 pb-1.5">{head}</div> : null}
      {list ? (
        <ul className="grid divide-y divide-line">
          {[children].flat().map((child, index) => (
            <li key={index}>{child}</li>
          ))}
        </ul>
      ) : (
        <div className="grid divide-y divide-line">{children}</div>
      )}
    </div>
  )
}
