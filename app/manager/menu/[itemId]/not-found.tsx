import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { buttonVariants } from "@/components/ui/button"

/** An id that is not an item of the venue's active menu (or another venue's). */
export default function ManagerMenuItemNotFound() {
  return (
    <EmptyState
      title={MANAGER_COPY.notFoundItem.title}
      action={
        <Link
          href={managerHrefs.menu()}
          className={buttonVariants({ variant: "secondary", size: "touch" })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          {MANAGER_COPY.notFoundItem.back}
        </Link>
      }
    />
  )
}
