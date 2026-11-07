import type { WorkProfileValues } from "@/components/nabalens/work-profile-form"
import type { CurrentProfile } from "@/lib/auth/profile"
import { ROUTES } from "@/lib/auth/routes"
import {
  suggestRoleFromJobTitle,
  WORK_ROLE_TITLE_MAX,
} from "@/lib/config/work-roles"

/**
 * `?next=` after Save or Skip: only a path inside the staff area, never another
 * origin (`//host`, `/\host`) or an admin page. Anything else goes to Me.
 */
export function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value
  if (
    typeof next === "string" &&
    /^\/staff(?:[/?#]|$)/.test(next) &&
    !next.includes("//") &&
    !next.includes("\\") &&
    next.length <= 200
  )
    return next
  return ROUTES.staffHome
}

/**
 * The form's starting values: the saved work details, or else a suggestion
 * from the admin-set job title for the person to confirm. An unfamiliar title
 * is kept as an "Other" title.
 */
export function initialWorkValues(
  profile: Pick<CurrentProfile, "jobTitle" | "work">
): { initial: WorkProfileValues; suggestedFrom: string | null } {
  const work = profile.work
  if (work?.roleKey) {
    return {
      initial: {
        roleKey: work.roleKey,
        roleTitle: work.roleTitle ?? "",
        workAreas: work.workAreas,
      },
      suggestedFrom: null,
    }
  }
  const areas = work?.workAreas ?? []
  const jobTitle = profile.jobTitle?.trim() || null
  if (!jobTitle) {
    return {
      initial: { roleKey: null, roleTitle: "", workAreas: areas },
      suggestedFrom: null,
    }
  }
  const suggested = suggestRoleFromJobTitle(jobTitle)
  return {
    initial: suggested
      ? { roleKey: suggested, roleTitle: "", workAreas: areas }
      : {
          roleKey: "other",
          roleTitle: jobTitle.slice(0, WORK_ROLE_TITLE_MAX).trim(),
          workAreas: areas,
        },
    suggestedFrom: jobTitle,
  }
}
