import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { amenityHrefs } from "@/lib/amenities/contract"

/**
 * An id that is not a check of the workspace venue (another venue's looks the
 * same). Same words as /staff/manage; the workspace shell stays around it.
 */
export default function ManagerAmenityCheckNotFound() {
  return (
    <div className="grid max-w-(--size-reading) gap-4">
      <h1 className="font-display text-page-title text-ink">
        This check isn&apos;t here
      </h1>
      <p className="text-body-touch text-ink-muted md:text-body">
        It belongs to another venue, or the link is wrong. Your venue&apos;s
        checks are in Amenities.
      </p>
      <div>
        <Link
          href={amenityHrefs("/manager").list}
          className={buttonVariants({ variant: "secondary", size: "touch" })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          See all amenities
        </Link>
      </div>
    </div>
  )
}
