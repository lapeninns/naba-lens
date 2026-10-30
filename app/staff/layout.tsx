import { requireActiveStaff } from "@/lib/auth"

/**
 * Early role gate for /staff: a real 307 for admins, inactive and profile-less
 * accounts before loading.tsx streams. Not the authorisation boundary (layouts
 * do not re-render on client navigation); the page and every Server Function
 * still call lib/auth.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireActiveStaff()
  return children
}
