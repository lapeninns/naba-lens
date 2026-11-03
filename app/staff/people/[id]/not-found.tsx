import Link from "next/link"
import { UsersIcon } from "@phosphor-icons/react/dist/ssr"

import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"

import { PROFILE_COPY } from "../people"

export default function ColleagueNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        scope="People"
        title={PROFILE_COPY.unavailable}
        summary={PROFILE_COPY.unavailableBody}
        className="pb-0 md:pb-0"
      />
      <Link
        href="/staff/people"
        className={buttonVariants({
          variant: "secondary",
          size: "touch",
          className: "w-full md:w-fit",
        })}
      >
        <UsersIcon aria-hidden />
        {PROFILE_COPY.back}
      </Link>
    </main>
  )
}
