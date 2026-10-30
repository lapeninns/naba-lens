# NabaLens v0.3 menus + labels: QA report (packet J)

**Date:** 30 October 2026 · **Candidate:** integration head `6cb8dd5`
(`feat/nabalens-menus`), tested from `feat/nlm-qa` in
`~/.t3/worktrees/nabalens/nlm-qa`. Local, isolated stack only. Nothing hosted.

**Verdict:** 14 of 15 acceptance rows passed. Row 14 failed on two
accessibility defects (D1, D2). D1 also breaks the existing
`responsive.spec.ts` and `visual.spec.ts` gates. Everything else in the
existing suite passes.

## 1. Environment

| Item           | Value                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code           | `6cb8dd5` + this packet's specs (no production code changed)                                                                                                                                                                                                                                                                                                                                                                    |
| Build          | `pnpm exec next build` (Next.js 16.4.2, Turbopack) with the stack's env; reused by every run (`E2E_SKIP_BUILD=1`)                                                                                                                                                                                                                                                                                                               |
| App            | `next start --hostname 127.0.0.1 --port 3624`                                                                                                                                                                                                                                                                                                                                                                                   |
| Supabase       | Own copy of `supabase/` in `/tmp/nlm-qa/stack`, `project_id = "nlm-qa"`, ports **624xx** (API 62421, DB 62422, Mailpit 62424). Studio, Realtime, analytics and edge runtime disabled. Auth limits raised in this copy only: `email_sent = 100`, `sign_in_sign_ups = 300`, `token_verifications = 300`. `supabase start` then `db reset --local` (migrations through `20261030120100` + DEV FIXTURE seed). Supabase CLI 2.117.0. |
| Browsers       | Playwright 1.64.1: Chromium 1280×800 (all specs), `mobile-chromium` (Pixel 7 emulation, the config's PHONE set), Firefox and WebKit (`@core` journey)                                                                                                                                                                                                                                                                           |
| Agentic runner | e2e 0.16.0 + `@e2e-dev/web` 0.11.2 + playwright 1.64.1; model `chatgpt('gpt-6-luna')` (saved ChatGPT login)                                                                                                                                                                                                                                                                                                                     |
| Node           | 24.16.0, pnpm (frozen lockfile, existing `node_modules`)                                                                                                                                                                                                                                                                                                                                                                        |

Secrets: the ignored `.env.local` holds only this stack's values and was not
committed. No keys, cookies or tokens were printed. Playwright traces and
runner session files were deleted from every artefact folder (they carry
request cookies). A text scan of the kept artefacts found no JWTs or
Supabase keys.

## 2. Commands (all foreground, each under 8 minutes)

```sh
W=/tmp/nlm-qa/stack
E2E_PORT=3624 E2E_PORT_BLOCK=624 node tests/e2e/prepare-stack.mjs "$W"
#   then in $W/supabase/config.toml: project_id "nlm-qa", email_sent = 100
supabase --workdir "$W" start && supabase --workdir "$W" db reset --local
pnpm exec next build                       # env from the owned stack (.env.local)
# /tmp/nlm-qa/pw.sh = E2E_SUPABASE_WORKDIR=$W E2E_PORT=3624 E2E_SKIP_BUILD=1 pnpm exec playwright test "$@"
/tmp/nlm-qa/pw.sh --project=chromium <existing specs, 3 chunks>
VISUAL_PORT=3624 node tests/visual/run.mjs "$W" --no-build --project=chromium -g "staff:"
VISUAL_PORT=3624 node tests/visual/run.mjs "$W" --no-build --project=chromium --grep-invert "staff: "
/tmp/nlm-qa/pw.sh --project=mobile-chromium
/tmp/nlm-qa/pw.sh --project=firefox --project=webkit
QA_SHOTS_DIR=/tmp/nlm-qa/shots/menus /tmp/nlm-qa/pw.sh --project=chromium \
  tests/e2e/menus-admin.spec.ts tests/e2e/menus-labels.spec.ts tests/e2e/menus-responsive.spec.ts
pnpm test:security "$W"
pnpm typecheck && pnpm lint && pnpm test
# agentic runner copy (see §6), app started with pnpm exec next start … --port 3624
./node_modules/.bin/e2e run tests/login.e2e.ts --output results-smoke
./node_modules/.bin/e2e run tests/staff-label.e2e.ts tests/admin-menus.e2e.ts --reporter list,markdown --output results-agentic
./node_modules/.bin/e2e explore '<charter>' --target phone --session staff --max-steps 4 --timeout 420000 --output results-explore-phone
```

## 3. Acceptance matrix (contract §7)

New specs: `tests/e2e/menus-admin.spec.ts` (A), `menus-labels.spec.ts` (L),
`menus-responsive.spec.ts` (R). Logs and screenshots are under `/tmp/nlm-qa/`.
`evidence/menus-final.log` is the final run of all three specs (16 passed,
4 failed, all 4 on D2).

| #   | Scenario                                                                            | Result                               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Import two venue menus (incl. The Railway); venue separation                        | **Passed**                           | A "rows 1+3". Railway → venue 1 (14 sections, Added 125), Prince of Wales → venue 2 (127 items), via the Menus nav. Staff A finds only venue 1 items (Sherpali Chicken yes, Stuffed Tandoori Mushroom no; "Onion Bhaji" is in both files but only venue 1's is offered). Staff C sees the reverse. DB: label item venue = asset venue. The agentic admin journey also imports and activates Prince of Wales.                                                                                                                                                                                       |
| 2   | Malformed input rejected; duplicates, repeated names, variants, ambiguous re-import | **Passed**                           | A "row 2": a PDF is refused in the browser ("Only .json and .csv files can be imported.") and by the route (`400`); malformed JSON and duplicate keys give "Preview failed" with no draft; a BOM/CRLF/quoted CSV previews and drafts with CSV provenance. A "rows 2+4": a key change becomes "Uncertain matches (1)", is resolved as the same item and keeps its item id. Repeated names: Onion Bhaji at two venues. Variants: Momo Veg/Chicken. Import unit tests are in the `pnpm test` run below.                                                                                               |
| 3   | Review + activate; draft never exposed to staff as active                           | **Passed**                           | A "rows 1+3": while venue 1 has only a draft, staff A's editor says "… has no active menu yet" with no menu search. After **Activate for labelling**, the menu is offered. Activation copy says it is not publication.                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Rename, archive, re-import, category move keep historical labels                    | **Passed**                           | A "rows 2+4". After re-import: the renamed item shows "Onion Bhaji Tower" and "labelled as Onion Bhaji". The removed item shows "Not on the current menu" and its item row still exists. The moved item shows its new section. Archiving Momo hides it from staff search and its label shows "Archived". After retire the venue has no active menu (content types only) and all 4 label tuples remain.                                                                                                                                                                                             |
| 5   | Upload photo + video, label both with several items                                 | **Passed**                           | L "rows 5+7", plus the agentic staff journey (§6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | Upload without labels, label later                                                  | **Passed**                           | L "row 6": **Skip for now** leaves the tile "Needs labels", and the asset is already in the admin library. Later, **Add labels** in the viewer saves; after reload the tile reads "2 labels".                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Batch apply, per-file override, persists after reload                               | **Passed**                           | L "rows 5+7": common Momo (Chicken) + Onion Bhaji + Finished dish + note. Per file on the video: removed Onion Bhaji, added Preparation, own note. After reload each viewer shows exactly that. DB: 2 assets, 2 label rows, revision 1, no duplicates.                                                                                                                                                                                                                                                                                                                                             |
| 8   | Missing item; unavailable/stale catalogue handled                                   | **Passed**                           | L "row 8": "Item not on the menu?" text shows in the viewer, appears on the venue's Menus page "(1 open)", is linked to an item, and becomes `resolved`. A new menu activated while staff edit gives "The menu for this venue was updated while you were editing". Nothing was saved, choices were kept, and after **Reload the menu** the save succeeds. Archived items are not offered (row 4). See observation O1.                                                                                                                                                                              |
| 9   | Staff own-only; no cross-staff or cross-venue item via UI/API/DB                    | **Passed**                           | L "row 9": staff B's portfolio never lists A's file. B's real `saveLabelBatch` Server Function request, rewritten in flight to A's asset id, is refused (UI shows not saved, DB 0 rows). RPC as B on A's asset: error. Staff C attaching a venue 1 item: error, 0 rows. Security suite: 236/236.                                                                                                                                                                                                                                                                                                   |
| 10  | Inactive users, deleted media, unfinished uploads keep boundaries                   | **Passed (DB/server layer; no e2e)** | `pnpm test:security` 236/236, including `labels-db` "uploading, failed and deleted assets cannot be labelled…" and "inactive staff and inactive admins are denied…", `labels-server` "treats deleted and unfinished assets as not found; inactive staff as forbidden", and `menus-db` "inactive users and staff see no catalogue rows…". The existing e2e `auth`/`gaps` deactivation tests pass. No labels-specific browser journey was run for this row.                                                                                                                                          |
| 11  | Staff transfer: old asset uses original venue catalogue                             | **Passed**                           | L "row 11": after staff A moves to venue 2, the old asset's editor says "menu of Venue One", offers Sherpali Chicken and not Stuffed Tandoori, and saves a venue 1 item. A new venue 2 asset offers the Prince of Wales menu.                                                                                                                                                                                                                                                                                                                                                                      |
| 12  | Admin correction, combined filters, search, stable pagination, no duplicates        | **Passed**                           | L "rows 12+13": venue + menu item (UI) + Photos gives 24, then **Load more** gives 26, all unique and matching. Content type Preparation gives the 2 videos. Item + variant match the same tuple (2, not the Veg one). Category gives 1. Staff + Needs labels gives 5; Labelled gives 4. Note search (UI) gives 1. `q=Momo` gives 3. A from/to date gives exactly the 2 back-dated uploads. **Clear filters** resets. An admin edits staff B's labels in the viewer: the event actor is the admin, and staff B sees the correction. The agentic admin journey filters by venue + staff + item (3). |
| 13  | Original bytes, upload, preview, download unchanged                                 | **Passed**                           | L "rows 12+13": a labelled real upload downloads with the same SHA-256. Existing `journey`, `library`, `upload-recovery`, `slice` and `negative` suites pass, plus Firefox/WebKit `@core`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| 14  | Phone widths, accessible names, keyboard focus, recovery                            | **Failed (D1, D2)**                  | Passed: no horizontal overflow on any new screen at 360/390/768/1280 (Menus list, venue, import preview, draft editor, activate dialog, library with More filters and the item list open, single and batch label editors). The admin nav is inside the viewport and ≥44 px tall at 360/390 and navigates. Keyboard-only labelling works and focus returns into the viewer. Pixel 7 touch flow works. axe is clean on every label-editor state. Failed: D1 (video tiles in the staff portfolio) and D2 (**Archive item** buttons in the draft editor).                                              |
| 15  | Failures/retries/concurrent stale updates: no silent loss/duplicates                | **Passed**                           | A "row 15": a stale draft save in a second page gives "This draft changed elsewhere", the local edit is kept, and **Reload latest** shows revision 2 (DB: one title, r2). Stale catalogue: row 8. Security: "a stale revision fails with label_conflict…", "concurrent first saves: exactly one wins…", "concurrent activations … exactly one active version", "retries never duplicate".                                                                                                                                                                                                          |

## 4. Defects (for the lead)

**D1. Video tiles fail WCAG 2.5.3 "Label in Name" and break two existing gates. Medium.**

- Where: `components/nabalens/media-tile.tsx`, staff portfolio
  (`showLabelBadge`). A video tile shows the visible text `<0:01 4 labels` (or
  `<0:01 Needs labels`), but its `aria-label` is
  `Video, f.mp4, uploaded …, duration <0:01, 4 labels`. The visible text is not
  a contiguous part of the name because of the comma. Photo tiles pass.
- Repro: as staff with one ready video, open `/staff` and run axe (WCAG 2.x
  tags). Result: `label-content-name-mismatch` (serious) on each video tile.
- Impact on existing gates: `responsive.spec.ts` fails at 360/390/768/1280/1440
  (`staff-portfolio … label-content-name-mismatch`). `visual.spec.ts` fails
  "staff: populated portfolio…" and "staff: dark mode…" (same rule), and
  "staff: video playback by codec" fails because it expects the name to end
  with `/duration <0:01$/` and the name now ends with `, Needs labels`.
- Fix direction: make the visible text appear in the name in order (e.g.
  `…, <0:01 4 labels`, or hide the visual duration/badge text from the name
  computation consistently). Then update the visual spec's `duration` regex.
- Evidence: `/tmp/nlm-qa/evidence/defects/D1-video-tile-name/`
  (`13-after-save.png/.yml` shows the names), `evidence/reg-chunk3.log`,
  `evidence/reg-visual-staff.log`.

**D2. "Archive item" buttons fail WCAG 2.5.3 "Label in Name". Low–medium.**

- Where: `components/nabalens/menus/archive-item-control.tsx`. The visible
  text is **Archive item** but `aria-label` is `Archive Momo`, so a speech
  user saying "click Archive item" doesn't match. The same applies to Unarchive.
- Repro: Admin → Menus → venue → a draft or active version → search "Momo" →
  expand the item → axe: `label-content-name-mismatch` (serious) on
  `button[aria-label="Archive Momo"]`. Seen at all four widths.
- Fix direction: `aria-label="Archive item: Momo"` (starts with the visible
  text), or visible text "Archive" with a name that starts "Archive …".
- Evidence: `menus-responsive.spec.ts` "admin Menus screens at N px" (4
  failures in `evidence/menus-final.log`);
  `evidence/defects/D2-archive-button-name/*.png`.

### Observations (not defects; lead's call)

- **O1:** After a stale-catalogue error, **Save labels** stays enabled while
  **Reload the menu** is still loading. Saving in that window is refused
  again ("Labels not saved") with choices kept, so it is recoverable but
  confusing. Repro and screenshots: `/tmp/nlm-qa/defects/stale-catalogue-race/`.
- **O2 (visual, 360 px):** in the draft editor, the section header truncates
  the section name to "Appe…" next to its kind, count and three icon
  buttons. The sticky save bar wraps to two rows (~20% of a 780 px-tall
  viewport). Accessible names stay complete.
  `/tmp/nlm-qa/shots/menus/0360-menus-draft-editor.png`.
- **O3:** `docs/usage-staff.md` and `docs/usage-admin.md` don't yet describe
  Menus, labelling or the new library filters.
- **O4:** the `mobile-chromium` project's PHONE grep (`playwright.config.ts`)
  doesn't select `menus-*` specs. Phone coverage for these screens comes from
  explicit widths and a Pixel 7 emulated context inside the Chromium project.
  Add `menus-` to that regex if the lead wants the project to run them too.
- **O5:** choosing a menu file before the venue page hydrates is ignored (seen
  only from a script that set files right after navigation; a person can't
  pick that fast). The specs wait for the heading first.

### Screenshot review (my own inspection)

Venues list, venue page, import preview, library filters and label editors at
360 are clean. The nav wraps to its own row under the brand. Long venue names
ellipsise in the list and wrap on the venue page, and provenance values wrap.
Filters stack two per row and the dates fit. The batch editor footer
(**Save labels for 2 files** / **Skip for now**) stays pinned and reachable.
At 1280 the screens use the width well and nothing overlaps. Points worth
attention are O2 and the stacked More-filters panel, which pushes results
below the fold at 360 (expected).
All shots: `/tmp/nlm-qa/shots/menus/{0360,0390,0768,1280}-*.png`.

## 5. Existing suite (regression)

| Spec / suite                                                                                      | Result                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| auth-guards (4), auth (6), filters (1), gaps (4)                                                  | 15/15 passed                                                                                                     |
| journey, library, negative, profile-outage, refresh-hang, security-headers, slice, staff-accounts | 19/19 passed (3.6 min). `Could not load profile: 42501` server logs are from profile-outage's deliberate outage. |
| upload-recovery                                                                                   | 4/4 passed                                                                                                       |
| responsive                                                                                        | 2 passed (keyboard-only, row actions), **5 failed** ("screens and dialogs" at 360/390/768/1280/1440): D1         |
| visual (`pnpm test:visual`, Chromium)                                                             | 12 passed, **3 failed**: D1                                                                                      |
| mobile-chromium (PHONE set)                                                                       | 16 passed, 1 skipped (by the spec itself: gaps GAP-11 over HTTP)                                                 |
| Firefox + WebKit `@core` journey                                                                  | 2/2 passed                                                                                                       |
| `pnpm test:security`                                                                              | 8 files, 236/236 passed                                                                                          |
| `pnpm typecheck`, `pnpm lint`                                                                     | clean                                                                                                            |
| `pnpm test` (unit/UI)                                                                             | 40 files, 338/338 passed                                                                                         |

The visual suite's Firefox/WebKit projects were not run (time). The release
journey ran on both engines instead.

## 6. Agentic e2e runner

**Status: works.** The standalone installation was copied to
`/tmp/nlm-qa/runner` (node_modules symlinked to the same installed packages).
The shared install was not modified. The old `upload-fixtures` folder, which
holds a saved session cookie, was not copied. Version check: e2e 0.16.0,
`@e2e-dev/web` 0.11.2 (peer `e2e >=0.15 <1`, `playwright >=1.63`), playwright
1.64.1. No adapter mismatch this time. Fix applied in the copy: the login
smoke had the main stack's Mailpit port (55424) hard-coded, and now uses 62424. Sign-in is a real magic link through `/login` and this stack's
Mailpit. No secret is filled, so screenshots are kept.

| Run                                 | Result                                     | Deterministic assertions                                                                                                                                     | Model judgments                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke `login.e2e.ts`                | 2/2 passed, 3 model calls                  | validation text, `aria-invalid`, URL, Mailpit message, no overflow at 390                                                                                    | one `agent.act`                                                                                                                                                                                                                                                                       |
| `staff-label.e2e.ts`                | passed (setup + test)                      | exact upload ("1 uploaded"); after reload the tile name ends `, 2 labels`; Labels lists Onion Bhaji and exactly "Finished dish"                              | `agent.act` labelled the file from the upload dialog (5 calls); `agent.assert` on the viewer (passed)                                                                                                                                                                                 |
| `admin-menus.e2e.ts`                | passed (setup + test)                      | preview heading and "Added (127)"; **Retire menu…** visible; venue list shows the Prince of Wales title; URL holds venue + staff + item ids; exactly 3 tiles | `agent.act` create draft + activate (5 calls); `agent.act` set three filters (10 calls); `agent.assert` all tiles by staff B at venue 1 (passed)                                                                                                                                      |
| `explore` charter (390 px, 4 steps) | 3 passed, 1 blocked, step limit; 1 "issue" | —                                                                                                                                                            | Labelling, variants, note, missing item, save and reopen were all verified by the agent. Its finding "Choose files opens no picker" is **not confirmed**: native OS pickers don't render in headless automation, and uploads through the same input pass in every deterministic spec. |

First attempt of `admin-menus` failed on **my** expectation (4 tiles, not
3): the staff journey had just labelled staff A's upload at the same venue.
The goal was narrowed to staff B and both journeys reran green on a fresh
world (`results-*-attempt1` kept). Reports: `/tmp/nlm-qa/runner/results-agentic/report.json`
(`summary.md`), `results-explore-phone/report.json`, `results-smoke/report.json`.
Screenshots are under each `artifacts/web|phone/…/screenshots/`. Total AI use:
about 540k tokens across all runs.

## 7. Not covered

- Physical phones or tablets: only browser emulation (Chromium widths, Pixel 7
  emulation, WebKit desktop engine, which is not iOS Safari).
- Hosted Supabase or Vercel, staging, production, real email delivery, backups.
- Visual-suite Firefox/WebKit projects. Screen readers beyond axe and
  accessible-name checks. Load, performance or large-catalogue timing.
- Row 10 as a browser journey (DB/server tests only). The admin
  "unavailable items → Remove unavailable items" save path in the UI (DB/F
  tests cover `menu_item_unavailable`). The Railway drinks fixture (not imported).
- Real menu accuracy: fixtures are DEV FIXTURE snapshots, not proof of what
  venues serve.

## 8. Artefacts

`/tmp/nlm-qa/evidence/` (logs, regression failure screenshots, defect
folders), `/tmp/nlm-qa/shots/menus/` (40 screenshots + `summary.json`),
`/tmp/nlm-qa/explore/out/` (exploration snapshots),
`/tmp/nlm-qa/defects/stale-catalogue*/`, `/tmp/nlm-qa/runner/results-*`.
