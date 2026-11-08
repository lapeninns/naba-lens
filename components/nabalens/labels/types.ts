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
 * The dish the files were picked for (Our menu's "Add a photo of this dish",
 * a task's dish; the same shape as AddLabelPreset). It is applied as soon as
 * the menu names it, as a removable chip, and saved with the other labels
 * unless the person removes it. A dish the current menu no longer offers is
 * not added (the upload panel says so).
 */
export type LabelPreset = {
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
}

/**
 * The upload sheet's dish per file (UploadLabelPanel's `presetFor`): files
 * picked from different dishes each keep their own. Asked once per file, when
 * the panel first names the file's labels from the menu (it may mount again,
 * e.g. when the sheet reopens); null when the file has no dish. Each dish is a
 * removable chip naming its photos, and in the common field only when every
 * photo has the same dish. Removing it takes it off the photos the chip names
 * only; a file asked later still gets its own dish.
 */
export type PresetFor = (fileId: string) => LabelPreset | null

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
  /**
   * Applied as a removable chip when it is on this venue's menu, and saved
   * with the other labels unless removed.
   */
  preset?: LabelPreset | null
  /**
   * The files the preset belongs to (the ones picked from Our menu's dish).
   * Omitted: every file. Other files of the batch never get it.
   */
  presetAssetIds?: readonly string[]
  /** Resolve with one result per input, matched by assetId. */
  onSave: (inputs: SaveLabelsInput[]) => Promise<SaveLabelsResult[]>
}
