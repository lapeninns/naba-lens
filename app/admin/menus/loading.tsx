import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { MenusHeader } from "./menus-header"

const ROWS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
  ["58%", "36%"],
]

/** The tally card, then the venue rows in one card, as they will load. */
export default function MenusLoading() {
  return (
    <div className="mx-auto w-full max-w-(--size-page) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <MenusHeader />
      <SkeletonRegion label="Loading menus…" className="grid gap-6">
        <div className="grid grid-cols-2 gap-2 rounded-card bg-surface p-3 shadow-card md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid gap-2 px-3 py-2.5">
              <Skeleton shape="line" className="w-28" />
              <Skeleton shape="title" className="w-12" />
            </div>
          ))}
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {ROWS.map(([title, meta], index) => (
            <div
              key={index}
              className="flex min-h-16 items-center gap-3 px-4 py-3"
            >
              <Skeleton shape="av" />
              <div className="grid flex-1 gap-2">
                <Skeleton shape="line" style={{ width: title }} />
                <Skeleton shape="line" style={{ width: meta }} />
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
