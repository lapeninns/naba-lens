import type { Metadata } from "next"

import { SearchScreen } from "@/app/staff/manage/_shared/screens"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"

export const metadata: Metadata = {
  title: "Search photos and videos · Naba-Lens",
}

/**
 * B05-06 asset search for admins: every venue's photos and videos by menu
 * item, use, menu decision and upload day. The layout's role gate is not the
 * authorisation boundary; this page checks again.
 */
export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  return (
    <SearchScreen
      mode="admin"
      actor={auth.actor}
      viewerName={profile.displayName}
      search={await searchParams}
    />
  )
}
