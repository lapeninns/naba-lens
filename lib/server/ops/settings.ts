import "server-only"

import { apiError, fromDbError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import {
  parseOpsSettings,
  settingsPatch,
  type OpsSettings,
  type SettingsField,
  type SettingsForm,
} from "@/lib/ops/settings"
import { parseOpsStatus, type OpsStatus } from "@/lib/ops/status"

import type { OpsCaller, OpsResult } from "./types"

// Organisation settings and operational monitoring (spec §8 A7, §16). Reads
// and writes run as the caller; the database refuses anyone but an active
// admin for the write and for ops_status (20261118106100, 20261118106300).

const SETTINGS_ERRORS: Record<
  string,
  { field: SettingsField; message: string }
> = {
  invalid_quiet_hours: {
    field: "quietStart",
    message: "Use a 24-hour time such as 21:00.",
  },
  invalid_reminder_days: {
    field: "reviewReminderDays",
    message: "Choose 1 to 14 days.",
  },
  invalid_backlog_days: {
    field: "backlogAlertDays",
    message: "Choose 1 to 60 days.",
  },
  invalid_cleanup_days: {
    field: "orphanCleanupDays",
    message: "Choose 1 to 30 days.",
  },
  invalid_export_profiles: {
    field: "exportProfiles",
    message: "Allow at least one export profile.",
  },
  invalid_storage_quota: {
    field: "storageQuotaGb",
    message: "Choose a whole number of GB, from 1.",
  },
  invalid_alert_percent: {
    field: "storageAlertPercent",
    message: "Choose 50 to 99 per cent.",
  },
  reason_required: {
    field: "reason",
    message: "Say why you are changing this.",
  },
  invalid_reason: { field: "reason", message: "At most 500 characters." },
}

function logged(context: string, error: { code?: string; message?: string }) {
  console.error(`[ops] ${context} failed`, {
    error: redactError(
      new Error(`${error.code ?? "unknown"}: ${error.message ?? ""}`)
    ),
  })
}

export async function loadOpsSettings(
  caller: OpsCaller
): Promise<OpsResult<{ settings: OpsSettings }>> {
  const { data, error } = await caller.db.rpc("ops_settings")
  if (error) {
    const mapped = fromDbError(error)
    if (mapped.code === "unavailable") logged("settings read", error)
    return mapped
  }
  const settings = parseOpsSettings(data)
  return settings ? { ok: true, settings } : apiError("unavailable")
}

export type SaveSettingsResult =
  | { ok: true; settings: OpsSettings; changed: boolean }
  | {
      ok: false
      message: string
      fieldErrors?: Partial<Record<SettingsField, string>>
      stale?: boolean
    }

/**
 * Validates the form against the settings the admin started from, then sends
 * only the changed fields with that revision. A stale revision is reported as
 * such so the page can reload the latest values instead of overwriting them.
 */
export async function saveOpsSettings(
  caller: OpsCaller,
  form: SettingsForm,
  base: OpsSettings
): Promise<SaveSettingsResult> {
  const checked = settingsPatch(form, base)
  if (!checked.ok)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: checked.fieldErrors,
    }
  if (Object.keys(checked.patch).length === 0)
    return { ok: true, settings: base, changed: false }

  const { data, error } = await caller.db.rpc("ops_settings_set", {
    p_expected_revision: base.revision,
    p_patch: checked.patch,
    p_reason: checked.reason,
  })
  if (error) {
    const mapped = fromDbError(error, SETTINGS_ERRORS)
    if (mapped.code === "unavailable") logged("settings save", error)
    return {
      ok: false,
      message: `${mapped.message} ${mapped.nextAction}`,
      stale: mapped.code === "stale_version",
      ...(mapped.field
        ? { fieldErrors: { [mapped.field]: mapped.message } }
        : {}),
    }
  }
  const settings = parseOpsSettings(data)
  if (!settings)
    return {
      ok: false,
      message: "Saved, but the page could not refresh. Reload it.",
    }
  return {
    ok: true,
    settings: { ...settings, timezone: base.timezone },
    changed: (data as { changed?: unknown }).changed === true,
  }
}

export async function loadOpsStatus(
  caller: OpsCaller
): Promise<OpsResult<{ status: OpsStatus }>> {
  const { data, error } = await caller.db.rpc("ops_status")
  if (error) {
    const mapped = fromDbError(error)
    if (mapped.code === "unavailable") logged("status read", error)
    return mapped
  }
  const status = parseOpsStatus(data)
  return status ? { ok: true, status } : apiError("unavailable")
}
