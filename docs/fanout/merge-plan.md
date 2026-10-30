# NabaLens merge precheck

Track: `merge-precheck`, branch `feat/nl-mergeplan`. Documentation only.
Only the integrator may merge into `feat/nabalens-mvp`. No remote, push, PR,
application edits, database changes, or running stacks are needed for this track.

## Latest: snapshot 4, 2026-10-30 01:16:11 UTC

Integration advanced to `69f3d081fada8067a414f1dd8da66d7e9e1b4fee`.
Its merge #4a contains the pinned migrations, privacy, library, CI, three review,
docs2 and acceptance tips, plus gaps and this planning branch through `4c03805`.
Those ancestors need **no second merge**. Authedge has incorporated integration
through `a964290`. Only committed refs were inspected; none moved during the
original matrix. Historical findings below are revision-scoped and superseded by
this section where explicitly corrected.

All commit times below are **30 October 2026, UTC**. `%cr` is the observed value,
not a completion signal. Quietness compares snapshot 3 with this pinned scan,
**19m54s** later, and also requires a commit age of at least 20 minutes.

| Branch | Full pinned SHA | Last commit UTC | `%cr` | Quiet? |
| --- | --- | --- | --- | --- |
| `feat/nabalens-mvp` | `69f3d081fada8067a414f1dd8da66d7e9e1b4fee` | 01:11:06 | 5 minutes ago | base, changed |
| `feat/nl-journey` | `bd366d0ca2ee79b3cb2d4f5152855e9359a6e339` | 01:06:52 | 9 minutes ago | no |
| `feat/nl-visual` | `d139fe69f325f26dafe1b4e1aaf843e7b6d6f8d1` | 01:08:55 | 7 minutes ago | no |
| `feat/nl-library` | `e83de829c842db3b19e75eeddf637148431e9a37` | 01:02:14 | 14 minutes ago | no, integrated |
| `feat/nl-authedge` | `0c61e759603c216eda3f68c816b92bf09d3f7237` | 01:09:44 | 6 minutes ago | no |
| `feat/nl-uploads` | `ac58e9c8a55a759e0900947cd3cced78a35f82c8` | 01:10:06 | 6 minutes ago | no |
| `feat/nl-ci` | `e4f7b9197680a3983c4b591961080f29530f0180` | 00:37:43 | 38 minutes ago | yes, integrated |
| `feat/nl-docs2` | `be8a8979d3577d6a653c3fa40789d7ffda590b41` | 00:18:42 | 57 minutes ago | yes, integrated |
| `feat/nl-docs` | `575c336d6ae391c42bfa36030dbb2c4331a20bf7` | 00:05:25 | 71 minutes ago | superseded |
| `feat/nl-acceptance` | `1193e85d219964a20075f0b4e210d5308e85f6fa` | 00:36:33 | 40 minutes ago | yes, integrated |
| `feat/nl-privacy` | `cf9ca902facc76adb4f6f1ab76012ba6b4efc4dd` | 00:54:29 | 22 minutes ago | yes, integrated |
| `feat/nl-migrations` | `75dc8ace00aab0f7164b64b58bd790cb54137829` | 01:03:44 | 12 minutes ago | no, integrated |
| `feat/nl-load` | `6349632bb7c6da84696016a4a73b4c2c827e0ee5` | 01:13:09 | 3 minutes ago | no |
| `review/nl-wave3` | `ce09ae157bb431dad74b96a7708b74912c99f207` | 00:17:37 | 59 minutes ago | yes, integrated |
| `review/nl-scope` | `3894911154c53518e77ecf86c21ef5bd08fa4840` | 00:13:37 | 63 minutes ago | yes, integrated |
| `review/nl-upload-path2` | `0b169e55a9a2225474b3bfdcf9b48cc364765968` | 00:34:50 | 41 minutes ago | yes, integrated |

Actual original-matrix output:

```text
COUNTS {"checks":120,"clean":116,"conflicting":4}
BASE: 14 clean / 1 conflict
PAIRS: 102 clean / 3 conflicts
CUMULATIVE {"checks":6,"clean":5,"conflicting":1}
MIGRATION_DIVERGENCE {}
QUIET: interval_seconds=1194.127837, quiet=7/14, majority=false
MOVED {}
```

Both docs branches remain in all checks; only superseded docs is excluded from
the quiet denominator. Seven is **not** a majority. Changed/recent refs are
journey, visual, library, authedge, uploads, migrations and load; two are already
integrated, not pending merges. Monitoring remains active; next expected tick
**01:35:04 UTC**.

### Four textual conflicts, two underlying resolutions

| Check | Conflicted path | Resolution |
| --- | --- | --- |
| integration / journey | `app/admin/admin-library.tsx` | Shared serializer plus optimistic controls, as below |
| journey / library | same | Same recipe |
| journey / authedge | same | Same recipe, inherited through integration/library |
| journey / visual | `components/nabalens/staff-directory-table.tsx` | Visible row content names the link; no overriding mobile `aria-label`; one hidden `, open portfolio` suffix |

The filter recipe from snapshot 3 remains exact: keep `filtersToSearch`, remove
local `toSearch`, retain `useOptimistic(filters)` and `value={shown}`, and call
`setShown(next)` inside the navigation transition. Gallery key, page loading and
search still use **committed** filters. Resolved blob:
`13842e348da452cd07265b2f1c3200c69428fd59`.

The row-link conflict is only journey's explanatory comment versus visual's
comment removal. Both remove the mobile overriding label and add the same
hidden suffix. Use visual's resolved blob
`76fd4a8ad97a089228800790fdf1e6c1ee45521a`, preserving visible display name,
status/job/venue text, and all row actions. Do not put back the shorter label
that excludes visible text. No whole-side UI rollback is needed.

The raw cumulative order still stops at journey, step 6. Applying the two
recipes in **unreferenced objects only** gives:

```text
PROPOSED_RESOLUTION_CUMULATIVE:
  steps=14, clean_automerges=12, manual_resolution_steps=2
  tree=ac38e5b5e5dac06e26ef20f74af5c98bd49f2faa
SEMANTIC_DURATION_DEDUP:
  tree=e31290cb94dab874d075800f622f6f5c7cacc24b
  tile_blob=fe0f7d6255f5f6c9bb664770e88362413cb3747b
```

The 14-step simulation retains the previous order, including ancestors for
comparability; it does not mean 14 real merges remain. Journey's single trailing
`duration m:ss` still wins over visual's prepended duplicate, preserving the
`Video, <filename>, ...` selector contract. Neither tree was installed or tested.

### Supplemental security-fix branch, separate from the 120 checks

Integrator's merge #4b handoff names `feat/nl-secfix`, outside the original
15-branch matrix. A later scoped inspection pinned
`de6b03172e19aaa916b48a6b00babd4acc5fd6b4`, committed **01:12:48 UTC**;
its observed `%cr` was **7 minutes ago**. Do not silently change the original
14-ref quiet denominator or count its handoff's DONE as our test evidence.

This branch **does contain** the forward read-policy lockdown, service-role
signing after checks, stale-processing reaper, DB-time claim takeover, reservation
write guard/limits and profile Origin/CSP corrections. Thus snapshot 3's
"no target contains these fixes" is no longer the current planning conclusion.
They are not yet in pinned integration. The branch's own evidence is documented
in `docs/reviews/wave3-fixes.md`; this track has not reproduced it.

Actual supplemental checks against all 16 original pinned refs:

```text
SECFIX_PAIRS: checks=16, clean=11, conflicting=5
CONFLICTING_WITH: integration, library, authedge, uploads, privacy
SECFIX_AFTER_PROPOSED_CUMULATIVE: exit=1, conflicted_paths=4
```

Resolve these four cumulative paths precisely:

1. **`lib/server/accounts/portfolio.ts`: keep library's deletion.** Security's
   one-line signing change targets the removed interim implementation. Do not
   resurrect it or its exports/actions. Retain the independent service-client
   avatar changes in `accounts/directory.ts` and `media/profile.ts`.
2. **`lib/server/media/access.ts`: combine, not either whole side.** Retain
   library's shortening-only `signedUrlTtlSeconds()` and call it when signing.
   Use `actor.service.storage` only **after** `getReadableAsset` authorises the
   current actor/resource. Retain journey `9e7df13`'s error-body drain, which
   fixes hanging missing-original downloads; do not restore awaited `cancel()`.
   Correct the comment that still says signing uses the caller. Proposed blob:
   `392a8ebb03ea0f25817ea648e064d139f011b654`.
3. **`lib/server/media/finalise.ts`: preserve both security corrections.** Keep
   secfix's `take_over_stale_media_claim` RPC and DB clock, not the old host-clock
   comparison. Keep uploads' size checks **before reads**, failed-original
   removal, ready update's `deleted_at IS NULL`, and `claimLost` dispatch to
   `settleLostClaim` **outside** the write catch. Its service re-read handles a
   tombstone/missing row by removing late derivatives/original and returning
   404; already ready succeeds; another state returns 409 without failing its
   claim. Do not choose secfix's older inline no-match block, which lacks the
   tombstone cleanup. Proposed blob:
   `f3476745d44506115cf0eaa95550aef9c39dd751`.
4. **`next.config.ts`: use one combined `headers()` implementation.** At these
   exact tips secfix's `securityHeaders` already includes privacy's `nosniff`;
   retain its CSP, framing, permissions and referrer headers too. Keep the
   production Supabase origin/build environment consistent with the app.
   Do not duplicate `headers()` or revert to privacy's single-header version.
   Pinned resolved blob: `0624a9fd7510fb96e687bc77a1d346d800f72c90`.

These four recipes were applied to scratch trees, including the duration fix:
`c14a65c84def551b049f8309e79285cc7e4720ef`. This is **not** a clean
automatic secfix merge or an application-test pass. The original raw failures
remain failures in the reported counts.

### Current semantic and evidence gates

- **Scanner-safe auth changes the login contract.** Authedge replaces GET
  token consumption with a confirmation page and POST `/auth/confirm/verify`.
  Preserve that behavior and the malformed/expired/cross-origin/scanner tests.
  Update every browser helper to click **Continue** after opening the link,
  including journey's `helpers/world.ts` and invitation/sign-in journeys,
  `tests/library/e2e.ts`, gaps, visual and upload helpers. Authedge updates
  slice/accounts helpers but not all of these. Privacy runtime currently expects
  the GET to return 303 with cookies: change it to check a non-consuming GET,
  then submit the form and retain redirect/cookie/no-store/leak assertions.
  Do not revert to GET consumption or use service-role sessions to mask failures.
- **Origin helper consolidation:** secfix adds
  `lib/server/http/same-origin.ts`. Retain its Host/forwarded-Host-aware profile
  check, and use the same tested primitive for the admin avatar route's known
  `nextUrl.origin`/127.0.0.1 mismatch. Reconcile auth verify's local guard with
  that shared contract and its Origin/Fetch-Site tests before consolidating;
  never weaken cross-site rejection to fix test setup.
- **Upload/security fixes must be tested together.** `ac58e9c` implements the
  deletion/finalise correction and measured-size validation; secfix implements
  stale claims and read lockdown. Require the upload race/oversize tests plus
  security/lifecycle suites after their real merge. Keep the documented nullable
  upload key/optional fifth RPC argument; secfix's migration preserves them.
- **Integration already wires bundle scanning.** `a964290` adds `scan:bundle`
  and `test:migrations`, runs the scan after a successful build in local CI, and
  removes library/gaps fixture 504 retry loops. Keep those changes. Journey's
  slice retry removal also survives. Visual `d139fe6` still contains a
  `generateLink` retry loop, and upload/visual wrappers must not reintroduce
  hidden fixture retries. Production transport retries are a separate contract.
- **Remaining CI wiring is not fixed by that commit:** isolate the matching
  E2E workdir and DB/JWT credentials, correct callback/confirm URLs for CI's port,
  supply real Linux HEIC fixtures, reconcile project names (`desktop` versus
  `chromium`), and keep the visual gate separate with nonzero executed cases.
  Preserve privacy runtime's explicit production-server/log/secret inputs.
  Adapt its deleted `loadMorePortfolioAction` probe to `loadLibraryPage`, and
  remove journey's portfolio `test.fail()` when the integrated library passes.
  Authedge's `tests/integration/auth-access.test.ts` also still statically imports
  and calls that deleted action in the proposed tree. Replace its import/calls
  with the authorised library paging action and retain every role/deactivation
  assertion; otherwise the clean merge retains a broken API dependency.
- **Migration/backup evidence advanced:** migrations' final handoff reports
  upgrade 7/7, reset 3/3, lint 3/3, plus a 12-object hash-checked local restore
  with 48 access checks. These are that track's results on the five-migration
  schema, not our runs or evidence for the new security migration. Rerun on the
  six-migration tree. `scripts/db/lib/drill.ts` currently downloads directly with
  end-user Storage clients, and upgrade expects 16 grants/32 denials. Read
  lockdown invalidates those grants: add denied-direct-read checks and retain
  authorised **app-path** byte/hash checks. Verify the new guard trigger/RPCs,
  policies and migration history survive restore, not just the old three-policy
  count. Hosted restore/PITR and post-restore upgrade remain unverified.
- **Load evidence now exists:** `docs/runtime-sizing.md` and raw reports are
  committed. Its final local set reports 100/100 mixed and HEIC batches,
  20/20 HEIC burst and 1/1 near-200-MiB video, with mixed peak RSS 1289 MiB.
  These are macOS/shared-host results; the mixed final run even starts at load
  8.9 despite the "quiet at start" heading. Some runs are explicitly contended.
  Do not call them Linux/hosted sizing proof. Preserve FIFO one-slot admission,
  bounded waits and retained-buffer accounting. Reconcile the existing 8
  finalise busy-retries with the new per-attempt queue wait: the report bounds
  overload around 170 seconds, longer than the 2-minute stale takeover window.
  Set a coherent retry/claim/route budget before deployment; no limit is changed
  by this planning track. Union load and upload `docs/media-pipeline.md` edits.
- **Release remains blocked:** integration's own handoff reports typecheck,
  lint, 124 unit tests, build and bundle scan passing, but integration has one
  intentional **failing** `gaps-profile-origin` test. After secfix it must pass,
  not become skipped/expected-failing. Cleanup is still unscheduled, and hosted
  permission for the new `storage.objects` trigger still needs confirmation.
  No stack or combined-tree application checks were run by this track.

## Historical snapshot 3, 2026-10-30 00:56:17 UTC

Integration base is still `3a23c9bf065a5e7d369a7bdac0006e5c38a0dfbd`.
All times below are **30 October 2026, UTC**; `%cr` is the observed relative age.
No refs moved during the pinned scan. Compare quietness against snapshot 2,
20m30s earlier, not against the initial snapshot.

| Branch | Pinned tip | Last commit UTC | `%cr` | Quiet since snapshot 2? |
| --- | --- | --- | --- | --- |
| `feat/nabalens-mvp` | `3a23c9b` | 00:06:35 | 50 minutes ago | yes, base |
| `feat/nl-journey` | `52cdddf` | 00:55:44 | 33 seconds ago | no |
| `feat/nl-visual` | `b849d83` | 00:25:59 | 30 minutes ago | yes |
| `feat/nl-library` | `88e7ae9` | 00:54:41 | 2 minutes ago | no |
| `feat/nl-authedge` | `3e56a0a` | 00:53:41 | 3 minutes ago | no |
| `feat/nl-uploads` | `bd4d377` | 00:52:13 | 4 minutes ago | no |
| `feat/nl-ci` | `e4f7b91` | 00:37:43 | 19 minutes ago | no |
| `feat/nl-docs2` | `be8a897` | 00:18:42 | 38 minutes ago | yes |
| `feat/nl-docs` | `575c336` | 00:05:25 | 51 minutes ago | superseded |
| `feat/nl-acceptance` | `1193e85` | 00:36:33 | 20 minutes ago | no |
| `feat/nl-privacy` | `cf9ca90` | 00:54:29 | 2 minutes ago | no |
| `feat/nl-migrations` | `81c9322` | 00:55:47 | 32 seconds ago | no |
| `feat/nl-load` | `6dcee2a` | 00:53:59 | 2 minutes ago | no |
| `review/nl-wave3` | `ce09ae1` | 00:17:37 | 39 minutes ago | yes |
| `review/nl-scope` | `3894911` | 00:13:37 | 43 minutes ago | yes |
| `review/nl-upload-path2` | `0b169e5` | 00:34:50 | 21 minutes ago | yes |

Actual check output:

```text
COUNTS {"checks": 120, "clean": 119, "conflicting": 1}
CONFLICT: feat/nl-journey + feat/nl-library
CONFLICT (content): Merge conflict in app/admin/admin-library.tsx
CUMULATIVE {"checks": 6, "clean": 5, "conflicting": 1}
MIGRATION_DIVERGENCE {}
QUIET: interval_seconds=1230.217004, quiet=5/14, majority=false
MOVED {}
```

All 15 base checks remain clean. Of 105 branch pairs, only journey/library
conflicts. The raw cumulative order stops on journey, step 6: five clean merges,
then one conflict; remaining steps are **not** an unassisted cumulative pass.
Five quiet refs are visual, docs2 and the three review branches. The other nine
implementation/evidence refs changed or are recent. Next sweep: **01:15:04 UTC**.

### Exact textual conflict: keep optimistic state AND shared serialization

`app/admin/admin-library.tsx`: journey `3bb05d4` fixes rapid filter choices built
from stale server props; library extracts `toSearch` to tested
`filtersToSearch` in `app/admin/library-search.ts`. Neither whole side wins.
Resolve as follows:

```tsx
import { filtersToSearch } from "./library-search"

const [pending, startTransition] = React.useTransition()
const [shown, setShown] = React.useOptimistic(filters)
const search = filtersToSearch(filters)
// LibraryFilters value={shown}
// onChange:
const qs = filtersToSearch(next)
startTransition(() => {
  setShown(next)
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
})
```

Keep `search`, `MediaGallery`'s key, and page loading tied to the **committed**
`filters`/`initialPage`, not optimistic `shown`. Only controls show the pending
choices. Retain library's serializer import/file and remove the local `toSearch`
implementation. Verify rapid Venue → Staff → Type interaction and filter/page
round-trip tests after the real merge.

This exact recipe was simulated with `hash-object`/`mktree`/`commit-tree` on
unreferenced objects, without checking out/editing application files or refs:

```text
PROPOSED_RESOLUTION_CUMULATIVE:
  steps=14, clean_automerges=13, manual_resolution_steps=1
  resolution_blob=13842e348da452cd07265b2f1c3200c69428fd59
  tree=1de9d57dfa64cb8de90dd232561432f9ad85ff7c
```

This confirms the rest of the chosen order has no additional textual conflict
after the proposed filter resolution. It does not certify compilation or behavior.

### Clean merge with a semantic bug: duplicate video duration

Journey `6eb963a` appends `duration m:ss` to the accessible tile name. Visual
`be2c4da` prepends `m:ss` before the filename. Git cleanly keeps **both**, so the
combined `components/nabalens/media-tile.tsx` announces duration twice and changes
the filename prefix expected by upload selectors.

**Journey's trailing-duration variant wins for this function only.** Keep exactly
one `duration ${formatDuration(item.durationSeconds)}` at the end; remove visual's
prepended duration. This still contains the visible badge text for WCAG 2.5.3,
preserves `Video, <filename>, ...` selectors, and drops no other visual fixes.
Keep visual's touch-target/sticky-footer changes and library's viewer recovery.
This supersedes snapshot 2's suggestion to adapt every selector to a prepended
duration: first unify the name contract, then update only genuinely stale tests.

The semantic deduplication was also simulated in scratch objects:

```text
SEMANTIC_RESOLUTION:
  tree=a27846f6c84a44c0b2fe121d86a63ba6375f07d2
  tile_blob=fe0f7d6255f5f6c9bb664770e88362413cb3747b
```

Neither proposed resolution is a commit on any branch or a tested app tree.
They are recipes for the integrator, not application changes by this track.

### New shared behavior and test/config consolidation

- **Library:** keep its mount-time failed-image scan (`ref={attach}`), URL-version
  deduplication, gallery `onError` and visible retry/error states together.
  `b1cdd35` prevents a pre-hydration failure plus a late event from consuming both
  recovery attempts. Keep the unit next/image guard and privacy's complementary
  runtime optimiser-denial test; these are different checks, not duplicate tests.
- **Privacy:** keep `app/auth/redirect.ts`'s new `private, no-store` on session-
  setting redirects, alongside global `nosniff`. These merge cleanly with auth's
  cleanup/bootstrap changes. Its runtime suite still references
  `loadMorePortfolioAction`, which library deletes: adapt that HTTP action probe
  to authorised `loadLibraryPage({ staff: id }, cursor)` and retain cross-role
  checks. Do not restore the interim account query to satisfy the old test.
- **Privacy invitation semantics:** the log audit now accepts `sent` or `partial`
  after account creation. That is only evidence about safe logging, never proof
  that an invitation email was delivered. Preserve a separate full delivery
  assertion in auth/accounts/journey; do not relabel a partial result as success.
- **Journey expected failure:** its QA draft says the individual-portfolio action
  gap is represented by `test.fail()`. Once library fixes the screen, remove that
  expected-failure annotation and require success, rather than treating the
  resulting unexpected pass as a regression.
- **Retry policy:** journey removes the old hidden 504 retry in `slice.spec.ts`.
  Keep that deletion. Upload/visual/library fixture retry loops noted in snapshot
  2 still require reconciliation; app transfer retries are separate.
- **Upload matrix completeness:** the updated spec records engines that cannot
  launch as `unavailable` and continues for diagnostics. Required CI engine gates
  must fail/be explicitly NOT RUN when any required engine is absent; a passing
  Chromium-only result is not full matrix coverage. The `desktop` versus journey
  `chromium` project guard remains unresolved at these tips.
- **Migrations runner now requires phases.** Replace snapshot 2's one-argument
  CI command with all five checked commands on an owned isolated workdir:
  `node tests/migrations/run.mjs "$W" db-reset upgrade`, then `"$W" upgrade`,
  `"$W" db-reset reset`, `"$W" reset`, and `"$W" lint` with the same script.
  Do not combine reset/upgrade evidence or point these destructive test steps at
  another worktree's stack. No new production migration timestamps are present.
- **Load changes HEIC admission, not config limits.** `6dcee2a` introduces FIFO
  waiting for the one decoder slot, up to `heicTimeoutMs`, before `decoder_busy`;
  decode then has its own deadline. Keep release-after-termination, the waiter
  deadline/FIFO tests, and canonical concurrency/budgets. Queued callers still
  retain their input bytes, even though the queue stores resolvers, so measure
  aggregate memory/backpressure rather than describing the queue as memory-free.
  Merge load's current concurrency explanation and uploads' format/playback notes
  in `docs/media-pipeline.md`; neither whole document wins. The load handoff is
  stale and `docs/runtime-sizing.md` is not present at this tip, so do not certify
  final runtime sizing from the draft.
- **Evidence remains revision-scoped.** Acceptance's new map audits `3a23c9b` and
  explicitly reports failing/flaky E2E; its stale branch/test references need a
  final-head reconciliation. Journey's QA results section is still a draft.
  CI's new commit changes only its handoff, not the previously noted isolation,
  discovery, auth-URL or Linux fixture wiring. No main signed-read,
  delete/finalise-race or stale-processing security fix has landed in these tips.

## Historical snapshot 2: 2026-10-30 00:35:46 UTC

Base remains `3a23c9bf065a5e7d369a7bdac0006e5c38a0dfbd`. Pinned refs did not
move during the scan. Relative ages below are actual `git log -1 --format=%cr`
values at the scan, alongside absolute commit times on **30 October 2026, UTC**.
Only committed trees are inspected, not other agents' uncommitted work.

| Branch | Pinned tip | Last commit UTC | `%cr` | Unchanged since snapshot 1? |
| --- | --- | --- | --- | --- |
| `feat/nabalens-mvp` | `3a23c9b` | 00:06:35 | 29 minutes ago | yes (base) |
| `feat/nl-journey` | `8651323` | 00:33:48 | 2 minutes ago | no |
| `feat/nl-visual` | `b849d83` | 00:25:59 | 10 minutes ago | no |
| `feat/nl-library` | `ad5f763` | 00:34:07 | 2 minutes ago | no |
| `feat/nl-authedge` | `dad3590` | 00:34:31 | 76 seconds ago | no |
| `feat/nl-uploads` | `7800d88` | 00:32:43 | 3 minutes ago | no |
| `feat/nl-ci` | `3b14187` | 00:25:32 | 10 minutes ago | no |
| `feat/nl-docs2` | `be8a897` | 00:18:42 | 17 minutes ago | no |
| `feat/nl-docs` | `575c336` | 00:05:25 | 30 minutes ago | yes, superseded |
| `feat/nl-acceptance` | `3a23c9b` | 00:06:35 | 29 minutes ago | yes, no unique commits |
| `feat/nl-privacy` | `c9cb11c` | 00:30:07 | 6 minutes ago | no |
| `feat/nl-migrations` | `621aeef` | 00:29:46 | 6 minutes ago | no |
| `feat/nl-load` | `364b3ee` | 00:15:32 | 20 minutes ago | no |
| `review/nl-wave3` | `ce09ae1` | 00:17:37 | 18 minutes ago | no |
| `review/nl-scope` | `3894911` | 00:13:37 | 22 minutes ago | yes |
| `review/nl-upload-path2` | `0b169e5` | 00:34:50 | 58 seconds ago | no |

Actual output:

```text
COUNTS {"checks": 120, "clean": 120, "conflicting": 0}
CUMULATIVE {"checks": 14, "clean": 14, "conflicting": 0,
  "virtual_commit": "2e3acf761af9dddb0ba87fb8928b24cf47e12d4f",
  "tree": "927cfce3ca6c0e15cf8457426a220642745dc68e"}
MIGRATIONS: diverged={}, duplicate_timestamps={}
QUIET: interval_seconds=1236.072791, quiet=2/14, majority=false
MOVED {}
```

There are still **no textual conflicts**, including all 105 branch pairs.
The same 14-step cumulative order from snapshot 1 also merges cleanly as
unreferenced Git objects only. It has not been installed, built or executed.
`feat/nl-docs` remains contained in docs2 and must not be merged separately.

Only acceptance and scope are unchanged across the 20m36s interval and old enough
to count as quiet; acceptance has no unique committed work, not a completion claim.
The other twelve non-superseded refs changed or are recent. Continue scheduled
checks; next run **00:55:04 UTC**. These exact SHAs, rather than later branch tips,
bound every finding in this snapshot.

### Shared edits and current resolutions

1. **Viewer overlap is clean, retain both sides.** Visual `be2c4da` changes the
   footer to `sticky bottom-0 ... bg-popover`; library retains its `failedUrl`
   state keyed to the preview URL. The cumulative blob contains both. Never
   resolve a later conflict by taking either whole file. Keep visual's 44 px
   phone dialog/select/sign-out targets, wrapping profile names, and accessible
   video duration names as well as library's authorised preview recovery.
2. **New selector contract between visual and uploads.** Visual's video tile name
   now includes duration before filename. Uploads' new recovery spec selects
   names like `^Video, tus-video...` and `^(Photo|Video), <filename>, `, which no
   longer match a ready video with a duration. Keep visual's accessible-name fix;
   update upload selectors to include/allow the real duration while still naming
   the exact file. Do not remove the duration or weaken state/count assertions.
3. **Upload suite would silently skip under journey's config.**
   `tests/e2e/upload-recovery.spec.ts` requires project name `desktop`; journey
   now names its desktop Chromium project `chromium` (others are `firefox`,
   `webkit`, `mobile-chromium`, with `@core` filters). CI substitutes `desktop`
   and `phone`. Keep journey's intentional core/non-core engine split and update
   the upload run-once selection explicitly for Chromium desktop, or define a
   dedicated named project. Verify nonzero executed upload tests after discovery.
   Do not solve this with another skip or by deleting tests.
4. **Visual added a gate, but CI still needs an explicit visual job.**
   `b849d83` now skips `visual.spec.ts` unless `NABALENS_VISUAL` is set by its own
   config. This prevents accidental execution under journey but does not run the
   visual gate in CI. Prefer explicit root/CI exclusion plus the independent
   visual command; do not interpret skipped visual tests as covered.
5. **Fixture retries are a visible policy issue, not a fix for machine load.**
   New visual and upload sign-in helpers retry auth HTTP 504 up to three times;
   library's seed helper also retries fixture 504s. Journey explicitly requires
   no retries. Resolve these new wrappers to fail once with useful diagnostics
   and reduce concurrent owned stacks, rather than carrying retry loops into the
   consolidated release gate. Preserve app transport's specified resumable/retry
   behavior; it is distinct from test-fixture retries.
6. **Auth tests need the same isolated DB as API credentials.**
   `tests/integration/auth-support.ts` consumes `SUPABASE_DB_URL` and
   `SUPABASE_JWT_SECRET` together; otherwise it calls bare `supabase status`.
   CI must forward both from its chosen isolated workdir and validate they
   correspond to the API stack. Keep the localhost restriction and fail closed,
   not a fallback that touches another local stack. Its per-file `server-only`
   and `next/headers` mocks must remain local to tests, not global Vitest changes.
7. **Privacy runtime checks can be skipped by a nominal integration pass.**
   `privacy-runtime.test.ts` uses `describe.skipIf(!PRIVACY_BASE_URL)` and needs
   `PRIVACY_SERVER_LOG` plus `CLEANUP_SECRET`. The real-build bundle case also
   skips without `.next/static`. CI needs a production build/server, captured
   logs and explicit variables, followed by a checked bundle scan and runtime
   suite invocation. Require actual case execution, not merely a zero exit with
   skips. Keep all leak/cache/header assertions.
8. **Authedge's GET cleanup is not deployment evidence.**
   Both GET and POST share the existing constant-time bearer-secret gate, and
   tests cover 503 unset/short, 401 wrong/session-only and authorised execution.
   Keep both method checks and update docs2's POST-only operational language.
   No `vercel.json` cron or deployed scheduler is introduced by this change.
   Keep bootstrap's intentional deactivation-ban lifting for operator-authorised
   promotion; do not introduce self-promotion or account creation.
9. **Privacy headers are additive, not a full security remediation.**
   `next.config.ts` adds global `X-Content-Type-Options: nosniff`; no other target
   changes that config at this snapshot. Keep this header if later CSP/worker
   config lands. It does not fix direct Storage reads, CSP/frame restrictions,
   or profile Origin checks.
10. **Library's newer additions are in scope.** Keep
    `app/admin/library-search.ts`'s URL serializer and the UI/integration tests for
    filters, cursor ties, expiry and polling. Root Vitest globs already discover
    them. Account avatars still have a separate directly-signed-URL path; use
    authorised avatar routes when consolidating signed-read fixes below.

### Security reviews now available: merge blockers, not implemented fixes

Read `docs/reviews/wave3-review.md` at `ce09ae1` (audits `078b60a`) and
`docs/reviews/upload-path-review.md` at `0b169e5` (audits `3a23c9b`).
Both report real isolated-stack probes; this planning track read their evidence,
it did **not** reproduce those probes. Both report no critical/high issue but
require the following corrections before release:

| Finding | Right resolution / merge precedence |
| --- | --- |
| Wave3 #1 / upload F1: users can mint arbitrary-lifetime Storage signed reads, bypassing app TTL | New forward SQL policy correction plus authorised server signing/proxying wins over caller-signed Storage access. Cover media **and avatars** and authenticated admins too; admin-only SELECT still permits admins to choose long expiries. Keep private buckets, re-read current actor/resource before service-role use, and retain canonical 60 s maximum. Adapt library `signDerivative`, avatar callers and tests together. Do not merely document a long-link exception. |
| Upload F2: concurrent delete/finalise recreates derivatives and returns ready after removal | Guard ready transition with `deleted_at IS NULL`; re-read a no-match result, remove late derivatives for tombstoned assets with retryable cleanup, return not-found instead of false ready. The correction in `lib/server/media/finalise.ts` takes precedence over any cosmetic/transport refactor; retain all validation and idempotency assertions. No current target contains this fix. |
| Wave3 #3 / upload F3: crashed `processing` rows never expire | Add a forward cleanup/recovery migration for stale processing claims, with lifecycle coverage and active-claim protection. Uploads' stored retry key helps file reselection but cannot replace server recovery when no client returns. No new production SQL in the current migration track fixes this. |
| Wave3 cleanup release gate | Configure and prove an owned, authenticated cleanup schedule before pilot; GET support alone is not a schedule. Retain failure/lease/backlog reporting and provider incomplete-TUS expiry evidence. |

Additional hardening findings overlap: replayable two-hour signed PUTs after
deletion/deactivation, reserve RPC extension/size checks, terminal-invalid-byte
retention, stale-claim clock/no-match handling, and profile Origin/CSP hardening.
Upload-path probes report TUS rechecks RLS on completion while signed PUT replay
does not. Prefer authenticated upload paths if fixing that behavior; retain
immutable originals and explicit retry behavior. Do not add hidden test retries.

**Contract constraint:** upload F5 proposes making `client_upload_key` mandatory
and treating existing null keys as not-found. That conflicts with the contract's
nullable column/optional fifth RPC argument. Do not adopt that proposal silently.
Preserve compatibility unless the integrator explicitly amends the contract and
provides a safe legacy-row transition; extension/size validation can be hardened
without rejecting the documented nullable interface. Keep product limits
canonical in `lib/config/media.ts` with DB/bucket consistency tests.

Library addresses the old duplicate/preview-only portfolio finding, but not
these signed-read and cleanup findings. Privacy's `nosniff` is not a substitute.
None of the current tips implements the three main security corrections, so a
conflict-free textual merge is **not** a release pass.

### Migrations, backups and docs delta

- All five `supabase/migrations` path+blob listings are identical across every
  pinned tip, and prefixes are unique. `feat/nl-migrations` now adds scripts and
  a standalone `tests/migrations` runner, not production SQL changes.
- `tests/migrations/later/20261101090000_test_only_additive.sql` is a deliberately
  future-dated **test-only** migration. Keep it under tests; never copy it into
  committed `supabase/migrations` or count it as a production migration clash.
- Backup/restore scripts are WIP drafts per their handoff. Do not certify restore
  until the isolated round-trip, objects, policies, identities and original-byte
  checks are evidenced. The new migration suite is not included by root Vitest;
  CI needs an explicit `node tests/migrations/run.mjs <owned-workdir>` stage.
  Keep its 611xx/612xx stacks distinct from load's 615xx and every other worktree.
- Docs2 has merged the pnpm install-policy correction and expanded usage/release
  gates. On final integration reconcile preview-only portfolio text, POST-only
  cleanup text and the worker-packaging claim with actual final-head evidence.
  Do not add `heic-decode`/`libheif-js` to `serverExternalPackages` simply because
  docs mention missing explicit tracing config; preserve the established worker
  packaging approach and verify the real production-route Linux trace/runtime.
  Keep owner-confirmed venues, hosted email/configuration and physical-phone
  evidence as unverified until actually supplied.

## Historical snapshot 1: 2026-10-30 00:15 UTC

Integration base: `3a23c9bf065a5e7d369a7bdac0006e5c38a0dfbd`.
All refs were resolved before checking, then immutable SHAs were used. These
results describe committed trees, not uncommitted work or completed tracks.

| Branch | Pinned tip | Unique work at snapshot |
| --- | --- | --- |
| `feat/nl-journey` | `4c97963` | Production browser config, helpers, core journey |
| `feat/nl-visual` | `23c46f1` | Separate visual config, fixtures, axe/overflow checks |
| `feat/nl-library` | `f3ee17b` | Shared admin portfolio, preview recovery |
| `feat/nl-authedge` | `078b60a` | None yet; ancestor of integration base |
| `feat/nl-uploads` | `a70a27b` | Recovery/limits integration tests, fixture generator |
| `feat/nl-ci` | `2f389c4` | CI workflow, local gate, isolated config/stack |
| `feat/nl-docs2` | `b175917` | Operator setup, operations, release and usage docs |
| `feat/nl-docs` | `575c336` | Already contained in `feat/nl-docs2` |
| `feat/nl-acceptance` | `3a23c9b` | None yet |
| `feat/nl-privacy` | `3a23c9b` | None yet |
| `feat/nl-migrations` | `3a23c9b` | None yet |
| `feat/nl-load` | `3a23c9b` | None yet |
| `review/nl-wave3` | `f6ff865` | In-progress review handoff only |
| `review/nl-scope` | `3894911` | Scope audit against `3a23c9b` |
| `review/nl-upload-path2` | `3a23c9b` | None yet |

Actual scan output:

```text
COUNTS {"merge_tree_checks": 120, "clean": 120, "conflicting": 0}
```

This is 15 integration-base checks and all 105 branch pairs (including both
documentation alternatives). `git merge-tree --write-tree <left-sha> <right-sha>`
returned exit 0 for every pair. It writes Git objects only, not refs, the index,
or the worktree. It does not establish that a cumulative integration will compile.

Only `package.json`, `pnpm-lock.yaml`, and the seven original docs paths overlap
between branch deltas at this snapshot. The docs overlap is ancestry, not competing
edits: use `feat/nl-docs2`, do not merge `feat/nl-docs` separately.

### Cumulative order check

At 00:20 UTC, the 14-step order below was also checked against the same pinned
snapshot (excluding superseded `feat/nl-docs`). Every cumulative merge-tree
returned exit 0:

```text
migrations -> authedge -> privacy -> library -> uploads -> journey -> visual
-> load -> ci -> review-wave3 -> review-upload-path2 -> review-scope
-> docs2 -> acceptance
14 cumulative checks: 14 clean, 0 conflicting
final tree: bfb9d928d9c23143f6430bf58e2fbd410859bbb0
```

Each intermediate tree was wrapped with `git commit-tree <tree> -p <previous>
-p <branch>` solely to preserve ancestry for the next merge-tree call. These are
unreferenced scratch objects, not commits on any branch. No checkout, index,
branch ref, or application file changed. These trees were not installed or tested.

## Recommended order

At integration `69f3d08`, migrations, privacy, library, CI, the three review tips,
docs2 and acceptance are already ancestors. Do not remerge them or superseded
docs. Their later new commits, if any, require a new pinned check.

1. Read both security reviews and secfix's implementation/evidence first.
   Preserve library's shared portfolio rather than resurrecting the deleted query.
2. The tested scratch order for remaining code is **authedge → uploads → journey
   → visual → load → secfix**. Apply the filter, row-name and duration recipes,
   then the four security conflict recipes above. Recheck against the actual
   integration head before each real merge. The integrator alone performs merges.
3. Consolidate auth confirmation helpers, CI discovery/isolation, no-retry fixtures,
   privacy runtime probes and migration/backup access assertions. Keep all
   security fixes and the sixth migration before accepting browser/release evidence.
4. Run the integrated install/typecheck/lint/unit/build/bundle gates, then actual
   security, lifecycle, migration, integration, browser and independent visual
   gates on owned isolated stacks. Require nonzero cases, the formerly failing
   Origin test passing, and retained authorisation/race assertions. These are
   integrator steps, not checks claimed by this planning track.
5. Reconcile docs2/acceptance and runtime-sizing evidence with the final tree.
   Require hosted trigger permission, cleanup scheduling and deployment/phone
   evidence separately. Old audit passes do not certify the new tree.
6. Integrate this branch's newer documentation delta when useful; its prior
   `4c03805` is already merged. No proposed scratch commit is a branch to merge.

## Resolution rules and semantic overlaps

Snapshots 1–2 were textually clean. Snapshot 3 adds the admin filter conflict
and duration duplication; snapshot 4 adds the row-name conflict and supplemental
secfix conflicts. The latest section's exact resolutions take precedence over
historical findings below.

- **`package.json`: combine, do not choose an entire side.** Retain the integration
  scripts and all new suite commands. Keep additive browser-test dependencies from
  journey/visual. Do not upgrade unrelated packages or replace the existing test
  commands with a narrower suite. Specifically, both add identical
  `@axe-core/playwright: "^4.14.0"`; keep it once, plus visual's
  `"test:visual": "node tests/visual/run.mjs"`.
- **`pnpm-lock.yaml`: preserve manifest union and policy.** The current journey and
  visual deltas merge cleanly, but frozen install must confirm the combined tree.
  If later hunks conflict, resolve `package.json` first and regenerate only the lock
  from that agreed manifest with pnpm. Do not take a stale whole lockfile.
  Keep `pnpm-workspace.yaml`'s `minimumReleaseAge: 1440` and build permissions:
  `esbuild: false`, `sharp: true`, `unrs-resolver: true`, `msw: false`.
  At the audited journey/visual tips their entire lock blobs are identical
  (`173549f…`, baseline `a123bd8…`); either identical blob is sufficient at this
  snapshot. Regeneration is only needed if a later manifest/lock diverges.
- **`app/admin/staff/[id]`: library's architecture wins.** Keep `page.tsx` using
  `getMediaActor("admin")`, `listLibrary`, and the new `AdminPortfolio`; retain the
  existing `AccountHeader`/account editing. Do not restore deleted
  `portfolio-gallery.tsx`, `lib/server/accounts/portfolio.ts`, its exports, or
  `loadMorePortfolioAction`. Use `loadLibraryPage({ staff: staffId }, cursor)` and
  shared `MediaGallery` for stable paging, preview, download, deletion, and polling.
- **`components/nabalens/media-viewer.tsx`: combine visual changes with library's
  `failedUrl` logic.** A changed authorised preview URL must clear its prior failure
  state. Keep full-image display, native-video fallback and permission-aware
  callbacks. Presentational components must remain free of Supabase imports.
- **`app/_media/media-gallery.tsx`: retain shared behavior.** Preserve library's
  preview recovery, existing foreground-only 15-second/focus refresh, current
  filters, delete confirmation, paging and authorisation routes. Do not replace it
  with another account-only implementation or long-lived signed URL storage.
- **`lib/config/media.ts`: integration's canonical names/values win.** No target
  branch changes it in snapshot 1. Preserve 10 files / 2 transfers / 20 MiB photos /
  200 MiB videos / 5 MiB avatars, 60-second signed links and the processing budgets.
  Library's `signedUrlTtlSeconds()` in `lib/server/media/access.ts` only permits a
  test override that shortens the canonical TTL; do not restore the old
  `signedUrlTtlSeconds` or `abandonedUploadHours` config names.
- **Reviews are not automatically fixes.** Scope's preview-only portfolio finding
  is addressed structurally by library `f3ee17b`; confirm it in the integrated UI
  before closing the finding. Future security findings take precedence over
  cosmetic or test-only changes, without weakening RLS, checks, or assertions.
- **Uploads after snapshot 1:** inspected `84bab92`, which adds
  `lib/upload/upload-keys.ts`, `ReservationGoneError`, queue/TUS changes and the
  app uploader hook wiring. Preserve them together with `app/staff/actions.ts`'s
  returned status so a removed reservation is distinguishable from other failures.
  Keep the stored idempotency key, not bytes or credentials, and the new unit
  coverage. This is resume-after-file-reselection, not offline/background upload.
  The next matrix must use this newer tip; snapshot 1 predates it.

## Test-config and helper consolidation

- Root `vitest.config.ts` remains the authoritative unit/integration project list.
  Keep the existing unit globs and integration isolation. New
  `tests/integration/upload-*.test.ts` already match its integration glob, not
  `pnpm test`'s unit project. Preserve security/lifecycle standalone configs.
- Keep journey's root `playwright.config.ts`, visual's
  `playwright.visual.config.ts`, and CI's `scripts/ci/playwright.config.ts` until
  their discovery and environment contracts are reconciled. Do not flatten them
  into a config that silently omits a suite or runs visual tests in every journey
  project. Keep `workers: 1`, `retries: 0`, no hidden retries and no server reuse.
- **Fix unrestricted test discovery before treating CI as integrated.** Journey's
  root config discovers all of `tests/e2e`. Visual now self-skips without its
  config's environment marker, but this does not establish visual coverage.
  Explicitly exclude `visual.spec.ts` from ordinary discovery and run the
  preserved visual config as its own gate. Resolve uploads' project-name mismatch
  as described in snapshot 2 so that the opposite failure, silent skipping of
  an intended ordinary suite, cannot pass unnoticed.
- **Connect CI to journey's isolation contract.** CI's
  `scripts/ci/run-suites.mjs` exports credentials, but not
  `E2E_SUPABASE_WORKDIR`. Pass its isolated workdir through journey's resolver,
  which sets `E2E_ISOLATED_STACK` and `E2E_DB_URL`. Keep
  `tests/e2e/helpers/stack.ts`'s fail-closed `requireIsolatedStack()`.
- **Fix CI auth URLs, not auth enforcement.** CI's preparation script currently
  rewrites Supabase ports but leaves auth redirects on port 3000. Reuse journey's
  site/callback/confirm URL transformation for the actual CI app port, without
  changing invite-only settings.
- **Make HEIC fixtures deployable on CI's platform.** Journey's
  `tests/e2e/helpers/media.ts` invokes macOS `sips` unconditionally from the core
  journey. Ubuntu CI needs a real synthetic HEIC fixture or supported encoder,
  not a skipped assertion or fake JPEG substitute. Preserve ffmpeg/HEVC coverage.
- **Keep CI's project matrix explicit.** Its wrapper replaces journey projects
  with desktop/phone projects per engine, losing journey's `@core` filtering and
  mobile device settings. Decide and document the deliberate matrix, preserving
  actual browser/device settings, one worker, zero retries and all core assertions.
- **Keep privacy's checked post-build bundle scan.** Integration `a964290`
  wires it into local CI. Preserve the checked exit status and same build
  environment when consolidating later commands. Runtime privacy cases still
  need their separate production-server/log inputs. Never relax scanner rules.
- **Keep CI's toolchain pin deliberate.** `scripts/ci/local-ci.sh` and its workflow
  pin pnpm 10.30.1. Do not remove the baseline pnpm-11 install-policy fix or claim
  a pnpm-11 CI run from the old pin; document/test each supported version.

### Duplicated helpers to unify

Prefer compatibility wrappers around shared pure primitives, not an integration
refactor that silently changes fixtures or redirects. This track makes no edits
to these helpers.

| Overlap | Concrete consolidation / behavior to retain |
| --- | --- |
| `tests/{security,lifecycle,e2e,visual,library,load}/prepare-stack.mjs`, `scripts/ci/prepare-stack.mjs` | Share copying/config transformations with per-suite options; preserve default workdirs, outputs, `.temp`/`.branches` exclusions, auth URLs and fresh migration copying. Keep separate project IDs/ports and cleanup ownership. |
| Status/env parsing in standalone runners, journey config, CI and load | Share an ESM local-stack resolver; retain `NABALENS_TEST_DB_URL` versus `E2E_DB_URL`, CLI workdir forwarding and failure propagation. Do not broaden lifecycle's `server-only` stub into root Vitest. |
| Browser fixture/login helpers and existing integration identities | Share low-level fixture primitives only. Journey must still test real Mailpit login with freshness/subject checks, without hidden retries or service-role substitution. Visual fixtures remain layout-specific; direct `verifyOtp` integration helpers are not browser-login evidence. |
| `tests/e2e/helpers/media.ts`, `tests/fixtures/uploads/generate.mjs`, `tests/load/fixtures.mjs` | Share encoding primitives only. Keep exact source hashes, codec variants, malformed cases and boundary sizes; load's near-200-MiB video is not uploads' exact 209,715,200-byte boundary file. |
| Interim account media query/gallery | Already removed by library. Keep `listLibrary` / `MediaGallery` as the common implementation rather than extracting another parallel query. |

Audited default port blocks: security `564xx`, visual `577xx`, library `579xx`,
journey `583xx` (override supported), lifecycle `594xx`, load `615xx`; CI probes
a randomized block. These are descriptions, not reservations: check collisions
before starting any stack. Load disables Mailpit; browser/email suites require it.
Temporary suite configs should disable studio/realtime/analytics/edge runtime when
not needed. Never share another worktree's containers or stop them.

### Migration ledger

Across the original 15 pinned target tips, the five production migrations remain
identical with no duplicate timestamps or divergent blobs. Supplemental secfix
adds a sixth, uniquely timestamped forward migration:

| Order | Filename | Dependency / reason to retain |
| --- | --- | --- |
| 1 | `20261029120000_nabalens_schema.sql` | Domain/private schema, enums and tables |
| 2 | `20261029120100_nabalens_access.sql` | Depends on schema; RLS, helpers, triggers, four-argument reserve |
| 3 | `20261029120200_nabalens_storage.sql` | Depends on access helpers; private buckets/policies, original cleanup |
| 4 | `20261029150000_nabalens_media_cleanup.sql` | Cleanup leases/replacement RPC; drops prior two-argument cleanup |
| 5 | `20261029160000_media_client_upload_key.sql` | Contract amendment; immutable key/index, five-argument reserve replacing four-argument RPC |
| 6, secfix | `20261030100000_security_hardening.sql` | Drops end-user Storage reads; adds original-write guard, reserve hardening and DB-time claim/reaper RPCs; depends on the preceding five |

Keep the first five once and unchanged. Append secfix's sixth; no timestamp
renumbering is justified. Its nullable key and optional RPC arguments remain
compatible with the existing amendment. Reconcile backup/access-test expectations
with its intentionally changed read policy, as detailed in snapshot 4.
`feat/nl-migrations` equalled base in snapshot 1 and adds test/backup scripts in
snapshot 2, with no production SQL corrections yet. Prefer a new uniquely timestamped
forward migration after its dependencies. For two future new files sharing a
timestamp, rename only the not-yet-applied new file and update references/evidence;
never rewrite already-applied integration migrations. Verify a fresh isolated
reset and upgrade path before release.

### Independent audit provenance

The read-only helper/config/migration audit used snapshot-1 SHAs, then inspected
new scoped commits uploads `84bab92`, load `364b3ee`, privacy `8e788ec`.
Docs2 subsequently advanced to `a4ebc8d` outside that audit. These later scoped
findings are not substitutes for the scheduled full fresh-ref matrix. No
delegate changed files, ran services, or validated the combined application.

## Validation (own unchanged application tree at `3a23c9b`)

Required reads were completed in the requested order after starting the install.
No Next.js application code was written, so no framework implementation guide was
needed. Commands below were actually run in this worktree, not on proposed merges.

```text
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Packages: +637
Done in 5.8s using pnpm v10.30.1

$ pnpm typecheck
> tsc --noEmit

$ pnpm lint
> eslint

$ pnpm test
Test Files  12 passed (12)
     Tests  102 passed (102)
  Duration  27.41s

$ pnpm build
✓ Compiled successfully in 3.7s
  Finished TypeScript in 3.6s

typecheck=0 lint=0 test=0 build=0
```

No integration/security/lifecycle/e2e tests, browser sessions, physical devices,
live email or hosted deployments were run by this track. No Supabase stack was
started, reset, reused, or stopped.

## Cadence and remaining work

Complete scans: **00:15:10**, **00:35:46**, **00:56:17**, **01:16:11 UTC**.
Next expected schedule tick: **01:35:04 UTC, 30 October 2026**, then every
20 minutes. Only **7/14** non-superseded refs met the quiet criterion in snapshot 4,
so this is not final. Compare each new sweep with the latest previous snapshot.
Each follow-up must pin fresh refs, record
`git log -1 --format=%cr <branch>`, rerun all base and pairwise merge-tree checks,
inspect new shared-file changes and cumulative merge trees, then commit both
this plan and `docs/fanout/handoffs/merge-precheck.md`.
Also repin secfix and recheck its supplemental overlaps; do not silently mix its
extra checks into the fixed 120-check matrix or original quiet denominator.

The continuation is bound to this thread; the first scheduled run changed its
interval to 1,200,000 ms. Its exact task ID is in the continuity handoff. This lets
the requested periodic
work continue without a sleeping shell, polling loop, server, or occupied stack.

Stop recurring sweeps when a majority of tracked (non-superseded) branches have
unchanged tips across a roughly 20-minute interval and their latest commits are
at least 20 minutes old. This is an observable quiet-ref criterion, not proof that
uncommitted work has stopped. List remaining active tracks explicitly.
