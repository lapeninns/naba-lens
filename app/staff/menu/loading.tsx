import { OUR_MENU_COPY } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const WIDTHS = ["58%", "44%", "66%", "50%", "38%"]

export default function OurMenuLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-page) flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        scope={OUR_MENU_COPY.title}
        title={OUR_MENU_COPY.title}
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion label={OUR_MENU_COPY.loading} className="grid gap-4">
        <Skeleton shape="line" className="h-11 md:h-9" />
        <div className="grid grid-cols-2 gap-2 md:flex">
          {[0, 1].map((tab) => (
            <Skeleton key={tab} shape="line" className="h-9 md:w-36" />
          ))}
        </div>
        {WIDTHS.map((width, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton shape="tile" className="size-16 shrink-0" />
            <div className="grid flex-1 gap-2">
              <Skeleton shape="line" style={{ width }} />
              <Skeleton shape="line" className="w-28" />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    </div>
  )
}
