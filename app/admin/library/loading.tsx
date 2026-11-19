import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Library sub-pages (S2-LIBRARY): a header, then rows of the page's cards. */
export default function AdminLibraryLoading() {
  return (
    <AppShell variant="admin" active="content">
      <div className="flex flex-col gap-6">
        <PageHeader scope="Library" title="Loading…" className="pb-0 md:pb-0" />
        <SkeletonRegion label="Loading the library" className="grid gap-4">
          <Skeleton shape="photo" className="max-w-88 rounded-card" />
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-card border border-line bg-surface p-4"
            >
              <Skeleton shape="title" className="w-48" />
              <Skeleton shape="line" className="w-full max-w-120" />
            </div>
          ))}
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
