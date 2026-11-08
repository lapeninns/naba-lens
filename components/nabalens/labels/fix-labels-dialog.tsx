"use client"

import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  LabelEditorAsset,
  SaveLabelsErrorCode,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

import { LabelEditorRoot } from "./label-editor-dialog"
import type { CatalogueProp } from "./types"

export type FixLabelsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The (now ready) file whose labels could not be saved. */
  asset: LabelEditorAsset
  /** The stored labels that could not be saved. */
  draft: SaveLabelsInput
  /** Why they could not be saved, shown above the fields. */
  problem?: { code: SaveLabelsErrorCode; message: string } | null
  catalogue: CatalogueProp
  onRetryCatalogue: () => void
  focus?: WorkFocus | null
  /**
   * Save the corrected labels now (the file is ready). Null: the answer was
   * lost, so the save may or may not have happened.
   */
  onSave: (input: SaveLabelsInput) => Promise<SaveLabelsResult | null>
}

/**
 * "Fix labels" for a file whose labels need attention: reopens the stored
 * draft against the CURRENT menu. Items still on the menu are kept (named as
 * the menu names them now); items it no longer offers are marked "No longer on
 * the menu" for removal. Saves with the current catalogue version and closes
 * only after a successful save; errors stay inline. Closing without changes
 * keeps the stored draft.
 */
export function FixLabelsDialog({
  open,
  onOpenChange,
  asset,
  draft,
  problem = null,
  catalogue,
  onRetryCatalogue,
  focus = null,
  onSave,
}: FixLabelsDialogProps) {
  return (
    <LabelEditorRoot
      open={open}
      onOpenChange={onOpenChange}
      assets={[asset]}
      catalogue={catalogue}
      onRetryCatalogue={onRetryCatalogue}
      focus={focus}
      title="Fix labels"
      fix={{ draft, problem }}
      onSave={async (inputs) => {
        const result = await onSave(inputs[0])
        return result ? [result] : []
      }}
    />
  )
}
