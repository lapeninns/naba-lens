"use client"

import { Button } from "@/components/ui/button"

/**
 * Fallback for errors a segment's own error.tsx cannot catch, chiefly the
 * /admin and /staff layout role gates: a segment's error.tsx does not wrap its
 * own layout. A profile read that fails there (database trouble) shows this
 * instead of Next's bare 500 document. It never grants access: `retry`
 * re-requests the page, which checks the account again.
 */
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">This page could not load</h1>
      <p className="text-sm text-muted-foreground">
        Check your connection and try again.
      </p>
      <Button size="touch" onClick={() => retry()}>
        Try again
      </Button>
    </main>
  )
}
