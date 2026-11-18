"use server"

import { revalidatePath } from "next/cache"

import type { SettingsField, SettingsForm } from "@/lib/ops/settings"
import { getCoverageActor } from "@/lib/server/coverage"
import { loadOpsSettings, saveOpsSettings } from "@/lib/server/ops"

// Server Functions are reachable by direct POST: this one re-authorises the
// caller (fresh profile read) and the database refuses anyone but an active
// admin. Errors are returned, not thrown, because Next hides thrown messages.

export type SaveSettingsState =
  | { status: "idle" }
  | { status: "saved"; changed: boolean; revision: number }
  | {
      status: "error"
      message: string
      fieldErrors?: Partial<Record<SettingsField, string>>
      stale?: boolean
    }

const text = (form: FormData, key: string) => {
  const v = form.get(key)
  return typeof v === "string" ? v : ""
}

export async function saveSettingsAction(
  _prev: SaveSettingsState,
  formData: FormData
): Promise<SaveSettingsState> {
  const auth = await getCoverageActor()
  if (!auth.ok) return { status: "error", message: auth.message }

  const revision = Number(text(formData, "revision"))
  const current = await loadOpsSettings(auth.actor)
  if (!current.ok)
    return {
      status: "error",
      message: `${current.message} ${current.nextAction}`,
    }
  if (!Number.isInteger(revision) || revision !== current.settings.revision)
    return {
      status: "error",
      stale: true,
      message:
        "Someone else changed these settings since you opened the page. Reload to see their change, then make yours again.",
    }

  const form: SettingsForm = {
    quietStart: text(formData, "quietStart"),
    quietEnd: text(formData, "quietEnd"),
    reviewReminderDays: text(formData, "reviewReminderDays"),
    backlogAlertDays: text(formData, "backlogAlertDays"),
    orphanCleanupDays: text(formData, "orphanCleanupDays"),
    exportProfiles: formData
      .getAll("exportProfiles")
      .filter((v): v is string => typeof v === "string"),
    storageQuotaGb: text(formData, "storageQuotaGb"),
    storageAlertPercent: text(formData, "storageAlertPercent"),
    reason: text(formData, "reason"),
  }
  const result = await saveOpsSettings(auth.actor, form, current.settings)
  if (!result.ok) return { status: "error", ...result }
  if (result.changed) revalidatePath("/admin/settings")
  return {
    status: "saved",
    changed: result.changed,
    revision: result.settings.revision,
  }
}
