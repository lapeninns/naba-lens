import { CaretRightIcon, MapPinIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import type { CommunityMember } from "@/lib/server/community"

import { photoCount, TEAM_TAG } from "./people"

/** The team as a short word after the job title ("Sous chef · BOH"). */
export function TeamTag({
  department,
}: {
  department: CommunityMember["department"]
}) {
  return department ? <span>{TEAM_TAG[department]}</span> : null
}

/** "Sous chef · BOH": job title and team, whichever are set. */
export function RoleLine({
  member,
}: {
  member: Pick<CommunityMember, "jobTitle" | "department">
}) {
  if (!member.jobTitle && !member.department) return null
  return (
    <>
      {member.jobTitle}
      {member.jobTitle && member.department ? (
        <span aria-hidden className="text-ink-subtle">
          {" · "}
        </span>
      ) : null}
      <TeamTag department={member.department} />
    </>
  )
}

/**
 * One person in the directory (Common Room row): face, name, job and team,
 * then where they work and how many photos they've shared. A row inside the
 * directory's one white card; the whole row is the link.
 */
export function PersonCard({ member }: { member: CommunityMember }) {
  return (
    <Link
      href={`/staff/people/${member.id}`}
      className="grid min-h-16 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-surface p-3 text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"
    >
      <ProfileAvatar name={member.displayName} src={member.avatarUrl} />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-item-title [overflow-wrap:anywhere]">
          {member.displayName}
        </span>
        {member.jobTitle || member.department ? (
          <span className="text-body [overflow-wrap:anywhere] text-ink-muted">
            <RoleLine member={member} />
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-1.5 text-body text-ink-muted">
          <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
          <span className="[overflow-wrap:anywhere]">
            {member.venueName ?? "No venue assigned"}
          </span>
          <span aria-hidden className="text-ink-subtle">
            ·
          </span>
          <span className="font-mono tabular-nums">
            {photoCount(member.mediaCount)}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1 text-meta-strong text-ink-muted">
        <span className="max-sm:sr-only">View profile</span>
        <CaretRightIcon aria-hidden weight="bold" className="size-5" />
      </span>
    </Link>
  )
}
