import { notFound } from "next/navigation"
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { requireActiveStaff } from "@/lib/auth"
import { getCommunityMember, listCommunityMedia } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../../can-manage"
import { CommunityGallery } from "../../community/community-gallery"
import { firstName, movedNotice, photoCount, PROFILE_COPY } from "../people"
import { TeamTag } from "../person-card"

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
      <div className="flex flex-col gap-4">
        <OfflineNotice />
        <div className="flex min-w-0 items-center gap-4">
          <ProfileAvatar
            name={member.displayName}
            src={member.avatarUrl}
            size="lg"
          />
          <PageHeader
            scope={[...PROFILE_COPY.scope]}
            title={member.displayName}
            summary={
              <div className="grid gap-0.5 text-meta-touch md:text-meta">
                {member.jobTitle || member.department ? (
                  <p className="flex flex-wrap items-center gap-1.5">
                    {member.jobTitle}
                    <TeamTag department={member.department} />
                  </p>
                ) : null}
                <p className="flex flex-wrap items-center gap-1.5">
                  <StorefrontIcon aria-hidden className="size-4 shrink-0" />
                  {member.venueName ?? "No venue assigned"}
                  <span aria-hidden className="text-ink-subtle">
                    ·
                  </span>
                  <span className="tabular-nums">
                    {photoCount(member.mediaCount)}
                  </span>
                </p>
              </div>
            }
            className="min-w-0 flex-1 pb-0 md:pb-0"
          />
        </div>
        {moved ? (
          <p className="text-body-touch text-ink-muted md:text-body-sm">
            {moved}
          </p>
        ) : null}
        <section
          aria-labelledby="shared-photos-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id="shared-photos-heading"
              className="text-section-title-touch text-ink md:text-section-title"
            >
              {PROFILE_COPY.shared}
            </h2>
            <span className="text-meta-touch text-ink-muted md:text-meta">
              {PROFILE_COPY.order}
            </span>
          </div>
          <CommunityGallery
            initialPage={{ items: media.items, nextCursor: media.nextCursor }}
            search={{}}
            uploaderId={member.id}
            empty={
              <EmptyState
                variant="done"
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
