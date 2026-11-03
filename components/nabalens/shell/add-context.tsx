"use client"

import * as React from "react"
import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type AddContextValue = {
  openAdd: () => void
  /** Files in the Add queue that are not finished, in the queue's words. */
  busy?: { count: number; words: string } | null
}

const AddContext = React.createContext<AddContextValue | null>(null)

/** Provided by the staff layout, which hosts the Add sheet and upload flow. */
export const AddProvider = AddContext.Provider

/**
 * Opens the global Add sheet, or null outside the staff layout (previews,
 * tests), where callers should fall back to a link to /staff.
 */
export function useAdd(): (() => void) | null {
  return React.useContext(AddContext)?.openAdd ?? null
}

/**
 * Opens Add: the raised tab on phones, "Add photos" in the AppBar from md.
 * Outside the staff layout (previews, tests) it links to Me, where the
 * profile's own upload lives.
 */
export function AddTrigger({ kind }: { kind: "tab" | "bar" }) {
  const add = React.useContext(AddContext)
  const openAdd = add?.openAdd ?? null
  const busy = add?.busy
  const label = kind === "tab" ? "Add" : "Add photos"
  // While the hidden Add queue has unfinished files, Add shows that queue:
  // a count on the trigger, and the words after its name. The name is set
  // whole because Chrome inserts a space before an sr-only suffix.
  const busyName = busy ? `${label}, ${busy.words}` : undefined
  const badge = busy ? (
    <span
      aria-hidden
      data-slot="add-busy"
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-round bg-ink px-1.5 text-chip text-paper tabular-nums",
        kind === "tab" && "absolute -top-3 left-[calc(50%+10px)]"
      )}
    >
      {busy.count}
    </span>
  ) : null
  const content =
    kind === "tab" ? (
      <>
        <span
          data-slot="tabbar-disc"
          aria-hidden
          className="-mt-6 grid size-13 place-items-center rounded-round bg-accent text-on-accent shadow-[0_0_0_4px_var(--panel)] transition-colors duration-(--duration-quick) group-hover:bg-accent-hover"
        >
          <PlusIcon className="size-7" />
        </span>
        {label}
        {badge}
      </>
    ) : (
      <>
        <PlusIcon data-icon="inline-start" aria-hidden />
        {label}
        {badge}
      </>
    )
  const className =
    kind === "tab"
      ? cn(TAB_ITEM, "group text-ink")
      : buttonVariants({ variant: "secondary" })
  return openAdd ? (
    <button
      type="button"
      className={className}
      aria-label={busyName}
      onClick={openAdd}
    >
      {content}
    </button>
  ) : (
    <Link href="/staff" className={className}>
      {content}
    </Link>
  )
}

/** One TabBar item: icon over an always-visible label, full bar height. */
export const TAB_ITEM =
  "relative grid min-h-(--size-tabbar) content-center justify-items-center gap-1 px-0.5 py-1.5 text-center text-tab-label wdth-88 outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-3"
