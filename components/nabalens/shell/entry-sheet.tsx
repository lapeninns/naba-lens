"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { entryFrom, withFrom, type EntryMenu } from "@/lib/work-client/entry"

import { ENTRY_COPY } from "./entry-copy"
import { EntryFlow, type EntryHrefs, type EntryStep } from "./entry-flow"

/** Staff destinations; `from` brings the person back to this page. */
export function staffEntryHrefs(from: string | null): EntryHrefs {
  return {
    dish: "/staff/menu",
    task: (id) => withFrom(`/staff/tasks/${encodeURIComponent(id)}`, from),
    question: (checkId) =>
      withFrom(`/staff/tasks/amenities/${encodeURIComponent(checkId)}`, from),
  }
}

/**
 * Add's intent step on staff pages ("What are you adding?"). The choices are
 * read on the server; until they arrive the sheet says so. With none (the
 * capabilities read failed), `onUnavailable` hands back to today's Add.
 */
export function EntrySheet({
  open,
  onOpenChange,
  entry,
  step,
  onPhotos,
  onUnavailable,
  hrefs,
  role,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Promise<EntryMenu | null>
  step: EntryStep
  onPhotos: () => void
  onUnavailable: () => void
  /** Another workspace's destinations; staff pages' by default. */
  hrefs?: EntryHrefs
  role?: "staff" | "manager"
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <React.Suspense
            fallback={
              <>
                <DialogTitle>{ENTRY_COPY.title}</DialogTitle>
                <div
                  aria-hidden
                  className="h-40 animate-pulse rounded-touch bg-surface-2"
                />
              </>
            }
          >
            <EntryChoices
              entry={entry}
              step={step}
              onPhotos={onPhotos}
              onNavigate={() => onOpenChange(false)}
              onUnavailable={onUnavailable}
              hrefs={hrefs}
              role={role}
            />
          </React.Suspense>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" size="touch" />}>
            {ENTRY_COPY.cancel}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EntryChoices({
  entry,
  step,
  onPhotos,
  onNavigate,
  onUnavailable,
  hrefs,
  role,
}: {
  entry: Promise<EntryMenu | null>
  step: EntryStep
  onPhotos: () => void
  onNavigate: () => void
  onUnavailable: () => void
  hrefs?: EntryHrefs
  role?: "staff" | "manager"
}) {
  const menu = React.use(entry)
  const pathname = usePathname()
  const offered =
    menu !== null && (step === "choose" || menu.intents.includes(step))
  React.useEffect(() => {
    if (!offered) onUnavailable()
  }, [offered, onUnavailable])
  if (!offered) return <DialogTitle>{ENTRY_COPY.title}</DialogTitle>
  return (
    <EntryFlow
      menu={menu}
      hrefs={hrefs ?? staffEntryHrefs(entryFrom(pathname))}
      role={role}
      initialStep={step}
      onPhotos={onPhotos}
      onNavigate={onNavigate}
      Title={DialogTitle}
    />
  )
}
