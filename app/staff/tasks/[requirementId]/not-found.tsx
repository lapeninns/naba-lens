import Link from "next/link"
import { LockSimpleIcon } from "@phosphor-icons/react/dist/ssr"

import { IconDisc } from "@/components/nabalens/common-room/icon-disc"
import { buttonVariants } from "@/components/ui/button"

export default function TaskNotFound() {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-feed content-center px-page-gutter py-6">
      <div className="grid justify-items-center gap-4 rounded-card bg-surface px-5 py-8 text-center shadow-card">
        <IconDisc size="lg">
          <LockSimpleIcon />
        </IconDisc>
        <h1 className="type-page-title text-ink">This task isn&apos;t yours</h1>
        <p className="max-w-reading text-body text-ink-muted">
          It isn&apos;t assigned to you, or it was removed. Your own tasks are
          in All tasks.
        </p>
        <Link
          href="/staff/tasks/all"
          className={buttonVariants({
            variant: "primary",
            size: "lg",
            className: "w-full",
          })}
        >
          See all tasks
        </Link>
      </div>
    </main>
  )
}
