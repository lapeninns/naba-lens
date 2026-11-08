"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button, buttonVariants } from "@/components/ui/button"

/**
 * Body of a workspace segment's error boundary: the page's title, what failed
 * and Try again, with a way back on detail pages. The layout, and so the
 * shell, stays in place. A refused read (access ended) never lands here: the
 * pages send it to Overview, which shows Venue access unavailable.
 */
export function ManagerWorkspaceError({
  title,
  what,
  error,
  retry,
  back,
}: {
  title: string
  what: string
  error: unknown
  retry: () => void
  back?: { href: string; label: string }
}) {
  const router = useRouter()
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined
  return (
    <div className="grid gap-5">
      {back ? (
        <Link
          href={back.href}
          className={buttonVariants({
            variant: "link",
            className: "justify-self-start",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <h1 className="font-display text-page-title [overflow-wrap:anywhere] text-ink">
        {title}
      </h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad(what)}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              retry()
              router.refresh()
            }}
          >
            <ArrowClockwiseIcon aria-hidden />
            {ERROR_COPY.tryAgain}
          </Button>
        }
        detail={digest ? `Request ID ${digest}` : undefined}
      />
    </div>
  )
}
