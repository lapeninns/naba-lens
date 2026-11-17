"use client"

import {
  SLOT_BRIEF_COPY,
  SlotBriefField,
} from "@/components/nabalens/album/slot-brief-field"
import { BRIEF_MAX } from "@/lib/album/model"

/*
 * Album AL-4 (DESIGN.md §5 Brief): one dish's own brief, on the manager's
 * menu item page. A dish uses its own brief, else its section's; this says
 * which one staff see now.
 */

export type DishBriefAction = (input: {
  source: "menu_item"
  key: string
  brief: string | null
}) => Promise<
  { ok: true; brief: string | null } | { ok: false; message: string }
>

export const DISH_BRIEF_COPY = {
  title: "Brief",
  hint: (section: string, sectionBrief: string | null) =>
    sectionBrief
      ? `One line on what this dish's photo must show, up to ${BRIEF_MAX} characters. Without one, staff see the ${section} brief: "${sectionBrief}"`
      : `One line on what this dish's photo must show, up to ${BRIEF_MAX} characters. ${section} has no brief yet; set one under Album places.`,
} as const

export function DishBrief({
  itemId,
  name,
  brief,
  section,
  setAction,
}: {
  itemId: string
  name: string
  /** The dish's own brief. */
  brief: string | null
  /** Its section, with the brief a dish without its own falls back to. */
  section: { name: string; brief: string | null }
  setAction: DishBriefAction
}) {
  return (
    <section aria-labelledby="item-brief" className="grid gap-3">
      <h2 id="item-brief" className="px-1 type-section-title text-ink">
        {DISH_BRIEF_COPY.title}
      </h2>
      <div className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4">
        <SlotBriefField
          name={name}
          brief={brief}
          label={SLOT_BRIEF_COPY.labelFor(name)}
          hint={DISH_BRIEF_COPY.hint(section.name, section.brief)}
          onSave={(next) =>
            setAction({ source: "menu_item", key: itemId, brief: next })
          }
        />
      </div>
    </section>
  )
}
