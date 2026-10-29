import { cn } from "@/lib/utils"

import { ProfileAvatar } from "./profile-avatar"

type ProfileHeaderProps = {
  displayName: string
  avatarUrl?: string | null
  jobTitle?: string | null
  venueName?: string | null
  /** Shown when the profile has no venue yet (staff cannot upload until set). */
  missingVenueLabel?: string
  /** Primary and secondary actions, e.g. Upload and Edit profile. */
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
  venueName,
  missingVenueLabel = "No venue assigned",
  actions,
  meta,
  headingLevel = "h1",
  className,
}: ProfileHeaderProps) {
  const Heading = headingLevel
  return (
    <section
      aria-label="Profile"
      className={cn(
        "flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between",
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
          <Heading className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {displayName}
          </Heading>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[jobTitle, venueName ?? missingVenueLabel]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {meta ? <div className="mt-1.5">{meta}</div> : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
          {actions}
        </div>
      ) : null}
    </section>
  )
}
