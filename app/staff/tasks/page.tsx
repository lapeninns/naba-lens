import { permanentRedirect } from "next/navigation"

import { FINDING_SENT_PARAM } from "@/components/nabalens/amenities/capture/finding-sent"

/**
 * Retired: the old Album home (DESIGN.md §5d, D16). A place goes to Album's
 * place lens; an amenity answer's confirmation (`?finding_sent=`) goes to
 * Today, which shows it. The old URL keeps working as a redirect.
 */
export default async function RetiredTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v
  const sent = one(params[FINDING_SENT_PARAM])
  if (sent)
    permanentRedirect(
      `/staff/home?${FINDING_SENT_PARAM}=${encodeURIComponent(sent)}`
    )
  const place = one(params.place)
  permanentRedirect(
    place ? `/staff/album?place=${encodeURIComponent(place)}` : "/staff/album"
  )
}
