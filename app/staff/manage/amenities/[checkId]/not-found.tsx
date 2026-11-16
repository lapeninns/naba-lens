import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { amenityHrefs } from "@/lib/amenities/contract"

export default function ManageAmenityCheckNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="type-page-title">This check isn&apos;t here</h1>
      <p className="text-body text-ink-muted">
        It belongs to another venue, or the link is wrong. Your venue&apos;s
        checks are in Amenities.
      </p>
      <Link
        href={amenityHrefs("/staff/manage").list}
        className={buttonVariants({ variant: "primary" })}
      >
        See all amenities
      </Link>
    </main>
  )
}
