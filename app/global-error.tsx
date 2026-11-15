"use client"

import "./globals.css"
import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react"

import { IconDisc } from "@/components/nabalens/common-room/icon-disc"
import { Button } from "@/components/ui/button"

/**
 * Last-resort fallback when the root layout itself fails. It replaces the root
 * layout, so it brings its own document and styles (no theme provider or fonts).
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-canvas font-sans text-ink antialiased">
        <title>Naba-Lens</title>
        <main className="mx-auto flex min-h-svh w-full max-w-feed flex-col items-center justify-center gap-3 bg-canvas px-page-gutter py-6 text-center text-ink">
          <p className="mb-2 type-page-title">Naba-Lens</p>
          <IconDisc tone="warn">
            <WarningIcon />
          </IconDisc>
          <h1 className="type-page-title text-balance">
            This page could not load
          </h1>
          <p className="text-body text-ink-muted">
            Check your connection and try again.
          </p>
          <Button
            variant="primary"
            className="mt-2 min-w-55"
            onClick={() => retry()}
          >
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            Try again
          </Button>
        </main>
      </body>
    </html>
  )
}
