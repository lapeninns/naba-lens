import { notFound } from "next/navigation"
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { SectionHeader } from "@/components/nabalens/common-room"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { requireActiveStaff } from "@/lib/auth"
import { getCommunityMember, listCommunityMedia } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../../can-manage"
import { CommunityGallery } from "../../community/community-gallery"
import { firstName, movedNotice, photoCount, PROFILE_COPY } from "../people"
import { RoleLine } from "../person-card"

export const metadata = { title: "Profile · Naba-Lens" }

export default async function ColleaguePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error(auth.message)
  const { id } = await params
  const [person, canManage] = await Promise.all([
    getCommunityMember(auth.actor, id),
    canManageVenue(auth.actor),
  ])
  if (!person.ok) {
    if (person.status === 404 || person.status === 400) notFound()
    throw new Error(person.message)
  }
  const media = await listCommunityMedia(auth.actor, {
    uploaderId: person.member.id,
  })
  if (!media.ok) throw new Error(media.message)
  const member = person.member
  const moved = movedNotice(member, media.items)

  return (
    <AppShell
      variant="staff"
      active="people"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
        <OfflineNotice />
        {/* Common Room profile card: a face, a name, where they work and
            how many photos they've shared. No likes or rankings. */}
        <div className="flex min-w-0 items-center gap-4 rounded-card bg-surface p-4 shadow-card">
          <ProfileAvatar
            name={member.displayName}
            src={member.avatarUrl}
            size="lg"
          />
          <PageHeader
            scope={[...PROFILE_COPY.scope]}
            title={member.displayName}
            summary={
              <div className="grid gap-1">
                {member.jobTitle || member.department ? (
                  <p className="[overflow-wrap:anywhere]">
                    <RoleLine member={member} />
                  </p>
                ) : null}
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <MapPinIcon aria-hidden className="size-[18px] shrink-0" />
                  <b className="font-bold [overflow-wrap:anywhere] text-ink">
                    {member.venueName ?? "No venue assigned"}
                  </b>
                </p>
                <p className="font-mono tabular-nums">
                  {photoCount(member.mediaCount)}
                </p>
              </div>
            }
            className="min-w-0 flex-1 px-0 pb-0 md:pb-0"
          />
        </div>
        {moved ? (
          <Notice tone="info" role="none">
            {moved}
          </Notice>
        ) : null}
        <section
          aria-labelledby="shared-photos-heading"
          className="flex flex-col gap-(--gutter)"
        >
          <SectionHeader
            id="shared-photos-heading"
            title={PROFILE_COPY.shared}
            action={
              <span className="text-meta text-ink-muted">
                {PROFILE_COPY.order}
              </span>
            }
          />
          <CommunityGallery
            initialPage={{ items: media.items, nextCursor: media.nextCursor }}
            search={{}}
            uploaderId={member.id}
            empty={
              <EmptyState
                title={`${firstName(member.displayName)} hasn't shared any photos yet.`}
                description={PROFILE_COPY.emptyBody}
              />
            }
          />
        </section>
      </div>
    </AppShell>
  )
}
