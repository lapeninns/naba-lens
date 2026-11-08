import Link from "next/link"
import {
  CheckIcon,
  CircleDashedIcon,
  MinusCircleIcon,
} from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { departmentLabel, type Department } from "@/lib/config/departments"
import { cn } from "@/lib/utils"

import { StatusChip } from "./status-badges"
import type { CoverageScope } from "./types"

type SetupProfile = {
  displayName: string
  venueName: string | null
  department: Department | null
  hasAvatar: boolean
}

type Step = {
  id: string
  label: string
  done: boolean
  /** Shown when done. */
  value?: string | null
  /** What to do when not done. */
  todo: React.ReactNode
  optional?: boolean
}

/**
 * Profile setup: name, venue and team (FOH/BOH) are required; a profile photo
 * is optional. Staff edit their name and photo themselves; an admin assigns
 * venue and team. Like every To do card, it ends in one action (Edit profile)
 * when there is something the person can do, and says so when there isn't.
 */
export function SetupChecklist({
  setup,
  profile,
  editProfileHref,
  actionClassName = buttonVariants({ variant: "secondary", size: "touch" }),
}: {
  setup: CoverageScope["setup"]
  profile: SetupProfile
  /** Me with its Edit profile dialog open (`/staff?edit=profile`). */
  editProfileHref: string
  /** The card's action style: the page's primary button on the lead card. */
  actionClassName?: string
}) {
  const missing = new Set(setup.missing)
  const hasName = profile.displayName.trim() !== ""
  const editLink = (
    <Link
      href={editProfileHref}
      className="font-bold text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      Edit profile
    </Link>
  )
  const steps: Step[] = [
    {
      id: "name",
      label: "Name",
      done: hasName,
      value: profile.displayName,
      todo: "Add your name in Edit profile.",
    },
    {
      id: "venue",
      label: "Venue",
      done: !missing.has("venue"),
      value: profile.venueName,
      todo: "Ask an admin to assign your venue.",
    },
    {
      id: "team",
      label: "Team (FOH or BOH)",
      done: !missing.has("team"),
      value: departmentLabel(profile.department),
      todo: "Ask an admin to set your team.",
    },
    {
      id: "photo",
      label: "Profile photo",
      done: profile.hasAvatar,
      todo: "Add one in Edit profile.",
      optional: true,
    },
  ]

  if (setup.complete && hasName) {
    if (profile.hasAvatar) return null
    return (
      <p className="px-1 text-meta text-ink-muted">
        Optional: add a profile photo in {editLink}.
      </p>
    )
  }

  return (
    <section
      aria-labelledby="setup-heading"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2
          id="setup-heading"
          className="min-w-0 font-display text-card-title [overflow-wrap:anywhere] text-ink"
        >
          Your setup isn&apos;t finished
        </h2>
        <StatusChip tone="warning">Needs setup</StatusChip>
      </div>
      <p className="text-body text-ink">
        You can still add photos to your profile in the meantime.
      </p>
      <ul
        className="grid divide-y divide-line overflow-hidden rounded-control bg-surface-2"
        aria-label="Profile setup"
      >
        {steps.map((step) => (
          <li
            key={step.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3 text-body"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-8 place-items-center rounded-round [&_svg]:size-5",
                step.done ? "bg-ok-bg text-ok-fg" : "bg-surface text-ink-muted"
              )}
            >
              {step.done ? (
                <CheckIcon weight="bold" />
              ) : step.optional ? (
                <MinusCircleIcon />
              ) : (
                <CircleDashedIcon weight="bold" />
              )}
            </span>
            <span className="grid min-w-0 gap-0.5 [overflow-wrap:anywhere]">
              <span className="font-bold text-ink">
                {step.label}
                {step.optional ? " (optional)" : null}
              </span>
              <span className="sr-only">
                {step.done ? ": done" : step.optional ? ". " : ": missing"}
              </span>
              <span className="block text-ink-muted">
                {step.done ? (step.value ?? "Added") : step.todo}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {!hasName || !profile.hasAvatar ? (
        <Link href={editProfileHref} className={actionClassName}>
          Edit profile
        </Link>
      ) : (
        <p className="text-body text-ink-muted">
          There&apos;s nothing here for you to change. An admin finishes the
          rest.
        </p>
      )}
    </section>
  )
}
