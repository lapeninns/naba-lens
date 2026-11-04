import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export default function TaskNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-page-title">
        This task isn&apos;t yours
      </h1>
      <p className="text-body-touch text-ink-muted md:text-body">
        It isn&apos;t assigned to you, or it was removed. Your own tasks are in
        All tasks.
      </p>
      <Link href="/staff/tasks" className={buttonVariants({ size: "touch" })}>
        See all tasks
      </Link>
    </main>
  )
}
