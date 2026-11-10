/**
 * B10-01 operational metric registry (programme contract b10-design §3.4).
 * Each entry is one dashboard metric: what it measures, where its number comes
 * from, which release provides that source, the owner's proposed threshold
 * (OD-B10-1) and the accountable role.
 *
 * Nothing here reads a database. A metric whose source is not released in the
 * environment being read is reported as not available, never as 0.
 */

export const SOURCE_BATCHES = [
  "main",
  "B01",
  "B02",
  "B03",
  "B04",
  "B05",
  "B06",
  "B07",
  "B08",
  "B09",
  "B10",
  "log_source",
] as const
export type SourceBatch = (typeof SOURCE_BATCHES)[number]

/**
 * Released in production on 9 Nov 2026: main at f8c49430, migrations through
 * 20261109120000. Every later batch reads as not released until a deploy
 * readback says otherwise.
 */
export const BASELINE_RELEASED: readonly SourceBatch[] = ["main"]

export const OWNER_ROLES = [
  "OPS",
  "PO",
  "VM",
  "COORD",
  "WS1",
  "WS2",
  "WS3",
  "WS4",
  "WS5",
  "WS6",
  "B09",
] as const
export type OwnerRole = (typeof OWNER_ROLES)[number]

export const METRIC_FAMILIES = [
  "jobs",
  "uploads",
  "knowledge",
  "review",
  "delivery",
  "ai",
  "adoption",
] as const
export type MetricFamily = (typeof METRIC_FAMILIES)[number]

export const METRIC_UNITS = [
  "count",
  "intervals",
  "runs",
  "percent",
  "minutes",
  "hours",
  "days",
] as const
export type MetricUnit = (typeof METRIC_UNITS)[number]

export type MetricThreshold = {
  /** The proposed rule in words, as the owner will confirm it. */
  text: string
  /** Limits on the headline value. A value strictly beyond a limit trips it. */
  warnAbove?: number
  breachAbove?: number
  warnBelow?: number
  breachBelow?: number
  /** Fewer observations than this reads as not measured. */
  minimumSample?: number
}

export type MetricSource = {
  kind: "sql" | "function" | "route" | "log" | "manual" | "receipts"
  ref: string
}

export type MetricDefinition = {
  id: string
  family: MetricFamily
  title: string
  definition: string
  /** The single number a threshold applies to. */
  headline: string
  unit: MetricUnit
  window: string
  source: MetricSource
  /** The batch whose release makes the whole metric computable. */
  availableFrom: SourceBatch
  /** Parts computable before `availableFrom` is released. */
  partial?: readonly { from: SourceBatch; scope: string }[]
  /** Further batches the metric needs besides `availableFrom`. */
  alsoNeeds?: readonly SourceBatch[]
  /** Owner decisions or external dependencies that shape it (never inferred). */
  ownerInputs?: readonly string[]
  owners: readonly OwnerRole[]
  threshold: MetricThreshold | null
  runbooks: readonly string[]
}

export const METRICS: readonly MetricDefinition[] = [
  // Jobs
  {
    id: "M-JB-1",
    family: "jobs",
    title: "Job heartbeat",
    definition:
      "Per scheduled job, time since its last ok row in ops_job_runs, in expected intervals. Intervals from vercel.json: cleanup hourly at :17, media-archive every 10 min, archive watchdog every 5 min, monthly preparation hourly at :07. Later jobs join as they ship: knowledge rechecks through public.knowledge_run_rechecks() once OD-15 enables freshness, B08 month close and its daily drift check, menu rechecks, media_use_sweep, media-derivatives, the delivery worker and any enabled AI runner.",
    headline: "Expected intervals since the last ok run",
    unit: "intervals",
    window: "Rolling",
    source: { kind: "sql", ref: "private.ops_job_runs (B10-m1)" },
    availableFrom: "B10",
    owners: ["OPS"],
    threshold: {
      text: "Breach after 2 expected intervals without an ok run",
      breachAbove: 2,
    },
    runbooks: ["RB-06"],
  },
  {
    id: "M-JB-2",
    family: "jobs",
    title: "Job failures",
    definition:
      "Per job, failed or partial rows in ops_job_runs in 24 h and the current run of consecutive failures. coverage_preparation_runs.error_code and media_archive_audit_runs hold the detail for their jobs.",
    headline: "Consecutive failed or partial runs",
    unit: "runs",
    window: "24 h",
    source: { kind: "sql", ref: "private.ops_job_runs (B10-m1)" },
    availableFrom: "B10",
    owners: ["OPS"],
    threshold: {
      text: "Any failure: warning; 3 in a row: breach",
      warnAbove: 0,
      breachAbove: 2,
    },
    runbooks: ["RB-06"],
  },
  {
    id: "M-JB-3",
    family: "jobs",
    title: "Monthly preparation",
    definition:
      "A successful coverage_preparation_runs row for the current London month, and the venues still missing targets (docs/operations.md, Coverage preparation).",
    headline: "Venues missing targets after the 2nd of the month",
    unit: "count",
    window: "Current London month",
    source: { kind: "sql", ref: "public.coverage_preparation_runs" },
    availableFrom: "main",
    owners: ["OPS"],
    threshold: {
      text: "No success by the 2nd of the month, or any venue missing: breach",
      breachAbove: 0,
    },
    runbooks: ["RB-06"],
  },
  {
    id: "M-JB-4",
    family: "jobs",
    title: "Archive health",
    definition:
      "The status the independent checker reads from /api/internal/media-archive/status (ok, missing_originals, cycle age).",
    headline: "Archive checker alert state",
    unit: "count",
    window: "As the checker runs",
    source: { kind: "route", ref: "/api/internal/media-archive/status" },
    availableFrom: "main",
    owners: ["OPS"],
    threshold: {
      text: "As docs/archive-monitoring.md (stale, missing_originals, run_failed, cycle_slow, not_running, unreachable, auth_rejected, monitor_error)",
    },
    runbooks: ["RB-11"],
  },
  {
    id: "M-JB-5",
    family: "jobs",
    title: "Month close",
    definition:
      "For the previous London month, a close row in private.scoring_month_snapshots for every participant of every venue, written by private.scoring_close_month(p_month) (B08 §5.6), and the participants still missing one.",
    headline: "Participants without a close snapshot after the 3rd",
    unit: "count",
    window: "Previous London month",
    source: { kind: "sql", ref: "private.scoring_month_snapshots (B08)" },
    availableFrom: "B08",
    owners: ["WS3"],
    threshold: {
      text: "Any participant missing after the 3rd of the month: breach",
      breachAbove: 0,
    },
    runbooks: ["RB-16"],
  },
  {
    id: "M-JB-6",
    family: "jobs",
    title: "Snapshot drift",
    definition:
      "Differences B08's daily check reports between live results and the close snapshots of closed months, by venue and named cause (for example a deleted profile). Differences on the legacy accepted_photos basis are expected and shown labelled.",
    headline: "Unexpected differences",
    unit: "count",
    window: "Closed months",
    source: { kind: "function", ref: "B08 daily drift check (B08 §5.6)" },
    availableFrom: "B08",
    owners: ["WS3", "OPS"],
    threshold: {
      text: "Any unexpected difference: breach; counts never change",
      breachAbove: 0,
    },
    runbooks: ["RB-16"],
  },
  // Uploads and finalisation
  {
    id: "M-UP-1",
    family: "uploads",
    title: "Upload states",
    definition:
      "count(*) from media_assets where deleted_at is null, by venue and upload_state (uploading, processing, ready, failed).",
    headline: "Assets by state",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "public.media_assets" },
    availableFrom: "main",
    owners: ["WS4"],
    threshold: null,
    runbooks: [],
  },
  {
    id: "M-UP-2",
    family: "uploads",
    title: "Stuck processing",
    definition:
      "Assets with upload_state = 'processing' and updated_at older than 30 min (MEDIA_LIMITS.staleProcessingMinutes). The cleanup run's stale-processing step should keep this at 0.",
    headline: "Consecutive cleanup runs that left a stuck asset",
    unit: "runs",
    window: "Now",
    source: { kind: "sql", ref: "public.media_assets" },
    availableFrom: "main",
    owners: ["WS4"],
    threshold: {
      text: "Above 0 for 2 cleanup cycles: breach",
      breachAbove: 1,
    },
    runbooks: ["RB-02"],
  },
  {
    id: "M-UP-3",
    family: "uploads",
    title: "Abandoned reservations",
    definition:
      "Assets with upload_state = 'uploading' and updated_at older than 26 h: the 24 h abandoned window (MEDIA_LIMITS.abandonedUploadWindowHours) plus two cleanup cycles.",
    headline: "Reservations past the window",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "public.media_assets" },
    availableFrom: "main",
    owners: ["WS4"],
    threshold: {
      text: "Above 0: breach (cleanup not running)",
      breachAbove: 0,
    },
    runbooks: ["RB-06"],
  },
  {
    id: "M-UP-4",
    family: "uploads",
    title: "Failed uploads",
    definition:
      "Assets that reached failed in 24 h, by venue, and their share of all assets finalised in 24 h. The database records no failure reason; reasons are M-UP-7.",
    headline: "Failed share of finalised assets for a venue",
    unit: "percent",
    window: "24 h",
    source: { kind: "sql", ref: "public.media_assets" },
    availableFrom: "main",
    owners: ["WS4"],
    threshold: {
      text: "Above 5% of finalised for a venue: warning",
      warnAbove: 5,
    },
    runbooks: ["RB-01"],
  },
  {
    id: "M-UP-5",
    family: "uploads",
    title: "Pending physical deletions",
    definition:
      "Tombstoned assets whose storage objects still exist (the read-only query in docs/operations.md, Routine checks).",
    headline: "Pending deletions older than 24 h",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "public.media_assets with storage.objects" },
    availableFrom: "main",
    owners: ["WS4"],
    threshold: { text: "Any older than 24 h: warning", warnAbove: 0 },
    runbooks: ["RB-03"],
  },
  {
    id: "M-UP-6",
    family: "uploads",
    title: "Labels needing attention",
    definition:
      "media_pending_labels rows with status = 'needs_attention' by venue, with the oldest updated_at; pending rows older than 30 min.",
    headline: "needs_attention rows older than 7 days",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "public.media_pending_labels" },
    availableFrom: "main",
    owners: ["WS4"],
    threshold: {
      text: "Any needs_attention older than 7 days: warning",
      warnAbove: 0,
    },
    runbooks: [],
  },
  {
    id: "M-UP-7",
    family: "uploads",
    title: "Upload failure reasons",
    definition:
      "Counts by finalise error code from runtime logs. Not measured until a log source exists (OD-B10-4).",
    headline: "Failures by code",
    unit: "count",
    window: "24 h",
    source: { kind: "log", ref: "Finalise runtime logs (B10-01f)" },
    availableFrom: "log_source",
    ownerInputs: ["OD-B10-4"],
    owners: ["WS4"],
    threshold: null,
    runbooks: ["RB-01"],
  },
  // Knowledge
  {
    id: "M-KN-1",
    family: "knowledge",
    title: "Answer status",
    definition:
      "For each open knowledge_working_list row, status, reason and detail from private.knowledge_slot_state_b03(p_venue_id, p_keys, p_now). Counted as available, or by the exact unavailable (reason, detail) pair from the reader's closed table (b10-design §3.4a). A qualified answer is never available. A pair outside the table is a contract breach, never added to another count.",
    headline: "Contract breaches",
    unit: "count",
    window: "Now",
    source: {
      kind: "function",
      ref: "private.knowledge_slot_state_b03 (B03 7434cca5)",
    },
    availableFrom: "B03",
    owners: ["WS1"],
    threshold: {
      text: "Any contract breach: breach. Otherwise information; feeds wave exits",
      breachAbove: 0,
    },
    runbooks: ["RB-05"],
  },
  {
    id: "M-KN-2",
    family: "knowledge",
    title: "Couldn't establish",
    definition:
      "Slots whose latest finding was Couldn't establish (last_unknown_at set in the B03 view), by venue and last_unknown_preset, with the age since last_unknown_at.",
    headline: "Slots with a Couldn't establish finding",
    unit: "count",
    window: "Now",
    source: {
      kind: "function",
      ref: "private.knowledge_slot_state_b03 (B03 7434cca5)",
    },
    availableFrom: "B03",
    owners: ["WS1"],
    threshold: null,
    runbooks: [],
  },
  {
    id: "M-KN-3",
    family: "knowledge",
    title: "Stale knowledge",
    definition:
      "Per venue and use, the B03 view's freshness entries { use, state, nextCheckDue, basis, basisDate, policyId?, policyVersion? }, read with the registry version and policy in force at p_now, counted by state (current, due_soon, expired, basis_missing, unrated) and split by policy version. unrated is shown apart; an unknown state is a contract breach.",
    headline:
      "expired or basis_missing entries for a live use, plus contract breaches",
    unit: "count",
    window: "Now",
    source: {
      kind: "function",
      ref: "private.knowledge_slot_state_b03 freshness (B03-e)",
    },
    availableFrom: "B03",
    ownerInputs: ["OD-15"],
    owners: ["WS1"],
    threshold: {
      text: "Any expired or basis_missing for a use with a live consumer, or any contract breach: breach",
      breachAbove: 0,
    },
    runbooks: ["RB-04"],
  },
  {
    id: "M-KN-4",
    family: "knowledge",
    title: "Open rechecks",
    definition:
      "knowledge_recheck_tasks with state = 'open', by venue, use and cause, with the oldest created_at; menu rechecks from B04's menu_open_rechecks source. The knowledge job's entry is public.knowledge_run_rechecks().",
    headline: "Open rechecks past the policy's grace",
    unit: "count",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.knowledge_recheck_tasks (B03-e); B04 menu rechecks",
    },
    availableFrom: "B04",
    partial: [{ from: "B03", scope: "knowledge rechecks" }],
    ownerInputs: ["OD-15"],
    owners: ["WS1", "WS3"],
    threshold: {
      text: "Oldest above the policy's grace (OD-15): breach",
      breachAbove: 0,
    },
    runbooks: ["RB-04"],
  },
  {
    id: "M-KN-5",
    family: "knowledge",
    title: "Reconciliation outstanding",
    definition:
      "B03-06 reconciliation runs whose conflicting proposals are still undecided, by venue and age.",
    headline: "Days the oldest undecided conflict has waited",
    unit: "days",
    window: "Now",
    source: { kind: "sql", ref: "B03-f reconciliation runs" },
    availableFrom: "B03",
    owners: ["WS1"],
    threshold: { text: "Older than 14 days: warning", warnAbove: 14 },
    runbooks: ["RB-05"],
  },
  {
    id: "M-KN-6",
    family: "knowledge",
    title: "Working-list scope",
    definition:
      "Open working-list rows per venue compared with the onboarding record's selected question set.",
    headline: "Keys that differ between record and system",
    unit: "count",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.knowledge_working_list with the onboarding record",
    },
    availableFrom: "B01",
    alsoNeeds: ["B10"],
    owners: ["PO"],
    threshold: { text: "A difference: warning", warnAbove: 0 },
    runbooks: [],
  },
  // Review age
  {
    id: "M-RV-1",
    family: "review",
    title: "To confirm",
    definition:
      "knowledge_contributions with initial_outcome = 'awaiting_confirmation' and no terminal knowledge_decisions row: count, median and maximum age by venue.",
    headline: "Days the oldest waiting finding has waited",
    unit: "days",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.knowledge_contributions, public.knowledge_decisions",
    },
    availableFrom: "B01",
    owners: ["VM", "OPS"],
    threshold: {
      text: "Any older than 7 days: warning; 14 days: breach",
      warnAbove: 7,
      breachAbove: 14,
    },
    runbooks: ["RB-05"],
  },
  {
    id: "M-RV-2",
    family: "review",
    title: "Menu photo review",
    definition:
      "The pending set B02's manager triage counts (labelled photos with no decision, or needs_recheck), by venue, with the oldest.",
    headline: "Days the oldest waiting photo has waited",
    unit: "days",
    window: "Now",
    source: { kind: "function", ref: "B02 manager triage summary" },
    availableFrom: "B02",
    owners: ["VM", "WS3"],
    threshold: { text: "Oldest above 7 days: warning", warnAbove: 7 },
    runbooks: [],
  },
  {
    id: "M-RV-3",
    family: "review",
    title: "Legacy coverage review",
    definition:
      "Coverage submissions in the submitted state, by venue, with the oldest.",
    headline: "Days the oldest submission has waited",
    unit: "days",
    window: "Now",
    source: {
      kind: "sql",
      ref: "Legacy coverage submissions (state submitted)",
    },
    availableFrom: "main",
    owners: ["VM"],
    threshold: { text: "Oldest above 7 days: warning", warnAbove: 7 },
    runbooks: [],
  },
  {
    id: "M-RV-4",
    family: "review",
    title: "Menu values and imports awaiting a decision",
    definition:
      "B04 trading values waiting for a decision and B04-05 import runs waiting for sign-off, by venue, with the oldest.",
    headline: "Days the oldest has waited",
    unit: "days",
    window: "Now",
    source: { kind: "sql", ref: "B04 trading assertions and import runs" },
    availableFrom: "B04",
    owners: ["WS3", "PO"],
    threshold: { text: "Oldest above 14 days: warning", warnAbove: 14 },
    runbooks: [],
  },
  {
    id: "M-RV-5",
    family: "review",
    title: "Corrections awaiting owner sign-off",
    definition:
      "B08 correction previews (private.scoring_preview_runs with kind = 'correction') with no applied scoring_corrections row, by venue and age; split into waiting for the owner and signed off but not applied. A changed preview refuses to apply (scoring_preview_stale).",
    headline: "Days the oldest correction preview has waited",
    unit: "days",
    window: "Now",
    source: {
      kind: "sql",
      ref: "private.scoring_preview_runs, private.scoring_corrections (B08)",
    },
    availableFrom: "B08",
    owners: ["PO", "WS3"],
    threshold: { text: "Older than 14 days: warning", warnAbove: 14 },
    runbooks: ["RB-16"],
  },
  // Delivery and withdrawals
  {
    id: "M-DL-1",
    family: "delivery",
    title: "Revision lag",
    definition:
      "Per destination and kind, desired_revision against attempted, acknowledged and verified (media_use_deliveries from B05-m3; knowledge delivery records from B06-03), and the rows where acknowledged is behind desired.",
    headline: "Minutes the oldest lagging row has been behind",
    unit: "minutes",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.media_use_deliveries (B05); B06-03 delivery records",
    },
    availableFrom: "B06",
    partial: [{ from: "B05", scope: "media deliveries" }],
    owners: ["WS5"],
    threshold: { text: "Behind for more than 15 min: warning", warnAbove: 15 },
    runbooks: ["RB-08"],
  },
  {
    id: "M-DL-2",
    family: "delivery",
    title: "Propagation time",
    definition:
      "p50 and p95 time from desired to acknowledged and to verified, per destination, from the delivery event log.",
    headline: "p95 minutes from desired to verified for withdrawals",
    unit: "minutes",
    window: "7 days",
    source: {
      kind: "sql",
      ref: "media_use_delivery_events (B05); B06-03 delivery events",
    },
    availableFrom: "B06",
    partial: [{ from: "B05", scope: "media deliveries" }],
    owners: ["WS5"],
    threshold: {
      text: "p95 to verified above 5 min for withdrawals: breach (plan §17 objective)",
      breachAbove: 5,
    },
    runbooks: ["RB-09"],
  },
  {
    id: "M-DL-3",
    family: "delivery",
    title: "Delivery errors",
    definition:
      "Rows with last_error set and their consecutive failed attempts, per destination.",
    headline: "Consecutive failed attempts",
    unit: "runs",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.media_use_deliveries (B05); B06-03 delivery records",
    },
    availableFrom: "B06",
    partial: [{ from: "B05", scope: "media deliveries" }],
    owners: ["WS5"],
    threshold: { text: "3 consecutive failures: breach", breachAbove: 2 },
    runbooks: ["RB-08"],
  },
  {
    id: "M-DL-4",
    family: "delivery",
    title: "Derivative jobs",
    definition:
      "media_derivative_jobs queue depth, oldest due, failed and poisoned counts.",
    headline: "Poisoned jobs",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "public.media_derivative_jobs (B05-m2)" },
    availableFrom: "B05",
    owners: ["WS4"],
    threshold: { text: "Poisoned above 0: warning", warnAbove: 0 },
    runbooks: ["RB-08"],
  },
  {
    id: "M-DL-5",
    family: "delivery",
    title: "Live readback age",
    definition:
      "Time since the last verified revision per destination, and destinations never verified.",
    headline:
      "Hours since the last verified revision of an enabled destination",
    unit: "hours",
    window: "Now",
    source: { kind: "sql", ref: "B06-03 delivery records; B10-07 readbacks" },
    availableFrom: "B06",
    alsoNeeds: ["B10"],
    owners: ["WS5"],
    threshold: {
      text: "Above 24 h for an enabled destination: warning",
      warnAbove: 24,
    },
    runbooks: ["RB-08"],
  },
  {
    id: "M-DL-6",
    family: "delivery",
    title: "Reader requests",
    definition:
      "Per consumer and hour, requests and 401, 403, 404, 429 and 503 counts from [knowledge-reader] log entries. Not measured until a log source exists (OD-B10-4).",
    headline: "5xx share of reader requests",
    unit: "percent",
    window: "1 h",
    source: { kind: "log", ref: "[knowledge-reader] runtime log entries" },
    availableFrom: "log_source",
    alsoNeeds: ["B01"],
    ownerInputs: ["OD-B10-4"],
    owners: ["WS5"],
    threshold: { text: "Any 5xx share above 1%: warning", warnAbove: 1 },
    runbooks: ["RB-07"],
  },
  {
    id: "M-DL-7",
    family: "delivery",
    title: "Credential expiry",
    definition:
      "Days until the last valid credential of each consumer expires: reader credentials from the registry expiresAt (90-day default), and B06 website credentials.",
    headline: "Days until a consumer's last valid credential expires",
    unit: "days",
    window: "Now",
    source: {
      kind: "manual",
      ref: "Reader consumer registry (B01); B06 consumer registry",
    },
    availableFrom: "B06",
    partial: [{ from: "B01", scope: "reader credentials" }],
    owners: ["WS5"],
    threshold: {
      text: "Under 14 days: warning; expired with no second credential: breach",
      warnBelow: 14,
      breachBelow: 0,
    },
    runbooks: ["RB-07"],
  },
  {
    id: "M-DL-8",
    family: "delivery",
    title: "NabaPresence states",
    definition:
      "Latest provider receipt per destination, venue, field key and publication revision, from knowledge_publication_events provider kinds written through POST /api/knowledge/v1/receipts (B07-05 §7.2). These mirror NabaPresence's suggestion statuses and closing states (B07 §7.1). Also the open source-withdrawn review items (B07 §7.3). NabaLens never queries NabaPresence's database.",
    headline:
      "Uncertain receipts past the confirmation window, failed receipts and source-withdrawn items older than 7 days",
    unit: "count",
    window: "Now",
    source: {
      kind: "receipts",
      ref: "knowledge_publication_events provider kinds (B07-05)",
    },
    availableFrom: "B07",
    ownerInputs: ["B07 draft 2 final receipt states", "X6"],
    owners: ["WS5"],
    threshold: {
      text: "Uncertain past the confirmation window, any failed, or a source-withdrawn item older than 7 days: warning",
      warnAbove: 0,
    },
    runbooks: ["RB-08"],
  },
  {
    id: "M-WD-1",
    family: "delivery",
    title: "Pending withdrawals",
    definition:
      "Rows with desired_state = 'withdrawn' and acknowledged_revision below desired_revision, with age.",
    headline: "Pending withdrawals older than 5 min",
    unit: "count",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.media_use_deliveries (B05); B06-03 delivery records",
    },
    availableFrom: "B06",
    partial: [{ from: "B05", scope: "media deliveries" }],
    owners: ["WS5"],
    threshold: { text: "Any older than 5 min: breach", breachAbove: 0 },
    runbooks: ["RB-09"],
  },
  {
    id: "M-WD-2",
    family: "delivery",
    title: "Withdrawals not verified",
    definition: "Withdrawals acknowledged but not live-verified, with age.",
    headline: "Unverified withdrawals older than 1 h",
    unit: "count",
    window: "Now",
    source: {
      kind: "sql",
      ref: "public.media_use_deliveries (B05); B06-03 delivery records",
    },
    availableFrom: "B06",
    partial: [{ from: "B05", scope: "media deliveries" }],
    owners: ["WS5"],
    threshold: { text: "Any older than 1 h: warning", warnAbove: 0 },
    runbooks: ["RB-09"],
  },
  {
    id: "M-WD-3",
    family: "delivery",
    title: "Knowledge corrections and withdrawals",
    definition:
      "B03-07 corrections and withdrawals in 7 days and their delivery state.",
    headline: "Not acknowledged after 5 min",
    unit: "count",
    window: "7 days",
    source: {
      kind: "sql",
      ref: "knowledge_decisions withdrawn (B03-g); B06-03 delivery records",
    },
    availableFrom: "B06",
    partial: [{ from: "B03", scope: "corrections and withdrawals recorded" }],
    owners: ["WS1", "WS5"],
    threshold: {
      text: "Any not acknowledged after 5 min: breach",
      breachAbove: 0,
    },
    runbooks: ["RB-09"],
  },
  {
    id: "M-WD-4",
    family: "delivery",
    title: "Evidence lost",
    definition:
      "knowledge_events of kind evidence_withdrawn and amenity_check_events of kind evidence_lost in 7 days, and the slots made unavailable.",
    headline: "Evidence losses",
    unit: "count",
    window: "7 days",
    source: {
      kind: "sql",
      ref: "public.knowledge_events (B01); public.amenity_check_events",
    },
    availableFrom: "B01",
    partial: [{ from: "main", scope: "amenity_check_events evidence_lost" }],
    owners: ["WS1"],
    threshold: null,
    runbooks: ["RB-10"],
  },
  {
    id: "M-WD-5",
    family: "delivery",
    title: "Replay refusals",
    definition:
      "Receipts ignored because their revision was lower than the stored one (media_use_delivery_events; the B06 equivalent). A rising count is investigated.",
    headline: "Ignored lower-revision receipts",
    unit: "count",
    window: "7 days",
    source: {
      kind: "sql",
      ref: "media_use_delivery_events (B05); B06-03 delivery events",
    },
    availableFrom: "B06",
    partial: [{ from: "B05", scope: "media deliveries" }],
    owners: ["WS5"],
    threshold: null,
    runbooks: ["RB-09"],
  },
  // AI (only where a B09 job is enabled)
  {
    id: "M-AI-1",
    family: "ai",
    title: "Spend",
    definition:
      "Spend today and this month against the ceiling, per job (B09-03 cost ledger). At the ceiling the job is already disabled (B09-06).",
    headline: "Share of a ceiling used",
    unit: "percent",
    window: "Day and month",
    source: { kind: "sql", ref: "B09-03 cost ledger" },
    availableFrom: "B09",
    ownerInputs: ["X5"],
    owners: ["B09"],
    threshold: { text: "80% of a ceiling: warning", warnAbove: 80 },
    runbooks: ["RB-14"],
  },
  {
    id: "M-AI-2",
    family: "ai",
    title: "Unknown billing outcomes",
    definition: "Attempts with an unreconciled provider outcome (B09-03).",
    headline: "Unreconciled attempts older than 24 h",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "B09-03 cost ledger" },
    availableFrom: "B09",
    ownerInputs: ["X5"],
    owners: ["B09"],
    threshold: { text: "Any older than 24 h: breach", breachAbove: 0 },
    runbooks: ["RB-14"],
  },
  {
    id: "M-AI-3",
    family: "ai",
    title: "Suggestions",
    definition:
      "Suggestions waiting for review and their age; accept, edit and reject rates per job (B09-04).",
    headline: "Suggestions waiting for review",
    unit: "count",
    window: "Now",
    source: { kind: "sql", ref: "B09-04 suggestions" },
    availableFrom: "B09",
    ownerInputs: ["X5"],
    owners: ["B09"],
    threshold: null,
    runbooks: [],
  },
  {
    id: "M-AI-4",
    family: "ai",
    title: "Limit hits and disables",
    definition: "Jobs stopped by limits or switches (B09-06).",
    headline: "Stopped jobs",
    unit: "count",
    window: "24 h",
    source: { kind: "sql", ref: "B09-06 limits and switches" },
    availableFrom: "B09",
    ownerInputs: ["X5"],
    owners: ["B09"],
    threshold: { text: "Any: warning", warnAbove: 0 },
    runbooks: ["RB-14"],
  },
  // Adoption
  {
    id: "M-AD-1",
    family: "adoption",
    title: "Contributions",
    definition:
      "Contributions per venue per day (knowledge_contributions plus labelled menu uploads) and the number of distinct contributors, never names.",
    headline: "Contributions per day",
    unit: "count",
    window: "Day",
    source: {
      kind: "sql",
      ref: "public.knowledge_contributions; labelled media_assets",
    },
    availableFrom: "B01",
    owners: ["PO"],
    threshold: null,
    runbooks: [],
  },
  {
    id: "M-AD-2",
    family: "adoption",
    title: "Zero-use venues",
    definition:
      "Enabled venues with no contribution in their observation window. Such a venue returns to onboarding review (plan §15).",
    headline: "Venues with no contribution in their window",
    unit: "count",
    window: "Observation window",
    source: {
      kind: "sql",
      ref: "public.knowledge_contributions with the B10-04 windows",
    },
    availableFrom: "B01",
    alsoNeeds: ["B10"],
    owners: ["PO"],
    threshold: {
      text: "Any: the venue returns to onboarding review",
      breachAbove: 0,
    },
    runbooks: [],
  },
  {
    id: "M-AD-3",
    family: "adoption",
    title: "Observed completion",
    definition:
      "Share of observed ordinary contribution attempts completed without implementer help, from the B10-04 observation log entered by the observer.",
    headline: "Completed without help, as a share of observed attempts",
    unit: "percent",
    window: "Observation window",
    source: { kind: "manual", ref: "B10-04 observation logs" },
    availableFrom: "B10",
    owners: ["PO"],
    threshold: {
      text: "Below 90% of at least 10 attempts: wave exit blocked (plan §17)",
      breachBelow: 90,
      minimumSample: 10,
    },
    runbooks: [],
  },
]

export type MetricAvailability = {
  status: "available" | "partial" | "unavailable"
  /** Every batch still missing for the whole metric. */
  missing: SourceBatch[]
}

export function metricAvailability(
  metric: MetricDefinition,
  released: readonly SourceBatch[]
): MetricAvailability {
  const has = (batch: SourceBatch) => released.includes(batch)
  const needed: SourceBatch[] = [
    metric.availableFrom,
    ...(metric.partial ?? []).map((p) => p.from),
    ...(metric.alsoNeeds ?? []),
  ]
  const missing = [...new Set(needed.filter((batch) => !has(batch)))]
  if (missing.length === 0) return { status: "available", missing }
  const partlyReady = (metric.partial ?? []).some(
    (p) => has(p.from) && (metric.alsoNeeds ?? []).every(has)
  )
  return { status: partlyReady ? "partial" : "unavailable", missing }
}

export type MetricState =
  "ok" | "warning" | "breach" | "not_available" | "not_measured"

export type MetricReading = { value: number; sample?: number }

export function evaluateMetric(
  metric: MetricDefinition,
  reading: MetricReading | null,
  released: readonly SourceBatch[]
): { state: MetricState; availability: MetricAvailability } {
  const availability = metricAvailability(metric, released)
  if (availability.status === "unavailable") {
    // A log-only metric is unmeasured rather than unavailable: its code exists,
    // the log source is the owner's decision (OD-B10-4).
    const onlyLog =
      availability.missing.length === 1 &&
      availability.missing[0] === "log_source"
    return { state: onlyLog ? "not_measured" : "not_available", availability }
  }
  const threshold = metric.threshold
  if (reading === null || !Number.isFinite(reading.value))
    return { state: "not_measured", availability }
  if (
    threshold?.minimumSample !== undefined &&
    (reading.sample ?? 0) < threshold.minimumSample
  )
    return { state: "not_measured", availability }
  if (!threshold) return { state: "ok", availability }
  const { value } = reading
  const beyond = (above?: number, below?: number) =>
    (above !== undefined && value > above) ||
    (below !== undefined && value < below)
  if (beyond(threshold.breachAbove, threshold.breachBelow))
    return { state: "breach", availability }
  if (beyond(threshold.warnAbove, threshold.warnBelow))
    return { state: "warning", availability }
  return { state: "ok", availability }
}

export function metricById(id: string): MetricDefinition | undefined {
  return METRICS.find((metric) => metric.id === id)
}
