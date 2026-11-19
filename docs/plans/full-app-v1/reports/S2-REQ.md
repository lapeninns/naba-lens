# S2-REQ worker report

Final report from the T3 worker (branch `fa/s2-req`, merged into `feat/full-app-v1`).

# S2-REQ report: requests and shot lists

S2-REQ is built. 14 of the 15 checklist rows are built and one is partly built. Both hand-off items are done. The work is in 7 commits on `fa/s2-req`, the tree is clean, nothing was pushed, and my stack (597xx) is stopped with `--no-backup`.

## Checklist

| ID                                       | Result           | Why                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3.3-create-tasks                        | built            | Managers of the venue and admins (naming a venue) can create requests. Staff, another venue's manager, inactive accounts and anon are refused, and tests cover each.                                       |
| S3.3-archive-with-reason                 | **partly built** | Requests and shot lists can only be cancelled with a reason, which goes into their history and the activity log. Archiving local media is S2-REVIEW's (M2-archive-not-used) or S2-LIBRARY's.               |
| S11-task-brief                           | built            | A request points at a slot (as `coverage_slots` names it) or at a fact. It is never a copy of the requirement.                                                                                             |
| M4-goals-not-tasks, M4-due-date-slots    | built (FA-5)     | A request on a slot has a "Needed by" date and never reads Overdue. A real due date and Overdue appear only on a New brief or a shot list.                                                                 |
| M4-create-from-requirement, M4-new-brief | built            | A New brief has no slot, so a manager marks it completed by hand.                                                                                                                                          |
| M4-required-fields, M4-defaults          | built            | Defaults: the team comes from the slot's category (food goes to the kitchen, everything else to front of house), one photo, normal priority.                                                               |
| M4-optional-fields                       | built            | Person, date, reference image, orientation, video, capture window and shot list. The reference image is offered only as "the slot's current album photo" (there is no general picker).                     |
| M4-task-types                            | built            | Missing photo, replacement, optional angle, fact confirmation and campaign, each with its own completion rule.                                                                                             |
| M4-fact-confirmation-task                | built            | Assigned to a manager or admin. It completes only when the fact reads Confirmed, after a decision or a `knowledge_reconfirm` made after the request. A staff finding moves it to Submitted, not Completed. |
| M4-shot-lists                            | built            | Shows "n of N completed". Cancelling a list cancels its open requests with the same reason.                                                                                                                |
| M4-states                                | built            | Open / Submitted / Completed / Blocked / Cancelled. Blocked means a stored reason or a sold-out slot. A retake reopens the request.                                                                        |
| M4-optional-vs-required                  | built            | Requests never touch `coverage_slots`. A test shows the totals don't change when requests are created.                                                                                                     |

**Hand-off items:** naming a person calls `private.notify(..., 'assigned', 'media_request', ...)`. Changing the person resolves the old notice and sends a new one, and closing the request resolves it.

## Migration

`20261118114000_media_requests.sql` adds three tables:

- `media_requests`
- `shot_lists`
- `media_request_events` (append-only)

It also adds these public functions, each granted to `authenticated` only:

- `media_requests`
- `media_request_detail`
- `my_media_requests`
- `media_request_create`
- `media_request_edit`
- `media_request_set_blocked`
- `media_request_close`
- `shot_list_create`
- `shot_list_cancel`

**Completion is checked when the request is read or written, not by a trigger.** `private.media_requests_settle` runs on every read and write and closes requests whose rule is met. So `closed_at` uses the acceptance or decision time where known, and otherwise the time it was first observed.

It doesn't redefine any S2-INT function and only reads `coverage_slot_rows` and `knowledge_fact_rows`. It applies on a fresh `db reset`. `lib/db/types.ts` was regenerated and contains only my additions.

## Files

- **Mine:**
  - the migration
  - `lib/requests/model.ts`, `lib/server/requests/index.ts`
  - `app/manager/requests/**`, `components/nabalens/requests/**`
  - `tests/security/media-requests.test.ts`, `tests/unit/requests-model.test.ts`, `tests/ui/requests.test.tsx`
- **Outside my ownership, kept small:**
  - `status-chip.tsx`: five `request_*` states added
  - `album-home.tsx`: a new `askedFor` slot
  - `app/staff/tasks/page.tsx`
  - `manager/hrefs.ts`: added `requests`
  - `overview-body.tsx`: a Requests row
  - `lib/ops/notifications.ts`: the notice wording
  - `scope-guard.test.ts`: my routes, plus "campaign" allowed only in my folders
  - `manager-overview.test.tsx`: now expects the Requests link
  - the ui-preview Album block
  - `catalogue.md`
  - `departures.md`: rows A-R1 and A-R2

## Checks

- `pnpm typecheck`: exit 0.
- `pnpm exec eslint . --ignore-pattern '.claude/**'`: exit 0, no warnings.
- Prettier `--check` on changed files: all pass.
- `pnpm test`: the first run had 30 timeout failures while the machine's load average was about 149. Re-running only those 10 files with lower parallelism, nine passed and the tenth was a real scope-guard hit in my ui-preview fixture, which I fixed. Then `pnpm test -- --maxWorkers=4` passed: 385 files, 4813 tests.
- Security tests on a fresh reset of my stack: `media-requests`, `ops`, `coverage-slots`, `facts-freshness` and `album-briefs` passed, 5 files and 92 tests.
- **Skipped:**
  - the full security suite (coordinator's job)
  - browser and e2e checks, including the 320px check, which I did by reading the code: rows wrap and grids collapse
  - `lci` and `verify:release`

## For Sprint 3 and other tasks

- **Routes:**
  - `/manager/requests` with `?show=active|done|all`
  - `/manager/requests/new` with `?mode=new|fact`, `?kind=&slot=` or `?fact=`
  - `/manager/requests/[requestId]`
  - Other screens should link with `requestHrefs.newFor(kind, slotId)` and `requestHrefs.newFact(checkId)` from `components/nabalens/requests/hrefs.ts`.
- **Navigation:** there is no Requests nav tab, because the phone bar is full. S2-MGR owns the nav (spec says Overview / Review / Album / Requests / Venue) and should add `managerHrefs.requests`.
- **Staff journey (AC01):** Album Home has an "Asked for" section (`data-slot="asked-for"`, items have `data-request-id`). Tapping the slot opens the gallery for that slot, so nothing is typed. Staff words never include due, task or request.
- **Test ids:**
  - `data-slot="request-rows"`, `request-form`, `request-controls`, `shot-lists`, `new-shot-list`
  - rows carry `data-request-id` and `data-state`
- **There is no seeded data.** The security file's `venue()` fixture builds a menu, a Bar place and the pilot amenity checks.
- **Things to know:**
  - The example photo is shown to staff through `/api/media/[id]/thumb`.
  - A request with no slot has no link to the photos sent for it. Carrying a request id with uploads would belong to S2-ADD.
  - The "Another photo was asked for" note doesn't include the reviewer's reason.
