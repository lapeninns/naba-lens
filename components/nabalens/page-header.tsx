import { MapPinIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

type PageHeaderProps = {
  /**
   * Where you are: the venue and the month or role ("The Railway",
   * "November 2026"), or "All venues". At most two parts.
   */
  scope?: React.ReactNode[] | React.ReactNode
  /** Show the venue icon before the scope (pages scoped to one venue). */
  venueScope?: boolean
  title: React.ReactNode
  /** One or two sentences on what the page decides or shows. */
  summary?: React.ReactNode
  /** At most one primary and one secondary. */
  actions?: React.ReactNode
  /** Rendered directly underneath, e.g. SectionTabs. */
  children?: React.ReactNode
  className?: string
  titleId?: string
}

/**
 * The top of every page: scope line, the page's one <h1>, an optional summary
 * and the page's main action. Actions sit right from md, full width on phones.
 * Common Room: the scope names the venue (pin icon, muted, 17px); the title
 * is Figtree 26/750 on the grey canvas.
 */
export function PageHeader({
  scope,
  venueScope = false,
  title,
  summary,
  actions,
  children,
  className,
  titleId,
}: PageHeaderProps) {
  const parts = (Array.isArray(scope) ? scope : [scope]).filter(
    (part) => part !== null && part !== undefined && part !== false
  )
  return (
    <header
      data-slot="page-header"
      className={cn("grid gap-1.5 px-1 pb-3 md:px-0 md:pb-5", className)}
    >
      {parts.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-ink-muted">
          {venueScope ? (
            <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
          ) : null}
          {parts.map((part, index) => (
            <span key={index} className="contents">
              {index > 0 ? (
                <span aria-hidden className="text-ink-subtle">
                  ·
                </span>
              ) : null}
              <span
                className={cn(
                  venueScope && index === 0 && "font-bold text-ink"
                )}
              >
                {part}
              </span>
            </span>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-2">
          <h1
            id={titleId}
            className="font-display text-page-title [overflow-wrap:anywhere] text-ink"
          >
            {title}
          </h1>
          {summary ? (
            <div className="max-w-(--size-reading) text-body text-ink-muted">
              {summary}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap gap-2 *:flex-auto md:w-auto md:*:flex-none">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </header>
  )
}
