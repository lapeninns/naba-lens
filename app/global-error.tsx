"use client"

import "./globals.css"
import { Button } from "@/components/ui/button"

/**
 * Last-resort fallback when the root layout itself fails. It replaces the root
 * layout, so it brings its own document and styles (no theme provider or fonts).
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <title>NabaLens</title>
        <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-lg font-semibold">This page could not load</h1>
          <p className="text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button size="touch" onClick={() => retry()}>
            Try again
          </Button>
        </main>
      </body>
    </html>
  )
}
