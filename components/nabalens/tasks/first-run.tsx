"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CaretLeftIcon,
  CheckCircleIcon,
  CircleIcon,
} from "@phosphor-icons/react"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { Notice } from "../notice"
import { PhotoSourceActions, type PhotoSource } from "../photo-source"
import { useAdd } from "../shell/add-context"
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

/** The three milestones of a photo, in order. */
const MILESTONES = [
  {
    word: "Saved to your portfolio",
    text: "As soon as it uploads. Colleagues see it in Photos.",
  },
  {
    word: "Ready to label",
    text: "Say which dish or drink it shows, so it can be found later.",
  },
  {
    word: "Accepted for menu use",
    text: "A manager chose it to show a dish on your venue's menu.",
  },
] as const

/**
 * The welcome guide: what the portfolio is for, the work details step, then
 * the photo pickers, with a quiet Skip for now. It is dismissed only by an
 * actual file pick or by Skip; cancelling the picker leaves it on offer.
 * Anyone can reopen it from Me.
 */
export function FirstRun({
  name,
  venueName,
  periodLabel,
  monthly,
  gaps,
  uploadBlocked,
  hasAvatar,
  workRole,
  photoHref,
  profileHref,
  workProfileHref,
  homeHref,
  back = null,
  dismiss,
}: {
  name: string
  venueName: string | null
  periodLabel: string
  /** This month's target and accepted photos, when a target is set. */
  monthly: { target: number; accepted: number; dueLabel: string | null } | null
  gaps: string[]
  /** Why photos can't be added yet, or null. */
  uploadBlocked: string | null
  hasAvatar: boolean
  /** The saved main role in the person's words, or null. */
  workRole: string | null
  /** Where photos are added outside the staff layout (Me). */
  photoHref: string
  /** Where the profile photo and name are changed (Me's Edit profile). */
  profileHref: string
  /** The work details page, coming back here afterwards. */
  workProfileHref: string
  homeHref: string
  /** A way back to where the guide was opened from (Me). */
  back?: { href: string; label: string } | null
  /** Records the dismissal (welcome_dismissed_at); errors are ignored. */
  dismiss: (dismissed: boolean) => Promise<unknown>
}) {
  const router = useRouter()
  const openAdd = useAdd()
  const [skipping, startSkip] = React.useTransition()
  const firstName = name.trim().split(/\s+/)[0] || name
  const venue = venueName ?? "your venue"

  // Fire and forget: the picker must open in this same click, so nothing here
  // may wait on the server (iOS drops the user activation after an await).
  const recordPick = () => {
    void dismiss(true).catch(() => undefined)
  }

  const choose = (source: PhotoSource) => {
    openAdd?.({ source, onPicked: recordPick })
  }

  const skip = () =>
    startSkip(async () => {
      try {
        await dismiss(true)
      } catch {
        // Offline or a failed write: Home offers Start here again, which is fine.
      }
      router.push(homeHref)
    })

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-6 md:py-10">
      <header className="grid gap-1">
        {back ? (
          <Link
            href={back.href}
            className="mb-2 inline-flex w-fit items-center gap-1 text-meta-touch font-semibold text-ink-muted underline-offset-3 hover:underline md:text-meta-strong"
          >
            <CaretLeftIcon aria-hidden className="size-4" />
            {back.label}
          </Link>
        ) : null}
        <p className="font-display text-count-sm text-ink">Naba-Lens</p>
        <p className="text-meta-touch font-semibold text-ink-muted md:text-meta-strong">
          {[venueName, periodLabel].filter(Boolean).join(" · ")}
        </p>
      </header>

      <main className="flex flex-col gap-6">
        <section aria-labelledby="welcome-heading" className="grid gap-2">
          <h1
            id="welcome-heading"
            className="font-display text-page-title-compact md:text-page-title"
          >
            Welcome, {firstName}
          </h1>
          <p className="text-body-touch text-ink md:text-body">
            Your portfolio keeps the photos you take at work: dishes, the bar,
            the venue.
          </p>
          <p className="text-body-touch text-ink-muted md:text-body">
            They help {venue} show its food and drink, and show colleagues what
            you make.
          </p>
          <ol aria-label="What happens to a photo" className="mt-2 grid gap-2">
            {MILESTONES.map((step, index) => (
              <li
                key={step.word}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-body-touch md:text-body-sm"
              >
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-round bg-well text-chip text-ink tabular-nums"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{step.word}</span>
                  <span className="block text-ink-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

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
                <li
                  key={gap}
                  className="flex items-start gap-2 text-body-touch md:text-body-sm"
                >
                  <CircleIcon
                    className="mt-0.5 size-4 shrink-0 text-warning"
                    aria-hidden
                  />
                  {gap}
                </li>
              ))}
            </ul>
            <Notice tone="positive" role="status">
              You can add photos now. They are saved to your portfolio.
            </Notice>
          </section>
        ) : monthly ? (
          <section aria-labelledby="month-heading" className="grid gap-2">
            <h2 id="month-heading" className="font-display text-2xl text-ink">
              Your photos for {periodLabel}
            </h2>
            <p className="flex flex-wrap gap-x-3 text-body-touch text-ink md:text-body">
              <span>
                {monthly.accepted} of {monthly.target} accepted
              </span>
              {monthly.dueLabel ? <span>{monthly.dueLabel}</span> : null}
            </p>
          </section>
        ) : null}

        <section
          aria-labelledby="work-heading"
          className="grid gap-3 rounded-xl border border-line p-4"
        >
          <h2
            id="work-heading"
            className="text-item-title-touch text-ink md:text-item-title"
          >
            What do you do at {venue}?
          </h2>
          {workRole ? (
            <p className="flex items-center gap-2 text-body-touch md:text-body-sm">
              <CheckCircleIcon
                weight="fill"
                className="size-4 text-positive"
                aria-hidden
              />
              {workRole}
            </p>
          ) : (
            <p className="text-body-touch text-ink-muted md:text-body-sm">
              Your main job sets the question Home asks you and which dishes
              come first when you label. It never changes what you can see or
              do.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={workProfileHref}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {workRole ? "Change work details" : "Add your work details"}
            </Link>
            <Link
              href={profileHref}
              className="text-meta-touch text-ink-muted underline underline-offset-3 md:text-meta"
            >
              {hasAvatar ? "Change profile photo" : "Add a profile photo"}{" "}
              (optional)
            </Link>
          </div>
        </section>

        <div className="flex flex-col gap-3">
          {uploadBlocked ? (
            <PhotoSourceActions onChoose={() => undefined} disabled />
          ) : openAdd ? (
            <PhotoSourceActions onChoose={choose} />
          ) : (
            <Link
              href={photoHref}
              className={cn(buttonVariants({ size: "touch" }), "w-full")}
            >
              Add your first photo
            </Link>
          )}
          <Button
            type="button"
            variant="quiet"
            size="touch"
            className="w-full"
            disabled={skipping}
            onClick={skip}
          >
            {skipping ? "Going to Home…" : "Skip for now"}
          </Button>
        </div>
      </main>
    </div>
  )
}
