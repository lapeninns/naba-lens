"use client"

import * as React from "react"
import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { PhotoSource } from "../photo-source"
import type { UploadPurpose } from "../upload-queue"
import { TAB_ITEM } from "./tab-item"

/**
 * A menu item to label the next files with (from Our menu's dish row). It is
 * applied by default: the upload sheet shows it as a chip the person can
 * remove, and it is saved on each of those photos unless they do.
 */
export type AddLabelPreset = {
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
}

export type OpenAddOptions = {
  /**
   * Open this picker straight away (no sheet): "camera" captures with the
   * back camera, "library" picks several. The host clicks its hidden input
   * synchronously, so call openAdd inside the click handler. The picked files
   * start uploading at once and the "Saving N photos" sheet opens.
   */
  source?: PhotoSource
  /** Accept photos only for the files picked from this call (task screens). */
  imagesOnly?: boolean
  /**
   * Label applied to the files picked from this call only (a removable chip):
   * earlier files in the queue, and later picks, never get it.
   */
  preset?: AddLabelPreset | null
  /**
   * Called once files are actually picked (not when the picker is cancelled),
   * with those files.
   */
  onPicked?: (files?: File[]) => void
  /**
   * Hears only the files picked from this call, each one as soon as THAT file
   * is ready (one asset ID per call, many calls per pick), so a task screen
   * selects a photo while a slow video is still uploading. Return false when
   * the screen is gone: the photo is still saved (to the person's portfolio),
   * and Add keeps it listed as "Saved" but not added to the task until the
   * person has seen it.
   */
  onReady?: (assetIds: string[]) => boolean | void
  /**
   * Show the upload dialog at every width instead of the phone sheet (Me's
   * own "Upload photos or videos").
   */
  dialog?: boolean
  /**
   * Why the files picked from this call are uploaded, fixed at reservation.
   * "amenity" (the amenity capture form) keeps them out of the organisation
   * community. Default "general".
   */
  purpose?: UploadPurpose
}

export type AddReadyListener = (assetIds: string[]) => void

type AddContextValue = {
  openAdd: (opts?: OpenAddOptions) => void
  /**
   * Subscribe to uploads of the one Add queue as each becomes ready (one asset
   * ID per call, asset IDs known). Returns the unsubscribe function.
   */
  onReady?: (listener: AddReadyListener) => () => void
  /** Changes after a global Add upload completes so mounted galleries refresh. */
  refreshSignal?: number
  /** Files in the Add queue that are not finished, in the queue's words. */
  busy?: { count: number; words: string } | null
  /** Uploads still transferring or processing (not failed or stopped). */
  active?: number
  /**
   * Labels were saved on these photos elsewhere (Me's Fix labels): Add's
   * rows for them read "Saved" with the labels the photo has now.
   */
  labelled?: (assetIds: string[]) => void
  /**
   * The labels kept for these photos were discarded elsewhere (Me's Discard
   * labels): Add's rows for them read "Saved" with no labels.
   */
  discarded?: (assetIds: string[]) => void
}

const AddContext = React.createContext<AddContextValue | null>(null)

/** Provided by the staff layout, which hosts the Add sheet and upload flow. */
export const AddProvider = AddContext.Provider

/**
 * Opens the global Add sheet (or a picker, with `source`), or null outside
 * the staff layout (previews, tests), where callers should fall back to a
 * link to /staff.
 */
export function useAdd(): ((opts?: OpenAddOptions) => void) | null {
  return React.useContext(AddContext)?.openAdd ?? null
}

/**
 * The one Add queue, for screens that send its uploads on (task screens):
 * open it and hear which uploads became ready. Null outside the staff layout.
 */
export function useAddQueue(): {
  openAdd: (opts?: OpenAddOptions) => void
  onReady: (listener: AddReadyListener) => () => void
} | null {
  const add = React.useContext(AddContext)
  return React.useMemo(
    () =>
      add
        ? {
            openAdd: add.openAdd,
            onReady: add.onReady ?? (() => () => {}),
          }
        : null,
    // Only the two functions matter; busy and refreshSignal change often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [add?.openAdd, add?.onReady]
  )
}

/** Tell Add that these photos were labelled elsewhere (no-op outside the staff layout). */
export function useAddLabelled(): (assetIds: string[]) => void {
  return React.useContext(AddContext)?.labelled ?? noop
}

/**
 * Tell Add that the kept labels of these photos were discarded elsewhere
 * (no-op outside the staff layout).
 */
export function useAddDiscarded(): (assetIds: string[]) => void {
  return React.useContext(AddContext)?.discarded ?? noop
}

function noop() {}

/**
 * How many uploads of the one Add queue are still in progress, or null
 * outside the staff layout.
 */
export function useAddActive(): number | null {
  return React.useContext(AddContext)?.active ?? null
}

export function useAddRefreshSignal(): number {
  return React.useContext(AddContext)?.refreshSignal ?? 0
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
        "inline-grid h-[26px] min-w-[26px] place-items-center rounded-round bg-ink px-[7px] font-mono text-[1.0625rem] leading-none font-bold text-surface tabular-nums",
        kind === "tab" &&
          "absolute top-1 left-[calc(50%+12px)] ring-2 ring-surface"
      )}
    >
      {busy.count}
    </span>
  ) : null
  const content =
    kind === "tab" ? (
      <>
        {/* Common Room Add tab: a grey pill around the plus, never blue
            (the screen's one blue is its own primary). */}
        <span
          data-slot="tabbar-disc"
          aria-hidden
          className="grid h-[30px] w-11 place-items-center rounded-round bg-surface-2 text-ink transition-colors duration-(--duration-quick) group-hover:bg-raised"
        >
          <PlusIcon weight="bold" className="size-[22px]" />
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
      ? cn(TAB_ITEM, "group text-ink hover:bg-surface-2")
      : // One line from lg: wrapping doubled the bar height at 1280 (768 needs the wrap).
        cn(buttonVariants({ variant: "secondary" }), "lg:whitespace-nowrap")
  return openAdd ? (
    <button
      type="button"
      className={className}
      aria-label={busyName}
      onClick={() => openAdd()}
    >
      {content}
    </button>
  ) : (
    <Link href="/staff" className={className}>
      {content}
    </Link>
  )
}

