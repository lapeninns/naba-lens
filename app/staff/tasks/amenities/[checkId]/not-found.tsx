import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export default function AmenityCaptureNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-page-title">
        This check isn&apos;t yours
      </h1>
      <p className="text-body-touch text-ink-muted md:text-body">
        It isn&apos;t assigned to you, or it was removed. Your amenity checks
        are on Home.
      </p>
      <Link href="/staff/tasks" className={buttonVariants({ size: "touch" })}>
        Go to Home
      </Link>
    </main>
  )
}
