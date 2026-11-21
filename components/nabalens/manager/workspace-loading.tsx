import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/**
 * A workspace page's skeleton in the real layout, announced with what that
 * page is loading; the shell (venue bar and nav) stays in place. The
 * handoff's Loading state: when the page's title and section tabs are
 * known, they are already there for real, and sunken blocks stand in the
 * shape of the chips and rows that are coming.
 */
export function ManagerWorkspaceLoading({
  label,
  title,
  tabs,
  chips = 0,
}: {
  label: string
  /** The page's real title, when it does not wait on the read. */
  title?: string
  /** The section's real tabs, under the title. */
  tabs?: React.ReactNode
  /** How many filter chips the page shows above its rows. */
  chips?: number
}) {
  return (
    <SkeletonRegion label={label} className="grid gap-gutter">
      {title ? (
        <div className="grid gap-4">
          <PageHeader title={title} className="pb-0 md:pb-0" />
          {tabs}
        </div>
      ) : (
        <div className="grid gap-2 px-1">
          <Skeleton shape="line" className="w-40" />
          <Skeleton shape="title" className="w-48 max-w-full" />
        </div>
      )}
      {chips > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: chips }, (_, chip) => (
            <Skeleton
              key={chip}
              shape="button"
              className="w-24 rounded-round desktop:h-10"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 rounded-card bg-surface p-4 edge">
          <Skeleton shape="title" className="w-3/4" />
          <Skeleton shape="line" className="w-full" />
          <Skeleton shape="line" className="w-1/2" />
        </div>
      )}
      <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface edge">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex min-h-16 items-center gap-3 p-3">
            <Skeleton shape="av" />
            <Skeleton shape="line" style={{ width: `${55 - row * 10}%` }} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
