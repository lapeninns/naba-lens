import { AppShell } from "@/components/nabalens/app-shell"
import { FROM_BACK_LABEL } from "@/components/nabalens/shell/entry-copy"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import { ENTRY_FROM_PARAM, fromHref } from "@/lib/work-client/entry"

import { staffShellStatus } from "../../../_shell/shell-status"
import { TASKS_PATH, unwrap } from "../../result"
import { CaptureScreen } from "../_capture/screen"

export const metadata = { title: "Amenity check · Naba-Lens" }

const NO_SEARCH: Record<string, string | string[] | undefined> = {}

// finaliseUpload (Server Action used by the upload flow on this page) decodes
// HEIC/images; same bound as the task page.
export const maxDuration = 120

/**
 * Staff: capture one amenity check, then back to Home (which names the check
 * sent), or to the allow-listed page in `?from=` (B02-02 §4.3).
 */
export default async function AmenityCapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ checkId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveStaff()
  const [{ checkId }, search] = await Promise.all([
    params,
    searchParams ?? NO_SEARCH,
  ])
  const from = search[ENTRY_FROM_PARAM]
  const origin = fromHref(typeof from === "string" ? from : null)
  // Home keeps its sent notice; any other origin is simply returned to.
  const back =
    origin && origin.origin !== "home"
      ? { href: origin.href, label: FROM_BACK_LABEL[origin.origin] }
      : null
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
      backHref: back?.href ?? TASKS_PATH,
      backLabel: back?.label ?? "Home",
      doneHref: back?.href ?? TASKS_PATH,
      announceSent: !back,
    }),
  ])
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      {screen}
    </AppShell>
  )
}
