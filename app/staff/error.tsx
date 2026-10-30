"use client"

import { Button } from "@/components/ui/button"

export default function StaffError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Your portfolio could not load</h1>
      <p className="text-sm text-muted-foreground">
        Check your connection and try again.
      </p>
      <Button size="touch" onClick={() => retry()}>
        Try again
      </Button>
    </main>
  )
}
