import Link from "next/link"
import { UsersIcon } from "@phosphor-icons/react/dist/ssr"

import { IconDisc } from "@/components/nabalens/common-room"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"

import { PROFILE_COPY } from "../people"

/** One white card: what happened, why, and the one way back. */
export default function ColleagueNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <div className="grid justify-items-center gap-3 rounded-card bg-surface px-5 py-8 text-center shadow-card">
        <IconDisc size="lg" className="text-ink-muted">
          <UsersIcon />
        </IconDisc>
        <PageHeader
          scope="People"
          title={PROFILE_COPY.unavailable}
          summary={PROFILE_COPY.unavailableBody}
          className="justify-items-center px-0 pb-0 md:pb-0 [&_h1]:text-section-title [&>div]:justify-center [&>p]:justify-center"
        />
        <Link
          href="/staff/people"
          className={buttonVariants({
            variant: "primary",
            size: "touch",
            className: "mt-2 w-full",
          })}
        >
          <UsersIcon aria-hidden />
          {PROFILE_COPY.back}
        </Link>
      </div>
    </main>
  )
}
