import type { WorkFocus } from "@/lib/config/work-roles"
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

/**
 * Who is labelling. Staff label their own files and never see admin-only
 * details (original file names); admins see the file name and get a link to
 * Menus for open missing-item suggestions.
 */
export type LabelAudience = "staff" | "admin"

/**
 * A menu item suggested for the files (Our menu's "Add a photo of this dish";
 * the same shape as AddLabelPreset). The editor shows it as an unsaved draft
 * for the person to keep or remove; it is never saved without them.
 */
export type LabelPreset = {
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
}

export type LabelEditorDialogProps = {
  open: boolean
  /** Default "staff" (the safer one: shows no admin-only details). */
  audience?: LabelAudience
  onOpenChange: (open: boolean) => void
  /** 1..LABEL_LIMITS.maxBatchAssets files of one venue. */
  assets: LabelEditorAsset[]
  catalogue: CatalogueProp
  /** Reload the catalogue (after an error, or when the menu changed). */
  onRetryCatalogue: () => void
  /** After each save attempt that stored at least one file: the ok results. */
  onSaved?: (results: SaveLabelsResult[]) => void
  /** Default: "Labels" for staff, "Edit labels" for admins. */
  title?: string
  /** Default: "Cancel". */
  cancelLabel?: string
  /**
   * The person's work focus: their sections and content types come first.
   * Order only; search still covers the whole menu.
   */
  focus?: WorkFocus | null
  /** Pre-filled as a draft label when it is on this venue's menu. */
  preset?: LabelPreset | null
  /**
   * The files the preset belongs to (the ones picked from Our menu's dish).
   * Omitted: every file. Other files of the batch never get it.
   */
  presetAssetIds?: readonly string[]
  /** Resolve with one result per input, matched by assetId. */
  onSave: (inputs: SaveLabelsInput[]) => Promise<SaveLabelsResult[]>
}
