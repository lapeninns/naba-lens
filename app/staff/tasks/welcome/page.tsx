import { setWelcomeDismissedAction } from "@/app/staff/actions"
import { FirstRun, setupGaps } from "@/components/nabalens/tasks"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { workRoleLabel } from "@/lib/config/work-roles"
import { getCoverageActor, getMyTasks } from "@/lib/server/coverage"

import { PORTFOLIO_PATH, TASKS_PATH, WELCOME_PATH, unwrap } from "../result"

export const metadata = { title: "Welcome · Naba-Lens" }

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
  const [{ tasks }, params] = await Promise.all([
    getMyTasks(actor).then(unwrap),
    searchParams,
  ])
  const fromMe = params.from === "me"
  const reason = uploadBlockReason(profile)
  const venueName = profile.venue?.name ?? null
  const target = tasks.monthly?.targetCount ?? null
  const here = fromMe ? `${WELCOME_PATH}?from=me` : WELCOME_PATH

  return (
    <FirstRun
      name={profile.displayName}
      venueName={venueName}
      periodLabel={tasks.period.label}
      monthly={
        tasks.monthly && target
          ? {
              target,
              accepted: tasks.monthly.accepted,
              dueLabel: tasks.monthly.due?.label ?? null,
            }
          : null
      }
      gaps={setupGaps(tasks)}
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
