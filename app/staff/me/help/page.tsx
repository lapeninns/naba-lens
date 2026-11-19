import { BookOpenTextIcon, CameraIcon } from "@phosphor-icons/react/dist/ssr"

import { HomeRow } from "@/components/nabalens/album/home-rows"
import { AppShell } from "@/components/nabalens/app-shell"
import { CANT_ADD_HREF, GUIDE_PATH } from "@/components/nabalens/guide"
import { MeAccount } from "@/components/nabalens/me/me-account"
import { MeSubpageHeader } from "@/components/nabalens/me/me-subpage"
import { requireActiveStaff } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { getMyVenueManagers } from "@/lib/server/staff"
import { listMyVenues } from "@/lib/auth/venues"
import { switchVenueAction } from "@/lib/auth/venue-actions"
import type { VenueSwitcherVenue } from "@/components/nabalens/venue-switcher"

import { ownMonth, staffShellStatus } from "../../_shell/shell-status"

export const metadata = { title: "Help" }

/**
 * Help (DESIGN.md §5b, D17): how Naba-Lens works, the photo guide, what to
 * do when adding photos is refused, and who manages the venue.
 */
export default async function StaffMeHelpPage() {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const actor = auth.actor
  const [shell, monthly, managers, venues] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    getMyVenueManagers(actor).catch(() => null),
    listMyVenues(actor.db).catch(() => null),
  ])

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
        <MeSubpageHeader title="Help" />
        <div className="grid gap-2">
          <HomeRow
            href="/staff/tasks/welcome?from=me"
            slot="me-how"
            icon={<BookOpenTextIcon />}
            title="How Naba-Lens works"
            line="What your photos are for and how to add them"
          />
          <HomeRow
            href={GUIDE_PATH}
            slot="me-guide"
            icon={<CameraIcon />}
            title="Photo guide"
            line="How to photograph a dish: the checklist and four angles"
          />
        </div>
        <MeAccount
          title={null}
          parts={["help", "managers"]}
          venues={venues as VenueSwitcherVenue[] | null}
          switchVenue={switchVenueAction}
          managers={managers?.ok ? managers.managers : null}
          unread={null}
          helpHref={CANT_ADD_HREF}
        />
      </div>
    </AppShell>
  )
}
