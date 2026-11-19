import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export type RowTone = "neutral" | "warn" | "info" | "ok"

// v2 ListRow's lead is a 20px line icon; a tone colours it, never alone.
const ICON_TONE: Record<RowTone, string> = {
  neutral: "text-ink-muted",
  warn: "text-warn-fg",
  info: "text-info-fg",
  ok: "text-ok-fg",
}

// v2 ListRow (`nl-row`, D10): lead, title and meta, then the trail; 12px
// above and below, 16px sides, on surface with a line outline.
const ROW =
  "grid min-h-16 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-card bg-surface px-4 py-3 text-left text-ink shadow-card"
const INTERACTIVE =
  "transition-colors duration-quick outline-none hover:bg-raised focus-ring"

type RowProps = {
  /** A 20px icon on the left (decorative), in the tone's colour. */
  icon?: React.ReactNode
  /** A 56px square thumbnail instead of the icon. */
  thumb?: React.ReactNode
  tone?: RowTone
  /** First line, v2 label type (15px, 600). */
  title: React.ReactNode
  /** Second line, v2 caption in ink-muted. */
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
 * A to-do row, drawn as v2 ListRow: icon, two lines, chevron. The rail of secondary
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
    <span className="block size-14 shrink-0 overflow-hidden rounded-square bg-media-placeholder [&_img]:size-full [&_img]:object-cover">
      {thumb}
    </span>
  ) : icon ? (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center [&_svg]:size-5",
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
        <span className="text-label [overflow-wrap:anywhere]">{title}</span>
        {subtitle ? (
          <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
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
 * Rows grouped in one box with lines between them (v2 `nl-list`). Pass Row children;
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
