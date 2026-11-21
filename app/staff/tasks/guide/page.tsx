import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { AppShell } from "@/components/nabalens/app-shell"
import { Card } from "@/components/nabalens/common-room/card"
import { CantAddHelp, DishGuide } from "@/components/nabalens/guide"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { BackToTasks } from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { GUIDE_RULES, GUIDE_SAFETY } from "@/lib/guide/dish-guide"
import { getCoverageActor } from "@/lib/server/coverage"

import { staffShellStatus } from "../../_shell/shell-status"
import { unwrap } from "../result"

export const metadata = { title: "Photo guide" }

/**
 * How to photograph a dish (screens-2 handoff): the safety notice first, the
 * example dishes and the four angles two-up, the checklist, then "If you
 * can't add photos" as a row. Static examples only; no angle is marked.
 */
export default async function PhotoGuidePage() {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const shell = await staffShellStatus(actor, profile)

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter pb-4">
        <BackToTasks href={STAFF_PHOTO_ROUTES.home} />
        <PageHeader
          title="Photo guide"
          summary="How to photograph a dish so every venue's photos look alike. Four angles, always in this order."
        />

        {/* Safety first, above the angles (screens-2 handoff). */}
        <Notice tone="attention" role="note">
          {GUIDE_SAFETY}
        </Notice>

        <section aria-labelledby="angles-heading" className="grid gap-gutter">
          <h2
            id="angles-heading"
            className="px-1 pt-2 type-section-title text-ink"
          >
            The four angles
          </h2>
          <DishGuide suggested={[]} layout="grid" />
          <p className="max-w-reading px-1 text-body text-ink-muted">
            Examples, not your menu.
          </p>
        </section>

        <Card as="section" aria-labelledby="every-shot-heading">
          <h2 id="every-shot-heading" className="type-section-title text-ink">
            Every shot
          </h2>
          <ul className="grid max-w-reading gap-2.5">
            {GUIDE_RULES.map((rule) => (
              <li
                key={rule}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 text-body text-ink"
              >
                <CheckIcon
                  aria-hidden
                  weight="bold"
                  className="mt-px size-[22px] shrink-0 text-ok-fg"
                />
                {rule}
              </li>
            ))}
          </ul>
        </Card>

        {/* Spec §6 S5, §15.3: permission and file-format help (S2-STAFF),
            folded into a row that opens to it. */}
        <CantAddHelp folded />
      </div>
    </AppShell>
  )
}
