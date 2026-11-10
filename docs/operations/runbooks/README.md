<!-- Generated from lib/ops by scripts/ops/write-docs.ts. Do not edit by hand. -->

# Runbooks

The B10-02 runbook index. Each runbook has the fields plan §19 requires and one recovery drill, run only on an owned isolated stack. A drill that has not run reads not_exercised; one that waits names what it needs. Write a full runbook from RB-00-template.md.

| ID    | Situation                                                  | Triggers                                | Operator | Narrowest switch                                            | Drill readiness | Waiting for               | Drill status  |
| ----- | ---------------------------------------------------------- | --------------------------------------- | -------- | ----------------------------------------------------------- | --------------- | ------------------------- | ------------- |
| RB-01 | Failed or incomplete upload                                | M-UP-4, M-UP-7, A staff report          | OPS      | None: handled per file                                      | ready_on_main   | none                      | not_exercised |
| RB-02 | Stuck processing                                           | M-UP-2                                  | OPS      | None                                                        | ready_on_main   | none                      | not_exercised |
| RB-03 | Pending physical deletion                                  | M-UP-5                                  | OPS      | None                                                        | ready_on_main   | none                      | not_exercised |
| RB-04 | Stale answers and overdue rechecks                         | M-KN-3, M-KN-4                          | OPS      | A question version with no freshness policy (B03 rollback)  | waiting         | B03, OD-15 fixture policy | not_exercised |
| RB-05 | Conflicts and disputes                                     | M-KN-1, M-KN-5, M-RV-1                  | VM       | Remove the question from the venue's working list           | waiting         | B01, B03                  | not_exercised |
| RB-06 | Missed or failing scheduled job                            | M-JB-1, M-JB-2, M-JB-3, M-UP-3          | OPS      | Per job                                                     | ready_on_main   | none                      | not_exercised |
| RB-07 | Expired or rotated credentials                             | M-DL-6, M-DL-7, A spike of 401 answers  | WS5      | Disable one consumer (disabled: true)                       | partly_ready    | B01                       | not_exercised |
| RB-08 | Delivery failure or consumer outage                        | M-DL-1, M-DL-3, M-DL-4, M-DL-5, M-DL-8  | WS5      | Pause publication per destination; withdrawals keep running | waiting         | B05, B06                  | not_exercised |
| RB-09 | Withdrawal not applied in time                             | M-DL-2, M-WD-1, M-WD-2, M-WD-3, M-WD-5  | WS5      | None: withdrawal never pauses                               | waiting         | B05, B06                  | not_exercised |
| RB-10 | Evidence removal                                           | M-WD-4, A removal request               | OPS      | None                                                        | waiting         | B01, B05, B06             | not_exercised |
| RB-11 | Archive retention and archive alerts                       | M-JB-4, The independent archive checker | OPS      | The archive job                                             | ready_on_main   | none                      | not_exercised |
| RB-12 | Restore from backup                                        | A data-loss incident                    | OPS      | Disable all consumers until compared                        | partly_ready    | B05, OD-B10-13            | not_exercised |
| RB-13 | Lost or stolen phone                                       | A staff report                          | OPS      | Deactivate the account                                      | ready_on_main   | none                      | not_exercised |
| RB-14 | AI runaway spend or unknown outcome                        | M-AI-1, M-AI-2, M-AI-4                  | B09      | Per job                                                     | waiting         | B09                       | not_exercised |
| RB-15 | Wrong venue mapping suspected                              | A readback shows another venue's data   | WS5      | Per destination                                             | waiting         | B06, B07, X8              | not_exercised |
| RB-16 | Month close missed, snapshot drift, or corrections waiting | M-JB-5, M-JB-6, M-RV-5                  | WS3      | The month-close job (stopping it never changes counts)      | waiting         | B08                       | not_exercised |

## RB-01 Failed or incomplete upload

- First checks: Ask for the file name, time and visible error, never the media or a sign-in link. Check the per-file status and private server logs.
- Steps: Retry the same file with the same key. Never re-upload files that already succeeded. Investigate repeated decoder_busy, timeout, corrupt-content or Storage failures rather than weakening validation.
- Data implications: The same key reuses the same asset; no row is deleted by hand.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: The file reads ready once, with one asset and one contribution.
- Drill: An interrupted TUS transfer and a lost finalise response; expect one asset and one contribution (tests/integration/upload-recovery.test.ts cases as the base).
- Evidence: `evidence/b10-02/RB-01/`

## RB-02 Stuck processing

- First checks: Confirm the cleanup job ran (M-JB-1) and the asset is older than the 30 min stale-processing limit.
- Steps: Let cleanup mark the stale claim failed, then the uploader retries. Never mark an unvalidated asset ready.
- Data implications: The asset reads failed until the retry succeeds.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: After the retry the asset reads ready.
- Drill: Seed a processing asset older than 30 min, run the cleanup route, expect failed, then a retry reaches ready.
- Evidence: `evidence/b10-02/RB-02/`

## RB-03 Pending physical deletion

- First checks: Read the cleanup report and the tombstoned assets that still have storage objects.
- Steps: Rerun cleanup and track storage failures. Never delete rows by hand or bypass Storage policies.
- Data implications: The asset stays hidden; only its bytes wait for removal.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: The removal reads removed and no storage object is left.
- Drill: Inject a storage removal failure; expect pending, then removed after a retry.
- Evidence: `evidence/b10-02/RB-03/`

## RB-04 Stale answers and overdue rechecks

- First checks: Check the recheck job heartbeat and that an open, owned recheck task exists for the slot and use.
- Steps: The venue rechecks or reaffirms the answer; the task closes when the slot reads current again.
- Data implications: The previous answer is kept and shown to managers; consumers read it as stale.
- Pending delivery: A stale answer is withheld by read-time rules; no delivery is paused.
- Readback that proves recovery: The reader returns the slot as available and current for the use.
- Drill: Freeze time past max_age with the job stopped: the reader reads stale/expired. Run the job twice: one task. Reaffirm: the task closes.
- Evidence: `evidence/b10-02/RB-04/`

## RB-05 Conflicts and disputes

- First checks: Open the slot in To confirm and read every finding listed in the dispute.
- Steps: The confirming role decides; both histories stay readable. A contract breach in M-KN-1 goes to WS1 instead.
- Data implications: Both histories are kept; no finding is deleted.
- Pending delivery: A disputed answer is withheld until decided.
- Readback that proves recovery: The slot reads available, or Couldn't establish, as decided.
- Drill: B01 J3 fixture: a dispute, then Use this answer and Keep the answer in use; both histories readable.
- Evidence: `evidence/b10-02/RB-05/`

## RB-06 Missed or failing scheduled job

- First checks: Check the cron entry, the route's secret and the last ops_job_runs rows.
- Steps: Call the route once with its bearer secret, then confirm a second call changes nothing.
- Data implications: Jobs are idempotent; a rerun never doubles work or counts.
- Pending delivery: Delivery jobs resume from their stored revisions; withdrawals are never skipped.
- Readback that proves recovery: A new ok heartbeat and M-JB-1 back to ok.
- Drill: For each job: skip its calls and see the heartbeat breach; call it once; call it twice and confirm nothing doubles. The four main crons are drillable now; each later job when it ships.
- Evidence: `evidence/b10-02/RB-06/`

## RB-07 Expired or rotated credentials

- First checks: Find which consumer or secret failed: a reader credential, CLEANUP_SECRET, the archive monitor secret or a B06 website credential.
- Steps: Rotate with overlap (two active reader credentials), update the consumer, then revoke the old one. CLEANUP_SECRET stays at least 32 characters. NabaPresence Google connections follow NabaPresence's own runbook.
- Data implications: None: credentials hold no data.
- Pending delivery: A consumer without a valid credential stops reading until updated; nothing is lost.
- Readback that proves recovery: The consumer's next read succeeds with the new credential.
- Drill: Rotate a fixture consumer with overlap and no failed reads; an expired credential returns 401 and the consumer recovers after the update. The cleanup and monitor secrets are drillable now.
- Evidence: `evidence/b10-02/RB-07/`

## RB-08 Delivery failure or consumer outage

- First checks: Confirm retries are bounded and check the destination's own status.
- Steps: The website serves its last good state or an explicit unavailable answer (B06-05); resume and verify. For NabaPresence an uncertain write is never re-sent: its recovery job reads back, and a retry is a person's new change set.
- Data implications: Desired revisions are kept; nothing is re-created.
- Pending delivery: Pending revisions deliver in order once the destination returns.
- Readback that proves recovery: The destination reaches acknowledged and verified.
- Drill: Take a fixture consumer down; observe lag and errors; bring it back; reach acknowledged and verified.
- Evidence: `evidence/b10-02/RB-08/`

## RB-09 Withdrawal not applied in time

- First checks: Find the destination and revision that are behind.
- Steps: Push the withdrawal, purge the cache and verify live. An older replay must not resurrect content.
- Data implications: The tombstone is kept; it is never deleted.
- Pending delivery: Withdrawals go first and are never held behind publication.
- Readback that proves recovery: The live destination no longer shows the withdrawn content.
- Drill: B05 §4.10 fx_menu_recheck_public_withdrawal plus a B06 tombstone replay; expect the replay refused.
- Evidence: `evidence/b10-02/RB-09/`

## RB-10 Evidence removal

- First checks: Identify the asset and the answers it supports, without sharing the media.
- Steps: Remove through the app, then check the four separate states: app removal, evidence lost, public withdrawal, archive retained (B05-04).
- Data implications: The slot reads unavailable at once; the archive copy is recorded as retained.
- Pending delivery: Any public use is withdrawn through RB-09's path.
- Readback that proves recovery: All four states read as expected.
- Drill: Delete an evidence asset: the slot reads unavailable, evidence_withdrawn is recorded, the use grant is withdrawn, the archive copy is recorded as retained.
- Evidence: `evidence/b10-02/RB-10/`

## RB-11 Archive retention and archive alerts

- First checks: Read the alert kind from the checker.
- Steps: Follow the alert runbooks in docs/archive-monitoring.md. Retention periods are the owner's (B05 owner decisions).
- Data implications: Originals are never deleted by the runbook.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: The checker reports recovered.
- Drill: Reuse the tests/archive controlled failures on the owned stack.
- Evidence: `evidence/b10-02/RB-11/`

## RB-12 Restore from backup

- First checks: Choose the backup and an isolated restore target; disable consumers.
- Steps: Restore, reapply B05's restore step, compare counts and recover a compatible reader. scripts/db/restore-local.sh loads with session_replication_role = replica, so no insert or update trigger fires: a partial, cross-version or re-import load into a B05 schema must set use_baseline itself and pass the B05 §2.4 check query (count 0, or the load aborts). Recheck every other trigger-maintained rule afterwards, including B08's drift check.
- Data implications: Rows created before the B05 cutover read legacy_unknown; grants are never copied.
- Pending delivery: Delivery resumes only after counts compare; publication state is recomputed by its own job.
- Readback that proves recovery: Before and after counts match, and the reader answers.
- Drill: Full restore rehearsal on an owned stack with before and after counts. The replica-mode partial loads (one failing and one passing the B05 check) need B05-m1.
- Evidence: `evidence/b10-02/RB-12/`

## RB-13 Lost or stolen phone

- First checks: Verify the report through an authorised channel.
- Steps: Follow the existing procedure in docs/operations.md.
- Data implications: The account's media is kept; deactivation does not delete it.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: The account's existing session is refused.
- Drill: Deactivate a fixture staff account; its existing session is refused.
- Evidence: `evidence/b10-02/RB-13/`

## RB-14 AI runaway spend or unknown outcome

- First checks: Find the job and its ledger rows.
- Steps: Disable the job, reconcile outcomes and keep suggestions unconfirmed.
- Data implications: No suggestion becomes an answer without a person.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: The ledger shows every attempt reconciled.
- Drill: B09-06 limit drill with a stub provider; no real spend.
- Evidence: `evidence/b10-02/RB-14/`

## RB-15 Wrong venue mapping suspected

- First checks: Check the crosswalk row for the destination and its owner sign-off (X8).
- Steps: Disable the destination, correct the crosswalk and withdraw anything delivered.
- Data implications: No answer changes; only the mapping is corrected.
- Pending delivery: Withdrawals for the wrong venue go through RB-09's path.
- Readback that proves recovery: The destination shows only its own venue's data.
- Drill: Similar-name fixture (The White Horse versus The White Horse Inn) refused and withdrawn.
- Evidence: `evidence/b10-02/RB-15/`

## RB-16 Month close missed, snapshot drift, or corrections waiting

- First checks: Read the month-close heartbeat and the drift report's cause.
- Steps: Missed close: run scoring_close_month for the month (idempotent). Drift: find the named cause; never edit a snapshot or a count; a past month changes only through a previewed correction the owner signs off (B08 §5.5). A stale preview is re-run, never forced.
- Data implications: Snapshots and counts are never edited.
- Pending delivery: No consumer delivery is involved.
- Readback that proves recovery: Every participant has one close snapshot and the drift check reports no unexpected difference.
- Drill: Close twice writes one snapshot; delete a fixture profile after close and see drift reported with no count change; skip the close and see M-JB-5 breach, then run it; a changed preview is refused.
- Evidence: `evidence/b10-02/RB-16/`
