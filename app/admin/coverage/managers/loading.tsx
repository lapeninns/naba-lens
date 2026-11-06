import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { MANAGERS_COPY } from "./managers-copy"

const ROWS = [
  ["58%", "34%"],
  ["50%", "30%"],
  ["64%", "38%"],
] as const

export default function ManagersLoading() {
  return (
    <AppShell variant="admin" active="coverage" logoutAction={logout}>
      <div className="flex flex-col gap-6">
        <PageHeader
          scope={MANAGERS_COPY.scope}
          title={MANAGERS_COPY.title}
          summary={MANAGERS_COPY.summary}
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label={MANAGERS_COPY.loading} className="grid gap-5">
          {ROWS.map(([first, second], i) => (
            <div key={i} className="grid gap-2">
              <Skeleton shape="line" style={{ width: first }} />
              <Skeleton shape="line" style={{ width: second }} />
            </div>
          ))}
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
