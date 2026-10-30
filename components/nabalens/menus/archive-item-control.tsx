"use client"

import * as React from "react"
import { ArchiveIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

import { labelledFilesCopy, type MenuActionResult } from "./copy"
import { ConfirmMenuActionDialog } from "./confirm-menu-action-dialog"

type ArchiveItemControlProps = {
  itemName: string
  archived: boolean
  /** Labelled photos/videos that use this item. */
  labelCount?: number
  /** `archived` is the state to set. */
  onSetArchived: (archived: boolean) => Promise<MenuActionResult>
  disabled?: boolean
}

/** Archive stops new labels with the item; existing labels always stay. */
export function ArchiveItemControl({
  itemName,
  archived,
  labelCount = 0,
  onSetArchived,
  disabled = false,
}: ArchiveItemControlProps) {
  const [open, setOpen] = React.useState(false)
  const kept =
    labelCount > 0
      ? `Its ${labelledFilesCopy(labelCount)} keep their labels.`
      : "Existing labels are kept."

  return (
    <>
      <Button
        variant="outline"
        size="touch"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`${archived ? "Unarchive item" : "Archive item"}: ${itemName}`}
      >
        {archived ? (
          <ArrowCounterClockwiseIcon data-icon="inline-start" aria-hidden />
        ) : (
          <ArchiveIcon data-icon="inline-start" aria-hidden />
        )}
        {archived ? "Unarchive item" : "Archive item"}
      </Button>
      <ConfirmMenuActionDialog
        open={open}
        onOpenChange={setOpen}
        title={
          <>
            {archived ? "Unarchive" : "Archive"} “{itemName}”?
          </>
        }
        description={
          archived
            ? `Staff can add it to labels again while it is on the active menu. ${kept}`
            : `Staff can no longer add it to new labels, in this or later versions, until you unarchive it. ${kept}`
        }
        confirmLabel={archived ? "Unarchive item" : "Archive item"}
        pendingLabel={archived ? "Unarchiving…" : "Archiving…"}
        fallbackError="The item could not be updated. Try again."
        onConfirm={() => onSetArchived(!archived)}
      />
    </>
  )
}
