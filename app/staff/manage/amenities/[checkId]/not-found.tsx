import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { amenityHrefs } from "@/lib/amenities/contract"

export default function ManageAmenityCheckNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-page-title">
        This check isn&apos;t here
      </h1>
      <p className="text-body-touch text-ink-muted md:text-body">
        It belongs to another venue, or the link is wrong. Your venue&apos;s
        checks are in Amenities.
      </p>
      <Link
        href={amenityHrefs("/staff/manage").list}
        className={buttonVariants({ size: "touch" })}
      >
        See all amenities
      </Link>
    </main>
  )
}
