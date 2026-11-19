import {
  BellSimpleIcon,
  CalendarCheckIcon,
  ClipboardTextIcon,
  GearSixIcon,
  ImagesIcon,
  LifebuoyIcon,
  SignOutIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr"

import { HomeRow } from "@/components/nabalens/album/home-rows"
import { UnfinishedRow } from "@/components/nabalens/album/unfinished-row"
import { AppShell } from "@/components/nabalens/app-shell"
import { ProfileHeader } from "@/components/nabalens/profile-header"
import { Button } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { workRoleLabel } from "@/lib/config/work-roles"
import { getMediaActor } from "@/lib/server/media/context"
import { ME_COPY, monthLine } from "@/lib/staff/me"

import {
  myOtherJobsCount,
  myUnreadNotices,
  ownMonth,
  staffShellStatus,
} from "../_shell/shell-status"

export const metadata = { title: "Me" }

/** A group of rows on Me with its heading (DESIGN.md §5b). */
function Group({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-2">
      {title ? (
        <h2 className="px-1 text-label text-ink-muted">{title}</h2>
      ) : null}
      <div className="grid gap-2">{children}</div>
    </section>
  )
}

/**
 * Me (DESIGN.md §5b, D17, D18): the person's account hub. One screen of
 * rows, each opening the page that does that job; their photos are the My
 * photos tab, so nothing here repeats it.
 * Each read that can fail leaves its row out (or says so) rather than
 * failing Me.
 */
export default async function StaffMePage() {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const actor = auth.actor
  const [shell, monthly, unread, otherJobs] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    myUnreadNotices(actor).catch(() => null),
    myOtherJobsCount(actor),
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
        <h1 className="sr-only">{ME_COPY.title}</h1>
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
        />

        <UnfinishedRow />

        <Group>
          <HomeRow
            href="/staff/tasks/month"
            slot="me-month"
            icon={<CalendarCheckIcon />}
            title={ME_COPY.month}
            line={monthLine(monthly)}
          />
          <HomeRow
            href="/staff/notifications"
            slot="me-notices"
            icon={<BellSimpleIcon />}
            title={ME_COPY.notices}
            line={ME_COPY.noticesLine(unread)}
          />
          {shell.canManage ? (
            <HomeRow
              href="/manager"
              slot="me-manage"
              icon={<ClipboardTextIcon />}
              title={ME_COPY.manage(profile.venue?.name ?? null)}
              line={ME_COPY.manageLine(shell.reviewCount ?? null)}
            />
          ) : null}
          {otherJobs === null || otherJobs > 0 ? (
            <HomeRow
              href="/staff/tasks/other"
              slot="me-other-jobs"
              icon={<ClipboardTextIcon />}
              title={ME_COPY.otherJobs}
              line={ME_COPY.otherJobsLine(otherJobs)}
            />
          ) : null}
        </Group>

        <Group title={ME_COPY.venueGroup}>
          <HomeRow
            href="/staff/community"
            slot="me-community"
            icon={<ImagesIcon />}
            title={ME_COPY.colleaguesPhotos}
            line={ME_COPY.colleaguesPhotosLine}
          />
          <HomeRow
            href="/staff/people"
            slot="me-people"
            icon={<UsersIcon />}
            title={ME_COPY.people}
            line={ME_COPY.peopleLine}
          />
        </Group>

        <Group title={ME_COPY.youGroup}>
          <HomeRow
            href="/staff/me/settings"
            slot="me-settings"
            icon={<GearSixIcon />}
            title={ME_COPY.settings}
            line={ME_COPY.settingsLine}
          />
          <HomeRow
            href="/staff/me/help"
            slot="me-help"
            icon={<LifebuoyIcon />}
            title={ME_COPY.help}
            line={ME_COPY.helpLine}
          />
        </Group>

        {/* From md, Log out is in the AppBar; on phones it lives on Me. A
            plain POST, so it still signs out after the session has ended. */}
        <form
          action="/auth/logout"
          method="post"
          className="md:hidden"
          data-logout
        >
          <Button type="submit" variant="quiet" className="min-h-12">
            <SignOutIcon data-icon="inline-start" aria-hidden />
            {ME_COPY.logOut}
          </Button>
        </form>
      </div>
    </AppShell>
  )
}
