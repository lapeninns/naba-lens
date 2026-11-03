import { FirstRun, setupGaps } from "@/components/nabalens/tasks"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { getCoverageActor, getMyTasks } from "@/lib/server/coverage"

import { PORTFOLIO_PATH, TASKS_PATH, unwrap } from "../result"

export const metadata = { title: "Welcome · Naba-Lens" }

/** Shown to a new starter, deliberately without the TabBar. */
export default async function WelcomePage() {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const { tasks } = unwrap(await getMyTasks(actor))
  const reason = uploadBlockReason(profile)
  const venueName = profile.venue?.name ?? null

  return (
    <FirstRun
      name={profile.displayName}
      venueName={venueName}
      periodLabel={tasks.period.label}
      target={tasks.monthly?.targetCount ?? null}
      dueLabel={null}
      gaps={setupGaps(tasks)}
      uploadBlocked={
        reason === "venue_inactive"
          ? `${venueName ?? "Your venue"} isn't taking photos yet, so you can't add any. An admin turns the venue on.`
          : reason
            ? "You can't add photos until an admin assigns your venue."
            : null
      }
      hasAvatar={profile.avatarPath !== null}
      photoHref={PORTFOLIO_PATH}
      profileHref={PORTFOLIO_PATH}
      homeHref={TASKS_PATH}
    />
  )
}
