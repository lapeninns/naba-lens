// Organisation settings (spec §8 A7; 20261118106100_ops_settings.sql). Pure
// and client-safe: parsing the read, the form's validation and the patch the
// server sends. The database validates again; these rules mirror it so the
// form can name the field before a round trip.

export const EXPORT_PROFILES = [
  { id: "original", label: "Original" },
  { id: "website", label: "Website" },
  { id: "social", label: "Social" },
  { id: "custom", label: "Custom" },
] as const

export type ExportProfile = (typeof EXPORT_PROFILES)[number]["id"]

/** The five staff categories are fixed by the spec (§4.1, §23.3, FA-6). */
export const CATEGORIES = [
  "Food",
  "Drinks",
  "Spaces",
  "Facilities",
  "Other",
] as const

export type OpsSettings = {
  quietStart: string
  quietEnd: string
  reviewReminderDays: number
  backlogAlertDays: number
  orphanCleanupDays: number
  exportProfiles: ExportProfile[]
  storageQuotaBytes: number
  storageAlertPercent: number
  revision: number
  updatedAt: string | null
  timezone: string
}

export const DEFAULT_SETTINGS: OpsSettings = {
  quietStart: "21:00",
  quietEnd: "08:00",
  reviewReminderDays: 1,
  backlogAlertDays: 7,
  orphanCleanupDays: 7,
  exportProfiles: ["original", "website", "social", "custom"],
  storageQuotaBytes: 100 * 1024 ** 3,
  storageAlertPercent: 80,
  revision: 0,
  updatedAt: null,
  timezone: "Europe/London",
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const GIB = 1024 ** 3

const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v)

/** The database read, or null when it is not the expected shape. */
export function parseOpsSettings(data: unknown): OpsSettings | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (
    typeof d.quietStart !== "string" ||
    typeof d.quietEnd !== "string" ||
    !isInt(d.reviewReminderDays) ||
    !isInt(d.backlogAlertDays) ||
    !isInt(d.orphanCleanupDays) ||
    !Array.isArray(d.exportProfiles) ||
    !isInt(d.storageQuotaBytes) ||
    !isInt(d.storageAlertPercent) ||
    !isInt(d.revision)
  )
    return null
  return {
    quietStart: d.quietStart,
    quietEnd: d.quietEnd,
    reviewReminderDays: d.reviewReminderDays,
    backlogAlertDays: d.backlogAlertDays,
    orphanCleanupDays: d.orphanCleanupDays,
    exportProfiles: d.exportProfiles.filter((p): p is ExportProfile =>
      EXPORT_PROFILES.some((e) => e.id === p)
    ),
    storageQuotaBytes: d.storageQuotaBytes,
    storageAlertPercent: d.storageAlertPercent,
    revision: d.revision,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
    timezone: typeof d.timezone === "string" ? d.timezone : "Europe/London",
  }
}

export type SettingsField =
  | "quietStart"
  | "quietEnd"
  | "reviewReminderDays"
  | "backlogAlertDays"
  | "orphanCleanupDays"
  | "exportProfiles"
  | "storageQuotaGb"
  | "storageAlertPercent"
  | "reason"

export type SettingsForm = {
  quietStart: string
  quietEnd: string
  reviewReminderDays: string
  backlogAlertDays: string
  orphanCleanupDays: string
  exportProfiles: string[]
  storageQuotaGb: string
  storageAlertPercent: string
  reason: string
}

export type SettingsPatch = Partial<
  Omit<OpsSettings, "revision" | "updatedAt" | "timezone">
>

function wholeNumber(
  raw: string,
  min: number,
  max: number
): number | undefined {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return undefined
  const n = Number(text)
  return n >= min && n <= max ? n : undefined
}

/**
 * The changed fields as the database patch, or the errors by field. Only
 * changed fields are sent, so the server's no-change check and the activity
 * log see exactly what the admin changed.
 */
export function settingsPatch(
  form: SettingsForm,
  current: OpsSettings
):
  | { ok: true; patch: SettingsPatch; reason: string }
  | { ok: false; fieldErrors: Partial<Record<SettingsField, string>> } {
  const errors: Partial<Record<SettingsField, string>> = {}
  const patch: SettingsPatch = {}

  for (const key of ["quietStart", "quietEnd"] as const) {
    const value = form[key].trim()
    if (!HHMM.test(value)) errors[key] = "Use a 24-hour time such as 21:00."
    else if (value !== current[key]) patch[key] = value
  }
  const numbers = [
    ["reviewReminderDays", 1, 14, "Choose 1 to 14 days."],
    ["backlogAlertDays", 1, 60, "Choose 1 to 60 days."],
    ["orphanCleanupDays", 1, 30, "Choose 1 to 30 days."],
    ["storageAlertPercent", 50, 99, "Choose 50 to 99 per cent."],
  ] as const
  for (const [key, min, max, message] of numbers) {
    const n = wholeNumber(form[key], min, max)
    if (n === undefined) errors[key] = message
    else if (n !== current[key]) patch[key] = n
  }
  const gb = wholeNumber(form.storageQuotaGb, 1, 102400)
  if (gb === undefined)
    errors.storageQuotaGb = "Choose a whole number of GB, from 1."
  else if (gb * GIB !== current.storageQuotaBytes)
    patch.storageQuotaBytes = gb * GIB

  const profiles = EXPORT_PROFILES.map((p) => p.id).filter((id) =>
    form.exportProfiles.includes(id)
  )
  if (profiles.length === 0)
    errors.exportProfiles = "Allow at least one export profile."
  else if (
    profiles.join(",") !==
    [...current.exportProfiles].sort(byProfileOrder).join(",")
  )
    patch.exportProfiles = profiles

  const reason = form.reason.trim()
  if (Object.keys(errors).length === 0 && Object.keys(patch).length > 0) {
    if (!reason) errors.reason = "Say why you are changing this."
    else if (reason.length > 500) errors.reason = "At most 500 characters."
  }
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors }
  return { ok: true, patch, reason }
}

const ORDER = EXPORT_PROFILES.map((p) => p.id as string)
function byProfileOrder(a: string, b: string) {
  return ORDER.indexOf(a) - ORDER.indexOf(b)
}

/** The form's starting values from the current settings. */
export function settingsForm(current: OpsSettings): SettingsForm {
  return {
    quietStart: current.quietStart,
    quietEnd: current.quietEnd,
    reviewReminderDays: String(current.reviewReminderDays),
    backlogAlertDays: String(current.backlogAlertDays),
    orphanCleanupDays: String(current.orphanCleanupDays),
    exportProfiles: [...current.exportProfiles],
    storageQuotaGb: String(Math.round(current.storageQuotaBytes / GIB)),
    storageAlertPercent: String(current.storageAlertPercent),
    reason: "",
  }
}

/** "1.2 GB", "340 MB", "12 KB": binary units, one decimal from GB up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown"
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

/** "21:00 to 08:00" with the timezone named once. */
export function quietHoursText(start: string, end: string, timezone: string) {
  if (start === end) return "No quiet hours"
  return `${start} to ${end}, ${timezone.replace("_", " ")} time`
}
