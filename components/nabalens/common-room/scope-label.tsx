import { InfoIcon, MapPinIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

/**
 * Who and where a number belongs to ("Priya · November 2026 · The Railway"),
 * in mono 17/600 muted. The icon stays on the first line; a long scope wraps
 * beside it, never under it.
 */
export function ScopeLabel({
  icon,
  className,
  children,
}: {
  /** Defaults to none; pass e.g. <UserIcon /> or <MapPinIcon />. */
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <p
      data-slot="cr-scope-label"
      className={cn(
        "flex items-start gap-2 font-mono text-meta-strong text-ink-muted tabular-nums [&_svg]:mt-px [&_svg]:size-[18px] [&_svg]:shrink-0",
        className
      )}
    >
      {icon ? (
        <span aria-hidden className="contents">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * The venue a screen is scoped to: a pin, optional words around it, the venue
 * name in bold ink. Every venue screen names the venue.
 */
export function VenueScope({
  venue,
  prefix,
  suffix,
  className,
}: {
  venue: React.ReactNode
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="cr-venue-scope"
      className={cn(
        // Inline text flow, not flex-wrap: a long venue name wraps word by
        // word after the pin instead of dropping to a line of its own.
        "inline-block text-meta [overflow-wrap:anywhere] text-ink-muted",
        className
      )}
    >
      <MapPinIcon
        aria-hidden
        className="me-1.5 inline-block size-[18px] align-[-0.2em]"
      />
      {prefix ? <span>{prefix} </span> : null}
      <b className="font-bold text-ink">{venue}</b>
      {suffix ? <span> {suffix}</span> : null}
    </span>
  )
}

/** The sentence that two counts are counted separately (never added). */
export function SeparateNote({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <p
      data-slot="cr-separate-note"
      className={cn(
        "flex items-start gap-2 text-body text-ink-muted",
        className
      )}
    >
      <InfoIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
