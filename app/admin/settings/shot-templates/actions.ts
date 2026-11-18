"use server"

import { revalidatePath } from "next/cache"

import { isCoverageCategory } from "@/lib/album/brief"
import { getCoverageActor } from "@/lib/server/coverage"
import { saveShotTemplate } from "@/lib/server/shot-templates"

// Server Functions are reachable by direct POST: this one re-authorises the
// caller (fresh profile read) and the database refuses anyone but an active
// admin on an aal2 session. Errors are returned, not thrown, because Next
// hides thrown messages.

export type ShotTemplateFormValues = {
  instruction: string
  exampleAssetId: string
  reason: string
}

export type SaveShotTemplateState =
  | { status: "idle" }
  | { status: "saved"; changed: boolean; revision: number }
  | {
      status: "error"
      message: string
      fieldErrors?: Partial<Record<"instruction" | "reason", string>>
      stale?: boolean
      /** What was sent, so the form shows it again after React resets it. */
      values?: ShotTemplateFormValues
    }

const text = (form: FormData, key: string) => {
  const v = form.get(key)
  return typeof v === "string" ? v : ""
}

export async function saveShotTemplateAction(
  _prev: SaveShotTemplateState,
  formData: FormData
): Promise<SaveShotTemplateState> {
  const auth = await getCoverageActor()
  if (!auth.ok) return { status: "error", message: auth.message }
  const category = text(formData, "category")
  if (!isCoverageCategory(category))
    return { status: "error", message: "Reload the page." }

  const values: ShotTemplateFormValues = {
    instruction: text(formData, "instruction"),
    exampleAssetId: text(formData, "exampleAssetId"),
    reason: text(formData, "reason"),
  }
  const result = await saveShotTemplate(auth.actor, {
    category,
    instruction: values.instruction,
    exampleAssetId: values.exampleAssetId,
    revision: text(formData, "revision"),
    reason: values.reason,
  })
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
      stale: result.code === "revision_conflict",
      values,
    }
  if (result.changed) {
    revalidatePath("/admin/settings")
    revalidatePath(`/admin/settings/shot-templates/${category}`)
  }
  return { status: "saved", changed: result.changed, revision: result.revision }
}
