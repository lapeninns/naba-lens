import { BackLink } from "../back-link"

/**
 * The head of a page under Me (DESIGN.md §5b): "← Me", the page's title and
 * an optional action beside it.
 */
export function MeSubpageHeader({
  title,
  action = null,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <BackLink href="/staff/me">Me</BackLink>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-page-title text-ink">{title}</h1>
        {action}
      </div>
    </div>
  )
}
