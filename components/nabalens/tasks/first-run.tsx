"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CaretLeftIcon,
  CheckIcon,
  CircleDashedIcon,
  MapPinIcon,
} from "@phosphor-icons/react"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { Notice } from "../notice"
import { PhotoSourceActions, type PhotoSource } from "../photo-source"
import { useAdd } from "../shell/add-context"
import { PhotoSegments } from "./month-card"
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

  const card = "grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
  const sectionTitle =
    "font-display text-section-title [overflow-wrap:anywhere] text-ink"

  const milestones = (
    <ol
      aria-label="What happens to a photo"
      className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
    >
      {MILESTONES.map((step, index) => (
        <li
          key={step.word}
          className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3 text-body"
        >
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-round bg-surface-2 font-mono text-label text-ink tabular-nums"
          >
            {index + 1}
          </span>
          <span className="grid min-w-0 gap-0.5 [overflow-wrap:anywhere]">
            <span className="text-item-title text-ink">{step.word}</span>
            <span className="block text-ink-muted">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  )

  const middle = uploadBlocked ? (
    <section aria-labelledby="blocked-heading" className="grid gap-(--gutter)">
      <h2 id="blocked-heading" className={cn(sectionTitle, "px-1 pt-2")}>
        Photos can&apos;t be added yet
      </h2>
      <Notice tone="attention" role="status">
        {uploadBlocked}
      </Notice>
    </section>
  ) : gaps.length > 0 ? (
    <section aria-labelledby="setup-heading" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="setup-heading" className={sectionTitle}>
          Still being set up
        </h2>
        <StatusChip tone="warning">Needs setup</StatusChip>
      </div>
      <ul className="grid divide-y divide-line overflow-hidden rounded-control bg-surface-2">
        {gaps.map((gap) => (
          <li
            key={gap}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3 text-body [overflow-wrap:anywhere]"
          >
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-round bg-surface text-ink-muted [&_svg]:size-5"
            >
              <CircleDashedIcon weight="bold" />
            </span>
            {gap}
          </li>
        ))}
      </ul>
      <Notice tone="positive" role="status">
        You can add photos now. They are saved to your portfolio.
      </Notice>
    </section>
  ) : monthly ? (
    <section aria-labelledby="month-heading" className={card}>
      <h2 id="month-heading" className={sectionTitle}>
        Your photos for {periodLabel}
      </h2>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-body text-ink">
        <span className="font-mono font-bold tabular-nums">
          {monthly.accepted} of {monthly.target} accepted
        </span>
        {monthly.dueLabel ? (
          <span className="text-ink-muted">{monthly.dueLabel}</span>
        ) : null}
      </p>
      <PhotoSegments accepted={monthly.accepted} target={monthly.target} />
    </section>
  ) : null

  // Gaps and blocks come straight after the hello, so they are seen first.
  const gapsFirst = Boolean(uploadBlocked) || gaps.length > 0

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto grid w-full max-w-xl gap-1 px-4 py-3">
          {back ? (
            <Link
              href={back.href}
              className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-control px-1 text-meta font-bold text-ink outline-none hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              <CaretLeftIcon aria-hidden weight="bold" className="size-5" />
              {back.label}
            </Link>
          ) : null}
          <p className="font-display text-page-title-compact text-ink">
            Naba-Lens
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-ink-muted">
            {venueName ? (
              <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
            ) : null}
            <span>
              {venueName ? (
                <b className="font-bold text-ink">{venueName}</b>
              ) : null}
              {venueName ? " · " : null}
              {periodLabel}
            </span>
          </p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-xl gap-(--gutter) px-(--page-gutter) py-4 md:py-8">
        <section aria-labelledby="welcome-heading" className={card}>
          <h1
            id="welcome-heading"
            className="font-display text-display [overflow-wrap:anywhere] text-ink"
          >
            Welcome, {firstName}
          </h1>
          <p className="text-lead text-ink">
            Your portfolio keeps the photos you take at work: dishes, the bar,
            the venue.
          </p>
          <p className="text-body text-ink-muted">
            They help {venue} show its food and drink, and show colleagues what
            you make.
          </p>
        </section>

        {gapsFirst ? middle : null}
        {milestones}
        {gapsFirst ? null : middle}

        <section aria-labelledby="work-heading" className={card}>
          <h2 id="work-heading" className={sectionTitle}>
            What do you do at {venue}?
          </h2>
          {workRole ? (
            <p className="flex items-center gap-2 text-body font-bold text-ink">
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-round bg-ok-bg text-ok-fg [&_svg]:size-5"
              >
                <CheckIcon weight="bold" />
              </span>
              {workRole}
            </p>
          ) : (
            <p className="text-body text-ink-muted">
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
              className="inline-flex min-h-11 items-center rounded-control text-body font-bold text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              {hasAvatar ? "Change profile photo" : "Add a profile photo"}{" "}
              (optional)
            </Link>
          </div>
        </section>

        <div className="mt-1 grid gap-2 rounded-card bg-surface p-3 shadow-card">
          {uploadBlocked ? (
            <PhotoSourceActions onChoose={() => undefined} disabled />
          ) : openAdd ? (
            <PhotoSourceActions onChoose={choose} />
          ) : (
            <Link
              href={photoHref}
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
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
