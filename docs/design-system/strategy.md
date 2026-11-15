# Naba-Lens design system: audit, direction and roadmap

Version 0.1 · 14 Nov 2026 · Status: proposal for product and engineering review. Nothing in the app has been changed.

This document covers five things: what exists today (audit), the direction to take, the token and component architecture, the patterns the app should share, and a batch-by-batch roadmap with governance. Section 9 lists the decisions that need an owner before work starts.

**How the audit was done.** Nine read-only passes over `app/`, `components/`, `docs/`, `tests/` and the external design folder, one per area (tokens, primitives, shared components, feature components, routes, product docs, tooling, UX patterns, spec drift). A second, independent pass re-ran every grep and re-opened every cited line. Of 147 findings, 86 were reproduced as stated, 60 were corrected and 1 was refuted; the numbers below are the corrected ones. Counts cover 490 `.ts`/`.tsx` files (about 69,800 lines) and include the dev-only `app/(dev)/ui-preview` unless stated. Nothing was rendered in a browser, so claims about what a person sees are marked as inferred.

---

## 1. The short version

Naba-Lens is not at zero. A design language called Common Room shipped to every screen on 7 Nov 2026 (PR #20), on top of an earlier token set (PR #14). It has a clear idea, a tuned light and dark palette, a 17px text floor, 44px targets and a state vocabulary that never relies on colour alone. Those are the right foundations for staff in their forties and older using a phone in the middle of a shift, and they should be kept.

What is missing is the system around the look. Four problems account for most of the inconsistency:

1. **The spec is not in the repo.** `app/globals.css` names a folder on one machine as its source of truth. 46 code comments in 38 files cite `DESIGN.md §n`, a file git has never held. The spec itself is headed "proposal, not yet signed off by product".
2. **Token values are disciplined but the names are not.** There are no raw palette colours anywhere, yet three naming layers coexist and the code uses a hybrid: text in the old names (`text-ink` 437, `text-ink-muted` 520), surfaces in the new ones (`bg-surface` 193). Borders and state rails have no token at all, so 121 of 288 shadow utilities are hand-written strings.
3. **Shared components exist but are not used.** The shared `Card` is in 12 product files while the same white card is hand-typed on about 145 lines in 98 files. Six Common Room components have one consumer each. Textarea, Checkbox, Radio, Spinner, a segmented control and a filter pill do not exist as primitives, so each is rebuilt per feature.
4. **Nothing enforces any of it.** ESLint is the stock Next.js config. The "visual" test suite takes screenshots but compares nothing and is skipped in every CI lane. The component preview shows 8 of 18 primitives and no test visits it.

The recommendation is therefore to **govern and complete Common Room, not replace it**: bring the spec into the repo, settle one vocabulary, add the missing primitives, migrate the hand-typed copies, move the app shell into layouts, and add cheap static checks so the drift cannot return. A new visual identity would cost a third redesign in three weeks and fix none of the four problems above.

---

## 2. Product and users

### 2.1 Who uses it

| Audience                           | Device and setting                                      | Main job                                                                    | Where                                                        |
| ---------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Staff (chefs, bar, front of house) | Own phone, mid-shift, one hand, kitchen or bar lighting | Photograph a dish, drink or amenity and send it to a task                   | `/staff` (23 pages)                                          |
| Venue manager                      | Phone, tablet, office desktop                           | Get every active menu item to an accepted photo; review and ask for retakes | `/manager` (10 pages), and legacy `/staff/manage` (10 pages) |
| Admin                              | Desktop                                                 | Cross-venue library, accounts, menus, coverage oversight                    | `/admin` (21 pages)                                          |

Production went live on 2 Nov 2026 as a three-venue pilot. The audience description that justifies the 17px floor ("staff aged 40 and over, who scroll social feeds every day") exists only in the external spec. No in-repo product document says who the users are beyond their role, or takes a position on reading level or English as a second language.

### 2.2 What the product already does well

- **A consistent plain voice.** British English, sentence case, no exclamation marks. There are no uses of "Oops", "Sorry" or "Successfully" in the app, and "Approved", "Rejected" and "Published" never appear as states.
- **Honest feedback.** The product distinguishes a lost reply from a refusal, promises "nothing is sent twice" when that is true, and keeps typed input when a session ends. These rules are worked out in detail in `docs/qa/charters/`.
- **One state table.** `components/nabalens/status-chip.tsx` maps 38 states to a word, an icon and a reserved shape.
- **A strong runtime accessibility gate.** axe (WCAG 2.2 A and AA), dark contrast, reflow at 320px and 200% zoom, forced colours, focus-not-obscured and 44px targets all run against real routes in CI.

### 2.3 Product-level problems a design system has to absorb

| #   | Problem                                                                                                    | Evidence                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Two venue-manager products ship side by side, with different tabs and different meanings for the same word | `/staff/manage` and `/admin/coverage/[venueId]` show 7 tabs built from `components/nabalens/coverage`; `/manager` shows 4 built from `components/nabalens/manager`. "Review" is the checklist queue in one and the menu-photo queue in the other |
| P2  | The role model is written two ways                                                                         | README and spec v0.4: two roles, manager is a grant. Manager guide and workspace plan: a separate account type                                                                                                                                   |
| P3  | One decision has several names                                                                             | "Ask for another photo" and "Ask for a better photo"; "Withdraw acceptance" and "Undo acceptance"; "Log out" and "Sign out" in one copy object                                                                                                   |
| P4  | The state table is bypassed about as often as it is used                                                   | About 57 `<StatusChip tone=…>` free-text uses against about 64 `state=` uses. Manager-workspace and amenity states are defined outside it                                                                                                        |
| P5  | Four separate counts with no shared scope pattern                                                          | Personal month, venue checklist, Our menu coverage, amenity checks. The spec's "two counts, never added" rule predates the last two                                                                                                              |
| P6  | Accessibility commitments are ahead of the evidence                                                        | No screen-reader pass and no physical-phone pass is recorded. All UI-quality checks in CI run in Chromium only, for a phone app whose staff mostly use Safari                                                                                    |
| P7  | Docs lag the product                                                                                       | README's route list omits `/manager`; specs call Home "My tasks"; `docs/architecture.md` describes the UI as "Template home page only"                                                                                                           |

P1 is the root cause of most duplicated components (two review queues, two menu lists, two navs, two shells). Component extraction alone will not remove it. It needs a product decision (section 9, D3).

---

## 3. Audit

### 3.1 What to keep

| Area                   | Keep                                                                                                               | Why                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens                 | The OKLCH values in `app/globals.css`, light and dark                                                              | All 24 colour tokens match the spec in both themes. Every text pair computes to 4.89:1 or better; state text on tint is 6.2 to 8.8:1                                                   |
| Colour discipline      | The habit                                                                                                          | 0 raw Tailwind palette classes, 0 `bg-white`/`text-black`, 2 `dark:` variants in 490 files. Dark mode comes entirely from tokens                                                       |
| Type floor             | `text-xs/sm/base` remapped to 17px                                                                                 | Protects the floor against pasted snippets. 98% of 927 font-size uses are on the scale                                                                                                 |
| Radius roles           | `rounded-card` (193), `rounded-control` (112), `rounded-round` (87)                                                | About 97% of radius uses are on-system                                                                                                                                                 |
| Base accessibility CSS | Global 3px focus outline, reduced-motion switch, forced-colours fallbacks, tab-bar scroll padding                  | Already centralised in `globals.css:462-527` and guarded by `tests/unit/focus-outline-style.test.ts`                                                                                   |
| Primitives             | `Button`, `Field` family, `Input`, `Dialog`/`AlertDialog`, `Skeleton`/`SkeletonRegion`                             | Button carries 93% of buttons. Dialogs are bottom sheets on phones with safe-area padding. There are no custom overlays and no direct `@base-ui/react` imports outside `components/ui` |
| Patterns               | `StatusChip` + `CHIP_STATES`, `Notice`, `PageHeader`, `EmptyState`, `ErrorState`, `LoadMoreButton`, `OptionSelect` | Each is the single well-adopted answer to its problem (Notice 140 uses, PageHeader 58 files)                                                                                           |
| Common Room components | `Card`, `Row`, `Section`, `Post`, `IconDisc`, `ActionDock`, `ProgressSegments`                                     | Small, presentational, server-safe, with `data-slot` hooks                                                                                                                             |
| Behaviour              | No toasts, load-more only, deterministic back links, per-feature `*_COPY` modules                                  | Consistent decisions that should become written rules                                                                                                                                  |
| Tests                  | The e2e accessibility specs and the helpers inside `visual.spec.ts`                                                | Stronger than the checker in the research folder                                                                                                                                       |

### 3.2 Findings, by area

Severity: **H** blocks consistency or accessibility broadly, **M** recurring inconsistency, **L** polish.

**Source of truth**

| ID  | Sev | Finding                                                                                                                                                                                                                                                         |
| --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | H   | The spec, the token source and the "living reference" all sit outside the repo in an unversioned folder. The spec is still marked as an unapproved proposal                                                                                                     |
| S2  | H   | At least five design sources disagree: `DESIGN.md` v0.3, its CSS and contract (still labelled v0.2), the superseded Pass Rail doc, the claude.ai Design System artifact from PR #14, and two later Home prototype canvases whose direction no spec has absorbed |
| S3  | M   | `AGENTS.md` and `README.md` contain no design guidance, so an agent or new contributor has nothing to follow                                                                                                                                                    |

**Tokens**

| ID  | Sev | Finding                                                                                                                                                                                                                                          |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | H   | Three colour vocabularies (Common Room, earlier names, shadcn slots) generate 74 colour utilities for about 30 roles. The same fill can be written `bg-well`, `bg-surface-2` or `bg-muted`. `--info` means grey in one layer and teal in another |
| T2  | H   | No token for edges. Field borders, hairlines, state rails and selection rings are inset box-shadows typed by hand: 121 uses of 29 distinct strings, at 1, 1.5, 2, 2.5 and 3px                                                                    |
| T3  | M   | 37 of 126 `@theme` tokens are unused; 6 root properties are referenced nowhere                                                                                                                                                                   |
| T4  | M   | 29 type names cover 8 sizes; 15 of them resolve to 17px. The seven `*-touch` names duplicate their twins. 49 of the 70 `text-x-touch md:text-x` pairs do nothing; the other 21 switch line-height or weight at `md`, probably by accident        |
| T5  | M   | Type tokens cannot carry a font family in Tailwind v4, so the display face is paired by hand 146 times and has drifted (8 of 39 row titles use it; the spec says body face)                                                                      |
| T6  | M   | Sizes, gutters and motion sit outside `@theme`, forcing the `-(--token)` form 310 times                                                                                                                                                          |
| T7  | M   | Non-text contrast is marginal in dark: field edge 3.34:1, solid primary button 2.70:1 against the surface. `--line` (1.43:1) is the only edge of the progress track                                                                              |
| T8  | M   | Theme switching is a bare `d` keypress on every route in production, with no visible setting and no way to turn it off (WCAG 2.1.4). The spec says "light by default, dark is a user choice"; the code follows the OS                            |
| T9  | L   | No named z-index scale (the de facto order 10/20/30/40/50 is coherent, just unwritten), no named container sizes (7 arbitrary container thresholds, two pairs the same value in different units), no spacing semantics beyond two gutters        |
| T10 | L   | No `viewport` export anywhere: no theme colour, and no `viewport-fit=cover`, so the 14 safe-area calculations may resolve to 0 on iPhone (inferred; needs a device check)                                                                        |

**Primitives (`components/ui`)**

| ID  | Sev | Finding                                                                                                                                                                                                                                |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | H   | No Textarea (6 raw, 4 class recipes, two edge weights), no Checkbox or Radio (20 native inputs, two sizes, three accent classes that differ in dark), no Spinner (24 inline copies), no Combobox (2 hand-built)                        |
| C2  | H   | Button has 10 variant names for 6 styles and 9 size names for 4 sizes, both vocabularies live. `size="touch"` is written 161 times in production although it is the default                                                            |
| C3  | H   | Button defaults to solid blue. 57 call sites are blue by omission, which makes "one primary per screen" opt-out. The spec's own builder defaults to grey                                                                               |
| C4  | H   | Four segmented-control implementations and five copies of the filter pill, with different ARIA semantics. `ToggleGroup`'s grey track does not render at its only production site because `variant` has no default (inferred from code) |
| C5  | M   | `SelectItem` has no keyboard focus outline; the dropdown menu documents why the same tint fails 3:1 and fixes it, but the fix was not copied                                                                                           |
| C6  | M   | Size, disabled and data-attribute conventions differ per primitive. `sm` means 44px on Button, 32px on Avatar and a 36px hit area on Switch                                                                                            |
| C7  | M   | Dialog has no size prop: 13 width overrides with 9 values, six at `sm:` although the base only leaves sheet layout at `md`. Dialog and AlertDialog class strings have already drifted apart                                            |
| C8  | M   | Table has no phone behaviour: 5 table screens use 4 different strategies and 3 use raw `<table>`                                                                                                                                       |
| C9  | L   | Badge has no production use, Alert has one (Notice has 70 files). 63 links are styled with `buttonVariants` by hand                                                                                                                    |

**Shared and feature components**

| ID  | Sev | Finding                                                                                                                                                                                                                                         |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | H   | Card recipe hand-typed in about 98 files; section headings hand-typed 79 times against `SectionHeader` in 4 files                                                                                                                               |
| F2  | H   | Three list-and-row systems (Common Room `Row`, coverage `ItemRow`, raw `divide-y` in 19 files); five progress-bar implementations for the same accepted/submitted/needed bar, with three different `aria-valuemax` conventions                  |
| F3  | H   | Ten separate `Tone` type declarations and 14 tone words in props for a system with four tones. Two adapter maps disagree (`muted` is `closed` in tasks and `neutral` in coverage). A second component also named `StatusChip` lives in `tasks/` |
| F4  | H   | `components/nabalens/coverage/` is an unofficial shared kernel: 25 files in other features import from it. Evidence photos have three implementations                                                                                           |
| F5  | M   | Search field rebuilt in 9 files; sticky action bar in 4 ways; inline error text hand-rolled about 34 times in 10 class recipes                                                                                                                  |
| F6  | M   | The amenities folder still uses the earlier dialect (59 of the `-touch` classes, `text-negative`, its own input style at 48px and 36px instead of the 56px field) and imports no Common Room component                                          |
| F7  | M   | The shared folder is flat: 37 files mixing a 13-line badge, a 1,448-line draft store and a session guard. 34 barrel imports against 535 deep imports                                                                                            |
| F8  | M   | Four files exceed 1,100 lines and hold most of the local class constants, which makes incremental adoption harder                                                                                                                               |

**Routes and application shell**

| ID  | Sev | Finding                                                                                                                                                                                                                          |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | H   | `/manager` mounts its shell in the layout; `/staff` and `/admin` render `AppShell` inside every page (37 files, 40 hand-written `active` values). Two shell implementations duplicate the skip link, header and `<main>` classes |
| R2  | H   | As a result, 0 of 22 staff loading files and 0 of 14 staff error files keep the navigation. A staff error leaves a person with "Try again" and no tab bar                                                                        |
| R3  | M   | Five families of error screen, four of not-found, four treatments of "you can't see this". One record-level not-found has no `h1`                                                                                                |
| R4  | M   | Admin sub-routes fall back to another section's states: a failed Staff page is reported as a failed Content library                                                                                                              |
| R5  | M   | Staff navigation differs between phone and desktop (Our menu and Manage have no phone tab); the staff 404 highlights the Me tab because `active` defaults to it                                                                  |
| R6  | M   | No shared back link (20 files draw their own arrow) and routes reach six levels deep                                                                                                                                             |
| R7  | L   | No root metadata or title template; 56 pages repeat "· Naba-Lens" by hand                                                                                                                                                        |

**Cross-cutting UX**

| ID  | Sev | Finding                                                                                                                                                                                         |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | H   | Forms are hand-wired: no `useActionState`, five names for the pending flag, 18 of 32 form files bypass `Field`, and 47 raw `<label>` sit beside 45 `FieldLabel`                                 |
| U2  | M   | Success feedback depends on the feature: inline positive Notice, a dismissible outcome notice, or closing the dialog and refreshing silently                                                    |
| U3  | M   | Live regions are mixed: every `FieldError` is `role="alert"`, so several invalid fields announce at once (inferred)                                                                             |
| U4  | M   | Images are 16 raw `<img>` with no shared component, aspect box or `sizes` contract                                                                                                              |
| U5  | L   | No required/optional convention ("(optional)" typed at 13 sites); icon sizes are implicit (10 values) and 67 icons lack `aria-hidden`; unsaved-changes protection exists in 3 of about 32 forms |

**Tooling and governance**

| ID  | Sev | Finding                                                                                                                                                 |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | H   | No lint rule or test prevents off-token values or raw elements. `pnpm lint` has no `--max-warnings`, so even the six a11y rules Next ships are advisory |
| G2  | H   | `visual.spec.ts` has no baselines and no pixel assertions, and skips itself in every CI lane                                                            |
| G3  | M   | The preview shows 8 of 18 primitives, has no variant-by-state grid, contains two overlapping galleries, and no test loads it                            |
| G4  | M   | No primitive contract tests (one of 18 has a test). No test reads `globals.css`; the class-merger's list of type and radius names is a hand copy        |
| G5  | M   | `verify:change` has no path for a design change: nothing maps an edit to `globals.css` or `components/ui` to the specs that guard it                    |
| G6  | L   | Prettier (with the Tailwind class sorter) is configured but never checked                                                                               |

One practical note: the untracked `app/(dev)/ui-preview/home/` in the working tree is not in the scope-guard allow-list (`tests/unit/scope-guard.test.ts:66`), so that unit test will probably fail until the route is listed. This was read from the code, not run.

---

## 4. Direction

### 4.1 Idea

Keep the Common Room idea as written: **a staff room you already know how to use.** A light grey canvas, white cards, grey buttons, one blue action. Familiar patterns from a feed, with Naba-Lens's own palette and type. No new visual identity.

What makes it distinctive is restraint and honesty rather than decoration, and the system should protect four signatures:

- **Rationed blue.** One solid blue button per screen. Blue never marks a state.
- **State by word, shape and tone.** Reserved shapes (the Accepted square, the Ready pill, the Complete stamp, the hatched Needs setup tag) that no other label may borrow.
- **Legible by default.** Atkinson Hyperlegible at 17px minimum, Figtree for headings and counts, mono for times and numbers.
- **Photos judged on a dark stage.** Camera and viewer are dark in both themes.

### 4.2 Principles

The six principles in the spec stand. Two are added for the system itself.

1. **Feels familiar.** Feed, posts, bottom tabs. Nothing to learn.
2. **One next step.** One primary per screen, inside thumb reach.
3. **State is a word, a shape and a tone.** Never colour alone.
4. **Scope is always on screen.** Every count says whose it is, where and for which period.
5. **Honest feedback.** What happened, then what to do, then reassurance when true.
6. **Built for a busy shift.** 17px floor, 44px targets, 52 to 60px main buttons.
7. **One way to build each thing.** _(new)_ A pattern is written once and used everywhere. A second implementation is a defect, even when it looks identical.
8. **Rules are checked, not remembered.** _(new)_ A rule that matters has a test, a lint rule or a type behind it.

### 4.3 Existing assumptions to change

| Today                                         | Change to                                                                                 | Why                                                                                            | Trade-off                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Button is blue unless told otherwise          | Default is grey; `variant="primary"` is explicit                                          | Makes the rationing rule the path of least resistance and makes primaries greppable            | 57 call sites need an explicit variant                                                       |
| Three token vocabularies                      | One public vocabulary; shadcn slots become private plumbing for `components/ui`           | A contributor should be able to predict the class                                              | A one-time codemod of 30 to 60 minority uses, plus rewriting the spec's token table to match |
| 29 type names                                 | About 14 roles; weight is part of the role                                                | 15 names for one size is not a scale                                                           | The 21 `-touch` pairs that are not no-ops need a decision each                               |
| Shell rendered by each page                   | Shell in each surface's layout, active section from the pathname                          | Navigation survives loading and errors; 40 hand-passed props disappear                         | The largest structural change in the plan; touches every staff and admin page                |
| Theme follows the OS, toggled by pressing `d` | A visible setting (System, Light, Dark) on Me and Account; hotkey removed from production | The current behaviour contradicts the spec and fails WCAG 2.1.4                                | Needs a product decision (D2)                                                                |
| Warn and danger share one tone                | Keep, and say so                                                                          | The three-tone rule is documented and deliberate. A fourth tone would weaken "state is a word" | Delete the names that imply a difference (`negative`, `attention`, `destructive`)            |
| "Done" is banned everywhere                   | Ban it as a _state_ word only                                                             | Two close buttons say "Done" and read naturally                                                | Small spec edit (D5)                                                                         |
| The research folder is the source of truth    | The repo is                                                                               | It is the only place reviews, CI and agents can see                                            | The research folder becomes an archive                                                       |

---

## 5. Foundations: token architecture

### 5.1 Three tiers

| Tier                 | What                                                                                                           | Where                                                                | Who may use it                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| 1. Values            | Raw OKLCH, rem and ms values per theme                                                                         | `:root` and `.dark` in `app/globals.css`                             | Only tier 2                                 |
| 2. Semantic tokens   | A role name bound to a value: `surface`, `ink`, `edge`, `ok-fg`                                                | `@theme` in `app/globals.css`                                        | All application code, as Tailwind utilities |
| 3. Component recipes | Named compositions that need more than one property: focus ring, field edge, state rail, type role with family | `@utility` rules in `globals.css` and cva recipes in `components/ui` | All application code                        |

`app/globals.css` stays the single token file. Tailwind v4 is CSS-first and there is no config to keep in sync, so a separate JSON token pipeline would add a build step for no present consumer. If tokens are later needed outside CSS (email, charts, manifest), generate them from the CSS with a small script; do not hand-copy.

The shadcn slot names (`--background`, `--primary`, `--muted`…) stay only as a private compatibility block so `shadcn add` output still compiles. They are not exposed as utilities and a test forbids them in `app/` and `components/nabalens/`.

### 5.2 Colour vocabulary (proposed canon)

The choice follows measured use, so the codemod is small. Text keeps the `ink` names (957 uses) and surfaces keep the Common Room names (336 uses). The one rename that touches many files is `border-strong` to `edge-strong`, which happens anyway when the hand-written shadows are replaced.

| Role                      | Token                                                            | Replaces                                                                       | Notes                                               |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Page canvas               | `canvas`                                                         | `bg`, `paper`, `background`                                                    | Removes the `bg-bg` stutter; 15 uses                |
| Card, bar, sheet          | `surface`                                                        | `panel`, `card`, `popover`                                                     |                                                     |
| Grey button, field        | `surface-2`                                                      | `well`, `fill-hover`, `muted`, `secondary`                                     |                                                     |
| Hover on grey             | `raised`                                                         | `fill-press`                                                                   |                                                     |
| Text                      | `ink`                                                            | `fg`, `foreground`                                                             |                                                     |
| Secondary text            | `ink-muted`                                                      | `fg-muted`, `muted-foreground`                                                 |                                                     |
| Tertiary text             | `ink-subtle`                                                     |                                                                                | Keeps its own value                                 |
| Decorative divider        | `line`                                                           | `border`                                                                       | 1.43:1, never the only boundary of a live control   |
| Perceivable boundary      | `edge-strong`                                                    | `border-strong`, `line-control`, `input`                                       | Must hold 3:1 against its neighbours in both themes |
| Primary fill              | `accent`, `accent-hover`, `on-accent`                            | `primary`                                                                      |                                                     |
| Active tab, selected edge | `accent-text`                                                    |                                                                                |                                                     |
| Selected fill             | `accent-soft`                                                    |                                                                                |                                                     |
| Selection mark            | `select`, `on-select`                                            |                                                                                | Theme-aware already                                 |
| Focus                     | `focus`                                                          | `ring`                                                                         |                                                     |
| Tones                     | `ok-fg/bg`, `warn-fg/bg`, `info-fg/bg`                           | `positive*`, `attention*`, `negative*`, `destructive`, `warning*`, old `info*` | Three tones plus neutral                            |
| Photo surfaces            | `stage`, `on-stage`, `on-stage-muted`, `plate`, `scrim`, `hatch` | `viewer*`, `on-tile-badge`                                                     |                                                     |
| Avatar                    | `avatar-fill`, `on-avatar`                                       | Two raw `oklch()` literals                                                     | Hue is the only input                               |

Value changes: lift dark `--border-strong` from L 0.60 to about 0.65 (4.07:1 on `surface-2`), and give the dark primary button a 1px lighter edge so its boundary clears 3:1. Everything else stays.

### 5.3 Edges and elevation

Edges become utilities instead of arbitrary shadows. Five strings cover 70 of the 121 current uses.

| Utility                     | Draws                       | Replaces                             |
| --------------------------- | --------------------------- | ------------------------------------ |
| `edge`                      | 1px inset `line`            | Hairline on a tile or disabled field |
| `edge-strong`               | 1px inset `edge-strong`     | Field and grey control boundary      |
| `edge-selected`             | 1.5px inset `accent-text`   | Selected pill or row                 |
| `edge-invalid`              | 2px inset `warn-fg`         | Invalid field                        |
| `ring-selected`             | 3px inset `select`          | Picked photo tile                    |
| `rail-start-{ok,warn,info}` | 4px bar on the leading side | Tone bar on a card or notice         |
| `rail-top-{ok,warn,info}`   | 4px bar on top              | Lead card tone                       |

Rails compose with elevation through a CSS variable, so `shadow-card rail-start-warn` works without a combined string. Elevation has four levels: `shadow-card`, `shadow-float`, `shadow-control` (the raised segment and switch thumb, today a copied `oklch` literal in five files) and `shadow-bar` (exists, unused).

### 5.4 Type

Roles are defined by size, line height, weight and family together. Because a Tailwind v4 text token cannot set a family, heading roles are delivered by a `Heading` component and by `type-*` utilities; body roles stay as `text-*` tokens.

| Role            | Size / line / weight        | Family        | Used for                                                      |
| --------------- | --------------------------- | ------------- | ------------------------------------------------------------- |
| `count`         | 46 / 0.95 / 800             | Figtree       | The one big number on a card                                  |
| `display`       | 34 / 1.05 / 800             | Figtree       | First-run and sign-in headings                                |
| `page-title`    | 26 / 1.15 / 750             | Figtree       | The page `h1`                                                 |
| `section-title` | 21 / 1.25 / 700             | Figtree       | Section `h2`, card title                                      |
| `heading-sm`    | 19 / 1.3 / 700              | Figtree       | Sub-heading inside a card _(in the spec's CSS, never ported)_ |
| `item-title`    | 18 / 1.3 / 700              | Atkinson      | Row title                                                     |
| `lead`          | 18 / 1.5 / 400              | Atkinson      | Intro paragraph                                               |
| `field`         | 18 / 1.3 / 400              | Atkinson      | Text inside inputs _(new name for an existing literal)_       |
| `button`        | 18 / 1.2 / 700              | Atkinson      | Button label                                                  |
| `body`          | 17 / 1.5 / 400              | Atkinson      | Default text                                                  |
| `label`         | 17 / 1.3 / 600              | Atkinson      | Field label, strong inline text                               |
| `meta`          | 17 / 1.3 / 400              | Atkinson      | Secondary line (with `ink-muted`)                             |
| `mono`          | 17 / 1.3 / 600, tabular     | Atkinson Mono | Times, counts, percentages                                    |
| `tab-label`     | 17 / 1.1 / 600 (800 active) | Figtree       | Tab bar                                                       |
| `caption`       | 15                          | Atkinson      | Only over a photo, on a plate                                 |

Removed: the seven `*-touch` names, `body-sm`, `meta-strong` (use `label`), `count-sm`, `chip-touch`, `card-title` (use `section-title`), `page-title-compact` (use `page-title`), the `wdth` utilities. `text-xs`, `text-sm` and `text-base` stay remapped to 17px as a guard and are forbidden in source by test. Weight utilities may not override a role; `font-normal` used to undo a token weight (18 uses) is the sign of a wrong role.

As shipped in Batch 1, `page-title` is 26px at every width. An earlier draft of this table gave it a 24px step below `md`; that would have shrunk every page heading that was already 26px on a phone, the shared page header included, to keep 7 compact ones at 24px. Folding `card-title` and `page-title-compact` into these roles changes what 16 headings draw; `DESIGN.md` section 10 lists them.

### 5.5 Space, size and layout

- **Scale.** Tailwind's 4px scale stays. Half-steps (`gap-1.5`, 177 uses) are allowed inside components and discouraged in page layout.
- **Semantic spacing in `@theme`.** `--spacing-gutter` (12px, card gap in a feed) and `--spacing-page-gutter` (12px phone page gutter) give `gap-gutter` and `px-page-gutter` in place of 175 parenthesised uses. The name is not `page`: Tailwind reads `--spacing-*` before `--container-*`, so `max-w-page` would become 12px.
- **Containers in `@theme`.** `--container-feed` (37.5rem), `-reading` (40rem), `-page` (75rem), `-dialog` (35rem), `-dialog-wide` (47.5rem) give `max-w-feed` and so on.
- **Control sizes.** Target minimum 44; button 52, large 60, small 44; field 56; row 64; tab 60. Named once in the primitives, not retyped (`min-h-11` appears 57 times today).
- **Icon sizes.** 18 (inline with text, chips), 20 (default in controls), 24 (standalone), 36 (icon disc). Today there are 10 values including `size-[18px]` 25 times.
- **Breakpoints.** Base is the phone. `md` (768px) is the single switch to desktop layout. `lg` is for wide tables and the admin side nav only. `sm` is not a layout breakpoint; its 120 uses are reviewed and most become `md` or a container query. Narrow phones are handled by wrapping, not by a breakpoint, with two named exceptions (359px, 400px).
- **Container queries** for reusable components, with three named sizes: `compact` 32.5rem, `regular` 36rem, `wide` 40rem. These replace seven arbitrary thresholds.
- **Design sizes** for review and tests: 320, 390, 768, 1024 and 1280 wide. 320 is added to the test matrix; the spec promises it and the visual matrix starts at 360.

### 5.6 Radius, layers, motion

- **Radius.** One name per value: `control` 8, `card` 12, `sheet` 16, `round` full, `square` 4, `stamp` 2. `panel`, `touch`, `chip` and `print` become aliases for one batch and are then deleted, as are the unused Tailwind `sm` to `4xl` overrides.
- **Layers.** Name the order that already exists: `z-local` 10, `z-sticky` 20, `z-dock` 30, `z-nav` 40, `z-overlay` 50.
- **Motion.** Three tokens with a job each: `quick` 150ms (hover, press), `move` 180ms (disclosure, reorder; unused today, either assign it or delete it), `sheet` 260ms (sheets rise). One easing, `ease-out`. Tailwind's default transition duration and easing are set to these tokens so a bare `transition-colors` is correct. Reduced motion is handled once, by the global rule; per-element `motion-safe:` is kept only for transforms.
- **Safe areas.** Add `viewport-fit=cover` and a theme colour per scheme through a root `viewport` export, then one `--safe-bottom` variable used by the tab bar, docks and sheets. Check on a physical iPhone before and after.

### 5.7 Themes and accessibility in the foundations

- Light and dark are both first-class. Dark is never built with `dark:` variants; it comes from tokens. Camera and viewer wrap their content in a `.dark` scope so chips and text inside inherit correctly (today they only set a stage colour).
- A contrast table lives next to the tokens with a minimum per pair, and a unit test recomputes it from `globals.css`: 4.5:1 for text, 3:1 for boundaries, icons and focus.
- Focus is one utility, `focus-ring` (3px `focus`, 2px offset), with `focus-ring-inset` for rows and tiles. The base rule sets the full `--focus` colour instead of the stock half-opacity ring. This replaces 91 hand-copied class strings.
- Forced-colours fallbacks stay and are extended to each new primitive.

---

## 6. Component architecture

### 6.1 Layers

| Layer         | Folder                             | Contains                                                                                           | May import           |
| ------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| 0. Tokens     | `app/globals.css`                  | Values, semantic tokens, recipes                                                                   |                      |
| 1. Primitives | `components/ui/`                   | One control each, wrapping Base UI where it exists. No product words, no data                      | Tokens               |
| 2. Patterns   | `components/nabalens/common-room/` | Product-shaped compositions: Card, List, Section, Notice, StatusChip, PageHeader, FilterBar, Shell | Primitives           |
| 3. Features   | `components/nabalens/<feature>/`   | Domain logic and screens' parts: tasks, review, menus, amenities                                   | Patterns, primitives |
| 4. Routes     | `app/`                             | Data loading, layouts, state files. No class strings beyond layout                                 | Features, patterns   |

Atomic design is useful here only as this dependency rule: a lower layer never imports a higher one. The audit found it broken in four places (`login-card.tsx` imports from `app/`, three review files import server actions from `app/manager/actions`). An import lint rule enforces it.

Folder names stay. With 535 deep imports, renaming `common-room` to something generic would be churn with no benefit. What changes is membership: `Notice`, `StatusChip`, `PageHeader`, `EmptyState`, `ErrorState`, `OptionSelect`, `SectionTabs` and the shared parts of `coverage/layout.tsx` move into the pattern layer, and non-visual logic (upload queue, session guard) moves to `lib/` or `hooks/`. The pattern layer is imported through its barrel; features are imported by file; the half-complete root barrel is removed.

### 6.2 Contract for every primitive

| Concern            | Rule                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variants and sizes | cva. Variant names from one list: `primary`, `secondary`, `quiet`, `danger`, `danger-quiet`, `link`. Sizes from one list: `sm` (44), `md` (52, or 56 for fields), `lg` (60). The same word means the same height on every control |
| Tone               | One exported type: `neutral`, `info`, `ok`, `warn`. Urgency (status or alert) is a separate prop where it matters                                                                                                                 |
| Props              | `as` for the element, `tone`, `size`, `variant`, `actions` for a slot of buttons. `className` is merged last and is for layout only                                                                                               |
| Hooks              | `data-slot` on every part; `data-variant`, `data-size` and `data-tone` on the root                                                                                                                                                |
| States             | Hover, focus-visible, pressed, selected, disabled, invalid and busy are designed and shown in the gallery                                                                                                                         |
| Disabled           | Prefer `aria-disabled` so the control stays focusable and can say why. One visual treatment: grey fill, label kept                                                                                                                |
| Accessibility      | Real `button` and `a`. 44px minimum target. Never colour alone. Works in forced colours                                                                                                                                           |
| Proof              | A gallery entry with every variant, size and state, and a row in the contract test                                                                                                                                                |

### 6.3 Inventory

**Primitives**

| Component                 | Action             | Notes                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                    | Change             | One vocabulary; default `secondary`; add `loading` (sets `aria-busy` and `aria-disabled`, keeps the label, shows Spinner). Delete `default`, `outline`, `ghost`, `destructive`, `touch`, `xs`, `icon-xs` after a codemod (11 production sites plus 3 inside the primitives) |
| LinkButton                | New                | A link with button looks; replaces 63 hand-applied `buttonVariants`                                                                                                                                                                                                         |
| Spinner                   | New                | Replaces 24 inline copies                                                                                                                                                                                                                                                   |
| Input                     | Keep               | Share one field recipe with Textarea and Select trigger                                                                                                                                                                                                                     |
| Textarea                  | New                | Replaces 6 raw textareas and two exported class constants                                                                                                                                                                                                                   |
| Checkbox, RadioGroup      | New                | 24px, `select` colour; wraps Base UI so `Field`'s existing selectors apply                                                                                                                                                                                                  |
| OptionRow, SelectableTile | New                | Label, control and hint in one row; photo tile with a tick. About 12 sites                                                                                                                                                                                                  |
| Select                    | Keep, private      | Stays the engine behind `OptionSelect`. Add the menu's focus outline to items                                                                                                                                                                                               |
| Combobox                  | New                | On Base UI; replaces 2 hand-built ARIA comboboxes                                                                                                                                                                                                                           |
| SearchField               | New                | Icon, clear button, `role="search"`. 9 sites                                                                                                                                                                                                                                |
| SegmentedControl          | New, from `toggle` | Single choice, radio semantics. Replaces 4 implementations                                                                                                                                                                                                                  |
| FilterPill, PillGroup     | New                | Link mode (`aria-current`) for URL filters, toggle mode (`aria-pressed`) for in-page ones. Replaces 5 copies                                                                                                                                                                |
| Switch                    | Keep               | Remove the unused 36px size                                                                                                                                                                                                                                                 |
| Field family              | Extend             | `FormField` generates ids and wires label, description, error and `aria-invalid`. `FieldLabel` gains `optional`                                                                                                                                                             |
| Dialog, AlertDialog       | Change             | Shared sheet recipe; `size` prop (`sm`, `md`, `wide`, `viewer`); width and height classes forbidden at call sites                                                                                                                                                           |
| DropdownMenu              | Keep               | Source of the shared item focus recipe                                                                                                                                                                                                                                      |
| Table                     | Extend             | Stacked mode below `md`, taken from the staff directory's dual render                                                                                                                                                                                                       |
| Progress                  | Merge              | One component with `segments` and `bar` modes, built-in `progressbar` semantics and a required label. Replaces 5 implementations at 12 call sites                                                                                                                           |
| Skeleton                  | Extend             | Named recipes per layout: feed, grid, list, detail, form                                                                                                                                                                                                                    |
| Avatar                    | Keep               | Tokens for fill and initials                                                                                                                                                                                                                                                |
| Heading                   | New                | `level` and `size`; owns the display face                                                                                                                                                                                                                                   |
| Icon                      | Convention         | Size scale, `aria-hidden` by default, SSR import in server components                                                                                                                                                                                                       |
| Photo                     | New                | Fixed aspect box, `surface-2` placeholder, lazy by default, required `alt`, built on `preview-recovery`                                                                                                                                                                     |
| Badge, Alert              | Retire             | StatusChip, CountBadge and Notice already do these jobs                                                                                                                                                                                                                     |

**Patterns**

| Component                      | Action               | Notes                                                                                                                                                                     |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell, PageFrame               | New, from two shells | Skip link, header, nav, `main`, tab bar slot. Configured per surface, mounted in the layout                                                                               |
| PageHeader                     | Extend               | Add `back`. The only place an `h1` is written, apart from sign-in and state screens                                                                                       |
| BackLink                       | New                  | One icon, "Back to X", above the header                                                                                                                                   |
| Card                           | Extend               | Add `flush` (no padding, clipped) for list cards. Then the only way to draw the surface                                                                                   |
| List, ListRow                  | Merge                | `Row` plus coverage `ItemRow`: icon or thumbnail, two lines, chips, meta, end slot, container-query layout                                                                |
| Section                        | Merge                | `SectionHeader` plus `CoverageSection`: heading, count, action, scope                                                                                                     |
| StatTiles                      | Promote              | From coverage `Tally`                                                                                                                                                     |
| StatusChip                     | Consolidate          | The only public chip. State keys only; free-text `tone` removed. Add manager and amenity states. Rename the `tasks/` wrapper. Domain mappers live in one `status/` module |
| Notice                         | Extend               | Add `compact`. The only callout                                                                                                                                           |
| InlineError                    | New                  | For row-level failures; replaces about 34 hand-rolled alerts together with `FieldError` and `Notice`                                                                      |
| ActionOutcome                  | Promote              | From `CoverageNotice`: one polite region, takes focus when the trigger has gone                                                                                           |
| ActionDock                     | Extend               | Status line on the leading side; used by all sticky bars                                                                                                                  |
| FilterBar                      | New                  | Search, pills, select, result count, clear. URL is the state                                                                                                              |
| EvidenceImage, EvidencePreview | Merge                | Three implementations into one                                                                                                                                            |
| EmptyState, ErrorState         | Keep                 | See 7.3 for the screen-level wrappers                                                                                                                                     |
| ScopeLabel                     | Adopt                | Mandatory on every count (P5); it has no product consumer today                                                                                                           |

---

## 7. Experience patterns

### 7.1 Navigation

One shell contract, three configurations.

| Surface | Phone                                      | From `md`                                    | Account and sign-out |
| ------- | ------------------------------------------ | -------------------------------------------- | -------------------- |
| Staff   | Tab bar: Home, Photos, Add, People, Me     | Top bar with the same sections plus Our menu | On Me                |
| Manager | Tab bar: Overview, Review, Menu, Amenities | Top bar with section tabs                    | On Account           |
| Admin   | Top bar with a menu                        | Top bar; side nav from `lg`                  | In the header        |

Rules: at most five primary destinations on a phone. A destination that exists on desktop exists on the phone, even if it is one level down, and the route to it is the same on every screen. The active section comes from the pathname, never from a prop. Detail pages show a BackLink to a fixed parent. Route segments, section ids and labels use one word each (today `/staff/tasks` is "tasks" in code and "Home" on screen).

### 7.2 Forms

- Every labelled control is a `FormField`. Fields are required unless the label says "(optional)".
- One hook, `useActionForm`, owns pending state, field errors, the result and session-ended handling against the existing `ActionResult` type. It wraps the existing session hooks.
- On a failed submit, focus moves to the first invalid field. Field errors are linked with `aria-describedby`; one form-level Notice is the only assertive announcement.
- The submit button uses `loading`; its label changes to the "-ing" form with an ellipsis.
- Long editors get a leave guard from the same hook.

### 7.3 States

| State             | Pattern                                                                     | Rule                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Loading a route   | `loading.tsx` with `SkeletonRegion` and a named skeleton recipe             | The shell stays. The label says what is loading                                                                                 |
| Loading in place  | Button `loading`, or `Spinner` with a status line                           | Never a bare spinner                                                                                                            |
| Empty             | `EmptyState`: `first-use`, `filtered` (with Clear filters) or `done`        | Every list, grid and table that can be empty uses it                                                                            |
| Error in a region | `ErrorState` or `Notice`                                                    | What happened, what to do, reassurance when true                                                                                |
| Error for a route | `RouteError`                                                                | The shell stays, an `h1` takes focus, a way back is offered, the request id is shown to admins. Each `error.tsx` is three lines |
| Not found         | `NotFound` inside the shell, with a title, a reason and one action          | Always has an `h1`                                                                                                              |
| No access         | `AccessUnavailable`: account, venue or record variant                       | One look for all four of today's treatments                                                                                     |
| Offline           | `OfflineNotice`, with the fixed sentence "Nothing is sent twice" where true | Saves are disabled with the reason                                                                                              |
| Session ended     | The existing in-place "Sign in again" sheet                                 | Typed input is kept                                                                                                             |
| Success           | See 7.4                                                                     | No toasts                                                                                                                       |

Every top-level section owns its own loading and error file, so one section's failure is never reported as another's.

### 7.4 Feedback after an action

| Situation                         | Feedback                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Edit saved on the page            | Positive Notice beside the submit button                                                               |
| Action in a dialog                | Dialog closes; `ActionOutcome` at page level says what changed and takes focus if the trigger has gone |
| Destructive action                | Confirmation dialog naming the venue and the effect, safe choice first; then `ActionOutcome`           |
| Reversible toggle (accept, label) | Optimistic update, rolled back with an `InlineError` on failure                                        |
| Photos sent                       | Return to Home with the count in words, as the spec describes                                          |

### 7.5 Data display, overlays and motion

- **Lists.** Card lists on phones. Tables only on admin from `md`, stacked below. Load more; never page numbers, never infinite scroll.
- **Filters.** `FilterBar`, with the URL as the single source of state and a GET form that works without JavaScript.
- **Overlays.** Sheet on phones, dialog from `md`, both from one primitive. A full-screen `viewer` size for photos and guides. No custom overlays.
- **Motion.** Hover 150ms, sheets 260ms, 1px press. Nothing moves on its own except real status. A sheet that stays open never replays its entrance.
- **Perceived speed.** Skeletons in the real layout; `Suspense` around slow secondary panels; reserved aspect boxes for every photo so nothing jumps.

### 7.6 Words

Add to the voice rules: one verb per decision (D4), one word per intent for leaving ("Log out"), repeating ("Try again") and re-reading ("Reload"); one error stem ("We couldn't…"); "this device", not "this phone", in shared components; "activates", never "publishes", a menu; "menu item" as the noun, glossed as "dish or drink". Shared strings move to one `COMMON_COPY` module, and dates go through one formatter.

---

## 8. Roadmap

Each batch is one bundled PR with a fixed task list, following `AGENTS.md`. Batches 1 to 4 are sequential; batch 5 depends on a product decision; batch 6 can start once batch 2 lands. Size is relative: S is a handful of files, M tens, L a hundred or more.

### Batch 0: Source of truth (docs only, S)

Status: written on branch `docs/design-system-batch-0` on 14 Nov 2026 ([DESIGN.md](DESIGN.md), [components.md](components.md), [catalogue.md](catalogue.md), [decisions.md](decisions.md), [departures.md](departures.md)). DS-002 is recorded but every decision is still open.

| ID     | Task                                                                                                                                                         | Done when                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| DS-001 | Bring the spec into `docs/design-system/` as `DESIGN.md`, flattened so component values do not depend on two external CSS files; keep section numbers stable | The 46 code citations resolve; a test fails when a cited section is missing |
| DS-002 | Record decisions D1 to D6 (section 9) with an owner and a date                                                                                               | Each is answered or explicitly deferred                                     |
| DS-003 | Add a component catalogue (name, layer, status, adoption count) and a departures log seeded from the five open items in the research folder                  | Both are in the repo                                                        |
| DS-004 | Add a "UI changes" section to `AGENTS.md` and a link from `README.md`; mark the research folder and the PR #14 artifact as superseded                        | An agent starting UI work is pointed at the in-repo spec                    |

### Batch 1: Foundations (L, mostly mechanical)

| ID     | Task                                                                                                                                                                                                              | Done when                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| DS-101 | Token discipline test (source scan, on the `focus-outline-style` pattern): no raw colour, no shadcn slot names, no deprecated names, arbitrary values only from an allow-list with a reason per entry             | Runs in the unit lane; allow-list can only shrink                    |
| DS-102 | Token integrity test: parses `globals.css`; every token has a dark value or is listed as invariant; every `var()` used in components is defined; the class-merger lists match; contrast pairs meet their minimums | Fails on a missing or weak token                                     |
| DS-103 | Colour canon: rename to section 5.2, codemod minority names, delete 37 unused tokens, make shadcn slots private                                                                                                   | One utility per role                                                 |
| DS-104 | Edge, rail, ring and `focus-ring` utilities; replace the 121 arbitrary shadows and 91 focus strings                                                                                                               | Arbitrary `shadow-[…]` count is near zero                            |
| DS-105 | Type roles: collapse `-touch`, resolve the 21 real pairs, add `field` and `heading-sm`, add `Heading`                                                                                                             | 14 roles; no `font-display` outside `Heading` and the type utilities |
| DS-106 | Move sizes, gutters, containers, motion and layers into `@theme`; name container sizes                                                                                                                            | No `-(--token)` forms for design tokens                              |
| DS-107 | Dark edge and primary-button contrast; base focus colour                                                                                                                                                          | Contrast test passes at 3:1 for boundaries                           |
| DS-108 | Theme setting on Me and Account; remove the production hotkey; root `viewport` export with theme colour and `viewport-fit=cover`; root title template                                                             | Per D2; safe-area checked on a real iPhone                           |
| DS-109 | `lint` with `--max-warnings=0`; a11y rules as errors; `format:check` in the common lane after one formatting commit                                                                                               | CI fails on a warning                                                |

### Batch 2: Primitives (M)

| ID     | Task                                                                                                                                              | Done when                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| DS-201 | Primitive contract (section 6.2) applied to all of `components/ui`; contract test (table-driven, one file)                                        | Every primitive emits the same data attributes and size names       |
| DS-202 | Button: one vocabulary, default `secondary`, `loading`; Spinner; LinkButton; codemods                                                             | No alias variant in the tree; primaries are explicit                |
| DS-203 | Shared field recipe; Textarea; Checkbox; RadioGroup; OptionRow; SelectableTile                                                                    | No raw `textarea`, checkbox or radio outside `components/ui` (lint) |
| DS-204 | SegmentedControl, FilterPill, SearchField, Combobox; Select item focus                                                                            | Four segment and five pill copies removed                           |
| DS-205 | Dialog and AlertDialog shared recipe and `size`; Table stacked mode; Progress merge; Photo                                                        | Call sites carry no width, height or track classes                  |
| DS-206 | FormField and `useActionForm`                                                                                                                     | New forms need no local pending or error state                      |
| DS-207 | Gallery: one `/ui-preview` page per layer with every variant, size and state in both themes; completeness test; scope guard as a rule, not a list | A component without a gallery entry fails a unit test               |

### Batch 3: Patterns and adoption (L)

| ID     | Task                                                                              | Done when                                                           |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| DS-301 | One `Tone` type; StatusChip consolidation; states added for manager and amenities | One `StatusChip`; no free-text chips                                |
| DS-302 | Card everywhere (`flush` variant); List and ListRow; Section; StatTiles           | Card recipe appears only in `common-room/`; a scan test enforces it |
| DS-303 | Notice `compact`, InlineError, ActionOutcome; ActionDock for all sticky bars      | Three sanctioned error surfaces                                     |
| DS-304 | FilterBar; EvidenceImage and EvidencePreview                                      | One of each                                                         |
| DS-305 | Pattern layer membership and import rule; move logic out of `components/`         | Layer rule enforced by lint                                         |
| DS-306 | Amenities migrated to the current dialect and primitives                          | No earlier names remain; aliases deleted                            |

### Batch 4: Application experience (L)

| ID     | Task                                                                                                  | Done when                                                       |
| ------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| DS-401 | One Shell and PageFrame; mount in staff and admin layouts; active section from the pathname           | No page renders a shell; navigation survives loading and errors |
| DS-402 | RouteError, NotFound, AccessUnavailable; skeleton recipes; every section owns its states              | Three screen-state components replace 5 + 4 + 4 variants        |
| DS-403 | BackLink and PageHeader `back`; nav vocabulary aligned with routes                                    | Per section 7.1                                                 |
| DS-404 | Forms migrated to FormField and `useActionForm`; feedback table applied; leave guards on long editors | No raw `label`; one pending name                                |
| DS-405 | Voice pass: verb table, `COMMON_COPY`, one date formatter, device-neutral sign-in copy                | Copy test over the `*_COPY` modules                             |

### Batch 5: One manager workspace (product-gated, L)

| ID     | Task                                                                                                  | Done when                              |
| ------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| DS-501 | Per D3: one venue-manager navigation config used by every host; redirect or retire the legacy surface | "Review" and "Menu" mean one thing     |
| DS-502 | Merge the forked review and menu screens onto FilterBar, List and a shared ReviewCard                 | One implementation of each screen      |
| DS-503 | Move cross-surface screens out of route-private folders to a neutral home                             | No surface imports another's `_shared` |

### Batch 6: Proof (M, after batch 2)

| ID     | Task                                                                                                                                                        | Done when                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| DS-601 | Gallery spec: axe (full tag set), overflow and 44px targets on `/ui-preview` at 390 and 1280, light and dark, with committed screenshot baselines per block | A token change that moves a primitive fails a test |
| DS-602 | Shared `a11y.ts` helper; the generic target and focus sweeps move into always-on specs; 320px added                                                         | One definition of the accessibility bar            |
| DS-603 | WebKit lane for the gallery and the layout specs                                                                                                            | Safari rendering has a gate                        |
| DS-604 | `verify:change design` kind: token and primitive tests plus the gallery spec; fixed spec list in `verification-policy.md`                                   | A design change has one command                    |
| DS-605 | One VoiceOver, one TalkBack and one physical-phone pass per core journey, using the seven charters                                                          | Evidence recorded per commitment                   |

### Priorities, with reasoning

| #   | Do                                     | Why first                                                                                                                                      | Cost   |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Batch 0                                | Every later decision needs a text to point at, and it is a day of writing                                                                      | S      |
| 2   | DS-101, DS-102, DS-109                 | Guards are cheapest now, while the tree is nearly clean. Three rules (no undefined token, no raw colour, no direct Base UI import) start green | S      |
| 3   | Button default and vocabulary (DS-202) | The highest-visibility rule in the system is currently opt-out                                                                                 | S to M |
| 4   | Missing form primitives (DS-203)       | Removes the largest source of fresh divergence; every new form adds more today                                                                 | M      |
| 5   | Edges and focus utilities (DS-104)     | Removes the largest block of arbitrary values and fixes dark-mode boundary contrast in one place                                               | M      |
| 6   | Shell into layouts (DS-401)            | Fixes a real usability defect: staff lose navigation on every load and every error                                                             | L      |
| 7   | Card, List, Section adoption (DS-302)  | Largest file count, lowest risk; mechanical                                                                                                    | L      |
| 8   | Manager workspace (batch 5)            | Largest duplication, but not an engineering decision                                                                                           | L      |

Trade-offs to accept: batches 1 and 3 touch many files and will conflict with feature work, so each should land quickly behind a codemod and a scan test, during a quiet week. The visual suite will not have baselines for whole data-driven pages; baselines go on the deterministic gallery only, which is cheaper to keep true. The roadmap adds no runtime dependency: Base UI already ships Checkbox, Radio and Combobox, Playwright already does screenshot comparison, and the checks are source-scan unit tests.

---

## 9. Decisions needed

| ID  | Decision                                                                                      | Recommendation                                                                                                         | Blocks         |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------- |
| D1  | Sign off Common Room v0.3 as the product's design language, with the changes in 4.3           | Yes                                                                                                                    | Batch 0        |
| D2  | Theme policy: follow the OS with a visible setting, or light by default with dark as a choice | Follow the OS, with a setting on Me and Account. Staff phones in a dim bar are the case for dark                       | DS-108         |
| D3  | Which venue-manager workspace is canonical, and when the other is retired                     | `/manager`, since new grants go to manager accounts only; redirect `/staff/manage` on a date                           | Batch 5        |
| D4  | One verb and one resulting state word per review decision                                     | "Ask for another photo" → "Needs another photo"; "Undo acceptance"                                                     | DS-301, DS-405 |
| D5  | Is "Done" banned as a button label, or only as a state                                        | Only as a state                                                                                                        | DS-405         |
| D6  | Is "Ready" ever drawn as a chip, and which upload words staff see                             | Staff see Saved, Saving… and Needs attention; Ready is text on a tile, not a chip; remove the reserved shape or use it | DS-301         |
| D7  | Token names in 5.2 (`canvas`, `ink`, `edge-strong`)                                           | As proposed; follows measured use                                                                                      | DS-103         |

---

## 10. Governance

**Where things live.** `docs/design-system/DESIGN.md` is the spec. `app/globals.css` is the source of truth for values. `components/nabalens/status-chip.tsx` is the source of truth for state words, and the spec's state table is tested against it. `/ui-preview` is the living reference. The research folder and the claude.ai artifacts are for exploration; a direction chosen there lands as a change to `DESIGN.md` before code.

**Adding or changing a component.**

1. Check the catalogue. If a pattern exists, extend it. A second implementation is not accepted.
2. Build a thing in a feature first. Promote it to the pattern layer when a second feature needs it, not before.
3. A new or changed primitive or pattern needs: the contract in 6.2, a gallery entry with every variant and state in both themes, a row in the contract test, and a catalogue line.
4. A new token needs: a role that no existing token covers, a dark value, a contrast entry if it carries text or a boundary, and a line in the spec.
5. A deliberate exception goes in the departures log with a reason and an owner. An arbitrary value goes in the allow-list with a reason. Both lists are reviewed each batch and may only shrink.

**Deprecation.** A renamed token, variant or component keeps an alias for one batch. The discipline test lists it as deprecated, so no new use can be added. The next batch deletes it.

**Versioning.** The spec carries a version and a changelog. Additions bump the minor version; a rename, removal or visual change to an existing role bumps the major version and needs product sign-off. The app is the only consumer, so there is no package to publish.

**Review checklist for a UI change.** One primary per screen. Every state has a word and a shape. Every count has a scope. No text under 17px, no target under 44px. Works at 320px and at 200% zoom, in dark and in forced colours. Loading, empty, error and no-access are designed. Words follow the verb table. Gallery and catalogue updated.

**Measures.** Analytics are out of scope for this product, so the system's measures come from the code and from operations: hand-typed card recipes outside the pattern layer (98 files today, target 0); arbitrary shadow strings (121, target under 10); allow-list length; primitives with a gallery entry (8 of 18, target all); form files using `FormField` (14 of 32, target all); routes whose loading and error states keep the shell (staff 0 of 36, target all). Product measures (time to first accepted photo, review backlog age) come from existing timestamps, with a baseline taken before batch 4.
