import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { buttonVariants } from "@/components/ui/button"

export default function ManagerNotFound() {
  return (
    <EmptyState
      title={MANAGER_COPY.notFound.title}
      action={
        <Link
          href={managerHrefs.overview}
          className={buttonVariants({ variant: "secondary", size: "touch" })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          {MANAGER_COPY.notFound.back}
        </Link>
      }
    />
  )
}
