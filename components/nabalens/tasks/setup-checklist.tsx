import Link from "next/link"
import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react/dist/ssr"

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
 * venue and team.
 */
export function SetupChecklist({
  setup,
  profile,
  editProfileHref,
}: {
  setup: CoverageScope["setup"]
  profile: SetupProfile
  /** Where "Edit profile" lives (the portfolio). */
  editProfileHref: string
}) {
  const missing = new Set(setup.missing)
  const hasName = profile.displayName.trim() !== ""
  const editLink = (
    <Link
      href={editProfileHref}
      className="font-medium text-foreground underline underline-offset-3"
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
      todo: <>Add your name in {editLink}.</>,
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
      todo: <>Optional. Add one in {editLink}.</>,
      optional: true,
    },
  ]

  if (setup.complete && hasName) {
    if (profile.hasAvatar) return null
    return (
      <p className="text-meta-touch text-ink-muted md:text-meta">
        Optional: add a profile photo in {editLink}.
      </p>
    )
  }

  return (
    <section
      aria-labelledby="setup-heading"
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="setup-heading" className="text-base font-semibold">
          Your setup isn&apos;t finished
        </h2>
        <StatusChip tone="warning">Needs setup</StatusChip>
      </div>
      <p className="text-body-touch md:text-body-sm">
        You can still add photos to your profile in the meantime.
      </p>
      <ul className="flex flex-col gap-2" aria-label="Profile setup">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start gap-2 text-body-touch md:text-body-sm"
          >
            {step.done ? (
              <CheckCircleIcon
                weight="fill"
                className="mt-0.5 size-4 shrink-0 text-positive"
                aria-hidden
              />
            ) : (
              <CircleIcon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  step.optional ? "text-muted-foreground" : "text-warning"
                )}
                aria-hidden
              />
            )}
            <span className="min-w-0">
              <span className="font-medium">
                {step.label}
                {step.optional ? " (optional)" : null}
              </span>
              <span className="sr-only">
                {step.done ? ": done" : step.optional ? "" : ": missing"}
              </span>
              <span className="block text-muted-foreground">
                {step.done ? (step.value ?? "Added") : step.todo}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
