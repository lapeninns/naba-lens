import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export default function AmenityCaptureNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="type-page-title">
        We can&apos;t find this question for your venue.
      </h1>
      <p className="text-body text-ink-muted">
        Your amenity questions are in Album.
      </p>
      <Link
        href="/staff/album/amenities"
        className={buttonVariants({ variant: "primary" })}
      >
        Go to Amenities
      </Link>
    </main>
  )
}
