"use client"

import * as React from "react"
import Link from "next/link"
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react"

import { PhotoTips } from "@/components/nabalens/guide/photo-tips"
import { GUIDE_PATH } from "@/components/nabalens/guide/task-photo-guide"
import { Button } from "@/components/ui/button"
import type { EntryIntent, EntryMenu } from "@/lib/work-client/entry"

import { ENTRY_COPY } from "./entry-copy"

export type EntryStep = "choose" | "task" | "question" | "change"

export type EntryHrefs = {
  /** Our menu, where a dish is picked (its buttons carry the dish preset). */
  dish: string
  task: (id: string) => string
  /** The capture page, for answering and for reporting a change. */
  question: (checkId: string) => string
}

const ROW =
  "flex min-h-14 w-full items-center gap-3 rounded-touch border border-line-control px-4 py-3 text-left transition-colors outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"

/** "For {venue}", then who sees it (§4.2); the second line may be absent. */
export function EntryContext({
  venueName,
  audience,
}: {
  venueName: string
  audience?: string | null
}) {
  return (
    <div data-slot="entry-context" className="grid gap-0.5">
      <p className="text-label-touch [overflow-wrap:anywhere] text-ink md:text-label">
        {ENTRY_COPY.venue(venueName)}
      </p>
      {audience ? (
        <p className="text-meta-touch text-ink-muted md:text-meta">
          {audience}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The shared entry (B02 UI design §4.1): only the choices this person can
 * complete, each going to its existing destination. Tasks and questions are
 * picked here; a dish is picked on Our menu; "Just photos" is today's Add.
 * Moving between steps puts focus on the step's heading. `Title` renders the
 * heading (a dialog's title, or a section heading inline).
 */
export function EntryFlow({
  menu,
  hrefs,
  role = "staff",
  initialStep = "choose",
  onPhotos,
  onNavigate,
  Title,
  titleId,
}: {
  menu: EntryMenu
  hrefs: EntryHrefs
  /** Managers get no "Your manager sees this." line. */
  role?: "staff" | "manager"
  initialStep?: EntryStep
  /** "Just photos": today's Add. */
  onPhotos?: () => void
  /** A choice left for another page (a dialog closes). */
  onNavigate?: () => void
  Title: React.ElementType
  titleId?: string
}) {
  const [step, setStep] = React.useState<EntryStep>(initialStep)
  const titleRef = React.useRef<HTMLElement>(null)
  const moved = React.useRef(false)
  React.useEffect(() => {
    if (!moved.current) return
    moved.current = false
    titleRef.current?.focus()
  }, [step])
  const go = (next: EntryStep) => {
    moved.current = true
    setStep(next)
  }
  const finding = role === "staff" ? ENTRY_COPY.findingAudience : null
  const hint: Record<EntryIntent, string | null> = {
    dish: `${ENTRY_COPY.photosAudience} ${ENTRY_COPY.dishAudience}`,
    task: ENTRY_COPY.photosAudience,
    question: finding,
    change: finding,
    photos: ENTRY_COPY.photosAudience,
  }
  const title = (text: string) => (
    <Title ref={titleRef} id={titleId} tabIndex={-1} className="outline-none">
      {text}
    </Title>
  )

  if (step === "choose")
    return (
      <div className="grid gap-4">
        {title(ENTRY_COPY.title)}
        <EntryContext venueName={menu.venueName} />
        <ul className="grid gap-3">
          {menu.intents.map((intent) => (
            <li key={intent}>
              {intent === "dish" ? (
                <Link href={hrefs.dish} className={ROW} onClick={onNavigate}>
                  <Choice title={ENTRY_COPY.intents.dish} hint={hint.dish} />
                </Link>
              ) : (
                <button
                  type="button"
                  className={ROW}
                  onClick={() =>
                    intent === "photos" ? onPhotos?.() : go(intent)
                  }
                >
                  <Choice
                    title={ENTRY_COPY.intents[intent]}
                    hint={hint[intent]}
                  />
                </button>
              )}
            </li>
          ))}
        </ul>
        {/* Optional (D8): closed, so nobody passes through it to a choice. */}
        {menu.intents.includes("dish") || menu.intents.includes("photos") ? (
          <PhotoTips guideHref={role === "staff" ? GUIDE_PATH : null} />
        ) : null}
      </div>
    )

  const items =
    step === "task"
      ? menu.tasks.map((task) => ({
          key: task.id,
          label: task.title,
          href: hrefs.task(task.id),
        }))
      : (step === "question" ? menu.questions : menu.answered).map((q) => ({
          key: q.checkId,
          label: q.question,
          href: hrefs.question(q.checkId),
        }))
  return (
    <div className="grid gap-4">
      {title(ENTRY_COPY.pick[step])}
      <EntryContext venueName={menu.venueName} audience={hint[step]} />
      <ul className="grid gap-3">
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href} className={ROW} onClick={onNavigate}>
              <Choice title={item.label} />
            </Link>
          </li>
        ))}
      </ul>
      {initialStep === "choose" ? (
        <div>
          <Button variant="quiet" size="touch" onClick={() => go("choose")}>
            <CaretLeftIcon data-icon="inline-start" aria-hidden />
            {ENTRY_COPY.back}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Choice({ title, hint }: { title: string; hint?: string | null }) {
  return (
    <>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-item-title-touch [overflow-wrap:anywhere] text-ink">
          {title}
        </span>
        {hint ? (
          <span className="text-meta-touch text-ink-muted">{hint}</span>
        ) : null}
      </span>
      <CaretRightIcon
        aria-hidden
        weight="bold"
        className="size-5 shrink-0 text-ink-muted"
      />
    </>
  )
}
