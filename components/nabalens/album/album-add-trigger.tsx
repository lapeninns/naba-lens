"use client"

import Link from "next/link"
import { ImagesIcon } from "@phosphor-icons/react"

import {
  useAddContext,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { TabBadge } from "@/components/nabalens/shell/tab-badge"
import { TAB_ITEM } from "@/components/nabalens/shell/tab-item"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * What Album's Add photos opens: the phone's photo picker straight away, no
 * sheet first (DESIGN.md §2, §5 Tab bar, §6.1 step 2). Gallery only: never a
 * camera (§9). The tab, the AppBar button and Album's main button share it,
 * so Match on add (AL-1) changes all three in one place.
 */
// Gallery for many photos, then Match (DESIGN.md §6.1, AL-1). Match picks
// the place from the last one matched in when none is given.
export const ALBUM_ADD_OPTIONS: OpenAddOptions = { match: { place: null } }

export const ALBUM_ADD_LABEL = "Add photos"

/**
 * Add photos in the Album shell: the middle tab on phones, a button in the
 * AppBar from md. Outside the staff layout (previews, tests) it links to Me
 * (/staff/me).
 */
export function AlbumAddTrigger({
  kind,
  label,
}: {
  kind: "tab" | "bar" | "home"
  /**
   * A shorter word on screen ("Add" in the five-tab bar, DESIGN.md §15); the
   * button is still announced as Add photos, which contains it.
   */
  label?: string
}) {
  const add = useAddContext()
  const openAdd = add?.openAdd ?? null
  const busy = add?.busy
  // While Add's queue has unfinished files, say so after the name. Set whole:
  // Chrome inserts a space before an sr-only suffix.
  const busyName = busy
    ? `${ALBUM_ADD_LABEL}, ${busy.words}`
    : label
      ? ALBUM_ADD_LABEL
      : undefined
  const shown = label ?? ALBUM_ADD_LABEL
  const badge = busy ? (
    <span aria-hidden data-slot="add-busy" className="contents">
      <TabBadge
        count={busy.count}
        label="in Add"
        placement={kind === "tab" ? "tab" : "inline"}
        className="bg-ink"
      />
    </span>
  ) : null
  // The tab is v2's round bottle button (`nl-tab--upload`): a 40px bottle
  // disc holding the gallery icon, the label under it in ink. Gallery only,
  // never a camera (D9, D10). 2px padding top and bottom keeps disc, gap and
  // label (2 + 40 + 2 + 18 + 2) inside the 64px bar, so the bar is the
  // --spacing-tabbar the docks and scroll padding clear (review Z8).
  const content =
    kind === "tab" ? (
      <>
        <span
          data-slot="tabbar-disc"
          className="grid size-10 place-items-center rounded-round bg-accent text-on-accent"
        >
          <ImagesIcon aria-hidden className="size-5.5" />
        </span>
        {shown}
        {badge}
      </>
    ) : (
      <>
        <ImagesIcon data-icon="inline-start" aria-hidden />
        {shown}
        {badge}
      </>
    )
  const className =
    kind === "tab"
      ? cn(TAB_ITEM, "py-0.5 text-ink hover:bg-raised")
      : kind === "home"
        ? cn(
            buttonVariants({ variant: "primary", size: "lg" }),
            "min-h-14 w-full"
          )
        : cn(buttonVariants({ variant: "secondary" }), "lg:whitespace-nowrap")
  return openAdd ? (
    <button
      type="button"
      data-slot="album-add"
      className={className}
      aria-label={busyName}
      // Synchronously, inside the click: the host clicks its hidden input.
      onClick={() => openAdd(ALBUM_ADD_OPTIONS)}
    >
      {content}
    </button>
  ) : (
    <Link href="/staff/me" data-slot="album-add" className={className}>
      {content}
    </Link>
  )
}
