/**
 * B10-02b switch catalogue (b10-design §4.1). Every disable switch NabaLens
 * has today, its scope, who may use it, what keeps running while it is off,
 * and the source line that proves it exists. Runbooks name switches by ID.
 *
 * Only NabaLens-internal switches are listed. Website, NabaPresence and other
 * external destinations are out of scope (owner scope correction, 11 Nov 2026).
 *
 * A switch whose mechanism is an environment variable, a schedule or a
 * migration changes production configuration: it needs the owner's approval
 * (X1) and is never used by a lane on its own.
 */

import type { OwnerRole } from "./metrics"

export type SwitchScope =
  "account" | "venue_and_question" | "venue" | "consumer" | "feature" | "job"

export type SwitchMechanism =
  "app_ui" | "admin_rpc" | "env_var" | "schedule" | "reviewed_sql"

export type SwitchDefinition = {
  id: string
  title: string
  scope: SwitchScope
  mechanism: SwitchMechanism
  /** How to turn it off, in operator terms. */
  howToTurnOff: string
  /** What turning it off stops. */
  stops: string
  /** What keeps working while it is off. */
  keepsRunning: string
  /** How to turn it back on, and what that restores. */
  restore: string
  operatorRole: OwnerRole
  /** Needs the owner's approval because it changes production configuration (X1). */
  ownerGated: boolean
  /** A file and an exact string in it that prove the switch exists. */
  source: { file: string; contains: string }
}

const ENV_NOTE =
  "An environment change in Vercel takes effect on the next deployment."

export const SWITCHES: readonly SwitchDefinition[] = [
  {
    id: "SW-01",
    title: "Knowledge working list (per venue and question)",
    scope: "venue_and_question",
    mechanism: "admin_rpc",
    howToTurnOff:
      "An admin calls public.knowledge_set_working_list(venue, keys, false, reason) for the affected keys.",
    stops:
      "Knowledge sends and adoption on those questions at that venue. The internal reader answers 404 for a venue with no question in scope.",
    keepsRunning:
      "Every contribution, decision and adopted submission is kept. Staff fall back to the existing amenity list, and non-adopting decisions stay possible.",
    restore:
      "Enable the keys again. Pending disputes come back at once, judged against the answer current then.",
    operatorRole: "OPS",
    ownerGated: false,
    source: {
      file: "supabase/migrations/20261109145934_knowledge_b01_functions.sql",
      contains: "create function public.knowledge_set_working_list(",
    },
  },
  {
    id: "SW-02",
    title: "Internal reader (whole service)",
    scope: "feature",
    mechanism: "env_var",
    howToTurnOff: `Set KNOWLEDGE_READER_ENABLED to anything other than true. ${ENV_NOTE}`,
    stops: "Every internal reader request (the route reports it disabled).",
    keepsRunning:
      "All capture, review and staff screens. No knowledge data changes.",
    restore: "Set KNOWLEDGE_READER_ENABLED=true and redeploy.",
    operatorRole: "WS5",
    ownerGated: true,
    source: {
      file: "app/api/knowledge/_reader/credentials.ts",
      contains: 'env.KNOWLEDGE_READER_ENABLED !== "true"',
    },
  },
  {
    id: "SW-03",
    title: "One internal reader consumer",
    scope: "consumer",
    mechanism: "env_var",
    howToTurnOff: `Set "disabled": true on the consumer in KNOWLEDGE_READER_CONSUMERS. ${ENV_NOTE}`,
    stops: "Reads with that consumer's credentials (401).",
    keepsRunning: "Every other consumer and the whole app.",
    restore: "Set disabled back to false, or rotate to a new credential.",
    operatorRole: "WS5",
    ownerGated: true,
    source: {
      file: "app/api/knowledge/_reader/credentials.ts",
      contains: "disabled: boolean",
    },
  },
  {
    id: "SW-04",
    title: "Staff Home layout (B02 or B01)",
    scope: "venue",
    mechanism: "env_var",
    howToTurnOff: `Add the venue id to NABALENS_HOME_LAYOUT_B01_VENUES, or set NABALENS_HOME_LAYOUT=b01 for everyone. ${ENV_NOTE}`,
    stops: "The B02 Home (To do) for that venue; the B01 Home shows instead.",
    keepsRunning:
      "All data and URLs; the same work is reachable from the B01 Home.",
    restore: "Remove the venue id, or unset the variable (default b02).",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "lib/config/home-layout.ts",
      contains: "process.env.NABALENS_HOME_LAYOUT_B01_VENUES",
    },
  },
  {
    id: "SW-05",
    title: "Shared Add entry (B02 or B01)",
    scope: "venue",
    mechanism: "env_var",
    howToTurnOff: `Add the venue id to NABALENS_CONTRIBUTION_ENTRY_B01_VENUES, or set NABALENS_CONTRIBUTION_ENTRY=b01 for everyone. ${ENV_NOTE}`,
    stops:
      "The B02 intent step, context strip and Home's Answer a venue question at that venue.",
    keepsRunning: "The B01 Add sheet and every capture path.",
    restore: "Remove the venue id, or unset the variable (default b02).",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "lib/config/contribution-entry.ts",
      contains: "process.env.NABALENS_CONTRIBUTION_ENTRY_B01_VENUES",
    },
  },
  {
    id: "SW-06",
    title: "Manager triage (B02 or B01)",
    scope: "feature",
    mechanism: "env_var",
    howToTurnOff: `Set NABALENS_MANAGER_TRIAGE=b01. ${ENV_NOTE}`,
    stops:
      "The Triage card, the To confirm badge and the kind filter on /manager/review.",
    keepsRunning: "The B01 overviews and Review page; every decision path.",
    restore: "Unset the variable (default b02).",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "lib/config/manager-triage.ts",
      contains: "process.env.NABALENS_MANAGER_TRIAGE",
    },
  },
  {
    id: "SW-07",
    title: "My contributions (B02 or B01)",
    scope: "feature",
    mechanism: "env_var",
    howToTurnOff: `Set NABALENS_MY_CONTRIBUTIONS=b01. ${ENV_NOTE}`,
    stops: "The My contributions list on Me.",
    keepsRunning: "B01's Your findings list; no contribution changes.",
    restore: "Unset the variable (default b02).",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "lib/config/my-contributions.ts",
      contains: "process.env.NABALENS_MY_CONTRIBUTIONS",
    },
  },
  {
    id: "SW-08",
    title: "Cleanup job schedule",
    scope: "job",
    mechanism: "schedule",
    howToTurnOff:
      "Remove the /api/internal/cleanup entry from vercel.json crons (a reviewed change and deploy).",
    stops:
      "Hourly abandoned-upload and removed-asset cleanup; M-JB-1 then breaches.",
    keepsRunning:
      "Uploads and removals in the app; removed assets stay hidden while their bytes wait.",
    restore:
      "Restore the cron entry, or POST the route once with the bearer; a rerun is idempotent.",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "vercel.json",
      contains: '"path": "/api/internal/cleanup"',
    },
  },
  {
    id: "SW-09",
    title: "Media archive job schedule",
    scope: "job",
    mechanism: "schedule",
    howToTurnOff:
      "Remove the /api/internal/media-archive entry from vercel.json crons (a reviewed change and deploy).",
    stops:
      "Copying new originals to the archive; the archive checker then reports stale.",
    keepsRunning: "Every app path; originals stay in Storage.",
    restore:
      "Restore the cron entry; the next run copies what was missed. Never delete originals to catch up.",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "vercel.json",
      contains: '"path": "/api/internal/media-archive"',
    },
  },
  {
    id: "SW-10",
    title: "Archive watchdog schedule",
    scope: "job",
    mechanism: "schedule",
    howToTurnOff:
      "Remove the /api/internal/archive-monitor/watchdog entry from vercel.json crons (a reviewed change and deploy).",
    stops:
      "The in-app dead-man check of the independent archive monitor; its own state is kept.",
    keepsRunning: "The archive job and the independent checker.",
    restore: "Restore the cron entry.",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "vercel.json",
      contains: '"path": "/api/internal/archive-monitor/watchdog"',
    },
  },
  {
    id: "SW-11",
    title: "Monthly coverage preparation schedule",
    scope: "job",
    mechanism: "schedule",
    howToTurnOff:
      "Remove the /api/internal/coverage/monthly-preparation entry from vercel.json crons (a reviewed change and deploy).",
    stops:
      "Hourly copying of targets and checklist candidates into the new month.",
    keepsRunning:
      "Existing targets and credit; managers and admins can still run Prepare this month.",
    restore:
      "Restore the cron entry, or use Prepare this month for all venues; a rerun never duplicates targets.",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "vercel.json",
      contains: '"path": "/api/internal/coverage/monthly-preparation"',
    },
  },
  {
    id: "SW-12",
    title: "One staff account",
    scope: "account",
    mechanism: "app_ui",
    howToTurnOff:
      "A different active admin uses Deactivate in Staff (/admin/staff) and confirms it in the named-person dialog.",
    stops:
      "Every new protected operation for that account, including from an open session; ends its venue-manager grant and closes its open coverage assignments.",
    keepsRunning:
      "The account's media and history, readable by authorised admins and the venue's manager.",
    restore:
      "Reactivate in Staff once the cause is resolved. A manager grant is not restored: grant it again if still right.",
    operatorRole: "OPS",
    ownerGated: false,
    source: {
      file: "lib/server/accounts/manage.ts",
      contains: "export async function setStaffActive(",
    },
  },
  {
    id: "SW-13",
    title: "One venue-manager grant",
    scope: "account",
    mechanism: "app_ui",
    howToTurnOff:
      "An admin revokes the grant under Coverage, Venue managers, with a reason (public.revoke_venue_manager).",
    stops:
      "That staff member's manager tools at that venue (review, To confirm, targets).",
    keepsRunning:
      "Their staff access, their history, and every decision they made.",
    restore: "Grant it again with a reason.",
    operatorRole: "OPS",
    ownerGated: false,
    source: {
      file: "supabase/migrations/20261102130000_venue_manager_grants.sql",
      contains: "create function public.revoke_venue_manager(",
    },
  },
  {
    id: "SW-14",
    title: "Coverage access withdrawal",
    scope: "feature",
    mechanism: "reviewed_sql",
    howToTurnOff:
      "Rehearse with node tests/migrations/run.mjs <stack> withdraw, then an authorised operator runs tests/migrations/coverage-withdraw-access.sql in one transaction and the schedule is removed (docs/operations.md, Withdrawing coverage access).",
    stops:
      "Signed-in access to every coverage function and table, and the scheduled preparation.",
    keepsRunning:
      "Targets, photos sent, decisions, audit events, media, archive and monitoring are kept.",
    restore:
      "Re-run the grant statements of migrations 20261102130000 to 20261102150000 as a reviewed change.",
    operatorRole: "OPS",
    ownerGated: true,
    source: {
      file: "tests/migrations/coverage-withdraw-access.sql",
      contains: "revoke",
    },
  },
]

/**
 * Settings that look like switches but are one-way. Runbooks must not name
 * them as a way to stop harm.
 */
export const ONE_WAY_SETTINGS: readonly {
  title: string
  why: string
  source: { file: string; contains: string }
}[] = [
  {
    title: "Amenities enabled for a venue (venue_amenity_settings)",
    why: "The table is append-only (a trigger refuses update and delete), so enabling is permanent. Use SW-01 to narrow knowledge questions instead.",
    source: {
      file: "supabase/migrations/20261107120000_amenity_catalogue.sql",
      contains: "create trigger venue_amenity_settings_append_only",
    },
  },
]

export function switchById(id: string): SwitchDefinition | undefined {
  return SWITCHES.find((s) => s.id === id)
}
