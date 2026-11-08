import {
  saveWorkProfileAction,
  skipWorkProfileAction,
} from "@/app/staff/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { WorkProfileForm } from "@/components/nabalens/work-profile-form"
import { requireActiveStaff } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"

import { staffShellStatus } from "../_shell/shell-status"
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
  const [params, shell] = await Promise.all([
    searchParams,
    staffShellStatus(auth.actor, profile),
  ])
  const next = safeNext(params.next)
  const { initial, suggestedFrom } = initialWorkValues(profile)
  const venueName = profile.venue?.name ?? null
  const avatar = shell.avatarUrl

  return (
    <AppShell
      variant="staff"
      active="portfolio"
      {...shell}
      userName={profile.displayName}
    >
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
        <PageHeader
          scope={venueName}
          venueScope={Boolean(venueName)}
          title="Work details"
          className="pb-0 md:pb-0"
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
