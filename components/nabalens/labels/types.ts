import type {
  LabelCatalogue,
  LabelEditorAsset,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

/** The asset venue's catalogue as the host currently has it. */
export type CatalogueProp =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; catalogue: LabelCatalogue }

export type LabelEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 1..LABEL_LIMITS.maxBatchAssets ready assets of one venue. */
  assets: LabelEditorAsset[]
  catalogue: CatalogueProp
  /** Reload the catalogue (after an error, or when the menu changed). */
  onRetryCatalogue: () => void
  /**
   * Save every input (one per changed file). Must resolve with one result per
   * input (matched by assetId). A rejection is treated as a network failure.
   */
  onSave: (inputs: SaveLabelsInput[]) => Promise<SaveLabelsResult[]>
  /** After each save attempt that stored at least one file: the ok results. */
  onSaved?: (results: SaveLabelsResult[]) => void
  /** Default: "Label these files" (2+), else "Edit labels" / "Add labels". */
  title?: string
  /** Default: "Skip for now" when no file has labels yet, else "Cancel". */
  cancelLabel?: string
}
