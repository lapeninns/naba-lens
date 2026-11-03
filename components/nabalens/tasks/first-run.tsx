"use client"

import Link from "next/link"
import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { useAdd } from "../shell/add-context"
import { Notice } from "../notice"
import { FIRST_RUN_COOKIE } from "./first-run-state"
import { StatusChip } from "./status-badges"
import type { MyTasksView } from "./types"

/** What is still missing, in the words of the copy deck. */
export function setupGaps(tasks: MyTasksView): string[] {
  const { scope, monthly } = tasks
  const gaps: string[] = []
  if (scope.setup.missing.includes("venue"))
    gaps.push("No venue yet: an admin assigns your venue")
  if (
    scope.setup.missing.includes("team") ||
    monthly?.setupMissing.includes("team")
  )
    gaps.push("No team yet: an admin assigns Front of house or Back of house")
  if (monthly?.setupMissing.includes("target"))
    gaps.push("No target yet: your manager sets it")
  return gaps
}

function dismiss() {
  document.cookie = `${FIRST_RUN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
}

/**
 * The one screen a new starter sees: what Naba-Lens is for, their venue, what
 * is still being set up, an optional profile photo and the first photo.
 * Leaving by either button records that it has been seen.
 */
export function FirstRun({
  name,
  venueName,
  periodLabel,
  target,
  dueLabel,
  gaps,
  uploadBlocked,
  hasAvatar,
  photoHref,
  profileHref,
  homeHref,
}: {
  name: string
  venueName: string | null
  periodLabel: string
  /** This month's target, when one is set. */
  target: number | null
  dueLabel: string | null
  gaps: string[]
  /** Why photos can't be added yet, or null. */
  uploadBlocked: string | null
  hasAvatar: boolean
  /** Where the first photo is added. */
  photoHref: string
  /** Where the profile photo is changed. */
  profileHref: string
  homeHref: string
}) {
  const openAdd = useAdd()
  const firstName = name.trim().split(/\s+/)[0] || name
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-6 md:py-10">
      <header className="grid gap-1">
        <p className="font-display text-xl text-ink">Naba-Lens</p>
        <p className="text-meta-touch font-semibold text-ink-muted md:text-meta-strong">
          {[venueName, periodLabel].filter(Boolean).join(" · ")}
        </p>
      </header>

      <main className="flex flex-col gap-6">
        <div className="grid gap-2">
          <h1 className="font-display text-page-title-compact md:text-page-title">
            Welcome, {firstName}
          </h1>
          <p className="text-body-touch text-ink md:text-body">
            Take photos at work: dishes, the bar, the venue.
          </p>
          <p className="text-body-touch text-ink-muted md:text-body">
            They&apos;re shared with your colleagues in Photos straight away.
          </p>
          {venueName ? (
            <p className="text-body-touch text-ink-muted md:text-body">
              Some help {venueName} cover what it needs this month.
            </p>
          ) : null}
        </div>

        {uploadBlocked ? (
          <section aria-labelledby="blocked-heading" className="grid gap-2">
            <h2 id="blocked-heading" className="font-display text-2xl text-ink">
              Photos can&apos;t be added yet
            </h2>
            <Notice tone="attention" role="status">
              {uploadBlocked}
            </Notice>
          </section>
        ) : gaps.length > 0 ? (
          <section aria-labelledby="setup-heading" className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="setup-heading" className="font-display text-2xl text-ink">
                Still being set up
              </h2>
              <StatusChip tone="warning">Needs setup</StatusChip>
            </div>
            <ul className="grid gap-2">
              {gaps.map((gap) => (
                <li key={gap} className="flex items-start gap-2 text-sm">
                  <CircleIcon
                    className="mt-0.5 size-4 shrink-0 text-warning"
                    aria-hidden
                  />
                  {gap}
                </li>
              ))}
            </ul>
            <Notice tone="positive" role="status">
              You can take photos now. They go to Photos and your profile
              straight away.
            </Notice>
          </section>
        ) : (
          <section aria-labelledby="month-heading" className="grid gap-2">
            <h2 id="month-heading" className="font-display text-2xl text-ink">
              Your photos for {periodLabel}
            </h2>
            {target ? (
              <p className="flex flex-wrap gap-x-3 text-body-touch text-ink md:text-body">
                <span>of {target} accepted</span>
                <span>{target} to take</span>
                {dueLabel ? <span>{dueLabel}</span> : null}
              </p>
            ) : null}
          </section>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
          <p className="flex items-center gap-2 text-sm">
            {hasAvatar ? (
              <CheckCircleIcon
                weight="fill"
                className="size-4 text-positive"
                aria-hidden
              />
            ) : null}
            <span>
              Profile photo <span className="text-ink-muted">(optional)</span>
            </span>
          </p>
          <Link
            href={profileHref}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {hasAvatar ? "Change photo" : "Add a profile photo"}
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          {uploadBlocked ? (
            <button
              type="button"
              disabled
              className={cn(buttonVariants({ size: "touch" }), "w-full")}
            >
              Take your first photo
            </button>
          ) : openAdd ? (
            <button
              type="button"
              onClick={() => {
                dismiss()
                openAdd()
              }}
              className={cn(buttonVariants({ size: "touch" }), "w-full")}
            >
              Take your first photo
            </button>
          ) : (
            <Link
              href={photoHref}
              onClick={dismiss}
              className={cn(buttonVariants({ size: "touch" }), "w-full")}
            >
              Take your first photo
            </Link>
          )}
          <Link
            href={homeHref}
            onClick={dismiss}
            className={cn(
              buttonVariants({ variant: "quiet", size: "touch" }),
              "w-full"
            )}
          >
            Go to Home
          </Link>
        </div>
      </main>
    </div>
  )
}
