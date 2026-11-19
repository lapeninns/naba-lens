import { permanentRedirect } from "next/navigation"

/**
 * Retired: the old Me (DESIGN.md §5b, D17). Staff land on Today; "Edit
 * profile" lives on Settings. The old URL keeps working as a redirect.
 */
export default async function RetiredStaffRoot({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { edit } = await searchParams
  permanentRedirect(edit === "profile" ? "/staff/me/settings" : "/staff/home")
}
