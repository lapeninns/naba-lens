import Link from "next/link"
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr"

import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { StatusChip } from "@/components/nabalens/status-chip"
import type { CommunityMember } from "@/lib/server/community"

import { photoCount, TEAM_TAG } from "./people"

export function TeamTag({
  department,
}: {
  department: CommunityMember["department"]
}) {
  return department ? (
    <StatusChip tone="neutral">{TEAM_TAG[department]}</StatusChip>
  ) : null
}

export function PersonCard({ member }: { member: CommunityMember }) {
  return (
    <Link
      href={`/staff/people/${member.id}`}
      className="flex h-full flex-col gap-3 rounded-panel border border-line bg-paper p-4 text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      <span className="flex min-w-0 items-center gap-3">
        <ProfileAvatar name={member.displayName} src={member.avatarUrl} />
        <span className="grid min-w-0">
          <span className="text-item-title-touch break-words md:text-item-title">
            {member.displayName}
          </span>
          {member.jobTitle ? (
            <span className="text-meta-touch text-ink-muted md:text-meta">
              {member.jobTitle}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-meta-touch text-ink-muted md:text-meta">
        <StorefrontIcon aria-hidden className="size-4 shrink-0" />
        {member.venueName ?? "No venue assigned"}
        <TeamTag department={member.department} />
      </span>
      <span className="mt-auto flex items-center justify-between gap-3 text-meta-touch md:text-meta">
        <span className="text-ink-muted tabular-nums">
          {photoCount(member.mediaCount)}
        </span>
        <span className="font-semibold">View profile</span>
      </span>
    </Link>
  )
}
