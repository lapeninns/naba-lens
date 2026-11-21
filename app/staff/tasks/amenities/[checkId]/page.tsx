import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"
import { AppShell } from "@/components/nabalens/app-shell"
import { FROM_BACK_LABEL } from "@/components/nabalens/shell/entry-copy"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import { ENTRY_FROM_PARAM, fromHref } from "@/lib/work-client/entry"

import { staffShellStatus } from "../../../_shell/shell-status"
import { unwrap } from "../../result"
import { CaptureScreen } from "../_capture/screen"

export const metadata = { title: "Amenity check" }

const AMENITIES_HREF = "/staff/album/amenities"

const NO_SEARCH: Record<string, string | string[] | undefined> = {}

// finaliseUpload (Server Action used by the upload flow on this page) decodes
// HEIC/images; same bound as the task page.
export const maxDuration = 120

/**
 * Staff: capture one amenity check, then on to Today (which names the check
 * sent), or to the allow-listed page in `?from=` (B02-02 §4.3). The back link
 * goes to Album's Amenities, where the questions are listed (screens-2
 * handoff), or to Today when the page was opened from there.
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
  const backLink = back
    ? back
    : origin?.origin === "home"
      ? { href: STAFF_PHOTO_ROUTES.home, label: "Today" }
      : { href: AMENITIES_HREF, label: "Amenities" }
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
      backHref: backLink.href,
      backLabel: backLink.label,
      doneHref: back?.href ?? STAFF_PHOTO_ROUTES.home,
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
