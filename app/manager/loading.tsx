import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function ManagerLoading() {
  return (
    <SkeletonRegion
      label={MANAGER_COPY.overview.loading}
      className="grid gap-5"
    >
      <Skeleton shape="line" style={{ width: "30%" }} />
      <Skeleton shape="line" style={{ width: "55%" }} />
      <Skeleton shape="line" style={{ width: "45%" }} />
    </SkeletonRegion>
  )
}
