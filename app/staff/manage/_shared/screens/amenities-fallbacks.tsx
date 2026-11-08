"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { AppShell } from "@/components/nabalens/app-shell"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const PAGE =
  "mx-auto grid w-full max-w-(--size-page) gap-5 px-4 py-6 sm:px-6 sm:py-8"

function Shell({
  admin,
  children,
}: {
  admin?: boolean
  children: React.ReactNode
}) {
  return admin ? (
    <AppShell variant="admin" active="coverage">
      <div className="grid gap-5">{children}</div>
    </AppShell>
  ) : (
    <main className={PAGE}>{children}</main>
  )
}

/** Loading state for the amenity list and check pages. */
export function AmenitiesLoading({
  label,
  admin,
}: {
  label: string
  admin?: boolean
}) {
  return (
    <Shell admin={admin}>
      <SkeletonRegion label={label} className="grid gap-5">
        <div className="grid gap-2">
          <Skeleton shape="title" className="w-[40%]" />
          <Skeleton shape="line" className="w-[70%]" />
        </div>
        {["w-3/5", "w-[52%]", "w-[66%]"].map((wide) => (
          <div key={wide} className="grid gap-2">
            <Skeleton shape="line" className={wide} />
            <Skeleton shape="line" className="w-[35%]" />
          </div>
        ))}
      </SkeletonRegion>
    </Shell>
  )
}

/** Segment error boundary body: what failed and "Try again". */
export function AmenitiesError({
  title,
  what,
  retry,
  admin,
}: {
  title: string
  what: string
  retry: () => void
  admin?: boolean
}) {
  return (
    <Shell admin={admin}>
      <h1 className="font-display text-page-title text-ink">{title}</h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad(what)}
        action={
          <Button variant="secondary" size="sm" onClick={() => retry()}>
            <ArrowClockwiseIcon aria-hidden />
            {ERROR_COPY.tryAgain}
          </Button>
        }
      />
    </Shell>
  )
}
