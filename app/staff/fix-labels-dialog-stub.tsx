"use client"

// TODO(integration): DELETE THIS FILE. A stand-in for S2's FixLabelsDialog
// (contract C3), which is not on this branch. At integration, import
// `FixLabelsDialog` from "@/components/nabalens/labels" in needs-attention.tsx
// and remove this file and its import. Same props as the contract; it only
// re-saves the stored draft, so the Me list can be built and tested now.

import * as React from "react"

import type { CatalogueProp } from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  LabelEditorAsset,
  SaveLabelsErrorCode,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

export type FixLabelsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: LabelEditorAsset
  draft: SaveLabelsInput
  problem?: { code: SaveLabelsErrorCode; message: string } | null
  catalogue: CatalogueProp
  onRetryCatalogue: () => void
  focus?: WorkFocus | null
  onSave: (input: SaveLabelsInput) => Promise<SaveLabelsResult>
}

export function FixLabelsDialog({
  open,
  onOpenChange,
  draft,
  problem = null,
  catalogue,
  onSave,
}: FixLabelsDialogProps) {
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const result = await onSave({
      ...draft,
      catalogueVersionId:
        catalogue.state === "ready" && catalogue.catalogue.status === "active"
          ? catalogue.catalogue.versionId
          : draft.catalogueVersionId,
    })
    setSaving(false)
    // Closes only after a successful save.
    if (result.ok) onOpenChange(false)
    else setError(result.message)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fix labels</DialogTitle>
          <DialogDescription>
            {problem?.message ?? "Check the labels, then save them."}
          </DialogDescription>
        </DialogHeader>
        {error ? <Notice tone="negative">{error}</Notice> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="touch"
            disabled={saving}
            onClick={() => void save()}
          >
            Save labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
