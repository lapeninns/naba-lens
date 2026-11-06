# Dish photo guide: implementation plan

Status: plan only, nothing built. The prototype the owner reviewed is the reference
for layout and copy (`/private/tmp/claude-501/-Users-amankumarshrestha-LapenInns-Project-platform-nabalens/08284a79-9946-4254-8d76-a78989e06e26/scratchpad/prototype/index.html`).

## 1. Goal and non-goals

**Goal.** Before a chef photographs a dish for a menu-section task, show them four
example angles and a short checklist, so photos from every venue look alike.

**Non-goals (deliberately out of this PR):**
- No database change and no migration. Nothing needs owner approval for a hosted DB.
- No angle tag on submissions. Counting, review and monthly credit stay as they are
  (spec v0.4 §13: managers judge relevance, presentation and variety).
- No admin upload of samples, no per-venue samples, no automated image checks
  (spec v0.4 §1 keeps automated image scoring and AI out of scope).
- No change to the upload pipeline, the camera flow or the Add sheet.

## 2. Where the guide appears

| Place | What shows | Condition |
| --- | --- | --- |
| Task page `/staff/tasks/[requirementId]` | "How to photograph it" block between "What to photograph" and "On this section" | `requirement.kind === "menu_section"` and `menuSection.sectionKind !== "drinks"`. Shown whether or not the person can send (a closed or unassigned task still teaches). Hidden on the "Send another photo" closed-request view. |
| Guide page `/staff/tasks/guide` (new) | Title "Photo guide", intro, "Every shot" checklist, safety note, four angles with dish buttons | Any active staff member (`requireActiveStaff`). Home stays the active tab. |
| Monthly photos `/staff/tasks/month` | One link "How to photograph a dish" under "Add photos for this month" | Current month only. |
| Manage › Menu (managers) | One sentence: "Staff see the dish photo guide on food sections." | Menu coverage panel, under the plan actions. |

Not shown on amenity, service or venue-specific tasks, or drinks sections: every sample
is food. `sectionKind` null or `"other"` shows the guide (most "other" sections are
food such as sides and sauces; this is the safer default).

## 3. Assets: static, in the repo

**Source:** the 20 images (1–12 and 17–20 are 1448×1086 WebP, 13–16 are 716×537 PNG).

**Committed output** under `public/guide/v1/`, named by dish and angle, not number:

```
public/guide/v1/mixed-grill-45.webp      mixed-grill-45@2x.webp
public/guide/v1/mixed-grill-overhead.webp …
public/guide/v1/naan-… curry-… momos-… mint-curry-…
```

- Two widths per image: 480 px (grid thumbnail) and 1200 px (full-screen viewer).
  Momos stay at their native 716 px for the large size (never upscaled).
- WebP, quality about 78, metadata stripped. Expect about 40 files, roughly 2–3 MB in all.
- Generated once by `scripts/guide/build-guide-images.ts`, which uses `sharp`
  (already a dependency) and reads the source folder from a CLI argument. The script is
  committed, the source images are not.
- Plain `<img srcset sizes width height loading="lazy" decoding="async">`, with the
  repo's existing `eslint-disable-next-line @next/next/no-img-element` pattern. No
  `next/image`: the files are already sized, and this avoids image-optimiser cost and
  a new `images` config.

**Why static, not admin-managed:** no migration, no Storage bucket, policies or signed
URLs, no admin screen to build and test. The CSP already allows `img-src 'self'`.
Admin-managed samples can come later if venues want their own dishes.

**Visibility and caching:**
- `proxy.ts` already skips `.webp`, so the files are served without a session. They are
  generic examples, not venue or staff media. This is acceptable, but it is a deliberate
  choice and goes in the PR description.
- Next serves `public/` with `Cache-Control: public, max-age=0`. Add one `headers()` entry
  in `next.config.ts` for `/guide/v1/:path*` with `public, max-age=31536000, immutable`.
  The `v1` folder makes this safe: new images go in `v2`.
- They never enter `media_assets`, so they never appear in Photos, profiles, the admin
  library, archives or exports.

## 4. Code changes

### 4.1 Data: `lib/guide/dish-guide.ts` (new, pure, no React)

```ts
export type GuideAngle = "three_quarter" | "overhead" | "close_up" | "side"
export const GUIDE_ANGLES: { id: GuideAngle; name: string; tip: string }[]
export const GUIDE_DISHES: { id: string; name: string; images: Record<GuideAngle, { src: string; src2x: string; width: number; height: number }> }[]
export const GUIDE_RULES: string[]
export const GUIDE_SAFETY: string

/** First min(target, 4) angles are suggested; 0 when the target is unknown or < 1. */
export function suggestedAngles(photoTarget: number | null | undefined): GuideAngle[]

/** Whether a task shows the guide: food or unknown menu sections only. */
export function showsDishGuide(requirement: Pick<RequirementView, "kind" | "menuSection">): boolean
```

Copy (from the prototype, approved wording):
- 45° angle: "A little above the plate, phone tilted. Shows the front and height of the dish. Your main shot."
- Overhead: "Phone flat, straight above. Whole plate in, with some dark background around it."
- Close-up: "Move in on texture and garnish. Tap the food on screen so it's in focus."
- Side view: "Phone level with the plate. Shows height and layers."
- Rules: plain dark background, nothing else on the table · dish fills most of the frame ·
  hold your phone sideways · wipe the rim and add the garnish last · shoot straight after
  plating, before it goes out · no flash.
- Safety: "Only take photos when it's safe. Never while carrying hot food or using a knife."
  (matches `docs/operations.md`).
- Dishes: Mixed grill, Garlic naan, Curry, Momos, Mint curry.
- Alt text: "{Dish}, {angle} example".

### 4.2 Components: `components/nabalens/guide/` (new)

- `dish-guide.tsx` (client): dish buttons (`aria-pressed`, horizontal scroll on phone),
  angle grid (2 columns below `md`, 4 from `md`), number badge, "Suggested" badge,
  tip text. Props: `suggested: GuideAngle[]`, `initialDish?`, `headingLevel`.
  Each tile is a real `<button>` that opens the viewer.
- `guide-viewer.tsx` (client): full-screen view built on the existing `components/ui/dialog`
  (focus trap, Escape, return focus), using the `--viewer` / `--on-viewer` tokens like
  `media-viewer.tsx`. Shows "n of 4 · Dish", the large image, dots, angle name, tip,
  Previous and Next (disabled at the ends), arrow keys inside the dialog, swipe on touch
  (pointer events, 40 px threshold). No global key handlers.
- `task-photo-guide.tsx` (server-safe wrapper): heading "How to photograph it", the lede
  ("This section needs 2 photos. Start with the marked angles." / singular form / no lede
  sentence when the target is 4 or more: "Use all four angles."), `<DishGuide>`, the
  "Examples, not your menu." note and the "See the full photo guide" link.
- `index.ts` barrel, matching the other `components/nabalens/*` folders.

Use only design-system tokens and type styles (`text-body-touch md:text-body`,
`text-section-title-touch md:text-section-title`, `rounded-control`, `bg-panel`,
`border-line`, `accent-soft` for the pressed chip, `positive-soft` for "Suggested").
Touch targets 44 px or more. Works in dark mode (the samples' dark backgrounds sit on
`bg-viewer` in the viewer).

### 4.3 Pages

- `app/staff/tasks/[requirementId]/page.tsx`: render `<TaskPhotoGuide>` after
  `<TaskSummary>` when `showsDishGuide(assignment.requirement)` and not `closedRequest`.
  Pass `suggestedAngles(requirement.photoTarget)`. To keep the order "What to photograph →
  guide → On this section", add an optional `guide?: ReactNode` slot to `TaskSummary`
  rendered between the guidance and progress sections (small, typed change; no data
  change).
- `app/staff/tasks/guide/page.tsx` (new): `requireActiveStaff`, `AppShell` with
  `active="tasks"`, `BackToTasks`, `PageHeader` title "Photo guide", rules list, safety
  `Notice`, `<DishGuide suggested={[]} />`. `metadata.title = "Photo guide · Naba-Lens"`.
  Static segment `guide` takes precedence over `[requirementId]`, so no clash; add a
  `loading.tsx` like its siblings. Optional `?from=<requirementId>` turns the back link
  into "Back to {task}" — only if the id is a UUID; otherwise Home. (Kept simple: if this
  adds risk, the back link is always Home.)
- `app/staff/tasks/month/page.tsx`: link "How to photograph a dish" under the
  "Add photos for this month" heading.
- `components/nabalens/coverage/menu-coverage-panel.tsx`: the one-sentence manager note.
- `app/(dev)/ui-preview`: add the guide block and the viewer to the preview fixtures, so
  the visual suite can capture them.
- `next.config.ts`: the cache header entry from §3.

## 5. Tests

**Unit (`tests/unit/dish-guide.test.ts`):**
- `suggestedAngles`: 0, 1, 2, 4, 7, null → [], [45], [45, overhead], all four, all four, [].
- `showsDishGuide`: menu food → true; menu drinks → false; menu `other` / null kind → true;
  amenity, service, venue_specific → false; menu section with `menuSection` null → true.
- Every image entry exists on disk under `public/guide/v1`, both sizes, and its
  width/height match the file (via `sharp().metadata()`), so a missing or renamed file
  fails CI rather than showing a broken image.

**UI (`tests/ui/dish-guide.test.tsx`, jsdom):**
- Renders four angle buttons with accessible names; "Suggested" on the first N.
- Dish buttons switch every image and set `aria-pressed`.
- Opening a tile shows the dialog with "1 of 4 · Mixed grill"; Next/Previous move and
  disable at the ends; Escape closes and returns focus to the tile.
- Task page wrapper: correct lede for 1, 2 and 4+; link to `/staff/tasks/guide`.

**E2E (`tests/e2e/coverage-staff.spec.ts`, existing journey):** on the menu-section task
the block is visible, a tile opens the viewer, and the guide page loads at phone width;
on an amenity task the block is absent. Add the guide page to the axe/contrast and
reflow checks the suite already runs (`contrast-dark.spec.ts`, `reflow.spec.ts`).

**Visual:** capture the task block and the guide page in `tests/visual` if the runner
picks up new preview fixtures without baseline churn elsewhere; otherwise skip and say so.

## 6. Docs

- `docs/usage-staff.md`: under "Send photos to a task", a short "Photo guide" paragraph
  (where it shows, the four angles, "examples only; your manager still decides").
- `docs/usage-admin.md` / staff guide Manage › Menu: one line for managers.
- `docs/media-pipeline.md`: one line that guide images are static app assets, not media.
- PR description: the public-asset decision and the "no migration" note.

## 7. Delivery

1. Create a git worktree from `origin/main` on branch `feat/dish-photo-guide`
   (the shared checkout stays on `docs/production-migration-status`, untouched).
   `pnpm install --frozen-lockfile` in the worktree.
2. Read `node_modules/next/dist/docs` pages for `public` folder, `headers`, and dynamic
   routes before writing code (AGENTS.md).
3. Generate images (§3), commit with the script. Then data → components → pages → docs,
   in small Conventional Commits.
4. Local checks, real output reported: `pnpm typecheck`, `pnpm lint`, `pnpm test`, the
   affected Playwright specs against the local stack (`pnpm stack` / `pnpm test:e2e
   tests/e2e/coverage-staff.spec.ts`), and `pnpm build` (CSP/headers sanity).
5. Check the guide in the browser pane at phone and desktop width, light and dark.
6. `gh auth switch --user lapeninns`, push, open one PR. Rebase on the latest `main`.
7. Wait until the PR #15 `lci` run is finished on the shared runner, then run
   `lci run naba-lens --pr N --post --comment` once on the final head, in a terminal tab
   (about 24 minutes for Chromium).
8. No deploy, no migration, no merge without the owner.

## 8. Risks and open points

- **Public images:** reachable without signing in. Fine for generic samples; if that is
  not acceptable, serve them through an authenticated route instead (more code, no DB).
- **Sample provenance:** the images look staged or AI-made. Confirm the business is happy
  for staff to see them as "examples"; they are never presented as a venue's menu.
- **Momos resolution:** half size; softer full screen. Replace with a larger source when
  available (drop into `v2`).
- **"Other" sections:** guide shows for them; switch to food-only if managers object.
- **Default dish:** always Mixed grill. Matching by section name was rejected (fragile,
  and the spec avoids name-based mapping).
- **Copy:** tips, "No flash" and dish names are proposals the owner may change.

## 9. Estimate

About a day of work: images and data 1 h, components 3 h, pages and docs 1.5 h, tests
2 h, checks and PR 1 h, plus the 24-minute CI run.
