import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { ProfileHeader } from "@/components/nabalens/profile-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { getCommunityMember, listCommunityMedia } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../../can-manage"
import { CommunityGallery } from "../../community/community-gallery"

export const metadata = { title: "Colleague portfolio · Naba-Lens" }

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

  return (
    <AppShell
      variant="staff"
      active="people"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-6 sm:gap-8">
        <Link
          href="/staff/people"
          className={buttonVariants({
            variant: "ghost",
            size: "touch",
            className: "w-fit",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden /> All people
        </Link>
        <ProfileHeader
          displayName={member.displayName}
          avatarUrl={member.avatarUrl}
          jobTitle={member.jobTitle}
          department={member.department}
          venueName={member.venueName}
          meta={
            <p className="text-sm text-muted-foreground">
              {member.mediaCount}{" "}
              {member.mediaCount === 1 ? "upload" : "uploads"}
            </p>
          }
        />
        <section
          aria-labelledby="colleague-portfolio-heading"
          className="flex flex-col gap-4"
        >
          <h2
            id="colleague-portfolio-heading"
            className="text-base font-semibold"
          >
            Portfolio
          </h2>
          <CommunityGallery
            initialPage={{ items: media.items, nextCursor: media.nextCursor }}
            search={{}}
            uploaderId={member.id}
          />
        </section>
      </div>
    </AppShell>
  )
}
