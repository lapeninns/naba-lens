"use client"

import * as React from "react"
import { PencilSimpleIcon } from "@phosphor-icons/react"

import { formatDate } from "@/components/nabalens/format"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { CoverageSection } from "./layout"
import type { AmenityFactView, RequirementView } from "./types"

/** "Confirmed by you · 28 Oct 2026", or "Not confirmed yet". */
export function factConfirmedText(
  fact: Pick<AmenityFactView, "confirmed" | "confirmedAt" | "confirmedBy">,
  viewerId: string
): string {
  if (!fact.confirmed || !fact.confirmedAt) return "Not confirmed yet"
  const who =
    fact.confirmedBy?.id === viewerId
      ? "you"
      : (fact.confirmedBy?.displayName ?? "a manager")
  return `Confirmed by ${who} · ${formatDate(fact.confirmedAt)}`
}

/** Lets the facts form close its dialog: after a save, with the saved text. */
export type FactsDialogControls = {
  onSaved: (text: string) => void
  onCancel: () => void
}

/**
 * What the venue has recorded about an amenity, kept apart from any photo.
 * "Record facts" opens the facts form; while presence needs verification the
 * item cannot be confirmed. A save closes the dialog and says so here.
 */
export function AmenityFactsSection({
  requirement,
  fact,
  viewerId,
  form,
}: {
  requirement: RequirementView
  fact: AmenityFactView | null
  viewerId: string
  /** The facts form, shown in a dialog. Without it there is no "Record facts". */
  form?: React.ReactNode | ((controls: FactsDialogControls) => React.ReactNode)
}) {
  const ids = React.useId()
  const [open, setOpen] = React.useState(false)
  const [saved, setSaved] = React.useState<string | null>(null)
  const controls: FactsDialogControls = {
    onSaved: (text) => {
      setSaved(text)
      setOpen(false)
    },
    onCancel: () => setOpen(false),
  }
  const presence = fact?.presence ?? requirement.amenity?.presence ?? "unknown"
  const confirmed = fact
    ? factConfirmedText(fact, viewerId)
    : requirement.amenity?.confirmed
      ? null
      : "Not confirmed yet"

  return (
    <CoverageSection title="Amenity facts" id={`${ids}-facts`}>
      <div aria-live="polite" className="empty:hidden">
        {saved ? (
          <Notice
            tone="positive"
            role="status"
            action={
              <Button variant="quiet" size="sm" onClick={() => setSaved(null)}>
                Dismiss
              </Button>
            }
          >
            {saved}
          </Notice>
        ) : null}
      </div>
      {presence === "unknown" ? (
        <Notice tone="attention">
          Needs verification blocks confirming this item. Record whether it is
          present.
        </Notice>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip state={presence} />
        {confirmed ? (
          <span className="text-meta-touch text-ink-muted md:text-meta">
            {confirmed}
          </span>
        ) : null}
      </p>
      <p className="text-body-touch text-ink-muted md:text-body-sm">
        A photo never proves a claim. Facts are recorded separately, by you.
      </p>
      {form ? (
        <>
          <div>
            <Button
              variant="secondary"
              size="touch"
              onClick={() => {
                setSaved(null)
                setOpen(true)
              }}
            >
              <PencilSimpleIcon data-icon="inline-start" aria-hidden />
              Record facts
            </Button>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{requirement.title} facts</DialogTitle>
              </DialogHeader>
              {typeof form === "function" ? form(controls) : form}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </CoverageSection>
  )
}
