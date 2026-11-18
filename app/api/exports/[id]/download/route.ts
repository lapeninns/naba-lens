import { startPackageDownload } from "@/lib/server/exports/download"
import { packageHref } from "@/lib/server/exports/hrefs"
import { getMediaActor } from "@/lib/server/media/context"
import { PRIVATE_HEADERS } from "@/lib/server/media/access"

// Building a package reads each file from storage and resizes it; bound the
// request well inside the platform limit (S1-EXPORT, §14.1).
export const maxDuration = 300

/**
 * Download one export package as a ZIP (S1-EXPORT; spec §14.1, AC31, AC32).
 * The database rechecks the caller and every item first; staff and anyone
 * else without access get the same answer as an unknown package. A package
 * with a withdrawn item is invalidated and the browser is sent back to the
 * package page, which explains it and offers Rebuild. The ZIP itself is
 * streamed, and its completion is the Exported record.
 *
 * `?from=manager` returns a manager to /manager/exports; otherwise /admin.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const area =
    new URL(request.url).searchParams.get("from") === "manager"
      ? "manager"
      : "admin"
  const back = (outcome: string) =>
    new Response(null, {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        location: `${packageHref(area, id)}?download=${outcome}`,
      },
    })

  const auth = await getMediaActor(["staff", "manager", "admin"])
  if (!auth.ok) {
    if (auth.status === 401) return back("signed_out")
    if (auth.status === 503) return back("unavailable")
    return back("not_found")
  }
  const outcome = await startPackageDownload(auth.actor, id)
  if (outcome.ok) return outcome.response
  if (outcome.code === "export_package_invalidated") return back("invalidated")
  if (outcome.code === "export_too_large") return back("too_large")
  if (outcome.status === 404 || outcome.status === 403)
    return back("not_found")
  return back("unavailable")
}
