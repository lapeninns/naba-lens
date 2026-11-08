import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"

import { staffShellStatus } from "../../../_shell/shell-status"
import { TASKS_PATH, unwrap } from "../../result"
import { CaptureScreen } from "../_capture/screen"

export const metadata = { title: "Amenity check · Naba-Lens" }

// finaliseUpload (Server Action used by the upload flow on this page) decodes
// HEIC/images; same bound as the task page.
export const maxDuration = 120

/** Staff: capture one amenity check assigned to me, then back to Home. */
export default async function AmenityCapturePage({
  params,
}: {
  params: Promise<{ checkId: string }>
}) {
  const profile = await requireActiveStaff()
  const { checkId } = await params
  const { actor } = unwrap(await getCoverageActor())
  // CaptureScreen is an async server component without hooks. Calling it here
  // starts the check's reads alongside the shell's instead of after them.
  const [shell, screen] = await Promise.all([
    staffShellStatus(actor, profile),
    CaptureScreen({
      actor,
      checkId,
      mode: "staff",
      venueName: profile.venue?.name ?? null,
      backHref: TASKS_PATH,
      backLabel: "Home",
      doneHref: TASKS_PATH,
    }),
  ])
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
      logoutAction={logout}
    >
      {screen}
    </AppShell>
  )
}
