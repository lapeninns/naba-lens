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
export const ALBUM_ADD_OPTIONS: OpenAddOptions = {
  source: "library",
  imagesOnly: true,
}

export const ALBUM_ADD_LABEL = "Add photos"

/**
 * Add photos in the Album shell: the middle tab on phones, a button in the
 * AppBar from md. Outside the staff layout (previews, tests) it links to Me.
 */
export function AlbumAddTrigger({ kind }: { kind: "tab" | "bar" }) {
  const add = useAddContext()
  const openAdd = add?.openAdd ?? null
  const busy = add?.busy
  // While Add's queue has unfinished files, say so after the name. Set whole:
  // Chrome inserts a space before an sr-only suffix.
  const busyName = busy ? `${ALBUM_ADD_LABEL}, ${busy.words}` : undefined
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
  const content =
    kind === "tab" ? (
      <>
        <ImagesIcon aria-hidden className="size-[26px]" />
        {ALBUM_ADD_LABEL}
        {badge}
      </>
    ) : (
      <>
        <ImagesIcon data-icon="inline-start" aria-hidden />
        {ALBUM_ADD_LABEL}
        {badge}
      </>
    )
  const className =
    kind === "tab"
      ? cn(TAB_ITEM, "text-ink-muted hover:bg-surface-2 hover:text-ink")
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
    <Link href="/staff" data-slot="album-add" className={className}>
      {content}
    </Link>
  )
}
