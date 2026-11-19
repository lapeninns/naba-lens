import { AppShell } from "@/components/nabalens/app-shell"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"

import { ownMonth, staffShellStatus } from "../../_shell/shell-status"
import { unwrap } from "../../tasks/result"
import { partBody } from "../_part"

export const metadata = { title: "Menu · Album" }

/** Album's Menu (DESIGN.md §5d "A part", D16). */
export default async function AlbumMenuPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const [query, shell, monthly] = await Promise.all([
    searchParams,
    staffShellStatus(actor, profile),
    ownMonth(actor),
  ])
  const body = await partBody("menu", actor, profile, query)
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      {body}
    </AppShell>
  )
}
