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
  const shell = await staffShellStatus(actor, profile)
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <CaptureScreen
        actor={actor}
        checkId={checkId}
        mode="staff"
        venueName={profile.venue?.name ?? null}
        backHref={TASKS_PATH}
        backLabel="Home"
        doneHref={TASKS_PATH}
      />
    </AppShell>
  )
}
