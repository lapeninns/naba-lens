import { MediaPostSkeleton } from "@/components/nabalens/media-grid"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Photos while it loads: the header, the summary line and posts, in place. */
export default function CommunityLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-page) flex-col px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
        <PageHeader
          scope="All venues"
          title="Photos"
          summary="newest first"
          className="pb-1 md:pb-1"
        />
        <SkeletonRegion label="Loading photos…" className="grid gap-(--gutter)">
          <Skeleton shape="line" className="mx-1 w-48" />
          {[0, 1, 2].map((i) => (
            <MediaPostSkeleton key={i} />
          ))}
        </SkeletonRegion>
      </div>
    </div>
  )
}
