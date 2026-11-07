import { logout } from "@/app/_media/actions"
import {
  saveWorkProfileAction,
  skipWorkProfileAction,
} from "@/app/staff/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { WorkProfileForm } from "@/components/nabalens/work-profile-form"
import { requireActiveStaff } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { avatarUrl } from "@/lib/server/media/library"

import { canManageVenue } from "../can-manage"
import { initialWorkValues, safeNext } from "./work-values"

export const metadata = { title: "Work details · Naba-Lens" }

type SearchParams = Record<string, string | string[] | undefined>

/** Self-service work details: main job, extra areas, Save or Skip for now. */
export default async function WorkProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const [params, canManage] = await Promise.all([
    searchParams,
    canManageVenue(auth.actor),
  ])
  const next = safeNext(params.next)
  const { initial, suggestedFrom } = initialWorkValues(profile)
  const venueName = profile.venue?.name ?? null
  const avatar = avatarUrl(profile.id, profile.avatarPath)

  return (
    <AppShell
      variant="staff"
      active="portfolio"
      canManage={canManage}
      userName={profile.displayName}
      avatarUrl={avatar}
      logoutAction={logout}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        <PageHeader
          scope={venueName}
          venueScope={Boolean(venueName)}
          title="Work details"
          summary="Only you and admins see your work details. Your admin still sets your job title, team and venue."
        />
        <WorkProfileForm
          displayName={profile.displayName}
          venueName={venueName}
          avatarUrl={avatar}
          initial={initial}
          suggestedFrom={suggestedFrom}
          next={next}
          onSave={saveWorkProfileAction}
          onSkip={skipWorkProfileAction}
        />
      </div>
    </AppShell>
  )
}
