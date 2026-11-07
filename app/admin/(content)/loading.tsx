import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton } from "@/components/ui/skeleton"

import { LIBRARY_COPY } from "../library-copy"
import { LibraryGridSkeleton } from "../library-states"

export default function AdminLoading() {
  return (
    <AppShell variant="admin" active="content" logoutAction={logout}>
      <div className="flex flex-col gap-6">
        <PageHeader
          venueScope
          scope={[LIBRARY_COPY.allVenues, LIBRARY_COPY.order]}
          title={LIBRARY_COPY.title}
          summary={<p>{LIBRARY_COPY.summary}</p>}
          className="pb-0 md:pb-0"
        />
        <div
          aria-hidden
          className="grid grid-cols-2 gap-x-3 gap-y-4 md:flex md:flex-wrap md:items-end"
        >
          {[
            "md:w-48",
            "md:w-48",
            "col-span-2 md:w-80",
            "col-span-2 md:w-64",
          ].map((width, i) => (
            <div key={i} className={`grid gap-1.5 ${width}`}>
              <Skeleton shape="line" className="w-20" />
              <Skeleton className="h-14 rounded-control" />
            </div>
          ))}
        </div>
        <LibraryGridSkeleton />
      </div>
    </AppShell>
  )
}
