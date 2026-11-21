"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PublicationDestination } from "@/lib/server/exports/model"

import { EXPORTS_COPY } from "./copy"
import { RecordPublishedForm } from "./publication-forms"

/** md and up (48rem): the form sits beside the list, not in a Dialog. */
const WIDE = "(min-width: 48rem)"

const canMatch = () => typeof window.matchMedia === "function"

function subscribe(onChange: () => void) {
  if (!canMatch()) return () => {}
  const query = window.matchMedia(WIDE)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function useWide() {
  return React.useSyncExternalStore(
    subscribe,
    () => !canMatch() || window.matchMedia(WIDE).matches,
    // The server draws the side card; a phone swaps it for the Dialog.
    () => true
  )
}

export type RecordWherePhoto = {
  assetId: string
  label: string
  destinations: PublicationDestination[]
}

/**
 * Record where it's published (second handoff, one export package): one
 * form, for the photo chosen with its row's "Record where" (`?record=`).
 * Beside the list from md; on a phone the same form opens in a Dialog and
 * closing it returns to the list.
 */
export function RecordWhere({
  photo,
  packageId,
  today,
  opened,
}: {
  /** The chosen photo; null when no photo here can be recorded. */
  photo: RecordWherePhoto | null
  packageId: string
  today: string
  /** A row's "Record where" chose it (the URL has `?record=`). */
  opened: boolean
}) {
  const wide = useWide()
  const router = useRouter()
  if (!photo) return null

  const form = (
    <RecordPublishedForm
      // A new photo starts a fresh form (and a fresh request key).
      key={photo.assetId}
      assetId={photo.assetId}
      packageId={packageId}
      destinations={photo.destinations}
      today={today}
    />
  )

  if (!wide) {
    return (
      <Dialog
        open={opened}
        onOpenChange={(next) => {
          if (!next) router.replace(window.location.pathname, { scroll: false })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{EXPORTS_COPY.recordWhereTitle}</DialogTitle>
            <DialogDescription>{photo.label}</DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <section
      id="record-where"
      aria-labelledby="record-where-title"
      className="grid min-w-0 scroll-mt-20 content-start gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h2 id="record-where-title" className="type-section-title text-ink">
        {EXPORTS_COPY.recordWhereTitle}
      </h2>
      <p className="text-label break-words text-ink">{photo.label}</p>
      {form}
    </section>
  )
}
