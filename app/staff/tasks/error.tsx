"use client"

import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"

export default function TasksError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Your tasks could not load</h1>
      <p className="text-sm text-muted-foreground">
        Check your connection and try again. Photos you already sent are safe.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="touch" onClick={() => retry()}>
          Try again
        </Button>
        <Link
          href="/staff"
          className={buttonVariants({ variant: "outline", size: "touch" })}
        >
          Go to my portfolio
        </Link>
      </div>
    </main>
  )
}
