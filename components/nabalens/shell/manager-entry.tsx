"use client"

import { amenityHrefs } from "@/lib/amenities/contract"
import type { EntryMenu } from "@/lib/work-client/entry"

import { EntryFlow } from "./entry-flow"

/**
 * The shared entry inline, for a manager account on its amenities page
 * (B02 UI design §5.3): the same intents, from the same capabilities read,
 * each question opening the "Capture myself" page.
 */
export function ManagerEntrySection({
  menu,
  basePath,
}: {
  menu: EntryMenu
  /** The workspace's manage base path (amenityHrefs). */
  basePath: string
}) {
  const hrefs = amenityHrefs(basePath)
  return (
    <section
      aria-labelledby="manager-entry-heading"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <EntryFlow
        menu={menu}
        role="manager"
        hrefs={{
          dish: basePath,
          task: () => basePath,
          question: (checkId) => hrefs.capture(checkId),
        }}
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
