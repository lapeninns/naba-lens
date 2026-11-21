import { BackLink } from "@/components/nabalens/back-link"
import { EmptyState } from "@/components/nabalens/empty-state"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"

/**
 * Not found inside the shell, nav kept; the BackLink names Overview
 * (redesign R4, ia.md decision 12).
 */
export default function ManagerNotFound() {
  return (
    <div className="grid gap-1">
      <BackLink href={managerHrefs.overview} compact>
        {MANAGER_COPY.notFound.back}
      </BackLink>
      <EmptyState titleAs="h1" title={MANAGER_COPY.notFound.title} />
    </div>
  )
}
