"use client"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"

/** A failed menu item read; the way back to Menu stays. */
export default function ManagerMenuItemError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={MANAGER_COPY.item.title}
      what={MANAGER_COPY.couldNotLoad.item}
      error={error}
      retry={retry}
      back={{
        href: managerHrefs.menu(),
        label: MANAGER_COPY.notFoundItem.back,
      }}
    />
  )
}
