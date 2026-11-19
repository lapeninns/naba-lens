import { permanentRedirect } from "next/navigation"

/**
 * Retired: a place is Album's place lens now (DESIGN.md §5d "Place is a
 * lens"). The old URL keeps working as a redirect.
 */
export default async function RetiredPlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>
}) {
  const { placeId } = await params
  permanentRedirect(`/staff/album?place=${encodeURIComponent(placeId)}`)
}
