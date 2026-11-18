import "server-only"

import { readArchiveConfig } from "@/lib/server/archive/config"

// Integrations on Settings (spec §8 A7, §16). Credentials live only in the
// deployment's environment: this reads whether each one is set, never its
// value, so no secret reaches a page, a payload or a log. Changing one is a
// deployment change, not a form field.

export type Integration = {
  id: string
  name: string
  purpose: string
  configured: boolean
}

const set = (v: string | undefined, min = 1) =>
  typeof v === "string" && v.trim().length >= min

export function integrationStatus(
  env: Record<string, string | undefined> = process.env
): Integration[] {
  let archive = false
  try {
    archive = readArchiveConfig(env) !== null
  } catch {
    archive = false
  }
  return [
    {
      id: "scheduler",
      name: "Scheduled jobs",
      purpose: "Cleanup, digests, exceptions and monthly preparation",
      configured: set(env.CLEANUP_SECRET, 32),
    },
    {
      id: "archive",
      name: "Original archive",
      purpose: "A second copy of every original",
      configured: archive,
    },
    {
      id: "watchdog_email",
      name: "Archive alert email",
      purpose: "Email when the archive checker stops",
      configured:
        set(env.ARCHIVE_WATCHDOG_RESEND_API_KEY) &&
        set(env.ARCHIVE_WATCHDOG_EMAIL_FROM),
    },
    {
      id: "destinations",
      name: "Website and Google Business Profile",
      purpose: "Publishing is manual in Release 1 (export, then confirm)",
      configured: false,
    },
  ]
}
