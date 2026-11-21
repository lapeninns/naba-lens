"use client"

import Link from "next/link"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"
import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"

/**
 * Any staff page that failed without a boundary of its own (DESIGN.md §16):
 * says so in plain words, offers Try again, and a way to Today, so the
 * person is never stranded without the tab bar.
 */
export default function StaffError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-feed min-w-0 content-start gap-gutter px-page-gutter py-6 md:py-10">
      <h1 className="type-page-title text-ink">Something didn&rsquo;t load</h1>
      <ErrorState
        title={ERROR_COPY.couldNotLoad()}
        action={
          <Button variant="primary" size="sm" onClick={() => retry()}>
            {ERROR_COPY.tryAgain}
          </Button>
        }
      >
        Check your connection and try again. Photos already on this phone are
        safe.
      </ErrorState>
      <Link
        href={STAFF_PHOTO_ROUTES.home}
        className="inline-flex min-h-12 items-center justify-self-start text-label text-accent-text underline-offset-4 hover:underline focus-ring"
      >
        Go to Today
      </Link>
    </main>
  )
}
