import { setWelcomeDismissedAction } from "@/app/staff/actions"
import { FirstRun, setupGaps } from "@/components/nabalens/tasks"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { isDepartment } from "@/lib/config/departments"
import { workRoleLabel } from "@/lib/config/work-roles"
import { getCoverageActor, getMyMonth } from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"

import { PORTFOLIO_PATH, TASKS_PATH, WELCOME_PATH, unwrap } from "../result"

export const metadata = { title: "Welcome" }

type SearchParams = Record<string, string | string[] | undefined>

/**
 * The welcome guide, deliberately without the TabBar. Home offers it to new
 * starters; anyone can reopen it from Me (`?from=me` links back there).
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  // Your month, read the way the month screen reads it (v0.5 rule 23: the
  // month has no due date). One row per venue; the welcome shows this venue's.
  const [{ month }, params] = await Promise.all([
    getMyMonth(actor, { period: periodKeyOf(new Date()) }).then(unwrap),
    searchParams,
  ])
  const fromMe = params.from === "me"
  const reason = uploadBlockReason(profile)
  const venueName = profile.venue?.name ?? null
  const monthly =
    month.monthly.find((m) => m.venue.id === profile.venueId) ?? null
  const target = monthly?.targetCount ?? null
  const here = fromMe ? `${WELCOME_PATH}?from=me` : WELCOME_PATH

  return (
    <FirstRun
      name={profile.displayName}
      venueName={venueName}
      periodLabel={month.period.label}
      monthly={
        monthly && target
          ? {
              target,
              accepted: monthly.accepted,
              completionProgress: monthly.completionProgress,
            }
          : null
      }
      gaps={setupGaps({
        missing: [
          ...(profile.venueId ? [] : (["venue"] as const)),
          ...(isDepartment(profile.department) ? [] : (["team"] as const)),
        ],
        monthly,
      })}
      uploadBlocked={
        reason === "venue_inactive"
          ? `${venueName ?? "Your venue"} isn't taking photos yet, so you can't add any. An admin turns the venue on.`
          : reason
            ? "You can't add photos until an admin assigns your venue."
            : null
      }
      hasAvatar={profile.avatarPath !== null}
      workRole={
        profile.work?.roleKey
          ? workRoleLabel(profile.work.roleKey, profile.work.roleTitle)
          : null
      }
      photoHref={PORTFOLIO_PATH}
      profileHref={`${PORTFOLIO_PATH}?edit=profile`}
      workProfileHref={`/staff/profile?next=${encodeURIComponent(here)}`}
      homeHref={TASKS_PATH}
      back={fromMe ? { href: PORTFOLIO_PATH, label: "Back to Me" } : null}
      dismiss={setWelcomeDismissedAction}
    />
  )
}
