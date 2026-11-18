// Runs before each security test file (vitest setupFiles). The suites share
// one stack, run one file at a time, and never delete their fixtures, so by
// the last files the database holds hundreds of fixture venues from the
// integration, lifecycle and earlier security files. The organisation-wide
// reads and jobs (ops_run_notification_jobs, coverage_group_overview,
// admin exceptions) loop over every active venue. Late in the suite they hit
// the API's 8 s statement timeout, and a file's result depended on how many
// files ran before it (S6-CI: ops.test.ts and menu-section-oversight on a
// loaded lane).
//
// Every earlier fixture venue ("TEST Venue …" from createVenue) is marked
// inactive here, so each file sees only its own venues plus the seeded
// "DEV FIXTURE" ones. Venues have no triggers, and nothing is deleted: the
// append-only history keeps its references. A file's own venues are created
// after this runs, in its beforeAll, so they stay active.
import { psql } from "./coverage-fixtures"

psql(
  `update public.venues set active = false
   where active and name like 'TEST Venue %' and created_at < now()`
)
