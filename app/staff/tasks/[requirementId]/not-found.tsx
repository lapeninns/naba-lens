import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export default function TaskNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">This task isn&apos;t available</h1>
      <p className="text-sm text-muted-foreground">
        It may have been removed, or it belongs to a different venue.
      </p>
      <Link href="/staff/tasks" className={buttonVariants({ size: "touch" })}>
        Back to My tasks
      </Link>
    </main>
  )
}
