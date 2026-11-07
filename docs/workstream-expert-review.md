# Naba-Lens: proposed multi-agent workstreams

**Purpose:** Request an expert review of potential development workstreams, their priority, and their proposed division among concurrent agents.

**Prepared:** 31 October 2026  
**Status:** Planning proposals for review; no implementation or production rollout is authorised by this document.

## Context and limits

Naba-Lens is a Next.js application with Supabase-backed authentication, database and private storage; a staff media upload workflow; an admin media library; and venue menu catalogues and media labels. Although it is one application rather than multiple independently deployed services, its database, server, media processing, UI, test and operational layers offer useful parallel ownership boundaries.

These proposals come from a read-only inspection of the local repository and its documentation. Tests were not run as part of this planning exercise, and live production state was not checked. At inspection, the checkout was one commit behind `origin/main`; refresh the baseline and verify the current code before starting work. Some documentation records historical release or QA results and should not be treated as proof of current status.

The existing menu specification excludes AI, public menus, venue website sync, bulk export, analytics, additional roles, and media approval or publication. Those would require a deliberate product-scope decision rather than being treated as unfinished authorised features.

## Questions for the expert

1. Which of these workstreams would you prioritise, combine, split or defer, and why?
2. Do the proposed boundaries and completion criteria address the most important technical and operational risks? What is missing?
3. Is a durable background processing architecture justified, or should the team first improve and measure the existing request-based flow?
4. What recovery objectives, archive freshness targets and representative workload sizes would you recommend defining before implementation?
5. Are the proposed parallel agent tasks sufficiently independent? Where should a single owner control shared contracts, database migrations or integration?
6. What evidence would you require before approving a production rollout of any selected workstream?

## 1. Framework migrations

### Supported runtime and tooling baseline

**Rationale.** The repository documents Node 24.16.0 and pnpm 10.30.1 but does not pin them in `package.json`. The manifest uses Node 20 type definitions while Node 24 is the documented working runtime. Setup and release documents differ on what pnpm 11 testing has occurred, so the evidence needs reconciliation. This is a multi-day workstream if it includes reproducibility across development, CI, native media processing and browser tests; a manifest change alone would be too small.

**Parallel tasks:**

- **Toolchain:** propose supported Node and pnpm versions; own manifest, lockfile and type-definition changes.
- **Install compatibility:** verify frozen installation and existing dependency build-script and release-age policies.
- **Media runtime:** exercise Sharp, HEIC processing, worker threads and archive streaming under the proposed baseline.
- **CI and documentation:** update checks and reconcile setup instructions with observed results.

**Completion criteria:** A clean setup and relevant project checks pass on the agreed baseline, with exceptions documented.

**Suggested priority:** Medium. The manifest already uses Next 16, React 19 and Tailwind 4. A generic major framework upgrade is not recommended without a concrete compatibility, support or performance need. Current registry versions were not checked.

**Starting points:** `package.json`, `pnpm-workspace.yaml`, `README.md`, `docs/setup.md`, and the CI configuration.

## 2. Cross-component features

### A. Durable media processing and upload recovery

**Rationale.** Upload finalisation handles validation, derivatives, archive coordination and the transition to ready. The operations guide says there is no promised background repair scheduler for stuck processing. A durable processing design would touch database state, server processing, the upload UI and failure handling. This is a proposed improvement, not a claim that the current implementation is broken.

**Parallel tasks:**

- **Database:** define processing states, leases, retry rules and deletion invariants.
- **Processing:** adapt validation, derivative generation and archival to a resumable worker.
- **Upload/UI:** distinguish transfer from processing and support recovery after browser interruption.
- **Verification:** cover crashes, retries, concurrent finalisation, deletion races and representative large files.

The orchestrator should define state and result contracts and evaluate runtime or queue choices before parallel implementation.

**Completion criteria:** Interrupted processing can resume without duplicate assets or receipts, deleted media cannot become visible again, and the UI accurately reports readiness.

**Suggested priority:** High if interrupted or long-running uploads are an operational problem; otherwise measure the need first.

**Starting points:** `lib/server/media/finalise.ts`, `lib/upload/`, `docs/upload-transport.md`, and `docs/operations.md`.

### B. Database and archived-original recovery

**Rationale.** A useful recovery must bring together the database, original media, identities, attribution, previews and access controls. Existing local backup and restore tooling provides a foundation, but the archive guide says rebuilding a live portfolio requires a separate isolated rehearsal.

**Parallel tasks:**

- **Archive:** inventory manifests, verify hashes and recover originals resumably.
- **Database:** handle restore order, schema compatibility, identities, venue attribution and receipts.
- **Media:** regenerate previews and derivatives from recovered originals.
- **Access verification:** check staff, admin, inactive-user and private-media access after restoration.

**Completion criteria:** Restore a synthetic portfolio into an isolated target with matching original hashes, correct attribution, working previews and passing access checks. Record recovery time and prerequisites.

**Suggested priority:** High. A hosted rehearsal or provider changes require separate authorisation.

**Starting points:** `docs/media-archive.md`, `docs/backup-restore.md`, `scripts/db/`, and `lib/server/archive/`.

### C. Scalable menu administration and suggestion handling

**Rationale.** The catalogue and labels already exist. This candidate extends their operation as menu history and suggestion volumes grow. The current overview loads version history and limits displayed suggestions, making pagination and stable navigation a plausible cross-layer improvement.

**Parallel tasks:**

- **Server:** define cursor and sorting contracts; implement bounded queries and any measured index changes.
- **UI:** add history and suggestion navigation, including refresh and conflict states.
- **Verification:** test large synthetic histories, equal timestamps and status changes while paging.

**Completion criteria:** Admins can reach the intended history and suggestions without missing or duplicating entries, while revision-conflict and historical-label behaviour remain intact.

**Suggested priority:** Medium to low until real usage or a sizing exercise shows the volume warrants it.

**Starting points:** `lib/server/menus/index.ts`, `app/admin/menus/`, `docs/menus-data-model.md`, and the v0.3 menu specification.

## 3. Technical debt and bug backlogs

### A. Archive audit capacity and independent alerting

**Rationale.** Archive audits perform bounded work per run and have a freshness target. The documented checker depends on one Mac, and real owner notification delivery is unverified. Making capacity and alerting dependable spans scheduling, storage reads, monitoring, tests and operational procedures.

**Parallel tasks:**

- **Capacity:** model verification cycle duration and cost against synthetic library growth.
- **Audit:** improve resumable checkpoints, scheduling and lease behaviour where measurement shows a need.
- **Monitoring:** design an independent checker with narrow credentials and actionable alerts.
- **Verification:** exercise partial runs, stale results, timeouts, overlapping jobs and notification failures.

**Completion criteria:** A representative library completes verification within the agreed freshness target, interrupted work resumes, and a controlled failure reaches the intended notification destination. Provider deployment and real notification configuration are separately authorised rollout steps.

**Suggested priority:** Highest among the debt candidates. Preserve the existing freshness requirement unless there is an explicit decision to change it.

**Starting points:** `lib/server/archive/audit.ts`, `docs/media-archive.md`, and `scripts/ci/monitor-archive.mjs`.

### B. Reproducible regression and journey evidence

**Rationale.** The project already has substantial unit, integration, security, lifecycle, migration and Playwright coverage. The opportunity is to make additional agentic journeys and their evidence portable and repeatable: the recorded menu QA used a temporary runner outside the repository.

**Parallel tasks:**

- **Harness:** make isolated stack, fixtures and agentic runner setup reproducible.
- **Menus:** cover catalogue activation, label conflicts and unavailable-item journeys.
- **Media:** cover interrupted uploads and recovery.
- **Evidence:** map acceptance scenarios to the revision, results and remaining gaps.

**Completion criteria:** Another developer can run selected journeys against an owned isolated stack and distinguish passed, failed, unavailable and unrun coverage. Reproduce historical failures on the current head before treating them as open bugs.

**Suggested priority:** High as enabling work, particularly before either media workstream.

**Starting points:** `docs/qa/menus-qa-report.md`, `docs/ci.md`, `tests/`, and `scripts/ci/`.

### C. Catalogue and media performance investigation

**Rationale.** This is a measurement-led investigation, not a confirmed performance defect. The menu QA report explicitly leaves load and large-catalogue timing outside its coverage.

**Parallel tasks:**

- **Dataset:** generate representative synthetic venues, menu histories and media records.
- **Database:** measure catalogue and library queries and propose evidence-backed improvements.
- **Frontend:** profile gallery and label-editor payloads and rendering.
- **Media:** measure finalisation and archive throughput at representative file sizes.

**Completion criteria:** Agree performance budgets, record baseline measurements, and make targeted fixes for demonstrated bottlenecks, with correctness checks for paging and historical labels.

**Suggested priority:** Medium. This can provide evidence for the menu and archive workstreams.

**Starting points:** `docs/qa/menus-qa-report.md`, `lib/server/menus/`, `lib/server/labels/`, and `lib/server/archive/`.

## Suggested sequence and coordination

1. Start reproducible regression evidence and archive-capacity measurement in parallel.
2. Run archive alerting and isolated recovery as separate workstreams, sharing agreed archive and identity contracts.
3. Decide on durable processing after measuring interruption and processing needs.
4. Schedule the runtime baseline and menu scaling work around those priorities.

For each selected workstream, the orchestrator should establish shared interfaces first, assign one owner for shared schema and lockfile changes, and integrate agents' work into one PR for this repository. Agents can use repository-local checks during iteration. After rebasing on the latest default branch, follow the project's stated policy for the single final-head `lci` run, without bypassing gates. For QA and user-journey work, follow the repository's QA instructions and report actual execution and unavailable prerequisites.
