import { BriefcaseIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { HomeRow } from "@/components/nabalens/album/home-rows"
import { AppShell } from "@/components/nabalens/app-shell"
import { MeAccount } from "@/components/nabalens/me/me-account"
import { MeSubpageHeader } from "@/components/nabalens/me/me-subpage"
import { ProfileHeader } from "@/components/nabalens/profile-header"
import { ThemeSetting } from "@/components/nabalens/theme-setting"
import type { VenueSwitcherVenue } from "@/components/nabalens/venue-switcher"
import { Button } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { switchVenueAction } from "@/lib/auth/venue-actions"
import { listMyVenues } from "@/lib/auth/venues"
import { workRoleLabel } from "@/lib/config/work-roles"
import { CANT_ADD_HREF } from "@/components/nabalens/guide"
import { getMediaActor } from "@/lib/server/media/context"

import { ownMonth, staffShellStatus } from "../../_shell/shell-status"
import { EditProfile } from "./edit-profile"

export const metadata = { title: "Settings" }

/**
 * Settings (DESIGN.md §5b, D17): profile, work details, venues, add to home
 * screen, appearance and Log out.
 */
export default async function StaffMeSettingsPage() {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const actor = auth.actor
  const [shell, monthly, venues] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    listMyVenues(actor.db).catch(() => null),
  ])
  const work = profile.work ?? null

  return (
    <AppShell
      variant="staff"
      active="portfolio"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      <div className="mx-auto grid w-full max-w-feed gap-5 pb-4">
        <MeSubpageHeader title="Settings" />
        <ProfileHeader
          headingLevel="h2"
          displayName={profile.displayName}
          avatarUrl={shell.avatarUrl}
          jobTitle={profile.jobTitle}
          department={profile.department}
          venueName={profile.venue?.name ?? null}
          workRole={
            work?.roleKey ? workRoleLabel(work.roleKey, work.roleTitle) : null
          }
          actions={
            <EditProfile
              displayName={profile.displayName}
              avatarUrl={shell.avatarUrl ?? null}
            />
          }
        />
        <HomeRow
          href="/staff/profile?next=/staff/me/settings"
          slot="me-work"
          icon={<BriefcaseIcon />}
          title="Work details"
          line="Your main job and the areas you work in"
        />
        <MeAccount
          title={null}
          parts={["venues", "install"]}
          venues={venues as VenueSwitcherVenue[] | null}
          switchVenue={switchVenueAction}
          managers={null}
          unread={null}
          helpHref={CANT_ADD_HREF}
        />
        <ThemeSetting />
        <form action="/auth/logout" method="post" data-logout>
          <Button type="submit" variant="quiet" className="min-h-12">
            <SignOutIcon data-icon="inline-start" aria-hidden />
            Log out
          </Button>
        </form>
      </div>
    </AppShell>
  )
}
