/**
 * B10-02 runbook index (b10-design §4.3 and §14.4). Each entry carries the
 * fields plan §19 requires of a release runbook, plus its recovery drill. A
 * drill runs only on an owned isolated stack; until it has run it stays
 * not_exercised, and a drill that waits for a batch names it.
 */

import type { OwnerRole, SourceBatch } from "./metrics"

export type RunbookReadiness = "ready_on_main" | "partly_ready" | "waiting"

export type RunbookDefinition = {
  id: string
  title: string
  /** Metric IDs whose threshold leads here; empty for incident-only runbooks. */
  triggerMetrics: readonly string[]
  /** What else starts it (a report, an incident). */
  otherTriggers: readonly string[]
  operatorRole: OwnerRole
  firstChecks: string
  steps: string
  narrowestSwitch: string
  dataImplications: string
  pendingDelivery: string
  readbackProof: string
  drill: {
    description: string
    readiness: RunbookReadiness
    /** Batches or decisions the drill (or its waiting part) needs. */
    waitingFor: readonly (SourceBatch | string)[]
    status: "not_exercised"
  }
  evidencePath: string
}

const evidence = (id: string) => `evidence/b10-02/${id}/`
const NOT_EXERCISED = "not_exercised" as const
const NO_DELIVERY = "No consumer delivery is involved."

export const RUNBOOKS: readonly RunbookDefinition[] = [
  {
    id: "RB-01",
    title: "Failed or incomplete upload",
    triggerMetrics: ["M-UP-4", "M-UP-7"],
    otherTriggers: ["A staff report"],
    operatorRole: "OPS",
    firstChecks:
      "Ask for the file name, time and visible error, never the media or a sign-in link. Check the per-file status and private server logs.",
    steps:
      "Retry the same file with the same key. Never re-upload files that already succeeded. Investigate repeated decoder_busy, timeout, corrupt-content or Storage failures rather than weakening validation.",
    narrowestSwitch: "None: handled per file",
    dataImplications:
      "The same key reuses the same asset; no row is deleted by hand.",
    pendingDelivery: NO_DELIVERY,
    readbackProof:
      "The file reads ready once, with one asset and one contribution.",
    drill: {
      description:
        "An interrupted TUS transfer and a lost finalise response; expect one asset and one contribution (tests/integration/upload-recovery.test.ts cases as the base).",
      readiness: "ready_on_main",
      waitingFor: [],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-01"),
  },
  {
    id: "RB-02",
    title: "Stuck processing",
    triggerMetrics: ["M-UP-2"],
    otherTriggers: [],
    operatorRole: "OPS",
    firstChecks:
      "Confirm the cleanup job ran (M-JB-1) and the asset is older than the 30 min stale-processing limit.",
    steps:
      "Let cleanup mark the stale claim failed, then the uploader retries. Never mark an unvalidated asset ready.",
    narrowestSwitch: "None",
    dataImplications: "The asset reads failed until the retry succeeds.",
    pendingDelivery: NO_DELIVERY,
    readbackProof: "After the retry the asset reads ready.",
    drill: {
      description:
        "Seed a processing asset older than 30 min, run the cleanup route, expect failed, then a retry reaches ready.",
      readiness: "ready_on_main",
      waitingFor: [],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-02"),
  },
  {
    id: "RB-03",
    title: "Pending physical deletion",
    triggerMetrics: ["M-UP-5"],
    otherTriggers: [],
    operatorRole: "OPS",
    firstChecks:
      "Read the cleanup report and the tombstoned assets that still have storage objects.",
    steps:
      "Rerun cleanup and track storage failures. Never delete rows by hand or bypass Storage policies.",
    narrowestSwitch: "None",
    dataImplications:
      "The asset stays hidden; only its bytes wait for removal.",
    pendingDelivery: NO_DELIVERY,
    readbackProof: "The removal reads removed and no storage object is left.",
    drill: {
      description:
        "Inject a storage removal failure; expect pending, then removed after a retry.",
      readiness: "ready_on_main",
      waitingFor: [],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-03"),
  },
  {
    id: "RB-04",
    title: "Stale answers and overdue rechecks",
    triggerMetrics: ["M-KN-3", "M-KN-4"],
    otherTriggers: [],
    operatorRole: "OPS",
    firstChecks:
      "Check the recheck job heartbeat and that an open, owned recheck task exists for the slot and use.",
    steps:
      "The venue rechecks or reaffirms the answer; the task closes when the slot reads current again.",
    narrowestSwitch:
      "A question version with no freshness policy (B03 rollback)",
    dataImplications:
      "The previous answer is kept and shown to managers; consumers read it as stale.",
    pendingDelivery:
      "A stale answer is withheld by read-time rules; no delivery is paused.",
    readbackProof:
      "The reader returns the slot as available and current for the use.",
    drill: {
      description:
        "Freeze time past max_age with the job stopped: the reader reads stale/expired. Run the job twice: one task. Reaffirm: the task closes.",
      readiness: "waiting",
      waitingFor: ["B03", "OD-15 fixture policy"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-04"),
  },
  {
    id: "RB-05",
    title: "Conflicts and disputes",
    triggerMetrics: ["M-KN-1", "M-KN-5", "M-RV-1"],
    otherTriggers: [],
    operatorRole: "VM",
    firstChecks:
      "Open the slot in To confirm and read every finding listed in the dispute.",
    steps:
      "The confirming role decides; both histories stay readable. A contract breach in M-KN-1 goes to WS1 instead.",
    narrowestSwitch: "Remove the question from the venue's working list",
    dataImplications: "Both histories are kept; no finding is deleted.",
    pendingDelivery: "A disputed answer is withheld until decided.",
    readbackProof:
      "The slot reads available, or Couldn't establish, as decided.",
    drill: {
      description:
        "B01 J3 fixture: a dispute, then Use this answer and Keep the answer in use; both histories readable.",
      readiness: "waiting",
      waitingFor: ["B01", "B03"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-05"),
  },
  {
    id: "RB-06",
    title: "Missed or failing scheduled job",
    triggerMetrics: ["M-JB-1", "M-JB-2", "M-JB-3", "M-UP-3"],
    otherTriggers: [],
    operatorRole: "OPS",
    firstChecks:
      "Check the cron entry, the route's secret and the last ops_job_runs rows.",
    steps:
      "Call the route once with its bearer secret, then confirm a second call changes nothing.",
    narrowestSwitch: "Per job",
    dataImplications:
      "Jobs are idempotent; a rerun never doubles work or counts.",
    pendingDelivery:
      "Delivery jobs resume from their stored revisions; withdrawals are never skipped.",
    readbackProof: "A new ok heartbeat and M-JB-1 back to ok.",
    drill: {
      description:
        "For each job: skip its calls and see the heartbeat breach; call it once; call it twice and confirm nothing doubles. The four main crons are drillable now; each later job when it ships.",
      readiness: "ready_on_main",
      waitingFor: [],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-06"),
  },
  {
    id: "RB-07",
    title: "Expired or rotated credentials",
    triggerMetrics: ["M-DL-6", "M-DL-7"],
    otherTriggers: ["A spike of 401 answers"],
    operatorRole: "WS5",
    firstChecks:
      "Find which consumer or secret failed: a reader credential, CLEANUP_SECRET, the archive monitor secret or a B06 website credential.",
    steps:
      "Rotate with overlap (two active reader credentials), update the consumer, then revoke the old one. CLEANUP_SECRET stays at least 32 characters. NabaPresence Google connections follow NabaPresence's own runbook.",
    narrowestSwitch: "Disable one consumer (disabled: true)",
    dataImplications: "None: credentials hold no data.",
    pendingDelivery:
      "A consumer without a valid credential stops reading until updated; nothing is lost.",
    readbackProof: "The consumer's next read succeeds with the new credential.",
    drill: {
      description:
        "Rotate a fixture consumer with overlap and no failed reads; an expired credential returns 401 and the consumer recovers after the update. The cleanup and monitor secrets are drillable now.",
      readiness: "partly_ready",
      waitingFor: ["B01"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-07"),
  },
  {
    id: "RB-08",
    title: "Delivery failure or consumer outage",
    triggerMetrics: ["M-DL-1", "M-DL-3", "M-DL-4", "M-DL-5", "M-DL-8"],
    otherTriggers: [],
    operatorRole: "WS5",
    firstChecks:
      "Confirm retries are bounded and check the destination's own status.",
    steps:
      "The website serves its last good state or an explicit unavailable answer (B06-05); resume and verify. For NabaPresence an uncertain write is never re-sent: its recovery job reads back, and a retry is a person's new change set.",
    narrowestSwitch:
      "Pause publication per destination; withdrawals keep running",
    dataImplications: "Desired revisions are kept; nothing is re-created.",
    pendingDelivery:
      "Pending revisions deliver in order once the destination returns.",
    readbackProof: "The destination reaches acknowledged and verified.",
    drill: {
      description:
        "Take a fixture consumer down; observe lag and errors; bring it back; reach acknowledged and verified.",
      readiness: "waiting",
      waitingFor: ["B05", "B06"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-08"),
  },
  {
    id: "RB-09",
    title: "Withdrawal not applied in time",
    triggerMetrics: ["M-DL-2", "M-WD-1", "M-WD-2", "M-WD-3", "M-WD-5"],
    otherTriggers: [],
    operatorRole: "WS5",
    firstChecks: "Find the destination and revision that are behind.",
    steps:
      "Push the withdrawal, purge the cache and verify live. An older replay must not resurrect content.",
    narrowestSwitch: "None: withdrawal never pauses",
    dataImplications: "The tombstone is kept; it is never deleted.",
    pendingDelivery:
      "Withdrawals go first and are never held behind publication.",
    readbackProof:
      "The live destination no longer shows the withdrawn content.",
    drill: {
      description:
        "B05 §4.10 fx_menu_recheck_public_withdrawal plus a B06 tombstone replay; expect the replay refused.",
      readiness: "waiting",
      waitingFor: ["B05", "B06"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-09"),
  },
  {
    id: "RB-10",
    title: "Evidence removal",
    triggerMetrics: ["M-WD-4"],
    otherTriggers: ["A removal request"],
    operatorRole: "OPS",
    firstChecks:
      "Identify the asset and the answers it supports, without sharing the media.",
    steps:
      "Remove through the app, then check the four separate states: app removal, evidence lost, public withdrawal, archive retained (B05-04).",
    narrowestSwitch: "None",
    dataImplications:
      "The slot reads unavailable at once; the archive copy is recorded as retained.",
    pendingDelivery: "Any public use is withdrawn through RB-09's path.",
    readbackProof: "All four states read as expected.",
    drill: {
      description:
        "Delete an evidence asset: the slot reads unavailable, evidence_withdrawn is recorded, the use grant is withdrawn, the archive copy is recorded as retained.",
      readiness: "waiting",
      waitingFor: ["B01", "B05", "B06"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-10"),
  },
  {
    id: "RB-11",
    title: "Archive retention and archive alerts",
    triggerMetrics: ["M-JB-4"],
    otherTriggers: ["The independent archive checker"],
    operatorRole: "OPS",
    firstChecks: "Read the alert kind from the checker.",
    steps:
      "Follow the alert runbooks in docs/archive-monitoring.md. Retention periods are the owner's (B05 owner decisions).",
    narrowestSwitch: "The archive job",
    dataImplications: "Originals are never deleted by the runbook.",
    pendingDelivery: NO_DELIVERY,
    readbackProof: "The checker reports recovered.",
    drill: {
      description:
        "Reuse the tests/archive controlled failures on the owned stack.",
      readiness: "ready_on_main",
      waitingFor: [],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-11"),
  },
  {
    id: "RB-12",
    title: "Restore from backup",
    triggerMetrics: [],
    otherTriggers: ["A data-loss incident"],
    operatorRole: "OPS",
    firstChecks:
      "Choose the backup and an isolated restore target; disable consumers.",
    steps:
      "Restore, reapply B05's restore step, compare counts and recover a compatible reader. scripts/db/restore-local.sh loads with session_replication_role = replica, so no insert or update trigger fires: a partial, cross-version or re-import load into a B05 schema must set use_baseline itself and pass the B05 §2.4 check query (count 0, or the load aborts). Recheck every other trigger-maintained rule afterwards, including B08's drift check.",
    narrowestSwitch: "Disable all consumers until compared",
    dataImplications:
      "Rows created before the B05 cutover read legacy_unknown; grants are never copied.",
    pendingDelivery:
      "Delivery resumes only after counts compare; publication state is recomputed by its own job.",
    readbackProof: "Before and after counts match, and the reader answers.",
    drill: {
      description:
        "Full restore rehearsal on an owned stack with before and after counts. The replica-mode partial loads (one failing and one passing the B05 check) need B05-m1.",
      readiness: "partly_ready",
      waitingFor: ["B05", "OD-B10-13"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-12"),
  },
  {
    id: "RB-13",
    title: "Lost or stolen phone",
    triggerMetrics: [],
    otherTriggers: ["A staff report"],
    operatorRole: "OPS",
    firstChecks: "Verify the report through an authorised channel.",
    steps: "Follow the existing procedure in docs/operations.md.",
    narrowestSwitch: "Deactivate the account",
    dataImplications:
      "The account's media is kept; deactivation does not delete it.",
    pendingDelivery: NO_DELIVERY,
    readbackProof: "The account's existing session is refused.",
    drill: {
      description:
        "Deactivate a fixture staff account; its existing session is refused.",
      readiness: "ready_on_main",
      waitingFor: [],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-13"),
  },
  {
    id: "RB-14",
    title: "AI runaway spend or unknown outcome",
    triggerMetrics: ["M-AI-1", "M-AI-2", "M-AI-4"],
    otherTriggers: [],
    operatorRole: "B09",
    firstChecks: "Find the job and its ledger rows.",
    steps:
      "Disable the job, reconcile outcomes and keep suggestions unconfirmed.",
    narrowestSwitch: "Per job",
    dataImplications: "No suggestion becomes an answer without a person.",
    pendingDelivery: NO_DELIVERY,
    readbackProof: "The ledger shows every attempt reconciled.",
    drill: {
      description: "B09-06 limit drill with a stub provider; no real spend.",
      readiness: "waiting",
      waitingFor: ["B09"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-14"),
  },
  {
    id: "RB-15",
    title: "Wrong venue mapping suspected",
    triggerMetrics: [],
    otherTriggers: ["A readback shows another venue's data"],
    operatorRole: "WS5",
    firstChecks:
      "Check the crosswalk row for the destination and its owner sign-off (X8).",
    steps:
      "Disable the destination, correct the crosswalk and withdraw anything delivered.",
    narrowestSwitch: "Per destination",
    dataImplications: "No answer changes; only the mapping is corrected.",
    pendingDelivery: "Withdrawals for the wrong venue go through RB-09's path.",
    readbackProof: "The destination shows only its own venue's data.",
    drill: {
      description:
        "Similar-name fixture (The White Horse versus The White Horse Inn) refused and withdrawn.",
      readiness: "waiting",
      waitingFor: ["B06", "B07", "X8"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-15"),
  },
  {
    id: "RB-16",
    title: "Month close missed, snapshot drift, or corrections waiting",
    triggerMetrics: ["M-JB-5", "M-JB-6", "M-RV-5"],
    otherTriggers: [],
    operatorRole: "WS3",
    firstChecks: "Read the month-close heartbeat and the drift report's cause.",
    steps:
      "Missed close: run scoring_close_month for the month (idempotent). Drift: find the named cause; never edit a snapshot or a count; a past month changes only through a previewed correction the owner signs off (B08 §5.5). A stale preview is re-run, never forced.",
    narrowestSwitch: "The month-close job (stopping it never changes counts)",
    dataImplications: "Snapshots and counts are never edited.",
    pendingDelivery: NO_DELIVERY,
    readbackProof:
      "Every participant has one close snapshot and the drift check reports no unexpected difference.",
    drill: {
      description:
        "Close twice writes one snapshot; delete a fixture profile after close and see drift reported with no count change; skip the close and see M-JB-5 breach, then run it; a changed preview is refused.",
      readiness: "waiting",
      waitingFor: ["B08"],
      status: NOT_EXERCISED,
    },
    evidencePath: evidence("RB-16"),
  },
]
