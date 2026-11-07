import { MapPinIcon } from "@phosphor-icons/react/dist/ssr"

import { departmentLabel, type Department } from "@/lib/config/departments"
import { cn } from "@/lib/utils"

import { ProfileAvatar } from "./profile-avatar"

type ProfileHeaderProps = {
  displayName: string
  avatarUrl?: string | null
  jobTitle?: string | null
  department?: Department | null
  venueName?: string | null
  /**
   * The person's own description of their work (work details), shown as its
   * own line with the venue. Separate from the admin-set job title and team.
   */
  workRole?: string | null
  /** Shown when the profile has no venue yet (staff cannot upload until set). */
  missingVenueLabel?: string
  /**
   * Actions, secondary first and primary last (e.g. Edit profile, then Upload).
   * On phones the order flips so the primary action sits on top.
   */
  actions?: React.ReactNode
  /** Extra line under the details, e.g. an "Inactive" status for admin. */
  meta?: React.ReactNode
  headingLevel?: "h1" | "h2"
  className?: string
}

/**
 * Common Room profile card: a face, a name, job and team, the venue (pin and
 * bold name), then the actions full width underneath (one blue at most).
 */
export function ProfileHeader({
  displayName,
  avatarUrl,
  jobTitle,
  department,
  venueName,
  workRole = null,
  missingVenueLabel = "No venue assigned",
  actions,
  meta,
  headingLevel = "h1",
  className,
}: ProfileHeaderProps) {
  const Heading = headingLevel
  const role = [jobTitle, departmentLabel(department)].filter(Boolean)
  return (
    <section
      aria-label="Profile"
      className={cn(
        "grid w-full min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <ProfileAvatar name={displayName} src={avatarUrl} size="lg" />
        <div className="grid min-w-0 gap-1">
          <Heading className="font-display text-card-title [overflow-wrap:anywhere] text-ink">
            {displayName}
          </Heading>
          {role.length > 0 ? (
            <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
              {role.join(" · ")}
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-1.5 text-body text-ink-muted">
            <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
            {venueName ? (
              <b className="font-bold [overflow-wrap:anywhere] text-ink">
                {venueName}
              </b>
            ) : (
              <span>{missingVenueLabel}</span>
            )}
          </p>
          {workRole ? (
            <p className="text-body text-ink">
              <span className="sr-only">Your work: </span>
              {venueName ? `${workRole} at ${venueName}` : workRole}
            </p>
          ) : null}
          {meta ? <div className="mt-1">{meta}</div> : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-col-reverse gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end [&>*]:w-full md:[&>*]:w-auto">
          {actions}
        </div>
      ) : null}
    </section>
  )
}
