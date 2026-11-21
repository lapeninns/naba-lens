"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BriefcaseIcon,
  CircleDashedIcon,
  MapPinIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

import { BackLink } from "../back-link"
import { ActionDock } from "../common-room/action-dock"
import { Row, RowList } from "../common-room/row"
import { Notice } from "../notice"
import { PhotoSourceActions } from "../photo-source"
import { useAdd } from "../shell/add-context"
import { completionBreakdown } from "./copy"
import { StatusChip } from "./status-badges"
import type { CompletionProgress } from "./types"

/** The three milestones of a photo, in order. */
const MILESTONES = [
  {
    word: "Saved to your portfolio",
    text: "As soon as it is sent. Colleagues see it in Photos.",
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
 * The welcome guide (screens-2 handoff): name and venue, the welcome, how
 * photos are used with its "I understand" tick box, the three steps, the
 * work details row, then a dock with a quiet Skip for now and the one
 * bottle button, Choose from your photos. It is dismissed only by an
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
  notice = null,
}: {
  name: string
  venueName: string | null
  periodLabel: string
  /**
   * This month's target and progress, when a target is set. The month has
   * no due date (v0.5 rule 23); it ends with the London calendar month.
   */
  monthly: {
    target: number
    accepted: number
    completionProgress?: CompletionProgress
  } | null
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
  /** The contribution-use notice (spec §3.2; S2-STAFF), after the welcome. */
  notice?: React.ReactNode
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

  // Gallery first: the phone's photos, never an in-app camera (DESIGN.md §2, §9).
  const choose = () => {
    openAdd?.({ source: "library", onPicked: recordPick })
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
  const sectionTitle = "type-section-title [overflow-wrap:anywhere] text-ink"

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
    <section aria-labelledby="blocked-heading" className="grid gap-gutter">
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
  ) : null

  const targetProgress = monthly ? (
    <section aria-labelledby="month-heading" className={card}>
      <h2 id="month-heading" className={sectionTitle}>
        {monthly.completionProgress ? "Your target for" : "Your photos for"}{" "}
        {periodLabel}
      </h2>
      <p
        id="month-count"
        className="text-body font-semibold text-ink tabular-nums"
      >
        {monthly.completionProgress?.total ?? monthly.accepted} of{" "}
        {monthly.target} {monthly.completionProgress ? "completed" : "accepted"}
      </p>
      {/* The frames are Progress segments (common-room.md §4; decision 6). */}
      <Progress
        mode="segments"
        accepted={monthly.completionProgress?.total ?? monthly.accepted}
        total={monthly.target}
        aria-labelledby="month-count"
      />
      {monthly.completionProgress ? (
        <p className="text-meta text-ink-muted">
          {completionBreakdown(monthly.completionProgress)}
        </p>
      ) : null}
    </section>
  ) : null

  // Gaps and blocks come straight after the hello, so they are seen first.
  const gapsFirst = Boolean(uploadBlocked) || gaps.length > 0

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto grid w-full max-w-xl gap-1 px-4 py-3">
          {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
          <p className="type-title text-ink">Naba-Lens</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-ink-muted">
            {venueName ? (
              <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
            ) : null}
            <span>
              {venueName ? (
                <b className="font-semibold text-ink">{venueName}</b>
              ) : null}
              {venueName ? " · " : null}
              {periodLabel}
            </span>
          </p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-xl gap-gutter px-page-gutter py-4 md:py-8">
        <section aria-labelledby="welcome-heading" className={card}>
          <h1
            id="welcome-heading"
            className="type-display [overflow-wrap:anywhere] text-ink"
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

        {notice}
        {gapsFirst ? middle : null}
        {milestones}
        {!gapsFirst || monthly?.completionProgress ? targetProgress : null}

        <section aria-labelledby="work-heading" className={card}>
          <h2 id="work-heading" className={sectionTitle}>
            What do you do at {venue}?
          </h2>
          {workRole ? null : (
            <p className="text-body text-ink-muted">
              Your main job sets the question Today asks you and which dishes
              come first when you label. It never changes what you can see or
              do.
            </p>
          )}
          <RowList className="shadow-none edge">
            <Row
              href={workProfileHref}
              icon={<BriefcaseIcon />}
              title={workRole ? "Change work details" : "Add your work details"}
              subtitle={workRole ?? undefined}
            />
            <Row
              href={profileHref}
              icon={<UserCircleIcon />}
              title={hasAvatar ? "Change profile photo" : "Add a profile photo"}
              subtitle="Optional"
            />
          </RowList>
        </section>

        {/* Grey first, the one bottle button last (ActionDock). */}
        <ActionDock overTabBar={false} className="mt-1">
          <Button
            type="button"
            variant="quiet"
            className="w-full"
            disabled={skipping}
            onClick={skip}
          >
            {skipping ? "Going to Today…" : "Skip for now"}
          </Button>
          {uploadBlocked ? (
            <PhotoSourceActions
              onChoose={() => undefined}
              disabled
              cameraHidden
            />
          ) : openAdd ? (
            <PhotoSourceActions onChoose={choose} cameraHidden />
          ) : (
            <Link
              href={photoHref}
              className={cn(
                buttonVariants({ variant: "primary", size: "lg" }),
                "w-full"
              )}
            >
              Add your first photo
            </Link>
          )}
        </ActionDock>
      </main>
    </div>
  )
}
