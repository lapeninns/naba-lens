import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/**
 * A workspace page's skeleton in the real layout (header, a card, rows),
 * announced with what that page is loading. The shell stays in place.
 */
export function ManagerWorkspaceLoading({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="grid gap-(--gutter)">
      <div className="grid gap-2 px-1">
        <Skeleton shape="line" className="w-40" />
        <Skeleton shape="title" className="w-48 max-w-full" />
      </div>
      <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
        <Skeleton shape="title" className="w-3/4" />
        <Skeleton shape="line" className="w-full" />
        <Skeleton shape="line" className="w-1/2" />
      </div>
      <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
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
