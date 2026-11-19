import { permanentRedirect } from "next/navigation"

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * Retired: Our menu is Album's Menu (DESIGN.md §5d, D16). The old URL keeps
 * working as a redirect, and keeps its section and its gaps filter.
 */
export default async function RetiredMenuPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const next = new URLSearchParams()
  const section = first(query.section)
  if (section) next.set("section", section)
  if (first(query.filter) === "gaps") next.set("show", "needed")
  const rest = next.toString()
  permanentRedirect(`/staff/album/menu${rest ? `?${rest}` : ""}`)
}
