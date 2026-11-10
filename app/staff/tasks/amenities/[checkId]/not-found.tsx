import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export default function AmenityCaptureNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-page-title">
        We can&apos;t find this question for your venue.
      </h1>
      <p className="text-body-touch text-ink-muted md:text-body">
        Your amenity checks are on Home.
      </p>
      <Link href="/staff/tasks" className={buttonVariants({ size: "touch" })}>
        Go to Home
      </Link>
    </main>
  )
}
