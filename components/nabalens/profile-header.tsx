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
  return (
    // Side by side only from md: at 640px (a phone landscape, or 1280px at
    // 200% zoom) the name plus up to three actions does not fit on one row.
    <section
      aria-label="Profile"
      className={cn(
        "flex w-full min-w-0 flex-col gap-5 md:flex-row md:items-center md:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <ProfileAvatar
          name={displayName}
          src={avatarUrl}
          className="size-16 text-lg sm:size-20 sm:text-xl"
        />
        <div className="min-w-0">
          <Heading className="text-xl font-semibold tracking-tight break-words sm:text-2xl">
            {displayName}
          </Heading>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[
              jobTitle,
              departmentLabel(department),
              venueName ?? missingVenueLabel,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {workRole ? (
            <p className="mt-0.5 text-sm text-ink">
              <span className="sr-only">Your work: </span>
              {venueName ? `${workRole} at ${venueName}` : workRole}
            </p>
          ) : null}
          {meta ? <div className="mt-1.5">{meta}</div> : null}
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
