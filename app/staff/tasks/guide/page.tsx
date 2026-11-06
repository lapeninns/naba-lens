import { CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { DishGuide } from "@/components/nabalens/guide"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { BackToTasks } from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { GUIDE_RULES, GUIDE_SAFETY } from "@/lib/guide/dish-guide"
import { getCoverageActor, getCoverageScope } from "@/lib/server/coverage"
import { avatarUrl } from "@/lib/server/media/library"

import { TASKS_PATH, unwrap } from "../result"

export const metadata = { title: "Photo guide · Naba-Lens" }

/**
 * How to photograph a dish: the checklist and the four example angles, with
 * no angle marked. Static examples only; linked from food menu-section tasks
 * and Monthly photos.
 */
export default async function PhotoGuidePage() {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const { scope } = unwrap(await getCoverageScope(actor))

  return (
    <AppShell
      variant="staff"
      active="tasks"
      canManage={scope.canManageVenue}
      userName={profile.displayName}
      avatarUrl={avatarUrl(profile.id, profile.avatarPath)}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-6 pb-4">
        <BackToTasks href={TASKS_PATH} />
        <PageHeader
          title="Photo guide"
          summary="How to photograph a dish so every venue's photos look alike. Four angles, always in this order."
        />

        <section aria-labelledby="every-shot-heading" className="grid gap-3">
          <h2
            id="every-shot-heading"
            className="text-section-title-touch md:text-section-title"
          >
            Every shot
          </h2>
          <ul className="grid max-w-(--size-reading) gap-2">
            {GUIDE_RULES.map((rule) => (
              <li
                key={rule}
                className="flex gap-2.5 text-body-touch text-ink md:text-body"
              >
                <CheckIcon
                  aria-hidden
                  weight="bold"
                  className="mt-1 size-4 shrink-0 text-positive"
                />
                {rule}
              </li>
            ))}
          </ul>
        </section>

        <Notice tone="attention" role="note">
          {GUIDE_SAFETY}
        </Notice>

        <section aria-labelledby="angles-heading" className="grid gap-4">
          <h2
            id="angles-heading"
            className="text-section-title-touch md:text-section-title"
          >
            The four angles
          </h2>
          <DishGuide suggested={[]} />
          <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body-sm">
            Examples, not your menu.
          </p>
        </section>
      </div>
    </AppShell>
  )
}
