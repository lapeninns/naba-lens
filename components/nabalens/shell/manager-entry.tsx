"use client"

import { amenityHrefs } from "@/lib/amenities/contract"
import type { EntryMenu } from "@/lib/work-client/entry"

import { managerHrefs } from "../manager/hrefs"
import { useAdd } from "./add-context"
import { EntryFlow, type EntryHrefs } from "./entry-flow"

/**
 * Where the manager workspace's entry choices go: a dish is picked on Menu,
 * a question opens its "Capture myself" page. Manager accounts have no
 * tasks, so a task goes to the overview.
 */
export const MANAGER_ENTRY_HREFS: EntryHrefs = {
  dish: managerHrefs.menu(),
  task: () => managerHrefs.overview,
  question: (checkId) => amenityHrefs(managerHrefs.overview).capture(checkId),
}

/**
 * The shared entry inline, for a manager account on its amenities page
 * (B02 UI design §5.3): the same intents, from the same capabilities read,
 * each question opening the "Capture myself" page and "Just photos" opening
 * the workspace's Add.
 */
export function ManagerEntrySection({ menu }: { menu: EntryMenu }) {
  const openAdd = useAdd()
  // A dish and "Just photos" need the workspace's Add; without it they are
  // left out.
  const shown = openAdd
    ? menu
    : {
        ...menu,
        intents: menu.intents.filter((i) => i !== "photos" && i !== "dish"),
      }
  if (shown.intents.length === 0) return null
  return (
    <section
      aria-labelledby="manager-entry-heading"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <EntryFlow
        menu={shown}
        role="manager"
        hrefs={MANAGER_ENTRY_HREFS}
        onPhotos={openAdd ? () => openAdd() : undefined}
        Title={Heading}
        titleId="manager-entry-heading"
      />
    </section>
  )
}

function Heading(props: React.ComponentProps<"h2">) {
  return (
    <h2
      {...props}
      className="font-display text-section-title text-ink outline-none"
    />
  )
}
