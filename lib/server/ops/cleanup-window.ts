import "server-only"

import { abandonedUploadInterval, MEDIA_LIMITS } from "@/lib/config/media"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"

/**
 * The orphan upload window from Settings as a Postgres interval (service
 * role). If the setting cannot be read, cleanup uses the spec's 7 days (or the
 * built-in window if that is longer), so a failed read never makes cleanup
 * remove uploads sooner than any admin could have chosen to keep them.
 */
export async function orphanCleanupInterval(service: Db): Promise<string> {
  const fallbackDays = 7
  try {
    const { data, error } = await service
      .from("ops_settings")
      .select("orphan_cleanup_days")
      .eq("id", true)
      .maybeSingle()
    if (error) throw new Error(`${error.code}: ${error.message}`)
    const days = data?.orphan_cleanup_days
    if (typeof days === "number" && Number.isInteger(days) && days >= 1)
      return `${days * 24} hours`
  } catch (error) {
    console.error("[ops] orphan window read failed", { error: redactError(error) })
  }
  return MEDIA_LIMITS.abandonedUploadWindowHours > fallbackDays * 24
    ? abandonedUploadInterval(MEDIA_LIMITS)
    : `${fallbackDays * 24} hours`
}
