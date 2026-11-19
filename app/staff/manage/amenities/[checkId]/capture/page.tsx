import { permanentRedirect } from "next/navigation"

/**
 * Retired (decision D3; DESIGN.md §15): venue managers work in /manager.
 * The old URL keeps working as a redirect.
 */
export default async function RetiredManagePage({
  params,
}: {
  params: Promise<{ checkId: string }>
}) {
  const { checkId } = await params
  permanentRedirect(`/manager/amenities/${encodeURIComponent(checkId)}/capture`)
}
