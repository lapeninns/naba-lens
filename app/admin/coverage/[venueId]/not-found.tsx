import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"

import { VENUE_COVERAGE_COPY } from "../coverage-copy"

export default function VenueCoverageNotFound() {
  return (
    <AppShell variant="admin" active="coverage">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={VENUE_COVERAGE_COPY.title}
          className="pb-0 md:pb-0"
        />
        <EmptyState
          title={VENUE_COVERAGE_COPY.notFoundTitle}
          description={<p>{VENUE_COVERAGE_COPY.notFoundText}</p>}
          action={
            <Link
              href="/admin/coverage"
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              {VENUE_COVERAGE_COPY.backToVenues}
            </Link>
          }
        />
      </div>
    </AppShell>
  )
}
