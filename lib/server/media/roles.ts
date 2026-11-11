import type { AppRole } from "@/lib/auth/routes"

/**
 * Roles that upload, label and read their own uploads: staff, and manager
 * accounts at their managed venue (B02-c). The database checks the venue and,
 * for a manager account, that the upload is its own manager-era one.
 */
export const UPLOADER_ROLES = [
  "staff",
  "manager",
] as const satisfies readonly AppRole[]

/** Own-media reads: uploaders, plus admins (who read every ready asset). */
export const OWN_MEDIA_ROLES = [
  "staff",
  "manager",
  "admin",
] as const satisfies readonly AppRole[]
