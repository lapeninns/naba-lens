import { OUR_MENU_COPY } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const WIDTHS = ["58%", "44%", "66%", "50%"]

/**
 * Our menu while it loads, in its real layout: the count card, the search
 * field and pills, then a section card of dish rows. Flat blocks, no pulse.
 */
export default function OurMenuLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-page) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        scope={OUR_MENU_COPY.title}
        title={OUR_MENU_COPY.title}
        className="pb-1 md:pb-1"
      />
      <SkeletonRegion
        label={OUR_MENU_COPY.loading}
        className="grid gap-(--gutter)"
      >
        <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="title" />
          <Skeleton className="h-3 w-full rounded-round" />
          <Skeleton shape="line" className="w-4/5" />
        </div>
        <Skeleton className="h-14 w-full" />
        <div className="flex flex-wrap gap-2">
          {["w-36", "w-48", "w-32"].map((width) => (
            <Skeleton key={width} className={`h-11 rounded-round ${width}`} />
          ))}
        </div>
        <div className="grid overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 px-3 pt-3.5 pb-1 sm:px-4">
            <Skeleton shape="title" className="w-32" />
            <Skeleton shape="line" className="w-16" />
          </div>
          <div className="grid divide-y divide-line px-3 sm:px-4">
            {WIDTHS.map((width, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="size-14 shrink-0" />
                <div className="grid flex-1 gap-2">
                  <Skeleton shape="line" style={{ width }} />
                  <Skeleton className="h-8 w-44 rounded-square" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </div>
  )
}
